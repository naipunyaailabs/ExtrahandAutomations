"""Marketing (Advertisement agent) storage.

Uses the platform's main database (DATABASE_URL, e.g. PostgreSQL) through SQLAlchemy, so regions, festival
events, posters, crawl telemetry and agent runs live next to the rest of the data. Works on SQLite too.
"""
import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Column, Float, Integer, MetaData, String, Table, Text, case, delete, func, insert, inspect, select, text, update,
)

from app.config import get_settings
from app.database import engine

logger = logging.getLogger("advestiment.database")

_settings = get_settings()
POSTERS_DIR = Path(_settings.marketing_posters_dir)
POSTERS_DIR.mkdir(parents=True, exist_ok=True)

metadata = MetaData()

ad_cities = Table(
    "ad_cities", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("city_name", String(120), unique=True, nullable=False),
    Column("state", String(120), nullable=False, default=""),
    Column("data_sources", Text, nullable=False, default="[]"),  # unused: festivals are registered by hand
    Column("top_demand_service", Text, default=""),
    Column("featured_discount", Text, default=""),
    Column("is_national", Integer, default=0),
    # "national" (All-India), "state", "union_territory" or "city". Rows from before regions existed have "".
    Column("region_type", String(20), default=""),
    # 1 = comes from data/regions.json (removed again when taken out of the file); 0 = added in the UI
    Column("seeded", Integer, default=0),
    Column("created_at", String(32)),
    Column("updated_at", String(32)),
)

ad_events = Table(
    "ad_events", metadata,
    Column("id", String(160), primary_key=True),
    Column("city", String(120), nullable=False, index=True),
    Column("title", Text, nullable=False),
    Column("category", String(120), default=""),
    Column("date_start", String(10), nullable=False, index=True),
    Column("date_end", String(10), nullable=False),
    Column("impact_level", String(40), default=""),
    Column("target_services", Text, default="[]"),
    Column("description", Text, default=""),
    Column("demand_surge", Text, default=""),
    Column("suggested_discount", Integer, default=0),
    Column("discount_code", String(40), nullable=False, default=""),
    Column("promo_template", Text, nullable=False, default=""),
    Column("source", String(60), default=""),
    Column("status", String(40), default="Approved"),
    Column("importance_score", Integer, default=0),
    Column("importance_reason", Text, default=""),
    Column("event_scope", String(20), default="local"),
    Column("source_url", Text, default=""),
    Column("source_name", Text, default=""),
    Column("is_verified", Integer, default=0),
    Column("confidence_score", Integer, default=0),
    Column("poster_url", Text, default=""),
    Column("poster_theme", Text, default=""),
    Column("poster_palette", Text, default="{}"),
    Column("poster_generated_at", String(32), default=""),
    Column("admin_notes", Text, default=""),
    Column("published_at", String(32), default=""),
    Column("discovery_date", String(10), default=""),
    Column("source_urls", Text, default="[]"),
    # Researched festival profile (JSON): meaning, rituals, symbols, colours, greeting, imagery do/avoid, ...
    Column("knowledge", Text, default="{}"),
    Column("created_at", String(32)),
    Column("updated_at", String(32)),
)

ad_posters = Table(
    "ad_posters", metadata,
    Column("id", String(200), primary_key=True),
    Column("event_id", String(160), nullable=False, index=True),
    Column("event_title", Text, nullable=False),
    Column("city", String(120), nullable=False),
    Column("date_str", String(32), nullable=False),
    Column("poster_url", Text, nullable=False),
    Column("poster_svg", Text, nullable=False, default=""),
    Column("theme", Text, default="default"),
    Column("status", String(40), default="generated"),
    Column("created_at", String(32)),
)

# One row per run of the All-India festival finder (GPT-OSS-20B agent reading Drik Panchang)
ad_festival_runs = Table(
    "ad_festival_runs", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("period", String(40), default=""),
    Column("status", String(20), nullable=False),
    Column("found", Integer, default=0),
    Column("saved", Integer, default=0),
    Column("summary", Text, default=""),
    Column("model", String(120), default=""),
    Column("ran_at", String(32), nullable=False),
)

# One row per paid AI request of the Advertisement Agent (OpenRouter): festival scan, research, poster brief,
# poster drawing and poster check. Feeds the Advertisement Commercials page.
ad_ai_usage = Table(
    "ad_ai_usage", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("job_id", String(40), index=True, default=""),  # one festival scan or one poster: its steps share it
    Column("job_kind", String(20), default=""),  # scan | poster | research
    Column("operation", String(20), nullable=False, index=True),  # scan | research | brief | draw | check
    Column("model", String(120), default=""),
    Column("event_id", String(160), default=""),
    Column("title", Text, default=""),
    Column("prompt_tokens", Integer, default=0),
    Column("completion_tokens", Integer, default=0),
    Column("images", Integer, default=0),
    Column("cost_usd", Float, default=0.0),
    Column("cost_source", String(12), default=""),  # openrouter (reported) | estimate (rate card) | none (failed)
    Column("ok", Integer, default=1),
    Column("latency_ms", Integer, default=0),
    Column("created_at", String(32), nullable=False, index=True),  # UTC, ISO
)

_init_lock = threading.Lock()
_initialized = False


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _upsert(table: Table, values: Dict[str, Any], keys: List[str]):
    """INSERT ... ON CONFLICT statement for the current dialect (PostgreSQL or SQLite)."""
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as dialect_insert
    else:
        from sqlalchemy.dialects.sqlite import insert as dialect_insert
    return dialect_insert(table).values(**values), keys


def default_coupon_code(city: str, discount: int) -> str:
    """Coupon code used when an event has none: first letters of the city + discount, e.g. SIDD25."""
    last_word = (city or "").replace("-", " ").split()[-1:] or [""]
    letters = "".join(ch for ch in last_word[0].upper() if ch.isalpha())[:4]
    return f"{letters}{int(discount or 0)}"


# ---------------------------------------------------------------------------
# Schema + one-time import of the old SQLite file
# ---------------------------------------------------------------------------

def _add_missing_columns() -> None:
    """create_all() does not alter existing tables, so add any new columns here."""
    insp = inspect(engine)
    for table in metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            col_type = col.type.compile(dialect=engine.dialect)
            default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
            default_sql = ""
            if isinstance(default, str):
                default_sql = " DEFAULT '" + default.replace("'", "''") + "'"
            elif isinstance(default, (int, float)):
                default_sql = f" DEFAULT {default}"
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}{default_sql}'))
            logger.info("[Advestiment DB] Added column %s.%s", table.name, col.name)


def _sync_regions() -> None:
    """Keep ad_cities in step with data/regions.json (All-India and the cities).

    Regions missing from the table are inserted. Regions that came from the file but are no longer listed
    in it are removed when they have no events. Cities added with the UI's Add City button are kept.
    """
    try:
        from .seed_data import seed_regions
        seeded = seed_regions()
        wanted = {r["name"].lower() for r in seeded}
        with engine.begin() as conn:
            conn.execute(
                update(ad_cities)
                .where((ad_cities.c.is_national == 1) | (ad_cities.c.city_name == "All-India"))
                .values(region_type="national", is_national=1)
            )
            # No region is web-searched any more: clear any website links left from before
            conn.execute(update(ad_cities).where(ad_cities.c.data_sources != "[]").values(data_sources="[]"))

            conn.execute(
                update(ad_cities).where(func.lower(ad_cities.c.city_name).in_(wanted)).values(seeded=1)
            )
            stale = [
                r[0] for r in conn.execute(
                    select(ad_cities.c.city_name).where(ad_cities.c.seeded == 1, ad_cities.c.is_national == 0)
                ).all()
                if r[0].lower() not in wanted
            ]
            for name in stale:
                has_events = conn.execute(
                    select(func.count()).select_from(ad_events).where(func.lower(ad_events.c.city) == name.lower())
                ).scalar()
                if has_events:
                    continue
                conn.execute(delete(ad_cities).where(ad_cities.c.city_name == name))

            existing = {r[0].lower() for r in conn.execute(select(ad_cities.c.city_name)).all()}
            now = _now()
            for r in seeded:
                if r["name"].lower() in existing:
                    continue
                conn.execute(insert(ad_cities).values(
                    city_name=r["name"],
                    state=r.get("state") or r["name"],
                    data_sources="[]",
                    top_demand_service="",
                    featured_discount="",
                    is_national=1 if r.get("region_type") == "national" else 0,
                    region_type=r.get("region_type") or "state",
                    seeded=1,
                    created_at=now,
                    updated_at=now,
                ))
    except Exception as exc:
        logger.warning("[Advestiment DB] Could not sync regions: %s", exc)


def init_advestiment_db() -> None:
    """Create the marketing tables in the main database (once per process) and sync the regions."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        with engine.begin() as conn:
            # Logs of the removed web-search agents
            conn.execute(text("DROP TABLE IF EXISTS ad_crawl_telemetry"))
            conn.execute(text("DROP TABLE IF EXISTS ad_discovery_runs"))
        metadata.create_all(engine)
        had_seeded_flag = any(c["name"] == "seeded" for c in inspect(engine).get_columns("ad_cities"))
        _add_missing_columns()
        if not had_seeded_flag:
            # Every region stored before this flag existed was loaded from the seed file
            with engine.begin() as conn:
                conn.execute(update(ad_cities).values(seeded=1))
        _sync_regions()
        _initialized = True
        logger.info("[Advestiment DB] Marketing tables ready on %s", engine.dialect.name)


# ---------------------------------------------------------------------------
# Row mapping
# ---------------------------------------------------------------------------

def _json(value: Optional[str], default: Any) -> Any:
    try:
        return json.loads(value) if value else default
    except (TypeError, json.JSONDecodeError):
        return default


def _row_to_event_dict(r: Any) -> Dict[str, Any]:
    """Convert an ad_events row mapping into the event dictionary the service uses."""
    discount = r["suggested_discount"] or _settings.marketing_default_discount
    palette = None
    if r["poster_palette"] and str(r["poster_palette"]).startswith("{"):
        palette = _json(r["poster_palette"], None) or None
    if palette is None and r["poster_theme"] and str(r["poster_theme"]).startswith("{"):
        palette = _json(r["poster_theme"], None)
    return {
        "id": r["id"],
        "city": r["city"],
        "title": r["title"],
        "category": r["category"] or "",
        "date_start": r["date_start"],
        "date_end": r["date_end"],
        "impact_level": r["impact_level"] or "",
        "target_services": _json(r["target_services"], []),
        "description": r["description"] or "",
        "demand_surge": r["demand_surge"] or "",
        "suggested_discount": discount,
        "discount_code": r["discount_code"] or default_coupon_code(r["city"], discount),
        "promo_template": r["promo_template"] or "",
        "source": r["source"] or "",
        "status": r["status"] or "Approved",
        "importance_score": r["importance_score"] if r["importance_score"] is not None else 0,
        "importance_reason": r["importance_reason"] or "",
        "event_scope": r["event_scope"] or ("national" if r["city"] == "All-India" else "local"),
        "source_url": r["source_url"] or "",
        "source_name": r["source_name"] or "",
        "is_verified": bool(r["is_verified"]),
        "confidence_score": r["confidence_score"] if r["confidence_score"] is not None else 0,
        "poster_url": r["poster_url"] or "",
        "poster_theme": r["poster_theme"] or "",
        "poster_generated_at": r["poster_generated_at"] or "",
        "poster_palette": palette,
        "admin_notes": r["admin_notes"] or "",
        "published_at": r["published_at"] or "",
        "discovery_date": r["discovery_date"] or "",
        "knowledge": _json(r["knowledge"], {}) or {},
    }


def _not_past(today: str):
    return (ad_events.c.date_end >= today) | ((ad_events.c.date_end == "") & (ad_events.c.date_start >= today))


# ---------------------------------------------------------------------------
# Cities
# ---------------------------------------------------------------------------

def db_get_all_cities() -> List[Dict[str, Any]]:
    """All monitored regions: All-India first, then states / union territories / cities by name."""
    init_advestiment_db()
    with engine.connect() as conn:
        rows = conn.execute(
            select(ad_cities).order_by(ad_cities.c.is_national.desc(), ad_cities.c.city_name.asc())
        ).mappings().all()
    return [{
        "city_name": r["city_name"],
        "state": r["state"],
        "top_demand_service": r["top_demand_service"] or "",
        "featured_discount": r["featured_discount"] or "",
        "is_national": bool(r["is_national"]),
        "region_type": r["region_type"] or ("national" if r["is_national"] else "city"),
    } for r in rows]


def db_find_region_name(name: str) -> Optional[str]:
    """Stored spelling of a region (case-insensitive lookup), or None when it is not monitored."""
    init_advestiment_db()
    with engine.connect() as conn:
        return conn.execute(
            select(ad_cities.c.city_name).where(func.lower(ad_cities.c.city_name) == name.strip().lower())
        ).scalar()


def db_save_or_update_city(
    city_name: str,
    state: Optional[str] = None,
    top_demand: str = "",
    featured_discount: str = "",
    is_national: bool = False,
    region_type: str = "city",
) -> Dict[str, Any]:
    init_advestiment_db()
    name = db_find_region_name(city_name) or city_name.strip()
    clean_state = (state or _settings.marketing_default_state).strip()
    kind = "national" if is_national else region_type
    now = _now()
    stmt, _ = _upsert(ad_cities, {
        "city_name": name, "state": clean_state, "data_sources": "[]",
        "top_demand_service": top_demand, "featured_discount": featured_discount,
        "is_national": 1 if is_national else 0, "region_type": kind,
        "created_at": now, "updated_at": now,
    }, ["city_name"])
    stmt = stmt.on_conflict_do_update(
        index_elements=["city_name"],
        set_={"state": stmt.excluded.state, "updated_at": stmt.excluded.updated_at},
    )
    with engine.begin() as conn:
        conn.execute(stmt)
    return {
        "city_name": name, "state": clean_state,
        "top_demand_service": top_demand, "featured_discount": featured_discount, "is_national": is_national,
        "region_type": kind,
    }


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def db_get_city_events(city_name: str, include_unapproved: bool = False,
                       include_completed: bool = False) -> List[Dict[str, Any]]:
    """Upcoming events for a city. Past events are excluded unless ``include_completed``, which also returns
    approved festivals whose date has passed (completed; they keep their poster). Past unapproved ones never show."""
    init_advestiment_db()
    when = _not_past(_today())
    if include_completed:
        when = when | (ad_events.c.status == "Approved")
    q = select(ad_events).where(func.lower(ad_events.c.city) == city_name.strip().lower(), when)
    if not include_unapproved:
        q = q.where(ad_events.c.status != "Rejected")
    with engine.connect() as conn:
        rows = conn.execute(q.order_by(ad_events.c.date_start.asc())).mappings().all()
    return [_row_to_event_dict(r) for r in rows]


def db_get_event_by_id(event_id: str) -> Optional[Dict[str, Any]]:
    init_advestiment_db()
    with engine.connect() as conn:
        row = conn.execute(select(ad_events).where(ad_events.c.id == event_id)).mappings().first()
    return _row_to_event_dict(row) if row else None


def db_save_or_update_event(event_dict: Dict[str, Any]) -> None:
    """Insert or update an event. Past events are rejected. Existing poster fields are kept when not given."""
    init_advestiment_db()
    date_end = event_dict.get("date_end") or event_dict.get("date_start", "")
    if date_end and date_end < _today():
        logger.info("[Advestiment DB] Rejected saving past event '%s' ended on %s", event_dict.get("title"), date_end)
        return

    now = _now()
    discount = int(event_dict.get("suggested_discount") or _settings.marketing_default_discount)
    palette_val = event_dict.get("poster_palette")
    palette_str = json.dumps(palette_val) if isinstance(palette_val, dict) else (str(palette_val) if palette_val else "")
    values = {
        "id": event_dict["id"],
        "city": event_dict["city"],
        "title": event_dict["title"],
        "category": event_dict.get("category") or "",
        "date_start": event_dict["date_start"],
        "date_end": event_dict.get("date_end") or event_dict["date_start"],
        "impact_level": event_dict.get("impact_level") or "",
        "target_services": json.dumps(event_dict.get("target_services") or []),
        "description": event_dict.get("description") or "",
        "demand_surge": event_dict.get("demand_surge") or "",
        "suggested_discount": discount,
        "discount_code": event_dict.get("discount_code") or default_coupon_code(event_dict.get("city", ""), discount),
        "promo_template": event_dict.get("promo_template") or "",
        "source": event_dict.get("source") or "",
        "status": event_dict.get("status") or "Approved",
        "importance_score": int(event_dict.get("importance_score") or 0),
        "importance_reason": event_dict.get("importance_reason") or "",
        "event_scope": event_dict.get("event_scope") or ("national" if event_dict.get("city") == "All-India" else "local"),
        "source_url": event_dict.get("source_url") or "",
        "source_name": event_dict.get("source_name") or "",
        "is_verified": 1 if event_dict.get("is_verified") else 0,
        "confidence_score": int(event_dict.get("confidence_score") or 0),
        "poster_url": event_dict.get("poster_url") or "",
        "poster_theme": event_dict.get("poster_theme") or palette_str,
        "poster_palette": palette_str or "{}",
        "poster_generated_at": event_dict.get("poster_generated_at") or "",
        "admin_notes": event_dict.get("admin_notes") or "",
        "published_at": event_dict.get("published_at") or "",
        "discovery_date": event_dict.get("discovery_date") or now[:10],
        "source_urls": json.dumps(event_dict.get("source_urls") or []),
        "knowledge": json.dumps(event_dict.get("knowledge") or {}),
        "created_at": now,
        "updated_at": now,
    }
    stmt, _ = _upsert(ad_events, values, ["id"])
    ex = stmt.excluded
    keep_if_blank = lambda col: case((getattr(ex, col) != "", getattr(ex, col)), else_=getattr(ad_events.c, col))  # noqa: E731
    overwrite = [c for c in values if c not in ("id", "created_at", "poster_url", "poster_theme", "poster_palette",
                                                "poster_generated_at", "published_at", "source_urls", "knowledge")]
    set_ = {c: getattr(ex, c) for c in overwrite}
    for col in ("poster_url", "poster_theme", "poster_generated_at", "published_at"):
        set_[col] = keep_if_blank(col)
    set_["poster_palette"] = case((ex.poster_palette != "{}", ex.poster_palette), else_=ad_events.c.poster_palette)
    set_["source_urls"] = case((ex.source_urls != "[]", ex.source_urls), else_=ad_events.c.source_urls)
    set_["knowledge"] = case((ex.knowledge != "{}", ex.knowledge), else_=ad_events.c.knowledge)
    with engine.begin() as conn:
        conn.execute(stmt.on_conflict_do_update(index_elements=["id"], set_=set_))


# Plain columns that db_update_event_fields may change (lists/dicts are JSON-encoded separately)
_EDITABLE_EVENT_FIELDS = {
    "title", "category", "date_start", "date_end", "impact_level", "description", "demand_surge", "source",
    "suggested_discount", "discount_code", "promo_template", "status", "admin_notes", "is_verified",
    "poster_url", "poster_theme", "poster_palette", "poster_generated_at", "published_at",
}


def db_update_event_fields(event_id: str, fields: Dict[str, Any]) -> bool:
    init_advestiment_db()
    values: Dict[str, Any] = {}
    for k, v in fields.items():
        if k in _EDITABLE_EVENT_FIELDS:
            values[k] = (1 if v else 0) if k == "is_verified" else v
        elif k in ("source_urls", "target_services") and isinstance(v, list):
            values[k] = json.dumps(v)
        elif k == "knowledge" and isinstance(v, dict):
            values[k] = json.dumps(v)
    if not values:
        return False
    values["updated_at"] = _now()
    with engine.begin() as conn:
        res = conn.execute(update(ad_events).where(ad_events.c.id == event_id).values(**values))
    return res.rowcount > 0


def db_delete_event(event_id: str) -> None:
    """Delete an event together with its saved posters (rows and image files)."""
    init_advestiment_db()
    with engine.begin() as conn:
        conn.execute(delete(ad_posters).where(ad_posters.c.event_id == event_id))
        conn.execute(delete(ad_events).where(ad_events.c.id == event_id))
    from app.services import media_store

    try:
        media_store.delete_prefix("posters", f"{event_id}.")
        media_store.delete_prefix("posters/art", f"{event_id}-v")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Advestiment DB] Could not delete the poster files of %s: %s", event_id, exc)


# ---------------------------------------------------------------------------
# Posters
# ---------------------------------------------------------------------------

def db_save_poster(poster_dict: Dict[str, Any]) -> None:
    init_advestiment_db()
    stmt, _ = _upsert(ad_posters, {
        "id": poster_dict["id"],
        "event_id": poster_dict["event_id"],
        "event_title": poster_dict["event_title"],
        "city": poster_dict["city"],
        "date_str": poster_dict["date_str"],
        "poster_url": poster_dict["poster_url"],
        "poster_svg": poster_dict.get("poster_svg") or "",
        "theme": poster_dict.get("theme") or "default",
        "status": poster_dict.get("status") or "generated",
        "created_at": _now(),
    }, ["id"])
    stmt = stmt.on_conflict_do_update(index_elements=["id"], set_={
        "poster_url": stmt.excluded.poster_url, "poster_svg": stmt.excluded.poster_svg,
        "theme": stmt.excluded.theme, "status": stmt.excluded.status, "created_at": stmt.excluded.created_at,
    })
    with engine.begin() as conn:
        conn.execute(stmt)


def db_get_poster_by_event(event_id: str) -> Optional[Dict[str, Any]]:
    init_advestiment_db()
    with engine.connect() as conn:
        row = conn.execute(
            select(ad_posters).where(ad_posters.c.event_id == event_id).order_by(ad_posters.c.created_at.desc()).limit(1)
        ).mappings().first()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Festival finder runs
# ---------------------------------------------------------------------------

def db_save_festival_run(period: str, status: str, found: int, saved: int, summary: str, model: str) -> None:
    init_advestiment_db()
    with engine.begin() as conn:
        conn.execute(insert(ad_festival_runs).values(
            period=period, status=status, found=found, saved=saved, summary=summary, model=model, ran_at=_now(),
        ))


def db_get_last_festival_run() -> Optional[Dict[str, Any]]:
    init_advestiment_db()
    with engine.connect() as conn:
        row = conn.execute(
            select(ad_festival_runs).order_by(ad_festival_runs.c.id.desc()).limit(1)
        ).mappings().first()
    return dict(row) if row else None
