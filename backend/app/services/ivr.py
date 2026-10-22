"""Provider-independent call logic.

Every call follows the same steps whichever provider runs it:
  answered -> prompt -> (digit | silence -> prompt again) ... -> finish
The task message is played at most IVR_MAX_PROMPTS times; after that the call
hangs up with outcome ``no_input``."""

from dataclasses import dataclass
from datetime import UTC

from sqlalchemy.orm import Session

from ..config import get_settings
from ..integrations.mapping import IST
from ..models import CallAttempt, Ticket, utcnow
from .common import engine_lock, log_event

ACTIVE_STATUSES = ("queued", "ringing", "in_progress")

# Outcomes per digit, by call purpose
DIGIT_OUTCOMES = {
    "dispatch": {"1": "accepted", "2": "rejected"},
    "followup": {"1": "confirmed", "2": "declined"},
}
CLOSING_LINES = {
    "accepted": "Thank you. The task has been assigned to you. You will get reminder calls before it starts. Goodbye.",
    "rejected": "Okay, thank you for your time. Goodbye.",
    "confirmed": "Thank you for confirming. Goodbye.",
    "declined": "Thank you for letting us know. Our support team will contact you. Goodbye.",
    "no_input": "We did not receive any input. Goodbye.",
}


@dataclass
class Step:
    text: str
    hangup: bool = False   # end the call after speaking
    repeat: bool = False   # play the prompt again


def fmt_local(dt) -> str:
    if not dt:
        return "the scheduled time"
    local = dt.replace(tzinfo=UTC).astimezone(IST)
    return local.strftime("%A, %d %B at %I:%M %p").replace(" 0", " ")


def fmt_minutes(m: int) -> str:
    h, mm = divmod(m, 60)
    parts = ([f"{h} hour{'s' if h > 1 else ''}"] if h else []) + ([f"{mm} minutes"] if mm else [])
    return " and ".join(parts) or "a few minutes"


def _where(t: Ticket) -> str:
    if t.address and t.city and t.city.lower() not in t.address.lower():
        return f"{t.address}, {t.city}"
    return t.address or t.city or "the customer location"


def dispatch_script(t: Ticket, helper_name: str | None) -> str:
    s = get_settings()
    pay = (f"You will be paid {int(t.budget) if t.budget == int(t.budget) else t.budget} {s.currency_word} "
           "for this task. ") if t.budget else ""
    return (
        f"Hello {helper_name or 'there'}. This is {s.company_name}. "
        f"We have a new {t.category or 'service'} task for you at {_where(t)}, on {fmt_local(t.scheduled_at)}. "
        f"The task is: {t.title or 'service request'}. {pay}"
        "Press 1 to accept this task. Press 2 to reject it."
    )


def followup_script(t: Ticket, helper_name: str | None, offset_minutes: int) -> str:
    s = get_settings()
    return (
        f"Hello {helper_name or 'there'}. This is a reminder from {s.company_name}. "
        f"Your {t.category or 'service'} task, {t.title or ''}, at {_where(t)} starts in about "
        f"{fmt_minutes(offset_minutes)}, on {fmt_local(t.scheduled_at)}. "
        "Press 1 to confirm you will be there. Press 2 if you cannot attend."
    )


def answered(db: Session, attempt: CallAttempt) -> None:
    if attempt.status in ("queued", "ringing"):
        attempt.status = "in_progress"
        attempt.answered_at = utcnow()
        log_event(db, attempt.ticket_id, "call_answered", f"{attempt.helper_name or attempt.phone} answered")


def next_prompt(db: Session, attempt: CallAttempt) -> Step:
    """Called each time the message should be (re)played."""
    with engine_lock:
        if attempt.outcome:
            return Step(CLOSING_LINES.get(attempt.outcome, "Goodbye."), hangup=True)
        answered(db, attempt)
        max_prompts = get_settings().ivr_max_prompts
        if attempt.prompts_played >= max_prompts:
            finish(db, attempt, "no_input")
            return Step(CLOSING_LINES["no_input"], hangup=True)
        attempt.prompts_played += 1
        prefix = "" if attempt.prompts_played == 1 else "I will repeat the message. "
        return Step(prefix + (attempt.script or ""))


def press(db: Session, attempt: CallAttempt, digit: str) -> Step:
    with engine_lock:
        if attempt.outcome:
            return Step("Goodbye.", hangup=True)
        attempt.digits = (attempt.digits or "") + (digit or "")
        outcome = DIGIT_OUTCOMES[attempt.purpose].get(digit)
        if outcome:
            finish(db, attempt, outcome)
            return Step(CLOSING_LINES[outcome], hangup=True)
        return Step("Sorry, that is not a valid option.", repeat=True)


PROVIDER_END_MAP = {"no-answer": "no_answer", "busy": "busy", "failed": "failed", "canceled": "no_answer"}


def ended(db: Session, attempt: CallAttempt, provider_status: str, error: str | None = None) -> None:
    """The call is over on the provider side. Records an outcome if the IVR did not."""
    with engine_lock:
        if attempt.status != "ended":
            attempt.status = "ended"
            attempt.ended_at = attempt.ended_at or utcnow()
        if attempt.outcome:
            return
        if error:
            attempt.error = error[:500]
        outcome = PROVIDER_END_MAP.get(provider_status)
        if outcome is None:  # "completed" without a digit
            outcome = "hung_up" if attempt.answered_at else "no_answer"
        finish(db, attempt, outcome)


def finish(db: Session, attempt: CallAttempt, outcome: str) -> None:
    if attempt.outcome:
        return
    attempt.outcome = outcome
    attempt.status = "ended"
    attempt.ended_at = utcnow()
    log_event(db, attempt.ticket_id, f"call_{outcome}",
              f"{attempt.purpose.title()} call to {attempt.helper_name or attempt.phone}: {outcome.replace('_', ' ')}")
    db.flush()
    if attempt.purpose == "dispatch":
        from .dispatch import on_call_finished
    else:
        from .followups import on_call_finished
    on_call_finished(db, attempt)
