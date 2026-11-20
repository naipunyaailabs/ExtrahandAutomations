"""Task-Seeding Agent (Advertisement module): turns newly registered ExtraHand customers into first bookings.

About 24 hours (configurable) after a customer registers and has not booked yet, the agent picks ONE service for
them and sends a WhatsApp template in their language (Telugu / Hindi / English) with a Book Now button. If they
neither click nor book, an optional Telugu voice call follows. The first booking marks them converted and stops
every further contact.

How the suggestion is chosen (only services with real bookings in the customer's area are suggested):
  1. an upcoming festival in their city / state / All-India from the Advertisement festival calendar
     (Sankranti -> house cleaning, Bathukamma / Dasara -> festival cleaning, Diwali -> deep cleaning, ...)
  2. the season (March-June: home repairs & maintenance)
  3. regular days: bathroom & kitchen cleaning

Safety: starts OFF; only customers who register after it is switched on are contacted; one row per customer
(task_seed_contacts.user_id is unique, phone numbers are checked too); STOP replies opt people out for good;
calls only inside the calling hours; test / tester accounts are never contacted.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import secrets
import threading
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.config import get_settings
from app.database import get_db
from app.models import AppSetting, SeedContact, SeedOptOut, Ticket, WhatsAppMessage, utcnow

log = logging.getLogger("marketing.task_seeding")
router = APIRouter(prefix="/api/marketing/task-seeding", tags=["Task-Seeding Agent"])

TEMPLATE = "extrahand_task_seed"
KEY = "task_seeding"
IST = timezone(timedelta(hours=5, minutes=30))
CHECK_EVERY = 60  # seconds between runs of the worker step
MAX_NEW_PER_RUN = 25  # new customers looked at per run
MAX_SENDS_PER_RUN = 25
MAX_WA_ATTEMPTS = 3  # first send + 2 automatic retries
WA_RETRY_AFTER = timedelta(minutes=30)
LOOKBACK = timedelta(days=7)  # registrations read on each run
AREA_KM = 25  # "in the customer's area": same city, or a booking within this distance
AREA_DAYS = 365  # bookings that count as proof a service is available in the area
BOOKING_URL = "https://extrahand.in/book"
LINK_PATH = "/api/marketing/task-seeding/go/"

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "since": None,  # moment it was switched on: only customers registered after it are contacted
    "delay_hours": 24,  # wait this long after registration before the first contact
    "whatsapp": True,
    "call": False,  # Telugu voice call when the WhatsApp message got no click / booking
    "call_after_hours": 24,  # after the WhatsApp message
    "festival_campaigns": True,
    "seasonal_campaigns": True,
    "festival_window_days": 21,  # a festival this many days ahead (or running) drives the suggestion
}

# ------------------------------------------------------------------------------------------------ content

LANGUAGE_NAMES = {"te": "Telugu", "hi": "Hindi", "en": "English", "en_US": "English (US)"}
TELUGU_STATES = {"telangana", "andhra pradesh"}
HINDI_STATES = {
    "uttar pradesh", "bihar", "madhya pradesh", "rajasthan", "haryana", "delhi", "nct of delhi", "jharkhand",
    "chhattisgarh", "uttarakhand", "himachal pradesh", "chandigarh",
}

# service key -> booking category family, ExtraHand category slug and its name in each language
SERVICES: dict[str, dict[str, str]] = {
    "deep_cleaning": {"family": "cleaning", "category": "cleaning",
                      "en": "home deep cleaning", "te": "ఇంటి డీప్ క్లీనింగ్", "hi": "घर की डीप क्लीनिंग"},
    "festival_cleaning": {"family": "cleaning", "category": "cleaning",
                          "en": "festival home cleaning", "te": "పండుగ ఇంటి క్లీనింగ్", "hi": "त्योहार की घर सफ़ाई"},
    "house_cleaning": {"family": "cleaning", "category": "cleaning",
                       "en": "house cleaning", "te": "ఇంటి క్లీనింగ్", "hi": "घर की सफ़ाई"},
    "bathroom_kitchen": {"family": "cleaning", "category": "cleaning",
                         "en": "bathroom and kitchen cleaning", "te": "బాత్రూమ్, కిచెన్ క్లీనింగ్",
                         "hi": "बाथरूम और किचन की सफ़ाई"},
    "home_maintenance": {"family": "repair", "category": "repair",
                         "en": "home repairs and maintenance", "te": "ఇంటి రిపేర్లు, మెయింటెనెన్స్",
                         "hi": "घर की मरम्मत और मेंटेनेंस"},
}
BASE_SERVICES = {k: dict(v) for k, v in SERVICES.items()}
SKEY = "task_seeding_services"  # services added in the calendar: [{key, en, te, hi, category}]


def custom_services(db: Session) -> list[dict]:
    row = db.get(AppSetting, SKEY)
    try:
        data = json.loads(row.value) if row else []
    except ValueError:
        data = []
    return [d for d in data if isinstance(d, dict) and d.get("key") and d.get("en") and d.get("category")]


def refresh_services(db: Session) -> None:
    """SERVICES = the built-in ones + the ones added in the calendar (kept in app settings)."""
    merged = {k: dict(v) for k, v in BASE_SERVICES.items()}
    for d in custom_services(db):
        merged[d["key"]] = {"family": f"cat:{d['category']}", "category": d["category"], "en": d["en"],
                            "te": d.get("te") or d["en"], "hi": d.get("hi") or d["en"], "custom": True}
    SERVICES.clear()
    SERVICES.update(merged)


# words in a booking's category that put it in a family
FAMILIES: dict[str, tuple[str, ...]] = {
    "cleaning": ("clean",),
    "repair": ("repair", "electric", "plumb", "appliance", "ac_", "ac ", "assembly", "maint"),
}
# festival name words -> service
FESTIVAL_SERVICES: list[tuple[tuple[str, ...], str]] = [
    (("sankranti", "pongal", "bhogi"), "house_cleaning"),
    (("bathukamma", "dussehra", "dasara", "navratri", "vijayadashami", "ugadi", "ganesh", "vinayaka", "onam",
      "bonalu"), "festival_cleaning"),
    (("diwali", "deepavali", "christmas", "new year", "holi", "eid", "ramzan", "ramadan"), "deep_cleaning"),
]
SUMMER_MONTHS = {3, 4, 5, 6}

HOOKS: dict[str, dict[str, str]] = {
    "festival": {"en": "{title} is coming – get your home ready.",
                 "te": "{title} వస్తోంది – మీ ఇంటిని సిద్ధం చేసుకోండి.",
                 "hi": "{title} आने वाला है – अपना घर तैयार करें।"},
    "summer": {"en": "Summer is here – keep your home running smoothly.",
               "te": "వేసవి వచ్చేసింది – మీ ఇంటిని సాఫీగా నడిచేలా చూసుకోండి.",
               "hi": "गर्मी आ गई है – अपने घर को ठीक-ठाक रखें।"},
    "regular": {"en": "A fresh, clean home is just a tap away.",
                "te": "శుభ్రమైన, తాజా ఇల్లు ఒక్క ట్యాప్ దూరంలో ఉంది.",
                "hi": "साफ़-सुथरा घर बस एक टैप दूर है।"},
}

# The WhatsApp template (one name, three languages). {{1}} name, {{2}} reason line, {{3}} service, {{4}} city.
TEMPLATE_TEXT: dict[str, dict[str, Any]] = {
    "te": {
        "body": "నమస్తే {{1}} 👋\n\n{{2}}\n\n{{4}}లో వెరిఫైడ్ ఎక్స్‌ట్రాహ్యాండ్ హెల్పర్లతో సరైన ధరకు {{3}} బుక్ చేసుకోండి. "
                "కేవలం 2 నిమిషాలు చాలు.",
        "footer": "ఈ మెసేజ్‌లు వద్దంటే STOP అని రిప్లై చేయండి",
        "button": "ఇప్పుడే బుక్ చేయండి",
        "examples": ["ప్రియ", "సంక్రాంతి వస్తోంది – మీ ఇంటిని సిద్ధం చేసుకోండి.", "ఇంటి క్లీనింగ్", "Siddipet"],
    },
    "hi": {
        "body": "नमस्ते {{1}} 👋\n\n{{2}}\n\n{{4}} में वेरिफ़ाइड ExtraHand हेल्पर्स के साथ सही दाम पर {{3}} बुक करें। "
                "बस 2 मिनट लगते हैं।",
        "footer": "ये मैसेज बंद करने के लिए STOP लिखें",
        "button": "अभी बुक करें",
        "examples": ["प्रिया", "दिवाली आने वाली है – अपना घर तैयार करें।", "घर की डीप क्लीनिंग", "Hyderabad"],
    },
    "en": {
        "body": "Hi {{1}} 👋\n\n{{2}}\n\nBook {{3}} in {{4}} with verified ExtraHand helpers at fair prices. "
                "It takes just 2 minutes.",
        "footer": "Reply STOP to stop these messages",
        "button": "Book Now",
        "examples": ["Priya", "Diwali is coming – get your home ready.", "home deep cleaning", "Hyderabad"],
    },
}

TKEY = "task_seeding_template"  # the admin's own wording: {lang: {body, footer, button}}
VAR_RE = re.compile(r"\{\{\s*(\d+)\s*\}\}")


def template_text(db: Session) -> dict[str, dict[str, Any]]:
    """TEMPLATE_TEXT with the wording edited in the calendar on top (each language on its own)."""
    row = db.get(AppSetting, TKEY)
    try:
        own = json.loads(row.value) if row else {}
    except ValueError:
        own = {}
    out = {}
    for lang, base in TEMPLATE_TEXT.items():
        mine = own.get(lang) if isinstance(own.get(lang), dict) else {}
        merged = {**base, **{k: mine[k] for k in ("body", "footer", "button") if mine.get(k)}}
        merged["edited"] = any(merged[k] != base[k] for k in ("body", "footer", "button"))
        out[lang] = merged
    return out


def check_template(body: str, footer: str, button: str) -> str | None:
    """Meta's rules for this template; the reason it would be refused, or None."""
    body, footer, button = body.strip(), footer.strip(), button.strip()
    found = VAR_RE.findall(body)
    if sorted(found) != ["1", "2", "3", "4"]:
        return "Keep each of {{1}} name, {{2}} festival line, {{3}} services and {{4}} city exactly once."
    if VAR_RE.match(body) or re.search(r"\{\{\s*\d+\s*\}\}$", body):
        return "The message cannot start or end with a {{…}} field; add a word before or after it."
    if re.search(r"\}\}[ \t]*\{\{", body):
        return "Put a word between two {{…}} fields."
    if len(body) > 1024:
        return "The message can be at most 1024 characters."
    if not footer or len(footer) > 60 or "\n" in footer or "{{" in footer:
        return "The footer must be one line of up to 60 characters, without {{…}} fields."
    if not button or len(button) > 25 or "\n" in button or "{{" in button:
        return "The button text must be up to 25 characters, without {{…}} fields."
    return None


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", VAR_RE.sub(lambda m: "{{" + m.group(1) + "}}", text or "")).strip()


def meta_state(draft: dict, version: dict | None) -> dict[str, Any]:
    """Where this language stands at Meta, and whether the wording here differs from what Meta has."""
    if not version:
        return {"status": "NOT_SUBMITTED", "rejected_reason": None, "changed": False}
    changed = (_norm(draft["body"]) != _norm(version.get("body"))
               or _norm(draft["footer"]) != _norm(version.get("footer"))
               or (version.get("button") is not None and _norm(draft["button"]) != _norm(version.get("button"))))
    return {"status": version["status"], "rejected_reason": version.get("rejected_reason"), "changed": changed}


# Telugu voice call (Sarvam TTS, played by Vobiz)
CALL_SCRIPT = (
    "నమస్కారం {name} గారు. ఎక్స్‌ట్రాహ్యాండ్ నుంచి మాట్లాడుతున్నాం. {hook} "
    "{city}లో {service} ఇప్పుడు అందుబాటులో ఉంది. వెరిఫైడ్ హెల్పర్లు, సరైన ధరలు. "
    "{how} ధన్యవాదాలు."
)
CALL_HOW_WA = "మేము మీ వాట్సాప్‌కు పంపిన ఇప్పుడే బుక్ చేయండి బటన్‌తో రెండు నిమిషాల్లో బుక్ చేసుకోండి."
CALL_HOW_APP = "ఎక్స్‌ట్రాహ్యాండ్ యాప్‌లో రెండు నిమిషాల్లో బుక్ చేసుకోండి."

STOP_WORDS = {"STOP", "STOP ALL", "UNSUBSCRIBE", "OPT OUT", "OPTOUT", "STOP PROMOTIONS", "ఆపు", "ఆపండి",
              "रोकें", "रोको", "बंद", "बंद करें", "बंद करो"}

# ------------------------------------------------------------------------------------------------ settings

_last_run: dict[str, Any] = {"at": 0.0, "when": None, "result": None, "blocked": None}
_run_lock = threading.Lock()


def config(db: Session) -> dict[str, Any]:
    try:
        refresh_services(db)
    except Exception:  # noqa: BLE001
        log.warning("Task seeding: could not load the added services", exc_info=True)
    row = db.get(AppSetting, KEY)
    data: dict = {}
    if row:
        try:
            data = json.loads(row.value) or {}
        except ValueError:
            data = {}
    return {**DEFAULTS, **{k: v for k, v in data.items() if k in DEFAULTS}}


def save_config(db: Session, cfg: dict[str, Any]) -> None:
    row = db.get(AppSetting, KEY) or AppSetting(key=KEY)
    row.value = json.dumps({k: cfg.get(k, DEFAULTS[k]) for k in DEFAULTS})
    db.add(row)
    db.commit()


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _digits10(phone: str | None) -> str:
    d = re.sub(r"\D", "", phone or "")
    return d[-10:] if len(d) >= 10 else ""


def language_for(state: str | None) -> str:
    s = (state or "").strip().lower()
    if s in TELUGU_STATES:
        return "te"
    if s in HINDI_STATES:
        return "hi"
    return "en"


# ------------------------------------------------------------------------------------------------ inputs

def _signups(since: datetime) -> list[dict]:
    """Real ExtraHand customers who registered after `since` (oldest first), straight from the ExtraHand API."""
    from app.integrations.extrahand import get_source
    from app.integrations.mapping import normalize_user
    from app.services.real_data import is_real_user

    src = get_source()
    since_iso = since.isoformat(timespec="milliseconds") + "Z"
    reader = getattr(src, "list_users_since", None)
    items = reader("customer", since_iso) if reader else src.list_users("customer", max_pages=10)
    out: dict[str, dict] = {}
    for raw in items or []:
        if not isinstance(raw, dict) or str(raw.get("role") or "").lower() != "customer":
            continue
        created = _parse_dt(raw.get("createdAt") or raw.get("created_at"))
        if not created or created < since:
            continue
        rec = normalize_user(raw)
        pid = str(raw.get("_id") or raw.get("profileId") or rec.get("profile_id") or rec.get("id") or "")
        if not pid or not is_real_user(raw, str(rec.get("id") or pid)):
            continue  # test / payment-tester accounts are never contacted
        if raw.get("bannedAt") or raw.get("suspendedAt") or raw.get("isActive") is False:
            continue
        out[pid] = {
            "id": pid, "uid": rec.get("id"), "name": rec.get("name"), "phone": rec.get("phone"),
            "city": rec.get("city"), "state": rec.get("state"), "lat": rec.get("lat"), "lng": rec.get("lng"),
            "registered_at": created,
        }
    return sorted(out.values(), key=lambda u: u["registered_at"])


def upcoming_festivals(today: date, days: int) -> list[dict]:
    """Festivals from the Advertisement calendar running today or starting within `days` (rejected ones left out)."""
    try:
        from sqlalchemy import select

        from app.database import engine

        from .database import ad_events, init_advestiment_db

        init_advestiment_db()
        start, end = today.isoformat(), (today + timedelta(days=days)).isoformat()
        q = select(ad_events).where(
            ad_events.c.date_start <= end,
            (ad_events.c.date_end >= start) | ((ad_events.c.date_end == "") & (ad_events.c.date_start >= start)),
            ad_events.c.status != "Rejected",
        ).order_by(ad_events.c.date_start.asc())
        with engine.connect() as conn:
            rows = conn.execute(q).mappings().all()
    except Exception as e:  # noqa: BLE001
        log.warning("Task seeding: could not read the festival calendar: %s", e)
        return []
    out = []
    for r in rows:
        try:
            targets = json.loads(r["target_services"] or "[]")
        except ValueError:
            targets = []
        out.append({"id": r["id"], "title": r["title"], "city": r["city"], "date_start": r["date_start"],
                    "date_end": r["date_end"], "status": r["status"], "discount_code": r["discount_code"] or "",
                    "target_services": targets})
    return out


def festival_service(event: dict) -> str | None:
    """The service a festival suggests, or None when it is not a home-services occasion (e.g. Children's Day)."""
    title = (event.get("title") or "").lower()
    for words, service in FESTIVAL_SERVICES:
        if any(w in title for w in words):
            return service
    for t in event.get("target_services") or []:
        t = str(t).lower()
        if "deep" in t:
            return "deep_cleaning"
        if "clean" in t:
            return "house_cleaning"
        if any(w in t for w in ("repair", "maint", "ac ", "paint", "plumb", "electric")):
            return "home_maintenance"
    return None


def category_slug(category: str | None) -> str:
    """'Appliance Repair' / 'appliance-repair' -> 'appliance_repair'."""
    return re.sub(r"[^a-z0-9]+", "_", (category or "").lower()).strip("_")


def _families(category: str | None) -> list[str]:
    """Every family a booking's category counts for: cleaning / repair, and 'cat:<slug>' for its exact category
    (the services added in the calendar are matched on that)."""
    c = (category or "").lower()
    out = [fam for fam, words in FAMILIES.items() if any(w in c for w in words)]
    slug = category_slug(category)
    if slug:
        out.append(f"cat:{slug}")
    return out


def _km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


class _Bookings:
    """The synced ExtraHand tasks, loaded once per run: who has booked, and which services exist in an area."""

    def __init__(self, db: Session):
        cut = utcnow() - timedelta(days=AREA_DAYS)
        self.rows = db.query(Ticket.id, Ticket.category, Ticket.city, Ticket.lat, Ticket.lng, Ticket.customer_id,
                             Ticket.customer_phone, Ticket.created_at).all()
        self.recent = [r for r in self.rows if r.created_at is None or r.created_at >= cut]

    def first_booking(self, user_id: str, phone: str | None, after: datetime | None = None):
        p10 = _digits10(phone)
        hits = [r for r in self.rows
                if (r.customer_id and r.customer_id == user_id) or (p10 and _digits10(r.customer_phone) == p10)]
        if after is not None:
            hits = [r for r in hits if r.created_at is None or r.created_at >= after]
        return min(hits, key=lambda r: r.created_at or datetime.min) if hits else None

    def families_near(self, city: str | None, lat: float | None, lng: float | None) -> Counter:
        c = (city or "").strip().lower()
        out: Counter = Counter()
        for r in self.recent:
            fams = _families(r.category)
            if not fams:
                continue
            same_city = bool(c) and (r.city or "").strip().lower() == c
            near = (lat is not None and lng is not None and r.lat is not None and r.lng is not None
                    and _km(lat, lng, r.lat, r.lng) <= AREA_KM)
            if same_city or near:
                for fam in fams:
                    out[fam] += 1
        return out


def suggest(user: dict, cfg: dict, families: Counter, festivals: list[dict], today: date,
            messages: dict[str, dict] | None = None) -> dict | None:
    """The one service to suggest: festival first, then season, then regular days. Only services with real
    bookings in the customer's area; None when ExtraHand has no booking history near them."""
    lang = language_for(user.get("state"))
    region = {(user.get("city") or "").strip().lower(), (user.get("state") or "").strip().lower(), "all-india"}
    region.discard("")
    candidates: list[dict] = []
    if cfg["festival_campaigns"]:
        local, national = [], []
        for ev in festivals:  # already in date order
            where = (ev.get("city") or "").strip().lower()
            own = (messages or {}).get(ev.get("id") or "") or {}  # the message set up for this festival in the calendar
            if own.get("enabled") is False:
                continue
            dates = send_dates(ev, own, int(cfg.get("festival_window_days", 21)))
            if dates and not dates[0] <= today <= dates[1]:
                continue  # outside the days this festival's message is sent
            wanted = festival_services(ev, own)
            if wanted and where in region:
                pick = {"service": wanted[0], "services": wanted, "reason": "festival", "event_title": ev["title"],
                        "promo_code": own.get("promo_code") or ev.get("discount_code") or None,
                        "hook": (own.get("hooks") or {}).get(lang)}
                (national if where == "all-india" else local).append(pick)
        candidates += local + national  # the customer's own city / state festivals first
    if cfg["seasonal_campaigns"] and today.month in SUMMER_MONTHS:
        candidates.append({"service": "home_maintenance", "reason": "summer", "event_title": None, "promo_code": None})
    candidates.append({"service": "bathroom_kitchen", "reason": "regular", "event_title": None, "promo_code": None})
    for c in candidates:
        here = [k for k in c.get("services") or [c["service"]] if families.get(SERVICES[k]["family"], 0) > 0]
        if here:
            hook = c.pop("hook", None) or HOOKS[c["reason"]][lang].format(title=c["event_title"] or "")
            return {**c, "service": here[0], "services": here, "language": lang, "reason_text": hook}
    return None


# ------------------------------------------------------------------------------------------------ festival messages

FKEY = "task_seeding_festivals"  # {event_id: {title, enabled, service, promo_code, hooks: {te, hi, en}}}


def festival_messages(db: Session) -> dict[str, dict]:
    row = db.get(AppSetting, FKEY)
    try:
        data = json.loads(row.value) if row else {}
    except ValueError:
        data = {}
    return data if isinstance(data, dict) else {}


def _clean_line(text: str | None) -> str:
    """A template variable Meta accepts: one line, no tabs, no long runs of spaces."""
    t = re.sub(r"[\r\n\t]+", " ", text or "")
    return re.sub(r" {2,}", " ", t).strip()[:200]


def _custom_hook(title: str | None, lang: str) -> str | None:
    """The festival line written in the calendar for this festival, if any (sends and calls use it)."""
    if not title:
        return None
    from app.database import SessionLocal

    try:
        with SessionLocal() as db:
            for m in festival_messages(db).values():
                if m.get("title") == title:
                    return (m.get("hooks") or {}).get(lang) or None
    except Exception:  # noqa: BLE001
        return None
    return None


def send_dates(ev: dict, own: dict | None, window_days: int) -> tuple[date, date] | None:
    """(first day, last day) this festival's message is sent: the dates set in the calendar, else from
    `window_days` before the festival to its last day. None when the festival has no usable date."""
    own = own or {}
    try:
        start = date.fromisoformat(ev["date_start"])
        end = date.fromisoformat(ev.get("date_end") or ev["date_start"])
    except (KeyError, TypeError, ValueError):
        return None
    try:
        first = date.fromisoformat(own["send_from"]) if own.get("send_from") else start - timedelta(days=window_days)
        last = date.fromisoformat(own["send_until"]) if own.get("send_until") else end
    except ValueError:
        first, last = start - timedelta(days=window_days), end
    return first, last


def festival_services(ev: dict, own: dict | None) -> list[str]:
    """Services in this festival's message: the ones ticked in the calendar, else every service with the
    festival's own suggestion first (none for days that are not home-service occasions)."""
    own = own or {}
    picked = [k for k in own.get("services") or ([own["service"]] if own.get("service") else []) if k in SERVICES]
    if picked:
        return list(dict.fromkeys(picked))
    auto = festival_service(ev)
    return [auto, *[k for k in SERVICES if k != auto]] if auto else []


AND = {"te": " మరియు ", "hi": " और ", "en": " & "}


def service_names(keys: list[str], lang: str) -> str:
    """'a, b & c' in the customer's language."""
    names = [SERVICES[k].get(lang, SERVICES[k]["en"]) for k in keys if k in SERVICES]
    if len(names) <= 1:
        return names[0] if names else ""
    return ", ".join(names[:-1]) + AND.get(lang, " & ") + names[-1]


def _contact_services(c) -> list[str]:
    keys = [k for k in (c.services or "").split(",") if k in SERVICES]
    return keys or ([c.service] if c.service in SERVICES else [])


def default_hooks(title: str) -> dict[str, str]:
    return {lang: HOOKS["festival"][lang].format(title=title) for lang in ("te", "hi", "en")}


# ------------------------------------------------------------------------------------------------ opt-out

def is_opted_out(db: Session, phone: str | None) -> bool:
    p10 = _digits10(phone)
    return bool(p10) and db.get(SeedOptOut, p10) is not None


def opt_out(db: Session, phone: str | None, source: str = "whatsapp", note: str | None = None) -> bool:
    p10 = _digits10(phone)
    if not p10:
        return False
    if not db.get(SeedOptOut, p10):
        db.add(SeedOptOut(phone=p10, source=source, note=note))
    for c in db.query(SeedContact).filter(SeedContact.phone.like(f"%{p10}")).all():
        if c.status != "converted":
            c.status = "opted_out"
    db.commit()
    return True


def handle_inbound_text(phone: str | None, text: str | None) -> bool:
    """Called for every inbound WhatsApp message: a STOP reply opts the number out. True when it did."""
    words = re.sub(r"[^\w\s]", " ", (text or ""), flags=re.UNICODE).strip().upper()
    words = re.sub(r"\s+", " ", words)
    if words not in STOP_WORDS:
        return False
    from app.database import SessionLocal

    with SessionLocal() as db:
        done = opt_out(db, phone, "whatsapp", note=(text or "")[:200])
    if done:
        log.info("Task seeding: %s opted out (%r)", phone, text)
    return done


# ------------------------------------------------------------------------------------------------ WhatsApp

async def template_versions() -> list[dict[str, Any]]:
    """The seeding template's language versions at Meta with their review status."""
    from whatsapp.welcomers import _versions

    versions = await _versions(TEMPLATE)
    order = {"te": 0, "hi": 1, "en": 2}
    return sorted(versions, key=lambda v: order.get(v["language"], 3))


def sending_language(versions: list[dict], wanted: str) -> str | None:
    """The customer's language once Meta approves it, else English, else any approved version; None if none is."""
    approved = [v["language"] for v in versions if v["status"] == "APPROVED"]
    for lang in (wanted, "en", "en_US"):
        if lang in approved:
            return lang
    return approved[0] if approved else None


def _variables(c: SeedContact, lang: str) -> dict[str, str]:
    first = (c.name or "").strip().split(" ")[0] or {"te": "గారు", "hi": "जी"}.get(lang, "there")
    reason = c.reason or "regular"
    hook = (_custom_hook(c.event_title, lang) if reason == "festival" else None) \
        or HOOKS[reason].get(lang, HOOKS[reason]["en"]).format(title=c.event_title or "")
    keys = _contact_services(c) or ["bathroom_kitchen"]
    city = (c.city or "").strip() or {"te": "మీ ప్రాంతం", "hi": "आपके इलाके"}.get(lang, "your area")
    return {"1": first, "2": hook, "3": service_names(keys, lang), "4": city}


async def _send_whatsapp(c: SeedContact, lang: str) -> tuple[str, str | None, str | None]:
    from whatsapp.meta_client import get_meta_whatsapp_client
    from whatsapp.metering import tagged

    with tagged("task_seeding", f"task_seed_{c.reason or 'regular'}", ticket_id=c.user_id):
        resp = await get_meta_whatsapp_client().send_template_message(
            to=c.phone, template_name=TEMPLATE, language_code=lang, variables=_variables(c, lang), button_slug=c.token,
        )
    return resp.status, resp.message_id, resp.error


# ------------------------------------------------------------------------------------------------ links

def stable_link_base() -> str | None:
    """A fixed https address for the tracked Book Now link, or None (temporary tunnel / not set)."""
    from app.config import public_base_url

    s = get_settings()
    for base in ((s.task_seeding_link_base or "").strip(), (s.public_base_url or "").strip()):
        base = base.rstrip("/")
        if base.startswith("https://") and "trycloudflare.com" not in base and "localhost" not in base:
            return base
    try:
        live = public_base_url()
    except Exception:  # noqa: BLE001
        live = ""
    if live.startswith("https://") and "trycloudflare.com" not in live and "localhost" not in live:
        return live.rstrip("/")
    return None


def booking_link(c: SeedContact | None) -> str:
    """Where Book Now lands: ExtraHand's booking page with the city, service and festival coupon filled in."""
    if c is None:
        return BOOKING_URL
    q = {"utm_source": "whatsapp", "utm_campaign": "task_seeding", "ref": c.token}
    if c.city:
        q["city"] = c.city
    svc = SERVICES.get(c.service or "")
    if svc:
        q["category"] = svc["category"]
    if c.promo_code:
        q["promo"] = c.promo_code
    return f"{BOOKING_URL}?{urlencode(q)}"


def _button_url_tracked(versions: list[dict]) -> bool | None:
    urls = [v.get("button_url") or "" for v in versions if v.get("status") == "APPROVED"]
    if not urls:
        return None
    return any(LINK_PATH in u for u in urls)


# ------------------------------------------------------------------------------------------------ voice call

def call_ready() -> tuple[bool, str | None]:
    s = get_settings()
    if s.telephony_provider != "vobiz" or not s.vobiz_auth_token or not s.vobiz_from_number:
        return False, "Voice calls need the Vobiz phone line (TELEPHONY_PROVIDER=vobiz with its keys in .env)."
    if not s.sarvam_api_key:
        return False, "Voice calls need Sarvam text-to-speech (SARVAM_API_KEY in .env)."
    return True, None


def call_script(c: SeedContact) -> str:
    v = _variables(c, "te")
    return CALL_SCRIPT.format(name=v["1"], hook=v["2"], city=v["4"], service=v["3"],
                              how=CALL_HOW_WA if c.wa_sent_at else CALL_HOW_APP)


_AUDIO_LOCK = threading.Lock()


def call_audio(c: SeedContact) -> Path:
    """The call's Telugu voice message (WAV), made once per script and reused."""
    from app.services import tts_audio

    script = call_script(c)
    digest = hashlib.sha256(script.encode()).hexdigest()[:16]
    path = tts_audio._dir() / f"seed_{digest}.wav"
    if path.exists():
        return path
    with _AUDIO_LOCK:
        if not path.exists():
            wav = tts_audio._synthesize(script, source="task_seeding")
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{path.name}.tmp")
            tmp.write_bytes(wav)
            os.replace(tmp, path)
    return path


def _place_call(c: SeedContact) -> str:
    """Starts the Vobiz call (answer -> play the Telugu message -> hang up). Returns the provider call id."""
    import httpx

    from app.config import public_base_url, public_url_dns_problem
    from app.telephony.vobiz import VobizProvider, _digits

    s = get_settings()
    base = public_base_url().rstrip("/")
    if base.startswith("http://"):
        base = "https://" + base[7:]
    if not base:
        raise RuntimeError("PUBLIC_BASE_URL is not set, so Vobiz cannot reach the call webhooks.")
    if problem := public_url_dns_problem(base):
        raise RuntimeError(problem)
    call_audio(c)  # synthesize before dialing: no silence when they pick up
    provider = VobizProvider()
    body = {
        "from": _digits(s.vobiz_from_number), "to": _digits(c.phone or ""),
        "answer_url": f"{base}/api/marketing/task-seeding/calls/{c.token}/answer", "answer_method": "POST",
        "hangup_url": f"{base}/api/marketing/task-seeding/calls/{c.token}/hangup", "hangup_method": "POST",
        "ring_timeout": str(s.call_ring_timeout_seconds or 30),
    }
    r = httpx.post(provider._api("/Call/"), headers=provider._headers(), json=body, timeout=20)
    if r.status_code >= 400:
        raise RuntimeError(f"Vobiz API error {r.status_code}: {r.text[:200]}")
    data = r.json()
    return str(data.get("request_uuid") or data.get("call_id") or data.get("call_uuid") or "")


# ------------------------------------------------------------------------------------------------ the job

def _new_contacts(db: Session, cfg: dict, bookings: _Bookings, now: datetime) -> dict[str, int]:
    since = max(_parse_dt(cfg["since"]) or now, now - LOOKBACK)
    due_before = now - timedelta(hours=float(cfg["delay_hours"]))
    if since > due_before:
        return {}
    try:
        users = _signups(since)
    except Exception as e:  # noqa: BLE001
        log.warning("Task seeding: could not read ExtraHand signups: %s", e)
        return {"error": 1}
    known_ids = {u for (u,) in db.query(SeedContact.user_id).all()}
    known_phones = {_digits10(p) for (p,) in db.query(SeedContact.phone).all() if p}
    today = now.replace(tzinfo=timezone.utc).astimezone(IST).date()
    festivals = upcoming_festivals(today - timedelta(days=30), 120) if cfg["festival_campaigns"] else []
    messages = festival_messages(db)
    counts: Counter = Counter()
    for u in users:
        if u["registered_at"] > due_before:
            break  # oldest first: everyone after this is still inside the waiting period
        if sum(counts.values()) >= MAX_NEW_PER_RUN:
            break
        p10 = _digits10(u["phone"])
        if u["id"] in known_ids or (p10 and p10 in known_phones):
            continue  # never two contacts for one customer / one phone
        row = SeedContact(user_id=u["id"], name=u["name"], phone=u["phone"], city=u["city"], state=u["state"],
                          lat=u["lat"], lng=u["lng"], registered_at=u["registered_at"],
                          language=language_for(u["state"]), token=secrets.token_urlsafe(12))
        first = bookings.first_booking(u["id"], u["phone"])
        if first is not None:
            row.status, row.skip_reason = "skipped", "already_booked"
        elif not p10:
            row.status, row.skip_reason = "skipped", "no_phone"
        elif is_opted_out(db, u["phone"]):
            row.status, row.skip_reason = "opted_out", "replied_stop"
        else:
            pick = suggest(u, cfg, bookings.families_near(u["city"], u["lat"], u["lng"]), festivals, today, messages)
            if pick is None:
                row.status, row.skip_reason = "skipped", "no_service_in_area"
            else:
                row.service, row.reason, row.reason_text = pick["service"], pick["reason"], pick["reason_text"]
                row.services = ",".join(pick["services"])[:200]
                row.event_title, row.promo_code = pick["event_title"], pick["promo_code"]
                row.status = "pending"
        db.add(row)
        db.commit()
        known_ids.add(u["id"])
        if p10:
            known_phones.add(p10)
        counts[row.status] += 1
    return dict(counts)


def _whatsapp_step(db: Session, cfg: dict, now: datetime) -> dict[str, int]:
    if not cfg["whatsapp"]:
        return {}
    retry_cut = now - WA_RETRY_AFTER
    rows = (db.query(SeedContact)
            .filter((SeedContact.status == "pending")
                    | ((SeedContact.status == "failed") & (SeedContact.wa_status == "failed")
                       & (SeedContact.wa_attempts < MAX_WA_ATTEMPTS) & (SeedContact.updated_at <= retry_cut)))
            .order_by(SeedContact.id.asc()).limit(MAX_SENDS_PER_RUN).all())
    if not rows:
        return {}
    try:
        versions = asyncio.run(template_versions())
    except Exception as e:  # noqa: BLE001
        log.warning("Task seeding: template lookup failed: %s", e)
        versions = []
    counts: Counter = Counter()
    for c in rows:
        lang = sending_language(versions, c.language or "en")
        if lang is None:
            _last_run["blocked"] = "The WhatsApp template is not approved by Meta yet."
            c.wa_error = "Waiting for Meta to approve the WhatsApp template."
            db.commit()
            counts["waiting_template"] += 1
            continue
        _last_run["blocked"] = None
        if is_opted_out(db, c.phone):
            c.status, c.skip_reason = "opted_out", "replied_stop"
            db.commit()
            continue
        c.status, c.wa_attempts = "sending", (c.wa_attempts or 0) + 1
        db.commit()  # claimed: a crash mid-send must not message them twice
        try:
            status, mid, err = asyncio.run(_send_whatsapp(c, lang))
        except Exception as e:  # noqa: BLE001
            status, mid, err = "failed", None, str(e)
        c.wa_status, c.wa_message_id, c.wa_language = status, mid, lang
        c.wa_error = (err or "")[:300] or None
        if status == "failed":
            c.status = "failed"
        else:
            c.status, c.wa_sent_at = "messaged", utcnow()
        db.commit()
        counts[c.status] += 1
        log.info("Task seeding: WhatsApp to %s (%s) -> %s", c.user_id, lang, status)
    return dict(counts)


def _call_step(db: Session, cfg: dict, now: datetime) -> dict[str, int]:
    if not cfg["call"]:
        return {}
    ok, _why = call_ready()
    if not ok:
        return {}
    from app.services.common import runtime_settings, within_calling_hours

    if runtime_settings(db).emergency_stop_calls or not within_calling_hours(db):
        return {}  # the global "stop all calls" switch and the calling hours apply here too
    after = now - timedelta(hours=float(cfg["call_after_hours"]))
    q = db.query(SeedContact).filter(SeedContact.language == "te", SeedContact.call_attempts == 0,
                                     SeedContact.clicks == 0, SeedContact.converted_at.is_(None))
    if cfg["whatsapp"]:
        q = q.filter(SeedContact.status == "messaged", SeedContact.wa_sent_at <= after)
    else:
        q = q.filter(SeedContact.status == "pending")
    c = q.order_by(SeedContact.id.asc()).first()  # one call per run: calls are spaced out
    if c is None:
        return {}
    if is_opted_out(db, c.phone):
        c.status, c.skip_reason = "opted_out", "replied_stop"
        db.commit()
        return {}
    c.call_attempts, c.call_status, c.call_at = 1, "calling", utcnow()
    db.commit()
    try:
        c.call_id = _place_call(c) or None
        c.status = "called"
    except Exception as e:  # noqa: BLE001
        c.call_status, c.call_error = "failed", str(e)[:300]
        if c.status == "pending":
            c.status = "failed"
        log.warning("Task seeding: call to %s failed: %s", c.user_id, e)
    db.commit()
    return {c.call_status or "calling": 1}


def _conversion_step(db: Session, bookings: _Bookings) -> int:
    """A booking made after we contacted them = first booking (converted); every further contact stops."""
    open_rows = db.query(SeedContact).filter(
        SeedContact.status.in_(("pending", "sending", "messaged", "called", "failed")),
        SeedContact.converted_at.is_(None)).all()
    n = 0
    for c in open_rows:
        hit = bookings.first_booking(c.user_id, c.phone, after=c.created_at)
        if hit is None:
            continue
        c.status, c.converted_at = "converted", hit.created_at or utcnow()
        c.converted_ticket_id, c.converted_category = hit.id, hit.category
        n += 1
    if n:
        db.commit()
    return n


def run_task_seeding(db: Session, force: bool = False) -> dict[str, Any]:
    """One pass of the agent (the worker calls it every tick; it works at most once a minute)."""
    cfg = config(db)
    if not cfg["enabled"]:
        return {}
    if not force and time.monotonic() - _last_run["at"] < CHECK_EVERY:
        return {}
    if not _run_lock.acquire(blocking=False):
        return {}
    try:
        _last_run["at"] = time.monotonic()
        now = utcnow()
        bookings = _Bookings(db)
        result = {
            "converted": _conversion_step(db, bookings),
            "new": _new_contacts(db, cfg, bookings, now),
            "whatsapp": _whatsapp_step(db, cfg, now),
            "calls": _call_step(db, cfg, now),
        }
        _last_run["when"], _last_run["result"] = utcnow(), result
        return result
    finally:
        _run_lock.release()


# ------------------------------------------------------------------------------------------------ API

def _ledger(db: Session, ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = db.query(WhatsAppMessage.provider_message_id, WhatsAppMessage.status).filter(
        WhatsAppMessage.provider_message_id.in_(ids)).all()
    return {mid: st for mid, st in rows}


def _wa_delivery(c: SeedContact, ledger: dict[str, str]) -> str | None:
    if not c.wa_status:
        return None
    return ledger.get(c.wa_message_id or "", c.wa_status)


def _contact_json(c: SeedContact, ledger: dict[str, str]) -> dict[str, Any]:
    keys = _contact_services(c)
    return {
        "id": c.id, "user_id": c.user_id, "name": c.name, "phone": c.phone, "city": c.city, "state": c.state,
        "registered_at": iso(c.registered_at), "contacted_at": iso(c.created_at), "language": c.language,
        "language_name": LANGUAGE_NAMES.get(c.language or "", c.language),
        "service": c.service, "service_name": service_names(keys, "en") or None, "reason": c.reason,
        "reason_text": c.reason_text, "event_title": c.event_title, "promo_code": c.promo_code,
        "status": c.status, "skip_reason": c.skip_reason,
        "wa_status": _wa_delivery(c, ledger), "wa_language": c.wa_language, "wa_error": c.wa_error,
        "wa_attempts": c.wa_attempts, "wa_sent_at": iso(c.wa_sent_at),
        "call_status": c.call_status, "call_error": c.call_error, "call_at": iso(c.call_at),
        "call_duration": c.call_duration,
        "clicks": c.clicks, "first_click_at": iso(c.first_click_at),
        "converted_at": iso(c.converted_at), "converted_ticket_id": c.converted_ticket_id,
        "converted_category": c.converted_category,
    }


def _kpis(db: Session, days: int) -> dict[str, Any]:
    cut = utcnow() - timedelta(days=days)
    rows = db.query(SeedContact).filter(SeedContact.registered_at >= cut).all()
    ledger = _ledger(db, [c.wa_message_id for c in rows if c.wa_message_id])
    contacted = [c for c in rows if c.wa_sent_at or (c.call_status and c.call_status != "failed")]
    converted = [c for c in contacted if c.converted_at]
    wa = [_wa_delivery(c, ledger) for c in rows if c.wa_sent_at]
    reg = _registrations(db, days)
    return {
        "days": days,
        "registrations": reg["registrations"],
        "not_booked": reg["not_booked"],
        "registrations_error": reg["error"],
        "messages_sent": len(wa),
        "messages_delivered": sum(1 for s in wa if s in ("delivered", "read")),
        "messages_read": sum(1 for s in wa if s == "read"),
        "calls_made": sum(1 for c in rows if c.call_status and c.call_status not in ("failed",)),
        "calls_answered": sum(1 for c in rows if c.call_status == "completed"),
        "link_clicks": sum(c.clicks or 0 for c in rows),
        "people_clicked": sum(1 for c in rows if c.clicks),
        "first_bookings": len(converted),
        "conversion_rate": round(100 * len(converted) / len(contacted), 1) if contacted else 0.0,
        "contacted": len(contacted),
        "failures": sum(1 for c in rows if c.status == "failed" or c.call_status == "failed"),
        "skipped": sum(1 for c in rows if c.status == "skipped"),
        "opted_out": db.query(func.count(SeedOptOut.phone)).scalar() or 0,
        "waiting": sum(1 for c in rows if c.status == "pending"),
    }


def _registrations(db: Session, days: int) -> dict[str, Any]:
    """Real customer registrations in the window (from ExtraHand, via the Customer Welcomer's 31-day cache)
    and how many of them have not booked anything yet (synced tasks)."""
    try:
        from whatsapp.welcomers import _registrations as welcomer_registrations

        reg = welcomer_registrations("customer")
    except Exception as e:  # noqa: BLE001
        return {"registrations": None, "not_booked": None, "error": str(e)[:200]}
    cut = utcnow() - timedelta(days=days)
    users = [u for u in reg.get("users") or [] if u["registered_at"] >= cut]
    booked_ids = {cid for (cid,) in db.query(Ticket.customer_id).filter(Ticket.customer_id.isnot(None)).all()}
    booked_phones = {_digits10(p) for (p,) in db.query(Ticket.customer_phone).all() if p}
    not_booked = 0
    for u in users:
        # the welcomer cache keys users by their login uid; the phone links them to synced tasks
        if _digits10(u.get("phone")) in booked_phones or u["id"] in booked_ids:
            continue
        not_booked += 1
    return {"registrations": len(users), "not_booked": not_booked, "error": reg.get("error")}


def _festival_preview(cfg: dict, messages: dict[str, dict]) -> list[dict]:
    """Upcoming festivals with the service their message suggests and whether it is being sent today."""
    today = datetime.now(IST).date()
    window = int(cfg["festival_window_days"])
    out = []
    for ev in upcoming_festivals(today - timedelta(days=30), 120):
        own = messages.get(ev["id"]) or {}
        svc = own.get("service") if own.get("service") in SERVICES else festival_service(ev)
        if own.get("enabled") is False:
            svc = None
        dates = send_dates(ev, own, window)
        if dates and dates[1] < today:
            continue
        out.append({
            "id": ev["id"], "title": ev["title"], "region": ev["city"], "date_start": ev["date_start"],
            "date_end": ev["date_end"], "status": ev["status"], "discount_code": ev["discount_code"],
            "service": svc, "service_name": SERVICES[svc]["en"] if svc else None,
            "in_window": bool(dates) and dates[0] <= today <= dates[1],
        })
    return out


def _now_suggestion(cfg: dict) -> dict[str, str]:
    month = datetime.now(IST).month
    if cfg["seasonal_campaigns"] and month in SUMMER_MONTHS:
        return {"season": "Summer", "service": SERVICES["home_maintenance"]["en"]}
    return {"season": "Regular days", "service": SERVICES["bathroom_kitchen"]["en"]}


@router.get("/status")
async def seeding_status(days: int = 30, db: Session = Depends(get_db)) -> dict[str, Any]:
    cfg = config(db)
    versions = await template_versions()
    ready, why = call_ready()
    from app.services.common import calling_hours_state, runtime_settings

    hours = calling_hours_state(db)
    stopped = bool(runtime_settings(db).emergency_stop_calls)
    tracked = _button_url_tracked(versions)
    drafts = [{"language": lang, "language_name": LANGUAGE_NAMES[lang], **{k: t[k] for k in ("body", "footer", "button")}}
              for lang, t in template_text(db).items()]
    return {
        "config": cfg,
        "kpis": _kpis(db, max(1, min(days, 365))),
        "template": {
            "name": TEMPLATE,
            "versions": versions,
            "drafts": drafts,
            "any_approved": any(v["status"] == "APPROVED" for v in versions),
            "clicks_tracked": tracked,
            "link_base": stable_link_base(),
        },
        "call": {"ready": ready, "reason": why, "calls_stopped": stopped, "hours": hours["label"],
                 "hours_open": hours["open"]},
        "festivals": _festival_preview(cfg, festival_messages(db)),
        "season": _now_suggestion(cfg),
        "services": [{"key": k, "name": v["en"], "family": v["family"]} for k, v in SERVICES.items()],
        "last_run": iso(_last_run["when"]),
        "last_result": _last_run["result"],
        "blocked": _last_run["blocked"],
        "check_every_seconds": CHECK_EVERY,
    }


class SettingsPayload(BaseModel):
    enabled: bool | None = None
    delay_hours: float | None = None
    whatsapp: bool | None = None
    call: bool | None = None
    call_after_hours: float | None = None
    festival_campaigns: bool | None = None
    seasonal_campaigns: bool | None = None
    festival_window_days: int | None = None


@router.put("/settings")
def update_settings(payload: SettingsPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    cfg = config(db)
    data = payload.model_dump(exclude_none=True)
    if "delay_hours" in data and not 1 <= data["delay_hours"] <= 168:
        raise HTTPException(400, "The waiting time must be between 1 and 168 hours.")
    if "call_after_hours" in data and not 1 <= data["call_after_hours"] <= 168:
        raise HTTPException(400, "The call delay must be between 1 and 168 hours.")
    if "festival_window_days" in data and not 1 <= data["festival_window_days"] <= 60:
        raise HTTPException(400, "The festival window must be between 1 and 60 days.")
    if data.get("enabled") and not cfg["enabled"]:
        cfg["since"] = utcnow().isoformat()  # only customers who register from now on are contacted
    cfg.update(data)
    if not cfg["whatsapp"] and not cfg["call"] and cfg["enabled"]:
        raise HTTPException(400, "Turn on WhatsApp or the voice call: at least one channel is needed.")
    save_config(db, cfg)
    return cfg


@router.post("/run-now")
def run_now(db: Session = Depends(get_db)) -> dict[str, Any]:
    if not config(db)["enabled"]:
        raise HTTPException(400, "The Task-Seeding Agent is switched off.")
    return run_task_seeding(db, force=True)


CONTACT_FILTERS = ("all", "pending", "messaged", "called", "converted", "failed", "skipped", "opted_out", "clicked")


@router.get("/contacts")
def list_contacts(status: str = "all", q: str = "", offset: int = 0, limit: int = 50,
                  db: Session = Depends(get_db)) -> dict[str, Any]:
    """Campaign history: every customer the agent looked at, newest first."""
    refresh_services(db)
    base = db.query(SeedContact)
    counts = {k: 0 for k in CONTACT_FILTERS}
    for st, n in db.query(SeedContact.status, func.count(SeedContact.id)).group_by(SeedContact.status).all():
        key = "pending" if st == "sending" else st
        if key in counts:
            counts[key] += n
    counts["all"] = base.count()
    counts["clicked"] = base.filter(SeedContact.clicks > 0).count()
    qry = base
    if status == "clicked":
        qry = qry.filter(SeedContact.clicks > 0)
    elif status == "pending":
        qry = qry.filter(SeedContact.status.in_(("pending", "sending")))
    elif status in CONTACT_FILTERS and status != "all":
        qry = qry.filter(SeedContact.status == status)
    if q.strip():
        like = f"%{q.strip()}%"
        qry = qry.filter(SeedContact.name.ilike(like) | SeedContact.phone.ilike(like) | SeedContact.city.ilike(like))
    total = qry.count()
    limit = max(1, min(limit, 200))
    rows = qry.order_by(SeedContact.id.desc()).offset(max(0, offset)).limit(limit).all()
    ledger = _ledger(db, [c.wa_message_id for c in rows if c.wa_message_id])
    return {"counts": counts, "total": total, "offset": offset, "limit": limit,
            "items": [_contact_json(c, ledger) for c in rows]}


def _retry(c: SeedContact) -> bool:
    if c.status != "failed":
        return False
    if c.wa_status == "failed":
        c.status, c.wa_attempts, c.wa_error = "pending", 0, None
        return True
    if c.call_status == "failed":
        c.status, c.call_attempts, c.call_status, c.call_error = "pending", 0, None, None
        return True
    return False


@router.post("/retry-failed")
def retry_failed(db: Session = Depends(get_db)) -> dict[str, int]:
    n = sum(_retry(c) for c in db.query(SeedContact).filter(SeedContact.status == "failed").all())
    # messaged people whose follow-up call failed get one more call
    for c in db.query(SeedContact).filter(SeedContact.status == "messaged", SeedContact.call_status == "failed").all():
        c.call_attempts, c.call_status, c.call_error = 0, None, None
        n += 1
    db.commit()
    return {"retrying": n}


@router.post("/contacts/{contact_id}/retry")
def retry_one(contact_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    c = db.get(SeedContact, contact_id)
    if not c:
        raise HTTPException(404, "Not found")
    if not _retry(c):
        if c.status == "messaged" and c.call_status == "failed":
            c.call_attempts, c.call_status, c.call_error = 0, None, None
        else:
            raise HTTPException(400, "Only failed messages or calls can be retried.")
    db.commit()
    return _contact_json(c, {})


class OptOutPayload(BaseModel):
    phone: str
    note: str | None = None


@router.post("/opt-outs")
def add_opt_out(payload: OptOutPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    if not opt_out(db, payload.phone, "admin", payload.note):
        raise HTTPException(400, "Enter a 10-digit phone number.")
    return {"ok": True}


@router.get("/opt-outs")
def list_opt_outs(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query(SeedOptOut).order_by(SeedOptOut.created_at.desc()).limit(500).all()
    return [{"phone": r.phone, "source": r.source, "note": r.note, "at": iso(r.created_at)} for r in rows]


def _template_view(texts: dict, versions: list[dict]) -> dict[str, Any]:
    have = {v["language"]: v for v in versions}
    return {
        "name": TEMPLATE,
        "languages": [{"language": lang, "language_name": LANGUAGE_NAMES[lang],
                       **{k: t[k] for k in ("body", "footer", "button")}, "edited": t["edited"],
                       "default": {k: TEMPLATE_TEXT[lang][k] for k in ("body", "footer", "button")},
                       "meta": meta_state(t, have.get(lang))} for lang, t in texts.items()],
        "clicks_tracked": _button_url_tracked(versions),
    }


@router.get("/template")
async def get_template(db: Session = Depends(get_db)) -> dict[str, Any]:
    """The template's wording in each language with its review status at Meta."""
    return _template_view(template_text(db), await template_versions())


class TemplatePayload(BaseModel):
    body: str
    footer: str
    button: str


@router.put("/template/{lang}")
async def save_template(lang: str, payload: TemplatePayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Saves the wording of one language here. Customers get it only after it is sent to Meta and approved."""
    if lang not in TEMPLATE_TEXT:
        raise HTTPException(404, "Unknown language")
    body = payload.body.replace("\r\n", "\n").strip()
    footer, button = payload.footer.strip(), payload.button.strip()
    why = check_template(body, footer, button)
    if why:
        raise HTTPException(400, why)
    row = db.get(AppSetting, TKEY) or AppSetting(key=TKEY)
    try:
        own = json.loads(row.value) if row.value else {}
    except ValueError:
        own = {}
    base = TEMPLATE_TEXT[lang]
    if (body, footer, button) == (base["body"], base["footer"], base["button"]):
        own.pop(lang, None)
    else:
        own[lang] = {"body": body, "footer": footer, "button": button}
    row.value = json.dumps(own, ensure_ascii=False)
    db.add(row)
    db.commit()
    return _template_view(template_text(db), await template_versions())


@router.delete("/template/{lang}")
async def reset_template(lang: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Back to the built-in wording for one language."""
    row = db.get(AppSetting, TKEY)
    if row:
        try:
            own = json.loads(row.value or "{}")
        except ValueError:
            own = {}
        own.pop(lang, None)
        row.value = json.dumps(own, ensure_ascii=False)
        db.commit()
    return _template_view(template_text(db), await template_versions())


@router.post("/template")
async def submit_template(language: str | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Sends the template to Meta for review: languages not there yet are created, rejected ones or ones whose
    wording was changed here are edited (Meta reviews them again). One language, or all three.
    The Book Now button carries each customer's tracking code."""
    from whatsapp.meta_client import get_meta_whatsapp_client

    existing = {v["language"]: v for v in await template_versions()}
    base = stable_link_base()
    url = f"{base}{LINK_PATH}{{{{1}}}}" if base else f"{BOOKING_URL}?ref={{{{1}}}}"
    buttons = lambda t: [{"type": "URL", "text": t["button"], "url": url,  # noqa: E731
                          "example": [url.replace("{{1}}", "abc123")]}]
    client = get_meta_whatsapp_client()
    results = {}
    for lang, t in template_text(db).items():
        if language and lang != language:
            continue
        why = check_template(t["body"], t["footer"], t["button"])
        if why:
            results[lang] = {"ok": False, "already": False, "error": why}
            continue
        have = existing.get(lang)
        if have:
            state = meta_state(t, have)
            if have["status"] == "PENDING":
                results[lang] = {"ok": not state["changed"], "already": True, "status": "PENDING",
                                 "error": "Meta is still reviewing it; send the change once it is reviewed."
                                 if state["changed"] else None}
                continue
            if have["status"] != "REJECTED" and not state["changed"]:
                results[lang] = {"ok": True, "already": True, "status": have["status"]}
                continue
            if not have.get("id"):
                results[lang] = {"ok": False, "already": False, "error": "Meta did not give the template id."}
                continue
            res = await client.edit_template(have["id"], body=t["body"], examples=t["examples"],
                                             footer=t["footer"], buttons=buttons(t))
            results[lang] = {"ok": bool(res.get("ok")), "already": False, "status": res.get("status"),
                             "error": res.get("error"), "edited": True}
            log.info("Task seeding template %s edited at Meta: %s", lang, res)
            continue
        res = await client.create_template(
            name=TEMPLATE, category="MARKETING", body=t["body"], language=lang, examples=t["examples"],
            footer=t["footer"], buttons=buttons(t),
        )
        results[lang] = {"ok": bool(res.get("ok")), "already": False, "status": res.get("status"),
                         "error": res.get("error")}
        log.info("Task seeding template %s submitted: %s", lang, res)
    if hasattr(client, "_templates_cache"):
        client._templates_cache = {"at": 0.0, "data": []}  # read the new statuses on the next look
    return {"results": results, "button_url": url, "clicks_tracked": bool(base),
            "template": _template_view(template_text(db), await template_versions())}


# ------------------------------------------------------------------------------------------------ festival calendar

def _month_events(year: int, month: int) -> list[dict]:
    """Festivals from the Advertisement festival list in (or overlapping) this month; rejected ones left out."""
    from sqlalchemy import select

    from app.database import engine

    from .database import ad_events, init_advestiment_db

    init_advestiment_db()
    first = date(year, month, 1)
    last = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    q = select(ad_events).where(
        ad_events.c.date_start <= last.isoformat(),
        (ad_events.c.date_end >= first.isoformat())
        | ((ad_events.c.date_end == "") & (ad_events.c.date_start >= first.isoformat())),
        ad_events.c.status != "Rejected",
    ).order_by(ad_events.c.date_start.asc())
    with engine.connect() as conn:
        rows = conn.execute(q).mappings().all()
    out = []
    for r in rows:
        try:
            targets = json.loads(r["target_services"] or "[]")
        except ValueError:
            targets = []
        out.append({"id": r["id"], "title": r["title"], "city": r["city"], "date_start": r["date_start"],
                    "date_end": r["date_end"] or r["date_start"], "status": r["status"], "category": r["category"],
                    "discount_code": r["discount_code"] or "", "target_services": targets})
    return out


def _festival_json(ev: dict, own: dict, cfg: dict, today: date) -> dict[str, Any]:
    auto = festival_service(ev)
    services = festival_services(ev, own)
    service = services[0] if services else None
    enabled = own.get("enabled") if own.get("enabled") is not None else auto is not None
    end = date.fromisoformat(ev["date_end"]) if ev.get("date_end") else date.fromisoformat(ev["date_start"])
    first, last = send_dates(ev, own, int(cfg["festival_window_days"])) or (end, end)
    hooks = {**default_hooks(ev["title"]), **{k: v for k, v in (own.get("hooks") or {}).items() if v}}
    active = bool(enabled and service)
    return {
        "id": ev["id"], "title": ev["title"], "region": ev["city"], "date_start": ev["date_start"],
        "date_end": ev["date_end"], "status": ev["status"], "category": ev.get("category") or "",
        "discount_code": ev.get("discount_code") or "",
        "promo_code": own.get("promo_code") or ev.get("discount_code") or "",
        "suggested_service": auto, "service": service, "services": services, "enabled": active, "customised": bool(own), "hooks": hooks,
        "sends_from": first.isoformat(), "sends_until": last.isoformat(),
        "custom_dates": bool(own.get("send_from") or own.get("send_until")),
        "sending_now": active and bool(cfg["festival_campaigns"]) and first <= today <= last,
        "past": max(end, last) < today,
    }


@router.get("/festivals")
def festival_calendar(year: int | None = None, month: int | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Festival calendar of the Task-Seeding Agent: every festival already registered for the month, with the
    message the agent sends for it (service, coupon and the festival line in Telugu / Hindi / English)."""
    today = datetime.now(IST).date()
    y, m = year or today.year, month or today.month
    if not 1 <= m <= 12:
        raise HTTPException(400, "month must be 1-12")
    cfg = config(db)
    messages = festival_messages(db)
    try:
        events = _month_events(y, m)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Could not read the festival list: {e}") from e
    return {
        "year": y, "month": m, "today": today.isoformat(), "window_days": int(cfg["festival_window_days"]),
        "festival_campaigns": cfg["festival_campaigns"],
        "services": [{"key": k, "name": v["en"], "te": v["te"], "hi": v["hi"], "custom": bool(v.get("custom")),
                      "category": v["category"]} for k, v in SERVICES.items()],
        "categories": _booking_categories(db),
        "template": {lang: {k: t[k] for k in ("body", "footer", "button")} for lang, t in template_text(db).items()},
        "festivals": [_festival_json(ev, messages.get(ev["id"]) or {}, cfg, today) for ev in events],
    }


class FestivalMessagePayload(BaseModel):
    enabled: bool = True
    services: list[str] = []  # every service in the festival's message
    send_from: str | None = None  # YYYY-MM-DD; empty = the default lead time before the festival
    send_until: str | None = None  # YYYY-MM-DD; empty = the festival's last day
    service: str | None = None
    promo_code: str | None = None
    hooks: dict[str, str] = {}


def _event_dict(ev: dict) -> dict:
    return {"id": ev["id"], "title": ev["title"], "city": ev["city"], "date_start": ev["date_start"],
            "date_end": ev.get("date_end") or ev["date_start"], "status": ev.get("status"),
            "category": ev.get("category"), "discount_code": ev.get("discount_code") or "",
            "target_services": ev.get("target_services") or []}


@router.put("/festivals/{event_id:path}")
def save_festival_message(event_id: str, payload: FestivalMessagePayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Saves the message the agent sends to new customers while this festival is near."""
    from .database import db_get_event_by_id

    refresh_services(db)
    ev = db_get_event_by_id(event_id)
    if not ev:
        raise HTTPException(404, "Festival not found")
    services = [k for k in dict.fromkeys(payload.services or ([payload.service] if payload.service else [])) if k in SERVICES]
    if payload.enabled and not services:
        raise HTTPException(400, "Choose at least one service for this festival.")
    dates = {}
    for key in ("send_from", "send_until"):
        val = (getattr(payload, key) or "").strip()
        if val:
            try:
                dates[key] = date.fromisoformat(val).isoformat()
            except ValueError as e:
                raise HTTPException(400, "Dates must look like 2026-12-04.") from e
    if dates.get("send_from") and dates.get("send_until") and dates["send_from"] > dates["send_until"]:
        raise HTTPException(400, "The first sending day must be on or before the last one.")
    defaults = default_hooks(ev["title"])
    hooks = {}
    for lang in ("te", "hi", "en"):
        line = _clean_line(payload.hooks.get(lang))
        if line and line != defaults[lang]:
            hooks[lang] = line
    messages = festival_messages(db)
    messages[event_id] = {"title": ev["title"], "enabled": payload.enabled,
                          "service": services[0] if services else None, "services": services,
                          "promo_code": _clean_line(payload.promo_code).upper()[:40] or None, "hooks": hooks,
                          "send_from": dates.get("send_from"), "send_until": dates.get("send_until")}
    row = db.get(AppSetting, FKEY) or AppSetting(key=FKEY)
    row.value = json.dumps(messages, ensure_ascii=False)
    db.add(row)
    db.commit()
    return _festival_json(_event_dict(ev), messages[event_id], config(db), datetime.now(IST).date())


def _booking_categories(db: Session) -> list[dict[str, Any]]:
    """Real ExtraHand booking categories (from the synced tasks) with how often each was booked."""
    counts: Counter = Counter()
    labels: dict[str, str] = {}
    for (cat,) in db.query(Ticket.category).all():
        slug = category_slug(cat)
        if not slug or slug in ("other", "online"):
            continue
        counts[slug] += 1
        labels.setdefault(slug, (cat or "").replace("_", " ").replace("-", " ").strip().capitalize())
    return [{"slug": k, "label": labels[k], "bookings": n} for k, n in counts.most_common()]


class ServicePayload(BaseModel):
    en: str
    te: str | None = None
    hi: str | None = None
    category: str


@router.post("/services")
def add_service(payload: ServicePayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Adds a service to choose in festival messages. It is offered only where its booking category was booked."""
    en = _clean_line(payload.en)[:60]
    slug = category_slug(payload.category)
    if len(en) < 3:
        raise HTTPException(400, "Write the service name in English (at least 3 letters).")
    if slug not in {c["slug"] for c in _booking_categories(db)}:
        raise HTTPException(400, "Choose a booking category ExtraHand has real bookings for.")
    key = "c_" + (category_slug(en) or slug)[:24]
    items = custom_services(db)
    if key in BASE_SERVICES or any(d["key"] == key for d in items) or any(
            v["en"].lower() == en.lower() for v in SERVICES.values()):
        raise HTTPException(400, "A service with this name already exists.")
    items.append({"key": key, "en": en, "te": _clean_line(payload.te)[:60] or None,
                  "hi": _clean_line(payload.hi)[:60] or None, "category": slug})
    row = db.get(AppSetting, SKEY) or AppSetting(key=SKEY)
    row.value = json.dumps(items, ensure_ascii=False)
    db.add(row)
    db.commit()
    refresh_services(db)
    v = SERVICES[key]
    return {"key": key, "name": v["en"], "te": v["te"], "hi": v["hi"], "custom": True, "category": slug}


@router.delete("/services/{key}")
def delete_service(key: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    """Removes an added service; festivals that had it simply stop mentioning it."""
    if key in BASE_SERVICES:
        raise HTTPException(400, "Built-in services cannot be removed.")
    items = custom_services(db)
    left = [d for d in items if d["key"] != key]
    if len(left) == len(items):
        raise HTTPException(404, "Service not found")
    row = db.get(AppSetting, SKEY)
    row.value = json.dumps(left, ensure_ascii=False)
    db.commit()
    refresh_services(db)
    return {"ok": True}


@router.delete("/festivals/{event_id:path}")
def reset_festival_message(event_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    """Back to the automatic message for this festival."""
    messages = festival_messages(db)
    if messages.pop(event_id, None) is not None:
        row = db.get(AppSetting, FKEY)
        row.value = json.dumps(messages, ensure_ascii=False)
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------------------------------------------ public

@router.get("/go/{token}")
def follow_link(token: str, db: Session = Depends(get_db)):
    """Book Now: counts the click, then opens ExtraHand's booking page for that customer's city and service."""
    c = db.query(SeedContact).filter(SeedContact.token == token).first()
    if c is not None:
        now = utcnow()
        c.clicks = (c.clicks or 0) + 1
        c.first_click_at = c.first_click_at or now
        db.commit()
    return RedirectResponse(booking_link(c), status_code=302)


@router.api_route("/calls/{token}/answer", methods=["GET", "POST"])
def call_answer(token: str, request: Request, db: Session = Depends(get_db)):
    from app.config import public_base_url
    from app.telephony.vobiz import play_and_hangup

    c = db.query(SeedContact).filter(SeedContact.token == token).first()
    if c is None:
        raise HTTPException(404, "Unknown call")
    base = public_base_url().rstrip("/") or f"https://{request.headers.get('host', '')}"
    if base.startswith("http://"):
        base = "https://" + base[7:]
    return Response(content=play_and_hangup([f"{base}/api/marketing/task-seeding/audio/{token}.wav"]),
                    media_type="application/xml")


@router.api_route("/calls/{token}/hangup", methods=["GET", "POST"])
async def call_hangup(token: str, request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    c = db.query(SeedContact).filter(SeedContact.token == token).first()
    if c is not None:
        try:
            form = dict(await request.form()) if "form" in request.headers.get("content-type", "") else {}
        except Exception:  # noqa: BLE001
            form = {}
        dur = form.get("Duration") or form.get("CallDuration") or form.get("BillDuration")
        if dur:
            try:
                c.call_duration = int(float(dur))
            except ValueError:
                pass
        st = str(form.get("CallStatus") or form.get("HangupCause") or "").lower()
        if st in ("completed", "answered", "normal_clearing"):
            c.call_status = "completed"
        elif st in ("busy", "no-answer", "no_answer", "failed", "canceled", "cancelled"):
            c.call_status = st.replace("_", "-")
        elif c.call_status == "calling":
            c.call_status = "completed" if (c.call_duration or 0) > 0 else "no-answer"
        db.commit()
    return {"status": "recorded"}


@router.get("/audio/{token}.wav")
def call_audio_file(token: str, db: Session = Depends(get_db)):
    c = db.query(SeedContact).filter(SeedContact.token == token).first()
    if c is None:
        raise HTTPException(404, "Unknown call")
    try:
        return FileResponse(path=str(call_audio(c)), media_type="audio/wav")
    except Exception as e:  # noqa: BLE001
        log.exception("Task seeding audio failed")
        raise HTTPException(500, f"Audio error: {e}") from e
