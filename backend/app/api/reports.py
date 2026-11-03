"""Reports and Analytics API Router."""

from typing import Any, Dict
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.reports import generate_csv_export, get_analytics_summary

router = APIRouter(prefix="/api/reports", tags=["reports_analytics"])


@router.get("/summary")
def get_reports_summary(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Returns aggregated KPIs across bookings, voice calls, helper acceptance, CSAT, and estimated costs."""
    return get_analytics_summary(db, days=days)


@router.get("/export")
def export_report_csv(
    type: str = Query(default="bookings", pattern="^(bookings|calls|feedback|helpers)$"),
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Generates and streams a downloadable CSV report file."""
    csv_data = generate_csv_export(db, export_type=type, days=days)
    filename = f"extrahand_{type}_report_{days}d.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
