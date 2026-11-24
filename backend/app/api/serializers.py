import json
from datetime import datetime

from ..models import CallAttempt, DispatchRun, Escalation, Event, FollowUp, Helper, Ticket
from ..services import handoff
from ..integrations.mapping import task_schedule_end


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def ticket_out(t: Ticket) -> dict:
    from datetime import datetime, timezone, timedelta
    # Use IST (UTC+5:30) as operations timezone so day rollover matches Indian local time
    IST = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(IST)
    
    date_status = "unscheduled"
    days_diff = None
    is_today = False
    is_upcoming = False
    is_past = False
    
    def ist_date(dt):
        if not dt:
            return None
        return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt).astimezone(IST).date()

    # When the customer booked (ExtraHand's createdAt; created_at here is when the row was copied)
    raw = t.raw if isinstance(t.raw, dict) else {}
    booked_at = None
    if isinstance(raw.get("createdAt"), str):
        try:
            booked_at = datetime.fromisoformat(raw["createdAt"].replace("Z", "+00:00"))
        except ValueError:
            booked_at = None
    booked_date = ist_date(booked_at) or ist_date(t.created_at)
    scheduled_date = ist_date(t.scheduled_at)
    today_date = now.date()

    # Same rule as the dashboards: "today" = booked today or scheduled for today
    target_date = today_date if today_date in (booked_date, scheduled_date) else (scheduled_date or booked_date)
    if target_date:
        days_diff = (target_date - today_date).days
        
        if days_diff == 0:
            is_today = True
            date_status = "today"
        elif days_diff > 0:
            is_upcoming = True
            date_status = "upcoming"
        else:
            is_past = True
            date_status = "past"

    return {
        "id": t.id, "title": t.title, "description": t.description, "category": t.category,
        "status": t.status, "dispatch_status": t.dispatch_status, "budget": t.budget,
        "address": t.address, "city": t.city, "lat": t.lat, "lng": t.lng,
        "scheduled_at": iso(t.scheduled_at), "scheduled_end_at": iso(task_schedule_end(raw)),
        "booking_source": t.booking_source,
        "customer": {"id": t.customer_id, "name": t.customer_name, "phone": t.customer_phone, "email": t.customer_email},
        "assignee": {"id": t.assignee_id, "profile_id": t.assignee_profile_id, "name": t.assignee_name,
                     "phone": t.assignee_phone} if t.assignee_id else None,
        "assignment_local_only": t.assignment_local_only,
        "assigned_via": t.assigned_via or ("extrahand" if t.assignee_id and not t.assignment_local_only else
                                           "call" if t.assignee_id else None),
        "assigned_at": iso(t.assigned_at),
        "extrahand_push": t.extrahand_push,
        "extrahand_push_error": t.extrahand_push_error,
        "created_at": iso(t.created_at),
        "booked_at": booked_at.astimezone(timezone.utc).replace(tzinfo=None).isoformat() + "Z" if booked_at else None,
        "synced_at": iso(t.synced_at), "updated_at": iso(t.updated_at),
        "date_status": date_status,
        "is_today": is_today,
        "is_upcoming": is_upcoming,
        "is_past": is_past,
        "days_from_today": days_diff,
    }


def _trail(a: CallAttempt) -> list[dict]:
    try:
        items = json.loads(a.timeline) if a.timeline else []
    except ValueError:
        return []
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []


def call_out(a: CallAttempt, ticket: Ticket | None = None, detail: bool = False) -> dict:
    d = {
        "id": a.id, "ticket_id": a.ticket_id, "purpose": a.purpose, "run_id": a.run_id, "followup_id": a.followup_id,
        "helper_id": a.helper_id, "helper_name": a.helper_name,
        "customer_id": a.customer_id, "customer_name": a.customer_name,
        "phone": a.phone, "provider": a.provider,
        "provider_call_id": a.provider_call_id, "status": a.status, "outcome": a.outcome,
        "prompts_played": a.prompts_played, "digits": a.digits, "script": a.script,
        "language": a.language, "transcript": a.transcript, "summary": a.summary,
        "duration_seconds": a.duration_seconds, "error": a.error,
        "created_at": iso(a.created_at), "answered_at": iso(a.answered_at), "ended_at": iso(a.ended_at),
    }
    if ticket:
        d["ticket_title"] = ticket.title
    if detail:  # the list stays light: the trail is only for the call detail page
        d["timeline"] = _trail(a)
    info = handoff.result_of(a)  # what the voice agent recorded; its transcript is already in "transcript"
    d["handoff"] = {k: v for k, v in info.items() if k != "transcript"} if info else None
    return d


def run_out(r: DispatchRun) -> dict:
    return {
        "id": r.id, "status": r.status, "candidates": r.candidates, "current_index": r.current_index,
        "candidate_source": r.candidate_source, "reason": r.reason,
        "started_at": iso(r.started_at), "finished_at": iso(r.finished_at),
    }


def followup_out(f: FollowUp) -> dict:
    return {
        "id": f.id, "ticket_id": f.ticket_id, "helper_id": f.helper_id, "helper_name": f.helper_name,
        "phone": f.phone, "offset_minutes": f.offset_minutes, "due_at": iso(f.due_at),
        "status": f.status, "outcome": f.outcome,
    }


def escalation_out(e: Escalation, ticket: Ticket | None = None) -> dict:
    return {
        "id": e.id, "ticket_id": e.ticket_id, "reason": e.reason, "details": e.details, "status": e.status,
        "outcome": e.outcome, "assigned_to": e.assigned_to,
        "source": e.source or "calling", "customer_name": e.customer_name, "customer_phone": e.customer_phone,
        "booking_id": e.booking_id, "category": e.category, "conversation_id": e.conversation_id, "notes": e.notes, "created_at": iso(e.created_at),
        "resolved_at": iso(e.resolved_at), "ticket": ticket_out(ticket) if ticket else None,
    }


def event_out(e: Event) -> dict:
    return {"id": e.id, "ticket_id": e.ticket_id, "kind": e.kind, "message": e.message, "created_at": iso(e.created_at)}


def helper_out(h: Helper, active_tickets: int = 0, total_calls: int = 0) -> dict:
    return {
        "id": h.id,
        "profile_id": h.profile_id,
        "name": h.name,
        "phone": h.phone,
        "alt_phone": h.alt_phone,
        "email": h.email,
        "skills": h.skills or [],
        "categories": h.categories or [],
        "work_areas": h.work_areas or [],
        "address": h.address,
        "city": h.city,
        "state": h.state,
        "pincode": h.pincode,
        "lat": h.lat,
        "lng": h.lng,
        "status": h.status or "active",
        "is_active": h.is_active if h.is_active is not None else True,
        "is_verified": bool(h.is_verified),
        "can_accept_tasks": h.can_accept_tasks if h.can_accept_tasks is not None else True,
        "work_shift_type": h.work_shift_type,
        "active_tickets_count": active_tickets,
        "total_calls_count": total_calls,
        "updated_at": iso(h.updated_at),
    }
