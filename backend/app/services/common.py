import threading
from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AppSetting, Event

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
    # Emergency kill switch
    emergency_stop_calls: bool = False
    # Workflow toggles
    workflow_helper_dispatch_enabled: bool = True
    workflow_customer_feedback_enabled: bool = True
    workflow_whatsapp_dispatch_enabled: bool = True
    workflow_whatsapp_feedback_enabled: bool = True
    # Contact hours & delay
    calling_hours_start: str = "09:00"
    calling_hours_end: str = "21:00"
    feedback_call_delay_minutes: int = 15
    preferred_language: str = "en-IN"
    max_helper_call_attempts: int = 3
    # Cost estimation
    cost_per_call_minute: float = 0.50
    cost_per_whatsapp_msg: float = 0.25


EDITABLE_KEYS = {
    "followup_offsets_minutes",
    "auto_dispatch",
    "max_helpers_per_ticket",
    "match_radius_km",
    "emergency_stop_calls",
    "workflow_helper_dispatch_enabled",
    "workflow_customer_feedback_enabled",
    "workflow_whatsapp_dispatch_enabled",
    "workflow_whatsapp_feedback_enabled",
    "calling_hours_start",
    "calling_hours_end",
    "feedback_call_delay_minutes",
    "preferred_language",
    "max_helper_call_attempts",
    "cost_per_call_minute",
    "cost_per_whatsapp_msg",
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
    raw: dict = {
        "followup_offsets_minutes": s.followup_offsets_minutes,
        "auto_dispatch": s.auto_dispatch,
        "max_helpers_per_ticket": s.max_helpers_per_ticket,
        "match_radius_km": s.match_radius_km,
        "emergency_stop_calls": False,
        "workflow_helper_dispatch_enabled": True,
        "workflow_customer_feedback_enabled": True,
        "workflow_whatsapp_dispatch_enabled": True,
        "workflow_whatsapp_feedback_enabled": True,
        "calling_hours_start": "09:00",
        "calling_hours_end": "21:00",
        "feedback_call_delay_minutes": 15,
        "preferred_language": "en-IN",
        "max_helper_call_attempts": 3,
        "cost_per_call_minute": 0.50,
        "cost_per_whatsapp_msg": 0.25,
    }
    for row in db.query(AppSetting).filter(AppSetting.key.in_(EDITABLE_KEYS)):
        raw[row.key] = row.value

    return RuntimeSettings(
        followup_offsets_minutes=_parse_offsets(raw["followup_offsets_minutes"]),
        auto_dispatch=_to_bool(raw["auto_dispatch"]),
        max_helpers_per_ticket=int(raw["max_helpers_per_ticket"]),
        match_radius_km=float(raw["match_radius_km"]),
        emergency_stop_calls=_to_bool(raw["emergency_stop_calls"], False),
        workflow_helper_dispatch_enabled=_to_bool(raw["workflow_helper_dispatch_enabled"], True),
        workflow_customer_feedback_enabled=_to_bool(raw["workflow_customer_feedback_enabled"], True),
        workflow_whatsapp_dispatch_enabled=_to_bool(raw["workflow_whatsapp_dispatch_enabled"], True),
        workflow_whatsapp_feedback_enabled=_to_bool(raw["workflow_whatsapp_feedback_enabled"], True),
        calling_hours_start=str(raw["calling_hours_start"]),
        calling_hours_end=str(raw["calling_hours_end"]),
        feedback_call_delay_minutes=int(raw["feedback_call_delay_minutes"]),
        preferred_language=str(raw["preferred_language"]),
        max_helper_call_attempts=int(raw["max_helper_call_attempts"]),
        cost_per_call_minute=float(raw["cost_per_call_minute"]),
        cost_per_whatsapp_msg=float(raw["cost_per_whatsapp_msg"]),
    )


def save_runtime_settings(db: Session, values: dict) -> RuntimeSettings:
    for key, value in values.items():
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
