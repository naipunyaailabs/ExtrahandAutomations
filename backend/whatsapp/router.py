import hmac
import io
import logging
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .models import (
    BulkMessageItemResult,
    BulkMessageRequest,
    BulkMessageResponse,
    BulkRecipient,
    OpenWASessionStatus,
    ParsedContact,
    ParseContactsResponse,
    SendTemplatePayload,
    WhatsAppDispatchPayload,
    WhatsAppMessageResponse,
    WhatsAppTextMessage,
)
from .meta_client import get_meta_whatsapp_client
from .service import get_whatsapp_service

logger = logging.getLogger("whatsapp.router")

router = APIRouter(prefix="/api/whatsapp", tags=["WhatsApp Automation"])

# In-memory runtime state for channels (Automation and Bulk Messaging)
_whatsapp_channels = {
    "automation_active": True,
    "bulk_active": True,
}


class ChannelControlsPayload(BaseModel):
    automation_active: Optional[bool] = None
    bulk_active: Optional[bool] = None


@router.get("/channel-controls")
async def get_whatsapp_channel_controls():
    """Retrieve active/inactive status for Automation and Bulk messaging."""
    return _whatsapp_channels


@router.post("/channel-controls")
async def update_whatsapp_channel_controls(payload: ChannelControlsPayload):
    """Toggle active/inactive status for Automation or Bulk messaging."""
    if payload.automation_active is not None:
        _whatsapp_channels["automation_active"] = bool(payload.automation_active)
    if payload.bulk_active is not None:
        _whatsapp_channels["bulk_active"] = bool(payload.bulk_active)
    logger.info("[WhatsApp Channel Controls Updated] %s", _whatsapp_channels)
    return _whatsapp_channels


@router.get("/flow")
def whatsapp_flow_today():
    """WhatsApp Dispatch flow for today (India time): real-customer orders live from ExtraHand, helpers who can
    take today's open orders, and real / simulated / failed WhatsApp sends from the dispatch log."""
    from app.database import SessionLocal
    from app.services.dispatch_flow import whatsapp_flow

    db = SessionLocal()
    try:
        return whatsapp_flow(db)
    finally:
        db.close()


@router.get("/status")
async def check_whatsapp_status(session_id: str | None = None):
    """Check Meta WhatsApp Cloud API status, connection and message stats."""
    import re
    from datetime import datetime
    from app.database import SessionLocal
    from app.models import Event, utcnow

    meta = get_meta_whatsapp_client()
    status_info = meta.get_status()

    # Include channel control statuses
    status_info["automation_active"] = _whatsapp_channels.get("automation_active", True)
    status_info["bulk_active"] = _whatsapp_channels.get("bulk_active", True)

    db = SessionLocal()
    try:
        # Real sends only (simulated sends were never delivered); today = India time
        from app.services.dispatch_flow import whatsapp_send_counts

        counts = whatsapp_send_counts(db)
        today_msgs, total_msgs = counts["sent"]["today"], counts["sent"]["total"]
        status_info["messages_simulated_total"] = counts["simulated"]["total"]
        status_info["messages_failed_total"] = counts["failed"]["total"]
        status_info["messages_today"] = today_msgs
        status_info["messages_total"] = total_msgs
        # Delivery receipts are not tracked yet, so no rate is reported.
        status_info["delivery_rate"] = None
    except Exception as exc:
        logger.exception("Error calculating whatsapp message stats: %s", exc)
        status_info["messages_today"] = None
        status_info["messages_total"] = None
        status_info["delivery_rate"] = None
    finally:
        db.close()

    return status_info


@router.get("/webhook")
async def verify_meta_webhook(request: Request):
    """Meta WhatsApp Cloud API Webhook handshake verification."""
    from app.config import get_settings
    settings = get_settings()
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    verify_token = settings.meta_wa_webhook_verify_token
    if not verify_token:
        raise HTTPException(status_code=503, detail="META_WA_WEBHOOK_VERIFY_TOKEN is not set in backend/.env")
    if mode == "subscribe" and token and hmac.compare_digest(token, verify_token):
        logger.info("[Meta Webhook Verified] Successfully subscribed to Meta WhatsApp webhook.")
        return PlainTextResponse(content=challenge or "")
    raise HTTPException(status_code=403, detail="Verification token mismatch")


@router.post("/webhook")
async def receive_meta_webhook(request: Request):
    """Handles incoming WhatsApp messages and delivery receipts from Meta Cloud API."""
    try:
        data = await request.json()
        logger.info("[Meta Inbound Webhook Received] %s", data)
        # Parse incoming message if available
        entry = data.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        val = changes.get("value", {})
        messages = val.get("messages", [])
        if messages:
            msg = messages[0]
            from_phone = msg.get("from")
            body = msg.get("text", {}).get("body", "")
            logger.info("[Meta Incoming WhatsApp] From +%s: %s", from_phone, body)
        return {"status": "ok"}
    except Exception as e:
        logger.exception("[Meta Webhook Error] %s", e)
        return {"status": "error", "message": str(e)}


@router.post("/send-message", response_model=WhatsAppMessageResponse)
async def send_whatsapp_message(payload: WhatsAppTextMessage):
    """Send a manual or test WhatsApp text message via Meta Cloud API."""
    meta = get_meta_whatsapp_client()
    return await meta.send_text_message(to=payload.to, message=payload.message)


@router.post("/send-dispatch", response_model=WhatsAppMessageResponse)
async def dispatch_whatsapp_work_order(payload: WhatsAppDispatchPayload):
    """Send formal WhatsApp Work Order to partner with deep link."""
    if not _whatsapp_channels.get("automation_active", True):
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Automation is currently INACTIVE. Turn on Automation at the top to send work orders.",
        )
    service = get_whatsapp_service()
    return await service.dispatch_work_order(payload)


class BroadcastTaskPayload(BaseModel):
    ticket_id: str
    radius_km: Optional[float] = None


@router.get("/task-candidates/{ticket_id}")
async def get_task_location_candidates(ticket_id: str, radius_km: Optional[float] = None):
    """Retrieve helper candidates filtered by location and trade service taxonomy."""
    from .agent import get_whatsapp_dispatch_agent
    from app.database import SessionLocal
    from app.models import Ticket
    agent = get_whatsapp_dispatch_agent()
    db = SessionLocal()
    try:
        ticket = db.get(Ticket, ticket_id)
        if not ticket:
            raise HTTPException(status_code=404, detail=f"Ticket #{ticket_id} not found.")
        candidates = agent.filter_eligible_partners(db, ticket, max_radius_km=radius_km)
        loc = ticket.address or ticket.city or ""
        service = ticket.category or ticket.title or "General"
        return {
            "ticket_id": ticket.id,
            "task_title": ticket.title or "",
            "category": ticket.category or "",
            "city": ticket.city or "",
            "location": loc,
            "service": service,
            "helpers_count": len(candidates),
            "candidates_count": len(candidates),
            "helpers": candidates,
            "candidates": candidates,
        }
    finally:
        db.close()


@router.post("/broadcast-task")
async def broadcast_task_direct(payload: BroadcastTaskPayload):
    """Broadcast task via WhatsApp to all matched location & service helpers."""
    if not _whatsapp_channels.get("automation_active", True):
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Automation is currently INACTIVE. Turn on Automation at the top to broadcast tasks.",
        )
    from .agent import get_whatsapp_dispatch_agent
    agent = get_whatsapp_dispatch_agent()
    res = await agent.broadcast_task_async(payload.ticket_id, radius_km=payload.radius_km)
    if not res.get("ok") and "not exist" in res.get("error", "").lower():
        raise HTTPException(status_code=404, detail=res["error"])
    return res


@router.post("/broadcast-location-task/{ticket_id}")
async def broadcast_location_task(ticket_id: str, radius_km: Optional[float] = None):
    """Broadcast newly uploaded task via WhatsApp."""
    if not _whatsapp_channels.get("automation_active", True):
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Automation is currently INACTIVE. Turn on Automation at the top to broadcast tasks.",
        )
    from .agent import get_whatsapp_dispatch_agent
    agent = get_whatsapp_dispatch_agent()
    res = await agent.broadcast_task_async(ticket_id, radius_km=radius_km)
    if not res.get("ok") and "not exist" in res.get("error", "").lower():
        raise HTTPException(status_code=404, detail=res["error"])
    return res


@router.post("/agent/dispatch-task/{ticket_id}")
async def agent_dispatch_task(ticket_id: str, radius_km: Optional[float] = None):
    """Trigger the autonomous Python Dispatch Agent for a specific task."""
    if not _whatsapp_channels.get("automation_active", True):
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Automation is currently INACTIVE. Turn on Automation at the top to dispatch tasks.",
        )
    from .agent import get_whatsapp_dispatch_agent
    agent = get_whatsapp_dispatch_agent()
    res = await agent.broadcast_task_async(ticket_id, radius_km=radius_km)
    if not res.get("ok") and "not exist" in res.get("error", "").lower():
        raise HTTPException(status_code=404, detail=res["error"])
    return res


_TEMPLATE_DEFS = [
    {
        "id": "booking_confirmation",
        "name": "Booking Confirmation",
        "category": "Customer Updates",
        "language": "en",
        "template": "Dear {customer_name}, your {company} booking #{ticket_id} for '{title}' is confirmed! Our smart multi-agent system is matching the best verified helper near you. View updates: {app_url}",
        "variables": ["customer_name", "ticket_id", "title", "app_url"],
    },
    {
        "id": "helper_assignment",
        "name": "Helper Assigned Notification",
        "category": "Customer Updates",
        "language": "en",
        "template": "Good news {customer_name}! Helper {helper_name} ({helper_phone}) has been assigned to your booking #{ticket_id}. Scheduled time: {scheduled_time}. Location: {location}.",
        "variables": ["customer_name", "helper_name", "helper_phone", "ticket_id", "scheduled_time", "location"],
    },
    {
        "id": "service_reminder",
        "name": "Service Reminder Call / Text",
        "category": "Reminders",
        "language": "en",
        "template": "Reminder: Your {company} service for '{title}' starts in 1 hour at {location}. Helper: {helper_name}. Need assistance? Reply HELP.",
        "variables": ["title", "location", "helper_name"],
    },
    {
        "id": "customer_feedback_survey",
        "name": "Post-Service Customer Feedback",
        "category": "Feedback & CSAT",
        "language": "en",
        "template": "Hi {customer_name}! How was your service experience with helper {helper_name} for #{ticket_id}? Please rate from 1 to 5 by replying with a number (5 = Excellent, 1 = Poor). Your feedback helps us maintain top quality!",
        "variables": ["customer_name", "helper_name", "ticket_id"],
    },
    {
        "id": "promotional_offer",
        "name": "Festive Promotion & Discount",
        "category": "Marketing & Promotions",
        "language": "en",
        "template": "Namaste {name}! 🎉 {company} is offering an exclusive {currency}{discount} discount on all home maintenance, plumbing, and electrical services this week. Book your expert partner now: {link}. Reply STOP to unsubscribe.",
        "variables": ["name", "discount", "link"],
    },
    {
        "id": "bulk_announcement",
        "name": "General Broadcast Announcement",
        "category": "Announcements",
        "language": "en",
        "template": "Hello {name}, this is an important service alert from {company}: {message}. Please reach out if you have any questions or reply directly here. Thank you for choosing {company}!",
        "variables": ["name", "message"],
    },
]


def approved_templates() -> list[dict]:
    """Templates with brand and currency filled in from settings."""
    from app.config import get_settings
    st = get_settings()
    return [
        {**t, "template": t["template"].replace("{company}", st.company_name).replace("{currency}", st.currency_symbol)}
        for t in _TEMPLATE_DEFS
    ]


def clean_and_validate_phone(raw: Any) -> tuple[bool, str, str]:
    """
    Validates and standardizes a phone number to E.164.
    Local numbers get DEFAULT_COUNTRY_CODE from settings.
    Returns (is_valid, formatted_phone, reason).
    """
    if raw is None or str(raw).strip() == "" or str(raw).strip().lower() == "nan":
        return False, "", "Empty number"

    raw_str = str(raw).strip()
    # Normalize scientific notation from Excel (e.g. 9.87654E+09)
    try:
        if "e" in raw_str.lower() and "." in raw_str:
            raw_str = str(int(float(raw_str)))
    except Exception:
        pass

    # Remove floating point trailing .0
    if raw_str.endswith(".0"):
        raw_str = raw_str[:-2]

    # Extract digits and leading +
    has_plus = raw_str.startswith("+")
    digits = re.sub(r"[^\d]", "", raw_str)

    if not digits:
        return False, raw_str, "No numeric digits found"

    # Local numbers get the configured DEFAULT_COUNTRY_CODE / PHONE_LOCAL_DIGITS
    from app.config import get_settings
    st = get_settings()
    cc = re.sub(r"[^\d]", "", st.default_country_code)
    local_len = st.phone_local_digits
    label = f"Valid (+{cc})"

    if len(digits) == local_len and not has_plus:
        return True, f"+{cc}{digits}", label

    # Local number with trunk prefix 0
    if len(digits) == local_len + 1 and digits.startswith("0"):
        return True, f"+{cc}{digits[1:]}", label

    # Country code without +
    if len(digits) == local_len + len(cc) and digits.startswith(cc):
        return True, f"+{digits}", label

    # General E.164 (10 to 15 digits)
    if 10 <= len(digits) <= 15:
        return True, f"+{digits}", "Valid (E.164)"

    return False, raw_str, f"Invalid length ({len(digits)} digits; expected 10-15 digits)"


@router.get("/templates")
def list_approved_templates():
    """List approved Meta WhatsApp message templates."""
    return approved_templates()


@router.post("/send-template", response_model=WhatsAppMessageResponse)
async def send_template_message(payload: SendTemplatePayload):
    """Send an approved WhatsApp template with dynamic variables."""
    meta = get_meta_whatsapp_client()
    # Find matching template
    tmpl = next((t for t in approved_templates() if t["id"] == payload.template_id), None)
    if not tmpl:
        raise HTTPException(status_code=404, detail=f"Unknown template '{payload.template_id}'")
    text = tmpl["template"]
    
    # Merge variables
    variables = payload.variables or {}
    for k, v in variables.items():
        text = text.replace(f"{{{k}}}", str(v))
    
    return await meta.send_text_message(to=payload.to, message=text)


@router.post("/parse-contacts", response_model=ParseContactsResponse)
async def parse_contacts_file(file: UploadFile = File(...)):
    """
    Parses an uploaded spreadsheet (.xlsx, .xls, .csv, .tsv) or text file
    to extract and validate phone numbers and contact names.
    """
    import pandas as pd

    filename = file.filename or "uploaded_contacts.xlsx"
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    df: Optional[pd.DataFrame] = None
    try:
        lower_name = filename.lower()
        if lower_name.endswith(".csv") or lower_name.endswith(".txt"):
            # Try comma or semicolon or tab
            try:
                df = pd.read_csv(io.BytesIO(contents), dtype=str)
            except Exception:
                df = pd.read_csv(io.BytesIO(contents), dtype=str, sep=";")
        elif lower_name.endswith(".tsv"):
            df = pd.read_csv(io.BytesIO(contents), dtype=str, sep="\t")
        elif lower_name.endswith(".xlsx") or lower_name.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents), dtype=str, engine="openpyxl")
        else:
            # Fallback: try excel first then csv
            try:
                df = pd.read_excel(io.BytesIO(contents), dtype=str)
            except Exception:
                df = pd.read_csv(io.BytesIO(contents), dtype=str)
    except Exception as exc:
        logger.exception("Failed to parse contacts file: %s", exc)
        raise HTTPException(
            status_code=400,
            detail=f"Unable to read file '{filename}'. Please ensure it is a valid .xlsx, .xls, or .csv file: {str(exc)}",
        )

    if df is None or df.empty:
        return ParseContactsResponse(
            total_rows=0,
            valid_count=0,
            invalid_count=0,
            detected_columns=[],
            contacts=[],
            filename=filename,
        )

    columns = [str(c).strip() for c in df.columns]
    
    # Identify phone column
    phone_col: Optional[str] = None
    phone_patterns = [
        r"(?i)\bphone\b", r"(?i)\bmobile\b", r"(?i)\bcontact\b", r"(?i)\bwhatsapp\b",
        r"(?i)\bnumber\b", r"(?i)\btel\b", r"(?i)\bcell\b"
    ]
    for col in columns:
        if any(re.search(pat, col) for pat in phone_patterns):
            phone_col = col
            break

    # If no phone header pattern matches, inspect first 5 non-null rows of each column
    if not phone_col:
        for col in columns:
            sample_vals = df[col].dropna().astype(str).head(10).tolist()
            digit_matches = 0
            for val in sample_vals:
                d = re.sub(r"[^\d]", "", val)
                if len(d) >= 9:
                    digit_matches += 1
            if sample_vals and (digit_matches / len(sample_vals)) >= 0.5:
                phone_col = col
                break

    # Fallback to first column if still not detected
    if not phone_col and columns:
        phone_col = columns[0]

    # Identify name column
    name_col: Optional[str] = None
    name_patterns = [
        r"(?i)\bname\b", r"(?i)\bfull_?name\b", r"(?i)\bfirst_?name\b",
        r"(?i)\bcustomer\b", r"(?i)\bhelper\b", r"(?i)\brecipient\b", r"(?i)\buser\b"
    ]
    for col in columns:
        if col != phone_col and any(re.search(pat, col) for pat in name_patterns):
            name_col = col
            break

    parsed_contacts: List[ParsedContact] = []
    valid_count = 0
    invalid_count = 0

    for idx, row in df.iterrows():
        raw_phone = row[phone_col] if phone_col and phone_col in row else ""
        raw_name = row[name_col] if name_col and name_col in row else None

        if raw_name is not None:
            clean_name = str(raw_name).strip()
            if clean_name.lower() in ("nan", "none", ""):
                clean_name = None
        else:
            clean_name = None

        is_valid, formatted_phone, reason = clean_and_validate_phone(raw_phone)
        if is_valid:
            valid_count += 1
        else:
            # Skip completely empty trailing rows
            if not str(raw_phone).strip() or str(raw_phone).strip().lower() == "nan":
                continue
            invalid_count += 1

        parsed_contacts.append(
            ParsedContact(
                phone=formatted_phone if is_valid else str(raw_phone),
                name=clean_name,
                is_valid=is_valid,
                formatted_phone=formatted_phone,
                original_phone=str(raw_phone),
                row=int(idx) + 2,  # 1-indexed row with header
                reason=reason,
            )
        )

    return ParseContactsResponse(
        total_rows=len(parsed_contacts),
        valid_count=valid_count,
        invalid_count=invalid_count,
        detected_phone_column=phone_col,
        detected_name_column=name_col,
        detected_columns=columns,
        contacts=parsed_contacts,
        filename=filename,
    )


@router.post("/send-bulk", response_model=BulkMessageResponse)
async def send_bulk_whatsapp_messages(payload: BulkMessageRequest):
    """
    Dispatches bulk WhatsApp messages to a list of recipients with
    custom dynamic tag variable interpolation and delivery tracking.
    """
    if not _whatsapp_channels.get("bulk_active", True):
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Bulk Messaging is currently INACTIVE. Turn on Bulk Msgs at the top to send messages.",
        )
    from app.database import SessionLocal
    from app.models import Event

    meta = get_meta_whatsapp_client()
    results: List[BulkMessageItemResult] = []
    sent_count = 0
    simulated_count = 0
    failed_count = 0

    global_vars = payload.variables or {}

    for item in payload.recipients:
        # Validate recipient phone
        is_valid, clean_phone, _ = clean_and_validate_phone(item.phone)
        if not is_valid:
            results.append(
                BulkMessageItemResult(
                    phone=item.phone,
                    name=item.name,
                    status="failed",
                    error="Invalid phone format",
                )
            )
            failed_count += 1
            continue

        # Dynamic variable interpolation
        msg_text = payload.message
        name_val = item.name or "there"
        msg_text = msg_text.replace("{name}", name_val)
        msg_text = msg_text.replace("{phone}", clean_phone)

        # Recipient specific custom vars
        if item.custom_vars:
            for k, v in item.custom_vars.items():
                msg_text = msg_text.replace(f"{{{k}}}", str(v))

        # Global template vars
        for k, v in global_vars.items():
            msg_text = msg_text.replace(f"{{{k}}}", str(v))

        # Dispatch message
        try:
            resp = await meta.send_text_message(to=clean_phone, message=msg_text)
            if resp.status in ("sent", "delivered"):
                sent_count += 1
                results.append(
                    BulkMessageItemResult(
                        phone=clean_phone,
                        name=item.name,
                        status="sent",
                        message_id=resp.message_id,
                    )
                )
            elif resp.status == "simulated":
                simulated_count += 1
                sent_count += 1  # count simulated as successful in test mode
                results.append(
                    BulkMessageItemResult(
                        phone=clean_phone,
                        name=item.name,
                        status="simulated",
                        message_id=resp.message_id,
                    )
                )
            else:
                failed_count += 1
                results.append(
                    BulkMessageItemResult(
                        phone=clean_phone,
                        name=item.name,
                        status="failed",
                        error=resp.error or "Delivery failed",
                    )
                )
        except Exception as exc:
            logger.exception("Failed dispatching bulk message to %s: %s", clean_phone, exc)
            failed_count += 1
            results.append(
                BulkMessageItemResult(
                    phone=clean_phone,
                    name=item.name,
                    status="failed",
                    error=str(exc),
                )
            )

    # Log to database Event
    db = SessionLocal()
    try:
        ev = Event(
            kind="whatsapp.bulk_broadcast",
            message=f"Bulk WhatsApp broadcast: {sent_count} sent, {failed_count} failed out of {len(payload.recipients)} contacts",
        )
        db.add(ev)
        db.commit()
    except Exception as exc:
        logger.warning("Could not record bulk event: %s", exc)
        db.rollback()
    finally:
        db.close()

    return BulkMessageResponse(
        ok=True,
        total=len(payload.recipients),
        sent_count=sent_count,
        failed_count=failed_count,
        simulated_count=simulated_count,
        results=results,
    )
