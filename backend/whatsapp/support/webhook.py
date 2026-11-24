"""Incoming WhatsApp messages for the support agent.

From /api/whatsapp/webhook (whatsapp/router.py) every text message is checked here:
- signature: Meta signs each call with the app secret (META_APP_SECRET); a call with a wrong signature is refused
- routing: only when WhatsApp Support is on (and, in test mode, from a test number); helpers who are not customers
  keep the existing work-order flows; STOP stays with the opt-out handling; form answers stay with their flows
- duplicates: Meta may deliver a message twice; the message id is stored once (unique), a repeat is ignored
- the reply is made in a background thread so Meta gets its 200 at once; one thread per number at a time

process_message() is the whole pipeline (also used by the in-app tester with send=False)."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import threading
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import Helper, WaSupportConversation, WaSupportMessage, utcnow

from . import agent as support_agent
from . import customer_data
from . import language as lang_rules
from . import settings as support_settings
from . import tickets
from .settings import digits, phone_key

logger = logging.getLogger("whatsapp.support")

PENDING_MINUTES = 30  # a cancel / reschedule waiting for YES expires after this
MAX_AGE_MINUTES = 60  # older messages (Meta re-delivering after an outage) get no reply
STOP_WORDS = {"stop", "unsubscribe", "stop all", "opt out", "optout"}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _spawn(fn: Callable[..., Any], *args: Any) -> None:
    threading.Thread(target=fn, args=args, daemon=True, name="wa-support").start()


SPAWN: Callable[..., None] = _spawn  # tests run the pipeline inline


# ------------------------------------------------------------------------------------------------ signature
def signature_ok(raw: bytes, header: str | None) -> bool:
    """True when META_APP_SECRET is not set (nothing to check) or the X-Hub-Signature-256 header matches."""
    secret = get_settings().meta_app_secret.strip()
    if not secret:
        return True
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.split("=", 1)[1].strip())


def signature_checked() -> bool:
    return bool(get_settings().meta_app_secret.strip())


# ------------------------------------------------------------------------------------------------ routing
def _lock(phone: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(phone_key(phone), threading.Lock())


def _is_helper(db: Session, phone: str) -> bool:
    key = phone_key(phone)
    return bool(key) and db.query(Helper).filter((Helper.phone.like(f"%{key}")) | (Helper.alt_phone.like(f"%{key}"))).first() is not None


def handle_webhook(data: dict) -> int:
    """Takes the text messages in a Meta webhook call for the support agent. Returns how many were taken."""
    taken = 0
    for entry in data.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in value.get("contacts") or []}
            for msg in value.get("messages") or []:
                if msg.get("type") != "text":
                    continue  # buttons, form answers (nfm_reply), media: handled by their own flows
                text = ((msg.get("text") or {}).get("body") or "").strip()
                phone = digits(msg.get("from"))
                if not text or not phone or text.lower() in STOP_WORDS:
                    continue
                try:
                    ts = int(msg.get("timestamp") or 0)
                except ValueError:
                    ts = 0
                if ts and (utcnow().timestamp() - ts) > MAX_AGE_MINUTES * 60:
                    continue
                with SessionLocal() as db:
                    if not support_settings.may_answer(db, phone):
                        continue
                SPAWN(_process_safely, phone, text, msg.get("id"), names.get(msg.get("from")))
                taken += 1
    return taken


def _process_safely(phone: str, text: str, wamid: str | None, profile_name: str | None) -> None:
    try:
        process_message(phone, text, wamid=wamid, profile_name=profile_name)
    except Exception:  # noqa: BLE001
        logger.exception("[WhatsApp Support] failed to answer +%s", phone)


# ------------------------------------------------------------------------------------------------ pipeline
def _conversation(db: Session, phone: str, is_test: bool) -> WaSupportConversation:
    conv = db.query(WaSupportConversation).filter(WaSupportConversation.phone == phone).first()
    if conv:
        return conv
    conv = WaSupportConversation(phone=phone, is_test=is_test)
    db.add(conv)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        conv = db.query(WaSupportConversation).filter(WaSupportConversation.phone == phone).one()
    return conv


def _history(db: Session, conv: WaSupportConversation) -> list[dict]:
    rows = (db.query(WaSupportMessage).filter(WaSupportMessage.conversation_id == conv.id)
            .order_by(WaSupportMessage.id.desc()).limit(14).all())
    return [{"sender": m.sender, "text": m.text} for m in reversed(rows)][:-1]  # without the message being answered


def _pending(conv: WaSupportConversation) -> dict | None:
    if not conv.pending_action:
        return None
    try:
        p = json.loads(conv.pending_action)
    except ValueError:
        return None
    asked = p.get("asked_at")
    if asked and utcnow().timestamp() - float(asked) > PENDING_MINUTES * 60:
        return None
    return p


def _open_list(snap: dict) -> str:
    rows = [b for b in snap.get("bookings") or [] if customer_data.can_cancel(b)[0]]
    return "\n".join(f"• {b.get('service') or b.get('category')} ({b.get('scheduled_date') or b.get('booked_on') or ''}) "
                     f"– ID {b.get('booking_ref') or b['booking_id']}" for b in rows[:5]) or "-"


def process_message(phone: str, text: str, wamid: str | None = None, profile_name: str | None = None,
                    send: bool = True, is_test: bool = False) -> dict[str, Any]:
    """Stores the customer's message, makes the reply (AI + safe actions) and sends it. Returns what happened."""
    phone = digits(phone)
    if len(phone) == 10:
        phone = "91" + phone
    with _lock(phone), SessionLocal() as db:
        if wamid and db.query(WaSupportMessage.id).filter(WaSupportMessage.wamid == wamid).first():
            return {"skipped": "duplicate"}
        snap = None
        if send and _is_helper(db, phone):
            snap = customer_data.snapshot(phone)
            if not snap["found"]:
                return {"skipped": "helper"}  # a helper: the work-order flows answer them
        # the in-app tester keeps its own conversation ("t" + number), apart from the customer's real one
        conv = _conversation(db, ("t" + phone) if is_test else phone, is_test)
        inbound = WaSupportMessage(conversation_id=conv.id, direction="in", sender="customer", text=text[:4000],
                                   wamid=wamid, status="received", language=lang_rules.detect(text))
        db.add(inbound)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return {"skipped": "duplicate"}
        if conv.status == "closed":
            conv.status, conv.mode = "open", "ai"
        conv.last_message_at = utcnow()
        if conv.mode == "human":
            db.commit()
            return {"skipped": "human", "conversation_id": conv.id}

        snap = snap or customer_data.snapshot(phone)
        if snap.get("customer"):
            conv.customer_name = snap["customer"].get("name") or conv.customer_name
        conv.customer_name = conv.customer_name or profile_name
        conv.customer_id = (snap.get("customer_ids") or [conv.customer_id])[0] if snap.get("customer_ids") else conv.customer_id
        db.commit()

        pending = _pending(conv)
        if not pending:
            conv.pending_action = None
        lang = conv.language or inbound.language or "en"
        answer = lang_rules.yes_or_no(text) if pending else None
        if pending and answer:
            result = _confirm(db, conv, snap, pending, answer, lang)
        else:
            result = _agent_turn(db, conv, snap, text, pending)

        inbound.language, inbound.intent = result["language"], result["intent"]
        conv.language, conv.last_intent = result["language"], result["intent"]
        out = WaSupportMessage(conversation_id=conv.id, direction="out", sender="ai", text=result["reply"],
                               language=result["language"], intent=result["intent"], action=result["action"],
                               llm_ms=result.get("llm_ms"), llm_tokens=result.get("llm_tokens"),
                               llm_cost=result.get("llm_cost"), error=result.get("error"))
        db.add(out)
        conv.last_message_at = utcnow()
        db.commit()
        out.status, out.wamid = _send(phone, result["reply"], send)
        db.commit()
        return {**result, "conversation_id": conv.id, "message_id": out.id, "status": out.status}


def _agent_turn(db: Session, conv: WaSupportConversation, snap: dict, text: str, pending: dict | None) -> dict[str, Any]:
    r = support_agent.respond(text, snap, _history(db, conv), pending, conv.language)
    reply, action, case = r.reply, r.action, None
    booking = customer_data.owned_booking(snap, r.booking_id)

    if action in ("confirm_cancel", "confirm_reschedule") and snap.get("found"):
        what = "cancel_request" if action == "confirm_cancel" else "reschedule_request"
        if not booking:
            open_ = [b for b in snap.get("bookings") or [] if customer_data.can_cancel(b)[0]]
            booking = open_[0] if len(open_) == 1 else None
        ok, why = customer_data.can_cancel(booking) if booking else (False, "")
        if not booking:
            reply, action = support_agent.text_for(r.language, "which", list=_open_list(snap)), "ask_booking"
        elif not ok:
            verb = "cancelled" if what == "cancel_request" else "rescheduled"
            reply, action = support_agent.text_for(r.language, "not_possible", why=why, what=verb), "not_possible"
        elif what == "reschedule_request" and not r.new_time:
            action = "none"  # the AI is still asking for the new date / time
        else:
            conv.pending_action = json.dumps({
                "type": what, "booking_id": booking["booking_id"], "service": booking.get("service") or booking.get("category"),
                "new_time": r.new_time, "reason": r.reason, "summary": r.summary, "asked_at": utcnow().timestamp(),
            }, ensure_ascii=False)
            hint = support_agent.text_for(r.language, "confirm_hint")
            if "YES" not in reply:
                reply = f"{reply}\n\n{hint}"
    elif action in ("confirm_cancel", "confirm_reschedule"):
        action = "none"  # no account: nothing to cancel
    elif action == "create_ticket":
        category = r.category if r.category in tickets.CATEGORIES else "other"
        case = tickets.create_case(db, conv, category, r.summary or text, booking)
    elif action == "handover":
        category = r.category if r.category in tickets.CATEGORIES else "human_request"
        case = tickets.create_case(db, conv, category, r.summary or text, booking)
        conv.mode = "human"  # a person answers from now on (Conversations page: Hand back to AI)
    if "{case}" in reply:
        reply = reply.replace("{case}", str(case.id) if case else "-")
    return {"reply": reply, "language": r.language, "intent": r.intent, "action": action,
            "case_id": case.id if case else None, "used_ai": r.used_ai, "llm_ms": r.llm_ms,
            "llm_tokens": r.llm_tokens, "llm_cost": r.llm_cost, "error": r.error}


def _confirm(db: Session, conv: WaSupportConversation, snap: dict, pending: dict, answer: str, lang: str) -> dict[str, Any]:
    """The customer answered YES / NO to a cancel or reschedule request."""
    conv.pending_action = None
    intent = pending["type"]
    if answer == "no":
        return {"reply": support_agent.text_for(lang, "declined"), "language": lang, "intent": intent,
                "action": "declined", "case_id": None}
    booking = customer_data.owned_booking(snap, pending.get("booking_id"))
    if not booking or not customer_data.can_cancel(booking)[0]:  # it changed meanwhile, or is not theirs
        return {"reply": support_agent.text_for(lang, "not_possible", why="no longer open", what="changed"),
                "language": lang, "intent": intent, "action": "not_possible", "case_id": None}
    details = {"reason": pending.get("reason")} if intent == "cancel_request" else {"new date / time asked": pending.get("new_time")}
    details["confirmed by the customer"] = "YES on WhatsApp"
    case = tickets.create_case(db, conv, intent, pending.get("summary") or intent.replace("_", " "), booking, details)
    key = "cancel_sent" if intent == "cancel_request" else "reschedule_sent"
    reply = support_agent.text_for(lang, key, service=pending.get("service") or "your booking", case=case.id,
                                   new_time=pending.get("new_time") or "")
    return {"reply": reply, "language": lang, "intent": intent, "action": intent, "case_id": case.id}


def _send(phone: str, text: str, send: bool) -> tuple[str, str | None]:
    if not send:
        return "simulated", None
    from whatsapp.meta_client import get_meta_whatsapp_client
    from whatsapp.metering import tagged

    async def go():
        with tagged("wa_support", "support_reply"):
            return await get_meta_whatsapp_client().send_text_message(to=phone, message=text, preview_url=False)

    try:
        res = asyncio.run(go())
        return (res.status or "failed"), res.message_id
    except Exception as exc:  # noqa: BLE001
        logger.warning("[WhatsApp Support] send to +%s failed: %s", phone, exc)
        return "failed", None


def send_team_reply(db: Session, conv: WaSupportConversation, text: str, author: str | None) -> WaSupportMessage:
    """A person on the team replies from the Conversations page (allowed within 24 hours of the customer's message)."""
    msg = WaSupportMessage(conversation_id=conv.id, direction="out", sender="human", text=text[:4000],
                           author=(author or "").strip()[:120] or None)
    db.add(msg)
    conv.last_message_at = utcnow()
    db.commit()
    msg.status, msg.wamid = _send(conv.phone, text, not conv.is_test)
    if msg.status == "failed":
        msg.error = "Not sent. WhatsApp only allows free replies within 24 hours of the customer's last message."
    db.commit()
    return msg


def window_open(db: Session, conv: WaSupportConversation) -> bool:
    last_in = (db.query(WaSupportMessage.created_at).filter(WaSupportMessage.conversation_id == conv.id,
                                                            WaSupportMessage.direction == "in")
               .order_by(WaSupportMessage.id.desc()).first())
    return bool(last_in and utcnow() - last_in[0] < timedelta(hours=24))
