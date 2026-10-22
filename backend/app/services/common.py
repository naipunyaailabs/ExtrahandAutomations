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


EDITABLE_KEYS = {"followup_offsets_minutes", "auto_dispatch", "max_helpers_per_ticket", "match_radius_km"}


def _parse_offsets(v: str | list) -> list[int]:
    items = v if isinstance(v, list) else str(v).split(",")
    return sorted({int(x) for x in items if str(x).strip() and int(x) > 0}, reverse=True)


def runtime_settings(db: Session) -> RuntimeSettings:
    s = get_settings()
    raw: dict = {
        "followup_offsets_minutes": s.followup_offsets_minutes,
        "auto_dispatch": s.auto_dispatch,
        "max_helpers_per_ticket": s.max_helpers_per_ticket,
        "match_radius_km": s.match_radius_km,
    }
    for row in db.query(AppSetting).filter(AppSetting.key.in_(EDITABLE_KEYS)):
        raw[row.key] = row.value
    return RuntimeSettings(
        followup_offsets_minutes=_parse_offsets(raw["followup_offsets_minutes"]),
        auto_dispatch=str(raw["auto_dispatch"]).lower() in ("1", "true", "yes", "on"),
        max_helpers_per_ticket=int(raw["max_helpers_per_ticket"]),
        match_radius_km=float(raw["match_radius_km"]),
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
