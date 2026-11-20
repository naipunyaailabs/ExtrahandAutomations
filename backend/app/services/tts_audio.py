"""Telugu audio for the IVR: Sarvam text-to-speech saved as WAV files that Vobiz plays.

A fixed part's audio is made once and reused by every call. A personal part's audio (name, area, time,
address) is made for one call under an unguessable name and deleted when the call ends; ``sweep`` removes
any that were missed."""

import array
import base64
import hashlib
import hmac
import os
import re
import sys
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx

from ..config import get_settings
from .ivr import Part

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
_NAME = re.compile(r"^(c-[0-9a-f]{40}|p\d+-[0-9a-f]{40})$")
_PARALLEL = 4  # Sarvam requests in flight while a call's audio is prepared
_PAUSE_MS = 180  # silence between two phrases of one message
_PAD_MS = 40  # silence kept around a phrase's sound once the silence Sarvam adds at its ends is cut
_QUIET = 400  # 16-bit samples at or below this are silence


class AudioError(Exception):
    pass


def _dir() -> Path:
    return Path(get_settings().ivr_audio_dir)


def _record_usage(characters: int, source: str) -> None:
    """Meters the characters sent to Sarvam (billed per character) for the Commercials page. Written from its own
    thread and session so a busy database never delays or breaks a call; a failed write only loses the meter."""

    def write() -> None:
        try:
            from ..database import SessionLocal
            from ..models import UsageEvent

            with SessionLocal() as db:
                db.add(UsageEvent(service="sarvam_tts", source=source, units=characters))
                db.commit()
        except Exception:  # noqa: BLE001  (metering must never fail a call)
            pass

    threading.Thread(target=write, daemon=True).start()


def _synthesize(text: str, source: str = "ivr") -> bytes:
    s = get_settings()
    if not s.sarvam_api_key:
        raise AudioError("SARVAM_API_KEY is not set")
    r = httpx.post(
        SARVAM_TTS_URL,
        headers={"api-subscription-key": s.sarvam_api_key},
        json={"text": text, "target_language_code": s.sarvam_tts_language, "speaker": s.sarvam_tts_speaker,
              "model": s.sarvam_tts_model, "speech_sample_rate": s.sarvam_tts_sample_rate},
        timeout=10,
    )
    r.raise_for_status()
    audios = r.json().get("audios") or []
    if not audios:
        raise AudioError("Sarvam returned no audio")
    _record_usage(len(text), source)
    return base64.b64decode("".join(audios))


def name_for(attempt_id: int, part: Part) -> str:
    s = get_settings()
    if not part.personal:
        voice = f"{s.sarvam_tts_model}|{s.sarvam_tts_speaker}|{s.sarvam_tts_language}|{s.sarvam_tts_sample_rate}"
        return "c-" + hashlib.sha256(f"{voice}|{part.text}".encode()).hexdigest()[:40]
    if not s.audio_url_secret:
        raise AudioError("AUDIO_URL_SECRET is not set; per-call audio would have a guessable address")
    digest = hmac.new(s.audio_url_secret.encode(), f"{attempt_id}|{part.text}".encode(), hashlib.sha256).hexdigest()
    return f"p{int(attempt_id)}-{digest[:40]}"


# Private phrases (task line, address) are the same for every helper offered the same task. Their audio is kept
# under a secret, text-keyed name for a day, so the next helper's call copies it instead of paying Sarvam again.
# These files are never served (not matched by _NAME); each call still gets its own file, purged after the call.
TEXT_CACHE_AGE = timedelta(hours=24)
_text_locks: dict[str, threading.Lock] = {}
_text_locks_guard = threading.Lock()


def _text_cache_name(part: Part) -> str:
    s = get_settings()
    voice = f"{s.sarvam_tts_model}|{s.sarvam_tts_speaker}|{s.sarvam_tts_language}|{s.sarvam_tts_sample_rate}"
    digest = hmac.new(s.audio_url_secret.encode(), f"text|{voice}|{part.text}".encode(), hashlib.sha256).hexdigest()
    return f"t-{digest[:40]}"


def _write(path: Path, audio: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")  # written whole, then renamed: never served half-written
    tmp.write_bytes(audio)
    os.replace(tmp, path)


def _make(text: str) -> bytes:
    try:
        return _synthesize(text)
    except httpx.HTTPError as e:
        raise AudioError(f"Sarvam text-to-speech failed: {e}") from e


def _personal_audio(part: Part) -> bytes:
    """A private phrase's audio: from the text cache when another call already made it, else made once."""
    key = _text_cache_name(part)
    cached = _dir() / f"{key}.wav"
    with _text_locks_guard:
        lock = _text_locks.setdefault(key, threading.Lock())
    with lock:  # two calls for the same task prepared at once: only one asks Sarvam
        if cached.exists():
            try:
                return cached.read_bytes()
            except FileNotFoundError:  # swept just now
                pass
        audio = _make(part.text)
        _write(cached, audio)
        return audio


def ensure(attempt_id: int, part: Part) -> str:
    """Makes the audio for this part if it does not exist yet and returns its name."""
    name = name_for(attempt_id, part)
    path = _dir() / f"{name}.wav"
    if not path.exists():
        _write(path, _personal_audio(part) if part.personal else _make(part.text))
    return name


def prepare(attempt_id: int, parts) -> None:
    """Makes every missing audio file for a call before it is dialled. Raises AudioError if any cannot be made."""
    unique = list(dict.fromkeys(parts))
    with ThreadPoolExecutor(max_workers=_PARALLEL) as pool:
        list(pool.map(lambda part: ensure(attempt_id, part), unique))


def _read(path: Path) -> tuple[int, array.array]:
    """The sample rate and 16-bit mono samples of a WAV file."""
    try:
        with wave.open(str(path), "rb") as w:
            if (w.getnchannels(), w.getsampwidth()) != (1, 2):
                raise AudioError("audio is not 16-bit mono")
            rate, samples = w.getframerate(), array.array("h")
            samples.frombytes(w.readframes(w.getnframes()))
    except (wave.Error, EOFError) as e:
        raise AudioError(f"audio is not a WAV file: {e}") from e
    if sys.byteorder == "big":
        samples.byteswap()
    return rate, samples


def _trimmed(samples: array.array, rate: int) -> array.array | None:
    """The samples without the silence at both ends (a little is kept); None if there is no sound at all."""
    first = next((i for i, v in enumerate(samples) if abs(v) > _QUIET), None)
    if first is None:
        return None
    last = next(i for i in range(len(samples) - 1, -1, -1) if abs(samples[i]) > _QUIET)
    pad = rate * _PAD_MS // 1000
    return samples[max(0, first - pad): last + 1 + pad]


def merged_name_for(attempt_id: int, parts: list[Part]) -> str:
    key = "merge1|" + "|".join(name_for(attempt_id, part) for part in parts)
    if any(part.personal for part in parts):  # one personal phrase makes the whole file the call's own
        digest = hmac.new(get_settings().audio_url_secret.encode(), f"{attempt_id}|{key}".encode(), hashlib.sha256).hexdigest()
        return f"p{int(attempt_id)}-{digest[:40]}"
    return "c-" + hashlib.sha256(key.encode()).hexdigest()[:40]


def merge(attempt_id: int, parts) -> str:
    """One file that says all the parts in order, and its name.

    Vobiz fetches every <Play> on its own and each clip carries silence at both ends, so a message played as
    separate files has a pause of a second or more between phrases. Joined here, the silence is cut and a short
    fixed pause goes between phrases. Needs each part's audio, which it makes if missing."""
    parts = list(parts)
    if len(parts) == 1:
        return ensure(attempt_id, parts[0])
    name = merged_name_for(attempt_id, parts)
    path = _dir() / f"{name}.wav"
    if path.exists():
        return name
    clips = [_read(_dir() / f"{ensure(attempt_id, part)}.wav") for part in parts]
    rates = {rate for rate, _ in clips}
    if len(rates) != 1:
        raise AudioError(f"audio clips have different sample rates: {sorted(rates)}")
    rate = rates.pop()
    pieces = [piece for _, samples in clips if (piece := _trimmed(samples, rate)) is not None]
    if not pieces:
        raise AudioError("audio has no sound")
    pause = array.array("h", [0]) * (rate * _PAUSE_MS // 1000)
    joined = array.array("h")
    for i, piece in enumerate(pieces):
        if i:
            joined.extend(pause)
        joined.extend(piece)
    if sys.byteorder == "big":
        joined.byteswap()
    tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")  # written whole, then renamed: never served half-written
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(joined.tobytes())
    os.replace(tmp, path)
    return name


def url_for(name: str) -> str:
    from ..config import public_base_url

    return f"{public_base_url()}/api/telephony/audio/{name}.wav"


def path_for(name: str) -> Path | None:
    """The file for a well-formed name, if it exists."""
    if not _NAME.match(name):
        return None
    path = _dir() / f"{name}.wav"
    return path if path.is_file() else None


def purge(attempt_id: int) -> int:
    """Deletes the per-call audio of one call. Returns how many files were removed."""
    removed = 0
    for path in _dir().glob(f"p{int(attempt_id)}-*.wav"):
        path.unlink(missing_ok=True)
        removed += 1
    return removed


def sweep(max_age: timedelta) -> int:
    """Deletes per-call audio older than ``max_age`` (calls that never reported back), and after a day the
    text-cache, bulk-campaign and Task-Seeding audio (made again by itself if a call still needs it; the
    Task-Seeding one says the customer's name). Fixed audio stays."""
    cutoff = time.time() - max_age.total_seconds()
    removed = 0
    text_cutoff = time.time() - max(max_age, TEXT_CACHE_AGE).total_seconds()
    for pattern, limit in (("p*-*.wav", cutoff), ("t-*.wav", text_cutoff), ("bulk_*.wav", text_cutoff),
                           ("seed_*.wav", text_cutoff)):
        for path in _dir().glob(pattern):
            try:
                if path.stat().st_mtime < limit:
                    path.unlink()
                    removed += 1
            except FileNotFoundError:
                continue
    return removed
