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

