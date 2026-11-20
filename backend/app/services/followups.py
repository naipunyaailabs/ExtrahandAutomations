"""Reminder calls to the assigned helper before the task starts."""

from datetime import timedelta

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import CallAttempt, FollowUp, Ticket, utcnow
from .common import engine_lock, log_event, runtime_settings
from . import handoff, ivr
from .ivr import followup_script

# A reminder that should have fired longer ago than this (e.g. the server was
# down) is skipped instead of calling late.
MISSED_GRACE = timedelta(minutes=15)

# A reminder nobody picked up is tried once more this long after, if the task has not started by then.
RETRY_AFTER = timedelta(minutes=10)
RETRY_OUTCOMES = {"no_answer", "busy"}


def schedule_for_ticket(db: Session, ticket: Ticket) -> None:
    """Brings the ticket's pending reminders in line with its helper and start time. Idempotent."""
    pending = db.query(FollowUp).filter_by(ticket_id=ticket.id, status="scheduled").all()
    if not ticket.assignee_id or not ticket.scheduled_at or not ticket.assignee_phone:
        if not ticket.assignee_phone and ticket.assignee_id and not pending:
            log_event(db, ticket.id, "followup_skipped", "Assigned helper has no phone number; reminders not scheduled")
        cancel_for_ticket(db, ticket.id, pending)
        return

    now = utcnow()
    wanted = {}
    for offset in runtime_settings(db).followup_offsets_minutes:
        due = ticket.scheduled_at - timedelta(minutes=offset)
        if due > now:
            wanted[offset] = due

    keep = set()
    for f in pending:
        same_helper = f.helper_id == ticket.assignee_id and f.phone == ticket.assignee_phone
        if f.retry_of is not None:  # a retry has its own time: it stays while the same helper still has time to come
            if not same_helper or f.due_at >= ticket.scheduled_at:
                f.status = "cancelled"
        elif same_helper and wanted.get(f.offset_minutes) == f.due_at:
            keep.add(f.offset_minutes)
        else:
            f.status = "cancelled"

    done = {
        f.offset_minutes for f in db.query(FollowUp).filter(
            FollowUp.ticket_id == ticket.id, FollowUp.helper_id == ticket.assignee_id,
            FollowUp.status.in_(("calling", "done")))
    }
    created = []
    for offset, due in wanted.items():
        if offset in keep or offset in done:
            continue
        db.add(FollowUp(ticket_id=ticket.id, helper_id=ticket.assignee_id, helper_name=ticket.assignee_name,
                        phone=ticket.assignee_phone, offset_minutes=offset, due_at=due))
        created.append(offset)
    if created:
        log_event(db, ticket.id, "followups_scheduled",
                  "Reminder calls scheduled " + ", ".join(f"{m} min" for m in sorted(created, reverse=True))
                  + f" before the task for {ticket.assignee_name or ticket.assignee_phone}")


def cancel_for_ticket(db: Session, ticket_id: str, pending: list[FollowUp] | None = None) -> None:
    pending = pending if pending is not None else db.query(FollowUp).filter_by(ticket_id=ticket_id, status="scheduled").all()
    for f in pending:
        f.status = "cancelled"
    if pending:
        log_event(db, ticket_id, "followups_cancelled", f"{len(pending)} pending reminder call(s) cancelled")


def process_due(db: Session) -> int:
    """Places the reminder calls that are due. Returns how many calls were placed."""
    from .dispatch import get_provider_safe

    r = runtime_settings(db)
    if r.emergency_stop_calls or not r.calling_agent_active:
        return 0
    from .common import within_calling_hours

    if not within_calling_hours(db):
        return 0  # outside calling hours: reminders wait (and are marked missed if their moment passes)

    placed = 0
    with engine_lock:
        now = utcnow()
        due = db.query(FollowUp).filter(FollowUp.status == "scheduled", FollowUp.due_at <= now).all()
        provider, provider_error = get_provider_safe()
        for f in due:
            ticket = db.get(Ticket, f.ticket_id)
            if now - f.due_at > MISSED_GRACE:
                f.status, f.outcome = "missed", "missed"
                log_event(db, f.ticket_id, "followup_missed", f"{f.offset_minutes}-min reminder was not sent in time")
                continue
            attempt = CallAttempt(
                ticket_id=f.ticket_id, purpose="followup", followup_id=f.id, helper_id=f.helper_id,
                helper_name=f.helper_name, phone=f.phone, provider=provider.name if provider else "none",
                script=followup_script(ticket, f.helper_name, ivr.reminder_minutes(f, ticket)),
            )
            db.add(attempt)
            db.flush()
            f.status = "calling"
            try:
                if provider is None:
                    raise RuntimeError(provider_error)
                attempt.provider_call_id = provider.place_call(attempt)
                attempt.status = "ringing"
                placed += 1
                log_event(db, f.ticket_id, "followup_call",
                          f"{f.offset_minutes}-min reminder call to {f.helper_name or f.phone}")
            except Exception as e:  # noqa: BLE001
                attempt.status, attempt.outcome, attempt.error, attempt.ended_at = "ended", "failed", str(e)[:500], utcnow()
                f.status, f.outcome = "done", "failed"
                log_event(db, f.ticket_id, "call_failed", f"Reminder call failed: {e}")
            db.commit()  # as each call is placed: the person may answer before the rest are prepared
        db.commit()
    return placed


def _schedule_retry(db: Session, f: FollowUp, ticket: Ticket) -> None:
    now = utcnow()
    if (not ticket.scheduled_at or now + RETRY_AFTER >= ticket.scheduled_at
            or ticket.assignee_id != f.helper_id or ticket.assignee_phone != f.phone):
        return
    if db.query(FollowUp).filter_by(retry_of=f.id).first():
        return
    db.add(FollowUp(ticket_id=ticket.id, helper_id=f.helper_id, helper_name=f.helper_name, phone=f.phone,
                    offset_minutes=f.offset_minutes, due_at=now + RETRY_AFTER, retry_of=f.id))
    db.flush()  # the "later reminders" check below must see it
    log_event(db, ticket.id, "followup_retry_scheduled",
              f"{f.helper_name or f.phone} did not pick up the {f.offset_minutes}-min reminder; "
              f"calling again in {int(RETRY_AFTER.total_seconds() // 60)} minutes")


def on_call_finished(db: Session, attempt: CallAttempt) -> None:
    from .dispatch import escalate

    f = db.get(FollowUp, attempt.followup_id) if attempt.followup_id else None
    if not f:
        return
    f.status, f.outcome = "done", attempt.outcome
    ticket = db.get(Ticket, f.ticket_id)
    if attempt.outcome == "declined":
        cancel_for_ticket(db, ticket.id)
        escalate(db, ticket, "helper_cannot_attend",
                 f"{f.helper_name or f.phone} said they cannot attend ({f.offset_minutes}-min reminder)."
                 + handoff.note_for(attempt))
        return
    if attempt.outcome == "running_late":  # the helper stays assigned; support is told, no more reminders
        cancel_for_ticket(db, ticket.id)
        eta = handoff.eta_text(handoff.result_of(attempt))
        escalate(db, ticket, "helper_running_late",
                 f"{f.helper_name or f.phone} is running late, arriving ~{eta} (IST)." + handoff.note_for(attempt),
                 keep_status=True)
        return
    if attempt.outcome in RETRY_OUTCOMES and f.retry_of is None and get_settings().followup_retry_no_answer:
        _schedule_retry(db, f, ticket)
    if attempt.outcome != "confirmed":
        later = db.query(FollowUp).filter(FollowUp.ticket_id == ticket.id, FollowUp.status == "scheduled").count()
        if later == 0:
            escalate(db, ticket, "helper_unconfirmed",
                     f"{f.helper_name or f.phone} did not confirm on the last reminder call "
                     f"({attempt.outcome.replace('_', ' ')}).")
