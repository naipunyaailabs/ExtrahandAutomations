from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import CallAttempt, Ticket
from ..services import ivr
from ..services.common import engine_lock
from .serializers import call_out

router = APIRouter(prefix="/api", tags=["calls"])


@router.get("/calls/flow")
def calling_flow_today(db: Session = Depends(get_db)):
    """Calling Agent dispatch flow for today (India time): real-customer orders live from ExtraHand, plus today's
    calls, follow-ups and escalations from this app (simulator calls counted separately)."""
    from ..services.dispatch_flow import calling_flow

    return calling_flow(db)


@router.get("/calls")
def list_calls(active: bool = False, purpose: str | None = None, limit: int = 200, db: Session = Depends(get_db)):
    q = db.query(CallAttempt)
    if active:
        q = q.filter(CallAttempt.status.in_(ivr.ACTIVE_STATUSES))
    if purpose:
        q = q.filter(CallAttempt.purpose == purpose)
    calls = q.order_by(CallAttempt.id.desc()).limit(min(limit, 1000)).all()
    tickets = {t.id: t for t in db.query(Ticket).filter(Ticket.id.in_({c.ticket_id for c in calls}))}
    return [call_out(c, tickets.get(c.ticket_id)) for c in calls]


class SimAction(BaseModel):
    action: str  # answer | press | silence | no_answer | busy | hangup
    digit: str | None = None


@router.post("/simulator/calls/{call_id}")
def simulate(call_id: int, body: SimAction, db: Session = Depends(get_db)):
    """Plays the helper's side of a simulated call (TELEPHONY_PROVIDER=simulator)."""
    a = db.get(CallAttempt, call_id)
    if not a:
        raise HTTPException(404, "Call not found")
    if a.provider != "simulator":
        raise HTTPException(400, "Only simulated calls can be driven from the dashboard")
    if a.status == "ended":
        raise HTTPException(400, "Call already ended")

    with engine_lock:
        step: ivr.Step | None = None
        if body.action == "answer":
            if a.status != "ringing":
                raise HTTPException(400, "Call is not ringing")
            step = ivr.next_prompt(db, a)
        elif body.action == "press":
            if a.status != "in_progress":
                raise HTTPException(400, "Answer the call first")
            step = ivr.press(db, a, (body.digit or "")[:1])
            if step.repeat:
                retry = ivr.next_prompt(db, a)
                step = ivr.Step(step.text + " " + retry.text, hangup=retry.hangup)
        elif body.action == "silence":
            if a.status != "in_progress":
                raise HTTPException(400, "Answer the call first")
            step = ivr.next_prompt(db, a)  # gather timed out: play again or give up
        elif body.action in ("no_answer", "busy"):
            ivr.ended(db, a, body.action.replace("_", "-"))
        elif body.action == "hangup":
            ivr.ended(db, a, "completed")
        else:
            raise HTTPException(400, "Unknown action")
        if step and step.hangup:
            ivr.ended(db, a, "completed")
        db.commit()
    return {"call": call_out(a), "spoken": step.text if step else None,
            "max_prompts": get_settings().ivr_max_prompts}
