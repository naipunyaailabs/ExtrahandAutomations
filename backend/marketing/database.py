import os
import json
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger("advestiment.database")

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_DIR = BACKEND_DIR / "database"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = str(DB_DIR / "advestiment.db")


def get_db_connection() -> sqlite3.Connection:
    """Create a thread-safe connection to the Advestiment SQLite database with WAL enabled."""
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_advestiment_db():
    """Create cities, events, and crawl telemetry tables if they don't exist."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Cities Table (City Name, State, Monitored Website Links)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ad_cities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                city_name TEXT UNIQUE NOT NULL,
                state TEXT NOT NULL DEFAULT 'Telangana',
                data_sources TEXT NOT NULL DEFAULT '[]',
                top_demand_service TEXT DEFAULT 'Deep Cleaning & Repairs',
                featured_discount TEXT DEFAULT 'Up to 25% OFF',
                is_national INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # 2. Events Calendar Table (City Events, Festivals, Demand Spikes, Promo Codes)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ad_events (
                id TEXT PRIMARY KEY,
                city TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT DEFAULT 'Festival',
                date_start TEXT NOT NULL,
                date_end TEXT NOT NULL,
                impact_level TEXT DEFAULT 'High',
                target_services TEXT DEFAULT '[]',
                description TEXT DEFAULT '',
                demand_surge TEXT DEFAULT '+45% Demand Surge',
                suggested_discount INTEGER DEFAULT 20,
                discount_code TEXT NOT NULL,
                promo_template TEXT NOT NULL,
                source TEXT DEFAULT 'ai_web_crawler',
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # 3. Web Crawl Telemetry Table (URL, HTTP status, headline, discovery count)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ad_crawl_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                city TEXT NOT NULL,
                url TEXT NOT NULL,
                status TEXT DEFAULT 'scanned',
                http_status INTEGER DEFAULT 200,
                detected_headline TEXT DEFAULT '',
                events_found INTEGER DEFAULT 0,
                scanned_at TEXT
            )
        """)

        conn.commit()
        logger.info("[Advestiment DB] Initialized SQLite tables at %s", DB_PATH)


# Database CRUD helpers

def db_get_all_cities() -> List[Dict[str, Any]]:
    """Retrieve all cities and their monitored website links from the database."""
    init_advestiment_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ad_cities ORDER BY is_national DESC, id ASC")
        rows = cursor.fetchall()
        cities = []
        for r in rows:
            cities.append({
                "city_name": r["city_name"],
                "state": r["state"],
                "data_sources": json.loads(r["data_sources"] or "[]"),
                "top_demand_service": r["top_demand_service"],
                "featured_discount": r["featured_discount"],
                "is_national": bool(r["is_national"]),
            })
        return cities


def db_save_or_update_city(
    city_name: str,
    state: str = "Telangana",
    data_sources: Optional[List[str]] = None,
    top_demand: str = "Deep Cleaning & Repairs",
    featured_discount: str = "Up to 25% OFF",
    is_national: bool = False
) -> Dict[str, Any]:
    """Store a new city or update an existing city's state and monitored links in the database."""
    init_advestiment_db()
    name = city_name.strip().title()
    clean_state = state.strip().title() if state else "Telangana"
    sources_json = json.dumps(data_sources or [])
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO ad_cities (
                city_name, state, data_sources, top_demand_service, featured_discount, is_national, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(city_name) DO UPDATE SET
                state = excluded.state,
                data_sources = excluded.data_sources,
                updated_at = excluded.updated_at
        """, (name, clean_state, sources_json, top_demand, featured_discount, 1 if is_national else 0, now, now))
        conn.commit()

    return {
        "city_name": name,
        "state": clean_state,
        "data_sources": data_sources or [],
        "top_demand_service": top_demand,
        "featured_discount": featured_discount,
        "is_national": is_national
    }


def db_get_city_sources(city_name: str) -> List[str]:
    """Get the stored website links for a specific city from the database."""
    init_advestiment_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT data_sources FROM ad_cities WHERE LOWER(city_name) = LOWER(?)", (city_name.strip(),))
        row = cursor.fetchone()
        if row and row["data_sources"]:
            try:
                return json.loads(row["data_sources"])
            except Exception:
                return []
    return []


def db_get_city_events(city_name: str) -> List[Dict[str, Any]]:
    """Retrieve all calendar events for a specific city from the database."""
    init_advestiment_db()
    clean_city = city_name.strip()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM ad_events WHERE LOWER(city) = LOWER(?) ORDER BY date_start ASC",
            (clean_city,)
        )
        rows = cursor.fetchall()
        events = []
        for r in rows:
            events.append({
                "id": r["id"],
                "city": r["city"],
                "title": r["title"],
                "category": r["category"],
                "date_start": r["date_start"],
                "date_end": r["date_end"],
                "impact_level": r["impact_level"],
                "target_services": json.loads(r["target_services"] or "[]"),
                "description": r["description"],
                "demand_surge": r["demand_surge"],
                "suggested_discount": r["suggested_discount"],
                "discount_code": r["discount_code"],
                "promo_template": r["promo_template"],
                "source": r["source"]
            })
        return events


def db_save_or_update_event(event_dict: Dict[str, Any]) -> None:
    """Insert or update a festival event in the database."""
    init_advestiment_db()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    services_json = json.dumps(event_dict.get("target_services", []))

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO ad_events (
                id, city, title, category, date_start, date_end, impact_level,
                target_services, description, demand_surge, suggested_discount,
                discount_code, promo_template, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                category = excluded.category,
                date_start = excluded.date_start,
                date_end = excluded.date_end,
                impact_level = excluded.impact_level,
                target_services = excluded.target_services,
                description = excluded.description,
                demand_surge = excluded.demand_surge,
                suggested_discount = excluded.suggested_discount,
                discount_code = excluded.discount_code,
                promo_template = excluded.promo_template,
                source = excluded.source,
                updated_at = excluded.updated_at
        """, (
            event_dict["id"],
            event_dict["city"],
            event_dict["title"],
            event_dict.get("category", "Festival"),
            event_dict["date_start"],
            event_dict.get("date_end", event_dict["date_start"]),
            event_dict.get("impact_level", "High"),
            services_json,
            event_dict.get("description", ""),
            event_dict.get("demand_surge", "+50% Demand Surge"),
            event_dict.get("suggested_discount", 20),
            event_dict.get("discount_code", "PROMO20"),
            event_dict.get("promo_template", ""),
            event_dict.get("source", "ai_web_crawler"),
            now,
            now
        ))
        conn.commit()


def db_delete_city_events(city_name: str) -> None:
    """Delete all events for a specific city from the database."""
    init_advestiment_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM ad_events WHERE LOWER(city) = LOWER(?)", (city_name.strip(),))
        conn.commit()


def db_delete_all_events() -> None:
    """Clear all events to reseed fresh authentic calendar data."""
    init_advestiment_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM ad_events")
        conn.commit()


def db_save_crawl_telemetry(city_name: str, telemetry_list: List[Dict[str, Any]]) -> None:
    """Save web crawl status and detected headlines for monitored website links."""
    init_advestiment_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        for t in telemetry_list:
            cursor.execute("""
                INSERT INTO ad_crawl_telemetry (
                    city, url, status, http_status, detected_headline, events_found, scanned_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                city_name,
                t.get("url", ""),
                t.get("status", "scanned"),
                t.get("http_status", 200),
                t.get("detected_headline", ""),
                t.get("events_found", 0),
                t.get("scanned_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            ))
        conn.commit()


def db_get_latest_telemetry(city_name: str) -> List[Dict[str, Any]]:
    """Get the most recent web crawl telemetry for each URL of a city."""
    init_advestiment_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT url, status, http_status, detected_headline, events_found, scanned_at
            FROM ad_crawl_telemetry
            WHERE LOWER(city) = LOWER(?)
            ORDER BY id DESC
            LIMIT 10
        """, (city_name.strip(),))
        rows = cursor.fetchall()
        # Group by unique url keeping the latest
        seen = set()
        res = []
        for r in rows:
            u = r["url"]
            if u not in seen:
                seen.add(u)
                res.append({
                    "url": r["url"],
                    "status": r["status"],
                    "http_status": r["http_status"],
                    "detected_headline": r["detected_headline"],
                    "events_found": r["events_found"],
                    "scanned_at": r["scanned_at"]
                })
        return res

