"""Which call this is: the backend's attempt id, and the token that proves this agent was sent for it.

Both arrive on the SIP participant two ways, so the agent works whichever the trunk supports: as SIP headers
(Vobiz sends ``Attempt`` and ``Token`` with an X-VH- prefix, which the LiveKit trunk maps to participant
attributes) or inside the called address, which the backend sets to ``ivr-<attempt>-<token>``."""

import re
from collections.abc import Mapping

import config

_NUMBER = re.compile(r"[0-9]+")
_TOKEN = re.compile(r"[0-9a-fA-F]{40}")
_CALLED = re.compile(r"ivr-([0-9]+)-([0-9a-fA-F]{40})")

_ATTEMPT_KEYS = (config.ATTR_ATTEMPT, "sip.h.x-vh-attempt", "sip.h.attempt")
_TOKEN_KEYS = (config.ATTR_TOKEN, "sip.h.x-vh-token", "sip.h.token")


def _first(attributes: Mapping[str, str], keys: tuple[str, ...]) -> str:
    lowered = {str(k).lower(): v for k, v in attributes.items()}
    for key in keys:
        value = str(lowered.get(key) or "").strip()
        if value:
            return value
    return ""


def read(attributes: Mapping[str, str] | None, called_number: str | None) -> tuple[int, str] | None:
    """The attempt id and token, from the headers if both are there and well formed, else from the called address."""
    attributes = attributes or {}
    attempt, token = _first(attributes, _ATTEMPT_KEYS), _first(attributes, _TOKEN_KEYS)
    if _NUMBER.fullmatch(attempt) and _TOKEN.fullmatch(token):
        return int(attempt), token
    match = _CALLED.search(called_number or "")
    return (int(match.group(1)), match.group(2)) if match else None
