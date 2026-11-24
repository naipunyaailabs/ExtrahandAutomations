"""Background loop: periodic sync, due reminder calls, stale calls, auto-dispatch."""

import asyncio
import logging
from datetime import timedelta

from ..config import get_settings
from ..database import SessionLocal
from ..models import CallAttempt, DispatchRun, DispatchStatus, Ticket, utcnow
from . import ivr, tts_audio
from .common import call_window, runtime_settings
from .dispatch import DispatchError, get_provider_safe, start_dispatch
from .feedback_agent import process_due_feedback_callbacks, process_due_feedback_calls
from .followups import process_due
from .sync import last_sync, sync_tickets

log = logging.getLogger(__name__)


def expire_stale_calls(db) -> int:
    cutoff = utcnow() - timedelta(minutes=get_settings().call_stale_minutes)
    stale = db.query(CallAttempt).filter(CallAttempt.status.in_(ivr.ACTIVE_STATUSES),
                                         CallAttempt.created_at < cutoff).all()
    provider, _ = get_provider_safe()
    for a in stale:
        if provider and a.provider_call_id and a.provider == provider.name:
            try:  # a call that never reported back may still be open at the provider, and billing
                provider.hangup(a)
            except Exception as exc:
                log.warning("call %s: could not hang up %s at the provider: %s", a.id, a.provider_call_id, exc)
        ivr.ended(db, a, "failed", error="No final call status received (timed out)")
    db.commit()
    return len(stale)


def auto_dispatch(db) -> int:
    r = runtime_settings(db)
    if not r.auto_dispatch or not r.workflow_helper_dispatch_enabled or r.emergency_stop_calls:
        return 0
    from .common import within_calling_hours

    if not within_calling_hours(db):
        return 0  # tasks wait until calling hours open
    now = utcnow()
    started = 0
    tickets = db.query(Ticket).filter(Ticket.dispatch_status == DispatchStatus.NEW).all()
    for t in tickets:
        # Calls start dispatch_lead_hours (6 h) before the task; a task with no time is called right away
        hours = (r.calling_hours_start, r.calling_hours_end)
        if call_window(t, r.dispatch_lead_hours, now, calling_hours=hours)[0] not in ("open", "flexible"):
            continue
        # Only tickets that were never dispatched; re-runs are a human decision
        if db.query(DispatchRun).filter_by(ticket_id=t.id).first():
            continue
        try:
            start_dispatch(db, t.id, trigger="auto")
            started += 1
            if r.workflow_whatsapp_dispatch_enabled and r.whatsapp_automation_active:
                try:
                    from whatsapp.waves import start_due_wave

                    start_due_wave(t.id)  # first WhatsApp wave (15 helpers) if not sent yet
                except Exception as wa_err:
                    log.warning("WhatsApp auto-broadcast failed for %s: %s", t.id, wa_err)
        except DispatchError as e:
            log.info("auto-dispatch skipped %s: %s", t.id, e)
    return started


def auto_broadcast_whatsapp_tickets(db) -> int:
    """WhatsApp task alerts in waves: 15 matching helpers first, then 10 more every hour while nobody is assigned,
    never after the task's time (whatsapp/waves.py). Returns how many waves started."""
    s = get_settings()
    # STRICT SAFETY GUARD: Do not auto-broadcast if simulated or if auto-dispatch is disabled
    if getattr(s, "whatsapp_simulated", True):
        return 0
    r = runtime_settings(db)
    if not r.auto_dispatch or not r.workflow_helper_dispatch_enabled or not r.whatsapp_automation_active:
        return 0

    try:
        from whatsapp.waves import run_waves

        return run_waves(db)
    except Exception as e:  # noqa: BLE001
        log.warning("auto_broadcast_whatsapp_tickets check failed: %s", e)
        return 0


def sweep_ivr_audio(db) -> int:
    """Deletes per-call Telugu audio that outlived its call. Only calls placed through Vobiz make any."""
    if get_settings().telephony_provider != "vobiz":
        return 0
    return tts_audio.sweep(timedelta(hours=2))


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

        # Welcomers run on their own switches, whatever the calling agent is doing
        try:
            from whatsapp.welcomers import run_welcomers

            run_welcomers(db)
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("welcomers step failed")
        try:
            from marketing.task_seeding import run_task_seeding

            run_task_seeding(db)  # Task-Seeding Agent: first-booking nudges to new customers (off by default)
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("task seeding step failed")
        try:
            from whatsapp.feedback import run_feedback

            run_feedback(db)  # WhatsApp feedback form to customers of newly completed tasks
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("feedback step failed")
        try:
            from whatsapp.cancel_followup import run_cancel_followup

            run_cancel_followup(db)  # "what went wrong?" message to customers who cancel a Work (off by default)
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("cancellation follow-up step failed")

        r = runtime_settings(db)
        if r.emergency_stop_calls or not r.calling_agent_active:
            log.warning("CALLING AGENT DEACTIVATED: Automated calls are paused.")
            # Still expire stale calls and allow WhatsApp notifications
            try:
                expire_stale_calls(db)
                auto_broadcast_whatsapp_tickets(db)
            except Exception:
                db.rollback()
            return

        from .dispatch import resume_waiting_runs

        for step in (
            resume_waiting_runs,
            process_due,
            expire_stale_calls,
            auto_dispatch,
            auto_broadcast_whatsapp_tickets,
            process_due_feedback_calls,
            process_due_feedback_callbacks,
            sweep_ivr_audio,
        ):
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
