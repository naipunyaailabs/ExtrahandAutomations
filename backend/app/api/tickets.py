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

    out = []
    for t in tickets:
        d = ticket_out(t)
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
    return d


@router.post("/{ticket_id}/dispatch")
def dispatch(ticket_id: str, db: Session = Depends(get_db)):
    try:
        run = start_dispatch(db, ticket_id, trigger="manual")
    except DispatchError as e:
        raise HTTPException(400, str(e)) from e
    return run_out(run)


@router.post("/{ticket_id}/dispatch/cancel")
def cancel(ticket_id: str, db: Session = Depends(get_db)):
    cancel_dispatch(db, ticket_id)
    return {"ok": True}
