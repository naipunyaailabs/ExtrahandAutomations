"""Customer Feedback & Complaints API Router."""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CallAttempt, CustomerFeedback, Ticket, utcnow
from ..services.feedback_agent import (
    process_feedback_outcome,
    start_customer_feedback_call,
)
from .serializers import iso

router = APIRouter(prefix="/api/feedback", tags=["customer_feedback"])


class FeedbackOut(BaseModel):
    id: int
    ticket_id: str
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    helper_id: Optional[str] = None
    helper_name: Optional[str] = None
    rating: Optional[int] = None
    feedback_text: Optional[str] = None
    channel: str
    language: str
    sentiment: str
    complaint_category: str
    complaint_details: Optional[str] = None
    resolution_status: str
    assigned_agent: Optional[str] = None
    resolution_notes: Optional[str] = None
    callback_requested: bool
    callback_scheduled_at: Optional[str] = None
    callback_completed: bool
    call_attempt_id: Optional[int] = None
    call_duration_seconds: int
    created_at: str
    resolved_at: Optional[str] = None


class FeedbackUpdate(BaseModel):
    resolution_status: Optional[str] = None
    assigned_agent: Optional[str] = None
    resolution_notes: Optional[str] = None
    callback_completed: Optional[bool] = None
    complaint_category: Optional[str] = None


class ManualFeedbackTrigger(BaseModel):
    language: str = Field(default="en", description="Preferred voice language (en, te, hi)")
    channel: str = Field(default="voice", description="Channel: voice or whatsapp")


def _feedback_out(f: CustomerFeedback) -> dict:
    return {
        "id": f.id,
        "ticket_id": f.ticket_id,
        "customer_id": f.customer_id,
        "customer_name": f.customer_name,
        "customer_phone": f.customer_phone,
        "helper_id": f.helper_id,
        "helper_name": f.helper_name,
        "rating": f.rating,
        "feedback_text": f.feedback_text,
        "channel": f.channel,
        "language": f.language,
        "sentiment": f.sentiment,
        "complaint_category": f.complaint_category,
        "complaint_details": f.complaint_details,
        "resolution_status": f.resolution_status,
        "assigned_agent": f.assigned_agent,
        "resolution_notes": f.resolution_notes,
        "callback_requested": f.callback_requested,
        "callback_scheduled_at": iso(f.callback_scheduled_at),
        "callback_completed": f.callback_completed,
        "call_attempt_id": f.call_attempt_id,
        "call_duration_seconds": f.call_duration_seconds,
        "created_at": iso(f.created_at),
        "resolved_at": iso(f.resolved_at),
    }


@router.get("", response_model=List[FeedbackOut])
def list_feedback(
    rating: Optional[int] = None,
    sentiment: Optional[str] = None,
    complaint_category: Optional[str] = None,
    resolution_status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
):
    """Lists customer feedback records with filtering by rating, sentiment, and complaint category."""
    query = db.query(CustomerFeedback)

    if rating is not None:
        query = query.filter(CustomerFeedback.rating == rating)
    if sentiment:
        query = query.filter(CustomerFeedback.sentiment == sentiment)
    if complaint_category:
        query = query.filter(CustomerFeedback.complaint_category == complaint_category)
    if resolution_status:
        query = query.filter(CustomerFeedback.resolution_status == resolution_status)
    if q:
        search = f"%{q}%"
        query = query.filter(
            (CustomerFeedback.customer_name.ilike(search))
            | (CustomerFeedback.customer_phone.ilike(search))
            | (CustomerFeedback.ticket_id.ilike(search))
            | (CustomerFeedback.feedback_text.ilike(search))
        )

    records = query.order_by(CustomerFeedback.id.desc()).limit(limit).all()
    return [_feedback_out(f) for f in records]


@router.get("/{id}", response_model=FeedbackOut)
def get_feedback(id: int, db: Session = Depends(get_db)):
    """Retrieves a single feedback record by ID."""
    f = db.get(CustomerFeedback, id)
    if not f:
        raise HTTPException(status_code=404, detail="Feedback record not found")
    return _feedback_out(f)


@router.post("/trigger/{ticket_id}")
def trigger_feedback_call(
    ticket_id: str,
    payload: ManualFeedbackTrigger = ManualFeedbackTrigger(),
    db: Session = Depends(get_db),
):
    """Triggers an immediate automated AI customer feedback call or WhatsApp survey for a completed ticket."""
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if not ticket.customer_phone:
        raise HTTPException(status_code=400, detail="Ticket has no customer phone number")

    try:
        attempt = start_customer_feedback_call(
            db,
            ticket_id=ticket.id,
            language=payload.language,
            trigger="manual_admin",
        )
        db.commit()
        return {
            "success": True,
            "call_id": attempt.id,
            "status": attempt.status,
            "channel": payload.channel,
            "phone": attempt.phone,
            "script": attempt.script,
            "language": payload.language,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/{id}", response_model=FeedbackOut)
def update_feedback(id: int, body: FeedbackUpdate, db: Session = Depends(get_db)):
    """Updates complaint resolution status, notes, or assigned agent."""
    f = db.get(CustomerFeedback, id)
    if not f:
        raise HTTPException(status_code=404, detail="Feedback record not found")

    if body.resolution_status is not None:
        f.resolution_status = body.resolution_status
        if body.resolution_status == "resolved":
            f.resolved_at = utcnow()
    if body.assigned_agent is not None:
        f.assigned_agent = body.assigned_agent
    if body.resolution_notes is not None:
        f.resolution_notes = body.resolution_notes
    if body.callback_completed is not None:
        f.callback_completed = body.callback_completed
    if body.complaint_category is not None:
        f.complaint_category = body.complaint_category

    db.commit()
    db.refresh(f)
    return _feedback_out(f)
