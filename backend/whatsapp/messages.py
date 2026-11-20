"""Sent Messages view: every WhatsApp message the platform sent, split by Meta category (utility / marketing).

A message's category comes from, in order:
  1. Meta's own pricing report (status webhook)            -> origin "meta"
  2. the approved template's category, recorded at send     -> origin "template"
  3. the commercials rate card by source (bulk -> marketing,
     automation / manual -> utility by default)             -> origin "estimated"
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, literal, or_
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.database import get_db
from app.models import WhatsAppMessage, utcnow

from .commercials import _rates

router = APIRouter(prefix="/messages", tags=["WhatsApp Sent Messages"])

MAIN = ("utility", "marketing")


def _resolved(db: Session):
    """SQL expression for a message's category (see module docstring)."""
    r = _rates(db)
    M = WhatsAppMessage
    return case(
        (M.category.isnot(None), func.lower(M.category)),
        (M.source == "bulk", literal(r.bulk_category)),
        else_=literal(r.automation_category),
    )


@router.get("")
def sent_messages(
    category: Literal["all", "utility", "marketing", "other"] = "all",
    source: Literal["all", "automation", "bulk", "manual", "welcome"] = "all",
    status: Literal["all", "sent", "delivered", "read", "failed", "simulated"] = "all",
    q: str = "",
    days: int = Query(30, ge=0, le=3650, description="0 = all time"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    M = WhatsAppMessage
    cat = _resolved(db)

    base = db.query(M).filter(M.direction == "out")
    if days:
        base = base.filter(M.created_at >= utcnow() - timedelta(days=days))
    if source != "all":
        base = base.filter(M.source == source)
    if status != "all":
        base = base.filter(M.status == status)
    if q.strip():
        like = f"%{q.strip()}%"
        base = base.filter(or_(M.phone.ilike(like), M.body.ilike(like), M.template.ilike(like), M.ticket_id.ilike(like)))

    # Tab counts honour every filter except the category itself
    counts = {"all": 0, "utility": 0, "marketing": 0, "other": 0}
    # Per tab: ok = went out (sent / delivered / read); failed = refused by Meta; unsent = simulated, never left
    outcomes = {k: {"ok": 0, "failed": 0, "unsent": 0} for k in counts}
    for name, st, n in base.with_entities(cat, M.status, func.count(M.id)).group_by(cat, M.status).all():
        tab = name if name in MAIN else "other"
        kind = "failed" if st == "failed" else "unsent" if st in ("simulated", "sending") else "ok"
        for key in ("all", tab):
            counts[key] += n
            outcomes[key][kind] += n

    rows_q = base
    if category in MAIN:
        rows_q = rows_q.filter(cat == category)
    elif category == "other":
        rows_q = rows_q.filter(cat.notin_(MAIN))

    total = rows_q.count()
    rows = rows_q.with_entities(M, cat).order_by(M.created_at.desc(), M.id.desc()).offset(offset).limit(limit).all()

    def origin(m: WhatsAppMessage) -> str:
        if m.billable is not None and m.category:
            return "meta"
        return "template" if m.category else "estimated"

    return {
        "counts": counts,
        "outcomes": outcomes,
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": m.id,
                "created_at": iso(m.created_at),
                "phone": m.phone,
                "source": m.source,
                "purpose": m.purpose,
                "kind": m.kind,
                "template": m.template,
                "body": m.body,
                "category": c,
                "category_origin": origin(m),
                "status": m.status,
                "error": m.error,
                "billable": m.billable,
                "ticket_id": m.ticket_id,
                "campaign_id": m.campaign_id,
                "delivered_at": iso(m.delivered_at),
                "read_at": iso(m.read_at),
            }
            for m, c in rows
        ],
    }
