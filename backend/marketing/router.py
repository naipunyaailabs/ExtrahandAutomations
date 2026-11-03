import logging
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

from .models import (
    CitySummary,
    CityEvent,
    AgentScanRequest,
    AdTemplateGenerateRequest,
    AdTemplateResponse,
    AdBroadcastPayload,
    AdBroadcastResult,
    ScanResultResponse,
)
from .service import get_advestiment_service

logger = logging.getLogger("marketing.router")

# Primary Marketing router (/api/marketing)
marketing_router = APIRouter(tags=["Marketing & Advertisement Service"])

# Router for backward compatibility with existing /api/advestiment calls
advestiment_router = APIRouter(prefix="/api/advestiment", tags=["Marketing & Advertisement Service"])


class AddCityPayload(BaseModel):
    city_name: str
    state: Optional[str] = "Telangana"
    data_sources: Optional[List[str]] = None


@advestiment_router.get("/cities", response_model=List[CitySummary])
async def list_cities():
    """Get all monitored metro cities with event counts and discount highlights."""
    service = get_advestiment_service()
    return service.get_cities_summary()


@advestiment_router.post("/cities/add", response_model=CitySummary)
async def add_new_city(payload: AddCityPayload):
    """Add a new city KPI card dynamically to the advertisement system."""
    service = get_advestiment_service()
    return service.add_city(city_name=payload.city_name, state=payload.state or "Telangana", data_sources=payload.data_sources)


@advestiment_router.get("/events/{city}", response_model=List[CityEvent])
async def get_city_calendar_events(
    city: str,
    year: Optional[int] = None,
    month: Optional[int] = None
):
    """Get big events & holiday calendar for a specific city, dynamically computed for year/month."""
    service = get_advestiment_service()
    return service.get_city_events(city=city, year=year, month=month)


@advestiment_router.get("/all-india", response_model=List[CityEvent])
async def get_all_india_calendar(
    year: Optional[int] = None,
    month: Optional[int] = None
):
    """Get official Government of India National Calendar (Gazetted holidays, festivals, and demand spikes)."""
    service = get_advestiment_service()
    return service.get_all_india_festivals(year=year, month=month)


@advestiment_router.post("/reseed-national-calendar")
async def reseed_national_calendar(force: bool = True):
    """Reseed calendar with authentic National Calendar of India and regional city events."""
    service = get_advestiment_service()
    return service.reseed_dynamic_calendar(force=force)


@advestiment_router.post("/scan", response_model=ScanResultResponse)
async def trigger_agent_scan(payload: AgentScanRequest):
    """Trigger the autonomous AI agent to read all websites for the city one by one sequentially,
    discover big events, and update the calendar with WhatsApp promotions."""
    service = get_advestiment_service()
    return await service.scan_city_events(city=payload.city, custom_query=payload.custom_query)


@advestiment_router.get("/scan-report/{city}", response_model=ScanResultResponse)
async def get_city_scan_report(city: str):
    """Get the latest crawl telemetry report and discovered events for a city."""
    service = get_advestiment_service()
    return service.get_scan_report(city)


@advestiment_router.post("/generate-template", response_model=AdTemplateResponse)
async def generate_customer_ad_template(payload: AdTemplateGenerateRequest):
    """Use AI Agent to generate/regenerate a high-converting customer discount ad template."""
    service = get_advestiment_service()
    return await service.generate_template(payload)


@advestiment_router.post("/broadcast", response_model=AdBroadcastResult)
async def broadcast_ad_campaign(payload: AdBroadcastPayload):
    """Broadcast advertisement / discount campaign to customers via WhatsApp or SMS."""
    service = get_advestiment_service()
    return service.broadcast_campaign(payload)


marketing_router.include_router(advestiment_router)
