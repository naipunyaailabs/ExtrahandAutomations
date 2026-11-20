from datetime import datetime
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CallAttempt, DispatchRun, DispatchStatus, Escalation, Event, FollowUp, Ticket, utcnow
from ..services.common import log_event
from ..services.dispatch import DispatchError, cancel_dispatch, start_dispatch
from ..services.ivr import ACTIVE_STATUSES
from .serializers import call_out, escalation_out, event_out, followup_out, run_out, ticket_out

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


class CreateTicketPayload(BaseModel):
    title: str
    category: str
    city: str
    address: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    budget: Optional[float] = None
    scheduled_at: Optional[datetime] = None
    description: Optional[str] = None


@router.post("")
def create_ticket(payload: CreateTicketPayload, db: Session = Depends(get_db)):
    """Upload/Create a customer task. Automatically broadcasts to helpers matching location and service skills via WhatsApp."""
    ticket_id = f"cust_{uuid.uuid4().hex[:12]}"
    t = Ticket(
        id=ticket_id,
        title=payload.title,
        category=payload.category,
        city=payload.city,
        address=payload.address or payload.city,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        budget=payload.budget,
        scheduled_at=payload.scheduled_at or utcnow(),
        dispatch_status=DispatchStatus.NEW,
        status="open",
        created_at=utcnow(),
        remote_updated_at=utcnow(),
    )
    db.add(t)
    log_event(db, t.id, "created", f"Customer uploaded task: {t.title} ({t.category}) in {t.city}")
    db.commit()
    db.refresh(t)

    # Automatically broadcast to matching helpers via WhatsApp Dispatch Agent
    try:
        from whatsapp.agent import get_whatsapp_dispatch_agent
        get_whatsapp_dispatch_agent().dispatch_for_task(t.id)
    except Exception as wa_err:
        pass

    return ticket_out(t)



WA_ALERT_PURPOSES = ("broadcast", "agent_broadcast", "work_order")
STATUS_RE = __import__("re").compile(r"Status:\s*(\d+)\s*sent,\s*(\d+)\s*simulated,\s*(\d+)\s*failed")


@router.get("/outreach-status")
def outreach_status(db: Session = Depends(get_db)):
    """Whether new tasks get WhatsApp alerts and helper calls right now (explains a "Not sent" / "Not called")."""
    from ..config import get_settings
    from ..services.common import calling_hours_state, runtime_settings

    r, s = runtime_settings(db), get_settings()
    hours = calling_hours_state(db)
    return {
        "whatsapp_on": bool(r.whatsapp_automation_active),
        "whatsapp_test_mode": bool(s.whatsapp_simulated),
        "calls_on": bool(r.auto_dispatch and r.workflow_helper_dispatch_enabled and r.calling_agent_active
                         and not r.emergency_stop_calls),
        "calling_hours": hours.get("label"),
        "calling_hours_open": bool(hours.get("open")),
    }


def outreach_summary(db: Session, ids: list[str]) -> tuple[dict[str, dict], dict[str, dict]]:
    """Per task: the WhatsApp task alerts sent to helpers, and the dispatch calls placed (one query each)."""
    from sqlalchemy import func

    from ..models import WhatsAppMessage

    def blank() -> dict:
        return {"total": 0, "sent": 0, "delivered": 0, "read": 0, "failed": 0, "simulated": 0, "last_at": None}

    wa: dict[str, dict] = {}
    if ids:
        rows = (db.query(WhatsAppMessage.ticket_id, WhatsAppMessage.status, func.count(), func.max(WhatsAppMessage.created_at))
                .filter(WhatsAppMessage.ticket_id.in_(ids), WhatsAppMessage.direction == "out",
                        WhatsAppMessage.purpose.in_(WA_ALERT_PURPOSES))
                .group_by(WhatsAppMessage.ticket_id, WhatsAppMessage.status).all())
        for tid, status, n, last in rows:
            s = wa.setdefault(tid, blank())
            s["total"] += n
            key = status if status in ("delivered", "read", "failed", "simulated") else "sent"
            s[key] += n
            s["last_at"] = max(filter(None, [s["last_at"], last.isoformat() + "Z" if last else None]), default=None)
        # Alerts sent before the message ledger existed are only in the broadcast event ("Status: 9 sent, 0 simulated,
        # 1 failed."); a task with ledger rows already has its exact numbers.
        for e in (db.query(Event.ticket_id, Event.message, Event.created_at)
                  .filter(Event.ticket_id.in_(ids), Event.kind.in_(("whatsapp_location_broadcast", "whatsapp_agent_broadcast")))
                  .order_by(Event.created_at)):
            if e.ticket_id in wa and not wa[e.ticket_id].get("from_event"):
                continue
            m = STATUS_RE.search(e.message or "")
            if not m:
                continue
            sent, simulated, failed = (int(x) for x in m.groups())
            wa[e.ticket_id] = {**blank(), "total": sent + simulated + failed, "sent": sent, "simulated": simulated,
                               "failed": failed, "last_at": e.created_at.isoformat() + "Z", "from_event": True}
        for tid in {e.ticket_id for e in db.query(Event.ticket_id).filter(
                Event.ticket_id.in_(ids), Event.kind == "whatsapp_agent_no_match")}:
            wa.setdefault(tid, {**blank(), "no_match": True})

    calls: dict[str, dict] = {}
    if ids:
        for a in (db.query(CallAttempt.ticket_id, CallAttempt.answered_at, CallAttempt.outcome, CallAttempt.created_at)
                  .filter(CallAttempt.ticket_id.in_(ids), CallAttempt.purpose == "dispatch")
                  .order_by(CallAttempt.created_at)):
            c = calls.setdefault(a.ticket_id, {"placed": 0, "answered": 0, "accepted": 0, "last_outcome": None, "last_at": None})
            c["placed"] += 1
            c["answered"] += 1 if a.answered_at else 0
            c["accepted"] += 1 if a.outcome == "accepted" else 0
            c["last_outcome"] = a.outcome
            c["last_at"] = a.created_at.isoformat() + "Z" if a.created_at else None
    return wa, calls


@router.get("")
def list_tickets(
    dispatch_status: str | None = None,
    status: str | None = None,
    q: str | None = None,
    order: str = "desc",
    real_only: bool = True,
    db: Session = Depends(get_db),
):
    """Tickets, by default only real customers' (the same set the dashboards count: no Works posted by the
    ExtraHand team, no test accounts, no mock rows). real_only=false lists every row in the local copy."""
    query = db.query(Ticket)
    if real_only:
        from ..services.dispatch_flow import real_customer_ticket_ids

        query = query.filter(Ticket.id.in_(real_customer_ticket_ids(db)))
    if dispatch_status:
        query = query.filter(Ticket.dispatch_status.in_(dispatch_status.split(",")))
    if status:
        query = query.filter(Ticket.status.in_(status.split(",")))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Ticket.id.ilike(like), Ticket.title.ilike(like), Ticket.customer_name.ilike(like),
                                 Ticket.customer_phone.ilike(like), Ticket.city.ilike(like),
                                 Ticket.category.ilike(like), Ticket.assignee_name.ilike(like)))
    if order == "asc":
        tickets = query.order_by(Ticket.scheduled_at.is_(None), Ticket.scheduled_at.asc(), Ticket.created_at.asc()).all()
    else:
        tickets = query.order_by(Ticket.scheduled_at.desc().nullslast(), Ticket.created_at.desc()).all()
    ids = [t.id for t in tickets]

    active_calls = {a.ticket_id: a for a in db.query(CallAttempt).filter(
        CallAttempt.ticket_id.in_(ids), CallAttempt.status.in_(ACTIVE_STATUSES))}
    next_followups: dict[str, FollowUp] = {}
    for f in db.query(FollowUp).filter(FollowUp.ticket_id.in_(ids), FollowUp.status == "scheduled").order_by(FollowUp.due_at):
        next_followups.setdefault(f.ticket_id, f)
    open_esc = {e.ticket_id for e in db.query(Escalation).filter(Escalation.ticket_id.in_(ids), Escalation.status != "resolved")}
    runs = {}
    for r in db.query(DispatchRun).filter(DispatchRun.ticket_id.in_(ids)).order_by(DispatchRun.id):
        runs[r.ticket_id] = r

    wa, calls = outreach_summary(db, ids)

    out = []
    for t in tickets:
        d = ticket_out(t)
        d["whatsapp"] = wa.get(t.id)
        d["call_summary"] = calls.get(t.id)
        call, fu, run = active_calls.get(t.id), next_followups.get(t.id), runs.get(t.id)
        d["active_call"] = call_out(call) if call else None
        d["next_followup"] = followup_out(fu) if fu else None
        d["has_open_escalation"] = t.id in open_esc
        d["last_run"] = {"status": run.status, "progress": f"{max(run.current_index + 1, 0)}/{len(run.candidates)}"} if run else None
        out.append(d)
    return out


@router.get("/{ticket_id}")
def get_ticket(ticket_id: str, db: Session = Depends(get_db)):
    t = db.get(Ticket, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    d = ticket_out(t)
    d["raw"] = t.raw
    d["runs"] = [run_out(r) for r in db.query(DispatchRun).filter_by(ticket_id=t.id).order_by(DispatchRun.id.desc())]
    d["calls"] = [call_out(a) for a in db.query(CallAttempt).filter_by(ticket_id=t.id).order_by(CallAttempt.id.desc())]
    d["followups"] = [followup_out(f) for f in db.query(FollowUp).filter_by(ticket_id=t.id).order_by(FollowUp.due_at)]
    d["escalations"] = [escalation_out(e) for e in db.query(Escalation).filter_by(ticket_id=t.id).order_by(Escalation.id.desc())]
    d["events"] = [event_out(e) for e in db.query(Event).filter_by(ticket_id=t.id).order_by(Event.id.desc()).limit(200)]
    d["whatsapp_alerts"] = helper_whatsapp_alerts(db, t.id)
    return d


def helper_whatsapp_alerts(db: Session, ticket_id: str) -> dict[str, dict]:
    """Latest WhatsApp task alert per helper phone (last 10 digits): status, when, and why it failed."""
    from ..models import WhatsAppMessage

    out: dict[str, dict] = {}
    rows = (db.query(WhatsAppMessage)
            .filter(WhatsAppMessage.ticket_id == ticket_id, WhatsAppMessage.direction == "out",
                    WhatsAppMessage.purpose.in_(WA_ALERT_PURPOSES))
            .order_by(WhatsAppMessage.created_at.desc()).all())
    for m in rows:
        key = "".join(c for c in (m.phone or "") if c.isdigit())[-10:]
        if key and key not in out:
            out[key] = {"status": m.status, "at": m.created_at.isoformat() + "Z" if m.created_at else None,
                        "error": m.error, "template": m.template}
    return out


@router.post("/{ticket_id}/dispatch")
def dispatch(ticket_id: str, db: Session = Depends(get_db)):
    try:
        run = start_dispatch(db, ticket_id, trigger="manual")
    except DispatchError as e:
        raise HTTPException(400, str(e)) from e
    return run_out(run)


@router.post("/{ticket_id}/push-assignment")
def push_assignment_now(ticket_id: str, db: Session = Depends(get_db)):
    """Retries writing the helper assigned here (call / WhatsApp) to ExtraHand."""
    from ..services.assignment import push_assignment

    t = db.get(Ticket, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if not t.assignee_id or t.assigned_via not in ("call", "whatsapp"):
        raise HTTPException(400, "Only a helper assigned in this app can be sent to ExtraHand")
    ok = push_assignment(db, ticket_id)
    db.refresh(t)
    if not ok:
        raise HTTPException(502, t.extrahand_push_error or "ExtraHand did not accept the assignment")
    return {"ok": True, "extrahand_push": t.extrahand_push}


@router.post("/{ticket_id}/dispatch/cancel")
def cancel(ticket_id: str, db: Session = Depends(get_db)):
    cancel_dispatch(db, ticket_id)
    return {"ok": True}
