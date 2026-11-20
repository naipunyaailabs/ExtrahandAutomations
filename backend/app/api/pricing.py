"""Competitive Pricing: our live ExtraHand prices per service next to competitor prices the team types in.

Our prices come from real-customer Works on ExtraHand (each Work's `budget` is the price of that service).
Competitor prices are entered on the Competitive Pricing page and stored in `competitor_prices`.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CompetitorPrice, utcnow

router = APIRouter(prefix="/api/pricing", tags=["pricing"])

SAME_BAND_PCT = 2.0  # within ±2% of the cheapest competitor counts as "same price"


def _key(name: str | None) -> str:
    return " ".join((name or "").split()).lower()


def _our_prices(db: Session) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Per service: how many Works, current (latest) price, average, lowest and highest, from live ExtraHand data."""
    from user_engagement.service import load_orders

    data = load_orders(db)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for o in data["orders"]:
        if (o.get("budget") or 0) > 0 and o.get("title"):
            groups[_key(o["title"])].append(o)

    out: dict[str, dict[str, Any]] = {}
    for key, orders in groups.items():
        orders.sort(key=lambda o: o.get("created_at") or "")
        prices = [float(o["budget"]) for o in orders]
        latest = orders[-1]
        out[key] = {
            "service": latest["title"],
            "category": latest.get("category") or "",
            "works": len(orders),
            "current_price": prices[-1],
            "avg_price": round(sum(prices) / len(prices), 2),
            "min_price": min(prices),
            "max_price": max(prices),
            "last_booked_at": latest.get("created_at"),
        }
    meta = {"source": data.get("source"), "fetched_at": data.get("fetched_at"), "note": data.get("reason")}
    return out, meta


def _price_out(p: CompetitorPrice) -> dict[str, Any]:
    return {"id": p.id, "service": p.service, "competitor": p.competitor, "price": p.price, "notes": p.notes,
            "updated_at": p.updated_at.isoformat() + "Z" if p.updated_at else None}


def pricing_overview(db: Session) -> dict[str, Any]:
    ours, meta = _our_prices(db)
    rivals: dict[str, list[CompetitorPrice]] = defaultdict(list)
    for p in db.query(CompetitorPrice).order_by(CompetitorPrice.price).all():
        rivals[_key(p.service)].append(p)

    rows = []
    for key in sorted(set(ours) | set(rivals), key=lambda k: (-(ours.get(k, {}).get("works") or 0), k)):
        mine = ours.get(key)
        theirs = rivals.get(key, [])
        cheapest = min(theirs, key=lambda p: p.price) if theirs else None
        row: dict[str, Any] = {
            "service": mine["service"] if mine else theirs[0].service,
            "category": mine["category"] if mine else "",
            "works": mine["works"] if mine else 0,
            "our_price": mine["current_price"] if mine else None,
            "avg_price": mine["avg_price"] if mine else None,
            "min_price": mine["min_price"] if mine else None,
            "max_price": mine["max_price"] if mine else None,
            "last_booked_at": mine["last_booked_at"] if mine else None,
            "competitors": [_price_out(p) for p in theirs],
            "cheapest_competitor": cheapest.competitor if cheapest else None,
            "cheapest_price": cheapest.price if cheapest else None,
            "gap": None, "gap_pct": None,
        }
        if mine and cheapest:
            gap = mine["current_price"] - cheapest.price
            pct = round(gap / cheapest.price * 100, 1) if cheapest.price else None
            row["gap"], row["gap_pct"] = round(gap, 2), pct
            row["position"] = ("same" if pct is not None and abs(pct) <= SAME_BAND_PCT
                               else "cheaper" if gap < 0 else "costlier")
        else:
            row["position"] = "no_competitor" if mine else "not_offered"
        rows.append(row)

    compared = [r for r in rows if r["gap_pct"] is not None]
    summary = {
        "services": sum(1 for r in rows if r["our_price"] is not None),
        "compared": len(compared),
        "cheaper": sum(1 for r in compared if r["position"] == "cheaper"),
        "same": sum(1 for r in compared if r["position"] == "same"),
        "costlier": sum(1 for r in compared if r["position"] == "costlier"),
        "avg_gap_pct": round(sum(r["gap_pct"] for r in compared) / len(compared), 1) if compared else None,
        "competitors": sorted({p.competitor for ps in rivals.values() for p in ps}, key=str.lower),
        "competitor_prices": sum(len(ps) for ps in rivals.values()),
    }
    return {"summary": summary, "services": rows, **meta}


class CompetitorPriceIn(BaseModel):
    service: str = Field(min_length=1, max_length=200)
    competitor: str = Field(min_length=1, max_length=120)
    price: float = Field(gt=0)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("service", "competitor")
    @classmethod
    def _tidy(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("must not be empty")
        return v


@router.get("")
def get_pricing(db: Session = Depends(get_db)):
    return pricing_overview(db)


@router.post("/competitor-prices")
def save_competitor_price(body: CompetitorPriceIn, db: Session = Depends(get_db)):
    """Add a competitor's price for a service, or update it if that competitor already has one."""
    existing = next((p for p in db.query(CompetitorPrice).all()
                     if _key(p.service) == _key(body.service) and _key(p.competitor) == _key(body.competitor)), None)
    p = existing or CompetitorPrice(service=body.service, competitor=body.competitor)
    p.price, p.notes, p.updated_at = body.price, (body.notes or "").strip() or None, utcnow()
    if not existing:
        db.add(p)
    db.commit()
    db.refresh(p)
    return _price_out(p)


@router.put("/competitor-prices/{price_id}")
def update_competitor_price(price_id: int, body: CompetitorPriceIn, db: Session = Depends(get_db)):
    p = db.get(CompetitorPrice, price_id)
    if not p:
        raise HTTPException(404, "Competitor price not found")
    p.service, p.competitor, p.price = body.service, body.competitor, body.price
    p.notes, p.updated_at = (body.notes or "").strip() or None, utcnow()
    db.commit()
    db.refresh(p)
    return _price_out(p)


@router.delete("/competitor-prices/{price_id}")
def delete_competitor_price(price_id: int, db: Session = Depends(get_db)):
    p = db.get(CompetitorPrice, price_id)
    if not p:
        raise HTTPException(404, "Competitor price not found")
    db.delete(p)
    db.commit()
    return {"ok": True}
