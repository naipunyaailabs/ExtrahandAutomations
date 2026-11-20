"""Database tables.

All datetimes are stored as naive UTC (see ``utcnow``)."""

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class DispatchStatus:
    NEW = "new"                # synced, unassigned, nobody called yet
    DISPATCHING = "dispatching"  # helpers are being called one by one
    ASSIGNED = "assigned"      # a helper is assigned (on ExtraHand or accepted on our call)
    ESCALATED = "escalated"    # nobody accepted -> customer care
    CLOSED = "closed"          # completed / cancelled on ExtraHand


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    alt_phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(200))
    raw: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Helper(Base):
    __tablename__ = "helpers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # helper UID
    profile_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    alt_phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(200))
    skills: Mapped[list | None] = mapped_column(JSON)
    categories: Mapped[list | None] = mapped_column(JSON)
    work_areas: Mapped[list | None] = mapped_column(JSON)
    address: Mapped[str | None] = mapped_column(String(500))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    pincode: Mapped[str | None] = mapped_column(String(20))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str | None] = mapped_column(String(50), default="active")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    can_accept_tasks: Mapped[bool] = mapped_column(Boolean, default=True)
    work_shift_type: Mapped[str | None] = mapped_column(String(50))
    raw: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Ticket(Base):
    """A booking / work item pulled from ExtraHand."""

    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str | None] = mapped_column(String(50))  # status on ExtraHand
    budget: Mapped[float | None] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(String(500))
    city: Mapped[str | None] = mapped_column(String(100))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
    booking_source: Mapped[str | None] = mapped_column(String(60))

    customer_id: Mapped[str | None] = mapped_column(String(64))
    customer_name: Mapped[str | None] = mapped_column(String(200))
    customer_phone: Mapped[str | None] = mapped_column(String(32))
    customer_email: Mapped[str | None] = mapped_column(String(200))

    assignee_id: Mapped[str | None] = mapped_column(String(64))
    assignee_profile_id: Mapped[str | None] = mapped_column(String(64))
    assignee_name: Mapped[str | None] = mapped_column(String(200))
    assignee_phone: Mapped[str | None] = mapped_column(String(32))
    # True when the assignment came from our call and could not be pushed to ExtraHand
    assignment_local_only: Mapped[bool] = mapped_column(default=False)
    # Who assigned the helper: extrahand | call (accepted on our IVR call) | whatsapp (replied YES)
    assigned_via: Mapped[str | None] = mapped_column(String(20))
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Our assignment written to ExtraHand: pending | ok | failed (None = assigned on ExtraHand itself)
    extrahand_push: Mapped[str | None] = mapped_column(String(10))
    extrahand_push_error: Mapped[str | None] = mapped_column(String(300))
    # Helper still assigned on ExtraHand but dropped here (e.g. said they cannot attend);
    # sync ignores that remote assignment until it changes
    ignored_remote_assignee_id: Mapped[str | None] = mapped_column(String(64))

    dispatch_status: Mapped[str] = mapped_column(String(30), default=DispatchStatus.NEW, index=True)
    remote_updated_at: Mapped[str | None] = mapped_column(String(64))
    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime)

    runs: Mapped[list["DispatchRun"]] = relationship(back_populates="ticket", order_by="DispatchRun.id")


class DispatchRun(Base):
    """One pass of calling the eligible helpers of a ticket, one by one."""

    __tablename__ = "dispatch_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|accepted|escalated|cancelled
    candidates: Mapped[list] = mapped_column(JSON, default=list)
    current_index: Mapped[int] = mapped_column(Integer, default=-1)
    candidate_source: Mapped[str | None] = mapped_column(String(40))
    reason: Mapped[str | None] = mapped_column(String(300))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

    ticket: Mapped[Ticket] = relationship(back_populates="runs")


class CallAttempt(Base):
    __tablename__ = "call_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(20))  # dispatch | followup | feedback | callback
    run_id: Mapped[int | None] = mapped_column(ForeignKey("dispatch_runs.id"))
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"))
    helper_id: Mapped[str | None] = mapped_column(String(64))
    helper_name: Mapped[str | None] = mapped_column(String(200))
    customer_id: Mapped[str | None] = mapped_column(String(64))
    customer_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(20))
    provider_call_id: Mapped[str | None] = mapped_column(String(64), index=True)
    # queued -> ringing -> in_progress -> ended
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    # accepted | rejected | no_input | no_answer | busy | failed | confirmed | declined | cancelled | rated | callback_requested
    outcome: Mapped[str | None] = mapped_column(String(30))
    prompts_played: Mapped[int] = mapped_column(Integer, default=0)
    digits: Mapped[str] = mapped_column(String(50), default="")
    script: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(String(20), default="en")  # en | te | hi
    transcript: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    recording_url: Mapped[str | None] = mapped_column(String(500))
    error: Mapped[str | None] = mapped_column(String(500))
    handoff_json: Mapped[str | None] = mapped_column(Text)  # what the voice agent recorded after a hand-off
    timeline: Mapped[str | None] = mapped_column(Text)  # JSON list of {t, event, detail}: what happened, in order
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)


class FollowUp(Base):
    """Reminder call to the assigned helper before the task starts."""

    __tablename__ = "followups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    helper_id: Mapped[str | None] = mapped_column(String(64))
    helper_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    offset_minutes: Mapped[int] = mapped_column(Integer)
    retry_of: Mapped[int | None] = mapped_column(ForeignKey("followups.id"))  # set on a retry: the reminder it repeats
    due_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    # scheduled | calling | done | missed | cancelled
    status: Mapped[str] = mapped_column(String(20), default="scheduled", index=True)
    outcome: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Escalation(Base):
    """Ticket handed to customer care / helper support."""

    __tablename__ = "escalations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    reason: Mapped[str] = mapped_column(String(40))  # no_helper_accepted | no_eligible_helpers | helper_cannot_attend | customer_complaint | ...
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | in_progress | resolved
    assigned_to: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)


class CustomerFeedback(Base):
    """Customer experience ratings, audio transcripts and complaints for completed bookings."""

    __tablename__ = "customer_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    customer_id: Mapped[str | None] = mapped_column(String(64))
    customer_name: Mapped[str | None] = mapped_column(String(200))
    customer_phone: Mapped[str | None] = mapped_column(String(32))
    helper_id: Mapped[str | None] = mapped_column(String(64))
    helper_name: Mapped[str | None] = mapped_column(String(200))

    rating: Mapped[int | None] = mapped_column(Integer)  # 1 to 5
    feedback_text: Mapped[str | None] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(20), default="voice")  # voice | whatsapp | web
    language: Mapped[str] = mapped_column(String(20), default="en")  # en | te | hi
    sentiment: Mapped[str] = mapped_column(String(20), default="positive")  # positive | neutral | negative

    # Complaints classification
    complaint_category: Mapped[str] = mapped_column(String(40), default="none")  # none | late_arrival | poor_service | incomplete_work | overcharging | rude_behavior | other
    complaint_details: Mapped[str | None] = mapped_column(Text)
    resolution_status: Mapped[str] = mapped_column(String(20), default="resolved")  # new | in_progress | resolved | escalated
    assigned_agent: Mapped[str | None] = mapped_column(String(120))
    resolution_notes: Mapped[str | None] = mapped_column(Text)

    # Callbacks
    callback_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    callback_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
    callback_completed: Mapped[bool] = mapped_column(Boolean, default=False)

    call_attempt_id: Mapped[int | None] = mapped_column(ForeignKey("call_attempts.id"))
    call_duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    audio_recording_url: Mapped[str | None] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuditLog(Base):
    """System-wide operational actions audit log for compliance & security."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_name: Mapped[str] = mapped_column(String(100), default="system")
    user_role: Mapped[str] = mapped_column(String(50), default="admin")
    action: Mapped[str] = mapped_column(String(100))  # e.g., manual_assignment, emergency_stop, resolve_complaint
    target_type: Mapped[str] = mapped_column(String(50))  # ticket | helper | call | settings | feedback
    target_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Event(Base):
    """Audit trail shown as the ticket timeline."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str | None] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AppSetting(Base):
    """Runtime-editable settings (override .env defaults)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class BulkCallCampaign(Base):
    """Customized bulk calling campaign with its own independent active/inactive state."""

    __tablename__ = "bulk_call_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    script: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(20), default="te-IN")
    status: Mapped[str] = mapped_column(String(20), default="inactive")  # inactive | active | paused | completed | cancelled
    total_contacts: Mapped[int] = mapped_column(Integer, default=0)
    completed_calls: Mapped[int] = mapped_column(Integer, default=0)
    failed_calls: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

    items: Mapped[list["BulkCallItem"]] = relationship(
        "BulkCallItem", back_populates="campaign", cascade="all, delete-orphan", order_by="BulkCallItem.id"
    )


class BulkCallItem(Base):
    """One recipient in a bulk calling campaign dialed sequentially one by one."""

    __tablename__ = "bulk_call_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("bulk_call_campaigns.id", ondelete="CASCADE"), index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | calling | completed | failed | busy | no_answer
    call_id: Mapped[str | None] = mapped_column(String(100))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(String(500))
    called_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    campaign: Mapped["BulkCallCampaign"] = relationship("BulkCallCampaign", back_populates="items")




class CompetitorPrice(Base):
    """A competitor's price for one of our services, typed in by the team (Competitive Pricing page)."""

    __tablename__ = "competitor_prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service: Mapped[str] = mapped_column(String(200), index=True)  # our service name, e.g. "AC Repair"
    competitor: Mapped[str] = mapped_column(String(120), index=True)  # e.g. "Urban Company"
    price: Mapped[float] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(String(500))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class UsageEvent(Base):
    """One metered use of a paid service (e.g. a Sarvam text-to-speech request), for the Commercials page."""

    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service: Mapped[str] = mapped_column(String(30), index=True)  # sarvam_tts
    source: Mapped[str] = mapped_column(String(20), default="ivr")  # ivr | bulk | preview | check
    units: Mapped[int] = mapped_column(Integer, default=0)  # characters for TTS
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class WhatsAppCampaign(Base):
    """One bulk WhatsApp send (Bulk Msgs page), for the Bulk commercials page."""

    __tablename__ = "whatsapp_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_preview: Mapped[str | None] = mapped_column(String(300))
    total: Mapped[int] = mapped_column(Integer, default=0)
    sent: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    simulated: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class WhatsAppMessage(Base):
    """Every WhatsApp message sent or received, with Meta's delivery and billing reports (status webhooks)."""

    __tablename__ = "whatsapp_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(4), default="out")  # out | in
    source: Mapped[str] = mapped_column(String(20), default="automation", index=True)  # automation | bulk | manual
    purpose: Mapped[str] = mapped_column(String(30), default="other")  # work_order | broadcast | reminder | reply | bulk ...
    kind: Mapped[str] = mapped_column(String(10), default="text")  # text | template
    template: Mapped[str | None] = mapped_column(String(100))
    body: Mapped[str | None] = mapped_column(Text)  # the text the recipient saw (template filled in); None for old rows
    phone: Mapped[str | None] = mapped_column(String(32), index=True)
    ticket_id: Mapped[str | None] = mapped_column(String(64))
    campaign_id: Mapped[int | None] = mapped_column(Integer, index=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(128), index=True)
    # sent | failed | simulated, then from Meta: delivered | read | failed
    status: Mapped[str] = mapped_column(String(12), default="sent", index=True)
    error_code: Mapped[str | None] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(String(300))
    # From Meta's pricing object; None until Meta reports it
    billable: Mapped[bool | None] = mapped_column(Boolean)
    category: Mapped[str | None] = mapped_column(String(20))  # marketing | utility | authentication | service
    pricing_type: Mapped[str | None] = mapped_column(String(30))  # regular | free_customer_service | free_entry_point
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)


class WhatsAppWelcome(Base):
    """One welcome message per newly registered ExtraHand helper or customer (Welcomers)."""

    __tablename__ = "whatsapp_welcomes"
    __table_args__ = (UniqueConstraint("audience", "user_id", name="uq_welcome_audience_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    audience: Mapped[str] = mapped_column(String(10), index=True)  # helper | customer
    user_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    registered_at: Mapped[datetime | None] = mapped_column(DateTime)
    template: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(12), default="sent")  # sent | failed | simulated | skipped
    error: Mapped[str | None] = mapped_column(String(300))
    provider_message_id: Mapped[str | None] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class WhatsAppFeedbackRequest(Base):
    """One WhatsApp feedback form per completed task: sent to the customer, answered inside WhatsApp (Flow)."""

    __tablename__ = "whatsapp_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    task_title: Mapped[str | None] = mapped_column(String(300))
    category: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(100))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
    customer_name: Mapped[str | None] = mapped_column(String(200))
    customer_phone: Mapped[str | None] = mapped_column(String(32))
    helper_id: Mapped[str | None] = mapped_column(String(64))
    helper_name: Mapped[str | None] = mapped_column(String(200))
    # sending | sent | answered | failed | no_phone | skipped (completed before activation / while off)
    status: Mapped[str] = mapped_column(String(12), default="sending", index=True)
    flow_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(String(300))
    # Answers (1-5 stars) and the customer's note
    work_rating: Mapped[int | None] = mapped_column(Integer)
    behaviour_rating: Mapped[int | None] = mapped_column(Integer)
    on_time_rating: Mapped[int | None] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    # The customer's reply exactly as Meta delivered it (webhook message id + the form's raw response_json)
    reply_message_id: Mapped[str | None] = mapped_column(String(128))
    reply_raw: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime)


class SeedContact(Base):
    """Task-Seeding Agent (Advertisement module): one row per newly registered customer it looked at.

    Holds the suggestion it chose, the WhatsApp message, the optional voice call, link clicks and the first
    booking (conversion). One row per customer (user_id is unique), so nobody is contacted twice."""

    __tablename__ = "task_seed_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), unique=True)  # ExtraHand profile _id (= Ticket.customer_id)
    name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32), index=True)
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(120))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    language: Mapped[str | None] = mapped_column(String(5))  # te | hi | en (from the customer's state)
    # suggestion
    service: Mapped[str | None] = mapped_column(String(30))  # the main one (Book Now opens its category)
    services: Mapped[str | None] = mapped_column(String(200))  # every service in the message, comma separated
    reason: Mapped[str | None] = mapped_column(String(12))  # festival | summer | regular
    reason_text: Mapped[str | None] = mapped_column(String(300))
    event_title: Mapped[str | None] = mapped_column(String(200))
    promo_code: Mapped[str | None] = mapped_column(String(40))
    token: Mapped[str] = mapped_column(String(40), unique=True)  # Book Now link / call webhooks
    # pending | sending | messaged | called | failed | skipped | opted_out | converted
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    skip_reason: Mapped[str | None] = mapped_column(String(40))
    # WhatsApp
    wa_status: Mapped[str | None] = mapped_column(String(16))
    wa_language: Mapped[str | None] = mapped_column(String(10))
    wa_message_id: Mapped[str | None] = mapped_column(String(128), index=True)
    wa_error: Mapped[str | None] = mapped_column(String(300))
    wa_attempts: Mapped[int] = mapped_column(Integer, default=0)
    wa_sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    # voice call
    call_status: Mapped[str | None] = mapped_column(String(16))
    call_id: Mapped[str | None] = mapped_column(String(128))
    call_error: Mapped[str | None] = mapped_column(String(300))
    call_attempts: Mapped[int] = mapped_column(Integer, default=0)
    call_at: Mapped[datetime | None] = mapped_column(DateTime)
    call_duration: Mapped[int | None] = mapped_column(Integer)
    # Book Now clicks and the first booking
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    first_click_at: Mapped[datetime | None] = mapped_column(DateTime)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime)
    converted_ticket_id: Mapped[str | None] = mapped_column(String(64))
    converted_category: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class SeedOptOut(Base):
    """A phone number that replied STOP: never messaged or called by the Task-Seeding Agent again."""

    __tablename__ = "task_seed_optouts"

    phone: Mapped[str] = mapped_column(String(15), primary_key=True)  # last 10 digits
    source: Mapped[str] = mapped_column(String(20), default="whatsapp")  # whatsapp | admin
    note: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
