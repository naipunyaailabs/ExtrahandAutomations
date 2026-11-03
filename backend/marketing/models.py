from typing import List, Optional
from pydantic import BaseModel, Field


class CityEvent(BaseModel):
    id: str
    title: str
    city: str  # "Hyderabad", "Bangalore", "Mumbai", "Delhi", "Chennai", "Pune", "Kolkata", "All-India"
    date_start: str  # "YYYY-MM-DD"
    date_end: str    # "YYYY-MM-DD"
    category: str    # "Festival", "Sports", "Cultural", "Seasonal", "Expo", "National Holiday"
    impact_level: str  # "Peak", "High", "Medium"
    target_services: List[str]  # ["Deep Cleaning", "AC Servicing", "Painting"]
    description: str
    demand_surge: str  # "+55% Cleaning Demand"
    suggested_discount: int = 20  # Percentage discount (e.g. 20%)
    discount_code: str  # e.g. "HYDDIWALI25"
    promo_template: str  # The marketing ad text for customer
    source: str = "ai_agent"  # "ai_agent", "openrouter", "calendar"


class CitySummary(BaseModel):
    city_name: str
    state: str
    active_campaigns: int
    upcoming_events_count: int
    top_demand_service: str
    featured_discount: str
    is_national: bool = False
    data_sources: List[str] = []
    events: List[CityEvent] = []


class AgentScanRequest(BaseModel):
    city: Optional[str] = None  # None for all cities, or specific city name
    custom_query: Optional[str] = None
    use_openrouter: bool = True


class AdTemplateGenerateRequest(BaseModel):
    event_id: str
    city: str
    event_title: str
    discount_percent: int
    target_service: str
    custom_instructions: Optional[str] = None


class AdTemplateResponse(BaseModel):
    ok: bool
    event_id: str
    city: str
    discount_percent: int
    discount_code: str
    promo_template: str
    headline: str
    call_to_action: str
    source: str = "openrouter_ai"


class AdBroadcastPayload(BaseModel):
    event_id: str
    city: str
    discount_code: str
    promo_message: str
    channel: str = "whatsapp"  # "whatsapp", "sms", "app_push"
    target_audience: str = "all_customers"  # "all_customers", "repeat_customers", "vip"


class AdBroadcastResult(BaseModel):
    ok: bool
    event_id: str
    city: str
    channel: str
    target_audience: str
    customers_reached: int
    delivered_count: int
    failed_count: int = 0
    discount_code: str
    summary: str


class CrawlSourceTelemetry(BaseModel):
    url: str
    status: str = "scanned"  # "scanned", "reading", "cached"
    http_status: int = 200
    detected_headline: Optional[str] = None
    events_found: int = 0
    scanned_at: str = ""


class ScanResultResponse(BaseModel):
    ok: bool = True
    city: str
    sources_crawled: List[CrawlSourceTelemetry] = []
    events_discovered: List[CityEvent] = []
    summary: str = ""


