"""Pricing agent tables.

On SQL Server they live in their own schema (PRICING_DATABASE_SCHEMA); elsewhere in the app's database.
All datetimes are naive UTC."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import get_settings
from app.database import base_engine, engine_for_schema, ensure_schema, is_mssql
from app.models import utcnow


class PricingBase(DeclarativeBase):
    pass


class Area(PricingBase):
    """A place the agent prices. An empty `area` means the whole city."""

    __tablename__ = "pricing_areas"
    __table_args__ = (UniqueConstraint("city", "area"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    city: Mapped[str] = mapped_column(String(100))
    area: Mapped[str] = mapped_column(String(150), default="")
    pincode: Mapped[str | None] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Service(PricingBase):
    """A service with a fixed scope, so competitor prices are compared like for like."""

    __tablename__ = "pricing_services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    scope: Mapped[str] = mapped_column(String(300), default="")  # e.g. "Deep cleaning of a 2BHK flat"
    unit: Mapped[str] = mapped_column(String(40), default="per job")
    keywords: Mapped[list] = mapped_column(JSON, default=list)  # match ExtraHand tasks for demand
    min_price: Mapped[float | None] = mapped_column(Float)
    max_price: Mapped[float | None] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Competitor(PricingBase):
    __tablename__ = "pricing_competitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    website: Mapped[str | None] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Strategy(PricingBase):
    """How the price is set from the market (one row, id=1)."""

    __tablename__ = "pricing_strategy"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position_pct: Mapped[float] = mapped_column(Float, default=-5.0)  # vs the competitor median
    demand_adjust_pct: Mapped[float] = mapped_column(Float, default=5.0)
    sentiment_adjust_pct: Mapped[float] = mapped_column(Float, default=5.0)
    demand_window_days: Mapped[int] = mapped_column(Integer, default=90)
    refresh_days: Mapped[int] = mapped_column(Integer, default=7)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Run(PricingBase):
    __tablename__ = "pricing_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|done|failed
    trigger: Mapped[str] = mapped_column(String(20), default="manual")  # manual|schedule
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    done_steps: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(String(500))
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class Observation(PricingBase):
    """One competitor price found on a page, with the text it was read from."""

    __tablename__ = "pricing_observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pricing_runs.id"), index=True)
    area_id: Mapped[int] = mapped_column(Integer, index=True)
    service_id: Mapped[int] = mapped_column(Integer, index=True)
    competitor: Mapped[str] = mapped_column(String(200))
    listed: Mapped[bool] = mapped_column(Boolean, default=False)  # on the team's competitor list
    price_min: Mapped[float] = mapped_column(Float)
    price_max: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(60))
    source_url: Mapped[str] = mapped_column(String(1000))
    source_title: Mapped[str | None] = mapped_column(String(300))
    evidence: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Rating(PricingBase):
    """How customers rate a competitor in an area."""

    __tablename__ = "pricing_ratings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pricing_runs.id"), index=True)
    area_id: Mapped[int] = mapped_column(Integer, index=True)
    competitor: Mapped[str] = mapped_column(String(200))
    rating: Mapped[float | None] = mapped_column(Float)  # out of 5
    review_count: Mapped[int | None] = mapped_column(Integer)
    sentiment: Mapped[float | None] = mapped_column(Float)  # -1 (negative) .. 1 (positive)
    summary: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(40))  # google_maps|web
    source_url: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Recommendation(PricingBase):
    """The price for one service in one area, from one run. `is_current` marks the latest run's."""

    __tablename__ = "pricing_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pricing_runs.id"), index=True)
    area_id: Mapped[int] = mapped_column(Integer, index=True)
    service_id: Mapped[int] = mapped_column(Integer, index=True)
    # Copied so the public API keeps answering if the list is edited later
    city: Mapped[str] = mapped_column(String(100), index=True)
    area: Mapped[str] = mapped_column(String(150), default="")
    service_slug: Mapped[str] = mapped_column(String(120), index=True)
    service_name: Mapped[str] = mapped_column(String(120))
    unit: Mapped[str] = mapped_column(String(40))

    status: Mapped[str] = mapped_column(String(20))  # priced|no_data
    price: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    market_median: Mapped[float | None] = mapped_column(Float)
    market_low: Mapped[float | None] = mapped_column(Float)
    market_high: Mapped[float | None] = mapped_column(Float)
    price_count: Mapped[int] = mapped_column(Integer, default=0)
    basis: Mapped[str] = mapped_column(String(10), default="area")  # area|city
    demand_level: Mapped[str] = mapped_column(String(10), default="unknown")  # low|normal|high|unknown
    demand_tasks: Mapped[int] = mapped_column(Integer, default=0)
    sentiment_level: Mapped[str] = mapped_column(String(10), default="unknown")  # weak|neutral|strong|unknown
    competitor_rating: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[str] = mapped_column(String(10), default="low")  # low|medium|high
    adjustments: Mapped[list] = mapped_column(JSON, default=list)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AreaReport(PricingBase):
    """The written competitive analysis for one area."""

    __tablename__ = "pricing_area_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pricing_runs.id"), index=True)
    area_id: Mapped[int] = mapped_column(Integer, index=True)
    city: Mapped[str] = mapped_column(String(100))
    area: Mapped[str] = mapped_column(String(150), default="")
    summary: Mapped[str] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


_engine = None
_SessionLocal: sessionmaker | None = None
_ready = False
_lock = threading.Lock()


def init_pricing_db() -> None:
    global _engine, _SessionLocal, _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        if is_mssql:
            schema = get_settings().pricing_database_schema
            ensure_schema(schema)
            _engine = engine_for_schema(schema)
        else:
            _engine = base_engine
        PricingBase.metadata.create_all(_engine)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
        _ready = True


def reset_pricing_db() -> None:
    """Tests: drop and recreate every pricing table."""
    init_pricing_db()
    PricingBase.metadata.drop_all(_engine)
    PricingBase.metadata.create_all(_engine)


def get_pricing_db() -> Iterator[Session]:
    init_pricing_db()
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def pricing_session() -> Iterator[Session]:
    init_pricing_db()
    db = _SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
