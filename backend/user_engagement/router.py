"""User Engagement & Operational Performance Router."""

from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from .models import OperationalPerformanceKPIs, EngagementDashboardSummary
from .service import get_operational_kpis, get_engagement_overview, generate_csv_export, get_engagement_dashboard

engagement_router = APIRouter(tags=["User Engagement & Analytics"])


@engagement_router.on_event("startup")
def _start_engagement_poller() -> None:
    """Keep the dashboard's ExtraHand data fresh (read every 5 minutes in the background)."""
    import os
    if os.getenv("TESTING") == "1" or os.getenv("PYTEST_CURRENT_TEST"):
        return
    from .extrahand_data import start_poller

    start_poller()

# 1. Primary User Engagement Routes
@engagement_router.get("/api/engagement/dashboard", response_model=EngagementDashboardSummary)
def get_engagement_dashboard_endpoint(
    db: Session = Depends(get_db),
):
    """User Engagement dashboard for today (India time), live from the ExtraHand Main Admin API
    (Works read at most every 5 minutes); the local database copy is used only when ExtraHand is unavailable:
    - today's date, data source and when it was read
    - total / new customers, active customers this month and today
    - today's orders with success / fail / pending counts, and this month's totals
    - customer-care support tickets (when the ExtraHand support API is available)
    """
    return get_engagement_dashboard(db)


@engagement_router.get("/api/engagement/regions")
def get_regions_endpoint() -> Dict[str, Any]:
    """Customers and helpers by state and city, from the location saved in each ExtraHand account. Every state and
    city found in the data is listed, so new ones appear on their own (refreshed every 5 minutes)."""
    from fastapi import HTTPException

    from .extrahand_data import EngagementDataUnavailable, live_enabled
    from .regions import regions_summary

    if not live_enabled():
        raise HTTPException(503, "Regions need live ExtraHand data (EXTRAHAND_MODE=live).")
    try:
        data = regions_summary()
        return data if data is not None else {"loading": True}
    except EngagementDataUnavailable as exc:
        raise HTTPException(503, f"ExtraHand is not reachable right now: {exc}") from exc


@engagement_router.get("/api/engagement/cancellations/summary")
def get_cancellations_summary_endpoint(
    side: str = Query(default="customer", pattern="^(customer|team|unknown|all)$"),
    date_from: Optional[str] = Query(default=None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(default=None, alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    city: Optional[str] = None,
    category: Optional[str] = None,
    reason: Optional[str] = None,
    q: Optional[str] = None,
) -> Dict[str, Any]:
    """The numbers on the Cancelled Works cards, computed here from the live ExtraHand data for the given filters:
    cancelled (count, booking value, % of finished bookings), refunded (count, %, returned, paid), not refunded
    (count, %, value, paid bookings), completed (count, money received, average). Dates are India days (to exclusive)."""
    from fastapi import HTTPException

    from .cancellations import cancellations_summary, summarize
    from .extrahand_data import EngagementDataUnavailable, live_enabled

    if not live_enabled():
        raise HTTPException(503, "Cancelled Works need live ExtraHand data (EXTRAHAND_MODE=live).")
    try:
        data = cancellations_summary()
    except EngagementDataUnavailable as exc:
        raise HTTPException(503, f"ExtraHand is not reachable right now: {exc}") from exc
    if data is None:
        return {"loading": True}
    return summarize(data, side, date_from, date_to, city, category, reason, q)


@engagement_router.get("/api/engagement/cancellations")
def get_cancellations_endpoint() -> Dict[str, Any]:
    """Every real-customer Work that was cancelled, newest first: who cancelled it (customer / ExtraHand team /
    not recorded), the reason, when, and whether it was refunded ({loading: true} during the first read)."""
    from fastapi import HTTPException

    from .cancellations import cancellations_summary
    from .extrahand_data import EngagementDataUnavailable, live_enabled

    if not live_enabled():
        raise HTTPException(503, "Cancelled Works need live ExtraHand data (EXTRAHAND_MODE=live).")
    try:
        data = cancellations_summary()
        return data if data is not None else {"loading": True}
    except EngagementDataUnavailable as exc:
        raise HTTPException(503, f"ExtraHand is not reachable right now: {exc}") from exc


@engagement_router.get("/api/engagement/refunds")
def get_refunds_endpoint() -> Dict[str, Any]:
    """Every refund to a real customer, newest first, joined to its Work: amount, what was paid, fee kept, status,
    Razorpay id, reason, who started it and how long after the cancellation ({loading: true} during the first read)."""
    from fastapi import HTTPException

    from .extrahand_data import EngagementDataUnavailable, live_enabled
    from .refunds import refunds_summary

    if not live_enabled():
        raise HTTPException(503, "Refunds need live ExtraHand data (EXTRAHAND_MODE=live).")
    try:
        data = refunds_summary()
        return data if data is not None else {"loading": True}
    except EngagementDataUnavailable as exc:
        raise HTTPException(503, f"ExtraHand is not reachable right now: {exc}") from exc


@engagement_router.get("/api/engagement/categories")
def get_customer_categories_endpoint(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Category module: real customers of the month (YYYY-MM, default this month, India time) grouped by
    orders placed - Diamond 8+, Gold 5-7, Platinum 1-4, Silver 0 (no order in the month)."""
    from .categories import get_customer_categories

    return get_customer_categories(db, month)


@engagement_router.get("/api/engagement/categories/silver")
def get_silver_customers_endpoint(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    page: int = Query(default=1, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Silver customers (no order in the month), one page at a time, newest registrations first."""
    from .categories import get_silver_customers

    return get_silver_customers(db, month, page)


@engagement_router.get("/api/engagement/kpis", response_model=OperationalPerformanceKPIs)
def get_engagement_kpis(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Returns the 3 headline KPIs for the Reports & Analytics card:
    - Total Volume (Work orders logged)
    - Acceptance Rate (Helper cascade %)
    - Completion Rate (Verified fulfilled %)
    """
    return get_operational_kpis(db, days=days)


@engagement_router.get("/api/engagement/overview")
def get_engagement_overview_endpoint(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Returns aggregated User Engagement overview across bookings, calls, CSAT, and estimated costs."""
    return get_engagement_overview(db, days=days)


@engagement_router.get("/api/engagement/export")
def export_engagement_csv(
    type: str = Query(default="bookings", pattern="^(bookings|calls|feedback|helpers)$"),
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Generates and streams downloadable audit-ready CSV reports."""
    csv_data = generate_csv_export(db, export_type=type, days=days)
    filename = f"extrahand_{type}_report_{days}d.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# 2. Backward Compatibility for existing /api/reports calls
@engagement_router.get("/api/reports/summary")
def get_reports_summary_legacy(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    return get_engagement_overview(db, days=days)


@engagement_router.get("/api/reports/export")
def export_reports_csv_legacy(
    type: str = Query(default="bookings", pattern="^(bookings|calls|feedback|helpers)$"),
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    return export_engagement_csv(type=type, days=days, db=db)

