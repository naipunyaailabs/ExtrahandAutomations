"""What the agent reports to the backend. Validated here, so a wrong tool call is refused (and the model told) before
anything is sent; the limits are the backend's (app/services/handoff.py)."""

DECISIONS = ("cannot_come", "running_late")
CATEGORIES = ("late_arrival", "poor_service", "incomplete_work", "overcharging", "rude_behavior", "other")
_REASON_LIMIT, _TEXT_LIMIT, _TRANSCRIPT_LIMIT = 500, 1000, 20000


def _trim(value, limit: int) -> str:
    """One line, capped."""
    return " ".join(str(value or "").split())[:limit]


def reminder_body(decision: str, reason: str, eta_minutes: int | None, summary: str = "",
                  transcript: str | None = None) -> dict:
    """The reminder result: the helper cannot come, or is running late and will arrive in ``eta_minutes``."""
    if decision not in DECISIONS:
        raise ValueError(f"decision must be one of {', '.join(DECISIONS)}")
    reason = _trim(reason, _REASON_LIMIT)
    body: dict = {"kind": "reminder", "decision": decision, "reason": reason}
    if decision == "running_late":
        if not isinstance(eta_minutes, int) or not 1 <= eta_minutes <= 600:
            raise ValueError("eta_minutes, the minutes from now until they arrive (1 to 600), is required when running late")
        body["eta_minutes"] = eta_minutes
        fallback = f"Helper is running late, about {eta_minutes} more minutes" + (f": {reason}." if reason else ".")
    else:
        fallback = "Helper cannot come" + (f": {reason}." if reason else ".")
    body["summary"] = _trim(summary, _TEXT_LIMIT) or _trim(fallback, _TEXT_LIMIT)
    if transcript:
        body["transcript"] = str(transcript)[:_TRANSCRIPT_LIMIT]
    return body


def rating_body(category: str, details: str, summary: str = "", transcript: str | None = None) -> dict:
    """The rating result: what went wrong, in one of the backend's complaint categories."""
    if category not in CATEGORIES:
        raise ValueError(f"complaint_category must be one of {', '.join(CATEGORIES)}")
    details = _trim(details, _TEXT_LIMIT)
    fallback = f"Customer complaint ({category.replace('_', ' ')})" + (f": {details}." if details else ".")
    body = {"kind": "rating", "complaint_category": category, "details": details,
            "summary": _trim(summary, _TEXT_LIMIT) or _trim(fallback, _TEXT_LIMIT)}
    if transcript:
        body["transcript"] = str(transcript)[:_TRANSCRIPT_LIMIT]
    return body
