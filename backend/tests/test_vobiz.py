import base64
import hashlib
import hmac
import xml.etree.ElementTree as ET

import httpx
import pytest

from app.models import CallAttempt, Event, utcnow
from app.services import dispatch, ivr, tts_audio
from app.services.feedback_agent import start_customer_feedback_call
from app.telephony import get_provider, vobiz
from app.telephony.base import TelephonyError
from tests.factories import make_attempt, make_ticket
from tests.vobiz_helpers import (
    BASE, CALL_ID, HOOK, OTHER_ID, _cb, _hook, _offer_in_progress, _ringing, _run_with, _spoken, _token, _uuid,
)

def _sign(url, nonce, token="TOK", version="V3"):
    message = url + ("." if version == "V3" else "") + nonce
    return base64.b64encode(hmac.new(token.encode(), message.encode(), hashlib.sha256).digest()).decode()


# ---- provider -----------------------------------------------------------------------------------------

def test_place_call_prepares_audio_then_posts_call(db, env):
    attempt = make_attempt(db, make_ticket(db), "dispatch")
    assert vobiz.VobizProvider().place_call(attempt) == _uuid(1)
    post = env.posts[0]
    assert post.url == "https://api.vobiz.ai/api/v1/Account/AID/Call/"
    assert post.headers["X-Auth-ID"] == "AID" and post.headers["X-Auth-Token"] == "TOK"
    assert post.json == {
        "from": "918000000000", "to": "919000000002",
        "answer_url": _cb(attempt.id, "answer"), "answer_method": "POST",
        "hangup_url": _cb(attempt.id, "hangup"), "hangup_method": "POST",
        "ring_timeout": "30",
    }
    needed = {f"{tts_audio.name_for(attempt.id, p)}.wav" for p in ivr.all_parts(db, attempt)}
    assert needed <= set(env.listing[0])  # every line existed before Vobiz was asked to dial


def test_sarvam_failure_means_no_call_and_next_helper(db, env):
    ticket = make_ticket(db)
    run = _run_with(db, ticket, ("h1", "Anil", "+919100000001"), ("h2", "Bala", "+919100000002"))
    env.fail_on = "Anil"
    dispatch._call_next(db, run)
    first, second = db.query(CallAttempt).filter_by(run_id=run.id).order_by(CallAttempt.id).all()
    assert (first.status, first.outcome) == ("ended", "failed") and "audio" in first.error.lower()
    assert second.status == "ringing" and second.provider_call_id == _uuid(1)
    assert [p.json["to"] for p in env.posts] == ["919100000002"]


def test_a_vobiz_error_is_a_telephony_error_and_leaves_no_per_call_audio(db, env):
    env.status = 402
    attempt = make_attempt(db, make_ticket(db), "dispatch")
    with pytest.raises(TelephonyError, match="402"):
        vobiz.VobizProvider().place_call(attempt)
    assert list(env.dir.glob("p*-*.wav")) == []


def test_provider_names_the_settings_it_is_missing(env, settings):
    settings(vobiz_auth_id="", sarvam_api_key="")
    with pytest.raises(TelephonyError) as e:
        vobiz.VobizProvider()
    assert "VOBIZ_AUTH_ID" in str(e.value) and "SARVAM_API_KEY" in str(e.value)


def test_get_provider_returns_vobiz(env):
    assert get_provider().name == "vobiz"


def test_hangup_deletes_the_live_call(db, env):
    attempt = make_attempt(db, make_ticket(db), "dispatch", provider_call_id=_uuid(9))
    vobiz.VobizProvider().hangup(attempt)
    assert env.deletes[0].url == f"https://api.vobiz.ai/api/v1/Account/AID/Call/{_uuid(9)}/"
    assert env.deletes[0].headers["X-Auth-Token"] == "TOK"


def test_feedback_call_goes_through_provider(db, env):
    ticket = make_ticket(db)
    attempt = start_customer_feedback_call(db, ticket.id, trigger="manual")
    assert attempt.provider == "vobiz" and attempt.provider_call_id == _uuid(1) and attempt.status == "ringing"
    assert env.posts[0].json["to"] == "919000000001"


# ---- signatures ---------------------------------------------------------------------------------------

def test_verify_signature_accepts_v2_and_v3_and_ignores_the_query():
    url, nonce = f"{BASE}/answer", "12345678901234567890"
    for version, sep in (("V2", ""), ("V3", ".")):
        headers = {f"X-Vobiz-Signature-{version}": _sign(url, nonce, version=version),
                   f"X-Vobiz-Signature-{version}-Nonce": nonce}
        assert vobiz.verify_signature(url + "?attempt_id=5", headers, "TOK")
        assert not vobiz.verify_signature(url, headers, "OTHER")
    assert not vobiz.verify_signature(url, {}, "TOK")


def test_bad_signature_is_403_and_a_good_one_is_accepted(client, db, env, settings):
    settings(vobiz_validate_signature="true")
    attempt = _ringing(db)
    url = _hook(attempt, "answer")
    wrong = {"X-Vobiz-Signature-V3": "nope", "X-Vobiz-Signature-V3-Nonce": "123"}
    assert client.post(url, data={"CallUUID": CALL_ID}, headers=wrong).status_code == 403
    assert client.post(url, data={"CallUUID": CALL_ID}).status_code == 403
    nonce = "12345678901234567890"
    good = {"X-Vobiz-Signature-V3": _sign(f"{BASE}/answer", nonce), "X-Vobiz-Signature-V3-Nonce": nonce}
    assert client.post(url, data={"CallUUID": CALL_ID}, headers=good).status_code == 200


def test_unknown_attempt_is_404(client, env):
    assert client.post(f"{HOOK}/answer?attempt_id=999&t={_token(999)}").status_code == 404
    assert client.post(f"{HOOK}/answer?attempt_id=abc").status_code == 404


# ---- the call itself ----------------------------------------------------------------------------------

def test_answer_returns_gather_with_nested_plays(client, db, env):
    attempt = _ringing(db)
    r = client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID, "Event": "StartApp"})
    assert r.status_code == 200
    root = ET.fromstring(r.text)
    gather = root.find("Gather")
    assert root.findall("Play") == [] and len(gather.findall("Play")) == 1  # one message, one file
    assert len(_spoken(root)) == 4  # of four phrases
    assert gather.attrib["inputType"] == "dtmf" and gather.attrib["numDigits"] == "1"
    assert gather.attrib["action"] == _cb(attempt.id, "gather")
    assert root.find("Redirect").text == _cb(attempt.id, "answer")
    db.refresh(attempt)
    assert attempt.provider_call_id == CALL_ID and attempt.status == "in_progress"


def test_offer_key_1_accepts_and_plays_address(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    r = client.post(_hook(attempt, "gather"), data={"Digits": "1"})
    root = ET.fromstring(r.text)
    assert root.find("Hangup") is not None and root.find("Gather") is None
    spoken = _spoken(root)
    assert any("Flat 302, Sai Residency, Kondapur" in t for t in spoken)
    assert not any("9000000001" in t or "Ravi" in t for t in spoken)
    db.refresh(ticket)
    assert ticket.assignee_id == "h1" and ticket.dispatch_status == "assigned"


def test_offer_key_0_rejects_and_calls_next(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    r = client.post(_hook(attempt, "gather"), data={"Digits": "0"})
    root = ET.fromstring(r.text)
    assert root.find("Hangup") is not None and root.find("Gather") is None
    db.refresh(ticket)
    db.refresh(attempt)
    assert attempt.outcome == "rejected"
    assert ticket.dispatch_status != "assigned"


def test_offer_key_star_repeats_prompt(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    r = client.post(_hook(attempt, "gather"), data={"Digits": "*"})
    root = ET.fromstring(r.text)
    assert root.find("Gather") is not None
    assert root.find("Hangup") is None


def test_duplicate_gather_does_not_finish_twice(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    url = _hook(attempt, "gather")
    client.post(url, data={"Digits": "1"})
    again = client.post(url, data={"Digits": "1"})
    assert ET.fromstring(again.text).find("Hangup") is not None
    assert db.query(Event).filter_by(ticket_id=ticket.id, kind="helper_accepted").count() == 1


def test_a_wrong_key_plays_the_error_and_redirects_back(client, db, env):
    attempt = _ringing(db)
    attempt.status = "in_progress"
    db.commit()
    root = ET.fromstring(client.post(_hook(attempt, "gather"), data={"Digits": "7"}).text)
    assert root.find("Gather") is None and root.find("Hangup") is None
    assert _spoken(root) == [ivr.INVALID_KEY]
    assert root.find("Redirect").text == _cb(attempt.id, "answer")


def test_audio_failure_during_the_call_hangs_up_quietly(client, db, env):
    attempt = _ringing(db)
    env.fail_on = "Suresh"
    r = client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID})
    root = ET.fromstring(r.text)
    assert r.status_code == 200 and [child.tag for child in root] == ["Hangup"]


@pytest.mark.parametrize("fields,outcome", [
    ({}, "no_answer"),
    ({"CallStatus": "busy"}, "busy"),
    ({"HangupCauseName": "USER_BUSY"}, "busy"),
    ({"CallStatus": "timeout"}, "no_answer"),
    ({"CallStatus": "no-answer"}, "no_answer"),
    ({"CallStatus": "failed"}, "failed"),
])
def test_hangup_records_the_outcome_and_purges_audio(client, db, env, fields, outcome):
    attempt = _ringing(db)
    tts_audio.prepare(attempt.id, [ivr.Part("Suresh", personal=True)])
    assert list(env.dir.glob(f"p{attempt.id}-*.wav"))
    r = client.post(_hook(attempt, "hangup"), data={"Event": "Hangup", "CallStatus": "completed", **fields})
    assert r.status_code == 200
    db.refresh(attempt)
    assert attempt.status == "ended" and attempt.outcome == outcome
    assert list(env.dir.glob(f"p{attempt.id}-*.wav")) == []


def test_hangup_after_the_call_was_answered_without_a_key_is_hung_up(client, db, env):
    attempt = _ringing(db)
    attempt.status, attempt.answered_at = "in_progress", utcnow()
    db.commit()
    client.post(_hook(attempt, "hangup"), data={"Event": "Hangup", "CallStatus": "completed"})
    db.refresh(attempt)
    assert attempt.outcome == "hung_up"


def test_inbound_plays_the_callback_line_and_hangs_up(client, env):
    root = ET.fromstring(client.post(f"{HOOK}/inbound", data={"From": "919999999999"}).text)
    assert _spoken(root) == [ivr.INBOUND_LINE] and root.find("Hangup") is not None


@pytest.mark.parametrize("configured,sent", [(1, "5"), (7, "7"), (600, "60")])
def test_gather_timeout_is_kept_within_vobizs_limits(settings, configured, sent):
    settings(ivr_gather_timeout_seconds=configured)
    assert f'executionTimeout="{sent}"' in vobiz.gather(["https://x/a.wav"], "https://x/g", "https://x/a")


# ---- callbacks are bound to their call (Vobiz's signature covers the URL path and a nonce, not the query) ----

def test_callback_token_is_a_keyed_hash_of_the_attempt_id(env):
    assert vobiz.callback_token(7) == _token(7) and vobiz.callback_token(7) != vobiz.callback_token(8)
    assert len(vobiz.callback_token(7)) == 32


def test_callbacks_need_the_calls_own_token(client, db, env):
    ticket = make_ticket(db)
    first = make_attempt(db, ticket, "dispatch", status="ringing", provider="vobiz")
    second = make_attempt(db, ticket, "dispatch", status="ringing", provider="vobiz")
    db.commit()
    url = f"{HOOK}/answer?attempt_id={first.id}"
    assert client.post(url).status_code == 403
    assert client.post(f"{url}&t=" + "0" * 32).status_code == 403
    assert client.post(f"{url}&t={_token(second.id)}").status_code == 403  # another call's token
    assert client.post(f"{url}&t={_token(first.id)}").status_code == 200


def test_a_callback_must_carry_its_own_call_id(client, db, env):
    attempt = _ringing(db, provider_call_id=CALL_ID)
    assert client.post(_hook(attempt, "gather"), data={"Digits": "7", "CallUUID": OTHER_ID}).status_code == 403
    assert client.post(_hook(attempt, "gather"), data={"Digits": "7", "CallUUID": CALL_ID}).status_code == 200


def test_answer_never_replaces_a_known_call_id(client, db, env):
    attempt = _ringing(db, provider_call_id=CALL_ID)
    assert client.post(_hook(attempt, "answer"), data={"CallUUID": OTHER_ID}).status_code == 403
    db.refresh(attempt)
    assert attempt.provider_call_id == CALL_ID


def test_a_call_id_that_is_not_a_uuid_is_refused(client, db, env):
    attempt = _ringing(db)
    assert client.post(_hook(attempt, "answer"), data={"CallUUID": "../../x"}).status_code == 403
    db.refresh(attempt)
    assert attempt.provider_call_id is None


def test_vobiz_must_return_a_uuid_call_id(db, env, monkeypatch):
    monkeypatch.setattr(vobiz.httpx, "post", lambda url, **kw: httpx.Response(
        200, json={"request_uuid": "../x"}, request=httpx.Request("POST", url)))
    with pytest.raises(TelephonyError):
        vobiz.VobizProvider().place_call(make_attempt(db, make_ticket(db), "dispatch"))


def test_simulator_calls_cannot_be_driven_by_webhooks(client, db, env):
    attempt = _ringing(db, provider="simulator")
    assert client.post(_hook(attempt, "answer")).status_code == 404


def test_webhooks_refuse_when_the_auth_token_is_missing(client, db, env, settings):
    attempt = _ringing(db)
    settings(vobiz_auth_token="")
    assert client.post(f"{HOOK}/answer?attempt_id={attempt.id}&t=").status_code == 503


def test_hangup_encodes_the_call_id_in_the_url(db, env):
    attempt = make_attempt(db, make_ticket(db), "dispatch", provider_call_id="a/b?c")
    vobiz.VobizProvider().hangup(attempt)
    assert env.deletes[0].url.endswith("/Call/a%2Fb%3Fc/")
