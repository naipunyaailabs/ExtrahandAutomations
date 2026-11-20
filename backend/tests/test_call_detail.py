"""What happened on a call, in order, and how long it lasted: the data behind the call detail page."""

import json
from datetime import timedelta

from app.models import CallAttempt, utcnow
from app.services import ivr
from tests.factories import make_attempt, make_ticket
from tests.test_handoff import REMINDER_CANNOT, _auth, _post_result, _press, _reminder, lk  # noqa: F401
from tests.vobiz_helpers import CALL_ID, _hook, _offer_in_progress, _ringing


def trail(db, attempt):
    db.refresh(attempt)
    return [(e["event"], e.get("detail")) for e in json.loads(attempt.timeline or "[]")]


def names(db, attempt):
    return [name for name, _ in trail(db, attempt)]


# ---- the trail ------------------------------------------------------------------------------------------

def _ringing_offer(db):
    ticket, attempt = _offer_in_progress(db)
    attempt.status = "ringing"
    db.commit()
    return ticket, attempt


def test_a_keypad_call_leaves_a_trail_in_order(client, db, env):
    ticket, attempt = _ringing_offer(db)
    client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID, "Event": "StartApp"})
    client.post(_hook(attempt, "gather"), data={"Digits": "1", "CallUUID": CALL_ID})
    client.post(_hook(attempt, "hangup"), data={"CallUUID": CALL_ID, "Status": "completed", "Duration": "42"})
    assert names(db, attempt) == ["answered", "prompt", "key", "outcome", "hangup"]
    got = dict(trail(db, attempt))
    assert got["prompt"] == "1 of 3" and got["key"] == "1" and got["outcome"] == "accepted"
    assert "42" in got["hangup"]


def test_every_entry_is_timestamped_in_order(client, db, env):
    ticket, attempt = _ringing_offer(db)
    client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID})
    client.post(_hook(attempt, "gather"), data={"Digits": "2", "CallUUID": CALL_ID})
    db.refresh(attempt)
    stamps = [e["t"] for e in json.loads(attempt.timeline)]
    assert stamps == sorted(stamps) and all(t.endswith("Z") and "T" in t for t in stamps)


def test_silence_is_noted_and_the_message_is_played_again(client, db, env):
    ticket, attempt = _ringing_offer(db)
    client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID})
    client.post(_hook(attempt, "gather"), data={"Digits": "", "CallUUID": CALL_ID})  # Vobiz posts this when the wait runs out
    assert names(db, attempt) == ["answered", "prompt", "silence", "prompt"]
    assert trail(db, attempt)[-1][1] == "2 of 3"


def test_the_trail_keeps_only_the_latest_entries(db):
    attempt = make_attempt(db, make_ticket(db), "dispatch")
    for i in range(ivr.MAX_TIMELINE + 25):
        ivr.note(attempt, "prompt", str(i))
    kept = json.loads(attempt.timeline)
    assert len(kept) == ivr.MAX_TIMELINE and kept[-1]["detail"] == str(ivr.MAX_TIMELINE + 24)


def test_a_damaged_trail_does_not_stop_the_call(db):
    attempt = make_attempt(db, make_ticket(db), "dispatch", timeline="{broken")
    ivr.note(attempt, "answered")
    assert [e["event"] for e in json.loads(attempt.timeline)] == ["answered"]


# ---- how long it lasted ---------------------------------------------------------------------------------

def test_the_duration_is_the_one_vobiz_reports(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    client.post(_hook(attempt, "hangup"), data={"CallUUID": CALL_ID, "Status": "completed", "Duration": "58"})
    db.refresh(attempt)
    assert attempt.duration_seconds == 58


def test_without_a_reported_duration_it_is_counted_from_answer_to_hangup(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    attempt.answered_at = utcnow() - timedelta(seconds=30)
    db.commit()
    client.post(_hook(attempt, "hangup"), data={"CallUUID": CALL_ID, "Status": "completed"})
    db.refresh(attempt)
    assert 29 <= attempt.duration_seconds <= 33


def test_a_call_nobody_answered_lasted_no_time(client, db, env):
    attempt = _ringing(db)
    client.post(_hook(attempt, "hangup"), data={"CallUUID": CALL_ID, "Status": "no-answer", "Duration": "0"})
    db.refresh(attempt)
    assert attempt.duration_seconds == 0 and attempt.outcome == "no_answer"


def test_vobiz_reports_the_state_in_a_field_called_status(client, db, env):
    busy, no_answer = _ringing(db), None
    client.post(_hook(busy, "hangup"), data={"CallUUID": CALL_ID, "Status": "busy"})
    db.refresh(busy)
    assert busy.outcome == "busy"


# ---- hand-offs ------------------------------------------------------------------------------------------

def test_a_hand_off_that_works_is_traced_from_the_key_to_the_result(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    assert names(db, attempt)[-2:] == ["key", "handoff_started"]
    assert client.get(f"/api/handoff/{attempt.id}/context", headers=_auth(attempt)).status_code == 200
    client.get(f"/api/handoff/{attempt.id}/context", headers=_auth(attempt))  # a retry must not add a second entry
    assert names(db, attempt).count("handoff_connected") == 1
    assert _post_result(client, attempt, REMINDER_CANNOT).status_code == 200
    got = dict(trail(db, attempt))
    assert got["handoff_result"] == "cannot_come" and got["outcome"] == "declined"


def test_a_hand_off_that_cannot_connect_records_why(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    client.post(_hook(attempt, "handoff-done"), data={"CallUUID": CALL_ID, "DialStatus": "failed",
                                                      "DialHangupCause": "NETWORK_OUT_OF_ORDER"})
    got = dict(trail(db, attempt))
    assert "failed" in got["handoff_failed"] and "NETWORK_OUT_OF_ORDER" in got["handoff_failed"]
    assert got["outcome"] == "declined"


# ---- the detail endpoint --------------------------------------------------------------------------------

def test_the_detail_endpoint_returns_the_call_its_trail_and_its_ticket(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    _post_result(client, attempt, REMINDER_CANNOT)
    r = client.get(f"/api/calls/{attempt.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == attempt.id and body["purpose"] == "followup" and body["outcome"] == "declined"
    assert [e["event"] for e in body["timeline"]][:2] == ["key", "handoff_started"]
    assert body["handoff"]["decision"] == "cannot_come" and "transcript" not in body["handoff"]
    assert body["transcript"].startswith("[Maya]")
    assert body["ticket"]["id"] == ticket.id and body["ticket"]["category"] == "Cleaning"
    assert body["followup"]["offset_minutes"] == 60


def test_the_list_stays_light_and_the_detail_has_the_trail(client, db, env):
    ticket, attempt = _offer_in_progress(db)
    client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID})
    listed = [c for c in client.get("/api/calls").json() if c["id"] == attempt.id][0]
    assert "timeline" not in listed
    assert client.get(f"/api/calls/{attempt.id}").json()["timeline"]


def test_an_unknown_call_is_a_404(client, db):
    assert client.get("/api/calls/99999").status_code == 404


# ---- calls that never report back -----------------------------------------------------------------------

def test_a_stale_call_is_hung_up_at_vobiz_as_well_as_closed_here(db, env):
    from app.services import worker

    ticket = make_ticket(db)
    attempt = make_attempt(db, ticket, "dispatch", status="in_progress", provider="vobiz", provider_call_id=CALL_ID,
                           created_at=utcnow() - timedelta(minutes=30))
    db.commit()
    assert worker.expire_stale_calls(db) == 1
    db.refresh(attempt)
    assert attempt.status == "ended" and "timed out" in (attempt.error or "")
    assert len(env.deletes) == 1 and CALL_ID in env.deletes[0].url  # otherwise it would keep running, and billing


def test_a_stale_call_that_vobiz_cannot_hang_up_is_still_closed_here(db, env, monkeypatch):
    from app.services import worker
    from app.telephony import vobiz

    def broken(url, **kw):
        raise vobiz.httpx.ConnectError("down")

    monkeypatch.setattr(vobiz.httpx, "delete", broken)
    attempt = make_attempt(db, make_ticket(db), "dispatch", status="ringing", provider="vobiz", provider_call_id=CALL_ID,
                           created_at=utcnow() - timedelta(minutes=30))
    db.commit()
    assert worker.expire_stale_calls(db) == 1
    db.refresh(attempt)
    assert attempt.status == "ended"
