"""What a call says, step by step, for the Voice & IVR page. Built from the same functions the live calls use, so
the preview cannot drift from what a helper or customer really hears."""

from datetime import timedelta

from ..config import get_settings
from ..models import Ticket, utcnow
from . import ivr
from .ivr import Part

PURPOSES = ("dispatch", "followup", "feedback")

OUTCOME_LABELS = {
    "accepted": "Accepts the job", "rejected": "Rejects the job", "confirmed": "Confirms they are coming",
    "declined": "Cannot come", "callback_requested": "Asks to be called back later",
    **{f"rating_{n}": f"Rates {n} star{'s' if n > 1 else ''}" for n in range(1, 6)},
}
HANDOFF_NOTE = ("Nothing is said before the call is bridged to Maya. She greets in her own words (Telugu, Hindi or English) "
                "and records the answer. If she cannot be reached, the call ends with the line shown under this key.")


def sample_ticket() -> Ticket:
    """A made-up job, only ever held in memory."""
    return Ticket(id="sample", title="Deep cleaning", category="Cleaning", city="Hyderabad",
                  address="Flat 302, Sai Residency, Kondapur, Hyderabad, 500084",
                  scheduled_at=utcnow() + timedelta(hours=3), customer_name="Sai", assignee_name="Ravi")


def _prompt(purpose: str, t: Ticket) -> tuple[Part, ...]:
    helper = t.assignee_name or "Ravi"
    if purpose == "dispatch":
        return ivr.dispatch_parts(t, helper)
    if purpose == "followup":
        return ivr.followup_parts(t, helper, 120)
    return ivr.feedback_parts(t, helper)


def steps_of(purpose: str, t: Ticket) -> list[tuple[dict, tuple[Part, ...]]]:
    """Every step a caller can reach, with the parts it speaks."""
    prompt = _prompt(purpose, t)
    handoff_digits = ivr.HANDOFF_DIGITS.get(purpose, set())
    steps: list[tuple[dict, tuple[Part, ...]]] = [
        ({"key": "prompt", "title": "The message", "when": "As soon as the call is answered"}, prompt),
        ({"key": "repeat", "title": "No key pressed",
          "when": f"After {get_wait()} seconds of silence the message plays again, up to {get_settings().ivr_max_prompts} times"},
         (Part(ivr.REPEAT_PREFIX), *prompt)),
        ({"key": "invalid", "title": "A key that is not an option", "when": "Any other key"}, (Part(ivr.INVALID_KEY),)),
    ]
    if handoff_digits:
        steps.append(({"key": "handoff", "title": "Maya takes over", "handoff": True, "note": HANDOFF_NOTE,
                       "when": "Key " + " or ".join(sorted(handoff_digits))}, ()))
    if purpose == "dispatch":
        steps.append(({"key": "star", "title": "Hear the task again", "when": "Key *"},
                      (Part(ivr.REPEAT_PREFIX), *prompt)))
    # One step per result, in the order the keys are offered (1 first); several keys can share a result (0 or 2 = no)
    by_outcome: dict[str, list[str]] = {}
    for digit, outcome in ivr.DIGIT_OUTCOMES[purpose].items():
        by_outcome.setdefault(outcome, []).append(digit)
    for outcome, digits in by_outcome.items():
        fallback = any(d in handoff_digits for d in digits)
        steps.append(({"key": f"after:{outcome}", "title": OUTCOME_LABELS.get(outcome, outcome.replace("_", " ").title()),
                       "when": "Key " + " or ".join(digits) + (" (said only if Maya cannot be reached)" if fallback else "")},
                      ivr.closing_for(t, outcome)))
    steps.append(({"key": "after:no_input", "title": "Nobody pressed anything",
                   "when": f"After the message has played {get_settings().ivr_max_prompts} times"},
                  ivr.closing_for(t, "no_input")))
    return steps


def get_wait() -> int:
    return get_settings().ivr_gather_timeout_seconds


def script(purpose: str, ticket: Ticket | None = None) -> dict:
    t = ticket or sample_ticket()
    handoff_digits = ivr.HANDOFF_DIGITS.get(purpose, set())
    return {
        "purpose": purpose,
        "sample": ticket is None,
        "ticket": {"id": t.id, "title": t.title, "category": t.category} if ticket else None,
        "keys": [{"digit": d, "outcome": o, "label": OUTCOME_LABELS.get(o, o), "handoff": d in handoff_digits}
                 for d, o in ivr.DIGIT_OUTCOMES[purpose].items()]
                + ([{"digit": "*", "outcome": "repeat", "label": "Hear it again", "handoff": False}] if purpose == "dispatch" else []),
        "steps": [{**meta, "handoff": meta.get("handoff", False), "note": meta.get("note"),
                   "parts": [{"text": p.text, "personal": p.personal} for p in parts]} for meta, parts in steps_of(purpose, t)],
    }


def parts_of(purpose: str, step: str, ticket: Ticket | None = None) -> tuple[Part, ...] | None:
    """The parts to play for one step, or None if there is no such step."""
    for meta, parts in steps_of(purpose, ticket or sample_ticket()):
        if meta["key"] == step:
            return parts
    return None
