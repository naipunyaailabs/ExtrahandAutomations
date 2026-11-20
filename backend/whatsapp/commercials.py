"""WhatsApp commercials: usage and Meta charges of the WhatsApp Agent, split into Automation (work orders,
broadcasts, reminders, replies) and Bulk (Bulk Msgs campaigns).

Meta bills per delivered message by category (marketing, utility, authentication; service replies are free). Its
status webhooks carry a pricing object with the category and whether the message was billable; where that report
has arrived it is used as is ("measured"). Before it arrives a message is estimated: a free-form text is only
delivered inside the 24-hour customer-service window, where it is free, and a template is charged at the category
set in the rate card. Rates are editable because Meta's price list changes and differs by market.
"""

from __future__ import annotations

import json
from bisect import bisect_right
from calendar import monthrange
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AppSetting, Event, WhatsAppCampaign, WhatsAppMessage

router = APIRouter(prefix="/commercials", tags=["WhatsApp Commercials"])

IST = timezone(timedelta(hours=5, minutes=30))
RATES_KEY = "whatsapp_commercials_rates"
WINDOW = timedelta(hours=24)
Category = Literal["marketing", "utility", "authentication", "service"]


class WaRates(BaseModel):
    """Meta per-message rates for India in INR. Defaults are estimates of the published list price."""

    marketing: float = Field(0.88, ge=0)
    utility: float = Field(0.125, ge=0)
    authentication: float = Field(0.125, ge=0)
    service: float = Field(0.0, ge=0)
    automation_category: Category = "utility"  # what an automation template is billed as
    bulk_category: Category = "marketing"  # what a bulk template is billed as
    automation_budget: float = Field(2000.0, ge=0)
    bulk_budget: float = Field(5000.0, ge=0)

    def rate(self, category: str | None) -> float:
        return float(getattr(self, category or "", 0.0) or 0.0) if category in ("marketing", "utility", "authentication", "service") else 0.0


def _rates(db: Session) -> WaRates:
    row = db.get(AppSetting, RATES_KEY)
    if row:
        try:
            return WaRates(**json.loads(row.value))
        except (ValueError, TypeError):
            pass
    return WaRates()


@router.get("/rates")
def get_rates(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _rates(db).model_dump()


@router.put("/rates")
def put_rates(body: WaRates, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(AppSetting, RATES_KEY) or AppSetting(key=RATES_KEY)
    row.value = body.model_dump_json()
    db.add(row)
    db.commit()
    return body.model_dump()


# ------------------------------------------------------------------------------------------------- costing


def _r(x: float) -> float:
    return round(x, 2)


def _is_live(m: WhatsAppMessage) -> bool:
    return m.status != "simulated"


def _cost(m: WhatsAppMessage, r: WaRates, source: str) -> tuple[float, bool, str]:
    """(cost, measured, category) of one outbound message."""
    if m.status == "simulated" or not m.provider_message_id:
        return 0.0, True, "none"
    if m.billable is not None:  # Meta's own report
        cat = m.category or "service"
        return (r.rate(cat) if m.billable else 0.0), True, cat
    if m.status == "failed":
        return 0.0, True, "none"
    if m.kind == "template":
        cat = r.bulk_category if source == "bulk" else r.automation_category
        return r.rate(cat), False, cat
    return 0.0, False, "service"  # free-form text: deliverable only in the free service window


class _Inbound:
    """When each phone last wrote to us, to tell whether a text went inside the 24-hour service window."""

    def __init__(self, rows: list[tuple[str, datetime]]):
        self.by_phone: dict[str, list[datetime]] = defaultdict(list)
        for phone, t in rows:
            if phone and t:
                self.by_phone[_digits(phone)].append(t)
        for v in self.by_phone.values():
            v.sort()

    def in_window(self, phone: str | None, t: datetime) -> bool:
        times = self.by_phone.get(_digits(phone or ""), [])
        i = bisect_right(times, t)  # the last message they sent at or before this send
        return i > 0 and t - times[i - 1] <= WINDOW

    def replied(self, phone: str | None, t: datetime) -> bool:
        times = self.by_phone.get(_digits(phone or ""), [])
        i = bisect_right(times, t)  # their first message after this send
        return i < len(times) and times[i] - t <= timedelta(hours=48)


def _digits(p: str) -> str:
    d = "".join(c for c in p if c.isdigit())
    return d[-10:]


def _summarize(msgs: list[WhatsAppMessage], r: WaRates, source: str, inbound: _Inbound) -> dict[str, Any]:
    live = [m for m in msgs if _is_live(m)]
    accepted = [m for m in live if m.provider_message_id]
    api_failed = [m for m in live if not m.provider_message_id]
    delivery_failed = [m for m in accepted if m.status == "failed"]
    delivered = [m for m in accepted if m.status in ("delivered", "read")]
    read = [m for m in accepted if m.status == "read"]
    reported = [m for m in accepted if m.status in ("delivered", "read", "failed")]

    cost = measured_cost = est_cost = 0.0
    cats: dict[str, dict[str, float]] = defaultdict(lambda: {"messages": 0, "cost": 0.0})
    billable = free = 0
    for m in accepted:
        c, measured, cat = _cost(m, r, source)
        cost += c
        if measured:
            measured_cost += c
        else:
            est_cost += c
        if cat != "none":
            cats[cat]["messages"] += 1
            cats[cat]["cost"] += c
        billable += c > 0
        free += c == 0 and m.status != "failed"

    texts = [m for m in accepted if m.kind == "text"]
    outside = [m for m in texts if not inbound.in_window(m.phone, m.created_at)]
    tpl_cat = r.bulk_category if source == "bulk" else r.automation_category
    replied_phones = {_digits(m.phone or "") for m in accepted if inbound.replied(m.phone, m.created_at)}
    recipients = {_digits(m.phone or "") for m in accepted}

    reasons = Counter(f"{m.error_code or 'API'} · {m.error or 'Failed'}"[:120] for m in api_failed + delivery_failed)

    return {
        "attempted": len(live),
        "simulated": len(msgs) - len(live),
        "accepted": len(accepted),
        "api_failed": len(api_failed),
        "delivery_failed": len(delivery_failed),
        "failed": len(api_failed) + len(delivery_failed),
        "delivered": len(delivered),
        "read": len(read),
        "awaiting_report": len(accepted) - len(reported),
        "recipients": len(recipients),
        "replied": len(replied_phones),
        "delivery_rate": round(len(delivered) / len(accepted) * 100, 1) if accepted else 0,
        "read_rate": round(len(read) / len(delivered) * 100, 1) if delivered else 0,
        "reply_rate": round(len(replied_phones) / len(recipients) * 100, 1) if recipients else 0,
        "cost": _r(cost),
        "measured_cost": _r(measured_cost),
        "estimated_cost": _r(est_cost),
        "billable": billable,
        "free": free,
        "cost_per_delivered": _r(cost / len(delivered)) if delivered else 0,
        "cost_per_read": _r(cost / len(read)) if read else 0,
        "categories": [{"category": k, "messages": int(v["messages"]), "cost": _r(v["cost"])}
                       for k, v in sorted(cats.items(), key=lambda kv: -kv[1]["messages"])],
        "texts": len(texts),
        "templates": len(accepted) - len(texts),
        "texts_outside_window": len(outside),
        "template_equivalent_cost": _r(len(accepted) * r.rate(tpl_cat)),
        "template_category": tpl_cat,
        "failure_reasons": [{"reason": k, "count": v} for k, v in reasons.most_common(6)],
    }


def _midnight(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _utc(d: datetime) -> datetime:
    return d.astimezone(timezone.utc).replace(tzinfo=None)


def _between(msgs: list[WhatsAppMessage], a: datetime | None, b: datetime | None = None) -> list[WhatsAppMessage]:
    return [m for m in msgs if (a is None or m.created_at >= a) and (b is None or m.created_at < b)]


def _report(db: Session, source: str) -> dict[str, Any]:
    r = _rates(db)
    msgs = (db.query(WhatsAppMessage).filter(WhatsAppMessage.direction == "out", WhatsAppMessage.source == source)
            .order_by(WhatsAppMessage.created_at).all())
    inbound = _Inbound(db.query(WhatsAppMessage.phone, WhatsAppMessage.created_at)
                       .filter(WhatsAppMessage.direction == "in").all())
    now = datetime.now(IST)
    today = _midnight(now)
    week = today - timedelta(days=today.weekday())
    month = today.replace(day=1)
    prev_month = (month - timedelta(days=1)).replace(day=1)
    bounds = {"today": (today, None), "week": (week, None), "month": (month, None), "all": (None, None)}
    periods = {k: _summarize(_between(msgs, _utc(a) if a else None), r, source, inbound) for k, (a, _) in bounds.items()}
    previous = {
        "today": _summarize(_between(msgs, _utc(today - timedelta(days=1)), _utc(today)), r, source, inbound)["cost"],
        "week": _summarize(_between(msgs, _utc(week - timedelta(days=7)), _utc(week)), r, source, inbound)["cost"],
        "month": _summarize(_between(msgs, _utc(prev_month), _utc(month)), r, source, inbound)["cost"],
    }
    prev_counts = {
        "today": _summarize(_between(msgs, _utc(today - timedelta(days=1)), _utc(today)), r, source, inbound)["accepted"],
        "week": _summarize(_between(msgs, _utc(week - timedelta(days=7)), _utc(week)), r, source, inbound)["accepted"],
        "month": _summarize(_between(msgs, _utc(prev_month), _utc(month)), r, source, inbound)["accepted"],
    }

    daily = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        day = _summarize(_between(msgs, _utc(d), _utc(d + timedelta(days=1))), r, source, inbound)
        daily.append({"date": d.strftime("%Y-%m-%d"), "sent": day["accepted"], "delivered": day["delivered"],
                      "read": day["read"], "failed": day["failed"], "cost": day["cost"]})

    days_in_month = monthrange(now.year, now.month)[1]
    elapsed = (now - month).total_seconds() / 86400
    mtd = periods["month"]["cost"]
    budget = r.bulk_budget if source == "bulk" else r.automation_budget

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "periods": periods,
        "previous_cost": previous,
        "previous_sent": prev_counts,
        "daily": daily,
        "budget": {"budget": budget, "month_to_date": mtd,
                   "projected": _r(mtd / elapsed * days_in_month) if elapsed > 0.25 else mtd,
                   "days_elapsed": round(elapsed, 1), "days_in_month": days_in_month},
        "rates": r.model_dump(),
        "rates_customized": db.get(AppSetting, RATES_KEY) is not None,
        "ledger_since": msgs[0].created_at.isoformat() + "Z" if msgs else None,
        "_msgs": msgs,
        "_inbound": inbound,
        "_rates": r,
        "_bounds": {k: (_utc(a) if a else None) for k, (a, _) in bounds.items()},
    }


def _strip(rep: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in rep.items() if not k.startswith("_")}


PURPOSES = ("work_order", "broadcast", "agent_broadcast", "assignment", "reminder", "reply", "other")


@router.get("/automation")
def automation(db: Session = Depends(get_db)) -> dict[str, Any]:
    rep = _report(db, "automation")
    msgs, r, inbound = rep["_msgs"], rep["_rates"], rep["_inbound"]
    by_period: dict[str, Any] = {}
    for key, start in rep["_bounds"].items():
        window = _between(msgs, start)
        purposes = []
        for p in PURPOSES:
            rows = [m for m in window if (m.purpose if m.purpose in PURPOSES else "other") == p]
            if rows:
                s = _summarize(rows, r, "automation", inbound)
                purposes.append({"purpose": p, "sent": s["accepted"], "delivered": s["delivered"], "read": s["read"],
                                 "failed": s["failed"], "cost": s["cost"], "delivery_rate": s["delivery_rate"]})
        tickets = {m.ticket_id for m in window if m.ticket_id and m.provider_message_id}
        ev = db.query(Event).filter(Event.kind == "whatsapp_accepted")
        if start is not None:
            ev = ev.filter(Event.created_at >= start)
        accepted_jobs = ev.count()
        cost = rep["periods"][key]["cost"]
        by_period[key] = {
            "purposes": sorted(purposes, key=lambda x: -x["sent"]),
            "tickets": len(tickets),
            "messages_per_ticket": round(rep["periods"][key]["accepted"] / len(tickets), 1) if tickets else 0,
            "cost_per_ticket": _r(cost / len(tickets)) if tickets else 0,
            "jobs_accepted": accepted_jobs,
            "cost_per_acceptance": _r(cost / accepted_jobs) if accepted_jobs else 0,
        }
    out = _strip(rep)
    out["outcomes"] = by_period
    return out


@router.get("/bulk")
def bulk(db: Session = Depends(get_db)) -> dict[str, Any]:
    rep = _report(db, "bulk")
    msgs, r, inbound = rep["_msgs"], rep["_rates"], rep["_inbound"]
    by_campaign: dict[int, list[WhatsAppMessage]] = defaultdict(list)
    for m in msgs:
        if m.campaign_id is not None:
            by_campaign[m.campaign_id].append(m)
    campaigns = []
    for c in db.query(WhatsAppCampaign).order_by(WhatsAppCampaign.created_at.desc()).limit(50).all():
        s = _summarize(by_campaign.get(c.id, []), r, "bulk", inbound)
        campaigns.append({
            "id": c.id, "created_at": c.created_at.isoformat() + "Z", "message_preview": c.message_preview,
            "total": c.total, "sent": s["accepted"], "simulated": c.simulated or s["simulated"], "failed": s["failed"],
            "delivered": s["delivered"], "read": s["read"], "replied": s["replied"], "cost": s["cost"],
            "estimated": s["estimated_cost"] > 0 or (s["accepted"] > 0 and s["awaiting_report"] == s["accepted"]),
            "delivery_rate": s["delivery_rate"], "read_rate": s["read_rate"], "cost_per_read": s["cost_per_read"],
            "template_equivalent_cost": s["template_equivalent_cost"],
        })
    out = _strip(rep)
    out["campaigns"] = campaigns
    return out
