from typing import List, Optional, Dict, Any
from pydantic import BaseModel


class CityEvent(BaseModel):
    id: str
    title: str
    city: str  # a monitored city name, or "All-India"
    date_start: str  # "YYYY-MM-DD"
    date_end: str    # "YYYY-MM-DD"
    category: str    # "Festival", "Sports", "Cultural", "Seasonal", "Expo", "National Holiday"
    impact_level: str  # "Peak", "High", "Medium"
    target_services: List[str] = []  # ["Deep Cleaning", "AC Servicing", "Painting"]
    description: str = ""
    demand_surge: str = ""  # e.g. "+55% Cleaning Demand"
    suggested_discount: int = 0  # Percentage discount; the database fills in MARKETING_DEFAULT_DISCOUNT
    discount_code: str = ""  # e.g. "SIDD25"
    promo_template: str = ""  # The marketing ad text for customer
    source: str = "manual"  # "manual" = registered by an admin from the calendar

    # Enhanced Discovery & Management Metadata
    status: str = "Approved"
    importance_score: int = 80  # 0 to 100
    importance_reason: Optional[str] = "High-value local event with significant public participation."
    event_scope: str = "local"  # "local", "regional", "national"
    source_url: Optional[str] = None  # Original source link
    knowledge: Dict[str, Any] = {}  # Optional festival profile used by the poster designer
    source_name: Optional[str] = None  # e.g. "Siddipet District Portal"
    is_verified: bool = True  # True if date is verified, False if approximate/uncertain
    confidence_score: int = 85  # 0 to 100
    poster_url: Optional[str] = None  # Link to generated marketing poster SVG/image
    poster_theme: Optional[str] = None  # Theme ID
    poster_generated_at: Optional[str] = None
    admin_notes: Optional[str] = None
    published_at: Optional[str] = None
    discovery_date: Optional[str] = None


class PosterInfo(BaseModel):
    id: str
    event_id: str
    event_title: str
    city: str
    date_str: str
    poster_url: str
    poster_svg: Optional[str] = None
    theme: str = "default"
    status: str = "generated"  # "generated", "published"
    created_at: str = ""
    palette: Optional[Dict[str, Any]] = None


class CitySummary(BaseModel):
    city_name: str
    state: str
    active_campaigns: int
    upcoming_events_count: int
    top_demand_service: str
    featured_discount: str
    is_national: bool = False
    region_type: str = "city"  # "national" (All-India), "state" or "city"
    events: List[CityEvent] = []
