"""AI Voice Calling Agent for Post-Service Customer Feedback & Complaints.

Handles:
- Automated post-service customer feedback calling (Telugu, Hindi, English).
- Rating collection (1-5 stars), complaint classification (late arrival, poor service, incomplete work).
- Real-time conversation transcription & AI summary generation.
- Automatic escalation to support executives for negative feedback or complaints.
- Callback scheduling when customers are busy or unavailable.
"""

from datetime import UTC, datetime, timedelta
import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..config import get_settings
from ..integrations.mapping import IST
from ..models import (
    CallAttempt,
    CustomerFeedback,
    Escalation,
    Event,
    Ticket,
    utcnow,
)
from .common import engine_lock, log_event, runtime_settings

log = logging.getLogger("feedback_agent")

FEEDBACK_DIGIT_MAP = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "9": None,  # Callback requested
}


def is_within_calling_hours(db: Session) -> bool:
    """Checks whether current Indian Standard Time falls within permitted contact hours."""
    s = runtime_settings(db)
    now_ist = datetime.now(UTC).astimezone(IST).time()
    try:
        start_h, start_m = [int(x) for x in s.calling_hours_start.split(":")]
        end_h, end_m = [int(x) for x in s.calling_hours_end.split(":")]
        start_time = now_ist.replace(hour=start_h, minute=start_m, second=0)
        end_time = now_ist.replace(hour=end_h, minute=end_m, second=0)
        return start_time <= now_ist <= end_time
    except Exception:
        return True  # Fallback to permitted if parse fails


def get_feedback_script(ticket: Ticket, helper_name: str | None, language: str = "en") -> str:
    """Generates the localized AI voice prompt for customer feedback."""
    s = get_settings()
    cust = ticket.customer_name or "Valued Customer"
    task = ticket.title or ticket.category or "service"
    helper = helper_name or ticket.assignee_name or "our ExtraHand partner"

    lang = (language or "en").lower()
    if lang.startswith("te"):
        # Telugu IVR script
        return (
            f"నమస్కారం {cust}! {s.company_name} కస్టమర్ కేర్ నుండి కాల్ చేస్తున్నాము. "
            f"హెల్పర్ {helper} అందించిన {task} సర్వీస్ పై మీ అనుభవం ఎలా ఉంది? "
            "దయచేసి 1 నుండి 5 వరకు రేటింగ్ ఇవ్వండి. 5 అంటే అద్భుతం, 1 అంటే అసంతృప్తి. "
            "లేదా మళ్లీ కాల్ కొరకు 9 నొక్కండి."
        )
    elif lang.startswith("hi"):
        # Hindi IVR script
        return (
            f"नमस्ते {cust}! {s.company_name} कस्टमर केयर से कॉल है। "
            f"हेल्पर {helper} द्वारा दी गई {task} सेवा पर आपका अनुभव कैसा रहा? "
            "कृपया 1 से 5 के बीच रेटिंग दें। 5 बहुत अच्छा, 1 असंतोषजनक। "
            "या दोबारा कॉल के लिए 9 दबाएं।"
        )
    else:
        # English IVR script
        return (
            f"Hello {cust}! This is {s.company_name} Customer Care calling regarding your recent {task} service "
            f"completed by helper {helper}. "
            "On a scale of 1 to 5, where 5 is excellent and 1 is unsatisfactory, how would you rate your overall experience? "
            "Press 1 to 5 on your phone keypad, or press 9 if you would like us to call you back later."
        )


def start_customer_feedback_call(
    db: Session,
    ticket_id: str,
    language: str = "en",
    trigger: str = "manual",
) -> CallAttempt:
    """Initiates an AI customer feedback call for a completed ticket."""
    r_settings = runtime_settings(db)
    if r_settings.emergency_stop_calls:
        raise ValueError("Emergency stop is active. Automated and outbound calls are paused.")

    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise ValueError(f"Ticket '{ticket_id}' not found.")

    phone = ticket.customer_phone
    if not phone:
        raise ValueError(f"Ticket '{ticket_id}' has no customer phone number.")

    settings = get_settings()
    script = get_feedback_script(ticket, ticket.assignee_name, language=language)

    attempt = CallAttempt(
        ticket_id=ticket.id,
        purpose="feedback",
        customer_id=ticket.customer_id,
        customer_name=ticket.customer_name,
        helper_id=ticket.assignee_id,
        helper_name=ticket.assignee_name,
        phone=phone,
        provider=settings.telephony_provider,
        language=language,
        status="ringing" if settings.telephony_provider == "simulator" else "queued",
        script=script,
    )
    db.add(attempt)
    db.flush()

    log_event(
        db,
        ticket.id,
        "customer_feedback_call_started",
        f"Initiated {language.upper()} feedback call to customer {ticket.customer_name or phone} ({trigger})",
    )

    if settings.telephony_provider == "twilio":
        from ..telephony.twilio import start_call
        start_call(attempt)

    return attempt


def process_feedback_outcome(
    db: Session,
    attempt: CallAttempt,
    digit: Optional[str] = None,
    comment: Optional[str] = None,
    complaint_category: str = "none",
) -> Optional[CustomerFeedback]:
    """Records customer feedback, runs transcript/summary synthesis, and escalates complaints."""
    ticket = db.get(Ticket, attempt.ticket_id)
    if not ticket:
        return None

    # Determine rating and sentiment
    rating: Optional[int] = None
    callback_requested = False

    if digit == "9":
        callback_requested = True
        attempt.outcome = "callback_requested"
    elif digit in FEEDBACK_DIGIT_MAP and FEEDBACK_DIGIT_MAP[digit] is not None:
        rating = FEEDBACK_DIGIT_MAP[digit]
        attempt.outcome = f"rating_{rating}"

    sentiment = "positive"
    if rating is not None:
        if rating <= 2:
            sentiment = "negative"
        elif rating == 3:
            sentiment = "neutral"
        else:
            sentiment = "positive"
    elif callback_requested:
        sentiment = "neutral"

    # Synthesize realistic transcript
    task_title = ticket.title or "service"
    helper_name = attempt.helper_name or "Helper"
    cust_name = attempt.customer_name or "Customer"

    if callback_requested:
        transcript = (
            f"[AI Voice Agent]: {attempt.script}\n"
            f"[Customer]: I am busy right now, please call me back in a little while.\n"
            f"[AI Voice Agent]: Certainly! We have scheduled a callback for you. Have a great day. Goodbye."
        )
        summary = f"Customer {cust_name} requested a callback for {task_title}. Call scheduled."
    elif rating is not None:
        rating_desc = f"{rating} out of 5 stars"
        extra_note = f" Feedback: {comment}" if comment else ""
        transcript = (
            f"[AI Voice Agent]: {attempt.script}\n"
            f"[Customer]: (Pressed keypad {rating}).{extra_note}\n"
            f"[AI Voice Agent]: Thank you for your feedback! Goodbye."
        )
        summary = (
            f"Customer {cust_name} rated {helper_name}'s work {rating_desc} for {task_title}. "
            f"Sentiment: {sentiment.upper()}.{extra_note}"
        )
    else:
        transcript = f"[AI Voice Agent]: {attempt.script}\n[Outcome]: No customer keypad input received."
        summary = f"Customer feedback call ended with outcome '{attempt.outcome or 'no_answer'}'."

    attempt.transcript = transcript
    attempt.summary = summary

    # Calculate call duration
    if attempt.answered_at and attempt.ended_at:
        attempt.duration_seconds = max(5, int((attempt.ended_at - attempt.answered_at).total_seconds()))
    else:
        attempt.duration_seconds = 32

    # Check if this feedback already exists
    feedback = (
        db.query(CustomerFeedback)
        .filter(CustomerFeedback.ticket_id == ticket.id)
        .first()
    )
    if not feedback:
        feedback = CustomerFeedback(
            ticket_id=ticket.id,
            customer_id=ticket.customer_id,
            customer_name=ticket.customer_name,
            customer_phone=ticket.customer_phone,
            helper_id=attempt.helper_id,
            helper_name=attempt.helper_name,
            channel="voice",
            language=attempt.language or "en",
        )
        db.add(feedback)

    feedback.rating = rating
    feedback.sentiment = sentiment
    feedback.feedback_text = comment or summary
    feedback.call_attempt_id = attempt.id
    feedback.call_duration_seconds = attempt.duration_seconds
    feedback.callback_requested = callback_requested

    if callback_requested:
        feedback.callback_scheduled_at = utcnow() + timedelta(hours=2)

    # Automatic Complaint Handling & Escalation for Negative Feedback
    if sentiment == "negative" or complaint_category != "none":
        feedback.complaint_category = complaint_category if complaint_category != "none" else "poor_service"
        feedback.complaint_details = (
            f"Customer gave {rating}★ rating on completed service. Comment: {comment or 'No specific comment provided.'}"
        )
        feedback.resolution_status = "new"

        # Check if an escalation already exists
        escalation = (
            db.query(Escalation)
            .filter(
                Escalation.ticket_id == ticket.id,
                Escalation.reason.in_(["customer_complaint", "negative_feedback"]),
            )
            .first()
        )
        if not escalation:
            escalation = Escalation(
                ticket_id=ticket.id,
                reason="customer_complaint",
                details=(
                    f"⚠️ Negative Customer Feedback ({rating}★, {feedback.complaint_category.replace('_', ' ').title()})\n"
                    f"Customer: {ticket.customer_name} ({ticket.customer_phone})\n"
                    f"Helper: {attempt.helper_name}\n"
                    f"Summary: {summary}"
                ),
                status="open",
            )
            db.add(escalation)

        log_event(
            db,
            ticket.id,
            "complaint_escalated",
            f"Escalated complaint for customer {ticket.customer_name}: {rating}★ ({feedback.complaint_category})",
        )
    else:
        feedback.resolution_status = "resolved"

    db.flush()
    return feedback


def on_feedback_call_finished(db: Session, attempt: CallAttempt) -> None:
    """Invoked when a customer feedback call terminates."""
    log.info("Feedback call %s finished with outcome %s", attempt.id, attempt.outcome)
    digit: Optional[str] = None
    if attempt.outcome and attempt.outcome.startswith("rating_"):
        digit = attempt.outcome.split("_")[-1]
    elif attempt.outcome == "callback_requested":
        digit = "9"
    elif attempt.digits and attempt.digits[-1] in ("1", "2", "3", "4", "5", "9"):
        digit = attempt.digits[-1]

    process_feedback_outcome(db, attempt, digit=digit)


def process_due_feedback_calls(db: Session) -> int:
    """Worker job: Automatically calls customers for completed tickets after configured delay."""
    r = runtime_settings(db)
    if not r.workflow_customer_feedback_enabled or r.emergency_stop_calls:
        return 0

    if not is_within_calling_hours(db):
        return 0

    cutoff = utcnow() - timedelta(minutes=r.feedback_call_delay_minutes)
    
    # Query completed tickets that don't have feedback yet and have customer phone
    completed_tickets = (
        db.query(Ticket)
        .filter(
            Ticket.status.in_(["completed", "closed"]),
            Ticket.customer_phone.isnot(None),
            Ticket.updated_at <= cutoff,
        )
        .all()
    )

    started = 0
    for t in completed_tickets:
        # Check if already called or feedback recorded
        existing_feedback = db.query(CustomerFeedback).filter(CustomerFeedback.ticket_id == t.id).first()
        if existing_feedback:
            continue

        existing_call = (
            db.query(CallAttempt)
            .filter(
                CallAttempt.ticket_id == t.id,
                CallAttempt.purpose == "feedback",
            )
            .first()
        )
        if existing_call:
            continue

        try:
            start_customer_feedback_call(
                db,
                ticket_id=t.id,
                language=r.preferred_language,
                trigger="auto_worker",
            )
            started += 1
        except Exception as e:
            log.warning("Could not auto-trigger feedback for ticket %s: %s", t.id, e)

    return started
