"""Webhooks Vobiz calls during an IVR call (see telephony/vobiz.py).

Each handler reads the request on the event loop and does the rest in a worker thread: the work waits on
``engine_lock``, uses the database and may call Sarvam, and none of that may stall the other calls."""

import hmac
import logging
from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..database import get_db
from ..models import CallAttempt
from ..services import handoff, ivr, tts_audio
from ..services.common import engine_lock, log_event
from ..telephony import vobiz

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/telephony/vobiz", tags=["vobiz"])


def _xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


async def _params(request: Request) -> dict[str, str]:
    """Vobiz posts form fields; JSON is accepted too."""
    if "json" in request.headers.get("content-type", ""):
        try:
            data = await request.json()
        except ValueError:
            return {}
        return {k: str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    return {k: str(v) for k, v in (await request.form()).items()}


def _check_signature(request: Request) -> None:
    s = get_settings()
    if not s.vobiz_validate_signature:
        return
    # Vobiz signs the callback's own base URL (our public URL), not the one this server sees.
    from ..config import public_base_url

    public = public_base_url() + request.url.path
    if not vobiz.verify_signature(public, request.headers, s.vobiz_auth_token):
        raise HTTPException(403, "Invalid Vobiz signature")


def _verified(request: Request, db: Session, params: dict[str, str]) -> CallAttempt:
    """A callback is accepted only if it carries Vobiz's signature, this call's own token, and this call's own id."""
    if not get_settings().vobiz_auth_token:
        raise HTTPException(503, "Vobiz is not configured")
    _check_signature(request)
    try:
        attempt_id = int(request.query_params.get("attempt_id", 0))
    except ValueError:
        raise HTTPException(404, "Unknown call") from None
    if not hmac.compare_digest(request.query_params.get("t", ""), vobiz.callback_token(attempt_id)):
        raise HTTPException(403, "Invalid call token")
    attempt = db.get(CallAttempt, attempt_id)
    if not attempt or attempt.provider != "vobiz":
        raise HTTPException(404, "Unknown call")
    # The call's own id must be among the ids the callback names: CallUUID, or for a <Dial> callback the A-leg id.
    named = [v for v in (params.get("CallUUID", ""), params.get("DialALegUUID", "")) if v]
    if named and (not all(vobiz.is_call_id(v) for v in named)
                  or (attempt.provider_call_id and attempt.provider_call_id not in named)):
        log.warning("call %s: callback names call ids %r, expected %r", attempt.id, [v[:80] for v in named],
                    attempt.provider_call_id)
        raise HTTPException(403, "Call id mismatch")
    return attempt


async def _handle(request: Request, db: Session, work: Callable[[Session, CallAttempt, dict[str, str]], Response]) -> Response:
    """Reads the callback, then verifies it and does ``work`` off the event loop."""
    params = await _params(request)
    return await run_in_threadpool(lambda: work(db, _verified(request, db, params), params))


def _render(step: ivr.Step, attempt: CallAttempt) -> Response:
    try:
        # One file per message: separate <Play>s are fetched one by one, which is where the pauses came from.
        urls = [tts_audio.url_for(tts_audio.merge(attempt.id, step.parts))] if step.parts else []
    except tts_audio.AudioError as e:
        log.error("call %s: could not make Telugu audio, hanging up: %s", attempt.id, e)
        return _xml(vobiz.xml("<Hangup/>"))
    if step.handoff:
        return _xml(vobiz.dial_handoff(
            urls, handoff.sip_uri_for(attempt.id),
            {"Attempt": str(attempt.id), "Token": handoff.token_for(attempt.id)},
            vobiz.callback_url("handoff-done", attempt.id), get_settings().handoff_time_limit_seconds))
    if step.hangup:
        return _xml(vobiz.play_and_hangup(urls))
    if step.repeat:
        return _xml(vobiz.play_and_redirect(urls, vobiz.callback_url("answer", attempt.id)))
    return _xml(vobiz.gather(urls, vobiz.callback_url("gather", attempt.id), vobiz.callback_url("answer", attempt.id)))


def _answer(db: Session, attempt: CallAttempt, form: dict[str, str]) -> Response:
    if form.get("CallUUID") and not attempt.provider_call_id:  # already checked to be a UUID; never replaced once set
        attempt.provider_call_id = form["CallUUID"]
    with engine_lock:  # the state change and its commit are one step, so the next request sees it
        step = ivr.next_prompt(db, attempt)
        db.commit()
    return _render(step, attempt)


def _gather(db: Session, attempt: CallAttempt, form: dict[str, str]) -> Response:
    digit = (form.get("Digits") or "")[:1]
    with engine_lock:
        if not digit:
            ivr.note(attempt, "silence")
        # Vobiz also posts the action URL, with no digits, when the wait runs out: that is silence, not a wrong key.
        step = (ivr.press(db, attempt, digit, can_handoff=handoff.enabled()) if digit else ivr.next_prompt(db, attempt))
        db.commit()
    return _render(step, attempt)


def _handoff_done(db: Session, attempt: CallAttempt, form: dict[str, str]) -> Response:
    with engine_lock:
        db.refresh(attempt)  # another request may have recorded the agent's result since this one loaded the call
        if attempt.outcome or attempt.status != "handoff":
            return _xml(vobiz.xml("<Hangup/>"))
        dial = " ".join(v for v in (form.get("DialStatus"), form.get("DialHangupCause") or form.get("DialBLegHangupCauseName")) if v)
        step = handoff.fallback(db, attempt, dial or None)
        db.commit()
    return _render(step, attempt)


def _seconds(value: str | None) -> int | None:
    try:
        seconds = int(float(value or ""))
    except ValueError:
        return None
    return seconds if seconds >= 0 else None


def _hangup(db: Session, attempt: CallAttempt, form: dict[str, str]) -> Response:
    status = vobiz.provider_status(form)
    with engine_lock:
        error = (form.get("HangupCauseName") or form.get("HangupCause")) if status == "failed" else None
        ivr.ended(db, attempt, status, error=error, duration=_seconds(form.get("Duration")))
        if form.get("Duration"):
            log_event(db, attempt.ticket_id, "call_ended",
                      f"Call with {attempt.helper_name or attempt.phone} lasted {form['Duration']}s")
        db.commit()
    tts_audio.purge(attempt.id)
    return JSONResponse({"status": "received"})


def _inbound(request: Request) -> Response:
    _check_signature(request)
    try:
        url = tts_audio.url_for(tts_audio.ensure(0, ivr.Part(ivr.INBOUND_LINE)))
    except tts_audio.AudioError as e:
        log.error("inbound call: could not make Telugu audio: %s", e)
        return _xml(vobiz.xml("<Hangup/>"))
    return _xml(vobiz.play_and_hangup([url]))


@router.post("/answer")
async def answer(request: Request, db: Session = Depends(get_db)):
    """Answered, or no key arrived in time: (re)play the message."""
    return await _handle(request, db, _answer)


@router.post("/gather")
async def gather_digit(request: Request, db: Session = Depends(get_db)):
    return await _handle(request, db, _gather)


@router.post("/handoff-done")
async def handoff_done(request: Request, db: Session = Depends(get_db)):
    """The bridge to the voice agent ended. If the agent recorded a result there is nothing left to do; if not
    (it could not be reached, or said nothing) the call ends as it would have without a hand-off."""
    return await _handle(request, db, _handoff_done)


@router.post("/hangup")
async def hangup(request: Request, db: Session = Depends(get_db)):
    return await _handle(request, db, _hangup)


@router.post("/inbound")
async def inbound(request: Request):
    """Someone called the IVR number back: say we will call them, and hang up."""
    return await run_in_threadpool(_inbound, request)
