"""Database tables.

All datetimes are stored as naive UTC (see ``utcnow``)."""

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
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
    purpose: Mapped[str] = mapped_column(String(20))  # dispatch | followup
    run_id: Mapped[int | None] = mapped_column(ForeignKey("dispatch_runs.id"))
    followup_id: Mapped[int | None] = mapped_column(ForeignKey("followups.id"))
    helper_id: Mapped[str | None] = mapped_column(String(64))
    helper_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(20))
    provider_call_id: Mapped[str | None] = mapped_column(String(64), index=True)
    # queued -> ringing -> in_progress -> ended
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    # accepted | rejected | no_input | no_answer | busy | failed | confirmed | declined | cancelled
    outcome: Mapped[str | None] = mapped_column(String(20))
    prompts_played: Mapped[int] = mapped_column(Integer, default=0)
    digits: Mapped[str] = mapped_column(String(50), default="")
    script: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(String(500))
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
    reason: Mapped[str] = mapped_column(String(40))  # no_helper_accepted | no_eligible_helpers | helper_cannot_attend | ...
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | in_progress | resolved
    assigned_to: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)


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
