"""Webhooks Twilio calls during a helper call (see telephony/twilio.py)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import CallAttempt
from ..services import ivr
from ..services.common import engine_lock, log_event
from ..telephony.twilio import gather, say_and_hangup, say_and_redirect, valid_signature

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/telephony/twilio", tags=["twilio"])


def _xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


def _url(path: str, attempt_id: int) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/api/telephony/twilio/{path}?attempt_id={attempt_id}"


async def _verified(request: Request, db: Session) -> tuple[CallAttempt, dict]:
    form = {k: str(v) for k, v in (await request.form()).items()}
    # Twilio signs the exact URL it requested, which is our public URL
    public = get_settings().public_base_url.rstrip("/") + request.url.path
    if request.url.query:
        public += "?" + request.url.query
    if not valid_signature(public, form, request.headers.get("X-Twilio-Signature")):
        raise HTTPException(403, "Invalid Twilio signature")
    attempt = db.get(CallAttempt, int(request.query_params.get("attempt_id", 0)))
    if not attempt:
        raise HTTPException(404, "Unknown call")
    return attempt, form


def _render(step: ivr.Step, attempt_id: int) -> Response:
    if step.hangup:
        return _xml(say_and_hangup(step.text))
    if step.repeat:
        return _xml(say_and_redirect(step.text, _url("voice", attempt_id)))
    return _xml(gather(step.text, _url("gather", attempt_id), _url("voice", attempt_id)))


@router.post("/voice")
async def voice(request: Request, db: Session = Depends(get_db)):
    """Answered, or no digit arrived in time: (re)play the message."""
    attempt, _ = await _verified(request, db)
    step = ivr.next_prompt(db, attempt)
    db.commit()
    return _render(step, attempt.id)


@router.post("/gather")
async def gather_digit(request: Request, db: Session = Depends(get_db)):
    attempt, form = await _verified(request, db)
    step = ivr.press(db, attempt, form.get("Digits", "")[:1])
    db.commit()
    return _render(step, attempt.id)


@router.post("/status")
async def status(request: Request, db: Session = Depends(get_db)):
    attempt, form = await _verified(request, db)
    call_status = form.get("CallStatus", "")
    with engine_lock:
        if call_status == "ringing" and attempt.status == "queued":
            attempt.status = "ringing"
        elif call_status == "in-progress":
            ivr.answered(db, attempt)
        elif call_status in ("completed", "busy", "no-answer", "failed", "canceled"):
            err = form.get("ErrorMessage") or (f"SIP {form['SipResponseCode']}" if call_status == "failed"
                                               and form.get("SipResponseCode") else None)
            ivr.ended(db, attempt, call_status, error=err)
            if form.get("CallDuration"):
                log_event(db, attempt.ticket_id, "call_ended",
                          f"Call with {attempt.helper_name or attempt.phone} lasted {form['CallDuration']}s")
        db.commit()
    return Response(status_code=204)
