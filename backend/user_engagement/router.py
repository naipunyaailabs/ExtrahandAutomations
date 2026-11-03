"""User Engagement & Operational Performance Router."""

from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from .models import OperationalPerformanceKPIs, EngagementOverview, UserSegmentationSummary
from .service import get_operational_kpis, get_engagement_overview, get_user_segmentation, generate_csv_export

engagement_router = APIRouter(tags=["User Engagement & Analytics"])

# 1. Primary User Engagement Routes
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


@engagement_router.get("/api/engagement/users")
def get_engagement_users(
    tier: Optional[str] = Query(default=None, pattern="^(diamond|gold|silver)$"),
    period: str = Query(default="monthly", pattern="^(monthly|weekly)$"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Returns segregated user list with tier metrics:
    - Diamond: Monthly >= 30 tasks (30 to 200+) / Weekly >= 5 tasks
    - Gold: Monthly 10 - 29 tasks / Weekly 3 - 4 tasks
    - Silver: Monthly < 10 tasks / Weekly < 3 tasks
    """
    return get_user_segmentation(db, tier_filter=tier, period=period)


@engagement_router.get("/api/engagement/segmentation")
def get_segmentation_summary(
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Returns full Tier summary across Monthly and Weekly distributions."""
    return get_user_segmentation(db)


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

