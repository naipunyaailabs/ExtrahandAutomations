"""Hand-off of a live IVR call to the voice agent.

Two cases only (``ivr.HANDOFF_DIGITS``): a helper pressing 2 on a reminder ("can't make it") and a customer
rating 1 or 2 stars. Vobiz bridges the call to a LiveKit SIP number; the agent (a separate LiveKit agent in
Maya's voice) reads the call's context here and posts what it learned back. If it cannot be reached, or records
nothing, the call ends as it would have without a hand-off."""

import hashlib
import hmac
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from ..config import get_settings
from ..integrations.mapping import IST
from ..models import CallAttempt, Ticket, utcnow
from . import ivr


class ReminderResult(BaseModel):
    kind: Literal["reminder"] = "reminder"
    decision: Literal["cannot_come", "running_late"]
    reason: str = Field("", max_length=500)
    eta_minutes: int | None = Field(None, ge=1, le=600)  # running late: minutes from now until the helper arrives
    summary: str = Field(max_length=1000)
    transcript: str | None = Field(None, max_length=20000)

    @model_validator(mode="after")
    def _running_late_needs_an_eta(self):
        if self.decision == "running_late" and self.eta_minutes is None:
            raise ValueError("eta_minutes is required when the helper is running late")
        return self


class RatingResult(BaseModel):
    kind: Literal["rating"] = "rating"
    complaint_category: Literal["late_arrival", "poor_service", "incomplete_work", "overcharging", "rude_behavior", "other"]
    details: str = Field(max_length=1000)
    summary: str = Field(max_length=1000)
    transcript: str | None = Field(None, max_length=20000)


def enabled() -> bool:
    """Hand-off needs both the LiveKit SIP address and the secret that signs its tokens."""
    s = get_settings()
    return bool(s.handoff_sip_uri and s.handoff_secret)


def token_for(attempt_id: int) -> str:
    """What the agent presents to read a call's context and post its result."""
    key = get_settings().handoff_secret.encode()
    return hmac.new(key, f"handoff|{int(attempt_id)}".encode(), hashlib.sha256).hexdigest()[:40]


def valid_token(attempt_id: int, token: str) -> bool:
    return bool(get_settings().handoff_secret) and hmac.compare_digest(token or "", token_for(attempt_id))


def check(attempt: CallAttempt, token: str) -> bool:
    """The token is good only while the call is actually waiting for the agent."""
    return attempt.status == "handoff" and valid_token(attempt.id, token)


def sip_uri_for(attempt_id: int) -> str:
    """The configured SIP address with its user part replaced by ``ivr-<attempt>-<token>``. The same two values also
    travel as SIP headers; the user part is the channel that does not depend on how the trunk maps headers."""
    match = re.match(r"^(sips?):(?:[^@]*@)?(.+)$", get_settings().handoff_sip_uri.strip())
    scheme, host = match.groups() if match else ("sip", get_settings().handoff_sip_uri.strip())
    return f"{scheme}:ivr-{int(attempt_id)}-{token_for(attempt_id)}@{host}"


def context(db: Session, attempt: CallAttempt) -> dict:
    """What the agent may know about the call: no phone numbers and no address."""
    t = db.get(Ticket, attempt.ticket_id)
    ctx = {
        "attempt_id": attempt.id, "purpose": attempt.purpose, "helper_name": attempt.helper_name,
        # The category only, never the free-text title: it can hold anything, even a phone number.
        "service": t.category or "service", "area": ivr.area_of(t), "when": ivr.when_te(t.scheduled_at),
    }
    if attempt.purpose == "feedback":
        ctx["customer_name"] = attempt.customer_name or t.customer_name
        ctx["rating"] = int((attempt.digits or "0")[-1:] or 0)
    return ctx


def apply_result(db: Session, attempt: CallAttempt, result: ReminderResult | RatingResult) -> None:
    """Stores what the agent recorded and finishes the call with the matching outcome. ValueError if the result
    is for the other kind of call."""
    data = result.model_dump()
    if isinstance(result, ReminderResult):
        if attempt.purpose != "followup":
            raise ValueError("a reminder result cannot be recorded on a feedback call")
        if result.decision == "running_late":
            data["eta_at"] = (utcnow() + timedelta(minutes=result.eta_minutes)).isoformat()
            outcome = "running_late"
        else:
            outcome = "declined"
    else:
        if attempt.purpose != "feedback":
            raise ValueError("a rating result cannot be recorded on a reminder call")
        outcome = ivr.DIGIT_OUTCOMES["feedback"].get((attempt.digits or "")[-1:]) or "hung_up"
    attempt.handoff_json = json.dumps(data, ensure_ascii=False)
    ivr.note(attempt, "handoff_result", result.decision if isinstance(result, ReminderResult) else result.complaint_category)
    attempt.summary = result.summary
    if result.transcript:
        attempt.transcript = result.transcript
    ivr.finish(db, attempt, outcome)


def fallback(db: Session, attempt: CallAttempt, detail: str | None = None) -> ivr.Step:
    """The agent could not be reached or recorded nothing: end the call as if no hand-off had happened."""
    return ivr.handoff_fallback(db, attempt, detail)


def result_of(attempt: CallAttempt) -> dict | None:
    """What the agent recorded, if anything."""
    try:
        data = json.loads(attempt.handoff_json) if attempt.handoff_json else None
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def note_for(attempt: CallAttempt) -> str:
    """' Maya: <reason> <summary>' for an alert, or '' when the agent recorded nothing."""
    info = result_of(attempt) or {}
    said = " ".join(p.strip() for p in (info.get("reason"), info.get("summary")) if p)
    if said:
        return f" Maya: {said}"
    if attempt.error == ivr.HANDOFF_NO_RESULT:
        return " (The call ended before Maya recorded an answer, so this is the keypad answer only.)"
    return ""


def eta_text(info: dict | None) -> str:
    """The helper's expected arrival as HH:MM in IST."""
    eta_at = (info or {}).get("eta_at")
    if not eta_at:
        return "soon"
    return datetime.fromisoformat(eta_at).replace(tzinfo=UTC).astimezone(IST).strftime("%H:%M")
