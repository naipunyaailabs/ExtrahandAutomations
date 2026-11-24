"""Reviews & Feedback: a WhatsApp feedback form to the customer as soon as a task is completed.

The customer gets the Utility template `extrahand_service_feedback` with a "Give feedback" button that opens a
WhatsApp Flow (a form inside WhatsApp): quality of work, the helper's behaviour and punctuality (1-5 stars each)
and an optional note. Meta delivers the answers to the webhook (an `nfm_reply` message carrying our flow_token).

- Starts DEACTIVE. Activating marks every task that is already completed as "skipped", so switching it on never
  messages customers about old jobs; only tasks completed after that get the form.
- One form per task, sent inside the quiet window (the calling hours, 7:30 AM - 9:30 PM India time).
- Answers are also written to customer_feedback (the existing feedback reports), and a customer who got the form
  is not phoned for feedback as well.
"""

from __future__ import annotations

import io
import json
import logging
import re
import secrets
import time
from datetime import datetime, timedelta
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.serializers import iso
from app.config import get_settings
from app.database import SessionLocal, get_db
from app.models import AppSetting, CustomerFeedback, Ticket, WhatsAppFeedbackRequest, WhatsAppMessage, utcnow

from .meta_client import get_meta_whatsapp_client, param_text
from .metering import tagged

log = logging.getLogger("whatsapp.feedback")
router = APIRouter(prefix="/feedback", tags=["WhatsApp Feedback"])

KEY = "whatsapp_feedback"
WEBHOOK_KEY = "whatsapp_webhook_last_seen"
FLOW_NAME = "extrahand_service_feedback"
TEMPLATE = "extrahand_service_feedback"
SCREEN = "FEEDBACK"
CHECK_EVERY = 60  # seconds between looks for newly completed tasks
MAX_AGE = timedelta(days=3)  # a task scheduled longer ago than this never gets the form
_last_check = {"at": 0.0}

STARS = {
    "work": [("5", "★★★★★  Excellent"), ("4", "★★★★  Good"), ("3", "★★★  Okay"), ("2", "★★  Poor"), ("1", "★  Very poor")],
    "behaviour": [("5", "★★★★★  Excellent"), ("4", "★★★★  Good"), ("3", "★★★  Okay"), ("2", "★★  Poor"), ("1", "★  Very poor")],
    "on_time": [("5", "★★★★★  Right on time"), ("4", "★★★★  A little late"), ("3", "★★★  Late"),
                ("2", "★★  Very late"), ("1", "★  Did not come on time")],
}
LABELS = {"work": "Quality of work", "behaviour": "Helper's behaviour", "on_time": "Arrived on time"}

FLOW_JSON: dict[str, Any] = {
    "version": "6.0",
    "screens": [{
        "id": SCREEN,
        "title": "Rate your service",
        "terminal": True,
        "success": True,
        "data": {},
        "layout": {"type": "SingleColumnLayout", "children": [
            {"type": "TextSubheading", "text": "How was your ExtraHand helper?"},
            *[
                {"type": "RadioButtonsGroup", "name": key, "label": LABELS[key], "required": True,
                 "data-source": [{"id": i, "title": t} for i, t in STARS[key]]}
                for key in ("work", "behaviour", "on_time")
            ],
            {"type": "TextArea", "name": "comment", "label": "Any concerns? (optional)", "required": False},
            {"type": "Footer", "label": "Submit feedback", "on-click-action": {"name": "complete", "payload": {
                "work": "${form.work}", "behaviour": "${form.behaviour}", "on_time": "${form.on_time}",
                "comment": "${form.comment}"}}},
        ]},
    }],
}

TEMPLATE_BODY = (
    "Hi {{1}}, your ExtraHand task \"{{2}}\" done by {{3}} is complete. ✅\n\n"
    "Please rate the quality of work, the helper's behaviour and whether they arrived on time. "
    "It takes less than a minute and helps us improve."
)


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


def feedback_active(db: Session) -> bool:
    return _state(db)["active"]


# ------------------------------------------------------------------------------------------------ Meta setup

def _graph() -> tuple[str, dict[str, str], str]:
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
    base, h, _ = _graph()
    try:
        r = httpx.get(f"{base}/{flow_id}", headers=h, params={"fields": "id,name,status,validation_errors"}, timeout=15)
        if r.status_code == 200:
            d = r.json()
            return {"id": flow_id, "status": d.get("status", "UNKNOWN"), "validation_errors": d.get("validation_errors") or []}
        return {"id": flow_id, "status": "UNKNOWN", "error": _meta_error(r)}
    except httpx.HTTPError as e:
        return {"id": flow_id, "status": "UNKNOWN", "error": str(e)[:200]}


async def _template_info() -> dict[str, Any]:
    try:
        live = next((t for t in await get_meta_whatsapp_client().fetch_meta_templates() if t.get("name") == TEMPLATE), None)
    except Exception as e:  # noqa: BLE001
        return {"status": "UNKNOWN", "error": str(e)[:200]}
    if not live:
        return {"status": "NOT_CREATED"}
    return {"status": str(live.get("status", "UNKNOWN")).upper(), "category": str(live.get("category", "")).upper(),
            "rejected_reason": live.get("rejected_reason")}


@router.post("/setup")
async def setup_in_meta(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Creates and publishes the feedback form (Flow) and submits the feedback template. Safe to run again."""
    base, h, waba = _graph()
    state = _state(db)
    flow = _flow_status(state["flow_id"])
    if flow["status"] in ("NOT_CREATED", "DEPRECATED"):
        r = httpx.post(f"{base}/{waba}/flows", headers=h, json={"name": FLOW_NAME, "categories": ["SURVEY"]}, timeout=20)
        if r.status_code != 200 or not r.json().get("id"):
            raise HTTPException(400, f"Meta could not create the feedback form: {_meta_error(r)}")
        state = _save_state(db, flow_id=r.json()["id"])
        flow = {"id": state["flow_id"], "status": "DRAFT"}
    if flow["status"] == "DRAFT":
        up = httpx.post(f"{base}/{flow['id']}/assets", headers=h, data={"name": "flow.json", "asset_type": "FLOW_JSON"},
                        files={"file": ("flow.json", io.BytesIO(json.dumps(FLOW_JSON).encode()), "application/json")},
                        timeout=30)
        errors = up.json().get("validation_errors") if up.status_code == 200 else None
        if up.status_code != 200 or errors:
            raise HTTPException(400, f"Meta rejected the feedback form: {errors or _meta_error(up)}")
        pub = httpx.post(f"{base}/{flow['id']}/publish", headers=h, timeout=20)
        if pub.status_code != 200:
            raise HTTPException(400, f"Meta could not publish the feedback form: {_meta_error(pub)}")

    tmpl = await _template_info()
    if tmpl["status"] == "NOT_CREATED":
        payload = {
            "name": TEMPLATE, "category": "UTILITY", "language": "en",
            "components": [
                {"type": "BODY", "text": TEMPLATE_BODY,
                 "example": {"body_text": [["Ravi", "Ceiling Fan Replacement", "Anand"]]}},
                {"type": "FOOTER", "text": "ExtraHand"},
                {"type": "BUTTONS", "buttons": [{"type": "FLOW", "text": "Give feedback", "flow_id": state["flow_id"],
                                                 "navigate_screen": SCREEN, "flow_action": "navigate"}]},
            ],
        }
        r = httpx.post(f"{base}/{waba}/message_templates", headers=h, json=payload, timeout=20)
        if r.status_code not in (200, 201):
            raise HTTPException(400, f"Meta could not create the feedback template: {_meta_error(r)}")
        get_meta_whatsapp_client()._templates_cache = {"at": 0, "data": []}
    return await _setup_status(db)


async def _setup_status(db: Session) -> dict[str, Any]:
    state = _state(db)
    flow = _flow_status(state["flow_id"]) if state["flow_id"] else {"id": None, "status": "NOT_CREATED"}
    tmpl = await _template_info()
    return {"flow": flow, "template": tmpl, "ready": flow["status"] == "PUBLISHED" and tmpl["status"] == "APPROVED"}


# ------------------------------------------------------------------------------------------------ sending

def _first(name: str | None, fallback: str) -> str:
    first = (name or "").strip().split(" ")[0]
    return (first[:1].upper() + first[1:].lower()) if first else fallback


async def _send(req: WhatsAppFeedbackRequest) -> tuple[str, str | None, str | None]:
    components = [
        {"type": "body", "parameters": [
            {"type": "text", "text": param_text(_first(req.customer_name, "there"))},
            {"type": "text", "text": param_text(req.task_title or req.category or "service")[:120]},
            {"type": "text", "text": param_text(_first(req.helper_name, "our helper"))},
        ]},
        {"type": "button", "sub_type": "flow", "index": "0",
         "parameters": [{"type": "action", "action": {"flow_token": req.flow_token}}]},
    ]
    with tagged("automation", "feedback_request", req.ticket_id):
        resp = await get_meta_whatsapp_client().send_template_message(
            to=req.customer_phone, template_name=TEMPLATE, components=components)
    return resp.status, resp.message_id, resp.error


def _completed_tasks(db: Session):
    return (db.query(Ticket)
            .filter(func.lower(Ticket.status) == "completed",
                    or_(Ticket.scheduled_at.is_(None), Ticket.scheduled_at >= utcnow() - MAX_AGE)))


def _new_request(t: Ticket, status: str) -> WhatsAppFeedbackRequest:
    return WhatsAppFeedbackRequest(
        ticket_id=t.id, task_title=t.title, category=t.category, city=t.city, scheduled_at=t.scheduled_at,
        customer_name=t.customer_name, customer_phone=t.customer_phone, helper_id=t.assignee_id,
        helper_name=t.assignee_name, status=status, flow_token=secrets.token_hex(12),
    )


def send_request(db: Session, req: WhatsAppFeedbackRequest) -> WhatsAppFeedbackRequest:
    import asyncio

    req.status, req.error = "sending", None
    db.commit()  # claim first: a crash mid-send must not send twice
    try:
        status, mid, err = asyncio.run(_send(req))
    except Exception as e:  # noqa: BLE001
        status, mid, err = "failed", None, str(e)
    req.status = "sent" if status in ("sent", "delivered", "simulated") else "failed"
    req.provider_message_id, req.error = mid, (err or "")[:300] or None
    req.sent_at = utcnow() if req.status == "sent" else None
    db.commit()
    return req


def run_feedback(db: Session, force: bool = False) -> int:
    """Worker job: sends the feedback form for tasks completed since activation. Returns how many were sent."""
    from app.services.common import within_calling_hours

    if not feedback_active(db) or (not force and time.monotonic() - _last_check["at"] < CHECK_EVERY):
        return 0
    _last_check["at"] = time.monotonic()
    if not within_calling_hours(db):
        return 0  # quiet hours: sent when the window opens
    meta = get_meta_whatsapp_client()
    import asyncio

    tmpl = asyncio.run(meta.get_template_def(TEMPLATE))
    if not tmpl or str(tmpl.get("status", "")).upper() != "APPROVED":
        return 0  # template not approved yet: tasks wait (up to MAX_AGE)
    done = {tid for (tid,) in db.query(WhatsAppFeedbackRequest.ticket_id)}
    sent = 0
    for t in _completed_tasks(db):
        if t.id in done:
            continue
        if not t.customer_phone:
            db.add(_new_request(t, "no_phone"))
            db.commit()
            continue
        req = _new_request(t, "sending")
        db.add(req)
        db.commit()
        send_request(db, req)
        sent += int(req.status == "sent")
    return sent


# ------------------------------------------------------------------------------------------------ answers

def _stars(value: Any) -> int | None:
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 5 else None


def apply_feedback_webhook(data: dict[str, Any]) -> int:
    """Stores feedback-form answers (nfm_reply or direct text reply) from a Meta webhook.
    Also notes that the webhook is reaching us. Returns how many answers were saved. Never raises."""
    saved = 0
    try:
        with SessionLocal() as db:
            row = db.get(AppSetting, WEBHOOK_KEY) or AppSetting(key=WEBHOOK_KEY)
            row.value = utcnow().isoformat()
            db.add(row)
            for entry in data.get("entry") or []:
                for change in entry.get("changes") or []:
                    for m in (change.get("value") or {}).get("messages") or []:
                        # 1. Interactive Meta Flow reply (nfm_reply)
                        reply = ((m.get("interactive") or {}).get("nfm_reply") or {}) if m.get("type") == "interactive" else {}
                        if reply:
                            try:
                                answer = json.loads(reply.get("response_json") or "{}")
                            except ValueError:
                                answer = {}
                            if str(answer.get("flow_token") or "").startswith("cxl_"):
                                continue  # an answer to the cancellation reason form (cancel_followup.py), not feedback
                            req = None
                            if answer.get("flow_token"):
                                req = db.query(WhatsAppFeedbackRequest).filter_by(flow_token=answer.get("flow_token")).first()
                            if req is None and m.get("from"):
                                sender_digits = "".join(c for c in str(m.get("from")) if c.isdigit())[-10:]
                                req = (db.query(WhatsAppFeedbackRequest)
                                       .filter(WhatsAppFeedbackRequest.customer_phone.like(f"%{sender_digits}"),
                                               WhatsAppFeedbackRequest.status.in_(("sent", "sending")))
                                       .order_by(WhatsAppFeedbackRequest.created_at.desc()).first())
                            if req is not None and req.status != "answered":
                                req.work_rating = _stars(answer.get("work")) or 5
                                req.behaviour_rating = _stars(answer.get("behaviour")) or 5
                                req.on_time_rating = _stars(answer.get("on_time")) or 5
                                req.comment = (str(answer.get("comment") or "").strip() or None)
                                req.reply_message_id = (m.get("id") or "")[:128] or None
                                req.reply_raw = reply.get("response_json")  # the form answer exactly as Meta sent it
                                req.status, req.answered_at = "answered", utcnow()
                                _to_customer_feedback(db, req)
                                saved += 1
                                continue

                        # 2. Text message reply from customer (e.g. "5 stars", "Good service", "5", etc.)
                        text_body = ((m.get("text") or {}).get("body") or "").strip() if (m.get("type") == "text" or "text" in m) else ""
                        if text_body and m.get("from"):
                            sender_digits = "".join(c for c in str(m.get("from")) if c.isdigit())[-10:]
                            req = (db.query(WhatsAppFeedbackRequest)
                                   .filter(WhatsAppFeedbackRequest.customer_phone.like(f"%{sender_digits}"),
                                           WhatsAppFeedbackRequest.status.in_(("sent", "sending")))
                                   .order_by(WhatsAppFeedbackRequest.created_at.desc()).first())
                            if req is not None and req.status != "answered":
                                rating = 5
                                num_match = re.search(r"\b([1-5])\b", text_body)
                                if num_match:
                                    rating = int(num_match.group(1))
                                elif "★" in text_body or "⭐" in text_body:
                                    rating = min(5, max(1, text_body.count("★") + text_body.count("⭐")))
                                elif any(w in text_body.lower() for w in ("worst", "terrible", "bad", "poor", "pathetic")):
                                    rating = 1
                                elif any(w in text_body.lower() for w in ("okay", "ok", "average")):
                                    rating = 3
                                elif any(w in text_body.lower() for w in ("good", "great", "excellent", "super", "nice", "awesome", "perfect")):
                                    rating = 5

                                req.work_rating = rating
                                req.behaviour_rating = rating
                                req.on_time_rating = rating
                                req.comment = text_body
                                req.reply_message_id = (m.get("id") or "")[:128] or None
                                # a typed message, not the form: the stars above are guessed from its text
                                req.reply_raw = json.dumps({"type": "text", "text": text_body, "stars_guessed_from_text": True})
                                req.status, req.answered_at = "answered", utcnow()
                                _to_customer_feedback(db, req)
                                saved += 1
            db.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not store WhatsApp feedback answers: %s", exc)
    return saved


def _to_customer_feedback(db: Session, req: WhatsAppFeedbackRequest) -> None:
    """Mirror into customer_feedback so the existing feedback reports and complaint handling include it."""
    ratings = [r for r in (req.work_rating, req.behaviour_rating, req.on_time_rating) if r]
    avg = sum(ratings) / len(ratings) if ratings else None
    complaint = ("late_arrival" if (req.on_time_rating or 5) <= 2 else
                 "rude_behavior" if (req.behaviour_rating or 5) <= 2 else
                 "poor_service" if (req.work_rating or 5) <= 2 else "none")
    db.add(CustomerFeedback(
        ticket_id=req.ticket_id, customer_name=req.customer_name, customer_phone=req.customer_phone,
        helper_id=req.helper_id, helper_name=req.helper_name, rating=round(avg) if avg else None,
        feedback_text=req.comment, channel="whatsapp", language="en",
        sentiment="positive" if (avg or 0) >= 4 else "neutral" if (avg or 0) >= 3 else "negative",
        complaint_category=complaint, complaint_details=req.comment if complaint != "none" else None,
        resolution_status="new" if complaint != "none" else "resolved",
    ))


# ------------------------------------------------------------------------------------------------ API

def _webhook_seen(db: Session) -> str | None:
    row = db.get(AppSetting, WEBHOOK_KEY)
    if row:
        return row.value
    m = (db.query(WhatsAppMessage.created_at).filter(or_(WhatsAppMessage.direction == "in",
                                                        WhatsAppMessage.status.in_(("delivered", "read"))))
         .order_by(WhatsAppMessage.created_at.desc()).first())
    return iso(m[0]) if m else None


def _avg(values: list[int | None]) -> float | None:
    v = [x for x in values if x]
    return round(sum(v) / len(v), 2) if v else None


def _low(r: WhatsAppFeedbackRequest) -> bool:
    return any((x or 5) <= 2 for x in (r.work_rating, r.behaviour_rating, r.on_time_rating))


@router.get("/overview")
async def overview(db: Session = Depends(get_db)) -> dict[str, Any]:
    from app.services.common import calling_hours_state

    state = _state(db)
    rows = db.query(WhatsAppFeedbackRequest).all()
    count = {k: 0 for k in ("sent", "answered", "failed", "no_phone", "skipped", "sending")}
    for r in rows:
        count[r.status] = count.get(r.status, 0) + 1
    answered = [r for r in rows if r.status == "answered"]
    asked = count["sent"] + count["answered"]
    dist = {str(n): 0 for n in range(1, 6)}
    for r in answered:
        a = _avg([r.work_rating, r.behaviour_rating, r.on_time_rating])
        if a:
            dist[str(round(a))] += 1
    setup = await _setup_status(db)
    return {
        "active": state["active"],
        "since": state["since"],
        "quiet_hours": calling_hours_state(db),
        "setup": setup,
        "webhook_last_seen": _webhook_seen(db),
        "counts": {**count, "asked": asked, "low": sum(1 for r in answered if _low(r))},
        "response_rate": round(100 * count["answered"] / asked, 1) if asked else 0.0,
        "averages": {
            "work": _avg([r.work_rating for r in answered]),
            "behaviour": _avg([r.behaviour_rating for r in answered]),
            "on_time": _avg([r.on_time_rating for r in answered]),
            "overall": _avg([x for r in answered for x in (r.work_rating, r.behaviour_rating, r.on_time_rating)]),
        },
        "distribution": dist,
        "template": {"name": TEMPLATE, "body": TEMPLATE_BODY, "button": "Give feedback"},
        "form": {"questions": [{"key": k, "label": LABELS[k], "options": [t for _, t in STARS[k]]} for k in LABELS],
                 "comment_label": "Any concerns? (optional)"},
    }


Tab = Literal["all", "awaiting", "received", "low", "commented", "five_star", "not_sent", "skipped"]


@router.get("/requests")
def requests_list(tab: Tab = "all", q: str = "", offset: int = 0, limit: int = 30,
                  db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = (db.query(WhatsAppFeedbackRequest)
            .order_by(WhatsAppFeedbackRequest.answered_at.desc().nullslast(), WhatsAppFeedbackRequest.created_at.desc()).all())
    tabs = {
        "all": lambda r: r.status != "skipped",
        "awaiting": lambda r: r.status in ("sent", "sending"),
        "received": lambda r: r.status == "answered",
        "low": lambda r: r.status == "answered" and _low(r),
        "commented": lambda r: r.status == "answered" and bool(r.comment),
        "five_star": lambda r: r.status == "answered" and (_avg([r.work_rating, r.behaviour_rating, r.on_time_rating]) or 0) >= 4.5,
        "not_sent": lambda r: r.status in ("failed", "no_phone"),
        "skipped": lambda r: r.status == "skipped",
    }
    counts = {k: sum(1 for r in rows if f(r)) for k, f in tabs.items()}
    items = [r for r in rows if tabs[tab](r)]
    if q.strip():
        n = q.strip().lower()
        items = [r for r in items if n in " ".join(str(x or "") for x in (
            r.task_title, r.category, r.city, r.customer_name, r.customer_phone, r.helper_name, r.comment, r.ticket_id)).lower()]
    limit = max(1, min(limit, 100))
    return {
        "counts": counts, "total": len(items), "offset": offset, "limit": limit,
        "items": [{
            "id": r.id, "ticket_id": r.ticket_id, "task_title": r.task_title, "category": r.category, "city": r.city,
            "scheduled_at": iso(r.scheduled_at), "customer_name": r.customer_name, "customer_phone": r.customer_phone,
            "helper_name": r.helper_name, "status": r.status, "error": r.error,
            "ratings": {"work": r.work_rating, "behaviour": r.behaviour_rating, "on_time": r.on_time_rating},
            "average": _avg([r.work_rating, r.behaviour_rating, r.on_time_rating]), "low": _low(r) if r.status == "answered" else False,
            "comment": r.comment, "created_at": iso(r.created_at), "sent_at": iso(r.sent_at), "answered_at": iso(r.answered_at),
            "reply": reply_details(db, r) if r.status == "answered" else None,
        } for r in items[offset:offset + limit]],
    }


@router.post("/activate")
def activate(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Turns the automation on. Tasks already completed now are marked skipped: only new completions get the form."""
    if not feedback_active(db):
        done = {tid for (tid,) in db.query(WhatsAppFeedbackRequest.ticket_id)}
        for t in _completed_tasks(db):
            if t.id not in done:
                req = _new_request(t, "skipped")
                req.error = "Completed before the feedback automation was activated"
                db.add(req)
        _save_state(db, active=True, since=utcnow().isoformat())
    return {"active": True, "since": _state(db)["since"]}


@router.post("/deactivate")
def deactivate(db: Session = Depends(get_db)) -> dict[str, Any]:
    _save_state(db, active=False)
    return {"active": False}


@router.post("/check-now")
def check_now(db: Session = Depends(get_db)) -> dict[str, int]:
    return {"sent": run_feedback(db, force=True)}


@router.post("/send/{ticket_id}")
def send_now(ticket_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Sends (or re-sends) the feedback form for one completed task, e.g. a skipped or failed one."""
    req = db.query(WhatsAppFeedbackRequest).filter_by(ticket_id=ticket_id).first()
    if req and req.status == "answered":
        raise HTTPException(409, "This customer has already answered.")
    if req is None:
        t = db.get(Ticket, ticket_id)
        if t is None:
            raise HTTPException(404, "Task not found")
        req = _new_request(t, "sending")
        db.add(req)
        db.commit()
    if not req.customer_phone:
        raise HTTPException(400, "This task has no customer phone number.")
    send_request(db, req)
    if req.status != "sent":
        raise HTTPException(400, req.error or "Meta did not accept the message.")
    return {"ok": True, "status": req.status}


class TestReplyPayload(BaseModel):
    ticket_id: str | None = None
    phone: str | None = None
    work: int = 5
    behaviour: int = 5
    on_time: int = 5
    comment: str | None = "Excellent service, helper was punctual and did neat work!"


@router.post("/test-reply")
def test_reply(payload: TestReplyPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Simulates receiving a customer's feedback reply (useful for test runs or manual validation)."""
    q = db.query(WhatsAppFeedbackRequest)
    if payload.ticket_id:
        req = q.filter_by(ticket_id=payload.ticket_id).first()
    elif payload.phone:
        digits = "".join(c for c in payload.phone if c.isdigit())[-10:]
        req = q.filter(WhatsAppFeedbackRequest.customer_phone.like(f"%{digits}")).order_by(WhatsAppFeedbackRequest.created_at.desc()).first()
    else:
        req = q.order_by(WhatsAppFeedbackRequest.created_at.desc()).first()
    if not req:
        raise HTTPException(404, "No feedback request found")
    req.work_rating = payload.work
    req.behaviour_rating = payload.behaviour
    req.on_time_rating = payload.on_time
    req.comment = payload.comment
    req.status, req.answered_at = "answered", utcnow()
    _to_customer_feedback(db, req)
    db.commit()
    return {"ok": True, "message": "Feedback recorded", "id": req.id, "ticket_id": req.ticket_id}


# ------------------------------------------------------------------------------------------------ tasks view

IST = timedelta(hours=5, minutes=30)
STATE = {"completed": "completed", "cancelled": "cancelled", "canceled": "cancelled", "open": "open",
         "assigned": "in_progress", "started": "in_progress", "in_progress": "in_progress", "review": "in_progress"}


def _task_state(status: str | None) -> str:
    return STATE.get((status or "").lower(), "open")


def _digits(p: str | None) -> str:
    return "".join(c for c in (p or "") if c.isdigit())[-10:]


def is_real_meta_id(message_id: str | None) -> bool:
    """Meta's real message ids look like wamid.HBgM...; hand-made test webhooks use other ids."""
    return bool(message_id) and message_id.startswith("wamid.HBg") and "test" not in message_id.lower()


def reply_details(db: Session, r: WhatsAppFeedbackRequest) -> dict[str, Any]:
    """The customer's reply exactly as received: the form answer, whether it really came from WhatsApp, and any
    other WhatsApp messages the customer sent after getting the form."""
    since = r.sent_at or r.created_at
    phone = _digits(r.customer_phone)
    inbound = []
    if since and phone:
        inbound = [m for m in (db.query(WhatsAppMessage)
                               .filter(WhatsAppMessage.direction == "in",
                                       WhatsAppMessage.created_at >= since - timedelta(minutes=5))
                               .order_by(WhatsAppMessage.created_at).all()) if _digits(m.phone) == phone]
    msg_id = r.reply_message_id
    if not msg_id and r.answered_at:  # older rows: the customer's inbound message closest to the answer
        near = [m for m in db.query(WhatsAppMessage).filter(WhatsAppMessage.direction == "in").all()
                if _digits(m.phone) == phone]
        near.sort(key=lambda m: abs((m.created_at - r.answered_at).total_seconds()) if m.created_at else 1e12)
        msg_id = near[0].provider_message_id if near else None
    try:
        raw = json.loads(r.reply_raw) if r.reply_raw else None
    except ValueError:
        raw = None
    answer = None
    if r.status == "answered":
        answer = [{"key": k, "label": LABELS[k], "stars": getattr(r, f"{k}_rating"),
                   "picked": dict(STARS[k]).get(str(getattr(r, f"{k}_rating") or ""), "")}
                  for k in ("work", "behaviour", "on_time")]
    typed = bool(raw and raw.get("type") == "text")
    if raw is None and r.status == "answered" and r.comment and inbound:
        # older rows: if the customer's message text equals the comment, it was a typed reply
        typed = any((m.body or "").strip() == r.comment.strip() for m in inbound)
    return {
        "via": "text" if typed else ("form" if raw else ("unknown" if r.status == "answered" else None)),
        "stars_guessed": typed,
        "message_id": msg_id,
        "verified": is_real_meta_id(msg_id),
        "source": "whatsapp" if is_real_meta_id(msg_id) else ("test" if msg_id else "unknown"),
        "answer": answer,
        "concerns": r.comment,
        "raw": {k: v for k, v in (raw or {}).items() if k not in ("flow_token", "stars_guessed_from_text")} or None,
        "messages": [{"at": iso(m.created_at), "kind": m.kind, "text": m.body, "message_id": m.provider_message_id,
                      "verified": is_real_meta_id(m.provider_message_id)}
                     for m in inbound if not (m.body or "").startswith("Form submitted:")][-10:],
    }


def _feedback_out(r: WhatsAppFeedbackRequest | None, db: Session | None = None) -> dict[str, Any] | None:
    if r is None:
        return None
    return {"reply": reply_details(db, r) if db is not None and r.status in ("sent", "answered") else None,
            "status": r.status, "error": r.error,
            "ratings": {"work": r.work_rating, "behaviour": r.behaviour_rating, "on_time": r.on_time_rating},
            "average": _avg([r.work_rating, r.behaviour_rating, r.on_time_rating]),
            "low": r.status == "answered" and _low(r), "comment": r.comment,
            "sent_at": iso(r.sent_at), "answered_at": iso(r.answered_at)}


@router.get("/tasks")
def tasks_view(when: Literal["today", "previous", "upcoming"] = "today",
               state: Literal["all", "completed", "in_progress", "open", "cancelled"] = "all",
               fb: Literal["all", "replied", "best", "good", "worst", "awaiting", "not_asked"] = "all",
               q: str = "", offset: int = 0, limit: int = 30, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Tasks with customer details, their status and the customer's feedback, split into today / previous /
    upcoming by the task's date (India time)."""
    today = (utcnow() + IST).date()
    feedback_by_task = {r.ticket_id: r for r in db.query(WhatsAppFeedbackRequest)}
    buckets: dict[str, list[Ticket]] = {"today": [], "previous": [], "upcoming": []}
    for t in db.query(Ticket).all():
        at = t.scheduled_at or t.created_at
        d = (at + IST).date() if at else today
        buckets["today" if d == today else "previous" if d < today else "upcoming"].append(t)

    rows = buckets[when]
    # The period's feedback numbers (all its tasks, before any filter)
    funnel = {"completed": 0, "sent": 0, "received": 0, "pending": 0, "not_asked": 0, "failed": 0}
    for t in rows:
        if _task_state(t.status) != "completed":
            continue
        funnel["completed"] += 1
        r = feedback_by_task.get(t.id)
        st = r.status if r else None
        if st in ("sent", "sending", "answered"):
            funnel["sent"] += 1
        if st == "answered":
            funnel["received"] += 1
        elif st in ("sent", "sending"):
            funnel["pending"] += 1
        elif st in ("failed", "no_phone"):
            funnel["failed"] += 1
        else:
            funnel["not_asked"] += 1
    funnel["reply_rate"] = round(100 * funnel["received"] / funnel["sent"], 1) if funnel["sent"] else 0.0
    states = {k: 0 for k in ("completed", "in_progress", "open", "cancelled")}
    for t in rows:
        states[_task_state(t.status)] += 1
    if state != "all":
        rows = [t for t in rows if _task_state(t.status) == state]

    def rating_group(r: WhatsAppFeedbackRequest) -> str:
        """best = 5-4 stars, good = 3, worst = 2 and below (rounded average of the three answers)."""
        avg = round(_avg([r.work_rating, r.behaviour_rating, r.on_time_rating]) or 0)
        return "best" if avg >= 4 else "good" if avg == 3 else "worst"

    def fb_kind(t: Ticket) -> str:
        r = feedback_by_task.get(t.id)
        if r and r.status == "answered":
            return rating_group(r)
        if r and r.status in ("sent", "sending"):
            return "awaiting"
        return "not_asked" if _task_state(t.status) == "completed" else "n/a"

    fb_counts = {k: 0 for k in ("best", "good", "worst", "awaiting", "not_asked")}
    for t in rows:
        k = fb_kind(t)
        if k in fb_counts:
            fb_counts[k] += 1
    fb_counts["replied"] = fb_counts["best"] + fb_counts["good"] + fb_counts["worst"]
    fb_counts["all"] = len(rows)
    if fb == "replied":
        rows = [t for t in rows if fb_kind(t) in ("best", "good", "worst")]
    elif fb != "all":
        rows = [t for t in rows if fb_kind(t) == fb]
    if q.strip():
        n = q.strip().lower()
        rows = [t for t in rows if n in " ".join(str(x or "") for x in (
            t.title, t.category, t.city, t.address, t.customer_name, t.customer_phone, t.assignee_name, t.id)).lower()]
    rows.sort(key=lambda t: t.scheduled_at or t.created_at or utcnow(), reverse=(when == "previous"))
    limit = max(1, min(limit, 100))
    return {
        "counts": {k: len(v) for k, v in buckets.items()},
        "states": {**states, "all": sum(states.values())},
        "feedback": fb_counts,
        "funnel": funnel,
        "total": len(rows), "offset": offset, "limit": limit,
        "items": [{
            "id": t.id, "title": t.title, "category": t.category, "city": t.city, "address": t.address,
            "scheduled_at": iso(t.scheduled_at), "status": t.status, "state": _task_state(t.status), "budget": t.budget,
            "customer": {"name": t.customer_name, "phone": t.customer_phone, "email": t.customer_email},
            "helper": {"name": t.assignee_name, "phone": t.assignee_phone} if t.assignee_name else None,
            "feedback": _feedback_out(feedback_by_task.get(t.id), db),
        } for t in rows[offset:offset + limit]],
    }


@router.get("/example")
def template_example(db: Session = Depends(get_db)) -> dict[str, Any]:
    """The feedback message filled with a real recently completed task (falls back to made-up values)."""
    t = (db.query(Ticket).filter(func.lower(Ticket.status) == "completed", Ticket.customer_name.isnot(None),
                                 Ticket.assignee_name.isnot(None))
         .order_by(Ticket.scheduled_at.desc().nullslast()).first())
    values = ([_first(t.customer_name, "there"), param_text(t.title or t.category or "service"), _first(t.assignee_name, "our helper")]
              if t else ["Ravi", "Ceiling Fan Replacement", "Anand"])
    body = TEMPLATE_BODY
    for i, v in enumerate(values, 1):
        body = body.replace("{{%d}}" % i, v)
    return {
        "from_real_task": t is not None,
        "task": {"id": t.id, "title": t.title, "scheduled_at": iso(t.scheduled_at)} if t else None,
        "values": [
            {"n": "1", "label": "Customer's first name", "example": values[0]},
            {"n": "2", "label": "Task title", "example": values[1]},
            {"n": "3", "label": "Helper's first name", "example": values[2]},
        ],
        "filled_body": body,
        "raw_body": TEMPLATE_BODY,
        "footer": "ExtraHand",
        "button": "Give feedback",
    }


# ------------------------------------------------------------------------------------------------ commercials

IST_TZ = __import__("datetime").timezone(IST)


def _msg_cost(m: WhatsAppMessage, rates) -> float:
    """Meta's own billing report when it has arrived, else the template's category at the rate card."""
    if m.status in ("simulated", "failed") or not m.provider_message_id:
        return 0.0
    if m.billable is not None:
        return rates.rate(m.category or "service") if m.billable else 0.0
    return rates.rate(m.category or "utility")


@router.get("/commercials")
def feedback_commercials(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Cost and results of the feedback messages only: sent, delivered, read, replied, cost per reply."""
    from .commercials import _rates

    rates = _rates(db)
    msgs = db.query(WhatsAppMessage).filter(WhatsAppMessage.direction == "out",
                                            WhatsAppMessage.purpose == "feedback_request").all()
    replies = db.query(WhatsAppFeedbackRequest).filter(WhatsAppFeedbackRequest.status == "answered").all()
    now_ist = utcnow() + IST
    midnight = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    starts = {"today": midnight, "week": midnight - timedelta(days=midnight.weekday()),
              "month": midnight.replace(day=1), "all": None}

    def summarize(ms: list[WhatsAppMessage], rs: list[WhatsAppFeedbackRequest]) -> dict[str, Any]:
        live = [m for m in ms if m.status != "simulated"]
        sent = [m for m in live if m.status != "failed"]
        delivered = [m for m in sent if m.status in ("delivered", "read")]
        read = [m for m in sent if m.status == "read"]
        cost = round(sum(_msg_cost(m, rates) for m in ms), 2)
        n_replies = len(rs)
        groups = {"best": 0, "good": 0, "worst": 0}
        for r in rs:
            a = round(_avg([r.work_rating, r.behaviour_rating, r.on_time_rating]) or 0)
            groups["best" if a >= 4 else "good" if a == 3 else "worst"] += 1
        return {
            **groups,
            "avg_rating": _avg([x for r in rs for x in (r.work_rating, r.behaviour_rating, r.on_time_rating)]),
            "with_concerns": sum(1 for r in rs if r.comment),
            "not_charged": sum(1 for m in live if m.status == "failed"),
            "sent": len(sent), "delivered": len(delivered), "read": len(read),
            "failed": sum(1 for m in live if m.status == "failed"), "replies": n_replies,
            "low": sum(1 for r in rs if _low(r)),
            "cost": cost,
            "cost_per_message": round(cost / len(sent), 2) if sent else 0.0,
            "cost_per_reply": round(cost / n_replies, 2) if n_replies else None,
            "delivery_rate": round(100 * len(delivered) / len(sent), 1) if sent else 0.0,
            "read_rate": round(100 * len(read) / len(delivered), 1) if delivered else 0.0,
            "reply_rate": round(100 * n_replies / len(sent), 1) if sent else 0.0,
        }

    periods = {}
    for key, start in starts.items():
        cut = start - IST if start else None
        periods[key] = summarize([m for m in msgs if cut is None or m.created_at >= cut],
                                 [r for r in replies if cut is None or (r.answered_at and r.answered_at >= cut)])

    daily = []
    for d in range(29, -1, -1):
        a = midnight - timedelta(days=d) - IST
        b = a + timedelta(days=1)
        day_msgs = [m for m in msgs if a <= m.created_at < b and m.status != "simulated"]
        daily.append({
            "date": (a + IST).date().isoformat(),
            "sent": sum(1 for m in day_msgs if m.status != "failed"),
            "replies": sum(1 for r in replies if r.answered_at and a <= r.answered_at < b),
            "cost": round(sum(_msg_cost(m, rates) for m in day_msgs), 2),
        })
    return {"periods": periods, "daily": daily, "rate_utility": rates.utility, "rate_marketing": rates.marketing,
            "category": "utility"}
