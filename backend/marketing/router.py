"""Marketing API: regions, festivals (registered by hand or suggested by the All-India festival finder),
approval and posters (/api/advestiment, also /api/marketing)."""
import asyncio
import logging
import re
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .commercials import router as commercials_router
from .database import POSTERS_DIR
from .models import CityEvent, CitySummary, PosterInfo
from .festival_finder import finder_status, llm_ready, start_finder
from .service import (
    event_poster_status,
    get_advestiment_service,
    poster_scan_status,
    start_event_poster,
    start_poster_scan,
)

logger = logging.getLogger("marketing.router")

advestiment_router = APIRouter(prefix="/api/advestiment", tags=["Marketing & Advertisement Service"])


class AddCityPayload(BaseModel):
    city_name: str
    state: Optional[str] = None


class ManualEventPayload(BaseModel):
    city: str = "All-India"
    date: str  # YYYY-MM-DD
    title: str
    description: str = ""
    discount_code: str


class ManualEventUpdatePayload(BaseModel):
    title: str
    description: str = ""
    discount_code: str



# ------------------------------------------------------------------ regions
@advestiment_router.get("/cities", response_model=List[CitySummary])
async def list_regions():
    """All-India and the cities (KPI cards in States & Cities) with their upcoming events."""
    return get_advestiment_service().get_cities_summary()


@advestiment_router.post("/cities/add", response_model=CitySummary)
async def add_city(payload: AddCityPayload):
    """Add a city under a state."""
    if not payload.city_name.strip():
        raise HTTPException(status_code=400, detail="City name is required")
    return get_advestiment_service().add_city(city_name=payload.city_name, state=payload.state)


# ------------------------------------------------------------------ events registered by hand
@advestiment_router.post("/events/register", response_model=CityEvent)
async def register_event(payload: ManualEventPayload):
    """Register a festival for one day in a region's calendar; the poster agent then designs its poster."""
    try:
        return get_advestiment_service().register_manual_event(
            payload.city, payload.date, payload.title, payload.description, payload.discount_code
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@advestiment_router.put("/events/register/{event_id}", response_model=CityEvent)
async def update_event(event_id: str, payload: ManualEventUpdatePayload):
    """Edit a registered festival (name, description, coupon); the poster agent redraws its poster."""
    try:
        ev = get_advestiment_service().update_manual_event(
            event_id, payload.title, payload.description, payload.discount_code
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


@advestiment_router.delete("/events/detail/{event_id}")
async def delete_event(event_id: str):
    """Delete a festival and its poster files."""
    if not get_advestiment_service().delete_event(event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    return {"ok": True, "id": event_id}


@advestiment_router.post("/events/detail/{event_id}/approve", response_model=CityEvent)
async def approve_event(event_id: str):
    """Approve a suggested festival: it is published and its poster is designed."""
    ev = get_advestiment_service().set_approval(event_id, approve=True)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


@advestiment_router.post("/events/detail/{event_id}/reject", response_model=CityEvent)
async def reject_event(event_id: str):
    """Reject a suggested festival: it is hidden and not suggested again."""
    ev = get_advestiment_service().set_approval(event_id, approve=False)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


# ------------------------------------------------------------------ All-India festival finder
@advestiment_router.get("/festival-finder/status")
async def festival_finder_status():
    """Festival finder state: running, last run, next recommended run, search window and model."""
    return finder_status()


@advestiment_router.post("/festival-finder/start")
async def festival_finder_start():
    """Start the All-India festival finder (GPT-OSS-20B agent reading Drik Panchang). Results wait for approval."""
    if not llm_ready():
        raise HTTPException(status_code=400, detail="Set OPENROUTER_API_KEY in backend/.env to use the festival finder.")
    if not start_finder():
        raise HTTPException(status_code=409, detail="The festival finder is already running.")
    return finder_status()


@advestiment_router.get("/events/detail/{event_id}", response_model=CityEvent)
async def get_event(event_id: str):
    ev = get_advestiment_service().get_event_by_id(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


# ------------------------------------------------------------------ posters
@advestiment_router.get("/posters/scan/status")
async def poster_scan_state():
    """Poster agent scan of this month and the next two: running, progress, festivals still without a poster."""
    return poster_scan_status()


@advestiment_router.post("/posters/scan")
async def poster_scan_start():
    """Poster agent: create a poster (Seedream 5.0 Flash artwork) for every approved festival in this month and
    the next two that has none, based on the festival, its description and its religion."""
    if not start_poster_scan():
        raise HTTPException(status_code=409, detail="The poster agent is already creating posters.")
    return poster_scan_status()


@advestiment_router.get("/events/detail/{event_id}/poster-status")
async def poster_status(event_id: str):
    """Whether the poster agent is still designing this event's poster (running / ready / failed / none)."""
    return event_poster_status(event_id)


def _is_completed(ev) -> bool:
    """The festival's last day is before today."""
    last = ev.date_end or ev.date_start or ""
    return bool(last) and last < date.today().isoformat()


@advestiment_router.post("/events/detail/{event_id}/poster-agent")
async def restart_poster_agent(event_id: str):
    """Ask the poster agent to design the event's poster again (in the background)."""
    ev = get_advestiment_service().get_event_by_id(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.status != "Approved":
        raise HTTPException(status_code=400, detail="Approve the festival first; only approved festivals get a poster.")
    if _is_completed(ev):
        raise HTTPException(status_code=400, detail="This festival is completed; its poster can no longer be regenerated.")
    start_event_poster(event_id)
    return event_poster_status(event_id)


@advestiment_router.post("/events/detail/{event_id}/generate-poster", response_model=PosterInfo)
async def generate_poster(event_id: str):
    """Design a new poster now and wait for it (Agent 1 brief + Agent 2 drawing and check)."""
    ev = get_advestiment_service().get_event_by_id(event_id)
    if ev and _is_completed(ev):
        raise HTTPException(status_code=400, detail="This festival is completed; its poster can no longer be regenerated.")
    try:
        poster = await asyncio.to_thread(get_advestiment_service().generate_poster_for_event, event_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if not poster:
        raise HTTPException(status_code=404, detail="Event not found")
    return poster


@advestiment_router.get("/poster-art/{filename}")
async def get_poster_art(filename: str):
    """Serve AI-generated poster artwork."""
    from app.services import media_store

    if not re.fullmatch(r"[A-Za-z0-9_.-]+[.](png|jpg|webp)", filename):
        raise HTTPException(status_code=400, detail="Invalid file name")
    data = media_store.get("posters/art", filename)
    if data is None:
        raise HTTPException(status_code=404, detail="Artwork not found")
    return Response(content=data, media_type=media_store.media_type(filename))


@advestiment_router.get("/events/{event_id}/poster")
async def get_event_poster_file(event_id: str, download: bool = False):
    """Serve the finished poster the agents created for the event (preview, or download=1 to save it)."""
    ev = get_advestiment_service().get_event_by_id(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    from app.services import media_store

    data = media_store.get("posters", f"{event_id}.jpg")
    if data is None:
        raise HTTPException(status_code=404, detail="No poster yet: the poster agent has not created one.")
    headers = {"Cache-Control": "no-cache"}
    if download:
        name = re.sub(r"[^a-z0-9]+", "-", ev.title.lower()).strip("-") or "festival"
        headers["Content-Disposition"] = f'attachment; filename="{name}-poster.jpg"'
    return Response(content=data, media_type="image/jpeg", headers=headers)


# ------------------------------------------------------------------ calendar (keep below the /events/... routes)
@advestiment_router.get("/events/{city}", response_model=List[CityEvent])
async def get_region_calendar(city: str, year: Optional[int] = None, month: Optional[int] = None):
    """Upcoming festivals of a region (All-India or a city) for the month."""
    return get_advestiment_service().get_city_events(city=city, year=year, month=month)


# /api/advestiment and the same routes under /api/marketing
advestiment_router.include_router(commercials_router)  # /api/advestiment/commercials
marketing_router = APIRouter(tags=["Marketing & Advertisement Service"])
marketing_router.include_router(advestiment_router)
marketing_api_router = APIRouter(prefix="/api/marketing", tags=["Marketing & Advertisement Service"])
marketing_api_router.include_router(advestiment_router, prefix="")
marketing_router.include_router(marketing_api_router)

from .task_seeding import router as task_seeding_router  # noqa: E402

marketing_router.include_router(task_seeding_router)  # /api/marketing/task-seeding (Task-Seeding Agent)
