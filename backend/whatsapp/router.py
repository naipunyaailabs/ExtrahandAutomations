import hmac
import io
import json
import logging
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field
import time
import uuid
from pathlib import Path

from app.config import BACKEND_DIR, get_settings, public_base_url

from .models import (
    BulkMessageItemResult,
    BulkMessageRequest,
    BulkMessageResponse,
    BulkRecipient,
    ParsedContact,
    ParseContactsResponse,
    SendTemplatePayload,
    WhatsAppDispatchPayload,
    WhatsAppMessageResponse,
    WhatsAppTextMessage,
)
from .meta_client import get_meta_whatsapp_client
from .metering import apply_webhook, tagged
from .service import get_whatsapp_service

logger = logging.getLogger("whatsapp.router")

router = APIRouter(prefix="/api/whatsapp", tags=["WhatsApp Automation"])

BANNER_DIR = Path(get_settings().whatsapp_banners_dir)
BANNER_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload-banner")
async def upload_whatsapp_banner(file: UploadFile = File(...)):
    """Uploads a campaign banner image for WhatsApp templates."""
    ext = Path(file.filename or "image.jpg").suffix.lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    filename = f"wa_banner_{int(time.time())}_{uuid.uuid4().hex[:6]}{ext}"
    content = await file.read()
    mime_type = "image/png" if ext == ".png" else "image/jpeg"
    from app.services import media_store

    media_store.put("whatsapp_banners", filename, content, mime_type)

    meta = get_meta_whatsapp_client()
    meta_media_id = await meta.upload_media(content, filename=filename, mime_type=mime_type)

    base = public_base_url()
    public_url = f"{base}/api/whatsapp/banners/{filename}" if base else f"/api/whatsapp/banners/{filename}"
    return {
        "url": public_url,
        "preview_url": f"/api/whatsapp/banners/{filename}",
        "filename": filename,
        "meta_media_id": meta_media_id,
    }


@router.get("/brand-header.jpg")
def get_brand_header():
    """ExtraHand logo + name header image, sent when a campaign has no banner of its own."""
    from .meta_client import BRAND_HEADER

    return FileResponse(BRAND_HEADER, media_type="image/jpeg")


@router.get("/banners/{filename}")
def get_whatsapp_banner(filename: str):
    """Serves uploaded WhatsApp campaign banners publicly for Meta Graph API fetch."""
    from app.services import media_store

    data = media_store.get("whatsapp_banners", filename)
    if data is None:
        raise HTTPException(404, "Banner not found")
    return Response(content=data, media_type=media_store.media_type(filename),
                    headers={"Cache-Control": "public, max-age=86400"})

# Automation and Bulk Messaging are independent switches, persisted in runtime settings.
# Both start DEACTIVE; nothing is sent until someone clicks Activate.
_CHANNEL_KEYS = {"automation_active": "whatsapp_automation_active", "bulk_active": "whatsapp_bulk_active"}


def _channel_states() -> Dict[str, bool]:
    from app.database import SessionLocal
    from app.services.common import runtime_settings

    with SessionLocal() as db:
        r = runtime_settings(db)
        return {k: bool(getattr(r, v)) for k, v in _CHANNEL_KEYS.items()}


def _channel_active(channel: str) -> bool:
    return _channel_states().get(channel, False)


class ChannelControlsPayload(BaseModel):
    automation_active: Optional[bool] = None
    bulk_active: Optional[bool] = None


@router.get("/channel-controls")
async def get_whatsapp_channel_controls():
    """Retrieve active/inactive status for Automation and Bulk messaging."""
    return _channel_states()


@router.post("/channel-controls")
async def update_whatsapp_channel_controls(payload: ChannelControlsPayload):
    """Toggle active/inactive status for Automation or Bulk messaging (each independently)."""
    from app.database import SessionLocal
    from app.services.common import save_runtime_settings

    values = {
        _CHANNEL_KEYS[k]: bool(v)
        for k, v in payload.model_dump().items()
        if v is not None
    }
    if values:
        with SessionLocal() as db:
            save_runtime_settings(db, values)
            db.commit()
    states = _channel_states()
    logger.info("[WhatsApp Channel Controls Updated] %s", states)
    return states


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
async def check_whatsapp_status():
    """Check Meta WhatsApp Cloud API status, connection and message stats."""
    import re
    from datetime import datetime
    from app.database import SessionLocal
    from app.models import Event, utcnow

    meta = get_meta_whatsapp_client()
    status_info = meta.get_status()

    # Include channel control statuses
    status_info.update(_channel_states())

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
    from .support.webhook import handle_webhook as _support_webhook
    from .support.webhook import signature_ok

    raw = await request.body()
    if not signature_ok(raw, request.headers.get("X-Hub-Signature-256")):
        # Meta signs every call with the app secret (META_APP_SECRET): anything else is not from Meta
        logger.warning("[Meta Webhook] Refused a call with a missing or wrong signature")
        raise HTTPException(status_code=403, detail="Invalid signature")
    try:
        data = json.loads(raw or b"{}")
        logger.info("[Meta Inbound Webhook Received] %s", data)
        apply_webhook(data)  # delivery / read / failure / pricing reports and inbound messages, for the commercials pages
        from .cancel_followup import apply_cancel_followup_webhook
        from .feedback import apply_feedback_webhook

        apply_cancel_followup_webhook(data)  # answers to the cancellation reason form (Cancellation Follow-up)
        apply_feedback_webhook(data)  # answers to the customer feedback form (Reviews & Feedback)
        # Parse incoming message if available
        entry = data.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        val = changes.get("value", {})
        messages = val.get("messages", [])
        if messages:
            msg = messages[0]
            from_phone = msg.get("from")
            body = msg.get("text", {}).get("body", "") or (msg.get("button") or {}).get("text", "")
            logger.info("[Meta Incoming WhatsApp] From +%s: %s", from_phone, body)
            from marketing.task_seeding import handle_inbound_text

            handle_inbound_text(from_phone, body)  # STOP: no more Task-Seeding messages or calls
        try:
            _support_webhook(data)  # WhatsApp Support: the AI customer support agent (whatsapp/support/)
        except Exception:  # noqa: BLE001 - never let the agent break the other flows
            logger.exception("[WhatsApp Support] webhook handling failed")
        return {"status": "ok"}
    except Exception as e:
        logger.exception("[Meta Webhook Error] %s", e)
        return {"status": "error", "message": str(e)}


@router.post("/send-message", response_model=WhatsAppMessageResponse)
async def send_whatsapp_message(payload: WhatsAppTextMessage):
    """Send a manual or test WhatsApp text message via Meta Cloud API."""
    meta = get_meta_whatsapp_client()
    with tagged("manual", "manual_message"):
        return await meta.send_text_message(to=payload.to, message=payload.message)


@router.post("/send-dispatch", response_model=WhatsAppMessageResponse)
async def dispatch_whatsapp_work_order(payload: WhatsAppDispatchPayload):
    """Send formal WhatsApp Work Order to partner with deep link."""
    if not _channel_active("automation_active"):
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Automation is currently INACTIVE. Turn on Automation at the top to send work orders.",
        )
    from app.database import SessionLocal
    from app.models import Ticket
    from app.services.common import log_event
    from .agent import get_whatsapp_dispatch_agent

    meta = get_meta_whatsapp_client()
    name = (payload.helper_name or "").strip() or "Partner"
    db = SessionLocal()
    try:
        ticket = db.get(Ticket, payload.ticket_id)
        task_title = payload.task_title or (ticket.title if ticket else "Home Service Task")
        category = (ticket.category if ticket else "Service") or "Home Maintenance"
        location = payload.location or (ticket.city if ticket else "Hyderabad")

        with tagged("automation", "work_order", payload.ticket_id):
            # 1. Dispatch official pre-approved Meta Template (delivers to cold numbers)
            resp = await meta.send_template_message(
                to=payload.helper_phone,
                template_name="extrahand_nearby_work_skill_match",
                variables={
                    "1": task_title,
                    "2": category,
                    "3": location,
                    "name": name,
                    "ticket_id": payload.ticket_id,
                },
                button_slug=str(payload.ticket_id),
            )
            # 2. Fallback to free-form text if template fails
            if resp.status == "failed" and "template" in (resp.error or "").lower():
                msg = (f"Hello {name.split()[0]}, a new work order is available.\n"
                       f"Task: {task_title}\nLocation: {location}\nWhen: {payload.scheduled_time}\n"
                       f"Payout: {payload.payout}\n_Reply 'YES' to accept or 'PASS' to decline._")
                resp = await meta.send_text_message(to=payload.helper_phone, message=msg)

        sent = int(resp.status in ("sent", "delivered"))
        simulated = int(resp.status == "simulated")
        if ticket:
            log_event(db, ticket.id, "whatsapp_work_order",
                      f"Work order sent to {name} ({payload.helper_phone}). "
                      f"Status: {sent} sent, {simulated} simulated, {1 - sent - simulated} failed.")
            db.commit()
        return resp
    finally:
        db.close()


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
    if not _channel_active("automation_active"):
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
    if not _channel_active("automation_active"):
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
    if not _channel_active("automation_active"):
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
async def list_approved_templates():
    """List approved Meta WhatsApp message templates, syncing live from Meta WABA."""
    meta = get_meta_whatsapp_client()
    if meta.is_configured and not meta.simulated:
        try:
            live_meta_templates = await meta.fetch_meta_templates()
            real_templates = []
            for m in live_meta_templates:
                if m.get("status") == "APPROVED":
                    name = m.get("name")
                    body_comp = next((c for c in m.get("components", []) if c.get("type") == "BODY"), {})
                    real_templates.append({
                        "id": name,
                        "name": name.replace("_", " ").title(),
                        "category": m.get("category", "MARKETING"),
                        "language": m.get("language", "en"),
                        "status": "APPROVED",
                        "template": body_comp.get("text", ""),
                    })
            if real_templates:
                return real_templates
        except Exception as e:
            logger.warning("Could not sync live Meta templates: %s", e)
    return approved_templates()


@router.post("/send-template", response_model=WhatsAppMessageResponse)
async def send_template_message(payload: SendTemplatePayload):
    """Send an approved WhatsApp template with dynamic variables."""
    meta = get_meta_whatsapp_client()
    with tagged("manual", "template_message"):
        # Check if this is a live Meta template
        meta_def = await meta.get_template_def(payload.template_id)
        if meta_def:
            return await meta.send_template_message(
                to=payload.to,
                template_name=payload.template_id,
                variables=payload.variables or {},
                button_slug=payload.ticket_id or (payload.variables or {}).get("ticket_id"),
            )
        # Fallback to local text template
        tmpl = next((t for t in approved_templates() if t["id"] == payload.template_id), None)
        if not tmpl:
            raise HTTPException(status_code=404, detail=f"Unknown template '{payload.template_id}'")
        text = tmpl["template"]
        for k, v in (payload.variables or {}).items():
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


def _start_campaign(message: str, total: int) -> int | None:
    """A ledger row for this bulk send; its messages point to it (Bulk commercials page)."""
    from app.database import SessionLocal
    from app.models import WhatsAppCampaign

    try:
        with SessionLocal() as db:
            camp = WhatsAppCampaign(message_preview=(message or "")[:300], total=total)
            db.add(camp)
            db.commit()
            return camp.id
    except Exception as exc:  # noqa: BLE001  (the send goes ahead without a ledger row)
        logger.warning("Could not record bulk campaign: %s", exc)
        return None


def _finish_campaign(campaign_id: int | None, sent: int, failed: int, simulated: int) -> None:
    if campaign_id is None:
        return
    from app.database import SessionLocal
    from app.models import WhatsAppCampaign

    try:
        with SessionLocal() as db:
            camp = db.get(WhatsAppCampaign, campaign_id)
            if camp:
                camp.sent, camp.failed, camp.simulated = sent, failed, simulated
                db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not update bulk campaign %s: %s", campaign_id, exc)


@router.post("/send-bulk", response_model=BulkMessageResponse)
async def send_bulk_whatsapp_messages(payload: BulkMessageRequest):
    """
    Dispatches bulk WhatsApp messages to a list of recipients with
    custom dynamic tag variable interpolation and delivery tracking.
    """
    from app.database import SessionLocal
    from app.models import Event

    meta = get_meta_whatsapp_client()
    results: List[BulkMessageItemResult] = []
    sent_count = 0
    simulated_count = 0
    failed_count = 0

    global_vars = payload.variables or {}
    campaign_id = _start_campaign(payload.message, len(payload.recipients))

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
            with tagged("bulk", "bulk", campaign_id=campaign_id):
                tmpl_to_use = payload.template_id or "extrahand_event_announcement"
                resp = await meta.send_template_message(
                    to=clean_phone,
                    template_name=tmpl_to_use,
                    # Values typed for the template's blanks ({{2}}, {{3}}, ...) win over the message box text;
                    # {{1}} is always the recipient's name.
                    variables={
                        "2": msg_text,
                        "3": (payload.variables or {}).get("link", "https://extrahand.in"),
                        "message": msg_text,
                        "event": msg_text,
                        **{k: v for k, v in (payload.variables or {}).items() if str(v).strip()},
                        "name": name_val,
                        "1": name_val,
                        "phone": clean_phone,
                        **(item.custom_vars or {}),
                    },
                    image_url=payload.image_url,
                )
                if resp.status == "failed" and not payload.template_id:
                    # Fallback to direct message if template failed
                    if payload.image_url:
                        resp = await meta.send_image_message(
                            to=clean_phone,
                            image=payload.image_url,
                            caption=msg_text,
                        )
                    else:
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
                simulated_count += 1  # test mode: not delivered, so not counted as sent
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

    _finish_campaign(campaign_id, sent_count, failed_count, simulated_count)

    # Log to database Event
    db = SessionLocal()
    try:
        ev = Event(
            kind="whatsapp.bulk_broadcast",
            message=(f"Bulk WhatsApp broadcast to {len(payload.recipients)} contacts. "
                     f"Status: {sent_count} sent, {simulated_count} simulated, {failed_count} failed."),
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


# Commercials (Automation and Bulk usage & Meta charges): /api/whatsapp/commercials/...
from .commercials import router as _commercials_router  # noqa: E402

router.include_router(_commercials_router)

# Sent Messages view (split by utility / marketing): /api/whatsapp/messages
from .messages import router as _messages_router  # noqa: E402

router.include_router(_messages_router)

# Templates offered in Bulk Msgs (marketing only) and creating new ones: /api/whatsapp/bulk-templates
from .bulk_templates import router as _bulk_templates_router  # noqa: E402

router.include_router(_bulk_templates_router)

# Welcomers (helper / customer welcome on registration) and their commercials
from .welcomers import commercials_router as _welcomer_commercials_router  # noqa: E402
from .welcomers import router as _welcomers_router  # noqa: E402

router.include_router(_welcomers_router)
router.include_router(_welcomer_commercials_router)

# Task-alert template shown on the WhatsApp Dispatch dashboard: /api/whatsapp/task-alert-template
from .task_alert import router as _task_alert_router  # noqa: E402

router.include_router(_task_alert_router)

# Reviews & Feedback: WhatsApp feedback form after a task is completed: /api/whatsapp/feedback/...
from .cancel_followup import router as _cancel_followup_router  # noqa: E402
from .feedback import router as _feedback_router  # noqa: E402

router.include_router(_feedback_router)
router.include_router(_cancel_followup_router)  # /api/whatsapp/cancel-followup

# WhatsApp Support: the AI customer support agent: /api/whatsapp/support/...
from .support.router import router as _support_router  # noqa: E402

router.include_router(_support_router)
