"""Provider-independent call logic.

Every call follows the same steps whichever provider runs it:
  answered -> prompt -> (digit | silence -> prompt again) ... -> finish
The task message is played at most IVR_MAX_PROMPTS times; after that the call
hangs up with outcome ``no_input``.

Everything the caller hears is Telugu, built from ``Part``s: a fixed part is the same on every
call (its audio is generated once and reused), a personal part holds a name, area, time or address
(its audio is generated per call and deleted afterwards)."""

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from ..config import get_settings
from ..integrations.mapping import INDIAN_STATES, IST
from ..models import CallAttempt, FollowUp, Ticket, utcnow
from .common import engine_lock, log_event

ACTIVE_STATUSES = ("queued", "ringing", "in_progress", "handoff")

# Outcomes per digit, by call purpose
DIGIT_OUTCOMES = {
    "dispatch": {"1": "accepted", "0": "rejected", "2": "rejected"},
    "followup": {"1": "confirmed", "0": "declined", "2": "declined"},
    "feedback": {
        "1": "rating_1",
        "2": "rating_2",
        "3": "rating_3",
        "4": "rating_4",
        "5": "rating_5",
        "9": "callback_requested",
    },
}

# The only keys that bring in the voice agent, by call purpose
HANDOFF_DIGITS = {"followup": {"2"}, "feedback": {"1", "2"}}

# Recorded on a call that was handed to the voice agent and ended without a result from it.
HANDOFF_NO_RESULT = "voice agent recorded nothing"

GOODBYE = "ధన్యవాదాలు. Bye."
REPEAT_PREFIX = "మళ్ళీ చెబుతాను."
INVALID_KEY = "క్షమించండి, ఆ option సరైనది కాదు."
INBOUND_LINE = "ఈ number నుండి మేమే మీకు call చేస్తాం. ధన్యవాదాలు."
ACCEPTED_OUTRO = "Task start అవ్వడానికి ముందు మేము reminder call చేస్తాం. ధన్యవాదాలు."
NO_AREA = "customer ఉన్న ప్రాంతం"
NO_ADDRESS = "address ఇంకా అందుబాటులో లేదు, మా support team మీకు చెబుతారు"
NO_TIME = "షెడ్యూల్ చేసిన time కి"
CLOSING_LINES = {
    "accepted": "అద్భుతం! ఈ task మీకు assign అయింది. Address చెబుతాను, వినండి.",
    "rejected": "సరే, ధన్యవాదాలు. Bye.",
    "confirmed": "Confirm చేసినందుకు ధన్యవాదాలు. Bye.",
    "declined": "సరే, తెలియజేసినందుకు ధన్యవాదాలు. మా support team మీకు call చేస్తుంది. Bye.",
    "rating_5": "5 star rating ఇచ్చినందుకు చాలా ధన్యవాదాలు! మీ అనుభవం బాగున్నందుకు సంతోషం. Bye.",
    "rating_4": "4 star rating ఇచ్చినందుకు ధన్యవాదాలు! మీ feedback మాకు ముఖ్యం. Bye.",
    "rating_3": "Rating ఇచ్చినందుకు ధన్యవాదాలు. తర్వాతి సారి ఇంకా బాగా సేవ చేస్తాం. Bye.",
    "rating_2": "మీ అనుభవం బాగోలేనందుకు క్షమించండి. మా support executive మీకు call చేస్తారు. Bye.",
    "rating_1": "మీకు ఇబ్బంది కలిగినందుకు క్షమించండి. మా team త్వరలో మీకు call చేస్తుంది. Bye.",
    "callback_requested": "సరే, కొంచెం సేపటి తర్వాత మళ్ళీ call చేస్తాం. ధన్యవాదాలు. Bye.",
    "running_late": "సరే, మీరు వస్తున్నారని మా support team కి చెబుతాం. జాగ్రత్తగా రండి. ధన్యవాదాలు. Bye.",
    "no_input": "మీ నుండి ఏ response రాలేదు. ధన్యవాదాలు. Bye.",
}
MONTHS_TE = ("జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్",
             "జులై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్")


@dataclass(frozen=True)
class Part:
    text: str
    personal: bool = False  # holds a name, area, time or address


def join(parts) -> str:
    return " ".join(p.text for p in parts)


@dataclass
class Step:
    parts: tuple[Part, ...]
    hangup: bool = False   # end the call after speaking
    repeat: bool = False   # play the prompt again
    handoff: bool = False  # connect the call to the voice agent after speaking

    @property
    def text(self) -> str:
        return join(self.parts)


def when_te(dt: datetime | None, now: datetime | None = None) -> str:
    """'రేపు మధ్యాహ్నం 3 గంటలకు': day, part of day and time in IST. ``dt`` is naive UTC; ``now`` is for tests."""
    if not dt:
        return NO_TIME
    local = dt.replace(tzinfo=UTC).astimezone(IST)
    today = (now or datetime.now(IST)).astimezone(IST).date()
    days = (local.date() - today).days
    day = "ఈరోజు" if days == 0 else "రేపు" if days == 1 else f"{local.day} {MONTHS_TE[local.month - 1]}"
    hour = local.hour
    part = "ఉదయం" if 5 <= hour < 12 else "మధ్యాహ్నం" if 12 <= hour < 16 else "సాయంత్రం" if 16 <= hour < 19 else "రాత్రి"
    h12 = hour % 12 or 12
    clock = f"{h12} గంటలకు" if local.minute == 0 else f"{h12}:{local.minute:02d} కి"
    return f"{day} {part} {clock}"


def minutes_te(m: int) -> str:
    h, mm = divmod(max(m, 0), 60)
    parts = ([f"{h} గంట" + ("లు" if h > 1 else "")] if h else []) + ([f"{mm} నిమిషాలు"] if mm else [])
    return " ".join(parts) or "కొన్ని నిమిషాలు"


_PINCODE = re.compile(r"\b\d{6}\b")
_PHONE = re.compile(r"\+?\d(?:[\s-]?\d){7,}")  # eight or more digits, with at most a space or hyphen between them
_NOT_AN_AREA = INDIAN_STATES | {"india"}


def area_of(t: Ticket) -> str:
    """The neighbourhood only: the last address part that is neither the city nor a house/number/pincode.
    An address that cannot be split that way (one line with a flat number) falls back to the city."""
    city = (t.city or "").strip().casefold()
    for raw in reversed((t.address or "").split(",")):
        piece = re.sub(r"\s+", " ", _PINCODE.sub("", raw)).strip()
        if (piece and piece.casefold() != city and piece.casefold() not in _NOT_AN_AREA
                and not any(ch.isdigit() for ch in piece)):
            return piece
    return t.city or NO_AREA


def _where(t: Ticket | None) -> str:
    """The full address, read out only after the helper accepts."""
    if not t:
        return NO_ADDRESS
    # An address line that holds a phone number is dropped: nobody's number is ever read out.
    address = ", ".join(p.strip() for p in (t.address or "").split(",") if p.strip() and not _PHONE.search(p))
    if address and t.city and t.city.lower() not in address.lower():
        return f"{address}, {t.city}"
    return address or t.city or NO_ADDRESS


def _hello(name: str | None) -> Part:
    return Part(f"నమస్కారం {name}!", personal=True) if name else Part("నమస్కారం!")


def dispatch_parts(t: Ticket, helper_name: str | None) -> tuple[Part, ...]:
    """The job offer: service, area, price and time."""
    budget_part = f", ధర {int(t.budget)} రూపాయలు" if t.budget and t.budget > 0 else ""
    return (
        _hello(helper_name),
        Part(f"{get_settings().company_name} నుండి call చేస్తున్నాం. మీకోసం ఒక కొత్త task ఉంది."),
        Part(f"{t.category or 'service'} పని, {area_of(t)} లో{budget_part}, {when_te(t.scheduled_at)}.", personal=True),
        Part("Task accept చేయడానికి 1 నొక్కండి, వద్దనుకుంటే 0 నొక్కండి, మళ్ళీ వినడానికి స్టార్ నొక్కండి."),
    )


def followup_parts(t: Ticket, helper_name: str | None, minutes_left: int) -> tuple[Part, ...]:
    return (
        _hello(helper_name),
        Part(f"{get_settings().company_name} నుండి reminder call. "
             f"మీ task start అవ్వడానికి ఇంకా {minutes_te(minutes_left)} ఉంది."),
        Part(f"{t.category or 'service'} పని, {area_of(t)} లో, {when_te(t.scheduled_at)}.", personal=True),
        Part("Confirm చేయడానికి 1 నొక్కండి. రాలేకపోతే 2 నొక్కండి."),
    )


def feedback_parts(t: Ticket, helper_name: str | None) -> tuple[Part, ...]:
    helper = helper_name or t.assignee_name or "మా ExtraHand partner"
    return (
        _hello(t.customer_name),
        Part(f"{get_settings().company_name} customer care నుండి call చేస్తున్నాం."),
        Part(f"Helper {helper} చేసిన {t.title or t.category or 'service'} సర్వీస్ మీకు ఎలా అనిపించింది?", personal=True),
        Part("1 నుండి 5 వరకు rating ఇవ్వండి. 5 అంటే చాలా బాగుంది, 1 అంటే నచ్చలేదు. "
             "తర్వాత call చేయమంటే 9 నొక్కండి."),
    )


def reminder_minutes(f: FollowUp | None, t: Ticket) -> int:
    """Minutes before the task that a reminder speaks of: its offset, or for a retry what is really left at the
    time it is dialled (its due time is when it will be placed)."""
    if f is None:
        return 0
    if f.retry_of and t.scheduled_at:
        return max(0, int((t.scheduled_at - f.due_at).total_seconds() // 60))
    return f.offset_minutes


def prompt_parts(db: Session, attempt: CallAttempt) -> tuple[Part, ...]:
    t = db.get(Ticket, attempt.ticket_id)
    if attempt.purpose == "dispatch":
        return dispatch_parts(t, attempt.helper_name)
    if attempt.purpose == "followup":
        f = db.get(FollowUp, attempt.followup_id) if attempt.followup_id else None
        return followup_parts(t, attempt.helper_name, reminder_minutes(f, t))
    if attempt.purpose == "feedback":
        return feedback_parts(t, attempt.helper_name)
    return (Part(attempt.script or "", personal=True),)  # unknown purpose: never cache it as shared audio


def closing_for(t: Ticket | None, outcome: str) -> tuple[Part, ...]:
    """What is said when the call ends with this outcome. After accepting, the helper hears the address."""
    if outcome == "accepted":
        return (Part(CLOSING_LINES["accepted"]), Part(_where(t), personal=True), Part(ACCEPTED_OUTRO))
    return (Part(CLOSING_LINES.get(outcome, GOODBYE)),)


def closing_parts(db: Session, attempt: CallAttempt, outcome: str) -> tuple[Part, ...]:
    return closing_for(db.get(Ticket, attempt.ticket_id), outcome)


def all_parts(db: Session, attempt: CallAttempt) -> tuple[Part, ...]:
    """Everything this call might say, so its audio can be made before dialling."""
    outcomes = [*DIGIT_OUTCOMES.get(attempt.purpose, {}).values(), "no_input"]
    parts = [*prompt_parts(db, attempt), Part(REPEAT_PREFIX), Part(INVALID_KEY), Part(GOODBYE)]
    parts += [p for o in outcomes for p in closing_parts(db, attempt, o)]
    return tuple(dict.fromkeys(parts))


def dispatch_script(t: Ticket, helper_name: str | None) -> str:
    return join(dispatch_parts(t, helper_name))


def followup_script(t: Ticket, helper_name: str | None, offset_minutes: int) -> str:
    return join(followup_parts(t, helper_name, offset_minutes))


MAX_TIMELINE = 60  # entries kept per call; a call of three prompts and a hand-off uses about a dozen


def note(attempt: CallAttempt, event: str, detail: str | None = None) -> None:
    """Adds one entry to the call's trail (what the call detail page shows). Never raises: a damaged trail is
    replaced rather than stopping a live call."""
    try:
        items = json.loads(attempt.timeline) if attempt.timeline else []
        if not isinstance(items, list):
            items = []
    except ValueError:
        items = []
    entry = {"t": utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z", "event": event}
    if detail:
        entry["detail"] = detail
    attempt.timeline = json.dumps([*items, entry][-MAX_TIMELINE:], ensure_ascii=False)


def answered(db: Session, attempt: CallAttempt) -> None:
    if attempt.status in ("queued", "ringing"):
        attempt.status = "in_progress"
        attempt.answered_at = utcnow()
        note(attempt, "answered")
        log_event(db, attempt.ticket_id, "call_answered", f"{attempt.helper_name or attempt.phone} answered")


def _fresh(db: Session, attempt: CallAttempt) -> None:
    """Re-reads the call from the database. A request may have loaded it before another request finished it; every
    state change commits while holding engine_lock, so what is read after taking the lock is current."""
    db.flush()  # this request's own pending changes are kept
    db.refresh(attempt)


def next_prompt(db: Session, attempt: CallAttempt) -> Step:
    """Called each time the message should be (re)played."""
    with engine_lock:
        _fresh(db, attempt)
        if attempt.outcome:
            return Step(closing_parts(db, attempt, attempt.outcome), hangup=True)
        answered(db, attempt)
        max_prompts = get_settings().ivr_max_prompts
        if attempt.prompts_played >= max_prompts:
            finish(db, attempt, "no_input")
            return Step(closing_parts(db, attempt, "no_input"), hangup=True)
        attempt.prompts_played += 1
        note(attempt, "prompt", f"{attempt.prompts_played} of {max_prompts}")
        parts = prompt_parts(db, attempt)
        if attempt.prompts_played > 1:
            parts = (Part(REPEAT_PREFIX), *parts)
        return Step(parts)


def press(db: Session, attempt: CallAttempt, digit: str, *, can_handoff: bool = False) -> Step:
    with engine_lock:
        _fresh(db, attempt)
        if attempt.outcome:
            return Step((Part(GOODBYE),), hangup=True)
        if attempt.status == "handoff":  # a repeated delivery: still with the voice agent, nothing new to record
            return Step((), handoff=True)
        attempt.digits = (attempt.digits or "") + (digit or "")

        # Key '*' repeats the task offer announcement
        if digit == "*":
            note(attempt, "key", "* (repeat)")
            parts = prompt_parts(db, attempt)
            return Step((Part(REPEAT_PREFIX), *parts), repeat=False)

        option = digit in DIGIT_OUTCOMES.get(attempt.purpose, {})
        note(attempt, "key", digit if option else f"{digit} (not an option)")
        if can_handoff and digit in HANDOFF_DIGITS.get(attempt.purpose, ()):
            attempt.status = "handoff"
            note(attempt, "handoff_started")
            return Step((), handoff=True)  # bridged at once: a spoken "please hold" is a file to download before the agent
        outcome = DIGIT_OUTCOMES[attempt.purpose].get(digit)
        if outcome:
            finish(db, attempt, outcome)
            return Step(closing_parts(db, attempt, outcome), hangup=True)
        return Step((Part(INVALID_KEY),), repeat=True)


def _handoff_outcome(attempt: CallAttempt) -> str:
    """What the key that started a hand-off means on its own: the outcome when the voice agent recorded nothing."""
    return DIGIT_OUTCOMES.get(attempt.purpose, {}).get((attempt.digits or "")[-1:]) or "hung_up"


def handoff_fallback(db: Session, attempt: CallAttempt, detail: str | None = None) -> Step:
    """The voice agent could not be reached or recorded nothing: finish as if the key had not handed off.
    ``detail`` is what the phone provider said about the bridge (kept in the call's trail)."""
    with engine_lock:
        _fresh(db, attempt)
        if not attempt.outcome:
            attempt.error = attempt.error or HANDOFF_NO_RESULT
            note(attempt, "handoff_failed", detail)
            finish(db, attempt, _handoff_outcome(attempt))
        return Step(closing_parts(db, attempt, attempt.outcome), hangup=True)


PROVIDER_END_MAP = {"no-answer": "no_answer", "busy": "busy", "failed": "failed", "canceled": "no_answer"}


def ended(db: Session, attempt: CallAttempt, provider_status: str, error: str | None = None,
          duration: int | None = None) -> None:
    """The call is over on the provider side. Records an outcome if the IVR did not, and how long the call lasted:
    the provider's figure when it gave one, otherwise the time from answer to now."""
    with engine_lock:
        _fresh(db, attempt)
        was_handoff = attempt.status == "handoff"
        if attempt.status != "ended":
            attempt.status = "ended"
            attempt.ended_at = attempt.ended_at or utcnow()
        if '"hangup"' not in (attempt.timeline or ""):  # the provider may deliver the same hangup twice
            if duration is None:
                duration = max(0, int((utcnow() - attempt.answered_at).total_seconds())) if attempt.answered_at else 0
            attempt.duration_seconds = duration
            note(attempt, "hangup", f"{provider_status}, {duration} s")
        if attempt.outcome:
            return
        if error:
            attempt.error = error[:500]
        if was_handoff:  # the call ended while with the voice agent and it recorded nothing
            attempt.error = attempt.error or HANDOFF_NO_RESULT
            outcome = _handoff_outcome(attempt)
        else:
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
    note(attempt, "outcome", outcome)
    log_event(db, attempt.ticket_id, f"call_{outcome}",
              f"{attempt.purpose.title()} call to {attempt.helper_name or attempt.phone}: {outcome.replace('_', ' ')}")
    db.flush()
    if attempt.purpose == "dispatch":
        from .dispatch import on_call_finished
    elif attempt.purpose == "feedback":
        from .feedback_agent import on_feedback_call_finished as on_call_finished
    else:
        from .followups import on_call_finished
    on_call_finished(db, attempt)
