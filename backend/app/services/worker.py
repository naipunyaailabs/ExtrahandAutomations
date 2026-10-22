"""Background loop: periodic sync, due reminder calls, stale calls, auto-dispatch."""

import asyncio
import logging
from datetime import timedelta

from ..config import get_settings
from ..database import SessionLocal
from ..models import CallAttempt, DispatchRun, DispatchStatus, Ticket, utcnow
from . import ivr
from .common import runtime_settings
from .dispatch import DispatchError, start_dispatch
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
    if not runtime_settings(db).auto_dispatch:
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
        except DispatchError as e:
            log.info("auto-dispatch skipped %s: %s", t.id, e)
    return started


def tick() -> None:
    s = get_settings()
    with SessionLocal() as db:
        due = last_sync["at"] is None or utcnow() - last_sync["at"] >= timedelta(seconds=s.sync_interval_seconds)
        if due:
            try:
                stats = sync_tickets(db)
                log.info("sync: %s", stats)
            except Exception as e:  # noqa: BLE001
                last_sync.update(at=utcnow(), ok=False, error=str(e))
                log.warning("sync failed: %s", e)
        for step in (process_due, expire_stale_calls, auto_dispatch):
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
