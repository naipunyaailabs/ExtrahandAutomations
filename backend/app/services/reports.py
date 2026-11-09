"""Reports and Analytics Engine for ExtraHand Intelligence Platform.

Generates:
- Daily, weekly, monthly operational summaries.
- Customer satisfaction (CSAT) metrics & ratings distribution.
- Helper availability & acceptance rates.
- Unassigned duration & booking lifecycle metrics.
- Voice call & WhatsApp volume, success vs failure, and estimated costs.
- CSV / Excel export data generation.
"""

import csv
from datetime import UTC, datetime, timedelta
import io
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    CallAttempt,
    CustomerFeedback,
    DispatchRun,
    Escalation,
    Helper,
    Ticket,
    utcnow,
)
from .common import runtime_settings

log = logging.getLogger("reports")


def get_analytics_summary(db: Session, days: int = 30) -> Dict[str, Any]:
    """Computes comprehensive multi-dimensional operational metrics."""
    since = utcnow() - timedelta(days=days)
    r_settings = runtime_settings(db)

    # 1. Booking & Allocation Metrics
    tickets_query = db.query(Ticket).filter(Ticket.created_at >= since)
    total_tickets = tickets_query.count()
    completed_tickets = tickets_query.filter(Ticket.status.in_(["completed", "closed"])).count()
    unassigned_tickets = tickets_query.filter(Ticket.dispatch_status == "new").count()
    assigned_tickets = tickets_query.filter(Ticket.dispatch_status == "assigned").count()
    escalated_tickets = tickets_query.filter(Ticket.dispatch_status == "escalated").count()

    # Category breakdown
    category_rows = (
        db.query(Ticket.category, func.count())
        .filter(Ticket.created_at >= since)
        .group_by(Ticket.category)
        .all()
    )
    categories = {cat or "General": cnt for cat, cnt in category_rows}

    # 2. Voice Call Metrics
    calls_query = db.query(CallAttempt).filter(CallAttempt.created_at >= since)
    total_calls = calls_query.count()
    answered_calls = calls_query.filter(CallAttempt.status == "ended", CallAttempt.answered_at.isnot(None)).count()
    failed_calls = calls_query.filter(CallAttempt.outcome.in_(["failed", "no_answer", "busy"])).count()
    total_call_seconds = sum(c.duration_seconds or 0 for c in calls_query.all())

    # Purpose breakdown
    purpose_rows = (
        db.query(CallAttempt.purpose, func.count())
        .filter(CallAttempt.created_at >= since)
        .group_by(CallAttempt.purpose)
        .all()
    )
    calls_by_purpose = {p or "dispatch": cnt for p, cnt in purpose_rows}

    # Helper Dispatch Outcomes
    dispatch_outcomes = dict(
        db.query(CallAttempt.outcome, func.count())
        .filter(CallAttempt.created_at >= since, CallAttempt.purpose == "dispatch")
        .group_by(CallAttempt.outcome)
        .all()
    )
    total_dispatches = sum(dispatch_outcomes.values())
    accepted_dispatches = dispatch_outcomes.get("accepted", 0)
    acceptance_rate = round((accepted_dispatches / total_dispatches * 100), 1) if total_dispatches else 0.0

    # 3. Customer Satisfaction & Feedback
    feedbacks_query = db.query(CustomerFeedback).filter(CustomerFeedback.created_at >= since)
    total_feedbacks = feedbacks_query.count()
    rated_feedbacks = feedbacks_query.filter(CustomerFeedback.rating.isnot(None)).all()

    avg_rating = 0.0
    rating_dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    if rated_feedbacks:
        avg_rating = round(sum(f.rating for f in rated_feedbacks) / len(rated_feedbacks), 2)
        for f in rated_feedbacks:
            if f.rating in rating_dist:
                rating_dist[f.rating] += 1

    # Complaints breakdown
    complaint_rows = (
        db.query(CustomerFeedback.complaint_category, func.count())
        .filter(CustomerFeedback.created_at >= since, CustomerFeedback.complaint_category != "none")
        .group_by(CustomerFeedback.complaint_category)
        .all()
    )
    complaints_by_category = {cat: cnt for cat, cnt in complaint_rows}
    total_complaints = sum(complaints_by_category.values())
    resolved_complaints = feedbacks_query.filter(
        CustomerFeedback.complaint_category != "none",
        CustomerFeedback.resolution_status == "resolved",
    ).count()
    complaint_resolution_rate = round((resolved_complaints / total_complaints * 100), 1) if total_complaints else 100.0

    # 4. WhatsApp Messaging Estimates
    # Simulated/tracked messages
    whatsapp_estimated_sent = (assigned_tickets * 2) + total_dispatches + total_feedbacks

    # 5. Cost Tracking & Estimation
    call_minutes = max(1.0, round(total_call_seconds / 60.0, 1))
    estimated_voice_cost = round(call_minutes * r_settings.cost_per_call_minute, 2)
    estimated_whatsapp_cost = round(whatsapp_estimated_sent * r_settings.cost_per_whatsapp_msg, 2)
    total_estimated_cost = round(estimated_voice_cost + estimated_whatsapp_cost, 2)

    return {
        "period_days": days,
        "since": since.isoformat(),
        "bookings": {
            "total": total_tickets,
            "completed": completed_tickets,
            "assigned": assigned_tickets,
            "unassigned": unassigned_tickets,
            "escalated": escalated_tickets,
            "categories": categories,
        },
        "calls": {
            "total": total_calls,
            "answered": answered_calls,
            "failed": failed_calls,
            "total_minutes": call_minutes,
            "by_purpose": calls_by_purpose,
            "helper_dispatch_outcomes": dispatch_outcomes,
            "helper_acceptance_rate": acceptance_rate,
        },
        "csat": {
            "total_reviews": total_feedbacks,
            "average_rating": avg_rating,
            "rating_distribution": rating_dist,
            "total_complaints": total_complaints,
            "complaints_by_category": complaints_by_category,
            "resolution_rate": complaint_resolution_rate,
        },
        "costs": {
            "call_minutes": call_minutes,
            "voice_cost_inr": estimated_voice_cost,
            "whatsapp_messages_sent": whatsapp_estimated_sent,
            "whatsapp_cost_inr": estimated_whatsapp_cost,
            "total_cost_inr": total_estimated_cost,
            "currency": get_settings().currency_code,
        },
    }


def generate_csv_export(db: Session, export_type: str = "bookings", days: int = 30) -> str:
    """Generates formatted CSV content for one-click reports export."""
    since = utcnow() - timedelta(days=days)
    output = io.StringIO()
    writer = csv.writer(output)

    if export_type == "bookings":
        writer.writerow([
            "Ticket ID", "Title", "Category", "Customer Name", "Customer Phone",
            "Assignee Name", "Status", "Dispatch Status", "Budget", "City", "Scheduled At", "Created At"
        ])
        tickets = db.query(Ticket).filter(Ticket.created_at >= since).order_by(Ticket.id.desc()).all()
        for t in tickets:
            writer.writerow([
                t.id, t.title or "", t.category or "", t.customer_name or "", t.customer_phone or "",
                t.assignee_name or "", t.status or "", t.dispatch_status or "", t.budget or 0,
                t.city or "", t.scheduled_at.isoformat() if t.scheduled_at else "",
                t.created_at.isoformat() if t.created_at else ""
            ])

    elif export_type == "calls":
        writer.writerow([
            "Call ID", "Ticket ID", "Purpose", "Phone", "Helper/Customer Name",
            "Provider", "Status", "Outcome", "Language", "Duration Seconds", "Created At", "Transcript Summary"
        ])
        calls = db.query(CallAttempt).filter(CallAttempt.created_at >= since).order_by(CallAttempt.id.desc()).all()
        for c in calls:
            name = c.helper_name or c.customer_name or ""
            writer.writerow([
                c.id, c.ticket_id, c.purpose, c.phone or "", name,
                c.provider, c.status, c.outcome or "", c.language or "en",
                c.duration_seconds or 0, c.created_at.isoformat() if c.created_at else "",
                (c.summary or "").replace("\n", " ")
            ])

    elif export_type == "feedback":
        writer.writerow([
            "Feedback ID", "Ticket ID", "Customer Name", "Customer Phone", "Helper Name",
            "Rating", "Sentiment", "Complaint Category", "Resolution Status", "Assigned Agent",
            "Feedback Details", "Created At"
        ])
        feedbacks = db.query(CustomerFeedback).filter(CustomerFeedback.created_at >= since).order_by(CustomerFeedback.id.desc()).all()
        for f in feedbacks:
            writer.writerow([
                f.id, f.ticket_id, f.customer_name or "", f.customer_phone or "", f.helper_name or "",
                f.rating or "", f.sentiment, f.complaint_category, f.resolution_status, f.assigned_agent or "",
                (f.feedback_text or "").replace("\n", " "), f.created_at.isoformat() if f.created_at else ""
            ])

    elif export_type == "helpers":
        writer.writerow([
            "Helper ID", "Name", "Phone", "City", "Skills", "Categories",
            "Work Areas", "Is Active", "Is Verified", "Can Accept Tasks"
        ])
        helpers = db.query(Helper).order_by(Helper.id.desc()).all()
        for h in helpers:
            writer.writerow([
                h.id, h.name or "", h.phone or "", h.city or "",
                ", ".join(h.skills or []) if isinstance(h.skills, list) else "",
                ", ".join(h.categories or []) if isinstance(h.categories, list) else "",
                ", ".join(h.work_areas or []) if isinstance(h.work_areas, list) else "",
                "Yes" if h.is_active else "No",
                "Yes" if h.is_verified else "No",
                "Yes" if h.can_accept_tasks else "No"
            ])

    return output.getvalue()
