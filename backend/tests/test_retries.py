import dataclasses
from datetime import timedelta

import pytest
from sqlalchemy import text

from app import database
from app.database import SessionLocal
from app.models import CallAttempt, CustomerFeedback, Escalation, Event, FollowUp, utcnow
from app.services import feedback_agent, followups, ivr, tts_audio, worker
from tests.factories import make_attempt, make_followup, make_ticket


@pytest.fixture(autouse=True)
def _retry_on(settings):
    """These tests cover the optional no-answer retry; it is off by default (one reminder call only)."""
    settings(followup_retry_no_answer=True)


def _missed_reminder(db, status="no-answer", scheduled_in=timedelta(hours=3), offset=120, answered=False):
    """A reminder call that ends, through the same path a provider's hangup takes; unanswered unless ``answered``."""
    ticket = make_ticket(db, scheduled_at=utcnow() + scheduled_in)
    reminder = make_followup(db, ticket, offset, status="calling")
    attempt = make_attempt(db, ticket, "followup", followup_id=reminder.id, status="ringing")
    if answered:
        attempt.status, attempt.answered_at = "in_progress", utcnow()
    ivr.ended(db, attempt, status)
    db.commit()
    return ticket, reminder, attempt


def _retries(db, reminder):
    return db.query(FollowUp).filter_by(retry_of=reminder.id).all()


def _escalation_reasons(db, ticket):
    return [e.reason for e in db.query(Escalation).filter_by(ticket_id=ticket.id)]


# ---- reminder retry -----------------------------------------------------------------------------------

def test_missed_reminder_retried_once_after_10_min(db):
    ticket, reminder, attempt = _missed_reminder(db)
    (retry,) = _retries(db, reminder)
    assert retry.status == "scheduled" and retry.offset_minutes == 120
    assert abs((retry.due_at - (utcnow() + timedelta(minutes=10))).total_seconds()) < 60
    assert (retry.helper_id, retry.phone) == (reminder.helper_id, reminder.phone)
    assert db.query(Event).filter_by(ticket_id=ticket.id, kind="followup_retry_scheduled").count() == 1
    assert _escalation_reasons(db, ticket) == []  # the retry is still to come
    retry.status = "calling"  # as process_due sets it when the retry is dialled
    retry_attempt = make_attempt(db, ticket, "followup", followup_id=retry.id, status="ringing")
    ivr.ended(db, retry_attempt, "busy")
    db.commit()
    assert db.query(FollowUp).filter_by(ticket_id=ticket.id).count() == 2  # never a second retry


@pytest.mark.parametrize("status,answered,retried", [
    ("no-answer", False, True), ("busy", False, True), ("completed", False, True),  # nobody picked up
    ("failed", False, False), ("completed", True, False),  # the line failed / the helper heard it and hung up
])
def test_only_unanswered_reminders_are_retried(db, status, answered, retried):
    ticket, reminder, attempt = _missed_reminder(db, status=status, answered=answered)
    assert bool(_retries(db, reminder)) is retried


def test_retry_not_scheduled_if_after_task_start(db):
    ticket, reminder, attempt = _missed_reminder(db, scheduled_in=timedelta(minutes=8), offset=30)
    assert _retries(db, reminder) == []
    assert _escalation_reasons(db, ticket) == ["helper_unconfirmed"]


def test_missed_retry_then_last_reminder_escalates_unconfirmed(db):
    ticket, reminder, attempt = _missed_reminder(db, offset=30)  # the only (so the last) reminder
    (retry,) = _retries(db, reminder)
    assert _escalation_reasons(db, ticket) == []
    retry.status = "calling"  # as process_due sets it when the retry is dialled
    retry_attempt = make_attempt(db, ticket, "followup", followup_id=retry.id, status="ringing")
    ivr.ended(db, retry_attempt, "no-answer")
    db.commit()
    assert _escalation_reasons(db, ticket) == ["helper_unconfirmed"]


def test_reschedule_keeps_pending_retry_unless_the_helper_changes(db):
    ticket, reminder, attempt = _missed_reminder(db)
    (retry,) = _retries(db, reminder)
    followups.schedule_for_ticket(db, ticket)
    db.commit()
    db.refresh(retry)
    assert retry.status == "scheduled"
    ticket.assignee_phone = "+919777777777"
    followups.schedule_for_ticket(db, ticket)
    db.commit()
    db.refresh(retry)
    assert retry.status == "cancelled"


def test_retry_is_dropped_when_the_ticket_loses_its_helper(db):
    ticket, reminder, attempt = _missed_reminder(db)
    (retry,) = _retries(db, reminder)
    ticket.assignee_id = ticket.assignee_phone = None
    followups.schedule_for_ticket(db, ticket)
    db.commit()
    db.refresh(retry)
    assert retry.status == "cancelled"


def test_retry_is_called_when_due_and_says_the_real_minutes_left(db):
    ticket, reminder, attempt = _missed_reminder(db)
    (retry,) = _retries(db, reminder)
    retry.due_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert followups.process_due(db) == 1
    placed = db.query(CallAttempt).filter_by(followup_id=retry.id).one()
    left = int((ticket.scheduled_at - retry.due_at).total_seconds() // 60)
    assert left != 120 and ivr.minutes_te(left) in ivr.join(ivr.prompt_parts(db, placed))
    assert ivr.minutes_te(left) in placed.script and ivr.minutes_te(120) not in placed.script


def test_a_normal_reminder_still_says_its_offset(db):
    ticket = make_ticket(db)
    reminder = make_followup(db, ticket, 60)
    attempt = make_attempt(db, ticket, "followup", followup_id=reminder.id)
    assert ivr.minutes_te(60) in ivr.join(ivr.prompt_parts(db, attempt))


def test_migration_adds_retry_of_to_an_existing_followups_table(db):
    db.execute(text("DROP TABLE followups"))
    db.execute(text(
        "CREATE TABLE followups (id INTEGER PRIMARY KEY, ticket_id VARCHAR(64), helper_id VARCHAR(64), "
        "helper_name VARCHAR(200), phone VARCHAR(32), offset_minutes INTEGER, due_at DATETIME, "
        "status VARCHAR(20), outcome VARCHAR(20), created_at DATETIME)"))
    db.commit()
    database._migrate_followups_table()
    assert "retry_of" in {row[1] for row in db.execute(text("PRAGMA table_info(followups)"))}


# ---- the rating call-back -----------------------------------------------------------------------------

def _customer_asked_to_be_called_back(db):
    ticket = make_ticket(db)
    first = make_attempt(db, ticket, "feedback", status="in_progress")
    ivr.press(db, first, "9")
    db.commit()
    return ticket, db.query(CustomerFeedback).filter_by(ticket_id=ticket.id).one()


def _make_due(db, feedback):
    feedback.callback_scheduled_at = utcnow() - timedelta(minutes=1)
    db.commit()


def test_key_9_calls_back_once_after_two_hours(db, monkeypatch):
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    ticket, feedback = _customer_asked_to_be_called_back(db)
    assert feedback.callback_requested and feedback.callback_scheduled_at > utcnow() + timedelta(minutes=119)
    assert feedback_agent.process_due_feedback_callbacks(db) == 0  # not due yet
    _make_due(db, feedback)
    assert feedback_agent.process_due_feedback_callbacks(db) == 1
    calls = db.query(CallAttempt).filter_by(ticket_id=ticket.id, purpose="feedback").order_by(CallAttempt.id).all()
    assert len(calls) == 2 and calls[1].status == "ringing"
    assert feedback_agent.process_due_feedback_callbacks(db) == 0  # already called back
    ivr.press(db, calls[1], "9")  # asks again: promised, but never a third call
    db.commit()
    db.refresh(feedback)
    _make_due(db, feedback)
    assert feedback_agent.process_due_feedback_callbacks(db) == 0
    assert db.query(CallAttempt).filter_by(ticket_id=ticket.id, purpose="feedback").count() == 2


def test_callbacks_wait_for_calling_hours_and_the_kill_switch(db, monkeypatch):
    ticket, feedback = _customer_asked_to_be_called_back(db)
    _make_due(db, feedback)
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: False)
    assert feedback_agent.process_due_feedback_callbacks(db) == 0
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    real = feedback_agent.runtime_settings
    monkeypatch.setattr(feedback_agent, "runtime_settings", lambda d: dataclasses.replace(real(d), emergency_stop_calls=True))
    assert feedback_agent.process_due_feedback_callbacks(db) == 0


def test_callbacks_placed_by_the_worker_are_committed(db, monkeypatch):
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    ticket, feedback = _customer_asked_to_be_called_back(db)
    _make_due(db, feedback)
    with SessionLocal() as worker_db:  # the worker's own session, closed at the end of its tick
        assert feedback_agent.process_due_feedback_callbacks(worker_db) == 1
    assert db.query(CallAttempt).filter_by(ticket_id=ticket.id, purpose="feedback").count() == 2


def test_feedback_calls_started_by_the_worker_are_committed(db, monkeypatch):
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    ticket = make_ticket(db, status="completed", updated_at=utcnow() - timedelta(hours=1))
    db.commit()
    with SessionLocal() as worker_db:
        assert feedback_agent.process_due_feedback_calls(worker_db) == 1
    assert db.query(CallAttempt).filter_by(ticket_id=ticket.id, purpose="feedback").count() == 1


def test_a_callback_for_a_customer_who_cannot_be_called_is_skipped_not_fatal(db, monkeypatch):
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda d: True)
    ticket, feedback = _customer_asked_to_be_called_back(db)
    ticket.customer_phone = None
    _make_due(db, feedback)
    assert feedback_agent.process_due_feedback_callbacks(db) == 0


# ---- the worker ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("provider,swept", [("vobiz", True), ("simulator", False)])
def test_worker_tick_places_callbacks_and_sweeps_old_audio_only_for_vobiz(db, monkeypatch, settings, provider, swept):
    settings(telephony_provider=provider)
    monkeypatch.setitem(worker.last_sync, "at", utcnow())  # no ExtraHand sync in this test
    sweeps, callbacks = [], []
    monkeypatch.setattr(tts_audio, "sweep", lambda max_age: sweeps.append(max_age) or 0)
    monkeypatch.setattr(worker, "process_due_feedback_callbacks", lambda d: callbacks.append(1) or 0)
    worker.tick()
    assert callbacks == [1]
    assert sweeps == ([timedelta(hours=2)] if swept else [])
