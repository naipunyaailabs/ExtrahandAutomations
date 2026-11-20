"""WhatsApp message ledger: what was sent, why, and what Meta delivered and billed. Feeds the two WhatsApp
commercials pages (Automation and Bulk).

Callers say what a send is for with `tagged(...)` around it; the Meta client records every send through
`record_outbound`. Meta's status webhooks then fill in delivered / read / failed and the pricing object (billable,
category), so cost comes from Meta's own report wherever it has arrived.

Recording never raises: a broken ledger must not stop a message.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator

logger = logging.getLogger("whatsapp.metering")

_TAG: ContextVar[dict[str, Any]] = ContextVar("whatsapp_send_tag", default={})


@contextmanager
def tagged(source: str = "automation", purpose: str = "other", ticket_id: str | None = None,
           campaign_id: int | None = None, override: bool = True) -> Iterator[None]:
    """Labels the WhatsApp sends made inside this block (works across awaits and tasks started inside it).
    With override=False an outer label wins (e.g. a broadcast's sends stay "broadcast")."""
    if not override and _TAG.get():
        yield
        return
    token = _TAG.set({"source": source, "purpose": purpose, "ticket_id": ticket_id, "campaign_id": campaign_id})
    try:
        yield
    finally:
        _TAG.reset(token)


def _write(rows: list[dict[str, Any]]) -> None:
    try:
        from app.database import SessionLocal
        from app.models import WhatsAppMessage

        with SessionLocal() as db:
            db.add_all(WhatsAppMessage(**r) for r in rows)
            db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not record WhatsApp message: %s", exc)


async def record_outbound(phone: str, status: str, message_id: str | None, kind: str = "text",
                          template: str | None = None, error: str | None = None, body: str | None = None,
                          category: str | None = None) -> None:
    """`body` is the text the recipient saw; `category` is the template's Meta category until Meta's own
    pricing report (status webhook) replaces it."""
    tag = _TAG.get()
    row = {
        "direction": "out", "source": tag.get("source", "automation"), "purpose": tag.get("purpose", "other"),
        "ticket_id": tag.get("ticket_id"), "campaign_id": tag.get("campaign_id"), "kind": kind, "template": template,
        "phone": phone, "provider_message_id": message_id, "status": status, "error": (error or "")[:300] or None,
        "body": (body or "")[:4000] or None,
        "category": (category or "").lower()[:20] or None,
    }
    await asyncio.to_thread(_write, [row])


def _ts(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


_RANK = {"simulated": 0, "sent": 1, "delivered": 2, "read": 3}


def inbound_text(m: dict[str, Any]) -> str | None:
    """What the person sent, as readable text (kept exactly as typed for text messages)."""
    kind = m.get("type")
    if kind == "text":
        return ((m.get("text") or {}).get("body") or "")[:4000] or None
    if kind == "interactive":
        it = m.get("interactive") or {}
        if it.get("type") == "nfm_reply":
            return ("Form submitted: " + ((it.get("nfm_reply") or {}).get("response_json") or ""))[:4000]
        reply = it.get("button_reply") or it.get("list_reply") or {}
        return reply.get("title")
    if kind == "button":
        return (m.get("button") or {}).get("text")
    if kind in ("image", "video", "document", "audio", "sticker"):
        caption = (m.get(kind) or {}).get("caption")
        return f"[{kind}]" + (f" {caption}" if caption else "")
    return f"[{kind}]" if kind else None


def apply_webhook(data: dict[str, Any]) -> None:
    """Records inbound messages and applies Meta's status reports (delivery, read, failure, pricing)."""
    try:
        from app.database import SessionLocal
        from app.models import WhatsAppMessage

        with SessionLocal() as db:
            for entry in data.get("entry") or []:
                for change in entry.get("changes") or []:
                    value = change.get("value") or {}
                    for m in value.get("messages") or []:
                        db.add(WhatsAppMessage(direction="in", source="inbound", purpose="inbound",
                                               kind=(m.get("type") or "text")[:10], phone=m.get("from"),
                                               provider_message_id=m.get("id"), status="received",
                                               body=inbound_text(m),
                                               created_at=_ts(m.get("timestamp")) or datetime.now(timezone.utc).replace(tzinfo=None)))
                    for st in value.get("statuses") or []:
                        row = db.query(WhatsAppMessage).filter(WhatsAppMessage.provider_message_id == st.get("id"),
                                                               WhatsAppMessage.direction == "out").first()
                        if row is None:
                            continue
                        state, at = st.get("status"), _ts(st.get("timestamp"))
                        if state == "failed":
                            row.status = "failed"
                            err = (st.get("errors") or [{}])[0]
                            row.error_code = str(err.get("code") or "")[:20] or None
                            row.error = (err.get("title") or err.get("message") or "Failed at Meta")[:300]
                        elif state in ("delivered", "read"):
                            if _RANK.get(state, 0) > _RANK.get(row.status, 0):
                                row.status = state
                            if state == "delivered" and not row.delivered_at:
                                row.delivered_at = at
                            if state == "read":
                                row.read_at = row.read_at or at
                                row.delivered_at = row.delivered_at or at
                        pricing = st.get("pricing") or {}
                        if pricing:
                            row.billable = bool(pricing.get("billable"))
                            row.category = pricing.get("category") or row.category
                            row.pricing_type = pricing.get("type") or row.pricing_type
            db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not apply WhatsApp webhook to the ledger: %s", exc)
