"""Live checks for the Voice & IVR page: do the outside services answer, and would a caller hear the first word
quickly? They talk to Vobiz and Sarvam and to this server's own public address, so they run on request, not at
start-up. A check says what it found, never a key or a token."""

import time
from urllib.parse import quote

import httpx

from ..config import Settings
from . import tts_audio
from .ivr import Part
from .readiness import FAIL, INFO, OK, WARN, Check, public_url_problem

SARVAM_SAMPLE = Part("తెలుగు పరీక్ష. ExtraHand నుండి call.")
# A fixed sentence, so its audio is made once and reused: about six seconds of speech.
SPEED_SAMPLE = Part("నమస్కారం! ExtraHand నుండి call చేస్తున్నాం. మీకోసం ఒక కొత్త task ఉంది. Task accept చేయడానికి 1 నొక్కండి.")
TYPICAL_MESSAGE_BYTES = 160_000  # ten seconds of 8 kHz, 16-bit speech: a job offer or a reminder
GOOD_START_SECONDS, SLOW_START_SECONDS = 2.0, 5.0


def estimate_start_seconds(first_byte: float, total: float, size: int, message_bytes: int = TYPICAL_MESSAGE_BYTES) -> float:
    """When the first word of a typical message would be heard: Vobiz downloads the whole file before playing it,
    so it is the wait for the first byte plus the time to transfer the message, at the speed just measured."""
    transfer = max(total - first_byte, 0.001)
    return first_byte + message_bytes / (size / transfer)


def measure_download(url: str) -> tuple[float, float, int]:
    """(seconds to the first byte, seconds in all, bytes) of one download."""
    start = time.perf_counter()
    first, size = None, 0
    with httpx.stream("GET", url, timeout=30) as response:
        response.raise_for_status()
        for chunk in response.iter_bytes():
            if first is None:
                first = time.perf_counter() - start
            size += len(chunk)
    return first or 0.0, time.perf_counter() - start, size


def _timed(check: Check, started: float) -> Check:
    check.ms = int((time.perf_counter() - started) * 1000)
    return check


def check_sarvam(s: Settings) -> Check:
    started = time.perf_counter()
    try:
        tts_audio._synthesize(SARVAM_SAMPLE.text, source="check")
    except tts_audio.AudioError as exc:
        return _timed(Check("sarvam", "Telugu voice (Sarvam)", FAIL, str(exc), "Check SARVAM_API_KEY."), started)
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        detail = "Sarvam rejected the API key." if code in (401, 403) else f"Sarvam answered HTTP {code}."
        return _timed(Check("sarvam", "Telugu voice (Sarvam)", FAIL, detail, "Check SARVAM_API_KEY and the Sarvam account."), started)
    except httpx.HTTPError as exc:
        return _timed(Check("sarvam", "Telugu voice (Sarvam)", FAIL, f"Sarvam text-to-speech could not be reached ({type(exc).__name__}).",
                            "Check the server's internet access."), started)
    return _timed(Check("sarvam", "Telugu voice (Sarvam)", OK, "Made a test sentence in Telugu."), started)


def check_vobiz(s: Settings) -> Check:
    started = time.perf_counter()
    url = f"{s.vobiz_api_base.rstrip('/')}/Account/{quote(s.vobiz_auth_id, safe='')}/Call/"
    try:
        response = httpx.get(url, headers={"X-Auth-ID": s.vobiz_auth_id, "X-Auth-Token": s.vobiz_auth_token},
                             params={"limit": 1}, timeout=10, follow_redirects=True)
    except httpx.HTTPError as exc:
        return _timed(Check("vobiz_live", "Vobiz account", WARN, f"Vobiz could not be reached ({type(exc).__name__}).",
                            "Check the server's internet access."), started)
    if response.status_code in (401, 403):
        return _timed(Check("vobiz_live", "Vobiz account", FAIL, "Vobiz rejected the Auth ID or Auth Token.",
                            "Copy both again from the Vobiz console."), started)
    if response.status_code >= 400:
        return _timed(Check("vobiz_live", "Vobiz account", WARN, f"Vobiz answered HTTP {response.status_code}."), started)
    return _timed(Check("vobiz_live", "Vobiz account", OK, "Vobiz accepted the credentials."), started)


def check_reachable(s: Settings) -> Check:
    started = time.perf_counter()
    problem = public_url_problem(s.public_base_url)
    if problem:
        return _timed(Check("public_reachable", "Reachable from outside", INFO, f"Skipped: the public address {problem}."), started)
    url = f"{s.public_base_url.rstrip('/')}/api/health"
    try:
        response = httpx.get(url, timeout=10)
    except httpx.HTTPError as exc:
        return _timed(Check("public_reachable", "Reachable from outside", WARN,
                            f"This server could not reach its own public address ({type(exc).__name__}). Vobiz may still be able to.",
                            "Check DNS, the firewall and the reverse proxy. Some networks do not let a server call its own public address."), started)
    try:
        genuine = response.status_code == 200 and response.json().get("ok") is True
    except ValueError:
        genuine = False
    if genuine:
        return _timed(Check("public_reachable", "Reachable from outside", OK, f"{s.public_base_url.rstrip('/')} answers as this backend."), started)
    detail = (f"The address answered HTTP {response.status_code}, but not as this backend."
              if response.status_code == 200 else f"The address answered HTTP {response.status_code}.")
    return _timed(Check("public_reachable", "Reachable from outside", FAIL, detail,
                        "Point the reverse proxy's /api at this backend."), started)


def check_audio_speed(s: Settings, reachable: Check) -> Check:
    started = time.perf_counter()
    if reachable.status != OK:
        return _timed(Check("audio_speed", "Audio download speed", INFO, "Skipped until the public address answers."), started)
    try:
        url = tts_audio.url_for(tts_audio.ensure(0, SPEED_SAMPLE))
        first, total, size = measure_download(url)
    except tts_audio.AudioError as exc:
        return _timed(Check("audio_speed", "Audio download speed", WARN, f"Could not make the test audio: {exc}"), started)
    except httpx.HTTPError as exc:
        return _timed(Check("audio_speed", "Audio download speed", WARN, f"The test audio could not be downloaded ({type(exc).__name__})."), started)
    start = estimate_start_seconds(first, total, size)
    detail = (f"A ten-second message would start about {start:.1f} s after Vobiz asks for it "
              f"({size / 1000:.0f} KB in {total:.1f} s, first byte after {first:.1f} s).")
    if start < GOOD_START_SECONDS:
        return _timed(Check("audio_speed", "Audio download speed", OK, detail), started)
    fix = ("Vobiz downloads each message before playing it, so the caller hears silence until then. Serve /api/telephony/audio "
           "straight from nginx on a normal server link, not through a tunnel.")
    return _timed(Check("audio_speed", "Audio download speed", WARN if start < SLOW_START_SECONDS else FAIL, detail, fix), started)


def run_live_checks(s: Settings) -> list[Check]:
    if s.telephony_provider != "vobiz":
        return [Check(i, label, INFO, "Not applicable while calls are simulated.")
                for i, label in (("sarvam", "Telugu voice (Sarvam)"), ("vobiz_live", "Vobiz account"),
                                 ("public_reachable", "Reachable from outside"), ("audio_speed", "Audio download speed"))]
    reachable = check_reachable(s)
    return [check_sarvam(s), check_vobiz(s), reachable, check_audio_speed(s, reachable)]
