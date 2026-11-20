"""The task-alert template as the WhatsApp Dispatch dashboard shows it: Meta status, text, how each blank is filled
(with a real recent task as the example) and how today's alerts actually went out (template vs. text fallback)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.integrations.mapping import ist_text
from app.branding import task_link
from app.config import get_settings
from app.database import get_db
from app.models import Ticket, WhatsAppMessage

from .meta_client import get_meta_whatsapp_client, param_text
from .models import WhatsAppDispatchPayload
from .service import TASK_ALERT_TEMPLATE, _alert_values, get_whatsapp_service

router = APIRouter(prefix="/task-alert-template", tags=["WhatsApp Dispatch"])

IST = timezone(timedelta(hours=5, minutes=30))
VARIABLES = [
    ("1", "Helper's first name"),
    ("2", "Service (task category)"),
    ("3", "Task title"),
    ("4", "Location"),
    ("5", "Schedule"),
    ("6", "Payout"),
]
ALERT_PURPOSES = ("broadcast", "agent_broadcast", "work_order")


def _sample(db: Session, ticket_id: str | None = None) -> dict[str, Any]:
    """Example values from the given task, else the most recent real task (falls back to a made-up one)."""
    s = get_settings()
    t = db.get(Ticket, ticket_id) if ticket_id else None
    t = t or (db.query(Ticket).filter(Ticket.category.isnot(None)).order_by(Ticket.scheduled_at.desc().nullslast()).first())
    if not t:
        return {"ticket_id": "6912ab34cd56ef7890123456", "from_real_task": False,
                "values": ["Ravi", "Home Cleaning", "2BHK deep cleaning", "Madhapur, Hyderabad", "18 Nov, 10:00 AM",
                           f"{s.currency_symbol}800"]}
    schedule = ist_text(t.scheduled_at)
    payout = f"{s.currency_symbol}{t.budget:g}" if t.budget else "To be confirmed"
    return {"ticket_id": t.id, "from_real_task": True,
            "values": ["Ravi", t.category or t.title or "Service", t.title or t.category or "Task",
                       t.address or t.city or "Nearby", schedule, payout]}


@router.get("")
async def task_alert_template(ticket_id: str | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    """The template, filled for ``ticket_id`` when given (the WhatsApp task view), else for the latest task."""
    meta = get_meta_whatsapp_client()
    live = {}
    error = None
    try:
        live = next((t for t in await meta.fetch_meta_templates() if t.get("name") == TASK_ALERT_TEMPLATE), {}) or {}
    except Exception as e:  # noqa: BLE001
        error = str(e)[:200]
    comps = live.get("components") or []
    body = next((c.get("text", "") for c in comps if c.get("type") == "BODY"), "")
    footer = next((c.get("text", "") for c in comps if c.get("type") == "FOOTER"), "")
    btn = next((b for c in comps if c.get("type") == "BUTTONS" for b in c.get("buttons", [])), None)
    status = str(live.get("status") or ("NOT_FOUND" if not error else "UNKNOWN")).upper()

    sample = _sample(db, ticket_id)
    values = [param_text(v) for v in _alert_values(sample["values"])]  # exactly as a real alert fills them
    filled = re.sub(r"\{\{\s*(\d+)\s*\}\}", lambda m: values[int(m.group(1)) - 1] if 0 < int(m.group(1)) <= len(values) else m.group(0), body)
    fallback = get_whatsapp_service().format_task_dispatch_message(WhatsAppDispatchPayload(
        ticket_id=sample["ticket_id"], helper_id="sample", helper_phone="0", helper_name=values[0],
        task_title=values[2], location=values[3], scheduled_time=values[4], payout=values[5].lstrip(get_settings().currency_symbol),
        service=values[1],
    ))

    midnight = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    rows = (db.query(WhatsAppMessage.kind, WhatsAppMessage.status)
            .filter(WhatsAppMessage.direction == "out", WhatsAppMessage.source == "automation",
                    WhatsAppMessage.purpose.in_(ALERT_PURPOSES), WhatsAppMessage.created_at >= midnight).all())
    today = {"template": 0, "text": 0, "failed": 0}
    for kind, st in rows:
        if st == "failed":
            today["failed"] += 1
        elif kind == "template":
            today["template"] += 1
        else:
            today["text"] += 1

    return {
        "name": TASK_ALERT_TEMPLATE,
        "status": status,
        "category": str(live.get("category") or "UTILITY").upper(),
        "language": live.get("language") or "en",
        "rejected_reason": live.get("rejected_reason") if status == "REJECTED" else None,
        "in_use": "template" if status == "APPROVED" else "text",
        "body": body,
        "footer": footer,
        "button": {"text": btn.get("text"), "url": btn.get("url")} if btn else None,
        "variables": [{"n": n, "label": label, "example": values[int(n) - 1]} for n, label in VARIABLES],
        "sample": {"filled_body": filled, "task_url": task_link(sample["ticket_id"]), "from_real_task": sample["from_real_task"],
                   "ticket_id": sample["ticket_id"]},
        "fallback_text": fallback,
        "today": today,
        "error": error,
    }
