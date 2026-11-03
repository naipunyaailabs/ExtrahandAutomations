from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..integrations.extrahand import ExtraHandError
from ..models import CallAttempt, CustomerFeedback, Escalation, Event, FollowUp, Helper, Ticket, utcnow
from ..services.common import runtime_settings_dict, save_runtime_settings
from ..services.sync import last_sync, sync_tickets
from .serializers import event_out, helper_out, iso

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    by_status = dict(db.query(Ticket.dispatch_status, func.count()).group_by(Ticket.dispatch_status).all())
    by_raw_status = dict(db.query(Ticket.status, func.count()).group_by(Ticket.status).all())
    since = utcnow() - timedelta(hours=24)
    outcomes = dict(db.query(CallAttempt.outcome, func.count()).filter(
        CallAttempt.created_at >= since, CallAttempt.purpose == "dispatch").group_by(CallAttempt.outcome).all())
    assigned_helpers = (
        db.query(Ticket.assignee_id)
        .filter(Ticket.assignee_id.isnot(None), Ticket.dispatch_status == "assigned")
        .distinct()
        .count()
    )
    answered = sum(v for k, v in outcomes.items() if k in ("accepted", "rejected", "busy"))

    # Customer feedback stats
    feedbacks = db.query(CustomerFeedback).all()
    rated = [f.rating for f in feedbacks if f.rating is not None]
    csat_avg = round(sum(rated) / len(rated), 2) if rated else None
    open_complaints = db.query(CustomerFeedback).filter(
        CustomerFeedback.complaint_category != "none",
        CustomerFeedback.resolution_status != "resolved"
    ).count()

    runtime = runtime_settings_dict(db)

    return {
        "tickets_total": sum(by_status.values()),
        "tickets_by_status": by_status,
        "tickets_by_raw_status": by_raw_status,
        "completed_tickets": by_raw_status.get("completed", 0),
        "cancelled_tickets": by_raw_status.get("cancelled", 0),
        "unassigned_tickets": by_status.get("new", 0),
        "assigned_tickets": by_status.get("assigned", 0),
        "closed_tickets": by_status.get("closed", 0),
        "assigned_helpers": assigned_helpers,
        "active_calls": db.query(CallAttempt).filter(CallAttempt.status.in_(("queued", "ringing", "in_progress"))).count(),
        "calls_24h": sum(outcomes.values()),
        "call_outcomes_24h": {k or "in_progress": v for k, v in outcomes.items()},
        "acceptance_rate_24h": round(outcomes.get("accepted", 0) / answered, 3) if answered else None,
        "open_escalations": db.query(Escalation).filter(Escalation.status != "resolved").count(),
        "followups_scheduled": db.query(FollowUp).filter(FollowUp.status == "scheduled").count(),
        "feedback_total": len(feedbacks),
        "csat_average": csat_avg,
        "open_complaints": open_complaints,
        "emergency_stop_calls": runtime.get("emergency_stop_calls", False),
        "last_sync": {**last_sync, "at": iso(last_sync["at"])},
    }


@router.post("/sync")
def sync_now(db: Session = Depends(get_db)):
    try:
        return sync_tickets(db)
    except ExtraHandError as e:
        raise HTTPException(502, f"ExtraHand sync failed: {e}") from e


@router.get("/events")
def events(limit: int = 50, db: Session = Depends(get_db)):
    return [event_out(e) for e in db.query(Event).order_by(Event.id.desc()).limit(min(limit, 500))]


@router.get("/config")
def config(db: Session = Depends(get_db)):
    s = get_settings()
    return {
        "extrahand_mode": s.extrahand_mode,
        "telephony_provider": s.telephony_provider,
        "assignment_enabled": s.extrahand_allow_assignment or s.extrahand_mode == "mock",
        "matching_api_configured": bool(s.extrahand_service_auth) or s.extrahand_mode == "mock",
        "ivr_max_prompts": s.ivr_max_prompts,
        "sync_interval_seconds": s.sync_interval_seconds,
        "whatsapp_enabled": getattr(s, "whatsapp_enabled", True),
        "whatsapp_gateway_url": getattr(s, "whatsapp_gateway_url", "http://localhost:2785"),
        "whatsapp_simulated": getattr(s, "whatsapp_simulated", True),
        "runtime": runtime_settings_dict(db),
    }


class RuntimeUpdate(BaseModel):
    followup_offsets_minutes: list[int] | None = None
    auto_dispatch: bool | None = None
    max_helpers_per_ticket: int | None = None
    match_radius_km: float | None = None
    emergency_stop_calls: bool | None = None
    workflow_helper_dispatch_enabled: bool | None = None
    workflow_customer_feedback_enabled: bool | None = None
    workflow_whatsapp_dispatch_enabled: bool | None = None
    workflow_whatsapp_feedback_enabled: bool | None = None
    calling_hours_start: str | None = None
    calling_hours_end: str | None = None
    feedback_call_delay_minutes: int | None = None
    preferred_language: str | None = None
    max_helper_call_attempts: int | None = None
    cost_per_call_minute: float | None = None
    cost_per_whatsapp_msg: float | None = None


@router.put("/settings")
def update_settings(body: RuntimeUpdate, db: Session = Depends(get_db)):
    if body.followup_offsets_minutes is not None and any(m <= 0 or m > 7 * 24 * 60 for m in body.followup_offsets_minutes):
        raise HTTPException(400, "Offsets must be between 1 minute and 7 days")
    if body.max_helpers_per_ticket is not None and not 1 <= body.max_helpers_per_ticket <= 100:
        raise HTTPException(400, "Max helpers must be 1-100")
    if body.match_radius_km is not None and not 0 < body.match_radius_km <= 500:
        raise HTTPException(400, "Radius must be 1-500 km")
    save_runtime_settings(db, body.model_dump(exclude_none=True))
    db.commit()
    return runtime_settings_dict(db)


class EmergencyStopPayload(BaseModel):
    stopped: bool = False
    enabled: bool = False

    def is_stopped(self) -> bool:
        return bool(self.stopped or self.enabled)


@router.post("/settings/emergency-stop")
def toggle_emergency_stop(body: EmergencyStopPayload, db: Session = Depends(get_db)):
    """Instantly activates or deactivates the emergency kill switch for all automated voice calls."""
    stop_val = body.is_stopped()
    save_runtime_settings(db, {"emergency_stop_calls": stop_val})
    db.commit()
    return {"emergency_stop_calls": stop_val, "status": "active" if stop_val else "resumed"}
