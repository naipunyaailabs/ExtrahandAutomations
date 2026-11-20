"""Data models for User Engagement & Operational Performance Analytics."""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class OperationalPerformanceKPIs(BaseModel):
    """Core metrics matching the Reports & Analytics Operational Performance card."""
    total_volume: int = Field(default=0, description="Total work orders logged")
    acceptance_rate: float = Field(default=0.0, description="Helper cascade acceptance percentage (e.g. 94.2%)")
    completion_rate: float = Field(default=0.0, description="Verified fulfilled completion percentage (e.g. 33.0%)")
    audit_ready: bool = Field(default=True, description="Indicates data is reconciled and audit ready")
    period_days: int = Field(default=30, description="Reporting window in days")
    completed_tickets: int = Field(default=0, description="Total verified fulfilled tickets")
    total_dispatches: int = Field(default=0, description="Total helper outreach calls made")
    accepted_dispatches: int = Field(default=0, description="Total helper acceptances")


class DashboardOrderItem(BaseModel):
    """One of today's orders (a Work booked or scheduled today, India time)."""
    id: str
    title: str = "Service Work"
    category: str = "General"
    status: str = "open"
    state_type: Literal["success", "fail", "pending"] = "pending"
    customer_name: str = "Unknown"
    customer_phone: str = ""
    city: str = ""
    area: str = ""
    scheduled_at: Optional[str] = None
    scheduled_slot: str = ""
    created_at: Optional[str] = None
    budget: float = 0.0
    booking_source: str = ""
    posted_by: str = ""
    helper_name: str = ""


class SupportSummary(BaseModel):
    """Customer-care tickets from ExtraHand (available=False when the support API cannot be read)."""
    available: bool = False
    reason: Optional[str] = None
    total: int = 0
    open: int = 0
    by_status: Dict[str, int] = Field(default_factory=dict)


class HelperSummary(BaseModel):
    """Helpers (ExtraHand partners): registrations from ExtraHand, activity from the Works they are assigned."""
    total: Optional[int] = Field(default=None, description="Registered helpers (test accounts left out)")
    new_today: Optional[int] = None
    new_month: Optional[int] = None
    verified: Optional[int] = None
    aadhaar_verified: Optional[int] = None
    with_completed_jobs: Optional[int] = None
    blocked: Optional[int] = None
    active_month: int = Field(default=0, description="Helpers assigned a Work booked or scheduled this month")
    active_today: int = Field(default=0, description="Helpers assigned a Work booked or scheduled today")
    today_assigned: int = Field(default=0, description="Today's Works that have a helper")
    month_assigned: int = 0


class EngagementDashboardSummary(BaseModel):
    """User Engagement dashboard for today (India time)."""
    today: str = Field(description="Today's date, YYYY-MM-DD (IST)")
    today_label: str = Field(description="Today's date for display, e.g. Friday, 06 November 2026")
    timezone: str = "IST (UTC+05:30)"
    source: Literal["live", "local"] = Field(description="live = ExtraHand Main Admin API, local = database copy")
    source_note: str = ""
    fetched_at: str = Field(description="When the data was read (ISO, IST)")
    refresh_seconds: int = 300
    total_users: int = Field(default=0, description="Registered customers")
    new_users_today: Optional[int] = Field(default=None, description="Customers who registered today")
    new_users_month: Optional[int] = Field(default=None, description="Customers who registered this month")
    active_users_month: int = Field(default=0, description="Customers with a Work booked or scheduled this month")
    active_users_today: int = Field(default=0, description="Customers with a Work booked or scheduled today")
    total_orders_all_time: int = 0
    today_orders_count: int = Field(default=0, description="Works booked or scheduled today")
    today_success: int = 0
    today_fail: int = 0
    today_pending: int = 0
    monthly_orders_count: int = 0
    monthly_success: int = 0
    monthly_fail: int = 0
    monthly_pending: int = 0
    today_orders: List[DashboardOrderItem] = Field(default_factory=list)
    categories_breakdown: Dict[str, int] = Field(default_factory=dict)
    booking_sources: Dict[str, int] = Field(default_factory=dict)
    support: SupportSummary = Field(default_factory=SupportSummary)
    helpers: HelperSummary = Field(default_factory=HelperSummary)
    excluded: Dict[str, Any] = Field(default_factory=dict, description="What was left out: team-posted and test data")


class EngagementOverview(BaseModel):
    """Comprehensive User Engagement payload."""
    kpis: OperationalPerformanceKPIs
    categories: Dict[str, int] = Field(default_factory=dict)
    calls_summary: Dict[str, Any] = Field(default_factory=dict)
    csat_summary: Dict[str, Any] = Field(default_factory=dict)
    cost_summary: Dict[str, Any] = Field(default_factory=dict)
