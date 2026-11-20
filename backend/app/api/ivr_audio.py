"""Serves the IVR's Telugu audio to Vobiz (see services/tts_audio.py)."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..services import tts_audio

router = APIRouter(prefix="/api/telephony/audio", tags=["ivr-audio"])


@router.get("/{name}.wav")
def get_audio(name: str):
    path = tts_audio.path_for(name)
    if path is None:
        raise HTTPException(404, "Unknown audio")
    return FileResponse(path, media_type="audio/wav")
