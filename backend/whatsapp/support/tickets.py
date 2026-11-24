"""Human handover: a WhatsApp Support request becomes a Customer Care case (the same cases, team and dashboard as the
calling agent's), with the customer, the booking and the conversation; the care team is told on WhatsApp.

The agent never approves a refund, cancels or reschedules by itself: those become cases for the team, who act in
ExtraHand under ExtraHand's own rules."""

from __future__ import annotations

import asyncio
import logging
import threading

from sqlalchemy.orm import Session

from app.models import CareMember, Escalation, Ticket, WaSupportConversation, WaSupportMessage
from app.services.common import log_event

from . import settings as support_settings

logger = logging.getLogger("whatsapp.support.tickets")

CATEGORIES = {
    "cancel_request": "Cancellation request",
    "reschedule_request": "Reschedule request",
    "helper_issue": "Helper problem",
    "payment_issue": "Payment problem",
    "incomplete_service": "Service not completed",
    "refund_request": "Refund request",
    "human_request": "Asked for a person",
    "unresolved": "AI could not answer",
    "other": "Other",
}


def clean_category(c: str | None) -> str:
    c = (c or "").strip().lower()
    return c if c in CATEGORIES else "other"


def transcript(db: Session, conv: WaSupportConversation, limit: int = 12) -> str:
    rows = (db.query(WaSupportMessage).filter(WaSupportMessage.conversation_id == conv.id)
            .order_by(WaSupportMessage.id.desc()).limit(limit).all())
    who = {"customer": "Customer", "ai": "AI", "human": "Team", "system": "System"}
    return "\n".join(f"{who.get(m.sender, m.sender)}: {m.text}" for m in reversed(rows))


def create_case(db: Session, conv: WaSupportConversation, category: str, summary: str,
                booking: dict | None = None, details: dict | None = None) -> Escalation:
    """Opens a Customer Care case for this conversation (one open case per conversation and category is reused)."""
    category = clean_category(category)
    booking_id = (booking or {}).get("booking_id")
    existing = (db.query(Escalation)
                .filter(Escalation.conversation_id == conv.id, Escalation.category == category,
                        Escalation.status != "resolved", Escalation.booking_id == booking_id)
                .first())
    lines = [f"{CATEGORIES[category]} from WhatsApp Support.", summary.strip()]
    if booking:
        lines.append("Booking: " + ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in booking.items()
                                            if k in ("booking_id", "booking_ref", "service", "status", "scheduled_date",
                                                     "scheduled_time", "amount_rupees", "helper_name")))
    for k, v in (details or {}).items():
        if v:
            lines.append(f"{k.replace('_', ' ').capitalize()}: {v}")
    lines.append("\nConversation:\n" + transcript(db, conv))
    text = "\n".join(x for x in lines if x)
    if existing:
        existing.details = text
        case = existing
    else:
        ticket_id = booking_id if booking_id and db.get(Ticket, booking_id) else None
        case = Escalation(ticket_id=ticket_id, reason=f"whatsapp_{category}"[:40], details=text, status="open",
                          source="whatsapp_test" if conv.is_test else "whatsapp", customer_name=conv.customer_name, customer_phone=conv.phone,
                          booking_id=booking_id, category=category, conversation_id=conv.id)
        db.add(case)
        db.flush()
        if ticket_id:
            log_event(db, ticket_id, "whatsapp_support_case", f"WhatsApp Support: {CATEGORIES[category]}")
    conv.escalation_id = case.id
    db.commit()
    if not existing and not conv.is_test:
        notify_care_team(db, case)
    return case


def notify_care_team(db: Session, case: Escalation) -> None:
    """Tells the care team (people with a phone number on the Care Team page) about a new case on WhatsApp.
    Best effort: WhatsApp only delivers free text to someone who wrote to the number in the last 24 hours."""
    if not support_settings.get(db)["notify_care"]:
        return
    phones = [m.phone for m in db.query(CareMember).filter(CareMember.active.is_(True)) if m.phone]
    if not phones:
        return
    text = (f"New WhatsApp Support case #{case.id}: {CATEGORIES.get(case.category or '', 'Request')}\n"
            f"Customer: {case.customer_name or 'Unknown'} (+{case.customer_phone})"
            + (f"\nBooking: {case.booking_id}" if case.booking_id else "")
            + "\nOpen Customer Care Cases in ExtraHand Intelligence to handle it.")

    def run() -> None:
        from whatsapp.meta_client import get_meta_whatsapp_client
        from whatsapp.metering import tagged

        async def send_all() -> None:
            meta = get_meta_whatsapp_client()
            with tagged("wa_support", "support_care_alert"):
                for p in phones:
                    try:
                        await meta.send_text_message(to=p, message=text, preview_url=False)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("[WhatsApp Support] care alert to %s failed: %s", p, exc)

        asyncio.run(send_all())

    threading.Thread(target=run, daemon=True, name=f"wa-support-alert-{case.id}").start()
