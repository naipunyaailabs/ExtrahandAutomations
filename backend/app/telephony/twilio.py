"""Twilio Programmable Voice over its REST API (no SDK needed).

Call flow: Twilio requests /api/telephony/twilio/voice when the helper answers,
we reply with TwiML that speaks the task and gathers one keypad digit."""

import base64
import hashlib
import hmac
from xml.sax.saxutils import escape, quoteattr

import httpx

from ..config import get_settings
from ..models import CallAttempt
from .base import TelephonyError


class TwilioProvider:
    name = "twilio"

    def __init__(self) -> None:
        self.s = get_settings()
        missing = [k for k in ("twilio_account_sid", "twilio_auth_token", "twilio_from_number", "public_base_url")
                   if not getattr(self.s, k)]
        if missing:
            raise TelephonyError(f"Twilio not configured: missing {', '.join(m.upper() for m in missing)}")

    def _api(self, path: str) -> str:
        return f"https://api.twilio.com/2010-04-01/Accounts/{self.s.twilio_account_sid}{path}"

    def _callback(self, path: str, attempt_id: int) -> str:
        from ..config import public_base_url

        return f"{public_base_url()}/api/telephony/twilio/{path}?attempt_id={attempt_id}"

    def place_call(self, attempt: CallAttempt) -> str:
        data = {
            "To": attempt.phone,
            "From": self.s.twilio_from_number,
            "Url": self._callback("voice", attempt.id),
            "StatusCallback": self._callback("status", attempt.id),
            "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
            "Timeout": str(self.s.call_ring_timeout_seconds),
        }
        try:
            r = httpx.post(self._api("/Calls.json"), data=data,
                           auth=(self.s.twilio_account_sid, self.s.twilio_auth_token), timeout=20)
        except httpx.HTTPError as e:
            raise TelephonyError(str(e)) from e
        if r.status_code >= 400:
            raise TelephonyError(f"Twilio {r.status_code}: {r.text[:300]}")
        return r.json()["sid"]

    def hangup(self, attempt: CallAttempt) -> None:
        if not attempt.provider_call_id:
            return
        httpx.post(self._api(f"/Calls/{attempt.provider_call_id}.json"), data={"Status": "completed"},
                   auth=(self.s.twilio_account_sid, self.s.twilio_auth_token), timeout=20)


# --- TwiML -----------------------------------------------------------------------

def _say(text: str) -> str:
    s = get_settings()
    return f"<Say voice={quoteattr(s.tts_voice)} language={quoteattr(s.tts_language)}>{escape(text)}</Say>"


def twiml(*verbs: str) -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Response>' + "".join(verbs) + "</Response>"


def gather(text: str, action_url: str, redirect_url: str) -> str:
    """Speak the prompt and wait for one digit; with no input Twilio falls through to the redirect."""
    s = get_settings()
    return twiml(
        f'<Gather input="dtmf" numDigits="1" timeout="{s.ivr_gather_timeout_seconds}" '
        f'action={quoteattr(action_url)} method="POST">{_say(text)}</Gather>',
        f"<Redirect method=\"POST\">{escape(redirect_url)}</Redirect>",
    )


def say_and_hangup(text: str) -> str:
    return twiml(_say(text), "<Hangup/>")


def say_and_redirect(text: str, url: str) -> str:
    return twiml(_say(text), f"<Redirect method=\"POST\">{escape(url)}</Redirect>")


def valid_signature(url: str, params: dict[str, str], signature: str | None) -> bool:
    s = get_settings()
    if not s.twilio_validate_signature:
        return True
    if not signature or not s.twilio_auth_token:
        return False
    payload = url + "".join(k + params[k] for k in sorted(params))
    digest = hmac.new(s.twilio_auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return hmac.compare_digest(base64.b64encode(digest).decode(), signature)
