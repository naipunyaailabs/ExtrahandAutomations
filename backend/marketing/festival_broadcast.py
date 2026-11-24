"""Festival WhatsApp for the cities switched on (Advertisement > States & Cities).

A city card has an On / Off switch. For every city that is on, the agent sends each customer in that city the
festivals of their calendar (the city's own festivals and the All-India ones) on the festival's send dates:
  - the poster, as an image template (extrahand_festival_poster), when the festival has a poster and Meta has
    approved that template;
  - otherwise the festival's WhatsApp text message (the Task-Seeding template extrahand_task_seed).
Once per festival and customer (festival_broadcasts table). Numbers that replied STOP are skipped.
Festivals whose message is switched off, or that have no service to name, are not sent.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AppSetting, FestivalBroadcast, SeedContact, utcnow

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/marketing/festival-broadcast", tags=["Festival WhatsApp"])

IST = timezone(timedelta(hours=5, minutes=30))
AKEY = "festival_regions_active"  # {"cities": {"siddipet": "2026-11-25T01:30:00"}}
POSTER_TEMPLATE = "extrahand_festival_poster"
MAX_SENDS_PER_RUN = 40
CHECK_EVERY = 300.0  # seconds between passes
_state: dict[str, Any] = {"at": 0.0, "when": None, "result": None, "blocked": None}
_lock = threading.Lock()


# ------------------------------------------------------------------------------------------------ cities on / off

def active_cities(db: Session) -> dict[str, str]:
    """{city name in lower case: switched on at (ISO)}."""
    row = db.get(AppSetting, AKEY)
    try:
        data = json.loads(row.value) if row else {}
    except ValueError:
        data = {}
    cities = data.get("cities") if isinstance(data, dict) else None
    return {str(k).lower(): str(v) for k, v in (cities or {}).items()}


def set_active(db: Session, city: str, on: bool) -> dict[str, str]:
    cities = active_cities(db)
    key = city.strip().lower()
    if on:
        cities.setdefault(key, datetime.now(IST).isoformat(timespec="seconds"))
    else:
        cities.pop(key, None)
    row = db.get(AppSetting, AKEY) or AppSetting(key=AKEY)
    row.value = json.dumps({"cities": cities})
    db.add(row)
    db.commit()
    return cities


def _region_info() -> dict[str, dict[str, Any]]:
    """{lower city: {name, state}} for the monitored cities (not All-India)."""
    from .database import db_get_all_cities

    out = {}
    for c in db_get_all_cities():
        if c.get("is_national") or c.get("region_type") == "national":
            continue
        out[(c.get("city_name") or "").strip().lower()] = {"name": c.get("city_name"), "state": c.get("state") or ""}
    return out


# ------------------------------------------------------------------------------------------------ who and what

def _digits10(phone: str | None) -> str:
    d = re.sub(r"\D", "", phone or "")
    return d[-10:] if len(d) >= 10 else ""


def customers_by_city(db: Session) -> dict[str, dict[str, dict[str, str]]]:
    """{lower city: {phone10: {name, phone}}}: real ExtraHand customers (their bookings' city) and registered
    customers the Task-Seeding Agent knows (their profile city)."""
    from user_engagement.service import load_orders

    out: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    try:
        orders = load_orders(db)["orders"]
    except Exception as e:  # noqa: BLE001
        log.warning("Festival WhatsApp: could not read the customers: %s", e)
        orders = []
    for o in orders:
        city, p10 = (o.get("city") or "").strip().lower(), _digits10(o.get("customer_phone"))
        if city and p10:
            out[city][p10] = {"name": o.get("customer_name") or "", "phone": o.get("customer_phone") or ""}
    for c in db.query(SeedContact).all():
        city, p10 = (c.city or "").strip().lower(), _digits10(c.phone)
        if city and p10 and p10 not in out[city]:
            out[city][p10] = {"name": c.name or "", "phone": c.phone or ""}
    return out


def due_festivals(db: Session, today: date) -> list[dict[str, Any]]:
    """Festivals whose WhatsApp message is sent today: message on, at least one service, today in its send days."""
    from .database import db_get_event_by_id
    from .task_seeding import config, festival_messages, festival_services, send_dates, upcoming_festivals

    cfg = config(db)
    window = int(cfg.get("festival_window_days", 21))
    messages = festival_messages(db)
    out = []
    for ev in upcoming_festivals(today, window + 31):
        if ev.get("status") != "Approved":
            continue
        own = messages.get(ev["id"]) or {}
        if own.get("enabled") is False:
            continue
        services = festival_services(ev, own)
        if not services:
            continue
        dates = send_dates(ev, own, window)
        if not dates or not dates[0] <= today <= dates[1]:
            continue
        full = db_get_event_by_id(ev["id"]) or {}
        out.append({**ev, "services": services, "hooks": own.get("hooks") or {}, "poster_url": full.get("poster_url") or ""})
    return out


async def poster_versions() -> list[dict[str, Any]]:
    from whatsapp.welcomers import _versions

    return await _versions(POSTER_TEMPLATE)


def _variables(name: str, ev: dict, lang: str, city: str) -> dict[str, str]:
    from .task_seeding import default_hooks, service_names

    first = (name or "").strip().split(" ")[0] or {"te": "గారు", "hi": "जी"}.get(lang, "there")
    hook = (ev.get("hooks") or {}).get(lang) or default_hooks(ev["title"]).get(lang) or ev["title"]
    return {"1": first, "2": hook, "3": service_names(ev["services"], lang), "4": city}


async def _send(phone: str, template: str, lang: str, variables: dict, image_url: str | None, tag: str):
    from whatsapp.meta_client import get_meta_whatsapp_client
    from whatsapp.metering import tagged

    with tagged("festival_whatsapp", tag):
        return await get_meta_whatsapp_client().send_template_message(
            to=phone, template_name=template, language_code=lang, variables=variables, image_url=image_url,
            button_slug=f"fw{uuid.uuid4().hex[:10]}",
        )


# ------------------------------------------------------------------------------------------------ the agent

def run_festival_broadcast(db: Session, force: bool = False) -> dict[str, Any]:
    """One pass (the worker calls it every tick; it works at most every few minutes)."""
    active = active_cities(db)
    if not active:
        return {}
    if not force and time.monotonic() - _state["at"] < CHECK_EVERY:
        return {}
    if not _lock.acquire(blocking=False):
        return {}
    try:
        _state["at"] = time.monotonic()
        result = _run(db, active)
        _state["when"], _state["result"] = utcnow().isoformat(), result
        return result
    finally:
        _lock.release()


def _run(db: Session, active: dict[str, str]) -> dict[str, Any]:
    from .task_seeding import is_opted_out, language_for, sending_language, stable_link_base, template_versions

    today = datetime.now(IST).date()
    festivals = due_festivals(db, today)
    if not festivals:
        _state["blocked"] = None
        return {"festivals": 0}
    regions = _region_info()
    customers = customers_by_city(db)
    try:
        text_versions = asyncio.run(template_versions())
        img_versions = asyncio.run(poster_versions())
    except Exception as e:  # noqa: BLE001
        log.warning("Festival WhatsApp: template lookup failed: %s", e)
        return {"error": "template lookup failed"}
    base = stable_link_base()
    done = {(r.event_id, r.phone) for r in db.query(FestivalBroadcast.event_id, FestivalBroadcast.phone).all()}
    counts: dict[str, int] = defaultdict(int)
    sent = 0
    _state["blocked"] = None
    for ev in festivals:
        where = (ev.get("city") or "").strip().lower()
        cities = [c for c in active if where == "all-india" or c == where]
        for city in cities:
            info = regions.get(city) or {"name": city.title(), "state": ""}
            wanted = language_for(info["state"])
            for p10, who in customers.get(city, {}).items():
                if sent >= MAX_SENDS_PER_RUN:
                    return dict(counts)
                if (ev["id"], p10) in done:
                    continue
                if is_opted_out(db, who["phone"]):
                    db.add(FestivalBroadcast(event_id=ev["id"], event_title=ev["title"], city=info["name"], phone=p10,
                                             name=who["name"], kind="text", status="opted_out"))
                    db.commit()
                    done.add((ev["id"], p10))
                    continue
                img_lang = sending_language(img_versions, wanted) if ev["poster_url"] and base else None
                lang = img_lang or sending_language(text_versions, wanted)
                if lang is None:
                    _state["blocked"] = "The WhatsApp template is not approved by Meta yet."
                    return dict(counts)
                kind = "poster" if img_lang else "text"
                row = FestivalBroadcast(event_id=ev["id"], event_title=ev["title"], city=info["name"], phone=p10,
                                        name=who["name"], kind=kind, language=lang, status="sending")
                db.add(row)
                db.commit()  # claimed first: a crash mid-send must not message them twice
                done.add((ev["id"], p10))
                try:
                    resp = asyncio.run(_send(
                        who["phone"], POSTER_TEMPLATE if kind == "poster" else _text_template(), lang,
                        _variables(who["name"], ev, lang, info["name"]),
                        f"{base}{ev['poster_url']}" if kind == "poster" else None, f"festival_{kind}"))
                    row.status, row.message_id, row.error = resp.status, resp.message_id, (resp.error or "")[:300] or None
                except Exception as e:  # noqa: BLE001
                    row.status, row.error = "failed", str(e)[:300]
                if row.status not in ("failed",):
                    row.status = "sent" if row.status != "simulated" else "simulated"
                db.commit()
                sent += 1
                counts[f"{kind}_{row.status}"] += 1
                log.info("Festival WhatsApp: %s to %s (%s, %s) -> %s", ev["title"], p10, info["name"], kind, row.status)
    return dict(counts)


def _text_template() -> str:
    from .task_seeding import TEMPLATE

    return TEMPLATE


# ------------------------------------------------------------------------------------------------ API

def _poster_template_view(versions: list[dict]) -> list[dict[str, Any]]:
    return [{"language": v["language"], "language_name": v["language_name"], "status": v["status"],
             "rejected_reason": v.get("rejected_reason")} for v in versions]


@router.get("/status")
async def status(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Cities switched on, what was sent per city, and the poster template's review at Meta."""
    from sqlalchemy import func

    rows = (db.query(FestivalBroadcast.city, FestivalBroadcast.status, func.count(), func.max(FestivalBroadcast.created_at))
            .group_by(FestivalBroadcast.city, FestivalBroadcast.status).all())
    per_city: dict[str, dict[str, Any]] = defaultdict(lambda: {"sent": 0, "failed": 0, "last_at": None})
    for city, st, n, last in rows:
        c = per_city[(city or "").lower()]
        if st in ("sent", "simulated"):
            c["sent"] += n
        elif st == "failed":
            c["failed"] += n
        if last and (c["last_at"] is None or last.isoformat() > c["last_at"]):
            c["last_at"] = last.isoformat()
    try:
        versions = await poster_versions()
    except Exception:  # noqa: BLE001
        versions = []
    return {
        "active": active_cities(db),
        "per_city": dict(per_city),
        "poster_template": _poster_template_view(versions),
        "blocked": _state["blocked"],
        "last_run": _state["when"],
    }


class ActivePayload(BaseModel):
    active: bool


@router.put("/regions/{city}")
def switch_city(city: str, payload: ActivePayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Switch festival WhatsApp on or off for a city."""
    if city.strip().lower() in ("all-india", "india", "national"):
        raise HTTPException(400, "All-India festivals are sent in every city that is on; switch cities on instead.")
    if city.strip().lower() not in _region_info():
        raise HTTPException(404, f"{city} is not a monitored city")
    cities = set_active(db, city, payload.active)
    if payload.active:
        _state["at"] = 0.0  # look at the city on the next tick
    return {"active": cities}


@router.post("/poster-template")
async def submit_poster_template(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Sends the poster template (festival poster on top + the festival message) to Meta for review, in every
    language not there yet; a rejected one is sent again with the current wording."""
    from whatsapp.meta_client import BRAND_HEADER, get_meta_whatsapp_client

    from .task_seeding import BOOKING_URL, LINK_PATH, check_template, stable_link_base, template_text

    existing = {v["language"]: v for v in await poster_versions()}
    base = stable_link_base()
    url = f"{base}{LINK_PATH}{{{{1}}}}" if base else f"{BOOKING_URL}?ref={{{{1}}}}"
    client = get_meta_whatsapp_client()
    handle = None
    results: dict[str, Any] = {}
    for lang, t in template_text(db).items():
        why = check_template(t["body"], t["footer"], t["button"])
        if why:
            results[lang] = {"ok": False, "error": why}
            continue
        buttons = [{"type": "URL", "text": t["button"], "url": url, "example": [url.replace("{{1}}", "abc123")]}]
        have = existing.get(lang)
        if have and have["status"] != "REJECTED":
            results[lang] = {"ok": True, "already": True, "status": have["status"]}
            continue
        if have and have.get("id"):
            res = await client.edit_template(have["id"], body=t["body"], examples=t["examples"], footer=t["footer"],
                                             buttons=buttons)
        else:
            if handle is None:
                ext = BRAND_HEADER.suffix.lower()
                up = await client.upload_template_sample(BRAND_HEADER.read_bytes(),
                                                         "image/png" if ext == ".png" else "image/jpeg",
                                                         filename=BRAND_HEADER.name)
                if not up.get("ok"):
                    raise HTTPException(400, up.get("error") or "Could not upload the sample image to Meta.")
                handle = up["handle"]
            res = await client.create_template(name=POSTER_TEMPLATE, category="MARKETING", body=t["body"], language=lang,
                                               examples=t["examples"], footer=t["footer"], buttons=buttons,
                                               header_handle=handle)
        results[lang] = {"ok": bool(res.get("ok")), "status": res.get("status"), "error": res.get("error")}
        log.info("Festival poster template %s -> %s", lang, res)
    if hasattr(client, "_templates_cache"):
        client._templates_cache = {"at": 0.0, "data": []}
    return {"results": results, "poster_template": _poster_template_view(await poster_versions())}
