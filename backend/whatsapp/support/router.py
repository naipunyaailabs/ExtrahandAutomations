"""/api/whatsapp/support/*: the WhatsApp Support pages (Customer Engagement → WhatsApp Support)."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AppSetting, Escalation, WaSupportConversation, WaSupportMessage, utcnow

from . import agent as support_agent
from . import customer_data
from . import intents as intent_rules
from . import language as lang_rules
from . import settings as support_settings
from . import tickets, webhook

router = APIRouter(prefix="/support", tags=["WhatsApp Support"])
IST = timezone(timedelta(hours=5, minutes=30))


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def _period_starts() -> dict[str, datetime | None]:
    midnight = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    starts = {"today": midnight, "week": midnight - timedelta(days=midnight.weekday()), "month": midnight.replace(day=1)}
    out: dict[str, datetime | None] = {k: v.astimezone(timezone.utc).replace(tzinfo=None) for k, v in starts.items()}
    out["all"] = None
    return out


# ------------------------------------------------------------------------------------------------ settings / status
class SettingsIn(BaseModel):
    active: bool | None = None
    test_mode: bool | None = None
    test_numbers: list[str] | str | None = None
    notify_care: bool | None = None


@router.get("/settings")
def get_settings_(db: Session = Depends(get_db)) -> dict[str, Any]:
    return {**support_settings.get(db), **_health(db)}


@router.post("/settings")
def save_settings(body: SettingsIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    return {**support_settings.save(db, body.model_dump()), **_health(db)}


def _health(db: Session) -> dict[str, Any]:
    s = get_settings()
    row = db.get(AppSetting, "whatsapp_webhook_last_seen")
    from whatsapp.meta_client import get_meta_whatsapp_client

    meta = get_meta_whatsapp_client()
    return {"health": {
        "ai_configured": support_agent.configured(), "ai_model": s.openrouter_model,
        "whatsapp_configured": bool(meta.is_configured), "whatsapp_simulated": bool(meta.simulated),
        "signature_check": webhook.signature_checked(),
        "extrahand_live": s.extrahand_mode == "live",
        "webhook_last_seen": row.value if row and row.value else None,
    }}


# ------------------------------------------------------------------------------------------------ dashboard
@router.get("/overview")
def overview(include_tests: bool = False, db: Session = Depends(get_db)) -> dict[str, Any]:
    convs = {c.id: c for c in db.query(WaSupportConversation).all() if include_tests or not c.is_test}
    msgs = [m for m in db.query(WaSupportMessage).all() if m.conversation_id in convs]
    cases = [e for e in db.query(Escalation).filter(Escalation.source.in_(["whatsapp", "whatsapp_test"])).all()
             if e.conversation_id in convs]
    periods: dict[str, Any] = {}
    for key, start in _period_starts().items():
        mm = [m for m in msgs if start is None or m.created_at >= start]
        cc = [e for e in cases if start is None or e.created_at >= start]
        inbound = [m for m in mm if m.direction == "in"]
        talked = {m.conversation_id for m in inbound}
        handed = {e.conversation_id for e in cc}
        ai_out = [m for m in mm if m.sender == "ai"]
        periods[key] = {
            "conversations": len(talked),
            "customers": len({convs[c].phone for c in talked if convs[c].customer_id}),
            "messages_in": len(inbound),
            "ai_replies": len(ai_out),
            "team_replies": sum(1 for m in mm if m.sender == "human"),
            "solved_by_ai": len(talked - handed),
            "handed_to_team": len(handed & talked) if talked else len(handed),
            "cases": len(cc),
            "ai_share": round(100 * len(talked - handed) / len(talked)) if talked else None,
            "ai_cost_usd": round(sum(m.llm_cost or 0 for m in ai_out), 4),
            "failed_sends": sum(1 for m in mm if m.direction == "out" and m.status == "failed"),
        }
    inbound_all = [m for m in msgs if m.direction == "in"]
    langs = Counter(m.language or "en" for m in inbound_all)
    intents = Counter(m.intent for m in inbound_all if m.intent)
    # how long the agent took to answer (AI time per reply)
    times = [m.llm_ms for m in msgs if m.sender == "ai" and m.llm_ms]
    cats = Counter(e.category or "other" for e in cases)
    days: dict[str, dict[str, int]] = {}
    since = (datetime.now(IST) - timedelta(days=29)).date()
    for m in inbound_all:
        d = m.created_at.replace(tzinfo=timezone.utc).astimezone(IST).date()
        if d >= since:
            days.setdefault(d.isoformat(), {"messages": 0, "cases": 0})["messages"] += 1
    for e in cases:
        d = e.created_at.replace(tzinfo=timezone.utc).astimezone(IST).date()
        if d >= since:
            days.setdefault(d.isoformat(), {"messages": 0, "cases": 0})["cases"] += 1
    return {
        "periods": periods,
        "languages": [{"key": k, "label": lang_rules.LABELS.get(k, k), "count": v} for k, v in langs.most_common()],
        "intents": [{"key": k, "label": intent_rules.LABELS.get(k, k), "count": v} for k, v in intents.most_common(10)],
        "case_categories": [{"key": k, "label": tickets.CATEGORIES.get(k, k), "count": v} for k, v in cats.most_common()],
        "avg_ai_ms": round(sum(times) / len(times)) if times else None,
        "open_now": {
            "with_team": sum(1 for c in convs.values() if c.mode == "human" and c.status == "open"),
            "waiting_yes": sum(1 for c in convs.values() if c.pending_action),
            "open_cases": sum(1 for e in cases if e.status != "resolved"),
        },
        "days": [{"day": d, **v} for d, v in sorted(days.items())],
        **_health(db),
        "settings": support_settings.get(db),
    }


# ------------------------------------------------------------------------------------------------ conversations
def _conv_out(c: WaSupportConversation, last: WaSupportMessage | None = None, unread: int = 0) -> dict[str, Any]:
    return {
        "id": c.id, "phone": c.phone.lstrip("t"), "is_test": c.is_test, "customer_name": c.customer_name,
        "customer_id": c.customer_id, "language": c.language, "language_label": lang_rules.LABELS.get(c.language or "", None),
        "mode": c.mode, "status": c.status, "assigned_to": c.assigned_to, "last_intent": c.last_intent,
        "last_intent_label": intent_rules.LABELS.get(c.last_intent or "", None), "escalation_id": c.escalation_id,
        "waiting_yes": bool(c.pending_action), "last_message_at": _iso(c.last_message_at), "created_at": _iso(c.created_at),
        "last_message": ({"text": last.text[:160], "sender": last.sender, "at": _iso(last.created_at)} if last else None),
        "messages_since_reply": unread,
    }


@router.get("/conversations")
def list_conversations(status: str | None = None, mode: str | None = None, q: str | None = None,
                       include_tests: bool = False, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    query = db.query(WaSupportConversation)
    if status:
        query = query.filter(WaSupportConversation.status == status)
    if mode:
        query = query.filter(WaSupportConversation.mode == mode)
    if not include_tests:
        query = query.filter(WaSupportConversation.is_test.is_(False))
    convs = query.order_by(WaSupportConversation.last_message_at.desc()).limit(300).all()
    if q:
        ql = q.strip().lower()
        convs = [c for c in convs if ql in (c.customer_name or "").lower() or ql in c.phone]
    out = []
    for c in convs:
        rows = (db.query(WaSupportMessage).filter(WaSupportMessage.conversation_id == c.id)
                .order_by(WaSupportMessage.id.desc()).limit(20).all())
        unread = 0
        for m in rows:
            if m.direction == "out":
                break
            unread += 1
        out.append(_conv_out(c, rows[0] if rows else None, unread))
    return out


def _msg_out(m: WaSupportMessage) -> dict[str, Any]:
    return {"id": m.id, "direction": m.direction, "sender": m.sender, "text": m.text, "status": m.status,
            "language": m.language, "intent": m.intent, "intent_label": intent_rules.LABELS.get(m.intent or "", None),
            "action": m.action, "error": m.error, "author": m.author, "llm_ms": m.llm_ms, "llm_cost": m.llm_cost,
            "created_at": _iso(m.created_at)}


def _get_conv(db: Session, conv_id: int) -> WaSupportConversation:
    c = db.get(WaSupportConversation, conv_id)
    if not c:
        raise HTTPException(404, "Conversation not found")
    return c


@router.get("/conversations/{conv_id}")
def conversation(conv_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    c = _get_conv(db, conv_id)
    msgs = (db.query(WaSupportMessage).filter(WaSupportMessage.conversation_id == c.id)
            .order_by(WaSupportMessage.id.asc()).all())
    cases = (db.query(Escalation).filter(Escalation.conversation_id == c.id).order_by(Escalation.id.desc()).all())
    snap = customer_data.snapshot(c.phone, refresh_open=False)
    return {
        **_conv_out(c, msgs[-1] if msgs else None),
        "messages": [_msg_out(m) for m in msgs],
        "cases": [{"id": e.id, "category": e.category, "category_label": tickets.CATEGORIES.get(e.category or "", e.reason),
                   "status": e.status, "outcome": e.outcome, "booking_id": e.booking_id, "assigned_to": e.assigned_to,
                   "created_at": _iso(e.created_at)} for e in cases],
        "customer": {k: v for k, v in snap.items() if k != "customer_ids"},
        "window_open": webhook.window_open(db, c),
    }


class ReplyIn(BaseModel):
    text: str
    by: str | None = None


@router.post("/conversations/{conv_id}/reply")
def team_reply(conv_id: int, body: ReplyIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    c = _get_conv(db, conv_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Type a message.")
    if c.mode != "human":
        c.mode, c.assigned_to = "human", (body.by or c.assigned_to)
    m = webhook.send_team_reply(db, c, text, body.by)
    return _msg_out(m)


class ByIn(BaseModel):
    by: str | None = None


@router.post("/conversations/{conv_id}/takeover")
def takeover(conv_id: int, body: ByIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    c = _get_conv(db, conv_id)
    c.mode, c.status = "human", "open"
    c.assigned_to = (body.by or "").strip()[:120] or c.assigned_to
    c.pending_action = None
    db.add(WaSupportMessage(conversation_id=c.id, direction="out", sender="system", status="note",
                            text=f"{c.assigned_to or 'The team'} took over the conversation. The AI is paused."))
    db.commit()
    return _conv_out(c)


@router.post("/conversations/{conv_id}/handback")
def handback(conv_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    c = _get_conv(db, conv_id)
    c.mode = "ai"
    db.add(WaSupportMessage(conversation_id=c.id, direction="out", sender="system", status="note",
                            text="Handed back to the AI agent."))
    db.commit()
    return _conv_out(c)


@router.post("/conversations/{conv_id}/close")
def close(conv_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    c = _get_conv(db, conv_id)
    c.status, c.mode, c.pending_action = "closed", "ai", None
    db.add(WaSupportMessage(conversation_id=c.id, direction="out", sender="system", status="note",
                            text="Conversation closed. A new message from the customer opens it again with the AI."))
    db.commit()
    return _conv_out(c)


# ------------------------------------------------------------------------------------------------ cases
@router.get("/cases")
def cases(include_tests: bool = False, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    sources = ["whatsapp", "whatsapp_test"] if include_tests else ["whatsapp"]
    rows = db.query(Escalation).filter(Escalation.source.in_(sources)).order_by(Escalation.id.desc()).limit(500).all()
    return [{
        "id": e.id, "category": e.category, "category_label": tickets.CATEGORIES.get(e.category or "", e.reason),
        "status": e.status, "outcome": e.outcome, "customer_name": e.customer_name,
        "customer_phone": (e.customer_phone or "").lstrip("t"), "booking_id": e.booking_id,
        "assigned_to": e.assigned_to, "details": e.details, "notes": e.notes, "conversation_id": e.conversation_id,
        "is_test": e.source == "whatsapp_test", "created_at": _iso(e.created_at), "resolved_at": _iso(e.resolved_at),
    } for e in rows]


# ------------------------------------------------------------------------------------------------ tester
class TestIn(BaseModel):
    phone: str
    text: str


@router.post("/test-chat")
def test_chat(body: TestIn) -> dict[str, Any]:
    """Chats as the customer with this number inside the app: the real agent and data, nothing sent on WhatsApp."""
    phone = support_settings.digits(body.phone)
    if len(phone) < 10:
        raise HTTPException(400, "Enter the customer's 10-digit phone number.")
    if not body.text.strip():
        raise HTTPException(400, "Type a message.")
    result = webhook.process_message(phone, body.text.strip(), send=False, is_test=True)
    return result


@router.post("/test-chat/reset")
def test_reset(body: TestIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    phone = support_settings.digits(body.phone)
    phone = ("91" + phone) if len(phone) == 10 else phone
    c = db.query(WaSupportConversation).filter(WaSupportConversation.phone == "t" + phone).first()
    if c:
        db.query(WaSupportMessage).filter(WaSupportMessage.conversation_id == c.id).delete()
        c.pending_action, c.mode, c.status, c.language = None, "ai", "open", None
        c.last_message_at = utcnow()
        db.commit()
    return {"ok": True}


@router.get("/test-chat")
def test_history(phone: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    p = support_settings.digits(phone)
    p = ("91" + p) if len(p) == 10 else p
    c = db.query(WaSupportConversation).filter(WaSupportConversation.phone == "t" + p).first()
    if not c:
        return {"conversation_id": None, "messages": [], "mode": "ai"}
    msgs = db.query(WaSupportMessage).filter(WaSupportMessage.conversation_id == c.id).order_by(WaSupportMessage.id).all()
    return {"conversation_id": c.id, "messages": [_msg_out(m) for m in msgs], "mode": c.mode}
