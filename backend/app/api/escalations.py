from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CareMember, DispatchStatus, Escalation, Ticket, utcnow
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
    ids = {e.ticket_id for e in items if e.ticket_id}
    tickets = {t.id: t for t in db.query(Ticket).filter(Ticket.id.in_(ids))} if ids else {}
    return [escalation_out(e, tickets.get(e.ticket_id) if e.ticket_id else None) for e in items]


class EscalationUpdate(BaseModel):
    status: str | None = None  # open | in_progress | resolved
    outcome: str | None = None  # with status "resolved": achieved (solved) | rejected (closed without a solution)
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
            if body.status == "resolved":
                if body.outcome not in (None, "achieved", "rejected"):
                    raise HTTPException(400, "Invalid outcome")
                e.outcome = body.outcome or "achieved"
            else:
                e.outcome = None
            log_event(db, e.ticket_id or None, "escalation_" + body.status,
                      f"Customer care marked escalation {body.status.replace('_', ' ')}"
                      + (f" ({'solved' if e.outcome == 'achieved' else 'not solved'})" if body.status == "resolved" else "")
                      + (f": {e.notes}" if e.notes and body.status == "resolved" else ""))
            if body.status == "resolved":
                if e.ticket_id:
                    _release_ticket(db, e.ticket_id)
        db.commit()
        return escalation_out(e, db.get(Ticket, e.ticket_id) if e.ticket_id else None)


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
    if not e.ticket_id:
        raise HTTPException(400, "This case is not linked to a task, so there are no helpers to call.")
    with engine_lock:
        e.status, e.resolved_at, e.outcome = "resolved", utcnow(), "achieved"
        e.notes = (e.notes + "\n" if e.notes else "") + "Re-dispatched to helpers"
        log_event(db, e.ticket_id, "escalation_redispatch", "Customer care restarted helper calls")
        db.flush()
        try:
            run = start_dispatch(db, e.ticket_id, trigger="customer care")
        except DispatchError as err:
            db.rollback()
            raise HTTPException(400, str(err)) from err
    return {"ok": True, "run_id": run.id}


# ------------------------------------------------------------------------------------------------ dashboard
IST = timezone(timedelta(hours=5, minutes=30))


def _period_starts() -> dict[str, datetime | None]:
    """Start of today / this week (Monday) / this month in India time, as naive UTC like the database."""
    midnight = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    starts = {"today": midnight, "week": midnight - timedelta(days=midnight.weekday()), "month": midnight.replace(day=1)}
    out: dict[str, datetime | None] = {k: v.astimezone(timezone.utc).replace(tzinfo=None) for k, v in starts.items()}
    out["all"] = None
    return out


def _counts(cases: list[Escalation], start: datetime | None) -> dict[str, Any]:
    """For one period: cases that came in, were closed (achieved / rejected) and are still waiting."""
    came = [e for e in cases if start is None or e.created_at >= start]
    closed = [e for e in cases if e.status == "resolved" and e.resolved_at and (start is None or e.resolved_at >= start)]
    achieved = sum(1 for e in closed if (e.outcome or "achieved") == "achieved")
    return {
        "received": len(came),
        "done": len(closed),
        "achieved": achieved,
        "rejected": len(closed) - achieved,
        "pending": sum(1 for e in came if e.status != "resolved"),
        "achieved_rate": round(100 * achieved / len(closed)) if closed else None,
    }


@router.get("/stats")
def care_stats(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Customer Care dashboard: per period (today / this week / this month / all time, India time) how many cases
    came in, were closed (achieved = solved, rejected = closed without a solution) and are pending; what is waiting
    right now; and each team member's cases."""
    cases = [e for e in db.query(Escalation).all() if e.source != "whatsapp_test"]  # tester cases are not counted
    periods = {k: _counts(cases, start) for k, start in _period_starts().items()}
    open_now = [e for e in cases if e.status != "resolved"]
    members = db.query(CareMember).order_by(CareMember.created_at.asc(), CareMember.id.asc()).all()
    per_member = []
    for m in members:
        mine = [e for e in cases if (e.assigned_to or "").strip().lower() == m.name.strip().lower()]
        closed = [e for e in mine if e.status == "resolved"]
        per_member.append({
            **member_out(m), "assigned": len(mine), "working_on": sum(1 for e in mine if e.status != "resolved"),
            "achieved": sum(1 for e in closed if (e.outcome or "achieved") == "achieved"),
            "rejected": sum(1 for e in closed if e.outcome == "rejected"),
        })
    oldest = min((e.created_at for e in open_now), default=None)
    return {
        "periods": periods,
        "now": {"open": sum(1 for e in open_now if e.status == "open"),
                "in_progress": sum(1 for e in open_now if e.status == "in_progress"),
                "unassigned": sum(1 for e in open_now if not (e.assigned_to or "").strip()),
                "oldest_waiting_since": oldest.isoformat() + "Z" if oldest else None},
        "members": per_member,
    }


# ------------------------------------------------------------------------------------------------ team
team_router = APIRouter(prefix="/api/care-team", tags=["customer care"])


def member_out(m: CareMember) -> dict[str, Any]:
    return {"id": m.id, "name": m.name, "phone": m.phone, "role": m.role, "active": m.active,
            "created_at": m.created_at.isoformat() + "Z" if m.created_at else None}


class MemberIn(BaseModel):
    name: str
    phone: str | None = None
    role: str | None = None


@team_router.get("")
def list_members(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [member_out(m) for m in db.query(CareMember).order_by(CareMember.created_at.asc(), CareMember.id.asc())]


@team_router.post("")
def add_member(body: MemberIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(400, "Enter a name.")
    if db.query(CareMember).filter(CareMember.name.ilike(name)).first():
        raise HTTPException(400, f"{name} is already in the team.")
    phone = "".join(c for c in (body.phone or "") if c.isdigit() or c == "+") or None
    m = CareMember(name=name[:120], phone=phone, role=(body.role or "").strip()[:60] or None)
    db.add(m)
    db.commit()
    return member_out(m)


@team_router.patch("/{member_id}")
def update_member(member_id: int, body: MemberIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Edit a person's name / phone / role. A new name is also written on the cases they handled, so their counts stay."""
    m = db.get(CareMember, member_id)
    if not m:
        raise HTTPException(404, "Team member not found")
    name = " ".join(body.name.split())[:120]
    if not name:
        raise HTTPException(400, "Enter a name.")
    clash = db.query(CareMember).filter(CareMember.name.ilike(name), CareMember.id != member_id).first()
    if clash:
        raise HTTPException(400, f"{name} is already in the team.")
    old = m.name
    if name != old:
        for e in db.query(Escalation).filter(Escalation.assigned_to.isnot(None)).all():
            if (e.assigned_to or "").strip().lower() == old.strip().lower():
                e.assigned_to = name
    m.name = name
    m.phone = "".join(c for c in (body.phone or "") if c.isdigit() or c == "+") or None
    m.role = (body.role or "").strip()[:60] or None
    db.commit()
    return member_out(m)


@team_router.delete("/{member_id}")
def remove_member(member_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    m = db.get(CareMember, member_id)
    if not m:
        raise HTTPException(404, "Team member not found")
    db.delete(m)
    db.commit()
    return {"ok": True}
