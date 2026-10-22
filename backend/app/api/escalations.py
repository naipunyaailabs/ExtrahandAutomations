from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import DispatchStatus, Escalation, Ticket, utcnow
from ..services.common import engine_lock, log_event
from ..services.dispatch import DispatchError, start_dispatch
from .serializers import escalation_out

router = APIRouter(prefix="/api/escalations", tags=["customer care"])


@router.get("")
def list_escalations(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Escalation)
    if status:
        q = q.filter(Escalation.status.in_(status.split(",")))
    items = q.order_by(Escalation.status == "resolved", Escalation.created_at.desc()).all()
    tickets = {t.id: t for t in db.query(Ticket).filter(Ticket.id.in_({e.ticket_id for e in items}))}
    return [escalation_out(e, tickets.get(e.ticket_id)) for e in items]


class EscalationUpdate(BaseModel):
    status: str | None = None  # open | in_progress | resolved
    assigned_to: str | None = None
    notes: str | None = None


@router.patch("/{esc_id}")
def update_escalation(esc_id: int, body: EscalationUpdate, db: Session = Depends(get_db)):
    with engine_lock:
        e = db.get(Escalation, esc_id)
        if not e:
            raise HTTPException(404, "Escalation not found")
        if body.assigned_to is not None:
            e.assigned_to = body.assigned_to
        if body.notes is not None:
            e.notes = body.notes
        if body.status and body.status != e.status:
            if body.status not in ("open", "in_progress", "resolved"):
                raise HTTPException(400, "Invalid status")
            e.status = body.status
            e.resolved_at = utcnow() if body.status == "resolved" else None
            log_event(db, e.ticket_id, "escalation_" + body.status,
                      f"Customer care marked escalation {body.status.replace('_', ' ')}"
                      + (f": {e.notes}" if e.notes and body.status == "resolved" else ""))
            if body.status == "resolved":
                _release_ticket(db, e.ticket_id)
        db.commit()
        return escalation_out(e, db.get(Ticket, e.ticket_id))


def _release_ticket(db: Session, ticket_id: str) -> None:
    """When nothing is open any more, the ticket leaves the escalated state."""
    t = db.get(Ticket, ticket_id)
    still_open = db.query(Escalation).filter(Escalation.ticket_id == ticket_id, Escalation.status != "resolved").count()
    if t and t.dispatch_status == DispatchStatus.ESCALATED and not still_open:
        t.dispatch_status = DispatchStatus.ASSIGNED if t.assignee_id else DispatchStatus.NEW


@router.post("/{esc_id}/redispatch")
def redispatch(esc_id: int, db: Session = Depends(get_db)):
    """Customer care asks the agent to call the eligible helpers again."""
    e = db.get(Escalation, esc_id)
    if not e:
        raise HTTPException(404, "Escalation not found")
    with engine_lock:
        e.status, e.resolved_at = "resolved", utcnow()
        e.notes = (e.notes + "\n" if e.notes else "") + "Re-dispatched to helpers"
        log_event(db, e.ticket_id, "escalation_redispatch", "Customer care restarted helper calls")
        db.flush()
        try:
            run = start_dispatch(db, e.ticket_id, trigger="customer care")
        except DispatchError as err:
            db.rollback()
            raise HTTPException(400, str(err)) from err
    return {"ok": True, "run_id": run.id}
