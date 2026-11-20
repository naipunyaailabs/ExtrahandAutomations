"""Vobiz telephony: we place the call over REST, then Vobiz asks our webhooks (api/vobiz_webhooks.py)
what to do next.

Call flow: Vobiz POSTs /answer when the person picks up; we reply with VobizXML that plays the Telugu
prompt inside a <Gather> and waits for one keypress, which Vobiz POSTs to /gather. Docs: vobiz.ai/docs."""

import base64
import hashlib
import hmac
import re
from collections.abc import Mapping
from urllib.parse import quote, urlparse, urlunparse
from xml.sax.saxutils import escape, quoteattr

import httpx
from sqlalchemy.orm import object_session

from ..config import get_settings, public_base_url, public_url_dns_problem
from ..models import CallAttempt
from ..services import ivr, tts_audio
from .base import TelephonyError

_FAILED_CAUSES = ("FAIL", "REJECT", "UNALLOCATED", "INVALID", "UNREACHABLE", "CONGESTION", "BLOCKED")
_CALL_ID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _digits(number: str | None) -> str:
    """Vobiz wants E.164 digits without the plus sign."""
    return re.sub(r"\D", "", number or "")


def is_call_id(value: str | None) -> bool:
    """Vobiz call ids are UUIDs; anything else is never stored or put into a request path."""
    return bool(value and _CALL_ID.match(value))


def callback_token(attempt_id: int) -> str:
    """Ties a callback URL to its call. Vobiz's own signature covers only the URL path and a nonce, so on its own it
    cannot stop one call's callback being replayed against another call's id."""
    key = get_settings().vobiz_auth_token.encode()
    return hmac.new(key, f"callback|{int(attempt_id)}".encode(), hashlib.sha256).hexdigest()[:32]


def callback_url(path: str, attempt_id: int) -> str:
    return (f"{public_base_url()}/api/telephony/vobiz/{path}"
            f"?attempt_id={attempt_id}&t={callback_token(attempt_id)}")


class VobizProvider:
    name = "vobiz"

    def __init__(self) -> None:
        self.s = get_settings()
        required = ("vobiz_auth_id", "vobiz_auth_token", "vobiz_from_number",
                    "sarvam_api_key", "audio_url_secret")
        missing = [k.upper() for k in required if not getattr(self.s, k)]
        if not public_base_url():
            missing.append("PUBLIC_BASE_URL (Double-click start_tunnel.bat to launch Cloudflare tunnel)")
        if missing:
            raise TelephonyError(f"Vobiz not configured: missing {', '.join(missing)}")

    def _api(self, path: str) -> str:
        return f"{self.s.vobiz_api_base.rstrip('/')}/Account/{self.s.vobiz_auth_id}{path}"

    def _headers(self) -> dict[str, str]:
        return {"X-Auth-ID": self.s.vobiz_auth_id, "X-Auth-Token": self.s.vobiz_auth_token}

    def place_call(self, attempt: CallAttempt) -> str:
        """Makes the call's Telugu audio, then asks Vobiz to dial. Returns Vobiz's call id."""
        try:
            return self._place(attempt)
        except TelephonyError:
            tts_audio.purge(attempt.id)  # the call never started: nothing should keep this person's details
            raise

    def _place(self, attempt: CallAttempt) -> str:
        if problem := public_url_dns_problem():
            raise TelephonyError(problem)
        try:
            tts_audio.prepare(attempt.id, ivr.all_parts(object_session(attempt), attempt))
        except tts_audio.AudioError as e:
            raise TelephonyError(f"Telugu audio could not be made: {e}") from e
        body = {
            "from": _digits(self.s.vobiz_from_number),
            "to": _digits(attempt.phone),
            "answer_url": callback_url("answer", attempt.id), "answer_method": "POST",
            "hangup_url": callback_url("hangup", attempt.id), "hangup_method": "POST",
            "ring_timeout": str(self.s.call_ring_timeout_seconds),
        }
        try:
            r = httpx.post(self._api("/Call/"), headers=self._headers(), json=body, timeout=20)
        except httpx.HTTPError as e:
            raise TelephonyError(str(e)) from e
        if r.status_code >= 400:
            raise TelephonyError(f"Vobiz {r.status_code}: {r.text[:300]}")
        try:
            call_id = r.json()["request_uuid"]
        except (ValueError, KeyError) as e:
            raise TelephonyError(f"Vobiz returned no call id: {r.text[:200]}") from e
        if not is_call_id(call_id):
            raise TelephonyError(f"Vobiz returned an unexpected call id: {str(call_id)[:80]!r}")
        return call_id

    def hangup(self, attempt: CallAttempt) -> None:
        if not attempt.provider_call_id:
            return
        httpx.delete(self._api(f"/Call/{quote(attempt.provider_call_id, safe='')}/"), headers=self._headers(), timeout=20)


# --- VobizXML -------------------------------------------------------------------------

def xml(*verbs: str) -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Response>' + "".join(verbs) + "</Response>"


def _plays(urls: list[str]) -> str:
    return "".join(f"<Play>{escape(u)}</Play>" for u in urls)


def gather(audio_urls: list[str], action_url: str, redirect_url: str) -> str:
    """Plays the prompt and waits for one keypress. The prompt sits inside <Gather> so the person can press a
    key while it is still playing; with no key Vobiz falls through to the redirect."""
    timeout = max(5, min(60, get_settings().ivr_gather_timeout_seconds))  # Vobiz accepts 5 to 60 seconds
    return xml(
        f'<Gather action={quoteattr(action_url)} method="POST" inputType="dtmf" numDigits="1" '
        f'executionTimeout="{timeout}">{_plays(audio_urls)}</Gather>',
        f'<Redirect method="POST">{escape(redirect_url)}</Redirect>',
    )


def play_and_hangup(urls: list[str]) -> str:
    return xml(_plays(urls), "<Hangup/>")


def play_and_redirect(urls: list[str], url: str) -> str:
    return xml(_plays(urls), f'<Redirect method="POST">{escape(url)}</Redirect>')


def dial_handoff(audio_urls: list[str], sip_uri: str, headers: dict[str, str], action_url: str, time_limit: int) -> str:
    """Plays the connecting line, then bridges the call to the voice agent's SIP address. ``headers`` travel as SIP
    headers (Vobiz prefixes them with X-VH-); ``action_url`` is called when the bridge ends, for any reason."""
    s = get_settings()
    meta = ",".join(f"{k}={v}" for k, v in headers.items())
    return xml(
        _plays(audio_urls),
        f'<Dial callerId={quoteattr("+" + _digits(s.vobiz_from_number))} action={quoteattr(action_url)} method="POST" '
        f'timeout="{s.handoff_ring_timeout_seconds}" timeLimit="{time_limit}">'
        f'<User sipHeaders={quoteattr(meta)}>{escape(sip_uri)}</User></Dial>',
    )


# --- callbacks ------------------------------------------------------------------------

def provider_status(form: Mapping[str, str]) -> str:
    """Maps the hangup callback's CallStatus / HangupCauseName to the statuses services.ivr.ended understands.
    Vobiz reports a plain 'completed' for most hangups; ivr.ended decides between hung-up and no-answer from
    whether the call was ever answered."""
    status = (form.get("CallStatus") or form.get("Status") or "").lower()
    cause = (form.get("HangupCauseName") or form.get("HangupCause") or "").upper()
    if status == "busy" or "BUSY" in cause:
        return "busy"
    if status in ("no-answer", "timeout") or "NO_ANSWER" in cause or "NO_USER_RESPONSE" in cause:
        return "no-answer"
    if status == "canceled" or "CANCEL" in cause:
        return "canceled"
    if status == "failed" or any(k in cause for k in _FAILED_CAUSES):
        return "failed"
    return "completed"


def verify_signature(url: str, headers: Mapping[str, str], token: str) -> bool:
    """Checks X-Vobiz-Signature-V3 / V2: base64 HMAC-SHA256 keyed with the account auth token over the callback's
    base URL (no query) plus the nonce, joined by '.' for V3. The signature does not cover the request body."""
    if not token or not url:
        return False
    parsed = urlparse(url)
    base = urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
    lookup = {str(k).lower(): v for k, v in headers.items()}
    for version, separator in (("v3", "."), ("v2", "")):
        signature = lookup.get(f"x-vobiz-signature-{version}")
        nonce = lookup.get(f"x-vobiz-signature-{version}-nonce")
        if not signature or not nonce:
            continue
        digest = hmac.new(token.encode(), f"{base}{separator}{nonce}".encode(), hashlib.sha256).digest()
        if hmac.compare_digest(str(signature), base64.b64encode(digest).decode()):
            return True
    return False
