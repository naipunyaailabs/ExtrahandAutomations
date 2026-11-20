import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AppSetting, Event, utcnow

# Serializes every state transition (webhooks, simulator clicks and the worker
# all touch the same dispatch runs).
engine_lock = threading.RLock()


def log_event(db: Session, ticket_id: str | None, kind: str, message: str) -> None:
    db.add(Event(ticket_id=ticket_id, kind=kind, message=message))


@dataclass
class RuntimeSettings:
    followup_offsets_minutes: list[int]
    auto_dispatch: bool
    max_helpers_per_ticket: int
    match_radius_km: float
    # Emergency kill switch / Calling Agent activation
    emergency_stop_calls: bool = True
    calling_agent_active: bool = False
    # Independent channel switches; every channel starts DEACTIVE until someone clicks Activate
    bulk_calling_active: bool = False
    whatsapp_automation_active: bool = False
    whatsapp_bulk_active: bool = False
    # Workflow toggles
    workflow_helper_dispatch_enabled: bool = True
    workflow_customer_feedback_enabled: bool = True
    workflow_whatsapp_dispatch_enabled: bool = True
    workflow_whatsapp_feedback_enabled: bool = True
    # Contact hours & delay
    calling_hours_start: str = "07:30"
    calling_hours_end: str = "21:30"
    feedback_call_delay_minutes: int = 15
    feedback_call_max_age_hours: int = 48  # only jobs scheduled this recently get an automatic rating call
    preferred_language: str = "en-IN"
    max_helper_call_attempts: int = 3
    # Cost estimation
    cost_per_call_minute: float = 0.50
    cost_per_whatsapp_msg: float = 0.25
    # Automatic job-offer calls start this many hours before the task time
    dispatch_lead_hours: float = 6.0


EDITABLE_KEYS = {
    "followup_offsets_minutes",
    "auto_dispatch",
    "max_helpers_per_ticket",
    "match_radius_km",
    "emergency_stop_calls",
    "calling_agent_active",
    "bulk_calling_active",
    "whatsapp_automation_active",
    "whatsapp_bulk_active",
    "workflow_helper_dispatch_enabled",
    "workflow_customer_feedback_enabled",
    "workflow_whatsapp_dispatch_enabled",
    "workflow_whatsapp_feedback_enabled",
    "calling_hours_start",
    "calling_hours_end",
    "feedback_call_delay_minutes",
    "feedback_call_max_age_hours",
    "preferred_language",
    "max_helper_call_attempts",
    "cost_per_call_minute",
    "cost_per_whatsapp_msg",
    "dispatch_lead_hours",
}


def _parse_offsets(v: str | list) -> list[int]:
    items = v if isinstance(v, list) else str(v).split(",")
    return sorted({int(x) for x in items if str(x).strip() and int(x) > 0}, reverse=True)


def _to_bool(val: object, default: bool = False) -> bool:
    if val is None:
        return default
    return str(val).lower() in ("1", "true", "yes", "on")


def runtime_settings(db: Session) -> RuntimeSettings:
    s = get_settings()
    initial_active = getattr(s, "calling_agent_active", False)
    raw: dict = {
        "followup_offsets_minutes": s.followup_offsets_minutes,
        "auto_dispatch": s.auto_dispatch,
        "max_helpers_per_ticket": s.max_helpers_per_ticket,
        "match_radius_km": s.match_radius_km,
        "emergency_stop_calls": not initial_active,
        "calling_agent_active": initial_active,
        "bulk_calling_active": False,
        "whatsapp_automation_active": False,
        "whatsapp_bulk_active": False,
        "workflow_helper_dispatch_enabled": True,
        "workflow_customer_feedback_enabled": True,
        "workflow_whatsapp_dispatch_enabled": True,
        "workflow_whatsapp_feedback_enabled": True,
        "calling_hours_start": s.calling_hours_start,
        "calling_hours_end": s.calling_hours_end,
        "feedback_call_delay_minutes": s.feedback_call_delay_minutes,
        "feedback_call_max_age_hours": 48,
        "preferred_language": s.tts_language,
        "max_helper_call_attempts": s.max_helper_call_attempts,
        "cost_per_call_minute": s.cost_per_call_minute,
        "cost_per_whatsapp_msg": s.cost_per_whatsapp_msg,
        "dispatch_lead_hours": s.dispatch_lead_hours,
    }
    for row in db.query(AppSetting).filter(AppSetting.key.in_(EDITABLE_KEYS)):
        raw[row.key] = row.value

    if "calling_agent_active" in raw and raw["calling_agent_active"] is not None:
        is_active = _to_bool(raw["calling_agent_active"])
        raw["calling_agent_active"] = is_active
        raw["emergency_stop_calls"] = not is_active
    elif "emergency_stop_calls" in raw and raw["emergency_stop_calls"] is not None:
        is_stopped = _to_bool(raw["emergency_stop_calls"])
        raw["emergency_stop_calls"] = is_stopped
        raw["calling_agent_active"] = not is_stopped
    else:
        raw["calling_agent_active"] = initial_active
        raw["emergency_stop_calls"] = not initial_active

    return RuntimeSettings(
        followup_offsets_minutes=_parse_offsets(raw["followup_offsets_minutes"]),
        auto_dispatch=_to_bool(raw["auto_dispatch"]),
        max_helpers_per_ticket=int(raw["max_helpers_per_ticket"]),
        match_radius_km=float(raw["match_radius_km"]),
        emergency_stop_calls=bool(raw["emergency_stop_calls"]),
        calling_agent_active=bool(raw["calling_agent_active"]),
        bulk_calling_active=_to_bool(raw["bulk_calling_active"]),
        whatsapp_automation_active=_to_bool(raw["whatsapp_automation_active"]),
        whatsapp_bulk_active=_to_bool(raw["whatsapp_bulk_active"]),
        workflow_helper_dispatch_enabled=_to_bool(raw["workflow_helper_dispatch_enabled"], True),
        workflow_customer_feedback_enabled=_to_bool(raw["workflow_customer_feedback_enabled"], True),
        workflow_whatsapp_dispatch_enabled=_to_bool(raw["workflow_whatsapp_dispatch_enabled"], True),
        workflow_whatsapp_feedback_enabled=_to_bool(raw["workflow_whatsapp_feedback_enabled"], True),
        calling_hours_start=str(raw["calling_hours_start"]),
        calling_hours_end=str(raw["calling_hours_end"]),
        feedback_call_delay_minutes=int(raw["feedback_call_delay_minutes"]),
        feedback_call_max_age_hours=int(raw.get("feedback_call_max_age_hours", 48)),
        preferred_language=str(raw["preferred_language"]),
        max_helper_call_attempts=int(raw["max_helper_call_attempts"]),
        cost_per_call_minute=float(raw["cost_per_call_minute"]),
        cost_per_whatsapp_msg=float(raw["cost_per_whatsapp_msg"]),
        dispatch_lead_hours=float(raw.get("dispatch_lead_hours", 6.0)),
    )


def save_runtime_settings(db: Session, values: dict) -> RuntimeSettings:
    vals = dict(values)
    if "calling_agent_active" in vals and vals["calling_agent_active"] is not None:
        active = _to_bool(vals["calling_agent_active"])
        vals["calling_agent_active"] = str(active).lower()
        vals["emergency_stop_calls"] = str(not active).lower()
    elif "emergency_stop_calls" in vals and vals["emergency_stop_calls"] is not None:
        stopped = _to_bool(vals["emergency_stop_calls"])
        vals["emergency_stop_calls"] = str(stopped).lower()
        vals["calling_agent_active"] = str(not stopped).lower()

    for key, value in vals.items():
        if key not in EDITABLE_KEYS or value is None:
            continue
        if key == "followup_offsets_minutes":
            value = ",".join(str(x) for x in _parse_offsets(value))
        row = db.get(AppSetting, key) or AppSetting(key=key)
        row.value = str(value)
        db.add(row)
    db.flush()
    return runtime_settings(db)


def runtime_settings_dict(db: Session) -> dict:
    return asdict(runtime_settings(db))


# A task uploaded "for now" is stamped with the upload time; it is still called if it is at most this late.
DISPATCH_GRACE = timedelta(minutes=30)


def calls_open_at(scheduled_at: datetime, lead_hours: float, start: str | None = None, end: str | None = None) -> datetime:
    """When job-offer calls for a task start (UTC): `lead_hours` of CALLING time before the task, skipping the
    night outside calling hours. A 9:00 AM task with 6 h and hours 07:30-21:30 opens at 5:00 PM the day before
    (1.5 h that morning + 4.5 h the evening before). Without calling hours: plain lead_hours before the task."""
    plain = scheduled_at - timedelta(hours=lead_hours)
    try:
        (sh, sm), (eh, em) = _hhmm(start), _hhmm(end)
    except (TypeError, ValueError, AttributeError):
        return plain
    if (sh, sm) >= (eh, em):
        return plain  # all-day or overnight windows: no night to skip
    cursor = scheduled_at + CALL_TZ_OFFSET  # India time
    remaining = timedelta(hours=lead_hours)
    for _ in range(400):
        day_start = cursor.replace(hour=sh, minute=sm, second=0, microsecond=0)
        day_end = cursor.replace(hour=eh, minute=em, second=0, microsecond=0)
        if cursor > day_end:
            cursor = day_end  # task after hours: count back from the evening close
        if cursor <= day_start:
            cursor = (day_start - timedelta(days=1)).replace(hour=eh, minute=em)  # before opening: previous evening
            continue
        available = cursor - day_start
        if remaining <= available:
            return cursor - remaining - CALL_TZ_OFFSET
        remaining -= available
        cursor = (day_start - timedelta(days=1)).replace(hour=eh, minute=em)
    return plain


def call_window(ticket, lead_hours: float, now: datetime | None = None,
                calling_hours: tuple[str, str] | None = None) -> tuple[str, datetime | None]:
    """When automatic job-offer calls for a task may start: (state, opens_at UTC).

    state: "flexible" (no time set: call right away), "waiting" (more than lead_hours before the task),
    "open" (inside the window: calls go out), "missed" (the task time has passed), or "done" (already dispatched
    or assigned)."""
    from ..models import DispatchStatus

    def opens_at(at: datetime) -> datetime:
        return calls_open_at(at, lead_hours, *calling_hours) if calling_hours else at - timedelta(hours=lead_hours)

    if ticket.dispatch_status != DispatchStatus.NEW:
        return "done", (opens_at(ticket.scheduled_at) if ticket.scheduled_at else None)
    if not ticket.scheduled_at:
        return "flexible", None
    now = now or utcnow()
    opens = opens_at(ticket.scheduled_at)
    if now < opens:
        return "waiting", opens
    if now > ticket.scheduled_at + DISPATCH_GRACE:
        return "missed", opens
    return "open", opens


# ------------------------------------------------------------------------------------------------ calling hours

CALL_TZ_OFFSET = timedelta(hours=5, minutes=30)  # calling hours are India time (IST)


def _hhmm(value: str) -> tuple[int, int]:
    h, m = (int(x) for x in str(value).strip().split(":")[:2])
    return h, m


def _label(h: int, m: int) -> str:
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def calling_hours_state(db: Session, now: datetime | None = None) -> dict:
    """{open, start, end, label, next_open}: whether the calling agent may place calls right now (India time).
    A window like 21:00-06:00 that crosses midnight works too."""
    r = runtime_settings(db)
    now_ist = (now or utcnow()) + CALL_TZ_OFFSET
    try:
        (sh, sm), (eh, em) = _hhmm(r.calling_hours_start), _hhmm(r.calling_hours_end)
    except (TypeError, ValueError):
        return {"open": True, "start": r.calling_hours_start, "end": r.calling_hours_end, "label": "any time", "next_open": None}
    t = now_ist.hour * 60 + now_ist.minute
    start, end = sh * 60 + sm, eh * 60 + em
    is_open = start <= t < end if start < end else (t >= start or t < end)
    next_open = None
    if not is_open:
        day = now_ist.replace(hour=sh, minute=sm, second=0, microsecond=0)
        if day <= now_ist:
            day += timedelta(days=1)
        next_open = (day - CALL_TZ_OFFSET).isoformat()
    return {
        "open": is_open,
        "start": f"{sh:02d}:{sm:02d}",
        "end": f"{eh:02d}:{em:02d}",
        "label": f"{_label(sh, sm)} – {_label(eh, em)} IST",
        "next_open": next_open,
    }


def within_calling_hours(db: Session) -> bool:
    return calling_hours_state(db)["open"]
