"""Background loop: periodic sync, due reminder calls, stale calls, auto-dispatch."""

import asyncio
import logging
from datetime import timedelta

from ..config import get_settings
from ..database import SessionLocal
from ..models import CallAttempt, DispatchRun, DispatchStatus, Event, Ticket, utcnow
from . import ivr
from .common import runtime_settings
from .dispatch import DispatchError, start_dispatch
from .feedback_agent import process_due_feedback_calls
from .followups import process_due
from .sync import last_sync, sync_tickets

log = logging.getLogger(__name__)


def expire_stale_calls(db) -> int:
    cutoff = utcnow() - timedelta(minutes=get_settings().call_stale_minutes)
    stale = db.query(CallAttempt).filter(CallAttempt.status.in_(ivr.ACTIVE_STATUSES),
                                         CallAttempt.created_at < cutoff).all()
    for a in stale:
        ivr.ended(db, a, "failed", error="No final call status received (timed out)")
    db.commit()
    return len(stale)


def auto_dispatch(db) -> int:
    r = runtime_settings(db)
    if not r.auto_dispatch or not r.workflow_helper_dispatch_enabled or r.emergency_stop_calls:
        return 0
    now = utcnow()
    started = 0
    tickets = db.query(Ticket).filter(Ticket.dispatch_status == DispatchStatus.NEW).all()
    for t in tickets:
        if t.scheduled_at and t.scheduled_at < now:
            continue
        # Only tickets that were never dispatched; re-runs are a human decision
        if db.query(DispatchRun).filter_by(ticket_id=t.id).first():
            continue
        try:
            start_dispatch(db, t.id, trigger="auto")
            started += 1
            if r.workflow_whatsapp_dispatch_enabled:
                try:
                    from whatsapp.service import get_whatsapp_service
                    wa = get_whatsapp_service()
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            asyncio.create_task(wa.broadcast_task_to_location_helpers(t.id, db=db))
                        else:
                            loop.run_until_complete(wa.broadcast_task_to_location_helpers(t.id, db=db))
                    except RuntimeError:
                        asyncio.run(wa.broadcast_task_to_location_helpers(t.id, db=db))
                except Exception as wa_err:
                    log.warning("WhatsApp auto-broadcast failed for %s: %s", t.id, wa_err)
        except DispatchError as e:
            log.info("auto-dispatch skipped %s: %s", t.id, e)
    return started


def auto_broadcast_whatsapp_tickets(db) -> int:
    """Broadcasts newly uploaded/synced tickets to helpers matching location and service via WhatsApp."""
    s = get_settings()
    # STRICT SAFETY GUARD: Do not auto-broadcast if simulated or if auto-dispatch is disabled
    if getattr(s, "whatsapp_simulated", True):
        return 0
    r = runtime_settings(db)
    if not r.auto_dispatch or not r.workflow_helper_dispatch_enabled:
        return 0

    now = utcnow()
    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.dispatch_status == DispatchStatus.NEW,
            Ticket.assignee_id.is_(None),
        )
        .all()
    )
    count = 0
    try:
        from whatsapp.service import trigger_whatsapp_task_broadcast
        for t in tickets:
            target_dt = t.scheduled_at or t.created_at
            # Compare based on dates: only dispatch tasks scheduled for Today or Upcoming (skip past/expired)
            if not target_dt or target_dt < now - timedelta(hours=2):
                continue
            already = db.query(Event).filter(Event.ticket_id == t.id, Event.kind == "whatsapp_location_broadcast").first()
            if not already:
                trigger_whatsapp_task_broadcast(t.id)
                count += 1
    except Exception as e:
        log.warning("auto_broadcast_whatsapp_tickets check failed: %s", e)
    return count


def tick() -> None:
    s = get_settings()
    with SessionLocal() as db:
        due = last_sync["at"] is None or utcnow() - last_sync["at"] >= timedelta(seconds=s.sync_interval_seconds)
        if due:
            try:
                stats = sync_tickets(db)
                if stats.get("new", 0) > 0 or stats.get("updated", 0) > 0 or stats.get("assigned", 0) > 0:
                    log.info(
                        "[ExtraHand Sync] %d tasks fetched | %d new | %d updated | %d assigned",
                        stats.get("fetched", 0),
                        stats.get("new", 0),
                        stats.get("updated", 0),
                        stats.get("assigned", 0),
                    )
            except Exception as e:  # noqa: BLE001
                err_msg = str(e)
                if "version" in err_msg or "No matching document" in err_msg:
                    err_msg = "Temporary login collision on ExtraHand server (retrying shortly)"
                last_sync.update(at=utcnow(), ok=False, error=err_msg)
                log.warning("[ExtraHand Sync Error] %s", e)

        r = runtime_settings(db)
        if r.emergency_stop_calls:
            log.warning("EMERGENCY KILL SWITCH ACTIVE: Automated calls are paused.")
            # Still expire stale calls and allow WhatsApp notifications
            try:
                expire_stale_calls(db)
                auto_broadcast_whatsapp_tickets(db)
            except Exception:
                db.rollback()
            return

        for step in (process_due, expire_stale_calls, auto_dispatch, auto_broadcast_whatsapp_tickets, process_due_feedback_calls):
            try:
                step(db)
            except Exception:  # noqa: BLE001
                db.rollback()
                log.exception("worker step %s failed", step.__name__)


async def run_forever(stop: asyncio.Event) -> None:
    interval = get_settings().worker_tick_seconds
    while not stop.is_set():
        await asyncio.to_thread(tick)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass
