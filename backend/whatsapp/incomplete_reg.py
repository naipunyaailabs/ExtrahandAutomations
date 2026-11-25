"""Incomplete Registration Engagement: reminds helpers and customers who stopped registration in the middle.

Rules (product spec):
- Starts INACTIVE (stored in AppSetting under KEY = "whatsapp_incomplete_reg").
- Wait period: WAIT_HOURS = 5 hours after signup (`createdAt`).
  * Only users who sign up AFTER the moment the automation is activated are messaged. Everyone who signed up
    before activation is ignored ("old_skipped"), even if still incomplete. Re-activating after a pause starts
    counting again from the new activation time.
  * New helpers and customers wait 5 hours; if they finish registration within 5 hours they are
    skipped automatically, otherwise they receive one reminder after 5 hours.
- One message per user/phone lifetime (`whatsapp_incomplete_regs` unique on audience + user_id, plus 10-digit phone guard).
- Sends Telugu templates (`extrahand_helper_reg_pending` and `extrahand_customer_reg_pending`, language "te").
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.database import SessionLocal, get_db
from app.models import AppSetting, WhatsAppIncompleteReg, WhatsAppMessage, utcnow

from .meta_client import get_meta_whatsapp_client, param_text
from .metering import tagged

log = logging.getLogger("whatsapp.incomplete_reg")
router = APIRouter(prefix="/incomplete-reg", tags=["WhatsApp Incomplete Registration"])

Audience = Literal["helper", "customer"]
IST = timezone(timedelta(hours=5, minutes=30))
KEY = "whatsapp_incomplete_reg"
WAIT_HOURS = 5
WAIT_DELTA = timedelta(hours=WAIT_HOURS)
CHECK_EVERY = 20  # seconds between worker batch scans while active
BATCH_SIZE = 25   # max messages dispatched per worker tick to avoid blocking & respect Meta rate limits
CACHE_TTL = 300   # 5-minute cache for ExtraHand scan (matches approved polling interval)

# Exact Telugu templates requested for Incomplete Registration
TEMPLATES: dict[str, dict[str, Any]] = {
    "helper": {
        "name": "extrahand_helper_reg_pending",
        "language": "te",
        "category": "MARKETING",
        "has_name_param": False,
        "example": None,
        "body": (
            "నమస్కారం! 🙏\n\n"
            "మీ Helper Registration ఇంకా Pending లో ఉంది.\n\n"
            "దయచేసి ఇప్పుడే మీ Registration పూర్తి చేసుకోండి.\n\n"
            "మీ తోటి Helpers ఇప్పటికే Registration పూర్తి చేసుకుని ExtraHand ద్వారా సంపాదిస్తున్నారు. "
            "మీరు కూడా ఆలస్యం చేయకుండా Registration పూర్తి చేసుకుని సంపాదించడం ప్రారంభించండి! 💰\n\n"
            "*ExtraHand – సహాయం చేయండి, రోజూ సంపాదించండి!*"
        ),
    },
    "customer": {
        "name": "extrahand_customer_reg_pending",
        "language": "te",
        "category": "MARKETING",
        "has_name_param": True,
        "example": "Priya",
        "body": (
            "నమస్కారం {{1}} గారు! 🙏\n\n"
            "మీ Customer Registration ఇంకా Pending లో ఉంది.\n\n"
            "దయచేసి ఇప్పుడే మీ Registration పూర్తి చేసుకోండి.\n\n"
            "మీ చుట్టుపక్కల వారు కూడా ExtraHand ద్వారా తక్కువ ధరలో, తక్కువ సమయంలో తమకు కావాల్సిన ఈ సేవలను బుక్ చేసుకుంటున్నారు:\n\n"
            "🧹 Cleaning\n"
            "⚡ Electrician\n"
            "🔧 Plumber\n"
            "❄️ AC Repair\n"
            "🚗 Driver\n"
            "📦 Delivery Boys\n"
            "➕ ఇంకా ఎన్నో సేవలు!\n\n"
            "మీరు కూడా ఇప్పుడే Registration పూర్తి చేసుకుని, సులభంగా మరియు తక్కువ ధరలో సేవలను పొందండి! 😊\n\n"
            "*ExtraHand – మీకు దగ్గరలోనే నమ్మకమైన సహాయం!*"
        ),
    },
}

STAGE_LABELS = {
    "profile_pending": "Profile / Location pending",
    "kyc_pending": "KYC pending",
    "role_pending": "Role not selected",
    "location_pending": "No location",
    "name_pending": "Name missing",
}

_PLACEHOLDER_NAMES = {"", "user", "customer", "unknown", "helper", "partner", "guest"}
_last_check: dict[str, Any] = {"at": 0.0, "when": None}
_scan_cache: dict[str, Any] = {"at": 0.0, "fetched_at": None, "users": [], "completed": [], "error": None}
_scan_lock = threading.Lock()
_refreshing = False


# ------------------------------------------------------------------------------------------------ state helpers

def _state(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, KEY)
    data: dict[str, Any] = {}
    if row and row.value:
        try:
            data = json.loads(row.value) or {}
        except ValueError:
            data = {}
    return {
        "active": bool(data.get("active")),
        "activated_at": data.get("activated_at"),
    }


def _start_from(state: dict[str, Any]) -> datetime:
    """Only signups at or after this moment get a reminder: the activation time, or "now" while inactive."""
    if state.get("active"):
        start = _parse_dt(state.get("activated_at"))
        if start:
            return start
    return utcnow()


def _save_state(db: Session, **changes: Any) -> dict[str, Any]:
    state = {**_state(db), **changes}
    row = db.get(AppSetting, KEY) or AppSetting(key=KEY)
    row.value = json.dumps(state)
    db.add(row)
    db.commit()
    return state


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _phone_key(phone: Any) -> str:
    digits = "".join(c for c in str(phone or "") if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _customer_first_name(name: str | None) -> str:
    raw = (name or "").strip()
    if raw.lower() in _PLACEHOLDER_NAMES or raw.isdigit():
        return "కస్టమర్"
    first = raw.split()[0] if raw.split() else ""
    if not first or first.lower() in _PLACEHOLDER_NAMES or first.isdigit():
        return "కస్టమర్"
    return first[:1].upper() + first[1:]


# ------------------------------------------------------------------------------------------------ ExtraHand scan

def _read_all_live_pages(live_client: Any, params: dict[str, Any], max_pages: int = 100) -> list[dict]:
    from app.integrations.mapping import extract_list

    first = live_client._main("GET", "/users", params={**params, "page": 1, "limit": 50})
    pages = min(int((first.get("pagination") or {}).get("pages") or 1), max_pages)
    if pages <= 1:
        return extract_list(first)
    with ThreadPoolExecutor(max_workers=6) as pool:
        rest = list(pool.map(
            lambda p: extract_list(live_client._main("GET", "/users", params={**params, "page": p, "limit": 50})),
            range(2, pages + 1),
        ))
    return [u for chunk in [extract_list(first), *rest] for u in chunk]


def _fetch_raw_users() -> tuple[list[dict], set[str], set[str], str | None]:
    """Reads partners, customers, recent unknown-role users, and task participant IDs from ExtraHand."""
    from app.integrations.extrahand import LiveExtraHandClient, get_source

    src = get_source()
    live = getattr(src, "live", src)
    by_id: dict[str, dict] = {}
    errors: list[str] = []

    if isinstance(live, LiveExtraHandClient):
        # ExtraHand's /users stops at 100 pages (5,000 users) per query and ignores role=unknown, so every user
        # (partner, customer, helper, unknown) is read newest-first AND oldest-first; together they cover 10,000.
        queries = [
            ("all_newest", {"sortBy": "createdAt", "sortOrder": "desc"}, 100),
            ("all_oldest", {"sortBy": "createdAt", "sortOrder": "asc"}, 100),
        ]
        for label, qparams, max_pg in queries:
            try:
                for u in _read_all_live_pages(live, qparams, max_pages=max_pg):
                    uid = str(u.get("uid") or u.get("_id") or "")
                    if uid and uid not in by_id:
                        by_id[uid] = u
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{label}: {str(exc)[:120]}")
                log.warning("Incomplete-reg scan (%s) failed: %s", label, exc)
        if len(by_id) >= 10000:
            log.warning("Incomplete-reg scan read %d users: ExtraHand may now have users in the middle that are not read", len(by_id))
    else:
        # Mock / unit-test source supporting list_users(role, max_pages=...)
        for role in ("partner", "helper", "customer", "unknown"):
            try:
                for u in src.list_users(role, max_pages=60):
                    uid = str(u.get("uid") or u.get("_id") or u.get("id") or "")
                    if uid and uid not in by_id:
                        by_id[uid] = u
            except Exception as exc:  # noqa: BLE001
                log.debug("list_users(%s) skipped: %s", role, exc)

    ordering_customers: set[str] = set()
    assigned_helpers: set[str] = set()
    try:
        from user_engagement.extrahand_data import all_tasks, live_enabled

        if live_enabled():
            tasks, _ = all_tasks()
            for t in tasks:
                if t.get("isTeamPosted") is True or str(t.get("postedBy") or "").lower() == "team":
                    continue
                for k in ("CustomerId", "customerId", "requesterId"):
                    if t.get(k):
                        ordering_customers.add(str(t[k]))
                for k in ("assigneeId", "assigneeUid", "partnerId", "partnerUid"):
                    if t.get(k):
                        assigned_helpers.add(str(t[k]))
    except Exception as exc:  # noqa: BLE001 - task list optional when ExtraHand tasks offline or in tests
        log.debug("Incomplete-reg tasks lookup skipped: %s", exc)

    return list(by_id.values()), ordering_customers, assigned_helpers, ("; ".join(errors) if errors else None)


def classify_incomplete_user(
    raw: dict[str, Any],
    ordering_customers: set[str],
    assigned_helpers: set[str],
) -> dict[str, Any] | None:
    """Returns normalized incomplete-registration record, or None if the user completed registration or is a test account."""
    from app.integrations.mapping import normalize_user
    from app.services.real_data import is_real_user
    from user_engagement.regions import _raw_place

    if not isinstance(raw, dict):
        return None
    rec = normalize_user(raw)
    uid = str(rec.get("id") or raw.get("uid") or raw.get("_id") or "")
    if not uid or not is_real_user(raw, uid):
        return None

    created = _parse_dt(raw.get("createdAt") or raw.get("created_at"))
    if not created:
        return None

    role = str(raw.get("role") or "").strip().lower()
    roles = {str(r).strip().lower() for r in (raw.get("roles") or []) if r}
    all_ids = {str(raw.get(k)) for k in ("_id", "uid", "userId", "profileId") if raw.get(k)} | {uid}
    phone = rec.get("phone")
    city = rec.get("city")
    name = (rec.get("name") or raw.get("name") or "").strip() or None

    # 1. Helper (partner / helper)
    if role in ("partner", "helper") or "partner" in roles or "helper" in roles:
        pp = raw.get("partnerProfile") if isinstance(raw.get("partnerProfile"), dict) else {}
        pp_status = str(pp.get("status") or "").lower()
        if (
            pp_status == "approved"
            or raw.get("isVerified") is True
            or int(raw.get("completedTasks") or 0) > 0
            or bool(all_ids & assigned_helpers)
        ):
            return None

        missing: list[str] = []
        if not pp.get("onboardingCompleted"):
            missing.append("Onboarding profile")
        if _raw_place(raw) is None:
            missing.append("Location")
        if not (pp.get("categories") or []):
            missing.append("Service categories")
        if not (pp.get("workAreas") or []):
            missing.append("Work areas")

        if missing:
            stage = "profile_pending"
        elif not raw.get("isAadhaarVerified"):
            stage = "kyc_pending"
            missing = ["Aadhaar KYC"]
        else:
            return None

        return {
            "id": uid,
            "audience": "helper",
            "name": name,
            "phone": phone,
            "has_phone": bool(phone),
            "city": city,
            "stage": stage,
            "stage_label": STAGE_LABELS[stage],
            "missing": missing,
            "registered_at": created,
        }

    # 2. Unknown role (stopped before selecting Customer vs Helper)
    if role == "unknown":
        if bool(all_ids & ordering_customers) or int(raw.get("postedTasks") or 0) > 0:
            return None
        return {
            "id": uid,
            "audience": "customer",
            "name": name,
            "phone": phone,
            "has_phone": bool(phone),
            "city": city,
            "stage": "role_pending",
            "stage_label": STAGE_LABELS["role_pending"],
            "missing": ["Role selection"],
            "registered_at": created,
        }

    # 3. Customer
    if role == "customer":
        if bool(all_ids & ordering_customers) or int(raw.get("postedTasks") or 0) > 0:
            return None
        missing = []
        has_saved_addr = bool(raw.get("savedAddresses") or [])
        if _raw_place(raw) is None and not has_saved_addr:
            missing.append("Location")
        clean_name = (name or "").strip()
        if clean_name.lower() in _PLACEHOLDER_NAMES or clean_name.isdigit():
            missing.append("Name")
        if not missing:
            return None
        stage = "location_pending" if "Location" in missing else "name_pending"
        return {
            "id": uid,
            "audience": "customer",
            "name": name,
            "phone": phone,
            "has_phone": bool(phone),
            "city": city,
            "stage": stage,
            "stage_label": STAGE_LABELS[stage],
            "missing": missing,
            "registered_at": created,
        }

    return None


def classify_completed_user(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Light record for a real user who finished registration (call only when classify_incomplete_user returned None)."""
    from app.integrations.mapping import normalize_user
    from app.services.real_data import is_real_user

    if not isinstance(raw, dict):
        return None
    rec = normalize_user(raw)
    uid = str(rec.get("id") or raw.get("uid") or raw.get("_id") or "")
    if not uid or not is_real_user(raw, uid):
        return None
    created = _parse_dt(raw.get("createdAt") or raw.get("created_at"))
    if not created:
        return None
    role = str(raw.get("role") or "").strip().lower()
    roles = {str(r).strip().lower() for r in (raw.get("roles") or []) if r}
    if role in ("partner", "helper") or "partner" in roles or "helper" in roles:
        audience = "helper"
    elif role in ("customer", "unknown"):
        audience = "customer"
    else:
        return None
    name = (rec.get("name") or raw.get("name") or "").strip() or None
    return {
        "id": uid,
        "audience": audience,
        "name": name,
        "phone": rec.get("phone"),
        "city": rec.get("city"),
        "registered_at": created,
    }


def _run_scan() -> dict[str, Any]:
    raw_users, ordering_customers, assigned_helpers, error = _fetch_raw_users()
    found: list[dict[str, Any]] = []
    completed: list[dict[str, Any]] = []
    for raw in raw_users:
        item = classify_incomplete_user(raw, ordering_customers, assigned_helpers)
        if item is not None:
            found.append(item)
        else:
            done = classify_completed_user(raw)
            if done is not None:
                completed.append(done)
    found.sort(key=lambda u: u["registered_at"], reverse=True)
    completed.sort(key=lambda u: u["registered_at"], reverse=True)
    snap = {"at": time.monotonic(), "fetched_at": utcnow(), "users": found, "completed": completed, "error": error}
    with _scan_lock:
        if not error or not _scan_cache["users"]:
            _scan_cache.update(snap)
    return snap


def _refresh_in_background() -> None:
    global _refreshing
    with _scan_lock:
        if _refreshing:
            return
        _refreshing = True

    def work() -> None:
        global _refreshing
        try:
            _run_scan()
        except Exception as exc:  # noqa: BLE001
            log.warning("Incomplete-reg background scan failed: %s", exc)
        finally:
            with _scan_lock:
                _refreshing = False

    threading.Thread(target=work, daemon=True, name="incomplete-reg-scan").start()


def get_incomplete_snapshot(force: bool = False, sync_wait: bool = False) -> dict[str, Any]:
    """Returns cached incomplete-user scan; triggers background reload if stale unless sync_wait=True."""
    with _scan_lock:
        hit = dict(_scan_cache)
    stale = not hit["fetched_at"] or (time.monotonic() - hit["at"] >= CACHE_TTL)
    if force or (sync_wait and stale):
        return _run_scan()
    if stale:
        _refresh_in_background()
    return hit


def warm_incomplete_registrations() -> None:
    """Called by background poller on startup / every 5 min so the dashboard opens immediately."""
    try:
        _run_scan()
    except Exception as exc:  # noqa: BLE001
        log.warning("Incomplete-reg warm scan failed: %s", exc)


# ------------------------------------------------------------------------------------------------ Meta templates

async def _template_status(audience: Audience) -> dict[str, Any]:
    cfg = TEMPLATES[audience]
    try:
        live = await get_meta_whatsapp_client().get_template_def(cfg["name"], cfg["language"])
    except Exception as exc:  # noqa: BLE001
        return {
            "name": cfg["name"],
            "language": cfg["language"],
            "status": "UNKNOWN",
            "category": cfg["category"],
            "rejected_reason": None,
            "error": str(exc)[:200],
            "body": cfg["body"],
        }
    if not live:
        return {
            "name": cfg["name"],
            "language": cfg["language"],
            "status": "NOT_CREATED",
            "category": cfg["category"],
            "rejected_reason": None,
            "error": None,
            "body": cfg["body"],
        }
    return {
        "name": cfg["name"],
        "language": live.get("language") or cfg["language"],
        "status": str(live.get("status") or "UNKNOWN").upper(),
        "category": str(live.get("category") or cfg["category"]).upper(),
        "rejected_reason": live.get("rejected_reason") if live.get("rejected_reason") not in (None, "NONE") else None,
        "id": live.get("id"),
        "error": None,
        "body": cfg["body"],
    }


async def _send_one(audience: str, user: dict[str, Any]) -> tuple[str, str | None, str | None]:
    cfg = TEMPLATES[audience]
    client = get_meta_whatsapp_client()
    if cfg["has_name_param"]:
        cname = param_text(_customer_first_name(user.get("name")))
        components: list[dict[str, Any]] = [
            {"type": "body", "parameters": [{"type": "text", "text": cname}]},
        ]
        variables = {"1": cname, "name": cname}
    else:
        components = []
        variables = None

    with tagged("incomplete_reg", f"{audience}_reg_pending", ticket_id=user["id"]):
        resp = await client.send_template_message(
            to=user["phone"],
            template_name=cfg["name"],
            language_code=cfg["language"],
            components=components,
            variables=variables,
        )
    return resp.status, resp.message_id, resp.error


# ------------------------------------------------------------------------------------------------ worker job

def _ready_audiences() -> set[str]:
    client = get_meta_whatsapp_client()
    if client.simulated or not client.is_configured:
        return {"helper", "customer"}
    approved: set[str] = set()
    for aud, cfg in TEMPLATES.items():
        try:
            tmpl = asyncio.run(client.get_template_def(cfg["name"], cfg["language"]))
        except Exception:  # noqa: BLE001
            tmpl = None
        if tmpl and str(tmpl.get("status") or "").upper() == "APPROVED":
            approved.add(aud)
    return approved


def run_incomplete_reg(
    db: Session,
    force: bool = False,
    batch_limit: int = BATCH_SIZE,
    sync_scan: bool = False,
) -> dict[str, int]:
    """Worker job: sends one Telugu WhatsApp reminder to incomplete helpers & customers past the 5-hour wait.

    Cheap no-op while inactive.
    """
    state = _state(db)
    if not state["active"]:
        return {}
    if not force and time.monotonic() - _last_check["at"] < CHECK_EVERY:
        return {}
    _last_check["at"] = time.monotonic()
    _last_check["when"] = utcnow()

    snap = get_incomplete_snapshot(force=force, sync_wait=sync_scan)
    users = snap.get("users") or []
    if not users:
        return {"checked": 0, "sent": 0}

    allowed = _ready_audiences()
    if not allowed:
        log.info("Incomplete-reg: active, waiting for Meta template approval.")
        return {"checked": len(users), "sent": 0}

    cutoff = utcnow() - WAIT_DELTA
    start_from = _start_from(state)
    existing_rows = db.query(WhatsAppIncompleteReg).filter(WhatsAppIncompleteReg.is_test.is_(False)).all()
    done_keys = {(r.audience, r.user_id) for r in existing_rows}
    # "per one user one msg thats it": never send twice to the same 10-digit phone either
    sent_phones = {
        r.phone_key for r in existing_rows
        if r.phone_key and r.status in ("sending", "sent", "delivered", "read", "simulated")
    }

    counts = {"checked": len(users), "helper": 0, "customer": 0, "sent": 0, "failed": 0}
    dispatched = 0
    for u in users:
        if dispatched >= batch_limit:
            break
        if not _state(db)["active"]:
            break  # admin toggled Deactivate mid-batch
        aud = u["audience"]
        if aud not in allowed:
            continue
        if u["registered_at"] < start_from:
            continue  # signed up before activation -> old user, ignored
        if u["registered_at"] > cutoff:
            continue  # still inside the 5-hour completion grace window
        if (aud, u["id"]) in done_keys or not u["has_phone"]:
            continue
        pkey = _phone_key(u["phone"])
        if pkey and pkey in sent_phones:
            continue

        row = WhatsAppIncompleteReg(
            audience=aud,
            user_id=u["id"],
            name=u.get("name"),
            phone=u.get("phone"),
            phone_key=pkey or None,
            stage=u["stage"],
            city=u.get("city"),
            registered_at=u["registered_at"],
            template=TEMPLATES[aud]["name"],
            status="sending",
        )
        db.add(row)
        try:
            db.commit()  # claim user atomically before sending (multi-worker safe)
        except Exception:  # noqa: BLE001
            db.rollback()
            continue

        done_keys.add((aud, u["id"]))
        if pkey:
            sent_phones.add(pkey)

        try:
            status, mid, err = asyncio.run(_send_one(aud, u))
        except Exception as exc:  # noqa: BLE001
            status, mid, err = "failed", None, str(exc)

        row.status = status if status in ("sent", "delivered", "simulated") else "failed"
        row.provider_message_id = mid
        row.error = (err or "")[:300] or None
        row.sent_at = utcnow() if row.status in ("sent", "delivered", "simulated") else None
        db.commit()

        dispatched += 1
        if row.status in ("sent", "delivered", "simulated"):
            counts[aud] += 1
            counts["sent"] += 1
        else:
            counts["failed"] += 1
        log.info("Incomplete-reg %s: %s (%s) -> %s", aud, u["id"], u["stage"], row.status)

    return counts


# ------------------------------------------------------------------------------------------------ ledger & formatting

def _ledger(db: Session) -> dict[str, WhatsAppMessage]:
    rows = db.query(WhatsAppMessage).filter(WhatsAppMessage.source == "incomplete_reg").all()
    return {m.provider_message_id: m for m in rows if m.provider_message_id}


def _delivery(r: WhatsAppIncompleteReg, ledger: dict[str, WhatsAppMessage]) -> str:
    m = ledger.get(r.provider_message_id or "")
    return m.status if m else r.status


def _webhook_last_seen(db: Session) -> str | None:
    row = db.get(AppSetting, "whatsapp_webhook_last_seen")
    return row.value if row and row.value else None


def _ist_day(dt: datetime) -> str:
    aware = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return aware.astimezone(IST).date().isoformat()


# ------------------------------------------------------------------------------------------------ API endpoints

@router.get("/dashboard")
async def incomplete_dashboard(refresh: bool = False, db: Session = Depends(get_db)) -> dict[str, Any]:
    state = _state(db)
    snap = get_incomplete_snapshot(force=refresh, sync_wait=False)
    users = snap.get("users") or []
    now = utcnow()
    cutoff = now - WAIT_DELTA
    start_from = _start_from(state)

    rows = db.query(WhatsAppIncompleteReg).filter(WhatsAppIncompleteReg.is_test.is_(False)).all()
    ledger = _ledger(db)
    by_user = {(r.audience, r.user_id): r for r in rows}
    sent_phones = {
        r.phone_key for r in rows
        if r.phone_key and r.status in ("sending", "sent", "delivered", "read", "simulated")
    }

    completed = snap.get("completed") or []
    completed_ids = {(c["audience"], c["id"]) for c in completed}

    counts = {
        "total_incomplete": len(users),
        "helper_incomplete": 0,
        "customer_incomplete": 0,
        "total_completed": len(completed),
        "helper_completed": sum(1 for c in completed if c["audience"] == "helper"),
        "customer_completed": sum(1 for c in completed if c["audience"] == "customer"),
        "completed_after_reminder": 0,
        "waiting_5h": 0,
        "ready_to_send": 0,
        "old_skipped": 0,
        "no_phone": 0,
        "sent": 0,
        "delivered": 0,
        "read": 0,
        "failed": 0,
        "simulated": 0,
    }
    stages = {k: 0 for k in STAGE_LABELS}

    for u in users:
        counts[f"{u['audience']}_incomplete"] += 1
        stages[u["stage"]] = stages.get(u["stage"], 0) + 1
        r = by_user.get((u["audience"], u["id"]))
        pkey = _phone_key(u.get("phone"))
        if r:
            continue
        if u["registered_at"] < start_from:
            counts["old_skipped"] += 1
        elif not u["has_phone"]:
            counts["no_phone"] += 1
        elif pkey and pkey in sent_phones:
            continue
        elif u["registered_at"] > cutoff:
            counts["waiting_5h"] += 1
        else:
            counts["ready_to_send"] += 1

    for r in rows:
        st = _delivery(r, ledger)
        if st in ("sent", "delivered", "read"):
            counts["sent"] += 1
            if (r.audience, r.user_id) in completed_ids:
                counts["completed_after_reminder"] += 1
            if st in ("delivered", "read"):
                counts["delivered"] += 1
            if st == "read":
                counts["read"] += 1
        elif st == "simulated":
            counts["simulated"] += 1
        elif st == "failed":
            counts["failed"] += 1

    today_ist = datetime.now(IST).date()
    days = [(today_ist - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    daily = {d: {"date": d, "helper_incomplete": 0, "customer_incomplete": 0, "completed": 0, "sent": 0, "read": 0} for d in days}
    for u in users:
        d = _ist_day(u["registered_at"])
        if d in daily:
            daily[d][f"{u['audience']}_incomplete"] += 1
    for c in completed:
        d = _ist_day(c["registered_at"])
        if d in daily:
            daily[d]["completed"] += 1
    for r in rows:
        st = _delivery(r, ledger)
        d = _ist_day(r.sent_at or r.created_at)
        if d in daily and st in ("sent", "delivered", "read"):
            daily[d]["sent"] += 1
            if st == "read":
                daily[d]["read"] += 1

    t_helper, t_customer = await asyncio.gather(_template_status("helper"), _template_status("customer"))
    tests = (
        db.query(WhatsAppIncompleteReg)
        .filter(WhatsAppIncompleteReg.is_test.is_(True))
        .order_by(WhatsAppIncompleteReg.id.desc())
        .limit(10)
        .all()
    )

    return {
        "active": state["active"],
        "activated_at": state["activated_at"],
        "start_from": iso(_start_from(state)) if state["active"] else None,
        "wait_hours": WAIT_HOURS,
        "last_check": iso(_last_check["when"]),
        "fetched_at": iso(snap.get("fetched_at")),
        "loading": snap.get("fetched_at") is None,
        "error": snap.get("error"),
        "counts": counts,
        "stages": [{"key": k, "label": STAGE_LABELS[k], "count": stages[k]} for k in STAGE_LABELS],
        "templates": {"helper": t_helper, "customer": t_customer},
        "recent_tests": [
            {
                "id": t.id, "audience": t.audience, "name": t.name, "phone": t.phone,
                "status": _delivery(t, ledger), "error": t.error, "created_at": iso(t.created_at),
            }
            for t in tests
        ],
        "daily": list(daily.values()),
    }


@router.get("/users")
def incomplete_users(
    audience: Literal["all", "helper", "customer"] = "all",
    stage: str = "all",
    status: str = "all",
    q: str = "",
    offset: int = 0,
    limit: int = 50,
    refresh: bool = False,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    snap = get_incomplete_snapshot(force=refresh, sync_wait=False)
    users = snap.get("users") or []
    now = utcnow()
    cutoff = now - WAIT_DELTA
    start_from = _start_from(_state(db))

    rows = db.query(WhatsAppIncompleteReg).filter(WhatsAppIncompleteReg.is_test.is_(False)).all()
    ledger = _ledger(db)
    by_user = {(r.audience, r.user_id): r for r in rows}
    sent_phones = {
        r.phone_key for r in rows
        if r.phone_key and r.status in ("sending", "sent", "delivered", "read", "simulated")
    }

    items: list[dict[str, Any]] = []
    counts = {
        "all": 0, "helper": 0, "customer": 0,
        "waiting_5h": 0, "ready": 0, "old_skipped": 0, "sent": 0, "delivered": 0, "read": 0, "failed": 0,
        "simulated": 0, "no_phone": 0,
    }

    for u in users:
        if audience != "all" and u["audience"] != audience:
            continue
        if stage != "all" and u["stage"] != stage:
            continue

        r = by_user.get((u["audience"], u["id"]))
        pkey = _phone_key(u.get("phone"))
        eligible_at = u["registered_at"] + WAIT_DELTA
        remaining_sec = max(0, int((eligible_at - now).total_seconds()))

        if r:
            st = _delivery(r, ledger)
            msg_status = "sent" if st == "sending" else st
        elif u["registered_at"] < start_from:
            msg_status = "old_skipped"
        elif not u["has_phone"]:
            msg_status = "no_phone"
        elif pkey and pkey in sent_phones:
            msg_status = "sent"
        elif u["registered_at"] > cutoff:
            msg_status = "waiting_5h"
        else:
            msg_status = "ready"

        counts["all"] += 1
        counts[u["audience"]] += 1
        if msg_status in counts:
            counts[msg_status] += 1
        if msg_status in ("delivered", "read"):
            counts["sent"] += 1

        items.append({
            "user_id": u["id"],
            "audience": u["audience"],
            "name": u.get("name"),
            "phone": u.get("phone"),
            "city": u.get("city"),
            "stage": u["stage"],
            "stage_label": u["stage_label"],
            "missing": u["missing"],
            "registered_at": iso(u["registered_at"]),
            "eligible_at": iso(eligible_at),
            "remaining_seconds": remaining_sec,
            "msg_status": msg_status,
            "sent_at": iso(r.sent_at or r.created_at) if r else None,
            "error": r.error if r else None,
        })

    if status == "sent":
        items = [x for x in items if x["msg_status"] in ("sent", "delivered", "read")]
    elif status != "all":
        items = [x for x in items if x["msg_status"] == status]

    needle = q.strip().lower()
    if needle:
        items = [
            x for x in items
            if needle in " ".join(str(x.get(k) or "") for k in ("name", "phone", "city", "user_id", "stage_label")).lower()
        ]

    limit = max(1, min(limit, 200))
    return {
        "counts": counts,
        "total": len(items),
        "offset": offset,
        "limit": limit,
        "fetched_at": iso(snap.get("fetched_at")),
        "loading": snap.get("fetched_at") is None,
        "error": snap.get("error"),
        "items": items[offset:offset + limit],
    }


@router.get("/completed")
def completed_users(
    audience: Literal["all", "helper", "customer"] = "all",
    reminded: Literal["all", "yes", "no"] = "all",
    q: str = "",
    offset: int = 0,
    limit: int = 50,
    refresh: bool = False,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Real helpers & customers who finished registration, newest first, flagged if they completed after our reminder."""
    snap = get_incomplete_snapshot(force=refresh, sync_wait=False)
    completed = snap.get("completed") or []

    rows = db.query(WhatsAppIncompleteReg).filter(WhatsAppIncompleteReg.is_test.is_(False)).all()
    ledger = _ledger(db)
    by_user = {(r.audience, r.user_id): r for r in rows}

    counts = {"all": 0, "helper": 0, "customer": 0, "reminded": 0, "organic": 0}
    items: list[dict[str, Any]] = []
    for c in completed:
        r = by_user.get((c["audience"], c["id"]))
        st = _delivery(r, ledger) if r else None
        was_reminded = st in ("sent", "delivered", "read")
        counts["all"] += 1
        counts[c["audience"]] += 1
        counts["reminded" if was_reminded else "organic"] += 1
        if audience != "all" and c["audience"] != audience:
            continue
        if reminded == "yes" and not was_reminded:
            continue
        if reminded == "no" and was_reminded:
            continue
        items.append({
            "user_id": c["id"],
            "audience": c["audience"],
            "name": c.get("name"),
            "phone": c.get("phone"),
            "city": c.get("city"),
            "registered_at": iso(c["registered_at"]),
            "reminded": was_reminded,
            "reminder_status": st,
            "reminder_sent_at": iso(r.sent_at or r.created_at) if r else None,
        })

    needle = q.strip().lower()
    if needle:
        items = [
            x for x in items
            if needle in " ".join(str(x.get(k) or "") for k in ("name", "phone", "city", "user_id")).lower()
        ]

    offset = max(0, offset)
    limit = max(1, min(limit, 200))
    return {
        "counts": counts,
        "total": len(items),
        "offset": offset,
        "limit": limit,
        "fetched_at": iso(snap.get("fetched_at")),
        "loading": snap.get("fetched_at") is None,
        "error": snap.get("error"),
        "items": items[offset:offset + limit],
    }


@router.get("/history")
def incomplete_history(
    audience: Literal["all", "helper", "customer"] = "all",
    status: str = "all",
    include_tests: bool = False,
    q: str = "",
    offset: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = db.query(WhatsAppIncompleteReg)
    if not include_tests:
        query = query.filter(WhatsAppIncompleteReg.is_test.is_(False))
    if audience != "all":
        query = query.filter(WhatsAppIncompleteReg.audience == audience)
    rows = query.order_by(WhatsAppIncompleteReg.id.desc()).limit(5000).all()

    ledger = _ledger(db)
    summary = {"all": 0, "sent": 0, "delivered": 0, "read": 0, "failed": 0, "simulated": 0, "helper": 0, "customer": 0}
    enriched: list[dict[str, Any]] = []
    last_sent_at: datetime | None = None

    for r in rows:
        st = _delivery(r, ledger)
        m = ledger.get(r.provider_message_id or "")
        summary["all"] += 1
        if r.audience in ("helper", "customer"):
            summary[r.audience] += 1
        if st in ("sent", "delivered", "read"):
            summary["sent"] += 1
            if st in ("delivered", "read"):
                summary["delivered"] += 1
            if st == "read":
                summary["read"] += 1
        elif st in ("failed", "simulated"):
            summary[st] += 1

        if st in ("sent", "delivered", "read") and r.sent_at and (last_sent_at is None or r.sent_at > last_sent_at):
            last_sent_at = r.sent_at

        enriched.append({
            "id": r.id,
            "audience": r.audience,
            "user_id": r.user_id,
            "name": r.name,
            "phone": r.phone,
            "stage": r.stage,
            "stage_label": STAGE_LABELS.get(r.stage or "", r.stage or ""),
            "city": r.city,
            "template": r.template,
            "status": st,
            "error": (m.error if m and m.error else r.error),
            "is_test": r.is_test,
            "registered_at": iso(r.registered_at),
            "sent_at": iso(r.sent_at or r.created_at),
            "delivered_at": iso(m.delivered_at) if m else None,
            "read_at": iso(m.read_at) if m else None,
        })

    if status == "sent":
        enriched = [x for x in enriched if x["status"] in ("sent", "delivered", "read")]
    elif status != "all":
        enriched = [x for x in enriched if x["status"] == status]

    needle = q.strip().lower()
    if needle:
        enriched = [
            x for x in enriched
            if needle in " ".join(str(x.get(k) or "") for k in ("name", "phone", "city", "user_id", "stage_label")).lower()
        ]

    limit = max(1, min(limit, 200))
    return {
        "counts": summary,
        "total": len(enriched),
        "offset": offset,
        "limit": limit,
        "items": enriched[offset:offset + limit],
        "webhook_last_seen": _webhook_last_seen(db),
        "last_sent_at": iso(last_sent_at),
    }


@router.get("/commercials")
def incomplete_commercials(db: Session = Depends(get_db)) -> dict[str, Any]:
    from .commercials import _rates

    rates = _rates(db)
    msgs = db.query(WhatsAppMessage).filter(WhatsAppMessage.source == "incomplete_reg").all()
    now_ist = datetime.now(IST)
    midnight = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    starts = {
        "today": midnight,
        "week": midnight - timedelta(days=midnight.weekday()),
        "month": midnight.replace(day=1),
        "all": None,
    }

    def cost_of(m: WhatsAppMessage) -> float:
        if m.status in ("simulated", "failed") or not m.provider_message_id:
            return 0.0
        if m.billable is not None:
            return rates.rate(m.category or "marketing") if m.billable else 0.0
        return rates.rate(m.category or "marketing")

    def summarize(rows: list[WhatsAppMessage]) -> dict[str, Any]:
        live = [m for m in rows if m.status != "simulated"]
        sent = [m for m in live if m.status != "failed"]
        delivered = [m for m in sent if m.status in ("delivered", "read")]
        read = [m for m in sent if m.status == "read"]
        cost = round(sum(cost_of(m) for m in rows), 2)
        return {
            "sent": len(sent),
            "delivered": len(delivered),
            "read": len(read),
            "failed": len([m for m in live if m.status == "failed"]),
            "simulated": len(rows) - len(live),
            "cost": cost,
            "cost_per_msg": round(cost / len(sent), 2) if sent else 0.0,
            "delivery_rate": round(100 * len(delivered) / len(sent), 1) if sent else 0.0,
            "read_rate": round(100 * len(read) / len(delivered), 1) if delivered else 0.0,
        }

    periods: dict[str, Any] = {}
    for key, start in starts.items():
        cut = start.astimezone(timezone.utc).replace(tzinfo=None) if start else None
        rows = [m for m in msgs if cut is None or m.created_at >= cut]
        periods[key] = {
            "total": summarize(rows),
            "helper": summarize([m for m in rows if m.purpose == "helper_reg_pending"]),
            "customer": summarize([m for m in rows if m.purpose == "customer_reg_pending"]),
        }

    daily = []
    for d in range(29, -1, -1):
        day = midnight - timedelta(days=d)
        a = day.astimezone(timezone.utc).replace(tzinfo=None)
        b = (day + timedelta(days=1)).astimezone(timezone.utc).replace(tzinfo=None)
        rows = [m for m in msgs if a <= m.created_at < b and m.status != "simulated"]
        daily.append({
            "date": day.date().isoformat(),
            "helper": len([m for m in rows if m.purpose == "helper_reg_pending"]),
            "customer": len([m for m in rows if m.purpose == "customer_reg_pending"]),
            "cost": round(sum(cost_of(m) for m in rows), 2),
        })

    return {"periods": periods, "daily": daily, "rate_marketing": rates.marketing}


@router.post("/setup")
async def setup_templates() -> dict[str, Any]:
    """Submits both Telugu templates (`extrahand_helper_reg_pending` and `extrahand_customer_reg_pending`) to Meta."""
    client = get_meta_whatsapp_client()
    results: dict[str, Any] = {}
    for aud, cfg in TEMPLATES.items():
        existing = await _template_status(aud)  # type: ignore[arg-type]
        if existing["status"] not in ("NOT_CREATED", "REJECTED"):
            results[aud] = {"ok": True, "already": True, "status": existing["status"]}
            continue
        if existing["status"] == "REJECTED" and existing.get("id"):
            res = await client.edit_template(
                existing["id"],
                body=cfg["body"],
                examples=[cfg["example"]] if cfg["example"] else None,
            )
        else:
            res = await client.create_template(
                name=cfg["name"],
                category=cfg["category"],
                body=cfg["body"],
                language=cfg["language"],
                examples=[cfg["example"]] if cfg["example"] else None,
            )
        if not res.get("ok"):
            raise HTTPException(400, f"{aud}: {res.get('error') or 'Meta rejected template setup.'}")
        results[aud] = {"ok": True, "already": False, "status": res.get("status", "PENDING")}
    return {"ok": True, "templates": results}


@router.post("/activate")
def activate(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Activates automatic reminders for users who sign up from now on (5h after signup). Older users are ignored."""
    state = _state(db)
    if not state["active"]:
        state = _save_state(db, active=True, activated_at=utcnow().isoformat())
    # Kick off a background scan so the worker has a fresh list of signups
    _refresh_in_background()
    _last_check["at"] = 0.0
    return state


@router.post("/deactivate")
def deactivate(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _save_state(db, active=False)


@router.post("/check-now")
def check_now(db: Session = Depends(get_db)) -> dict[str, int]:
    """Runs one immediate batch scan & dispatch right away."""
    return run_incomplete_reg(db, force=True)


class TestSendBody(BaseModel):
    phone: str
    audience: Audience = "helper"
    name: str = ""


@router.post("/test")
async def send_test(body: TestSendBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Sends one test Telugu reminder to a chosen number (not counted in real analytics)."""
    phone = "".join(c for c in body.phone if c.isdigit() or c == "+")
    if len(_phone_key(phone)) < 10:
        raise HTTPException(400, "Enter a valid mobile number, e.g. +91 98765 43210.")
    cfg = TEMPLATES[body.audience]
    client = get_meta_whatsapp_client()
    if not client.simulated:
        tmpl = await client.get_template_def(cfg["name"], cfg["language"])
        if not tmpl or str(tmpl.get("status") or "").upper() != "APPROVED":
            raise HTTPException(400, f"Template '{cfg['name']}' is not approved by Meta yet. Submit it first.")

    user = {
        "id": f"test-{secrets.token_hex(6)}",
        "audience": body.audience,
        "name": body.name.strip() or ("Priya" if body.audience == "customer" else "Ravi"),
        "phone": phone,
    }
    status, mid, err = await _send_one(body.audience, user)
    row = WhatsAppIncompleteReg(
        audience=body.audience,
        user_id=user["id"],
        name=user["name"],
        phone=phone,
        phone_key=_phone_key(phone),
        stage="test",
        template=cfg["name"],
        status=status if status in ("sent", "delivered", "simulated") else "failed",
        provider_message_id=mid,
        error=(err or "")[:300] or None,
        is_test=True,
        sent_at=utcnow() if status in ("sent", "delivered", "simulated") else None,
    )
    db.add(row)
    db.commit()
    if row.status == "failed":
        raise HTTPException(400, f"WhatsApp failed to send: {row.error or status}")
    return {"ok": True, "status": row.status}
