import json
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app import database
from app.integrations.mapping import IST
from app.models import CustomerFeedback, Escalation, utcnow
from app.services import handoff, ivr
from tests.factories import make_attempt, make_followup, make_ticket
from tests.vobiz_helpers import CALL_ID, OTHER_ID, _cb, _hook, _offer_in_progress, _spoken

SIP = "sip:handoff@abc.sip.livekit.cloud"
REMINDER_CANNOT = {"kind": "reminder", "decision": "cannot_come", "reason": "Fever",
                   "summary": "Helper has a fever and cannot come.", "transcript": "[Maya]: why?\n[Helper]: fever"}
REMINDER_LATE = {"kind": "reminder", "decision": "running_late", "eta_minutes": 45, "reason": "Traffic",
                 "summary": "Stuck in traffic, 45 more minutes."}
RATING = {"kind": "rating", "complaint_category": "late_arrival", "details": "Helper came two hours late",
          "summary": "Customer upset about the delay.", "transcript": "[Maya]: what went wrong?\n[Customer]: late"}


@pytest.fixture
def lk(env, settings):
    """Hand-off configured on top of the Vobiz test setup."""
    settings(handoff_sip_uri=SIP, handoff_secret="hs3cret")
    return env


def _reminder(db):
    ticket = make_ticket(db, dispatch_status="assigned")
    followup = make_followup(db, ticket, 60, status="calling")
    attempt = make_attempt(db, ticket, "followup", followup_id=followup.id, status="in_progress",
                           provider="vobiz", provider_call_id=CALL_ID)
    db.commit()
    return ticket, followup, attempt


def _rating(db):
    ticket = make_ticket(db)
    attempt = make_attempt(db, ticket, "feedback", status="in_progress", provider="vobiz", provider_call_id=CALL_ID)
    db.commit()
    return ticket, attempt


def _press(client, attempt, digit):
    return client.post(_hook(attempt, "gather"), data={"Digits": digit, "CallUUID": CALL_ID})


def _auth(attempt):
    return {"X-Handoff-Token": handoff.token_for(attempt.id)}


def _post_result(client, attempt, body):
    return client.post(f"/api/handoff/{attempt.id}/result", json=body, headers=_auth(attempt))


def _escalations(db, ticket):
    return db.query(Escalation).filter_by(ticket_id=ticket.id).all()


# ---- starting the hand-off ----------------------------------------------------------------------------

def test_reminder_key_2_hands_off_when_enabled(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    root = ET.fromstring(_press(client, attempt, "2").text)
    assert [child.tag for child in root] == ["Dial"]  # bridged at once: a spoken "please hold" would add seconds before the agent
    dial, token = root.find("Dial"), handoff.token_for(attempt.id)
    user = dial.find("User")
    assert dial.attrib["callerId"] == "+918000000000" and dial.attrib["action"] == _cb(attempt.id, "handoff-done")
    assert dial.attrib["timeLimit"] == "150" and dial.attrib["timeout"] == "20"
    assert user.attrib["sipHeaders"] == f"Attempt={attempt.id},Token={token}"
    assert user.text == f"sip:ivr-{attempt.id}-{token}@abc.sip.livekit.cloud"
    db.refresh(attempt)
    assert attempt.status == "handoff" and attempt.outcome is None and attempt.digits == "2"
    assert _escalations(db, ticket) == []


@pytest.mark.parametrize("config", [{}, {"handoff_sip_uri": SIP}, {"handoff_secret": "hs3cret"}])
def test_reminder_key_2_without_full_handoff_config_behaves_as_today(client, db, env, settings, config):
    settings(**config)
    ticket, followup, attempt = _reminder(db)
    root = ET.fromstring(_press(client, attempt, "2").text)
    assert root.find("Dial") is None and root.find("Hangup") is not None
    db.refresh(attempt)
    db.refresh(ticket)
    assert attempt.outcome == "declined" and ticket.dispatch_status == "escalated"
    assert [e.reason for e in _escalations(db, ticket)] == ["helper_cannot_attend"]
    assert "Maya" not in _escalations(db, ticket)[0].details  # no hand-off happened, so no mention of her


def test_offer_key_2_never_hands_off(client, db, lk):
    ticket, attempt = _offer_in_progress(db)
    root = ET.fromstring(_press(client, attempt, "2").text)
    assert root.find("Dial") is None and root.find("Hangup") is not None
    db.refresh(attempt)
    assert attempt.outcome == "rejected"


def test_rating_3_never_hands_off(client, db, lk):
    ticket, attempt = _rating(db)
    root = ET.fromstring(_press(client, attempt, "3").text)
    assert root.find("Dial") is None and root.find("Hangup") is not None
    db.refresh(attempt)
    assert attempt.outcome == "rating_3"


@pytest.mark.parametrize("digit", ["1", "2"])
def test_rating_keys_1_and_2_hand_off(client, db, lk, digit):
    ticket, attempt = _rating(db)
    root = ET.fromstring(_press(client, attempt, digit).text)
    assert root.find("Dial") is not None
    db.refresh(attempt)
    assert attempt.status == "handoff" and attempt.outcome is None


def test_a_repeated_key_during_hand_off_neither_redials_nor_records_the_key_twice(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    again = ET.fromstring(_press(client, attempt, "2").text)
    assert again.find("Dial") is not None
    db.refresh(attempt)
    assert attempt.digits == "2" and attempt.outcome is None


# ---- what the agent may read and write ----------------------------------------------------------------

def test_context_has_no_phone_or_address(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    r = client.get(f"/api/handoff/{attempt.id}/context", headers=_auth(attempt))
    assert r.status_code == 200
    ctx = r.json()
    assert set(ctx) == {"attempt_id", "purpose", "helper_name", "service", "area", "when"}
    assert (ctx["purpose"], ctx["helper_name"], ctx["service"], ctx["area"]) == ("followup", "Suresh", "Cleaning", "Kondapur")
    flat = json.dumps(ctx, ensure_ascii=False)
    for secret in ("9000000001", "9000000002", "Flat 302", "Sai Residency", "Ravi"):
        assert secret not in flat


def test_rating_context_names_the_customer_and_the_stars(client, db, lk):
    ticket, attempt = _rating(db)
    _press(client, attempt, "2")
    ctx = client.get(f"/api/handoff/{attempt.id}/context", headers=_auth(attempt)).json()
    assert ctx["customer_name"] == "Ravi" and ctx["rating"] == 2 and ctx["purpose"] == "feedback"
    assert "9000000001" not in json.dumps(ctx) and "Flat 302" not in json.dumps(ctx)


def test_context_rejects_a_bad_token_and_a_call_that_is_not_waiting(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    url = f"/api/handoff/{attempt.id}/context"
    assert client.get(f"/api/handoff/{attempt.id}/context", headers=_auth(attempt)).status_code == 409  # not handed off yet
    _press(client, attempt, "2")
    assert client.get(url).status_code == 403
    assert client.get(url, headers={"X-Handoff-Token": "0" * 40}).status_code == 403
    assert client.get(url, headers={"X-Handoff-Token": handoff.token_for(attempt.id + 1)}).status_code == 403
    assert client.get("/api/handoff/999/context", headers={"X-Handoff-Token": handoff.token_for(999)}).status_code == 404


# ---- results ------------------------------------------------------------------------------------------

def test_cannot_come_result_escalates_with_reason(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    assert _post_result(client, attempt, REMINDER_CANNOT).status_code == 200
    for row in (attempt, ticket, followup):
        db.refresh(row)
    assert attempt.outcome == "declined" and attempt.status == "ended"
    assert attempt.summary == REMINDER_CANNOT["summary"] and attempt.transcript == REMINDER_CANNOT["transcript"]
    assert json.loads(attempt.handoff_json)["reason"] == "Fever"
    (esc,) = _escalations(db, ticket)
    assert esc.reason == "helper_cannot_attend" and "Fever" in esc.details and REMINDER_CANNOT["summary"] in esc.details
    assert ticket.dispatch_status == "escalated" and (followup.status, followup.outcome) == ("done", "declined")


def test_running_late_keeps_assignee_and_status_and_cancels_reminders(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    later = make_followup(db, ticket, 30, status="scheduled")
    db.commit()
    _press(client, attempt, "2")
    assert _post_result(client, attempt, REMINDER_LATE).status_code == 200
    for row in (attempt, ticket, later):
        db.refresh(row)
    assert attempt.outcome == "running_late"
    assert ticket.assignee_id == "h1" and ticket.dispatch_status == "assigned"
    assert later.status == "cancelled"
    (esc,) = _escalations(db, ticket)
    assert esc.reason == "helper_running_late" and REMINDER_LATE["summary"] in esc.details
    eta_at = datetime.fromisoformat(json.loads(attempt.handoff_json)["eta_at"])
    assert f"~{eta_at.replace(tzinfo=UTC).astimezone(IST).strftime('%H:%M')}" in esc.details
    assert abs((eta_at - utcnow()).total_seconds() - 45 * 60) < 120


def test_rating_result_records_category_and_details(client, db, lk):
    ticket, attempt = _rating(db)
    _press(client, attempt, "1")
    assert _post_result(client, attempt, RATING).status_code == 200
    db.refresh(attempt)
    assert attempt.outcome == "rating_1"
    feedback = db.query(CustomerFeedback).filter_by(ticket_id=ticket.id).one()
    assert feedback.rating == 1 and feedback.complaint_category == "late_arrival"
    assert "two hours late" in feedback.complaint_details and feedback.resolution_status == "new"
    assert attempt.summary == RATING["summary"] and attempt.transcript == RATING["transcript"]  # Maya's, not synthesized
    assert db.query(Escalation).filter_by(ticket_id=ticket.id, reason="customer_complaint").count() == 1


@pytest.mark.parametrize("body", [
    {**REMINDER_LATE, "eta_minutes": None}, {**REMINDER_LATE, "eta_minutes": 0}, {**REMINDER_LATE, "eta_minutes": 601},
    {**RATING, "complaint_category": "weather"}, {**REMINDER_CANNOT, "reason": "x" * 501},
])
def test_invalid_results_are_422(client, db, lk, body):
    ticket, followup, attempt = _reminder(db) if body["kind"] == "reminder" else (None, None, _rating(db)[1])
    _press(client, attempt, "2")
    assert _post_result(client, attempt, body).status_code == 422
    db.refresh(attempt)
    assert attempt.status == "handoff"


def test_result_kind_must_match_the_call(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    assert _post_result(client, attempt, RATING).status_code == 422
    db.refresh(attempt)
    assert attempt.status == "handoff" and attempt.outcome is None
    assert _post_result(client, attempt, REMINDER_CANNOT).status_code == 200


def test_result_needs_the_token(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    url = f"/api/handoff/{attempt.id}/result"
    assert client.post(url, json=REMINDER_CANNOT).status_code == 403
    assert client.post(url, json=REMINDER_CANNOT, headers={"X-Handoff-Token": "0" * 40}).status_code == 403


def test_a_result_posted_twice_is_409(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    assert _post_result(client, attempt, REMINDER_CANNOT).status_code == 200
    assert _post_result(client, attempt, REMINDER_LATE).status_code == 409
    assert [e.reason for e in _escalations(db, ticket)] == ["helper_cannot_attend"]


def test_a_result_after_the_fallback_is_409(client, db, lk):
    ticket, attempt = _rating(db)
    _press(client, attempt, "1")
    client.post(_hook(attempt, "handoff-done"), data={"DialStatus": "no-answer", "CallUUID": CALL_ID})
    assert _post_result(client, attempt, RATING).status_code == 409
    feedback = db.query(CustomerFeedback).filter_by(ticket_id=ticket.id).one()
    assert feedback.complaint_category == "poor_service"  # the fallback's, not the late result's


# ---- the bridge ends ----------------------------------------------------------------------------------

def test_handoff_done_without_a_reminder_result_falls_back_to_cannot_attend(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    root = ET.fromstring(client.post(_hook(attempt, "handoff-done"), data={"DialStatus": "no-answer", "CallUUID": CALL_ID}).text)
    assert _spoken(root) == [ivr.CLOSING_LINES["declined"]]
    assert root.find("Hangup") is not None and root.find("Dial") is None
    db.refresh(attempt)
    assert attempt.outcome == "declined"
    assert [e.reason for e in _escalations(db, ticket)] == ["helper_cannot_attend"]


def test_handoff_done_without_a_rating_result_records_the_stars(client, db, lk):
    ticket, attempt = _rating(db)
    _press(client, attempt, "1")
    root = ET.fromstring(client.post(_hook(attempt, "handoff-done"), data={"DialStatus": "failed", "CallUUID": CALL_ID}).text)
    assert _spoken(root) == [ivr.CLOSING_LINES["rating_1"]]
    db.refresh(attempt)
    assert attempt.outcome == "rating_1"
    assert db.query(CustomerFeedback).filter_by(ticket_id=ticket.id).one().rating == 1


def test_handoff_done_after_a_result_just_hangs_up(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    _post_result(client, attempt, REMINDER_CANNOT)
    root = ET.fromstring(client.post(_hook(attempt, "handoff-done"), data={"DialStatus": "completed", "CallUUID": CALL_ID}).text)
    assert [child.tag for child in root] == ["Hangup"]


def test_the_a_leg_id_in_a_dial_callback_is_accepted(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    url = _hook(attempt, "handoff-done")
    assert client.post(url, data={"CallUUID": OTHER_ID, "DialALegUUID": OTHER_ID}).status_code == 403
    assert client.post(url, data={"CallUUID": OTHER_ID, "DialALegUUID": CALL_ID}).status_code == 200


def test_hangup_during_hand_off_without_a_result_falls_back(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    client.post(_hook(attempt, "hangup"), data={"Event": "Hangup", "CallStatus": "completed", "CallUUID": CALL_ID})
    db.refresh(attempt)
    assert attempt.outcome == "declined"
    assert [e.reason for e in _escalations(db, ticket)] == ["helper_cannot_attend"]


# ---- building blocks ----------------------------------------------------------------------------------

def test_token_is_40_hex_and_per_call(lk):
    token = handoff.token_for(5)
    assert len(token) == 40 and int(token, 16) >= 0 and token != handoff.token_for(6)


@pytest.mark.parametrize("configured,expected_tail", [
    ("sip:handoff@abc.sip.livekit.cloud", "@abc.sip.livekit.cloud"),
    ("sip:abc.sip.livekit.cloud", "@abc.sip.livekit.cloud"),
    ("sips:x@abc.sip.livekit.cloud:5061", "@abc.sip.livekit.cloud:5061"),
])
def test_sip_uri_replaces_the_user_part_with_the_call_and_token(lk, settings, configured, expected_tail):
    settings(handoff_sip_uri=configured)
    scheme = configured.split(":", 1)[0]
    assert handoff.sip_uri_for(5) == f"{scheme}:ivr-5-{handoff.token_for(5)}{expected_tail}"


@pytest.mark.parametrize("config,on", [
    ({"handoff_sip_uri": SIP, "handoff_secret": "s"}, True), ({"handoff_sip_uri": SIP, "handoff_secret": ""}, False),
    ({"handoff_sip_uri": "", "handoff_secret": "s"}, False),
])
def test_hand_off_is_enabled_only_with_a_uri_and_a_secret(settings, config, on):
    settings(**config)
    assert handoff.enabled() is on


def test_migration_adds_handoff_json_to_an_existing_table(db):
    db.execute(text("ALTER TABLE call_attempts DROP COLUMN handoff_json"))
    db.commit()
    database._migrate_call_attempts_table()
    assert "handoff_json" in {row[1] for row in db.execute(text("PRAGMA table_info(call_attempts)"))}


# ---- a request that loaded the call before another one finished it must not override the result ----------

def _call_finished_by_another_request(client, db):
    """A call in hand-off; a copy of it in `db` that still says so; then another request records the agent's result."""
    ticket, followup, attempt = _reminder(db)
    _press(client, attempt, "2")
    db.refresh(attempt)
    assert _post_result(client, attempt, REMINDER_LATE).status_code == 200
    assert attempt.status == "handoff" and attempt.outcome is None  # the copy is stale: that is the point
    return ticket, attempt


def test_the_fallback_does_not_override_a_result_that_arrived_first(client, db, lk):
    ticket, attempt = _call_finished_by_another_request(client, db)
    step = handoff.fallback(db, attempt)
    assert step.hangup and attempt.outcome == "running_late"
    assert [e.reason for e in _escalations(db, ticket)] == ["helper_running_late"]
    db.refresh(ticket)
    assert ticket.dispatch_status == "assigned"


def test_a_hangup_does_not_override_a_result_that_arrived_first(client, db, lk):
    ticket, attempt = _call_finished_by_another_request(client, db)
    ivr.ended(db, attempt, "completed")
    assert attempt.outcome == "running_late"
    assert [e.reason for e in _escalations(db, ticket)] == ["helper_running_late"]


def test_a_key_is_ignored_once_another_request_has_ended_the_call(client, db, lk):
    ticket, followup, attempt = _reminder(db)
    db.refresh(attempt)
    client.post(_hook(attempt, "hangup"), data={"Event": "Hangup", "CallStatus": "completed", "CallUUID": CALL_ID})
    assert attempt.outcome is None  # the copy in `db` is stale
    step = ivr.press(db, attempt, "1")
    assert step.hangup and [p.text for p in step.parts] == [ivr.GOODBYE]
    assert attempt.outcome == "no_answer"
