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
    success: bool = True
    message_id: Optional[str] = None
    status: str = "sent"
    error: Optional[str] = None
    details: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class BulkRecipient(BaseModel):
    phone: str
    name: Optional[str] = None
    custom_vars: Optional[Dict[str, str]] = Field(default_factory=dict)


class BulkMessageRequest(BaseModel):
    recipients: List[BulkRecipient]
    message: str
    template_id: Optional[str] = None
    variables: Optional[Dict[str, str]] = Field(default_factory=dict)
    channel: Optional[str] = "whatsapp"


class BulkMessageItemResult(BaseModel):
    phone: str
    name: Optional[str] = None
    status: str = "sent"  # "sent", "simulated", "failed"
    message_id: Optional[str] = None
    error: Optional[str] = None


class BulkMessageResponse(BaseModel):
    ok: bool = True
    total: int = 0
    sent_count: int = 0
    failed_count: int = 0
    simulated_count: int = 0
    results: List[BulkMessageItemResult] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ParsedContact(BaseModel):
    phone: str
    name: Optional[str] = None
    is_valid: bool = True
    formatted_phone: str
    original_phone: str
    row: int = 1
    reason: Optional[str] = None


class ParseContactsResponse(BaseModel):
    total_rows: int = 0
    valid_count: int = 0
    invalid_count: int = 0
    detected_phone_column: Optional[str] = None
    detected_name_column: Optional[str] = None
    detected_columns: List[str] = Field(default_factory=list)
    contacts: List[ParsedContact] = Field(default_factory=list)
    filename: Optional[str] = None


class SendTemplatePayload(BaseModel):
    to: str
    template_id: str
    variables: Optional[Dict[str, str]] = Field(default_factory=dict)
    ticket_id: Optional[str] = None


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
