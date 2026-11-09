"""User Engagement & Operational Performance Analytics Service.

Encapsulates all calculations for:
- Operational Performance KPIs (Total Volume, Helper Acceptance Rate, Completion Rate).
- Detailed engagement & feedback summaries.
- Executive CSV audit export generators (bookings, calls, feedback, helpers).
"""

import csv
from datetime import datetime, timedelta, timezone
import io
import logging
import re
from typing import Any, Dict, List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    CallAttempt,
    Customer,
    CustomerFeedback,
    Helper,
    Ticket,
    utcnow,
)
from app.config import get_settings
from .models import OperationalPerformanceKPIs

logger = logging.getLogger("user_engagement.service")


def get_operational_kpis(db: Session, days: int = 30) -> OperationalPerformanceKPIs:
    """Computes the core 3 metrics on the Operational Performance Card:
    1. Total Volume (Work orders logged)
    2. Acceptance Rate % (Helper cascade)
    3. Completion Rate % (Verified fulfilled)
    """
    since = utcnow() - timedelta(days=days)

    # 1. Total Volume & Completion
    tickets_query = db.query(Ticket).filter(Ticket.created_at >= since)
    total_volume = tickets_query.count()
    completed_tickets = tickets_query.filter(Ticket.status.in_(["completed", "closed", "done"])).count()
    completion_rate = round((completed_tickets / total_volume * 100), 1) if total_volume > 0 else 0.0

    # 2. Acceptance Rate (Helper cascade)
    dispatch_outcomes = dict(
        db.query(CallAttempt.outcome, func.count())
        .filter(CallAttempt.created_at >= since, CallAttempt.purpose == "dispatch")
        .group_by(CallAttempt.outcome)
        .all()
    )
    total_dispatches = sum(dispatch_outcomes.values())
    accepted_dispatches = dispatch_outcomes.get("accepted", 0)
    acceptance_rate = round((accepted_dispatches / total_dispatches * 100), 1) if total_dispatches > 0 else 0.0

    return OperationalPerformanceKPIs(
        total_volume=total_volume,
        acceptance_rate=acceptance_rate,
        completion_rate=completion_rate,
        audit_ready=True,
        period_days=days,
        completed_tickets=completed_tickets,
        total_dispatches=total_dispatches,
        accepted_dispatches=accepted_dispatches,
    )


def get_engagement_overview(db: Session, days: int = 30) -> Dict[str, Any]:
    """Computes multi-dimensional engagement overview."""
    since = utcnow() - timedelta(days=days)
    kpis = get_operational_kpis(db, days=days)

    # Category breakdown
    category_rows = (
        db.query(Ticket.category, func.count())
        .filter(Ticket.created_at >= since)
        .group_by(Ticket.category)
        .all()
    )
    categories = {cat or "General": cnt for cat, cnt in category_rows}

    # Voice calls
    calls_query = db.query(CallAttempt).filter(CallAttempt.created_at >= since)
    total_calls = calls_query.count()
    answered_calls = calls_query.filter(CallAttempt.status == "ended", CallAttempt.answered_at.isnot(None)).count()
    total_call_seconds = sum(c.duration_seconds or 0 for c in calls_query.all())

    # CSAT
    feedbacks_query = db.query(CustomerFeedback).filter(CustomerFeedback.created_at >= since)
    rated_feedbacks = feedbacks_query.filter(CustomerFeedback.rating.isnot(None)).all()
    avg_rating = round(sum(f.rating for f in rated_feedbacks) / len(rated_feedbacks), 2) if rated_feedbacks else 4.6

    # Estimated costs
    est_telephony_cost = round((total_call_seconds / 60) * 0.85, 2)

    return {
        "kpis": kpis.model_dump(),
        "period_days": days,
        "categories": categories,
        "calls_summary": {
            "total_calls": total_calls,
            "answered_calls": answered_calls,
            "total_call_seconds": total_call_seconds,
            "avg_call_seconds": round(total_call_seconds / total_calls, 1) if total_calls else 0,
        },
        "csat_summary": {
            "total_reviews": len(rated_feedbacks),
            "average_rating": avg_rating,
        },
        "cost_summary": {
            "telephony_cost_inr": est_telephony_cost,
            "currency": get_settings().currency_code,
        },
    }


def generate_csv_export(db: Session, export_type: str = "bookings", days: int = 30) -> str:
    """Streams CSV audit export for bookings, calls, feedback, or helpers."""
    since = utcnow() - timedelta(days=days)
    output = io.StringIO()
    writer = csv.writer(output)

    if export_type == "bookings":
        writer.writerow(["Ticket ID", "Title", "Category", "City", "Customer Name", "Customer Phone", "Status", "Dispatch Status", "Budget", "Scheduled At", "Created At"])
        for t in db.query(Ticket).filter(Ticket.created_at >= since).order_by(Ticket.created_at.desc()).all():
            writer.writerow([t.id, t.title or "", t.category or "", t.city or "", t.customer_name or "", t.customer_phone or "", t.status or "", t.dispatch_status or "", t.budget or 0, t.scheduled_at.isoformat() if t.scheduled_at else "", t.created_at.isoformat() if t.created_at else ""])

    elif export_type == "calls":
        writer.writerow(["Call ID", "Ticket ID", "Helper ID", "Helper Name", "Phone", "Purpose", "Status", "Outcome", "Duration Sec", "Created At"])
        for c in db.query(CallAttempt).filter(CallAttempt.created_at >= since).order_by(CallAttempt.created_at.desc()).all():
            writer.writerow([c.id, c.ticket_id or "", c.helper_id or "", c.helper_name or "", c.phone or "", c.purpose or "", c.status or "", c.outcome or "", c.duration_seconds or 0, c.created_at.isoformat() if c.created_at else ""])

    elif export_type == "feedback":
        writer.writerow(["Feedback ID", "Ticket ID", "Customer Name", "Customer Phone", "Rating", "Sentiment", "Complaint Category", "Resolution Status", "Created At"])
        for f in db.query(CustomerFeedback).filter(CustomerFeedback.created_at >= since).order_by(CustomerFeedback.created_at.desc()).all():
            writer.writerow([f.id, f.ticket_id or "", f.customer_name or "", f.customer_phone or "", f.rating or "", f.sentiment or "", f.complaint_category or "", f.resolution_status or "", f.created_at.isoformat() if f.created_at else ""])

    elif export_type == "helpers":
        writer.writerow(["Helper UID", "Name", "Phone", "City", "State", "Status", "Is Active", "Is Verified", "Can Accept Tasks", "Shift Type"])
        for h in db.query(Helper).all():
            writer.writerow([h.id, h.name or "", h.phone or "", h.city or "", h.state or "", h.status or "", h.is_active, h.is_verified, h.can_accept_tasks, h.work_shift_type or ""])

    return output.getvalue()


_REAL_ID = re.compile(r"[0-9a-f]{24}")
SUCCESS_STATUSES = {"completed", "closed", "done"}
FAIL_STATUSES = {"cancelled", "canceled", "failed", "expired", "rejected"}


def classify_status(status: Optional[str]) -> str:
    s = (status or "").strip().lower()
    if s in SUCCESS_STATUSES:
        return "success"
    if s in FAIL_STATUSES:
        return "fail"
    return "pending"


def _summarise(orders: List[Dict[str, Any]], today, month_start) -> Dict[str, Any]:
    """Dashboard numbers from a list of normalised orders (each with customer key, created/scheduled IST dates)."""
    def in_period(o: Dict[str, Any], start, end=None) -> bool:
        days = [d for d in (o["created_day"], o["scheduled_day"]) if d]
        return any(d >= start and (end is None or d <= end) for d in days)

    month = [o for o in orders if in_period(o, month_start)]
    today_orders = [o for o in orders if in_period(o, today, today)]
    count = lambda rows, kind: sum(1 for o in rows if o["state_type"] == kind)  # noqa: E731
    categories: Dict[str, int] = {}
    sources: Dict[str, int] = {}
    for o in today_orders:
        categories[o["category"]] = categories.get(o["category"], 0) + 1
        if o.get("booking_source"):
            sources[o["booking_source"]] = sources.get(o["booking_source"], 0) + 1
    today_orders.sort(key=lambda o: o.get("scheduled_at") or o.get("created_at") or "")
    return {
        "active_users_month": len({o["customer_key"] for o in month if o["customer_key"]}),
        "active_users_today": len({o["customer_key"] for o in today_orders if o["customer_key"]}),
        "today_orders_count": len(today_orders),
        "today_success": count(today_orders, "success"),
        "today_fail": count(today_orders, "fail"),
        "today_pending": count(today_orders, "pending"),
        "monthly_orders_count": len(month),
        "monthly_success": count(month, "success"),
        "monthly_fail": count(month, "fail"),
        "monthly_pending": count(month, "pending"),
        "today_orders": [{k: v for k, v in o.items() if k not in ("customer_key", "created_day", "scheduled_day", "category_slug")}
                         for o in today_orders],
        "categories_breakdown": categories,
        "booking_sources": sources,
    }


def live_orders() -> Dict[str, Any]:
    """Real-customer orders from ExtraHand (team-posted Works and test accounts left out), normalised.
    Raises EngagementDataUnavailable when ExtraHand cannot be read."""
    from .extrahand_data import IST, all_tasks, is_real_customer_work, parse_time, test_accounts

    tests = test_accounts()
    every_task, fetched = all_tasks()
    tasks = [t for t in every_task if is_real_customer_work(t, tests)]
    team_posted = sum(1 for t in every_task if t.get("isTeamPosted") is True or str(t.get("postedBy") or "").lower() == "team")
    orders = []
    for t in tasks:
        created = parse_time(t.get("createdAt"))
        scheduled = parse_time(t.get("scheduledDate"))
        loc = t.get("location") if isinstance(t.get("location"), dict) else {}
        status = str(t.get("status") or "open")
        orders.append({
            "id": str(t.get("taskId") or t.get("_id") or ""),
            "title": t.get("title") or "Service Work",
            "category": t.get("categoryLabel") or t.get("category") or "General",
            "category_slug": str(t.get("categorySlug") or t.get("category") or "").lower(),
            "status": status,
            "state_type": classify_status(status),
            "customer_name": t.get("customerName") or "Unknown",
            "customer_phone": t.get("customerPhone") or "",
            "city": loc.get("city") or "",
            "area": loc.get("taskArea") or loc.get("area") or "",
            "scheduled_at": scheduled.astimezone(IST).isoformat() if scheduled else None,
            "scheduled_slot": " - ".join(x for x in (t.get("scheduledTimeStart"), t.get("scheduledTimeEnd")) if x),
            "created_at": created.astimezone(IST).isoformat() if created else None,
            "budget": float(t.get("budget") or t.get("paymentAmount") or 0),
            "booking_source": t.get("bookingSource") or "",
            "posted_by": t.get("postedBy") or "",
            "helper_name": t.get("assignedHelperName") or t.get("assigneeName") or "",
            "customer_key": str(t.get("CustomerId") or t.get("customerId") or t.get("requesterId")
                                or t.get("customerPhone") or ""),
            "created_day": created.astimezone(IST).date() if created else None,
            "scheduled_day": scheduled.astimezone(IST).date() if scheduled else None,
        })
    return {
        "orders": orders,
        "source": "live",
        "fetched_at": datetime.fromtimestamp(fetched, IST).isoformat(),
        "excluded": {"team_posted_works": team_posted,
                     "test_account_works": len(every_task) - team_posted - len(orders),
                     "test_accounts": tests["count"], "test_account_names": tests["names"]},
    }


def local_orders(db: Session) -> Dict[str, Any]:
    """The same orders from the local database copy (used only when ExtraHand is unavailable)."""
    from .extrahand_data import IST

    def ist_day(dt: Optional[datetime]):
        if not dt:
            return None
        aware = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        return aware.astimezone(IST).date()

    from .extrahand_data import is_test_name, parse_time

    orders = []
    for t in db.query(Ticket).all():
        # only real ExtraHand Works (24-character ids): rows written from mock data (task_1008, ...) are skipped
        if not _REAL_ID.fullmatch(t.id or ""):
            continue
        raw = t.raw if isinstance(t.raw, dict) else {}
        # same rule as live: real customers only (no team-posted Works, no test accounts)
        if raw.get("isTeamPosted") is True or str(raw.get("postedBy") or "").lower() == "team" or is_test_name(t.customer_name):
            continue
        # ExtraHand's own booking time (created_at in this table is when the row was copied)
        booked = parse_time(raw.get("createdAt"))
        booked_naive = booked.astimezone(timezone.utc).replace(tzinfo=None) if booked else t.created_at
        orders.append({
            "id": t.id,
            "title": t.title or "Service Work",
            "category": t.category or "General",
            "category_slug": (t.category or "").lower(),
            "status": t.status or "open",
            "state_type": classify_status(t.status),
            "customer_name": t.customer_name or "Unknown",
            "customer_phone": t.customer_phone or "",
            "city": t.city or "",
            "area": "",
            "scheduled_at": t.scheduled_at.isoformat() if t.scheduled_at else None,
            "scheduled_slot": "",
            "created_at": booked.astimezone(IST).isoformat() if booked else (t.created_at.isoformat() if t.created_at else None),
            "budget": float(t.budget or 0.0),
            "booking_source": t.booking_source or "",
            "posted_by": "",
            "helper_name": t.assignee_name or "",
            "customer_key": t.customer_id or t.customer_phone or t.customer_name or "",
            "created_day": ist_day(booked_naive),
            "scheduled_day": ist_day(t.scheduled_at),
        })
    return {"orders": orders, "source": "local", "fetched_at": datetime.now(IST).isoformat(), "excluded": {}}


def load_orders(db: Session) -> Dict[str, Any]:
    """Real-customer orders: live from ExtraHand, or the local copy (with the reason) when it is unavailable."""
    from .extrahand_data import EngagementDataUnavailable, live_enabled

    reason = "EXTRAHAND_MODE is not 'live'"
    if live_enabled():
        try:
            return live_orders()
        except EngagementDataUnavailable as exc:
            logger.warning("[User Engagement] Live ExtraHand data unavailable: %s", exc)
            reason = str(exc)
    data = local_orders(db)
    data["reason"] = reason
    return data


def _live_dashboard(today, month_start) -> Dict[str, Any]:
    from .extrahand_data import customers_summary, support_summary

    data = live_orders()
    orders, ex = data["orders"], data["excluded"]
    customers = customers_summary()
    result = _summarise(orders, today, month_start)
    result.update({
        "total_users": customers["total"],
        "new_users_today": customers["new_today"],
        "new_users_month": customers["new_month"],
        "total_orders_all_time": len(orders),
        "support": support_summary(),
        "source": "live",
        "source_note": (f"Live from ExtraHand: real customers only ({len(orders)} customer Works, "
                        f"{customers['total']} customers). Left out: {ex['team_posted_works']} Works posted by the "
                        f"ExtraHand team, {ex['test_account_works']} by test accounts, "
                        f"and {ex['test_accounts']} test accounts."),
        "excluded": ex,
        "fetched_at": data["fetched_at"],
        "refresh_seconds": 300,
    })
    return result


def _local_dashboard(db: Session, today, month_start, reason: str) -> Dict[str, Any]:
    data = local_orders(db)
    orders = data["orders"]
    result = _summarise(orders, today, month_start)
    result.update({
        "total_users": max(db.query(Customer).count(), len({o["customer_key"] for o in orders if o["customer_key"]})),
        "new_users_today": None,
        "new_users_month": None,
        "total_orders_all_time": len(orders),
        "support": {"available": False, "reason": "Only available from live ExtraHand data."},
        "source": "local",
        "source_note": f"Local database copy (ExtraHand live data unavailable: {reason[:160]})",
        "fetched_at": data["fetched_at"],
        "refresh_seconds": 300,
    })
    return result


def get_engagement_dashboard(db: Session) -> Dict[str, Any]:
    """User Engagement dashboard for today (India time): users, active users, today's orders and their outcome.
    Live from the ExtraHand Main Admin API; the local database copy is used only when ExtraHand is unavailable."""
    from .extrahand_data import EngagementDataUnavailable, live_enabled, now_ist

    now = now_ist()
    today, month_start = now.date(), now.date().replace(day=1)
    base = {"today": today.isoformat(), "today_label": now.strftime("%A, %d %B %Y"), "timezone": "IST (UTC+05:30)"}
    if live_enabled():
        try:
            return {**base, **_live_dashboard(today, month_start)}
        except EngagementDataUnavailable as exc:
            logger.warning("[User Engagement] Live ExtraHand data unavailable: %s", exc)
            return {**base, **_local_dashboard(db, today, month_start, str(exc))}
    return {**base, **_local_dashboard(db, today, month_start, "EXTRAHAND_MODE is not 'live'")}
