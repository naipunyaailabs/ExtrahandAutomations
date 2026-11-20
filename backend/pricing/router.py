"""Pricing agent API.

/api/pricing/*     the dashboard: the list (areas, services, competitors), strategy, runs, results
/api/pricing/v1/*  the ExtraHand app: the current price for a service in a place (X-API-Key)"""

import re
import secrets
from datetime import datetime, timedelta
from statistics import median

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.config import get_settings
from app.services import readiness

from . import llm
from .agent import RunBusy, get_strategy, start_run
from .demand import default_keywords
from .reader import crawl4ai_available
from .rules import round_price
from .tables import (
    Area, AreaReport, Competitor, Observation, Rating, Recommendation, Run, Service, Strategy, get_pricing_db,
)

pricing_router = APIRouter(prefix="/api/pricing", tags=["Pricing Agent"])
public_router = APIRouter(prefix="/v1", tags=["Pricing API (ExtraHand app)"])


# ---- schemas -----------------------------------------------------------------------------------

class AreaIn(BaseModel):
    city: str = Field(min_length=1, max_length=100)
    area: str = Field(default="", max_length=150)
    pincode: str | None = Field(default=None, max_length=20)
    active: bool = True


class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: str = Field(default="", max_length=300)
    unit: str = Field(default="per job", min_length=1, max_length=40)
    keywords: list[str] | None = None
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    active: bool = True


class CompetitorIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    website: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=500)
    active: bool = True

    @field_validator("website")
    @classmethod
    def website_is_a_web_address(cls, value: str | None) -> str | None:
        """Shown as a link on the dashboard, so only http(s) addresses are kept (never javascript: and the like)."""
        value = (value or "").strip()
        if not value:
            return None
        if "://" not in value:
            value = "https://" + value
        parsed = urlparse(value)
        try:
            parsed.port  # raises for something like https://javascript:alert(1)
            host_ok = bool(re.fullmatch(r"[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+", parsed.hostname or ""))
        except ValueError:
            host_ok = False
        if parsed.scheme not in ("http", "https") or not host_ok:
            raise ValueError("website must be a web address such as https://www.example.com")
        return value


class StrategyIn(BaseModel):
    position_pct: float = Field(ge=-50, le=50)
    demand_adjust_pct: float = Field(ge=0, le=50)
    sentiment_adjust_pct: float = Field(ge=0, le=50)
    demand_window_days: int = Field(ge=7, le=365)
    refresh_days: int = Field(ge=1, le=90)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "service"


def _area_out(a: Area) -> dict:
    return dict(id=a.id, city=a.city, area=a.area, pincode=a.pincode, active=a.active)


def _service_out(s: Service) -> dict:
    return dict(id=s.id, name=s.name, slug=s.slug, scope=s.scope, unit=s.unit, keywords=s.keywords or [],
                min_price=s.min_price, max_price=s.max_price, active=s.active)


def _competitor_out(c: Competitor) -> dict:
    return dict(id=c.id, name=c.name, website=c.website, notes=c.notes, active=c.active)


def _strategy_out(s: Strategy) -> dict:
    return dict(position_pct=s.position_pct, demand_adjust_pct=s.demand_adjust_pct,
                sentiment_adjust_pct=s.sentiment_adjust_pct, demand_window_days=s.demand_window_days,
                refresh_days=s.refresh_days)


def _run_out(r: Run) -> dict:
    return dict(id=r.id, status=r.status, trigger=r.trigger, total_steps=r.total_steps, done_steps=r.done_steps,
                message=r.message, error=r.error, started_at=iso(r.started_at), finished_at=iso(r.finished_at))


def _rec_out(r: Recommendation) -> dict:
    return dict(
        id=r.id, run_id=r.run_id, area_id=r.area_id, service_id=r.service_id, city=r.city, area=r.area,
        service=r.service_slug, service_name=r.service_name, unit=r.unit, status=r.status, price=r.price,
        currency=r.currency, market_median=r.market_median, market_low=r.market_low, market_high=r.market_high,
        price_count=r.price_count, basis=r.basis, demand_level=r.demand_level, demand_tasks=r.demand_tasks,
        sentiment_level=r.sentiment_level, competitor_rating=r.competitor_rating, confidence=r.confidence,
        adjustments=r.adjustments or [], reasoning=r.reasoning, updated_at=iso(r.created_at),
    )


def _commit(db: Session, what: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"That {what} is already on the list.")


def _get(db: Session, model, item_id: int):
    obj = db.get(model, item_id)
    if obj is None:
        raise HTTPException(404, "Not found")
    return obj


# ---- the list ----------------------------------------------------------------------------------

@pricing_router.get("/areas")
def list_areas(db: Session = Depends(get_pricing_db)):
    return [_area_out(a) for a in db.scalars(select(Area).order_by(Area.city, Area.area))]


@pricing_router.post("/areas", status_code=201)
def add_area(body: AreaIn, db: Session = Depends(get_pricing_db)):
    a = Area(city=body.city.strip().title(), area=body.area.strip().title(), pincode=(body.pincode or "").strip() or None,
             active=body.active)
    db.add(a)
    _commit(db, "area")
    return _area_out(a)


@pricing_router.put("/areas/{item_id}")
def edit_area(item_id: int, body: AreaIn, db: Session = Depends(get_pricing_db)):
    a = _get(db, Area, item_id)
    a.city, a.area = body.city.strip().title(), body.area.strip().title()
    a.pincode, a.active = (body.pincode or "").strip() or None, body.active
    _commit(db, "area")
    return _area_out(a)


@pricing_router.delete("/areas/{item_id}", status_code=204)
def remove_area(item_id: int, db: Session = Depends(get_pricing_db)):
    db.delete(_get(db, Area, item_id))
    db.commit()


@pricing_router.get("/services")
def list_services(db: Session = Depends(get_pricing_db)):
    return [_service_out(s) for s in db.scalars(select(Service).order_by(Service.name))]


def _apply_service(s: Service, body: ServiceIn) -> None:
    s.name, s.scope, s.unit = body.name.strip(), body.scope.strip(), body.unit.strip()
    s.keywords = [k.strip().lower() for k in (body.keywords or []) if k.strip()] or default_keywords(s.name)
    s.min_price, s.max_price, s.active = body.min_price, body.max_price, body.active
    if s.min_price and s.max_price and s.min_price > s.max_price:
        raise HTTPException(422, "The minimum price is above the maximum.")


@pricing_router.post("/services", status_code=201)
def add_service(body: ServiceIn, db: Session = Depends(get_pricing_db)):
    s = Service(slug=slugify(body.name))
    _apply_service(s, body)
    db.add(s)
    _commit(db, "service")
    return _service_out(s)


@pricing_router.put("/services/{item_id}")
def edit_service(item_id: int, body: ServiceIn, db: Session = Depends(get_pricing_db)):
    s = _get(db, Service, item_id)
    _apply_service(s, body)  # the slug stays: the app may already use it
    _commit(db, "service")
    return _service_out(s)


@pricing_router.delete("/services/{item_id}", status_code=204)
def remove_service(item_id: int, db: Session = Depends(get_pricing_db)):
    db.delete(_get(db, Service, item_id))
    db.commit()


@pricing_router.get("/competitors")
def list_competitors(db: Session = Depends(get_pricing_db)):
    return [_competitor_out(c) for c in db.scalars(select(Competitor).order_by(Competitor.name))]


@pricing_router.post("/competitors", status_code=201)
def add_competitor(body: CompetitorIn, db: Session = Depends(get_pricing_db)):
    c = Competitor(name=body.name.strip(), website=(body.website or "").strip() or None,
                   notes=(body.notes or "").strip() or None, active=body.active)
    db.add(c)
    _commit(db, "competitor")
    return _competitor_out(c)


@pricing_router.put("/competitors/{item_id}")
def edit_competitor(item_id: int, body: CompetitorIn, db: Session = Depends(get_pricing_db)):
    c = _get(db, Competitor, item_id)
    c.name, c.website = body.name.strip(), (body.website or "").strip() or None
    c.notes, c.active = (body.notes or "").strip() or None, body.active
    _commit(db, "competitor")
    return _competitor_out(c)


@pricing_router.delete("/competitors/{item_id}", status_code=204)
def remove_competitor(item_id: int, db: Session = Depends(get_pricing_db)):
    db.delete(_get(db, Competitor, item_id))
    db.commit()


@pricing_router.get("/strategy")
def read_strategy(db: Session = Depends(get_pricing_db)):
    out = _strategy_out(get_strategy(db))
    db.commit()
    return out


@pricing_router.put("/strategy")
def save_strategy(body: StrategyIn, db: Session = Depends(get_pricing_db)):
    s = get_strategy(db)
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return _strategy_out(s)


# ---- runs and results --------------------------------------------------------------------------

def next_run_due(db: Session) -> datetime | None:
    last = db.scalar(select(func.max(Run.finished_at)).where(Run.status == "done"))
    return last + timedelta(days=get_strategy(db).refresh_days) if last else None


@pricing_router.get("/status")
def status(db: Session = Depends(get_pricing_db)):
    s = get_settings()
    running = db.scalar(select(Run).where(Run.status == "running").order_by(Run.id.desc()))
    last = db.scalar(select(Run).where(Run.status != "running").order_by(Run.id.desc()))
    out = dict(
        llm_configured=llm.llm_configured(),
        search_engine="searxng" if s.searxng_url else "ddgs",
        page_reader="crawl4ai" if s.pricing_page_reader == "crawl4ai" or (s.pricing_page_reader == "auto" and crawl4ai_available()) else "http",
        maps_enabled=bool(s.gmaps_scraper_url),
        scheduler_enabled=s.pricing_scheduler_enabled,
        public_api_protected=readiness.filled(s.pricing_api_key),
        running=_run_out(running) if running else None,
        last_run=_run_out(last) if last else None,
        next_run_due=iso(next_run_due(db)),
        counts=dict(
            areas=db.scalar(select(func.count(Area.id)).where(Area.active)),
            services=db.scalar(select(func.count(Service.id)).where(Service.active)),
            competitors=db.scalar(select(func.count(Competitor.id)).where(Competitor.active)),
            priced=db.scalar(select(func.count(Recommendation.id)).where(Recommendation.is_current, Recommendation.status == "priced")),
        ),
    )
    db.commit()
    return out


@pricing_router.post("/runs", status_code=202)
async def run_now():
    try:
        return {"id": start_run("manual")}
    except RunBusy as exc:
        raise HTTPException(409, str(exc))


@pricing_router.get("/runs")
def list_runs(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_pricing_db)):
    return [_run_out(r) for r in db.scalars(select(Run).order_by(Run.id.desc()).limit(limit))]


@pricing_router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_pricing_db)):
    return _run_out(_get(db, Run, run_id))


@pricing_router.get("/recommendations")
def current_recommendations(area_id: int | None = None, service_id: int | None = None, db: Session = Depends(get_pricing_db)):
    q = select(Recommendation).where(Recommendation.is_current)
    if area_id:
        q = q.where(Recommendation.area_id == area_id)
    if service_id:
        q = q.where(Recommendation.service_id == service_id)
    return [_rec_out(r) for r in db.scalars(q.order_by(Recommendation.city, Recommendation.area, Recommendation.service_name))]


@pricing_router.get("/recommendations/{rec_id}")
def recommendation_detail(rec_id: int, db: Session = Depends(get_pricing_db)):
    """The price with the competitor prices it came from and the area's competitor ratings."""
    r = _get(db, Recommendation, rec_id)
    q = select(Observation).where(Observation.run_id == r.run_id, Observation.service_id == r.service_id)
    if r.basis == "area":
        q = q.where(Observation.area_id == r.area_id)
    else:
        same_city = select(Recommendation.area_id).where(Recommendation.run_id == r.run_id, func.lower(Recommendation.city) == r.city.lower())
        q = q.where(Observation.area_id.in_(same_city))
    evidence = [
        dict(competitor=o.competitor, listed=o.listed, price_min=o.price_min, price_max=o.price_max, unit=o.unit,
             source_url=o.source_url, source_title=o.source_title, evidence=o.evidence)
        for o in db.scalars(q.order_by(Observation.price_min))
    ]
    ratings = [
        dict(competitor=x.competitor, rating=x.rating, review_count=x.review_count, sentiment=x.sentiment,
             summary=x.summary, source=x.source, source_url=x.source_url)
        for x in db.scalars(select(Rating).where(Rating.run_id == r.run_id, Rating.area_id == r.area_id))
    ]
    return _rec_out(r) | {"evidence": evidence, "ratings": ratings}


@pricing_router.get("/reports")
def current_reports(db: Session = Depends(get_pricing_db)):
    return [
        dict(id=x.id, run_id=x.run_id, area_id=x.area_id, city=x.city, area=x.area, summary=x.summary, updated_at=iso(x.created_at))
        for x in db.scalars(select(AreaReport).where(AreaReport.is_current).order_by(AreaReport.city, AreaReport.area))
    ]


# ---- public API for the ExtraHand app ----------------------------------------------------------

def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """This route is outside the dashboard login (the app has no session), so the key is its only protection:
    production answers 503 until PRICING_API_KEY is set; development leaves it open."""
    s = get_settings()
    if not readiness.filled(s.pricing_api_key):
        if s.app_env == "production":
            raise HTTPException(503, "PRICING_API_KEY is not set on the server.")
        return
    if not secrets.compare_digest((x_api_key or "").encode(), s.pricing_api_key.strip().encode()):
        raise HTTPException(401, "Missing or wrong X-API-Key")


def _public(r: Recommendation, *, basis: str | None = None, price: int | None = None, confidence: str | None = None,
            area: str | None = None) -> dict:
    return dict(
        service=r.service_slug, service_name=r.service_name, city=r.city, area=r.area if area is None else area,
        price=r.price if price is None else price, currency=r.currency, unit=r.unit,
        market_low=r.market_low, market_high=r.market_high, confidence=confidence or r.confidence,
        basis=basis or r.basis, updated_at=iso(r.created_at),
    )


@public_router.get("/price", dependencies=[Depends(require_api_key)])
def public_price(service: str, city: str, area: str = "", db: Session = Depends(get_pricing_db)):
    """The recommended price for a service (slug or name) in a city or area.

    An area with no price of its own gets the city's: a city-wide entry if there is one, else the median of the
    city's area prices (basis "city")."""
    key = service.strip().lower()
    q = select(Recommendation).where(
        Recommendation.is_current, Recommendation.status == "priced",
        or_(func.lower(Recommendation.service_slug) == key, func.lower(Recommendation.service_name) == key),
        func.lower(Recommendation.city) == city.strip().lower(),
    )
    recs = db.scalars(q).all()
    wanted = area.strip().lower()
    exact = next((r for r in recs if r.area.lower() == wanted), None)
    if exact:
        return _public(exact)
    city_wide = next((r for r in recs if r.area == ""), None)
    if city_wide:
        return _public(city_wide, basis="city", area=area.strip())
    if recs:
        return _public(recs[0], basis="city", area=area.strip(), confidence="low",
                       price=round_price(median(r.price for r in recs)))
    raise HTTPException(404, f"No price yet for {service!r} in {city!r}.")


@public_router.get("/prices", dependencies=[Depends(require_api_key)])
def public_prices(city: str, area: str = "", db: Session = Depends(get_pricing_db)):
    """Every priced service for a city, or for one area of it."""
    q = select(Recommendation).where(
        Recommendation.is_current, Recommendation.status == "priced", func.lower(Recommendation.city) == city.strip().lower(),
    )
    if area.strip():
        q = q.where(func.lower(Recommendation.area) == area.strip().lower())
    return [_public(r) for r in db.scalars(q.order_by(Recommendation.area, Recommendation.service_name))]


pricing_router.include_router(public_router)
