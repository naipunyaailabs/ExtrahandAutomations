from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


class WhatsAppTextMessage(BaseModel):
    """Payload to send a basic text WhatsApp message."""
    to: str = Field(..., description="Recipient phone number with country code, e.g. +919876543210 or 919876543210@c.us")
    message: str = Field(..., description="Message text content")
    session_id: Optional[str] = Field(default=None, description="OpenWA session identifier (defaults to configured session)")


class WhatsAppDispatchPayload(BaseModel):
    """Request to send a task dispatch message to a helper."""
    ticket_id: str
    helper_id: str
    helper_phone: str
    helper_name: Optional[str] = None
    task_title: str
    location: str
    scheduled_time: str
    payout: Union[str, float, int] = "0"


class WhatsAppMessageResponse(BaseModel):
    success: bool
    message_id: Optional[str] = None
    status: str
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class OpenWAWebhookMessage(BaseModel):
    """Normalized inbound message from OpenWA webhook."""
    event: str = Field(default="message.received", description="Event name, e.g. message.create or message.ack")
    session_id: Optional[str] = Field(default=None, alias="sessionId")
    message_id: Optional[str] = Field(default=None, alias="id")
    from_number: Optional[str] = Field(default=None, alias="from")
    to_number: Optional[str] = Field(default=None, alias="to")
    body: Optional[str] = Field(default=None)
    timestamp: Optional[int] = Field(default=None)
    is_group: bool = Field(default=False, alias="isGroup")
    raw: Optional[Dict[str, Any]] = None


class OpenWASessionStatus(BaseModel):
    session_id: str
    status: Literal["STARTING", "SCAN_QR_CODE", "WORKING", "FAILED", "STOPPED", "DISCONNECTED", "UNKNOWN"]
    phone_number: Optional[str] = None
    engine: Optional[str] = None
    qr_code_available: bool = False
    uptime_seconds: Optional[int] = None
