"""Cancellation Follow-up: a WhatsApp message to every customer who cancels a Work, asking what went wrong.

The customer gets the Utility template `extrahand_cancel_followup`: the message in English and Telugu with their
name, and a "Tell us" button that opens a WhatsApp Flow (a form inside WhatsApp) with the reason for cancelling
(pricing / helper unavailable / changed my mind / no longer needed / other) and an optional note. Meta delivers the
answer to the webhook as an `nfm_reply` carrying our flow_token (always starting "cxl_").

- Starts DEACTIVE. Activating records the moment; only Works the customer cancels AFTER that moment get the message,
  so switching it on never messages people about old cancellations.
- Who: real customers (team-posted Works and test accounts left out) whose Work ExtraHand records as cancelled by
  the customer (user_engagement/cancellations.py), cancelled at most MAX_AGE ago, with a phone number.
- At most one message per Work, and one per customer per REPEAT_GAP (a customer who cancels three Works in a day
  gets one message). Sent inside the quiet window (the calling hours, India time), like the feedback form.
- The template and form are created in Meta with the "Set up in Meta" button; nothing is sent until Meta approves
  the template.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.database import SessionLocal, get_db
from app.models import AppSetting, WhatsAppCancelFollowup, WhatsAppMessage, utcnow

from .meta_client import get_meta_whatsapp_client, param_text
from .metering import tagged

log = logging.getLogger("whatsapp.cancel_followup")
router = APIRouter(prefix="/cancel-followup", tags=["WhatsApp Cancellation Follow-up"])

KEY = "whatsapp_cancel_followup"
TEMPLATE = "extrahand_cancel_followup"
FLOW_NAME = "extrahand_cancel_reason"
SCREEN = "CANCEL_REASON"
TOKEN_PREFIX = "cxl_"  # flow tokens of this form (the feedback webhook leaves them alone)
CHECK_EVERY = 60  # seconds between looks for new cancellations
MAX_AGE = timedelta(days=3)  # a Work cancelled longer ago than this never gets the message
REPEAT_GAP = timedelta(days=7)  # one message per customer per week at most
_last_check: dict[str, Any] = {"at": 0.0, "when": None}

# The message (Meta template body). {{1}} and {{2}} are both the customer's first name (English and Telugu part).
TEMPLATE_BODY = (
    "*English*\n"
    "Hi {{1}}! 👋\n"
    "We noticed that you recently cancelled your task on ExtraHand.\n"
    "We'd love to know what went wrong. Was there any issue or concern? How can we help you have a better experience?\n"
    "Your happiness is our priority, and we're always here to help! 💖\n\n"
    "*తెలుగు*\n"
    "నమస్కారం {{2}} గారు! 👋\n"
    "మీరు ఇటీవల ExtraHand లో బుక్ చేసిన టాస్క్‌ను క్యాన్సిల్ చేసినట్లు మేము గమనించాము.\n"
    "అసలు ఏం జరిగింది? మీకు ఏదైనా సమస్య లేదా ఇబ్బంది ఎదురైందా? మీ అనుభవాన్ని మరింత మెరుగుపరచడానికి మేము ఎలా సహాయపడగలము?\n"
    "మీ సంతృప్తే మాకు ముఖ్యం. మీకు సహాయం చేయడానికి మేము ఎల్లప్పుడూ సిద్ధంగా ఉన్నాము! 💖"
)
TEMPLATE_FOOTER = "Team ExtraHand"
BUTTON = "Tell us / చెప్పండి"  # Meta: at most 25 characters

# The form: (id, English, Telugu). Meta limits option titles to 30 characters, so Telugu is the option's description.
REASONS: list[tuple[str, str, str]] = [
    ("pricing", "Pricing issue", "ధర సమస్య"),
    ("helper_unavailable", "Helper unavailable", "హెల్పర్ అందుబాటులో లేరు"),
    ("changed_mind", "Changed my mind", "నా నిర్ణయం మార్చుకున్నాను"),
    ("not_needed", "Task no longer needed", "ఇక టాస్క్ అవసరం లేదు"),
    ("other", "Other reason", "ఇతర కారణం"),
]
REASON_LABEL = {rid: en for rid, en, _ in REASONS}
FORM = {
    "title": "Tell us why",
    "question": "What was the reason for cancellation?",
    "question_te": "మీరు టాస్క్‌ను ఎందుకు క్యాన్సిల్ చేశారు?",
    "select": "Select a reason",
    "select_te": "కారణాన్ని ఎంచుకోండి",
    "note": "Other concerns",
    "note_te": "మీ సమస్యను వివరించండి",
    "submit": "Submit / సమర్పించండి",
}
FLOW_JSON: dict[str, Any] = {
    "version": "6.0",
    "screens": [{
        "id": SCREEN,
        "title": FORM["title"],
        "terminal": True,
        "success": True,
        "data": {},
        "layout": {"type": "SingleColumnLayout", "children": [
            {"type": "TextSubheading", "text": FORM["question"]},
            {"type": "TextBody", "text": FORM["question_te"]},
            {"type": "RadioButtonsGroup", "name": "reason", "label": FORM["select"], "description": FORM["select_te"],
             "required": True, "data-source": [{"id": rid, "title": en, "description": te} for rid, en, te in REASONS]},
            {"type": "TextArea", "name": "concern", "label": FORM["note"], "helper-text": FORM["note_te"], "required": False},
            {"type": "Footer", "label": FORM["submit"], "on-click-action": {"name": "complete", "payload": {
                "reason": "${form.reason}", "concern": "${form.concern}"}}},
        ]},
    }],
}


# ------------------------------------------------------------------------------------------------ state

def _state(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, KEY)
    try:
        data = json.loads(row.value) if row else {}
    except ValueError:
        data = {}
    return {"active": bool(data.get("active")), "since": data.get("since"), "flow_id": data.get("flow_id")}


def _save_state(db: Session, **changes: Any) -> dict[str, Any]:
    state = {**_state(db), **changes}
    row = db.get(AppSetting, KEY) or AppSetting(key=KEY)
    row.value = json.dumps(state)
    db.add(row)
    db.commit()
    return state


def _utc_naive(value: Any) -> datetime | None:
    """ISO text (any offset) -> naive UTC, the way the database stores times."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


# ------------------------------------------------------------------------------------------------ Meta setup

def _graph() -> tuple[str, dict[str, str], str]:
    from app.config import get_settings

    s = get_settings()
    if not (s.meta_wa_business_account_id and s.meta_wa_access_token):
        raise HTTPException(400, "Set META_WA_BUSINESS_ACCOUNT_ID and META_WA_ACCESS_TOKEN in the backend .env.")
    return (f"https://graph.facebook.com/{s.meta_wa_api_version or 'v23.0'}",
            {"Authorization": f"Bearer {s.meta_wa_access_token}"}, s.meta_wa_business_account_id)


def _meta_error(res: httpx.Response) -> str:
    try:
        err = res.json().get("error") or {}
        return err.get("error_user_msg") or err.get("message") or res.text[:200]
    except ValueError:
        return res.text[:200]


def _flow_status(flow_id: str | None) -> dict[str, Any]:
    if not flow_id:
        return {"id": None, "status": "NOT_CREATED"}
    try:
        base, h, _ = _graph()
        r = httpx.get(f"{base}/{flow_id}", headers=h, params={"fields": "id,name,status,validation_errors"}, timeout=15)
        if r.status_code == 200:
            d = r.json()
            return {"id": flow_id, "status": d.get("status", "UNKNOWN"), "validation_errors": d.get("validation_errors") or []}
        return {"id": flow_id, "status": "UNKNOWN", "error": _meta_error(r)}
    except (httpx.HTTPError, HTTPException) as e:
        return {"id": flow_id, "status": "UNKNOWN", "error": str(getattr(e, "detail", e))[:200]}


async def _template_info() -> dict[str, Any]:
    try:
        live = next((t for t in await get_meta_whatsapp_client().fetch_meta_templates() if t.get("name") == TEMPLATE), None)
    except Exception as e:  # noqa: BLE001
        return {"status": "UNKNOWN", "error": str(e)[:200]}
    if not live:
        return {"status": "NOT_CREATED"}
    return {"status": str(live.get("status", "UNKNOWN")).upper(), "category": str(live.get("category", "")).upper(),
            "language": live.get("language"), "id": live.get("id"),
            "rejected_reason": live.get("rejected_reason") if live.get("rejected_reason") not in (None, "NONE") else None}


async def _setup_status(db: Session) -> dict[str, Any]:
    state = _state(db)
    flow = _flow_status(state["flow_id"])
    tmpl = await _template_info()
    return {"flow": flow, "template": tmpl, "ready": flow["status"] == "PUBLISHED" and tmpl["status"] == "APPROVED",
            "checked_at": iso(utcnow())}


@router.post("/setup")
async def setup_in_meta(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Creates and publishes the reason form (Flow) and submits the follow-up template for review. Safe to run again."""
    base, h, waba = _graph()
    state = _state(db)
    flow = _flow_status(state["flow_id"])
    if flow["status"] in ("NOT_CREATED", "DEPRECATED"):
        r = httpx.post(f"{base}/{waba}/flows", headers=h, json={"name": FLOW_NAME, "categories": ["SURVEY"]}, timeout=20)
        if r.status_code != 200 or not r.json().get("id"):
            raise HTTPException(400, f"Meta could not create the reason form: {_meta_error(r)}")
        state = _save_state(db, flow_id=r.json()["id"])
        flow = {"id": state["flow_id"], "status": "DRAFT"}
    if flow["status"] == "DRAFT":
        up = httpx.post(f"{base}/{flow['id']}/assets", headers=h, data={"name": "flow.json", "asset_type": "FLOW_JSON"},
                        files={"file": ("flow.json", io.BytesIO(json.dumps(FLOW_JSON).encode()), "application/json")},
                        timeout=30)
        errors = up.json().get("validation_errors") if up.status_code == 200 else None
        if up.status_code != 200 or errors:
            raise HTTPException(400, f"Meta rejected the reason form: {errors or _meta_error(up)}")
        pub = httpx.post(f"{base}/{flow['id']}/publish", headers=h, timeout=20)
        if pub.status_code != 200:
            raise HTTPException(400, f"Meta could not publish the reason form: {_meta_error(pub)}")

    tmpl = await _template_info()
    if tmpl["status"] == "NOT_CREATED":
        payload = {
            "name": TEMPLATE, "category": "UTILITY", "language": "en",
            "components": [
                {"type": "BODY", "text": TEMPLATE_BODY, "example": {"body_text": [["Priya", "Priya"]]}},
                {"type": "FOOTER", "text": TEMPLATE_FOOTER},
                {"type": "BUTTONS", "buttons": [{"type": "FLOW", "text": BUTTON, "flow_id": state["flow_id"],
                                                 "navigate_screen": SCREEN, "flow_action": "navigate"}]},
            ],
        }
        r = httpx.post(f"{base}/{waba}/message_templates", headers=h, json=payload, timeout=20)
        if r.status_code not in (200, 201):
            raise HTTPException(400, f"Meta could not create the follow-up template: {_meta_error(r)}")
        get_meta_whatsapp_client()._templates_cache = {"at": 0, "data": []}
    return await _setup_status(db)


# ------------------------------------------------------------------------------------------------ sending

def first_name(name: str | None) -> str:
    first = (name or "").strip().split(" ")[0]
    return (first[:1].upper() + first[1:]) if first else "there"


async def _send(row: WhatsAppCancelFollowup) -> tuple[str, str | None, str | None]:
    name = param_text(first_name(row.customer_name))
    components = [
        {"type": "body", "parameters": [{"type": "text", "text": name}, {"type": "text", "text": name}]},
        {"type": "button", "sub_type": "flow", "index": "0",
         "parameters": [{"type": "action", "action": {"flow_token": row.flow_token}}]},
    ]
    with tagged("automation", "cancel_followup", row.task_id):
        resp = await get_meta_whatsapp_client().send_template_message(
            to=row.customer_phone, template_name=TEMPLATE, language_code="en", components=components)
    return resp.status, resp.message_id, resp.error


def _deliver(db: Session, row: WhatsAppCancelFollowup) -> WhatsAppCancelFollowup:
    try:
        status, mid, err = asyncio.run(_send(row))
    except Exception as e:  # noqa: BLE001
        status, mid, err = "failed", None, str(e)
    row.status = "sent" if status in ("sent", "delivered", "simulated") else "failed"
    row.provider_message_id, row.error = mid, (err or "")[:300] or None
    row.sent_at = utcnow() if row.status == "sent" else None
    db.commit()
    return row


def _new_token() -> str:
    return TOKEN_PREFIX + secrets.token_hex(10)


def candidates(rows: list[dict[str, Any]], since: datetime, now: datetime) -> list[dict[str, Any]]:
    """Cancelled Works that should get the message: cancelled by the customer after `since` and within MAX_AGE,
    oldest first. `rows` are Cancelled Works rows (cancelled_at in ISO with an offset)."""
    out = []
    for r in rows:
        when = _utc_naive(r.get("cancelled_at"))
        if r.get("side") != "customer" or not when or when < since or when < now - MAX_AGE:
            continue
        out.append({**r, "_when": when})
    return sorted(out, key=lambda r: r["_when"])


def _phone_key(phone: str | None) -> str:
    return "".join(c for c in str(phone or "") if c.isdigit())[-10:]


def run_cancel_followup(db: Session, force: bool = False) -> int:
    """Worker job: messages customers who cancelled a Work since activation. Returns how many were sent.
    Cheap no-op while the switch is off."""
    from app.services.common import within_calling_hours

    state = _state(db)
    if not state["active"] or (not force and time.monotonic() - _last_check["at"] < CHECK_EVERY):
        return 0
    _last_check["at"] = time.monotonic()
    _last_check["when"] = utcnow()
    if not within_calling_hours(db):
        return 0  # quiet hours: sent when the window opens (up to MAX_AGE)
    tmpl = asyncio.run(get_meta_whatsapp_client().get_template_def(TEMPLATE))
    if not tmpl or str(tmpl.get("status", "")).upper() != "APPROVED":
        return 0  # not approved by Meta yet: cancellations wait (up to MAX_AGE)

    from user_engagement.cancellations import cancellations_summary
    from user_engagement.extrahand_data import EngagementDataUnavailable, live_enabled

    if not live_enabled():
        return 0
    try:
        data = cancellations_summary()
    except EngagementDataUnavailable as e:
        log.warning("Cancellation follow-up: ExtraHand not reachable: %s", e)
        return 0
    if not data or not data.get("rows"):
        return 0  # first read still running

    since = _utc_naive(state["since"]) or utcnow()
    now = utcnow()
    done = {tid for (tid,) in db.query(WhatsAppCancelFollowup.task_id)}
    sent = 0
    for r in candidates(data["rows"], since, now):
        if r["id"] in done:
            continue
        row = WhatsAppCancelFollowup(
            task_id=r["id"], customer_key=r.get("customer_key"), customer_name=r.get("customer_name"),
            customer_phone=r.get("customer_phone") or None, task_title=r.get("title"), category=r.get("category"),
            city=r.get("city"), cancelled_at=r["_when"], cancel_reason=r.get("reason"), flow_token=_new_token(),
            status="sending",
        )
        if not row.customer_phone:
            row.status = "no_phone"
        else:
            key = _phone_key(row.customer_phone)
            recent = (db.query(WhatsAppCancelFollowup.id)
                      .filter(WhatsAppCancelFollowup.customer_phone.like(f"%{key}"),
                              WhatsAppCancelFollowup.status.in_(("sent", "answered", "sending")),
                              WhatsAppCancelFollowup.is_test.is_(False),
                              WhatsAppCancelFollowup.created_at >= now - REPEAT_GAP).first())
            if recent:
                row.status = "skipped_repeat"
        db.add(row)
        try:
            db.commit()  # claim the Work first: a crash mid-send must not message twice
        except Exception:  # noqa: BLE001
            db.rollback()
            continue  # already claimed by another worker
        done.add(r["id"])
        if row.status != "sending":
            continue
        _deliver(db, row)
        sent += int(row.status == "sent")
        log.info("Cancellation follow-up: Work %s -> %s", row.task_id, row.status)
    return sent


# ------------------------------------------------------------------------------------------------ answers

def apply_cancel_followup_webhook(data: dict[str, Any]) -> int:
    """Stores answers to the reason form (nfm_reply whose flow_token starts with "cxl_"). Returns how many were
    saved. Never raises."""
    saved = 0
    try:
        with SessionLocal() as db:
            for entry in data.get("entry") or []:
                for change in entry.get("changes") or []:
                    for m in (change.get("value") or {}).get("messages") or []:
                        reply = ((m.get("interactive") or {}).get("nfm_reply") or {}) if m.get("type") == "interactive" else {}
                        if not reply:
                            continue
                        try:
                            answer = json.loads(reply.get("response_json") or "{}")
                        except ValueError:
                            continue
                        token = str(answer.get("flow_token") or "")
                        if not token.startswith(TOKEN_PREFIX):
                            continue
                        row = db.query(WhatsAppCancelFollowup).filter_by(flow_token=token).first()
                        if row is None or row.status == "answered":
                            continue
                        reason = str(answer.get("reason") or "").strip()
                        row.answer_reason = reason if reason in REASON_LABEL else ("other" if reason else None)
                        row.answer_note = str(answer.get("concern") or "").strip() or None
                        row.reply_raw = reply.get("response_json")
                        row.status, row.answered_at = "answered", utcnow()
                        saved += 1
            db.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not store cancellation follow-up answers: %s", exc)
    return saved


# ------------------------------------------------------------------------------------------------ API

def _ledger(db: Session) -> dict[str, WhatsAppMessage]:
    rows = db.query(WhatsAppMessage).filter(WhatsAppMessage.purpose == "cancel_followup").all()
    return {m.provider_message_id: m for m in rows if m.provider_message_id}


def _out(r: WhatsAppCancelFollowup, ledger: dict[str, WhatsAppMessage]) -> dict[str, Any]:
    m = ledger.get(r.provider_message_id or "")
    delivery = m.status if m else None  # sent | delivered | read | failed (Meta's reports)
    return {
        "id": r.id, "task_id": r.task_id, "is_test": r.is_test, "customer_name": r.customer_name,
        "customer_phone": r.customer_phone, "task_title": r.task_title, "category": r.category, "city": r.city,
        "cancelled_at": iso(r.cancelled_at), "cancel_reason": r.cancel_reason, "status": r.status,
        "delivery": delivery, "error": r.error, "sent_at": iso(r.sent_at), "answered_at": iso(r.answered_at),
        "answer_reason": r.answer_reason, "answer_reason_label": REASON_LABEL.get(r.answer_reason or ""),
        "answer_note": r.answer_note, "created_at": iso(r.created_at),
    }


def _stats(rows: list[WhatsAppCancelFollowup], ledger: dict[str, WhatsAppMessage], include_tests: bool = False) -> dict[str, Any]:
    """Results of the follow-ups (real ones; test sends too with include_tests): how many went out, reached the
    phone, were read and answered."""
    real = [r for r in rows if include_tests or not r.is_test]
    sent = [r for r in real if r.status in ("sent", "answered")]
    answered = [r for r in real if r.status == "answered"]

    def delivery(r: WhatsAppCancelFollowup) -> str:
        m = ledger.get(r.provider_message_id or "")
        return "read" if r.status == "answered" else (m.status if m else r.status)

    delivered = [r for r in sent if delivery(r) in ("delivered", "read")]
    read = [r for r in sent if delivery(r) == "read"]
    reasons = {rid: 0 for rid, _, _ in REASONS}
    for r in answered:
        if r.answer_reason in reasons:
            reasons[r.answer_reason] += 1
    return {
        "sent": len(sent), "delivered": len(delivered), "read": len(read), "answered": len(answered),
        "waiting": len(sent) - len(answered),
        "answer_rate": round(100 * len(answered) / len(sent), 1) if sent else None,
        "read_rate": round(100 * len(read) / len(sent), 1) if sent else None,
        "with_note": sum(1 for r in answered if r.answer_note),
        "failed": sum(1 for r in real if r.status == "failed"),
        "no_phone": sum(1 for r in real if r.status == "no_phone"),
        "skipped_repeat": sum(1 for r in real if r.status == "skipped_repeat"),
        "tests": sum(1 for r in rows if r.is_test and r.status in ("sent", "answered")),
        "reasons": [{"id": rid, "label": REASON_LABEL[rid], "count": reasons[rid]} for rid, _, _ in REASONS],
    }


@router.get("/overview")
async def overview(db: Session = Depends(get_db)) -> dict[str, Any]:
    """The switch, the template and form (as they look), Meta's review status, results and the latest messages."""
    from app.services.common import calling_hours_state

    state = _state(db)
    ledger = _ledger(db)
    rows = db.query(WhatsAppCancelFollowup).order_by(WhatsAppCancelFollowup.id.desc()).all()
    hours = calling_hours_state(db)
    return {
        "active": state["active"],
        "since": state["since"],
        "setup": await _setup_status(db),
        "template": {"name": TEMPLATE, "body": TEMPLATE_BODY, "footer": TEMPLATE_FOOTER, "button": BUTTON},
        "form": {**FORM, "reasons": [{"id": rid, "en": en, "te": te} for rid, en, te in REASONS]},
        "rules": {"max_age_days": MAX_AGE.days, "repeat_gap_days": REPEAT_GAP.days, "check_every_seconds": CHECK_EVERY},
        "quiet_hours": {"open": hours.get("open"), "window": hours.get("label"), "next_open": hours.get("next_open")},
        "last_check": iso(_last_check["when"]),
        "stats": _stats(rows, ledger),
        "recent": [_out(r, ledger) for r in rows[:200]],
    }


@router.get("/messages")
def messages(include_tests: bool = False, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Every follow-up message with its delivery status and the customer's answer, and the results. Reads only our
    own records (no call to Meta), so the Message Status page can refresh often."""
    state = _state(db)
    ledger = _ledger(db)
    rows = db.query(WhatsAppCancelFollowup).order_by(WhatsAppCancelFollowup.id.desc()).limit(5000).all()
    return {
        "active": state["active"],
        "since": state["since"],
        "last_check": iso(_last_check["when"]),
        "stats": _stats(rows, ledger, include_tests),
        "rows": [_out(r, ledger) for r in rows],
        "webhook_last_seen": _webhook_last_seen(db),
    }


def _webhook_last_seen(db: Session) -> str | None:
    """When Meta's webhook last reached this backend (delivery reports, read receipts and replies come that way)."""
    row = db.get(AppSetting, "whatsapp_webhook_last_seen")
    return row.value if row and row.value else None


def _costs(db: Session) -> dict[str, Any]:
    """Every follow-up send in the message ledger with what it costs: Meta's own pricing report when it has arrived
    (billable + category), otherwise the template's category rate (an estimate). Failed and simulated sends are free."""
    from .commercials import _rates

    rates = _rates(db)
    items = []
    for m in (db.query(WhatsAppMessage)
              .filter(WhatsAppMessage.direction == "out", WhatsAppMessage.purpose == "cancel_followup")
              .order_by(WhatsAppMessage.created_at.asc())):
        free = m.status in ("failed", "simulated") or not m.provider_message_id
        reported = m.billable is not None
        category = (m.category or "utility").lower()
        cost = 0.0 if free or (reported and not m.billable) else rates.rate(category)
        items.append({"at": iso(m.created_at), "cost": round(cost, 4), "category": category, "status": m.status,
                      "test": str(m.ticket_id or "").startswith("test-"), "reported": reported})
    return {"items": items, "rates": {"utility": rates.utility, "marketing": rates.marketing}}


REPLY_WINDOW = timedelta(days=7)  # typed WhatsApp messages from the customer this long after the follow-up count as replies


@router.get("/replies")
def replies(include_tests: bool = False, db: Session = Depends(get_db)) -> dict[str, Any]:
    """One conversation per follow-up message: what we sent, the customer's form answer, and anything they typed
    back on WhatsApp (incoming messages from the same number within REPLY_WINDOW of the follow-up, up to the next
    follow-up to that number). Reads only our own records."""
    ledger = _ledger(db)
    q = db.query(WhatsAppCancelFollowup).filter(WhatsAppCancelFollowup.status.in_(("sent", "answered")))
    if not include_tests:
        q = q.filter(WhatsAppCancelFollowup.is_test.is_(False))
    rows = q.order_by(WhatsAppCancelFollowup.sent_at.asc()).all()
    starts = [r.sent_at or r.created_at for r in rows]
    inbound: dict[str, list[WhatsAppMessage]] = {}
    if rows:
        for m in (db.query(WhatsAppMessage)
                  .filter(WhatsAppMessage.direction == "in", WhatsAppMessage.created_at >= min(starts))
                  .order_by(WhatsAppMessage.created_at.asc())):
            if (m.kind or "").startswith("interactiv"):
                continue  # the form answer itself ("interactive", cut to 10 characters): shown from the follow-up row
            inbound.setdefault(_phone_key(m.phone), []).append(m)

    # each typed message belongs to the latest follow-up sent to that number before it
    by_phone: dict[str, list[WhatsAppCancelFollowup]] = {}
    for r in rows:
        by_phone.setdefault(_phone_key(r.customer_phone), []).append(r)
    out = []
    for r in rows:
        key = _phone_key(r.customer_phone)
        start = r.sent_at or r.created_at
        later = [x.sent_at or x.created_at for x in by_phone.get(key, []) if (x.sent_at or x.created_at) > start]
        end = min([start + REPLY_WINDOW, *later])
        texts = [m for m in inbound.get(key, []) if start <= m.created_at < end]
        answered = r.status == "answered"
        times = [t for t in [r.answered_at, *(m.created_at for m in texts)] if t]
        out.append({
            **_out(r, ledger),
            "texts": [{"id": m.id, "at": iso(m.created_at), "text": m.body or f"[{m.kind}]", "kind": m.kind} for m in texts],
            "replied": answered or bool(texts),
            "last_activity": iso(max(times) if times else start),
        })
    out.sort(key=lambda c: c["last_activity"] or "", reverse=True)
    return {
        # customers who cancelled but were not messaged (failed, no phone, already messaged this week, sending)
        "not_sent": [_out(r, ledger) for r in (
            db.query(WhatsAppCancelFollowup)
            .filter(WhatsAppCancelFollowup.status.notin_(("sent", "answered")),
                    *([] if include_tests else [WhatsAppCancelFollowup.is_test.is_(False)]))
            .order_by(WhatsAppCancelFollowup.id.desc()).limit(2000).all())],
        "costs": _costs(db),
        "webhook_last_seen": _webhook_last_seen(db),
        "counts": {
            "all": len(out),
            "replied": sum(1 for c in out if c["replied"]),
            "form": sum(1 for c in out if c["status"] == "answered"),
            "typed": sum(1 for c in out if c["texts"]),
            "no_reply": sum(1 for c in out if not c["replied"]),
        },
        "reply_window_days": REPLY_WINDOW.days,
        "conversations": out,
    }


@router.post("/activate")
def activate(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Turns the follow-up on. Only Works cancelled from now on get the message."""
    state = _state(db)
    if not state["active"]:
        state = _save_state(db, active=True, since=utcnow().isoformat())
    return {"active": state["active"], "since": state["since"]}


@router.post("/deactivate")
def deactivate(db: Session = Depends(get_db)) -> dict[str, Any]:
    state = _save_state(db, active=False)
    return {"active": state["active"], "since": state["since"]}


@router.post("/check-now")
def check_now(db: Session = Depends(get_db)) -> dict[str, int]:
    """Looks for new cancellations right away instead of waiting for the next minute."""
    return {"sent": run_cancel_followup(db, force=True)}


class TestSend(BaseModel):
    phone: str
    name: str = ""


@router.post("/test")
async def send_test(body: TestSend, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Sends the follow-up to one number (e.g. your own) to see it in WhatsApp. Works while the switch is off;
    needs the template approved by Meta. Test sends are not counted in the results."""
    phone = "".join(c for c in body.phone if c.isdigit() or c == "+")
    if len(_phone_key(phone)) < 10:
        raise HTTPException(400, "Enter a full mobile number, e.g. +91 98765 43210.")
    tmpl = await get_meta_whatsapp_client().get_template_def(TEMPLATE)
    if not tmpl or str(tmpl.get("status", "")).upper() != "APPROVED":
        raise HTTPException(400, "Meta has not approved the template yet. Use \"Set up in Meta\" and wait for approval.")
    row = WhatsAppCancelFollowup(task_id=f"test-{secrets.token_hex(6)}", is_test=True, customer_name=body.name.strip() or None,
                                 customer_phone=phone, task_title="Test message", flow_token=_new_token(), status="sending")
    db.add(row)
    db.commit()
    status, mid, err = await _send(row)
    row.status = "sent" if status in ("sent", "delivered", "simulated") else "failed"
    row.provider_message_id, row.error = mid, (err or "")[:300] or None
    row.sent_at = utcnow() if row.status == "sent" else None
    db.commit()
    if row.status != "sent":
        raise HTTPException(400, f"WhatsApp did not send it: {row.error or status}")
    return {"ok": True, "status": status}
