"""Regression tests for the findings of the whole-branch review (see the plan ledger, 'Final:' lines)."""

import asyncio
import json
import threading
import xml.etree.ElementTree as ET
from datetime import timedelta

import httpx
import pytest
from sqlalchemy.dialects import mssql

from app.database import SessionLocal
from app.main import app
from app.models import CallAttempt, utcnow
from app.services import dispatch, feedback_agent, followups, handoff, ivr, tts_audio
from app.services.common import engine_lock, runtime_settings
from tests.factories import make_attempt, make_followup, make_ticket
from tests.vobiz_helpers import CALL_ID, _hook, _ringing, _spoken


class _Probe:
    """A provider that, when asked to place a call, looks at the database from another connection: what is already
    committed? (A customer can answer a call before the worker's batch has finished.)"""

    name = "vobiz"

    def __init__(self):
        self.committed_before = []

    def place_call(self, attempt):
        with SessionLocal() as other:
            self.committed_before.append(
                other.query(CallAttempt).filter(CallAttempt.provider_call_id.isnot(None)).count())
        return f"00000000-0000-4000-8000-{attempt.id:012d}"

    def hangup(self, attempt):
        pass


def _recent_completed(db, ticket_id, **kw):
    values = dict(id=ticket_id, status="completed", scheduled_at=utcnow() - timedelta(hours=3),
                  updated_at=utcnow() - timedelta(hours=1))
    values.update(kw)
    return make_ticket(db, **values)


# ---- Critical: rating calls must not go to every old job -----------------------------------------------------

def test_only_recently_scheduled_completed_jobs_get_a_rating_call(db, monkeypatch):
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    _recent_completed(db, "recent")
    _recent_completed(db, "old", scheduled_at=utcnow() - timedelta(days=10))  # a job from last week, first seen now
    _recent_completed(db, "undated", scheduled_at=None)
    db.commit()
    assert feedback_agent.process_due_feedback_calls(db) == 1
    called = {a.ticket_id for a in db.query(CallAttempt).filter_by(purpose="feedback")}
    assert called == {"recent"}


def test_the_rating_call_window_is_a_setting_with_a_two_day_default(db):
    assert runtime_settings(db).feedback_call_max_age_hours == 48


# ---- Important: commit each call as it is placed -------------------------------------------------------------

def test_each_placed_reminder_is_committed_before_the_next_call_is_prepared(db, monkeypatch):
    probe = _Probe()
    monkeypatch.setattr(dispatch, "get_provider_safe", lambda: (probe, None))
    for ticket_id in ("a", "b"):
        make_followup(db, make_ticket(db, id=ticket_id), 60, due_at=utcnow() - timedelta(minutes=1))
    db.commit()
    assert followups.process_due(db) == 2
    assert probe.committed_before == [0, 1]


def test_each_rating_call_is_committed_before_the_next_is_prepared(db, monkeypatch, settings):
    settings(telephony_provider="vobiz")
    probe = _Probe()
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    monkeypatch.setattr(dispatch, "get_provider_safe", lambda: (probe, None))
    for ticket_id in ("a", "b"):
        _recent_completed(db, ticket_id)
    db.commit()
    assert feedback_agent.process_due_feedback_calls(db) == 2
    assert probe.committed_before == [0, 1]


def test_each_call_back_is_committed_before_the_next_is_prepared(db, monkeypatch, settings):
    probe = _Probe()
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    for ticket_id in ("a", "b"):
        ticket = make_ticket(db, id=ticket_id)
        ivr.press(db, make_attempt(db, ticket, "feedback", status="in_progress"), "9")  # asks to be called back
    db.commit()
    for feedback in db.query(feedback_agent.CustomerFeedback):
        feedback.callback_scheduled_at = utcnow() - timedelta(minutes=1)
    db.commit()
    settings(telephony_provider="vobiz")
    monkeypatch.setattr(dispatch, "get_provider_safe", lambda: (probe, None))
    assert feedback_agent.process_due_feedback_callbacks(db) == 2
    assert probe.committed_before == [0, 1]


# ---- Important: webhooks must not freeze the event loop ------------------------------------------------------

def test_a_webhook_waiting_for_the_lock_does_not_stall_other_requests(db, env):
    attempt = _ringing(db)
    name = tts_audio.ensure(0, ivr.Part("x"))
    held, release = threading.Event(), threading.Event()

    def hold_the_lock():
        with engine_lock:
            held.set()
            release.wait(6)

    holder = threading.Thread(target=hold_the_lock)
    holder.start()
    held.wait()

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://ivr.test") as client:
            slow = asyncio.create_task(client.post(_hook(attempt, "answer"), data={"CallUUID": CALL_ID}))
            await asyncio.sleep(0.3)
            fast = await asyncio.wait_for(client.get(f"/api/telephony/audio/{name}.wav"), 4)
            still_held = holder.is_alive()  # the lock was never released for the fast request
            release.set()
            return fast.status_code, still_held, (await slow).status_code

    try:
        assert asyncio.run(scenario()) == (200, True, 200)
    finally:
        release.set()
        holder.join()


# ---- Important: the area, not the state or the country -------------------------------------------------------

@pytest.mark.parametrize("address", [
    "Flat 302, Kondapur, Hyderabad, Telangana, 500084",
    "Plot 12, Kondapur, Hyderabad, Telangana 500084, India",
    "Kondapur, Hyderabad, Telangana 500084",
    "Plot 12, Kondapur, Hyderabad 500084, India",
])
def test_the_area_is_the_neighbourhood_not_the_state_or_the_country(db, address):
    assert ivr.area_of(make_ticket(db, address=address)) == "Kondapur"


def test_an_address_of_only_a_state_and_a_country_falls_back_to_the_city(db):
    assert ivr.area_of(make_ticket(db, address="Telangana, India")) == "Hyderabad"


# ---- Important: valid on SQL Server --------------------------------------------------------------------------

def test_the_call_back_query_is_valid_sql_server(db):
    sql = str(feedback_agent._due_callback_query(db).statement.compile(dialect=mssql.dialect()))
    assert "IS 1" not in sql and "callback_requested = 1" in sql


# ---- Important: silence is not a wrong key -------------------------------------------------------------------

def test_a_gather_without_digits_is_silence_not_a_wrong_key(client, db, env):
    attempt = _ringing(db)
    attempt.status = "in_progress"
    db.commit()
    root = ET.fromstring(client.post(_hook(attempt, "gather"), data={"Digits": "", "InputType": "dtmf"}).text)
    assert ivr.INVALID_KEY not in _spoken(root) and root.find("Gather") is not None
    db.refresh(attempt)
    assert attempt.prompts_played == 1 and attempt.digits == ""


# ---- Important: support must be able to tell a keypad-only 'cannot attend' from Maya's ------------------------

def test_a_fallback_after_hand_off_tells_support_the_agent_recorded_nothing(client, db, env, settings):
    settings(handoff_sip_uri="sip:handoff@abc.sip.livekit.cloud", handoff_secret="hs3cret")
    ticket = make_ticket(db, dispatch_status="assigned")
    attempt = make_attempt(db, ticket, "followup", followup_id=make_followup(db, ticket, 60, status="calling").id,
                           status="in_progress", provider="vobiz", provider_call_id=CALL_ID)
    db.commit()
    client.post(_hook(attempt, "gather"), data={"Digits": "2", "CallUUID": CALL_ID})
    client.post(_hook(attempt, "handoff-done"), data={"DialStatus": "no-answer", "CallUUID": CALL_ID})
    from app.models import Escalation
    (esc,) = db.query(Escalation).filter_by(ticket_id=ticket.id).all()
    assert esc.reason == "helper_cannot_attend" and "before Maya recorded an answer" in esc.details


# ---- Spec anti-goal: no phone numbers spoken or shown to the model -------------------------------------------

def test_a_phone_number_typed_into_the_address_is_not_read_out(db):
    ticket = make_ticket(db, address="Flat 302, Sai Residency, Kondapur, call 9876543210 or +91 98765 43210, Hyderabad")
    parts = ivr.closing_parts(db, make_attempt(db, ticket, "dispatch"), "accepted")
    (spoken_address,) = [p.text for p in parts if p.personal]
    assert spoken_address == "Flat 302, Sai Residency, Kondapur, Hyderabad"


def test_a_pincode_and_a_door_number_are_still_read_out(db):
    ticket = make_ticket(db, address="Flat 302, Sai Residency, Kondapur, Hyderabad 500084")
    text = ivr.join(ivr.closing_parts(db, make_attempt(db, ticket, "dispatch"), "accepted"))
    assert "Flat 302" in text and "500084" in text


def test_the_agent_context_never_carries_free_text_from_the_title(db):
    ticket = make_ticket(db, category=None, title="Clean my flat, call 9000000001, Flat 302")
    attempt = make_attempt(db, ticket, "followup", status="handoff")
    ctx = handoff.context(db, attempt)
    assert ctx["service"] == "service" and "9000000001" not in json.dumps(ctx, ensure_ascii=False)
