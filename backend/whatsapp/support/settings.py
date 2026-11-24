"""WhatsApp Support switches, kept in app_settings. The agent starts OFF and, once on, in test mode (only the test
numbers get AI replies) so nothing reaches real customers until the team is ready."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AppSetting

KEYS = {
    "active": ("wa_support_active", False),
    "test_mode": ("wa_support_test_mode", True),
    "test_numbers": ("wa_support_test_numbers", ""),
    "notify_care": ("wa_support_notify_care", True),
}


def digits(phone: Any) -> str:
    return "".join(c for c in str(phone or "") if c.isdigit())


def phone_key(phone: Any) -> str:
    """Last 10 digits: the same number written with or without +91 matches."""
    return digits(phone)[-10:]


def _bool(v: str | None, default: bool) -> bool:
    return default if v is None else str(v).strip().lower() in ("1", "true", "yes", "on")


def get(db: Session) -> dict[str, Any]:
    rows = {r.key: r.value for r in db.query(AppSetting).filter(AppSetting.key.in_([k for k, _ in KEYS.values()]))}
    out: dict[str, Any] = {}
    for name, (key, default) in KEYS.items():
        raw = rows.get(key)
        out[name] = _bool(raw, default) if isinstance(default, bool) else (raw if raw is not None else default)
    out["test_numbers"] = [n for n in (x.strip() for x in str(out["test_numbers"]).split(",")) if n]
    return out


def save(db: Session, values: dict[str, Any]) -> dict[str, Any]:
    for name, (key, default) in KEYS.items():
        if name not in values or values[name] is None:
            continue
        v = values[name]
        if name == "test_numbers":
            items = v if isinstance(v, list) else str(v).split(",")
            seen, clean = set(), []
            for x in items:
                d = digits(x)
                if len(d) >= 10 and phone_key(d) not in seen:
                    seen.add(phone_key(d))
                    clean.append(("91" + d) if len(d) == 10 else d)
            v = ",".join(clean)
        elif isinstance(default, bool):
            v = "true" if _bool(str(v), default) else "false"
        row = db.get(AppSetting, key) or AppSetting(key=key)
        row.value = str(v)
        db.add(row)
    db.commit()
    return get(db)


def may_answer(db: Session, phone: str) -> bool:
    """The agent replies to this number: it is on, and (in test mode) the number is a test number."""
    s = get(db)
    if not s["active"]:
        return False
    if not s["test_mode"]:
        return True
    return phone_key(phone) in {phone_key(n) for n in s["test_numbers"]}
