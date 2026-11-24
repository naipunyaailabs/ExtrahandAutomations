"""Marketing service: regions (All-India and the cities), their festivals, and posters.

Festivals are registered by hand from the calendar. For All-India the festival finder
(festival_finder.py, "Find Festivals" button) can also suggest festivals; those wait as "Pending Review"
until an admin approves them. Only approved festivals are published and get a poster.
"""
import logging
import re
import threading
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.branding import promo_message
from app.config import get_settings

from .agent.poster_agent import poster_agent
from .database import (
    db_delete_event,
    db_find_region_name,
    db_get_all_cities,
    db_get_city_events,
    db_get_event_by_id,
    db_save_or_update_city,
    db_save_or_update_event,
    db_update_event_fields,
    init_advestiment_db,
)
from .models import CityEvent, CitySummary, PosterInfo

logger = logging.getLogger("advestiment.service")

NATIONAL_NAMES = ("all-india", "all_india", "india", "national")
APPROVED = "Approved"


WHATSAPP_ONLY = "manual_whatsapp"  # festival registered for the WhatsApp message only (no poster)


def _region_name(name: str) -> str:
    """Stored spelling of a region; All-India for any of its aliases."""
    if name.strip().lower() in NATIONAL_NAMES:
        return "All-India"
    return db_find_region_name(name) or name.strip()


def _in_month(ev: Dict[str, Any], year: int, month: int) -> bool:
    period = f"{year}-{month:02d}"
    start = ev.get("date_start", "")[:7]
    end = (ev.get("date_end") or ev.get("date_start", ""))[:7]
    return start <= period <= end


class AdvestimentService:
    """Regions, hand-registered festivals and their posters, stored in the main database."""

    def __init__(self):
        init_advestiment_db()

    # ------------------------------------------------------------------ regions
    def add_city(self, city_name: str, state: Optional[str] = None) -> CitySummary:
        """Add a city (KPI card in States & Cities) under a state."""
        name = db_find_region_name(city_name) or city_name.strip().title()
        clean_state = (state or get_settings().marketing_default_state).strip()
        saved = db_save_or_update_city(city_name=name, state=clean_state, is_national=False, region_type="city")
        events = [CityEvent(**e) for e in db_get_city_events(saved["city_name"])]
        return CitySummary(
            city_name=saved["city_name"],
            state=clean_state,
            active_campaigns=len(events),
            upcoming_events_count=len(events),
            top_demand_service="",
            featured_discount="",
            is_national=False,
            region_type=saved.get("region_type") or "city",
            events=events,
        )

    def get_cities_summary(self) -> List[CitySummary]:
        """KPI cards: All-India and every city, with their upcoming published (approved) festivals."""
        summaries = []
        for c in db_get_all_cities():
            events = [CityEvent(**e) for e in db_get_city_events(c["city_name"]) if e.get("status") == APPROVED]
            summaries.append(CitySummary(
                city_name=c["city_name"],
                state=c["state"],
                active_campaigns=len(events),
                upcoming_events_count=len(events),
                top_demand_service=c["top_demand_service"],
                featured_discount=c["featured_discount"],
                is_national=c["is_national"],
                region_type=c.get("region_type") or "city",
                events=events,
            ))
        return summaries

    # ------------------------------------------------------------------ calendar
    def get_city_events(self, city: str, year: Optional[int] = None, month: Optional[int] = None) -> List[CityEvent]:
        """Festivals of a region in the given month: upcoming (approved or awaiting approval) plus completed
        approved ones, so their dates and posters stay visible."""
        now = datetime.now()
        y, m = year or now.year, month or now.month
        events = db_get_city_events(_region_name(city), include_completed=True)
        return [CityEvent(**e) for e in events if _in_month(e, y, m)]

    def get_event_by_id(self, event_id: str) -> Optional[CityEvent]:
        raw = db_get_event_by_id(event_id)
        return CityEvent(**raw) if raw else None

    @staticmethod
    def _manual_fields(title: str, description: str, discount_code: str) -> Tuple[str, str, str, int]:
        """Validated (title, description, coupon, discount %) for a registered event.
        A coupon ending in a number sets the discount, e.g. DIWALI30 -> 30%."""
        title = (title or "").strip()
        if not title:
            raise ValueError("Event name is required")
        code = re.sub(r"[^A-Za-z0-9]", "", discount_code or "").upper()[:40]  # optional
        discount = get_settings().marketing_default_discount
        m = re.search(r"(\d{1,2})$", code)
        if m and 0 < int(m.group(1)) <= 90:
            discount = int(m.group(1))
        return title, (description or "").strip(), code, discount

    def register_manual_event(self, city: str, date: str, title: str, description: str,
                              discount_code: str, date_end: Optional[str] = None,
                              make_poster: bool = True) -> CityEvent:
        """Register a festival for one day, or several days (dates dragged in the calendar), in a region's
        calendar; the poster agent then designs its poster."""
        try:
            first = datetime.strptime(date, "%Y-%m-%d")
            last = datetime.strptime(date_end, "%Y-%m-%d") if date_end else first
        except ValueError:
            raise ValueError("Dates must be YYYY-MM-DD")
        if last < first:
            raise ValueError("The last day is before the first day")
        if (last - first).days > 30:
            raise ValueError("A festival can cover at most 31 days")
        date_end = last.strftime("%Y-%m-%d")
        name = _region_name(city)
        if name != "All-India" and not db_find_region_name(name):
            raise ValueError(f"{name} is not a monitored region")
        title, description, code, discount = self._manual_fields(title, description, discount_code)
        prefix = "ind" if name == "All-India" else re.sub(r"[^a-z0-9]", "", name.lower())[:8] or "reg"
        ev = {
            "id": f"{prefix}-manual-{uuid.uuid4().hex[:8]}",
            "city": name,
            "title": title,
            "category": "Festival",
            "date_start": date,
            "date_end": date_end,
            "impact_level": "High",
            "target_services": [],
            "description": description,
            "demand_surge": "",
            "suggested_discount": discount,
            "discount_code": code,
            "promo_template": promo_message(title, name, discount, [], code),
            # "manual_whatsapp": registered for the WhatsApp message only, the poster agent leaves it alone
            "source": "manual" if make_poster else WHATSAPP_ONLY,
            "status": "Approved",
            "importance_score": 80,
            "importance_reason": "Registered by an admin from the calendar.",
            "event_scope": "national" if name == "All-India" else "local",
            "source_name": "Registered by admin",
            "is_verified": True,
            "confidence_score": 100,
            "discovery_date": datetime.now().strftime("%Y-%m-%d"),
        }
        db_save_or_update_event(ev)
        if make_poster:
            start_event_poster(ev["id"])
        return CityEvent(**db_get_event_by_id(ev["id"]))

    def update_manual_event(self, event_id: str, title: str, description: str, discount_code: str) -> Optional[CityEvent]:
        """Edit a registered event; the poster agent then redraws its poster."""
        ev = db_get_event_by_id(event_id)
        if not ev:
            return None
        title, description, code, discount = self._manual_fields(title, description, discount_code)
        db_update_event_fields(event_id, {
            "title": title,
            "description": description,
            "discount_code": code,
            "suggested_discount": discount,
            "promo_template": promo_message(title, ev["city"], discount, ev.get("target_services") or [], code),
        })
        if ev.get("source") != WHATSAPP_ONLY or ev.get("poster_url"):
            start_event_poster(event_id)
        return CityEvent(**db_get_event_by_id(event_id))

    def set_approval(self, event_id: str, approve: bool) -> Optional[CityEvent]:
        """Admin decision on a suggested festival. Approving publishes it and starts its poster;
        rejecting hides it (it is kept so the finder does not suggest it again)."""
        if not db_get_event_by_id(event_id):
            return None
        db_update_event_fields(event_id, {"status": APPROVED if approve else "Rejected"})
        if approve:
            start_event_poster(event_id)
        return CityEvent(**db_get_event_by_id(event_id))

    def delete_event(self, event_id: str) -> bool:
        if not db_get_event_by_id(event_id):
            return False
        db_delete_event(event_id)
        return True

    # ------------------------------------------------------------------ posters
    def generate_poster_for_event(self, event_id: str) -> Optional[PosterInfo]:
        """Create a brand-new poster now (Agent 1 designs it, Agent 2 draws and checks it)."""
        ev = db_get_event_by_id(event_id)
        if not ev:
            return None
        return PosterInfo(**poster_agent.generate_and_save_poster(ev, regenerate=True))


# =========================================================================
# BACKGROUND POSTER AGENT
# =========================================================================

# Event ids whose poster the agent is creating right now, and the last error per event
_posters_running: set = set()
_poster_errors: Dict[str, str] = {}
_posters_guard = threading.Lock()


def start_event_poster(event_id: str, regenerate: bool = True) -> bool:
    """Let the poster agent create (or redo) an event's poster in a background thread.
    Only approved festivals get a poster."""
    ev = db_get_event_by_id(event_id)
    if not ev or ev.get("status") != APPROVED:
        return False
    with _posters_guard:
        if event_id in _posters_running:
            return False
        _posters_running.add(event_id)
        _poster_errors.pop(event_id, None)

    def _run() -> None:
        try:
            ev = db_get_event_by_id(event_id)
            if ev:
                poster_agent.generate_and_save_poster(ev, regenerate=regenerate)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Poster Agent] Poster for %s failed: %s", event_id, exc)
            _poster_errors[event_id] = str(exc) or "The poster agent did not respond."
        finally:
            with _posters_guard:
                _posters_running.discard(event_id)

    threading.Thread(target=_run, daemon=True, name=f"poster-{event_id}").start()
    return True


def stop_event_poster(event_id: str) -> bool:
    """Stop the poster agent for a festival: it becomes WhatsApp only (no poster; Create Posters skips it) and
    the agent's research and last error are cleared. A drawing already in progress cannot be interrupted, but
    its result is not wanted. False when the festival does not exist."""
    if not db_get_event_by_id(event_id):
        return False
    db_update_event_fields(event_id, {"source": WHATSAPP_ONLY, "knowledge": {}})
    _poster_errors.pop(event_id, None)
    return True


def event_poster_status(event_id: str) -> Dict[str, Any]:
    """running / ready / failed / none for the event's poster."""
    ev = db_get_event_by_id(event_id)
    if not ev:
        return {"status": "missing"}
    if event_id in _posters_running:
        return {"status": "running"}
    if ev.get("status") != APPROVED:
        return {"status": "awaiting_approval"}
    # The last attempt failed: say so even when an older poster exists (that poster is kept and still shown)
    if event_id in _poster_errors:
        return {"status": "failed", "error": _poster_errors[event_id], "poster_url": ev.get("poster_url") or ""}
    if ev.get("poster_url"):
        return {"status": "ready", "poster_url": ev["poster_url"]}
    return {"status": "none"}


# =========================================================================
# POSTER SCAN: this month and the next two months
# =========================================================================

_scan_lock = threading.Lock()
_scan: Dict[str, Any] = {"running": False, "step": "", "done": 0, "total": 0, "last": None}


def _poster_window() -> Tuple[str, str]:
    """First and last day of the scan: today until the end of the month after next."""
    from .festival_finder import search_window

    y, m = search_window()[-1]
    nxt = date(y + m // 12, m % 12 + 1, 1)
    return date.today().isoformat(), (nxt - timedelta(days=1)).isoformat()


def festivals_needing_posters() -> List[Dict[str, Any]]:
    """Approved festivals (All-India and the cities) in the window that have no poster yet."""
    start, end = _poster_window()
    out = []
    for c in db_get_all_cities():
        for ev in db_get_city_events(c["city_name"]):
            if (ev.get("status") == APPROVED and start <= ev.get("date_start", "") <= end and not ev.get("poster_url")
                    and ev.get("source") != WHATSAPP_ONLY):
                out.append(ev)
    return sorted(out, key=lambda e: e.get("date_start", ""))


def start_poster_scan() -> bool:
    """The poster agent looks at this month and the next two; for every approved festival without a poster it
    reads the festival and its description and creates a poster for that festival and its religion
    (Seedream 5.0 Flash artwork). Runs in the background, one festival at a time. False if already running."""
    if not _scan_lock.acquire(blocking=False):
        return False
    todo = festivals_needing_posters()
    _scan.update(running=True, step="Starting", done=0, total=len(todo))

    def _run() -> None:
        made, failed = 0, []
        try:
            for ev in todo:
                event_id = ev["id"]
                with _posters_guard:
                    if event_id in _posters_running:
                        continue
                    _posters_running.add(event_id)
                    _poster_errors.pop(event_id, None)
                _scan["step"] = f"Designing {ev['title']} ({ev['date_start']})"
                try:
                    poster_agent.generate_and_save_poster(ev, regenerate=True)
                    made += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[Poster Agent] Poster for %s failed: %s", event_id, exc)
                    _poster_errors[event_id] = str(exc) or "The poster agent did not respond."
                    failed.append(ev["title"])
                finally:
                    with _posters_guard:
                        _posters_running.discard(event_id)
                    _scan["done"] += 1
        finally:
            start, end = _poster_window()
            summary = (f"{made} poster{'s' if made != 1 else ''} created for festivals from {start} to {end}."
                       if todo else f"Every approved festival from {start} to {end} already has a poster.")
            if failed:
                summary += " Failed: " + ", ".join(failed)
            _scan.update(running=False, step="", last={"summary": summary, "made": made,
                                                       "failed": len(failed), "ran_at": datetime.now().isoformat()})
            _scan_lock.release()

    threading.Thread(target=_run, daemon=True, name="poster-scan").start()
    return True


def poster_scan_status() -> Dict[str, Any]:
    start, end = _poster_window()
    return {
        **_scan,
        "window_start": start,
        "window_end": end,
        "waiting": 0 if _scan["running"] else len(festivals_needing_posters()),
        "image_model": get_settings().poster_image_model,
    }


_service_instance: Optional[AdvestimentService] = None


def get_advestiment_service() -> AdvestimentService:
    global _service_instance
    if _service_instance is None:
        _service_instance = AdvestimentService()
    return _service_instance
