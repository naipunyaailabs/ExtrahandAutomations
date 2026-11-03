"""Data models for User Engagement & Operational Performance Analytics."""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

UserTier = Literal["diamond", "gold", "silver"]


class UserSegmentItem(BaseModel):
    """Customer profile segregated by monthly and weekly task volume tiers."""
    customer_id: str
    name: str
    phone: str
    email: Optional[str] = None
    city: str = "Bengaluru"
    total_tasks: int = 0
    monthly_tasks: int = 0
    weekly_tasks: int = 0
    monthly_tier: UserTier = "silver"
    weekly_tier: UserTier = "silver"
    top_category: str = "General"
    last_active: Optional[str] = None
    preferred_days: List[str] = Field(default_factory=list)


class TierCountSummary(BaseModel):
    """Volume count and percentage for a specific period."""
    diamond: int = 0
    gold: int = 0
    silver: int = 0
    total: int = 0
    diamond_pct: float = 0.0
    gold_pct: float = 0.0
    silver_pct: float = 0.0


class UserSegmentationSummary(BaseModel):
    """Full segmentation summary across Monthly (30+ / 10-30 / <10) and Weekly (5+ / 3-5 / <3)."""
    monthly: TierCountSummary
    weekly: TierCountSummary
    users: List[UserSegmentItem] = Field(default_factory=list)
    criteria: Dict[str, Any] = Field(default_factory=dict)


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


class EngagementOverview(BaseModel):
    """Comprehensive User Engagement payload."""
    kpis: OperationalPerformanceKPIs
    categories: Dict[str, int] = Field(default_factory=dict)
    calls_summary: Dict[str, Any] = Field(default_factory=dict)
    csat_summary: Dict[str, Any] = Field(default_factory=dict)
    cost_summary: Dict[str, Any] = Field(default_factory=dict)
    segmentation: Optional[UserSegmentationSummary] = None

