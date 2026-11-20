"""Writes a helper assigned in this app (accepted on our IVR call, or replied YES on WhatsApp) to ExtraHand.

The local assignment stays flagged ``assignment_local_only`` until a sync shows ExtraHand really has that helper,
so an ExtraHand call that "succeeds" without assigning never makes the sync drop our helper and call others."""

import logging
import threading

from sqlalchemy import event
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal
from ..integrations.extrahand import get_source
from ..models import Helper, Ticket, utcnow
from .common import log_event

log = logging.getLogger(__name__)


def mark_local_assignment(ticket: Ticket, via: str) -> None:
    """Records who assigned the helper here; the ExtraHand write follows (see push_assignment_later)."""
    ticket.assigned_via = via
    ticket.assigned_at = utcnow()
    ticket.assignment_local_only = True
    ticket.extrahand_push = "pending" if get_settings().extrahand_push_assignments else None
    ticket.extrahand_push_error = None


def _writer():
    """The real ExtraHand client: a write must never be "done" by the mock fallback."""
    src = get_source()
    return getattr(src, "live", src)


def push_assignment(db: Session, ticket_id: str) -> bool:
    """Assigns the ticket's helper on ExtraHand. Returns True when ExtraHand accepted it."""
    t = db.get(Ticket, ticket_id)
    if t is None or not t.assignee_id or t.assigned_via not in ("call", "whatsapp"):
        return False
    h = db.get(Helper, t.assignee_id)
    uid = t.assignee_id
    profile_id = t.assignee_profile_id or (h.profile_id if h else None)
    try:
        _writer().assign_helper(t.id, uid, profile_id, t.assignee_name)
    except Exception as e:  # noqa: BLE001 - any failure is shown on the task, with a retry
        t.extrahand_push, t.extrahand_push_error = "failed", str(e)[:300]
        log_event(db, t.id, "extrahand_assign_failed", f"Could not assign {t.assignee_name or uid} on ExtraHand: {e}")
        db.commit()
        log.warning("ExtraHand assign failed for %s: %s", t.id, e)
        return False
    t.extrahand_push, t.extrahand_push_error = "ok", None
    log_event(db, t.id, "extrahand_assigned", f"{t.assignee_name or uid} assigned on ExtraHand too")
    db.commit()
    return True


def push_assignment_later(db: Session, ticket_id: str) -> None:
    """Runs push_assignment in the background once ``db`` commits, so a slow ExtraHand never holds a call."""
    if not get_settings().extrahand_push_assignments:
        return
    event.listen(db, "after_commit", lambda _s: _start(ticket_id), once=True)


def _start(ticket_id: str) -> None:
    def run() -> None:
        with SessionLocal() as db:
            try:
                push_assignment(db, ticket_id)
            except Exception:  # noqa: BLE001
                db.rollback()
                log.exception("ExtraHand assign for %s crashed", ticket_id)

    threading.Thread(target=run, daemon=True, name=f"eh-assign-{ticket_id[:8]}").start()
