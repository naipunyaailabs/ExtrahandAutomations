"""Welcomers: a WhatsApp welcome template to every helper / customer who registers on ExtraHand.

Each audience (helper, customer) has its own Activate / Deactivate switch and starts DEACTIVE. Activating records the
moment; only people who register on ExtraHand AFTER that moment are welcomed, so switching it on never messages the
existing user base. Every person is welcomed at most once (whatsapp_welcomes has one row per audience + user).

The worker calls run_welcomers() every tick; it looks at ExtraHand's newest signups at most once a minute.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.database import SessionLocal, get_db
from app.models import AppSetting, WhatsAppMessage, WhatsAppWelcome, utcnow

from .metering import tagged

log = logging.getLogger("whatsapp.welcomers")
router = APIRouter(prefix="/welcomers", tags=["WhatsApp Welcomers"])

Audience = Literal["helper", "customer"]
AUDIENCES: dict[str, dict[str, Any]] = {
    # roles = ExtraHand list filters to read; primary = the user's main `role` that counts for this audience
    "helper": {"template": "extrahand_helper_welcome", "roles": ("partner", "helper"), "primary": {"partner", "helper"}},
    "customer": {"template": "extrahand_customer_welcome", "roles": ("customer",), "primary": {"customer"}},
}
# Telugu version of each welcome, submitted to Meta under the same template name (language "te").
# Sent once Meta approves it; until then the approved English version keeps going out.
PREFERRED_LANGUAGE = "te"
TELUGU: dict[str, dict[str, str]] = {
    "helper": {
        "body": "ఎక్స్‌ట్రాహ్యాండ్‌కు స్వాగతం, {{1}}! 👋\n\n"
                "ఇప్పుడు మీ దగ్గరలోని పనులు చూడండి, అప్లై చేయండి, సంపాదించడం మొదలుపెట్టండి.\n\n"
                "మరిన్ని పనులు రావడానికి మీ ప్రొఫైల్‌ను పూర్తి చేయండి.",
        "button": "యాప్ ఓపెన్ చేయండి",
        "example": "Rahul",
    },
    "customer": {
        "body": "ఎక్స్‌ట్రాహ్యాండ్‌కు స్వాగతం, {{1}}! 👋\n\n"
                "పని పోస్ట్ చేయండి లేదా సర్వీసులు బుక్ చేసుకోండి. మీ దగ్గరలోని వెరిఫైడ్ వ్యక్తుల నుండి నిజమైన సహాయం పొందండి.\n\n"
                "మొదలుపెట్టడానికి యాప్ ఓపెన్ చేయండి.",
        "button": "యాప్ ఓపెన్ చేయండి",
        "example": "Priya",
    },
}
LANGUAGE_NAMES = {"te": "Telugu", "en": "English", "en_US": "English (US)", "hi": "Hindi"}
KEY = "whatsapp_welcomers"
CHECK_EVERY = 60  # seconds between ExtraHand checks
PAGES = 2  # newest 100 users per role per check
_last_check: dict[str, Any] = {"at": 0.0, "when": None}
IST = timezone(timedelta(hours=5, minutes=30))


# ------------------------------------------------------------------------------------------------ switches

def _state(db: Session) -> dict[str, dict[str, Any]]:
    row = db.get(AppSetting, KEY)
    data: dict = {}
    if row:
        try:
            data = json.loads(row.value) or {}
        except ValueError:
            data = {}
    return {a: {"active": bool((data.get(a) or {}).get("active")), "since": (data.get(a) or {}).get("since")}
            for a in AUDIENCES}


def _save_state(db: Session, state: dict) -> None:
    row = db.get(AppSetting, KEY) or AppSetting(key=KEY)
    row.value = json.dumps(state)
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


# ------------------------------------------------------------------------------------------------ the job

def _new_signups(audience: str, since: datetime) -> list[dict]:
    """Real users of this audience with a phone who registered after `since`, oldest first."""
    from app.integrations.extrahand import get_source
    from app.integrations.mapping import normalize_user
    from app.services.real_data import is_real_user

    cfg = AUDIENCES[audience]
    src = get_source()
    seen: dict[str, dict] = {}
    for role in cfg["roles"]:
        try:
            items = src.list_users(role, max_pages=PAGES)
        except Exception as e:  # noqa: BLE001
            log.warning("Welcomer %s: could not list ExtraHand users (%s): %s", audience, role, e)
            continue
        for raw in items:
            if not isinstance(raw, dict) or str(raw.get("role") or "").lower() not in cfg["primary"]:
                continue
            created = _parse_dt(raw.get("createdAt") or raw.get("created_at"))
            if not created or created < since:
                continue
            rec = normalize_user(raw)
            uid = str(rec.get("id") or raw.get("uid") or raw.get("_id") or "")
            if not uid or not is_real_user(raw, uid) or not rec.get("phone"):
                continue
            seen[uid] = {"id": uid, "name": rec.get("name"), "phone": rec.get("phone"), "registered_at": created}
    return sorted(seen.values(), key=lambda u: u["registered_at"])


async def _versions(name: str) -> list[dict[str, Any]]:
    """Every language version of a template at Meta with its review status (APPROVED / PENDING / REJECTED)."""
    from .meta_client import get_meta_whatsapp_client

    try:
        defs = await get_meta_whatsapp_client().get_template_defs(name)
    except Exception as e:  # noqa: BLE001
        log.warning("template lookup %s failed: %s", name, e)
        return []
    out = []
    for t in defs:
        comps = t.get("components") or []
        out.append({
            "language": t.get("language"),
            "language_name": LANGUAGE_NAMES.get(t.get("language") or "", t.get("language")),
            "status": (t.get("status") or "UNKNOWN").upper(),
            "category": (t.get("category") or "").upper() or None,
            "rejected_reason": t.get("rejected_reason") if t.get("rejected_reason") not in (None, "NONE") else None,
            "id": t.get("id"),
            "body": next((c.get("text", "") for c in comps if c.get("type") == "BODY"), ""),
            "footer": next((c.get("text", "") for c in comps if c.get("type") == "FOOTER"), ""),
            "button": next((b.get("text") for c in comps if c.get("type") == "BUTTONS" for b in c.get("buttons") or []), None),
            "button_url": next((b.get("url") for c in comps if c.get("type") == "BUTTONS" for b in c.get("buttons") or []
                                if b.get("url")), None),
            "has_image": any(c.get("type") == "HEADER" and c.get("format") == "IMAGE" for c in comps),
        })
    order = {PREFERRED_LANGUAGE: 0}
    return sorted(out, key=lambda v: order.get(v["language"], 1))


def _sending_language(versions: list[dict]) -> str | None:
    """Telugu once Meta approves it, otherwise any approved version (English); None if nothing is approved."""
    approved = [v["language"] for v in versions if v["status"] == "APPROVED"]
    if PREFERRED_LANGUAGE in approved:
        return PREFERRED_LANGUAGE
    return approved[0] if approved else None


async def _send(audience: str, user: dict) -> tuple[str, str | None, str | None]:
    from .meta_client import get_meta_whatsapp_client

    first = (user.get("name") or "").strip().split(" ")[0] or "there"
    name = AUDIENCES[audience]["template"]
    language = _sending_language(await _versions(name))
    with tagged("welcome", f"{audience}_welcome", ticket_id=user["id"]):
        resp = await get_meta_whatsapp_client().send_template_message(
            to=user["phone"], template_name=name, language_code=language, variables={"1": first, "name": first},
        )
    return resp.status, resp.message_id, resp.error


def run_welcomers(db: Session, force: bool = False) -> dict[str, int]:
    """Welcomes new signups of every active audience. Cheap no-op while both switches are off."""
    state = _state(db)
    active = [a for a, st in state.items() if st["active"]]
    if not active or (not force and time.monotonic() - _last_check["at"] < CHECK_EVERY):
        return {}
    _last_check["at"] = time.monotonic()
    _last_check["when"] = utcnow()
    counts: dict[str, int] = {}
    for audience in active:
        since = _parse_dt(state[audience]["since"]) or utcnow()
        for user in _new_signups(audience, since):
            exists = db.query(WhatsAppWelcome.id).filter_by(audience=audience, user_id=user["id"]).first()
            if exists:
                continue
            row = WhatsAppWelcome(audience=audience, user_id=user["id"], name=user["name"], phone=user["phone"],
                                  registered_at=user["registered_at"], template=AUDIENCES[audience]["template"],
                                  status="sending")
            db.add(row)
            try:
                db.commit()  # claim the user first: a crash mid-send must not welcome them twice
            except Exception:
                db.rollback()
                continue  # already claimed by another worker (server or local)
            try:
                status, mid, err = asyncio.run(_send(audience, user))
            except Exception as e:  # noqa: BLE001
                status, mid, err = "failed", None, str(e)
            row.status, row.provider_message_id, row.error = status, mid, (err or "")[:300] or None
            db.commit()
            counts[audience] = counts.get(audience, 0) + 1
            log.info("Welcomer %s: %s -> %s", audience, user["id"], status)
    return counts


# ------------------------------------------------------------------------------------------------ API

def _ledger(db: Session) -> dict[str, WhatsAppMessage]:
    """Ledger rows of welcome sends by Meta message id (delivery / read / billing reports land there)."""
    rows = db.query(WhatsAppMessage).filter(WhatsAppMessage.source == "welcome").all()
    return {m.provider_message_id: m for m in rows if m.provider_message_id}


def _delivery(w: WhatsAppWelcome, ledger: dict[str, WhatsAppMessage]) -> str:
    m = ledger.get(w.provider_message_id or "")
    return m.status if m else w.status


@router.get("/status")
def welcomers_status(db: Session = Depends(get_db)) -> dict[str, Any]:
    state = _state(db)
    today = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    out = {}
    for a, cfg in AUDIENCES.items():
        q = db.query(WhatsAppWelcome).filter(WhatsAppWelcome.audience == a)
        out[a] = {
            **state[a],
            "template": cfg["template"],
            "total": q.count(),
            "today": q.filter(WhatsAppWelcome.created_at >= today).count(),
            "failed": q.filter(WhatsAppWelcome.status == "failed").count(),
            "last_check": iso(_last_check["when"]),
            "check_every_seconds": CHECK_EVERY,
        }
    return out


async def _template_info(name: str) -> dict[str, Any]:
    versions = await _versions(name)
    lang = _sending_language(versions)
    sending = next((v for v in versions if v["language"] == lang), None)
    return {
        "template_versions": versions,
        "sending_language": lang,
        "sending_language_name": LANGUAGE_NAMES.get(lang or "", lang),
        # the text people get today (Telugu once approved, English until then)
        "template_text": (sending or (versions[0] if versions else {})).get("body", ""),
    }


SENT_STATUSES = ("sent", "delivered", "read")  # a welcome that left for WhatsApp (not failed / skipped / simulated)


@router.get("/dashboard")
def welcomers_dashboard(refresh: bool = False, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Welcomer Dashboard: helper and customer registrations on ExtraHand (real users, last 31 days) next to the
    welcome messages sent to them: today, this week, this month, day by day, the funnel, cities and hours."""
    state = _state(db)
    ledger = _ledger(db)
    now_ist = datetime.now(IST)
    today = now_ist.date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    daily = {d: {"date": d, "helper_registered": 0, "customer_registered": 0, "helper_sent": 0, "customer_sent": 0,
                 "helper_read": 0, "customer_read": 0} for d in days}
    cities: dict[str, int] = {}
    hours = [0] * 24
    audiences: dict[str, Any] = {}
    errors = []

    def period_of(d: str) -> list[str]:
        out = ["last30"] if d in daily else []
        if d == today.isoformat():
            out.append("today")
        if d >= week_start.isoformat():
            out.append("week")
        if d >= month_start.isoformat():
            out.append("month")
        return out

    for a in AUDIENCES:
        reg = _registrations(a, force=refresh)
        if reg.get("error"):
            errors.append(f"{a}: {reg['error']}")
        outcome, _ = _outcomes(db, a)
        blank = {"registered": 0, "sent": 0, "delivered": 0, "read": 0, "failed": 0}
        periods = {k: dict(blank) for k in ("today", "week", "month", "last30")}
        funnel = {"registered": 0, "with_phone": 0, "welcomed": 0, "delivered": 0, "read": 0}
        outcomes = {k: 0 for k in ("read", "delivered", "welcomed", "failed", "no_phone", "welcomer_off", "pending")}

        # registrations (from ExtraHand) and what happened to each person's welcome
        for u in reg["users"]:
            d = _ist_day(u["registered_at"])
            for k in period_of(d):
                periods[k]["registered"] += 1
            if d not in daily:
                continue
            daily[d][f"{a}_registered"] += 1
            o = outcome(u)
            outcomes[o] += 1
            funnel["registered"] += 1
            funnel["with_phone"] += int(u["has_phone"])
            funnel["welcomed"] += int(o in ("welcomed", "delivered", "read"))
            funnel["delivered"] += int(o in ("delivered", "read"))
            funnel["read"] += int(o == "read")
            city = (u.get("city") or "").strip().title()
            if city:
                cities[city] = cities.get(city, 0) + 1
            hours[u["registered_at"].replace(tzinfo=timezone.utc).astimezone(IST).hour] += 1

        # welcome messages (from our own records), by the day they were sent
        for w in db.query(WhatsAppWelcome).filter(WhatsAppWelcome.audience == a):
            st = _delivery(w, ledger)
            d = _ist_day(w.created_at)
            for k in period_of(d):
                if st in SENT_STATUSES:
                    periods[k]["sent"] += 1
                    periods[k]["delivered"] += int(st in ("delivered", "read"))
                    periods[k]["read"] += int(st == "read")
                elif st == "failed":
                    periods[k]["failed"] += 1
            if d in daily and st in SENT_STATUSES:
                daily[d][f"{a}_sent"] += 1
                daily[d][f"{a}_read"] += int(st == "read")

        sent_all = sum(1 for w in db.query(WhatsAppWelcome).filter(WhatsAppWelcome.audience == a)
                       if _delivery(w, ledger) in SENT_STATUSES)
        audiences[a] = {
            "active": state[a]["active"], "since": state[a]["since"], "template": AUDIENCES[a]["template"],
            "periods": periods, "funnel": funnel, "outcomes": outcomes, "sent_all_time": sent_all,
            "coverage": round(100 * funnel["welcomed"] / funnel["with_phone"], 1) if funnel["with_phone"] else None,
            "read_rate": round(100 * funnel["read"] / funnel["welcomed"], 1) if funnel["welcomed"] else None,
        }

    return {
        "audiences": audiences,
        "daily": list(daily.values()),  # oldest first, 30 days
        "top_cities": [{"city": c, "registered": n} for c, n in sorted(cities.items(), key=lambda x: -x[1])[:8]],
        "hours": hours,  # registrations by India hour of day, last 30 days
        "last_check": iso(_last_check["when"]),
        "fetched_at": iso(max((h["fetched_at"] for h in _history_cache.values()), default=None)),
        "errors": errors,
    }


@router.get("/{audience}")
async def welcomer_detail(audience: Audience, db: Session = Depends(get_db)) -> dict[str, Any]:
    st = welcomers_status(db)[audience]
    ledger = _ledger(db)
    rows = (db.query(WhatsAppWelcome).filter(WhatsAppWelcome.audience == audience)
            .order_by(WhatsAppWelcome.id.desc()).limit(100).all())
    return {
        **st,
        "audience": audience,
        **(await _template_info(AUDIENCES[audience]["template"])),
        "telugu_draft": TELUGU[audience]["body"],
        "telugu_button": TELUGU[audience]["button"],
        "recent": [
            {"id": w.id, "user_id": w.user_id, "name": w.name, "phone": w.phone, "registered_at": iso(w.registered_at),
             "sent_at": iso(w.created_at), "status": _delivery(w, ledger), "error": w.error}
            for w in rows
        ],
    }


@router.post("/{audience}/telugu")
async def submit_telugu(audience: Audience) -> dict[str, Any]:
    """Submits the Telugu version of this welcome to Meta for review (same name, language "te")."""
    from .meta_client import BRAND_HEADER, get_meta_whatsapp_client

    name = AUDIENCES[audience]["template"]
    existing = next((v for v in await _versions(name) if v["language"] == PREFERRED_LANGUAGE), None)
    if existing and existing["status"] != "REJECTED":
        return {"ok": True, "already": True, "status": existing["status"]}
    client = get_meta_whatsapp_client()
    header = None
    if BRAND_HEADER.is_file():
        ext = BRAND_HEADER.suffix.lower()
        up = await client.upload_template_sample(BRAND_HEADER.read_bytes(), "image/png" if ext == ".png" else "image/jpeg",
                                                 filename=BRAND_HEADER.name)
        if not up.get("ok"):
            raise HTTPException(400, up.get("error") or "Could not upload the header image to Meta.")
        header = up["handle"]
    te = TELUGU[audience]
    res = await client.create_template(
        name=name, category="MARKETING", body=te["body"], language=PREFERRED_LANGUAGE, examples=[te["example"]],
        buttons=[{"type": "URL", "text": te["button"], "url": "https://extrahand.in/"}], header_handle=header,
    )
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Meta did not accept the template.")
    log.info("Welcomer %s: Telugu version submitted to Meta (%s)", audience, res.get("status"))
    return {"ok": True, "already": False, "status": res.get("status", "PENDING")}


@router.post("/{audience}/activate")
def activate_welcomer(audience: Audience, db: Session = Depends(get_db)) -> dict[str, Any]:
    state = _state(db)
    if not state[audience]["active"]:
        # Only people who register from now on are welcomed
        state[audience] = {"active": True, "since": utcnow().isoformat()}
        _save_state(db, state)
    return welcomers_status(db)[audience]


@router.post("/{audience}/deactivate")
def deactivate_welcomer(audience: Audience, db: Session = Depends(get_db)) -> dict[str, Any]:
    state = _state(db)
    state[audience] = {**state[audience], "active": False}
    _save_state(db, state)
    return welcomers_status(db)[audience]


@router.post("/check-now")
def check_now(db: Session = Depends(get_db)) -> dict[str, int]:
    """Looks for new signups right away instead of waiting for the next minute."""
    return run_welcomers(db, force=True)


# ------------------------------------------------------------------------------------------------ commercials

commercials_router = APIRouter(prefix="/welcomer-commercials", tags=["WhatsApp Welcomers"])


def _cost(m: WhatsAppMessage, rates) -> float:
    if m.status in ("simulated", "failed") or not m.provider_message_id:
        return 0.0
    if m.billable is not None:
        return rates.rate(m.category or "service") if m.billable else 0.0
    return rates.rate(m.category or "marketing")


@commercials_router.get("")
def welcomer_commercials(db: Session = Depends(get_db)) -> dict[str, Any]:
    from .commercials import _rates

    rates = _rates(db)
    msgs = db.query(WhatsAppMessage).filter(WhatsAppMessage.source == "welcome").all()
    now_ist = datetime.now(IST)
    midnight = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    starts = {
        "today": midnight,
        "week": midnight - timedelta(days=midnight.weekday()),
        "month": midnight.replace(day=1),
        "all": None,
    }

    def summarize(rows: list[WhatsAppMessage]) -> dict[str, Any]:
        live = [m for m in rows if m.status != "simulated"]
        sent = [m for m in live if m.status != "failed"]
        delivered = [m for m in sent if m.status in ("delivered", "read")]
        read = [m for m in sent if m.status == "read"]
        cost = round(sum(_cost(m, rates) for m in rows), 2)
        return {
            "sent": len(sent),
            "delivered": len(delivered),
            "read": len(read),
            "failed": len([m for m in live if m.status == "failed"]),
            "simulated": len(rows) - len(live),
            "cost": cost,
            "cost_per_welcome": round(cost / len(sent), 2) if sent else 0.0,
            "delivery_rate": round(100 * len(delivered) / len(sent), 1) if sent else 0.0,
            "read_rate": round(100 * len(read) / len(delivered), 1) if delivered else 0.0,
        }

    periods = {}
    for key, start in starts.items():
        cut = start.astimezone(timezone.utc).replace(tzinfo=None) if start else None
        rows = [m for m in msgs if cut is None or m.created_at >= cut]
        periods[key] = {
            "total": summarize(rows),
            "helper": summarize([m for m in rows if m.purpose == "helper_welcome"]),
            "customer": summarize([m for m in rows if m.purpose == "customer_welcome"]),
        }

    daily = []
    for d in range(29, -1, -1):
        day = midnight - timedelta(days=d)
        a = day.astimezone(timezone.utc).replace(tzinfo=None)
        b = (day + timedelta(days=1)).astimezone(timezone.utc).replace(tzinfo=None)
        rows = [m for m in msgs if a <= m.created_at < b and m.status != "simulated"]
        daily.append({
            "date": day.date().isoformat(),
            "helper": len([m for m in rows if m.purpose == "helper_welcome"]),
            "customer": len([m for m in rows if m.purpose == "customer_welcome"]),
            "cost": round(sum(_cost(m, rates) for m in rows), 2),
        })
    return {"periods": periods, "daily": daily, "rate_marketing": rates.marketing}


# ------------------------------------------------------------------------------------------------ history

HISTORY_DAYS = 31
HISTORY_TTL = 300  # seconds the ExtraHand registrations are cached
_history_cache: dict[str, dict[str, Any]] = {}


_refreshing: set[str] = set()
_refresh_lock = threading.Lock()


def _registrations(audience: str, force: bool = False) -> dict[str, Any]:
    """Real ExtraHand signups of this audience in the last 31 days. Reading them takes ~40 s, so a page never waits
    for it once they were read: older than 5 min, the saved copy is returned at once and read again in the background
    (the engagement poller also reads them every 5 min, from the start). Only the very first read, or Refresh, waits."""
    hit = _history_cache.get(audience)
    if hit and not force:
        if time.monotonic() - hit["at"] >= HISTORY_TTL:
            _refresh_in_background(audience)
        return hit
    return _read_registrations(audience)


def _refresh_in_background(audience: str) -> None:
    with _refresh_lock:
        if audience in _refreshing:
            return
        _refreshing.add(audience)

    def run() -> None:
        try:
            _read_registrations(audience)
        except Exception as exc:  # noqa: BLE001 - keep showing the saved copy
            log.warning("Welcomer history %s: background read failed: %s", audience, exc)
        finally:
            with _refresh_lock:
                _refreshing.discard(audience)

    threading.Thread(target=run, daemon=True, name=f"welcomer-history-{audience}").start()


def warm_registrations() -> None:
    """Reads every audience's signups (called by the engagement poller at start and every 5 minutes)."""
    for audience in AUDIENCES:
        try:
            _read_registrations(audience)
        except Exception as exc:  # noqa: BLE001
            log.warning("Welcomer history %s: warm-up read failed: %s", audience, exc)


def _read_registrations(audience: str) -> dict[str, Any]:
    from app.integrations.extrahand import get_source
    from app.integrations.mapping import normalize_user
    from app.services.real_data import is_real_user

    cfg = AUDIENCES[audience]
    since = utcnow() - timedelta(days=HISTORY_DAYS)
    since_iso = since.isoformat(timespec="milliseconds") + "Z"
    src = get_source()
    users: dict[str, dict] = {}
    error = None
    for role in cfg["roles"]:
        try:
            reader = getattr(src, "list_users_since", None)
            items = reader(role, since_iso) if reader else src.list_users(role, max_pages=60)
        except Exception as e:  # noqa: BLE001
            error = str(e)[:200]
            log.warning("Welcomer history %s: could not list ExtraHand users (%s): %s", audience, role, e)
            continue
        for raw in items:
            if not isinstance(raw, dict) or str(raw.get("role") or "").lower() not in cfg["primary"]:
                continue
            created = _parse_dt(raw.get("createdAt") or raw.get("created_at"))
            if not created or created < since:
                continue
            rec = normalize_user(raw)
            uid = str(rec.get("id") or raw.get("uid") or raw.get("_id") or "")
            if not uid or not is_real_user(raw, uid):
                continue  # test / tester accounts are not counted
            users[uid] = {"id": uid, "registered_at": created, "has_phone": bool(rec.get("phone")),
                          "name": rec.get("name"), "phone": rec.get("phone"), "city": rec.get("city"), "removed": False}
    # Everyone we actually welcomed stays counted, even when ExtraHand later deleted the account or marked it as a
    # test account (it then drops out of the signup list above), and also when one ExtraHand list failed to load.
    # Without this the views showed fewer welcomes than Welcomer Commercials, which counts every message sent.
    with SessionLocal() as db:
        for w in (db.query(WhatsAppWelcome)
                  .filter(WhatsAppWelcome.audience == audience, WhatsAppWelcome.created_at >= since)):
            if w.user_id in users:
                continue
            users[w.user_id] = {"id": w.user_id, "registered_at": w.registered_at or w.created_at,
                                "has_phone": bool(w.phone), "name": w.name, "phone": w.phone, "city": None,
                                "removed": True, **(_removed_details(w.user_id, cfg["primary"]) if not error
                                                    else {"removed_reason": None, "now_name": None})}
    hit = {"at": time.monotonic(), "fetched_at": utcnow(), "users": list(users.values()), "error": error}
    if not error:
        _history_cache[audience] = hit  # a read with an error is used once, not cached: the next view tries again
    return hit


def _removed_details(user_id: str, primary: set[str]) -> dict[str, Any]:
    """What ExtraHand says now about someone we welcomed who dropped out of the signup list: why (deleted their
    account / marked as a test account / changed role), their name there now, and their city."""
    from app.integrations.extrahand import get_source
    from app.integrations.mapping import normalize_user
    from app.services.real_data import is_test_name

    try:
        src = get_source()
        data = getattr(src, "live", src)._main("GET", f"/users/{user_id}")
        u = data.get("data", data) if isinstance(data, dict) else {}
        u = u.get("user", u) if isinstance(u, dict) else {}
    except Exception as e:  # noqa: BLE001 - not found, offline, or no live ExtraHand
        log.info("Welcomer: could not read removed user %s: %s", user_id, e)
        return {"removed_reason": "No longer in ExtraHand's signup list", "now_name": None}
    if not isinstance(u, dict) or not u:
        return {"removed_reason": "No longer on ExtraHand", "now_name": None}
    name = u.get("name")
    role = str(u.get("role") or "").lower()
    if u.get("deletedAt") or str(name or "").strip().lower() == "account deleted" or str(u.get("status") or "").lower() in ("deleted", "inactive"):
        reason = "Deleted their account"
    elif u.get("isPaymentTester") or is_test_name(name):
        reason = "Marked as a test account"
    elif role and role not in primary:
        reason = f"Changed role to {role}"
    else:
        reason = "No longer in ExtraHand's signup list"
    return {"removed_reason": reason, "now_name": name, "city": normalize_user(u).get("city")}


def _ist_day(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).astimezone(IST).date().isoformat()


def _outcomes(db: Session, audience: str):
    """(outcome(user) -> status, welcome rows by user id). Status: read | delivered | welcomed | failed |
    no_phone | welcomer_off (registered while deactive / before activation) | pending (next check picks it up)."""
    ledger = _ledger(db)
    welcomes = {w.user_id: w for w in db.query(WhatsAppWelcome).filter(WhatsAppWelcome.audience == audience)}
    since = _parse_dt(_state(db)[audience]["since"])

    def outcome(u: dict) -> str:
        w = welcomes.get(u["id"])
        if w:
            st = _delivery(w, ledger)
            return {"read": "read", "delivered": "delivered", "failed": "failed"}.get(st, "welcomed")
        if not u["has_phone"]:
            return "no_phone"
        if since is None or u["registered_at"] < since:
            return "welcomer_off"
        return "pending"

    return outcome, welcomes


@router.get("/{audience}/history")
def welcomer_history(audience: Audience, refresh: bool = False, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Day by day: who registered on ExtraHand and what happened to their welcome message."""
    reg = _registrations(audience, force=refresh)
    outcome, _ = _outcomes(db, audience)

    blank = {"registered": 0, "with_phone": 0, "welcomed": 0, "delivered": 0, "read": 0, "failed": 0,
             "no_phone": 0, "welcomer_off": 0, "pending": 0}

    def add(row: dict, u: dict) -> None:
        o = outcome(u)
        row["registered"] += 1
        row["with_phone"] += int(u["has_phone"])
        if o in ("welcomed", "delivered", "read"):
            row["welcomed"] += 1
        if o in ("delivered", "read"):
            row["delivered"] += 1
        if o == "read":
            row["read"] += 1
        if o == "failed":
            row["failed"] += 1
        if o in ("no_phone", "welcomer_off", "pending"):
            row[o] += 1

    today = datetime.now(IST).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(HISTORY_DAYS - 1, -1, -1)]
    daily = {d: {"date": d, **blank} for d in days}
    week_start = (today - timedelta(days=today.weekday())).isoformat()
    month_start = today.replace(day=1).isoformat()
    periods = {"today": dict(blank), "week": dict(blank), "month": dict(blank), "last30": dict(blank)}
    for u in reg["users"]:
        d = _ist_day(u["registered_at"])
        if d in daily:
            add(daily[d], u)
            add(periods["last30"], u)
        if d == today.isoformat():
            add(periods["today"], u)
        if d >= week_start:
            add(periods["week"], u)
        if d >= month_start:
            add(periods["month"], u)

    return {
        "audience": audience,
        "periods": periods,
        "daily": list(reversed(list(daily.values()))),  # newest first
        "fetched_at": iso(reg["fetched_at"]),
        "error": reg["error"],
    }


PEOPLE_STATUSES = ("welcomed", "delivered", "read", "failed", "welcomer_off", "no_phone", "pending")


@router.get("/{audience}/people")
def welcomer_people(
    audience: Audience,
    day: str = "",
    status: str = "all",
    q: str = "",
    offset: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Every person who registered (last 31 days, from ExtraHand) and what happened to their welcome message.
    `day` = YYYY-MM-DD (India time); `status` = all | sent (welcomed + delivered + read) | one of PEOPLE_STATUSES."""
    reg = _registrations(audience)
    outcome, welcomes = _outcomes(db, audience)
    people = []
    for u in reg["users"]:
        if day and _ist_day(u["registered_at"]) != day:
            continue
        o = outcome(u)
        w = welcomes.get(u["id"])
        people.append({
            "user_id": u["id"], "name": u.get("name"), "phone": u.get("phone"), "city": u.get("city"),
            "registered_at": iso(u["registered_at"]), "status": o,
            "welcomed_at": iso(w.created_at) if w else None, "error": w.error if w else None,
            # welcomed, then deleted on ExtraHand or marked as a test account: still counted, as the message was sent
            "removed": bool(u.get("removed")),
            "removed_reason": u.get("removed_reason"), "now_name": u.get("now_name"),
        })
    counts = {k: 0 for k in PEOPLE_STATUSES}
    for p in people:
        counts[p["status"]] += 1
    counts["all"] = len(people)
    counts["sent"] = counts["welcomed"] + counts["delivered"] + counts["read"]

    if status == "sent":
        people = [p for p in people if p["status"] in ("welcomed", "delivered", "read")]
    elif status in PEOPLE_STATUSES:
        people = [p for p in people if p["status"] == status]
    if q.strip():
        needle = q.strip().lower()
        people = [p for p in people if needle in " ".join(str(p[k] or "") for k in ("name", "phone", "city", "user_id")).lower()]
    people.sort(key=lambda p: p["registered_at"] or "", reverse=True)
    limit = max(1, min(limit, 200))
    return {"counts": counts, "total": len(people), "offset": offset, "limit": limit,
            "items": people[offset:offset + limit], "fetched_at": iso(reg["fetched_at"])}
