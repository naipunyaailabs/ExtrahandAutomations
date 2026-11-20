"""The Voice & IVR page: is the setup sound, what does each call say, and how does it sound."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import Ticket
from ..services import readiness, tts_audio, voice_checks, voice_preview
from ..services.followups import RETRY_AFTER

router = APIRouter(prefix="/api/voice", tags=["voice"])

Purpose = Literal["dispatch", "followup", "feedback"]


def _audio_store() -> dict:
    folder = tts_audio._dir()
    sizes = [p.stat().st_size for p in folder.glob("*.wav")] if folder.is_dir() else []
    return {"files": len(sizes), "megabytes": round(sum(sizes) / 1_000_000, 2)}


@router.get("/status")
def status():
    s = get_settings()
    checks = readiness.static_checks(s)
    summary = {k: sum(1 for c in checks if c.status == k) for k in ("ok", "warn", "fail", "info")}
    from ..config import public_base_url

    base = public_base_url()
    return {
        "environment": s.app_env,
        "provider": s.telephony_provider,
        "ready": summary["fail"] == 0,
        "summary": summary,
        "checks": [c.as_dict() for c in checks],
        "timing": {
            "max_prompts": s.ivr_max_prompts, "key_wait_seconds": s.ivr_gather_timeout_seconds,
            "ring_seconds": s.call_ring_timeout_seconds, "handoff_limit_seconds": s.handoff_time_limit_seconds,
            "handoff_ring_seconds": s.handoff_ring_timeout_seconds,
            "retry_after_minutes": int(RETRY_AFTER.total_seconds() // 60),
        },
        "audio": _audio_store(),
        # What to enter in the Vobiz console for the IVR number.
        "urls": {"inbound": f"{base}/api/telephony/vobiz/inbound", "answer": f"{base}/api/telephony/vobiz/answer",
                 "hangup": f"{base}/api/telephony/vobiz/hangup"} if base else None,
    }


@router.post("/checks")
def live_checks():
    """Asks Vobiz, Sarvam and this server's own public address; takes a few seconds."""
    return {"checks": [c.as_dict() for c in voice_checks.run_live_checks(get_settings())]}


def _ticket(db: Session, ticket_id: str | None) -> Ticket | None:
    if not ticket_id:
        return None
    t = db.get(Ticket, ticket_id)
    if not t:
        raise HTTPException(404, "Unknown ticket")
    return t


@router.get("/scripts")
def scripts(purpose: Purpose, ticket_id: str | None = None, db: Session = Depends(get_db)):
    return voice_preview.script(purpose, _ticket(db, ticket_id))


@router.get("/preview")
def preview(purpose: Purpose, step: str, ticket_id: str | None = None, db: Session = Depends(get_db)):
    """One step as the caller would hear it: a single WAV file."""
    parts = voice_preview.parts_of(purpose, step, _ticket(db, ticket_id))
    if parts is None:
        raise HTTPException(404, "Unknown step")
    if not parts:
        raise HTTPException(404, "Nothing is said in this step")
    if not get_settings().sarvam_api_key:
        raise HTTPException(503, "SARVAM_API_KEY is not set, so the Telugu voice cannot be made.")
    try:
        name = tts_audio.merge(0, parts)  # call 0 is the preview "call"; its audio is swept like any other per-call audio
    except tts_audio.AudioError as exc:
        raise HTTPException(503, str(exc)) from exc
    path = tts_audio.path_for(name)
    if path is None:
        raise HTTPException(503, "The audio could not be made")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "no-store"})
