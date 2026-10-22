from datetime import datetime

from ..models import CallAttempt, DispatchRun, Escalation, Event, FollowUp, Helper, Ticket


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def ticket_out(t: Ticket) -> dict:
    return {
        "id": t.id, "title": t.title, "description": t.description, "category": t.category,
        "status": t.status, "dispatch_status": t.dispatch_status, "budget": t.budget,
        "address": t.address, "city": t.city, "lat": t.lat, "lng": t.lng,
        "scheduled_at": iso(t.scheduled_at), "booking_source": t.booking_source,
        "customer": {"id": t.customer_id, "name": t.customer_name, "phone": t.customer_phone, "email": t.customer_email},
        "assignee": {"id": t.assignee_id, "profile_id": t.assignee_profile_id, "name": t.assignee_name,
                     "phone": t.assignee_phone} if t.assignee_id else None,
        "assignment_local_only": t.assignment_local_only,
        "created_at": iso(t.created_at),
        "synced_at": iso(t.synced_at), "updated_at": iso(t.updated_at),
    }


def call_out(a: CallAttempt, ticket: Ticket | None = None) -> dict:
    d = {
        "id": a.id, "ticket_id": a.ticket_id, "purpose": a.purpose, "run_id": a.run_id, "followup_id": a.followup_id,
        "helper_id": a.helper_id, "helper_name": a.helper_name, "phone": a.phone, "provider": a.provider,
        "provider_call_id": a.provider_call_id, "status": a.status, "outcome": a.outcome,
        "prompts_played": a.prompts_played, "digits": a.digits, "script": a.script, "error": a.error,
        "created_at": iso(a.created_at), "answered_at": iso(a.answered_at), "ended_at": iso(a.ended_at),
    }
    if ticket:
        d["ticket_title"] = ticket.title
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
        "assigned_to": e.assigned_to, "notes": e.notes, "created_at": iso(e.created_at),
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
