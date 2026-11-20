"""ExtraHand sends the day as midnight IST ("…T18:30:00Z") and the slot in scheduledTimeStart / scheduledTimeEnd."""

from app.integrations.mapping import ist_text, normalize_task, parse_datetime, task_schedule_end

RAW = {
    "_id": "t1",
    "createdAt": "2026-11-18T16:19:08.456Z",
    "scheduledDate": "2026-11-18T18:30:00.000Z",  # 19 Nov 00:00 IST
    "scheduledTimeStart": "11:30 AM",
    "scheduledTimeEnd": "12:15 PM",
    "timeSlot": "midday",
    "estimatedDuration": 45,
}


def test_start_time_comes_from_scheduled_time_start():
    rec = normalize_task(RAW)
    assert ist_text(rec["scheduled_at"]) == "19 Nov, 11:30 AM"


def test_end_time_from_slot_end_or_duration():
    assert ist_text(task_schedule_end(RAW)) == "19 Nov, 12:15 PM"
    no_end = {**RAW, "scheduledTimeEnd": None}
    assert ist_text(task_schedule_end(no_end)) == "19 Nov, 12:15 PM"  # 11:30 + 45 min
    assert task_schedule_end({**RAW, "scheduledTimeStart": None}) is None  # no real start: no guessed end


def test_date_only_forms_still_work():
    assert ist_text(parse_datetime("2026-11-18T00:00:00Z", "10:00 AM")) == "18 Nov, 10:00 AM"
    assert ist_text(parse_datetime("2026-11-18", "10:00 AM")) == "18 Nov, 10:00 AM"
    # an unreadable slot name keeps the day as given
    assert ist_text(parse_datetime("2026-11-18T18:30:00.000Z", "midday")) == "19 Nov, 12:00 AM"
    # a real timestamp with a time is never moved
    assert ist_text(parse_datetime("2026-11-19T06:00:00Z", "4:00 PM")) == "19 Nov, 11:30 AM"


def test_one_reminder_call_one_hour_before_and_no_retry(db):
    """Default: a single reminder 60 min before the start; an unanswered one is not called again."""
    from datetime import timedelta

    from app.models import FollowUp, utcnow
    from app.services import followups, ivr
    from tests.factories import make_attempt, make_ticket

    start = utcnow() + timedelta(hours=5)
    ticket = make_ticket(db, scheduled_at=start)
    followups.schedule_for_ticket(db, ticket)
    db.flush()
    (only,) = db.query(FollowUp).filter_by(ticket_id=ticket.id, status="scheduled").all()
    assert only.offset_minutes == 60 and only.due_at == start - timedelta(minutes=60)

    only.status = "calling"
    attempt = make_attempt(db, ticket, "followup", followup_id=only.id, status="ringing")
    ivr.ended(db, attempt, "no-answer")
    db.commit()
    assert db.query(FollowUp).filter_by(ticket_id=ticket.id).count() == 1  # no second call


def test_welcome_is_sent_in_telugu_only_once_meta_approves_it():
    from whatsapp.welcomers import _sending_language

    en = {"language": "en", "status": "APPROVED"}
    assert _sending_language([en]) == "en"
    assert _sending_language([{"language": "te", "status": "PENDING"}, en]) == "en"
    assert _sending_language([{"language": "te", "status": "APPROVED"}, en]) == "te"
    assert _sending_language([{"language": "te", "status": "REJECTED"}]) is None
