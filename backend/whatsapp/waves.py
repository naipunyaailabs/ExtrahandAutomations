"""WhatsApp work-order alerts go out in waves, not to every matching helper at once.

For a new task (no helper assigned yet):
  wave 1   the first 15 matching helpers
  wave 2   1 hour later, if still nobody is assigned: the next 10
  wave 3+  every hour after that: 10 more, until someone is assigned or nobody is left
Helpers are taken in priority order (Aadhaar verified first, then nearest - app.services.dispatch.helper_priority),
and nobody gets the same task twice. Nothing is sent once the task's scheduled time has passed (a task without a
time stops NO_TIME_WINDOW after it was created), or once the task is assigned, completed or cancelled.

Every automatic path (task upload, ExtraHand sync, the worker tick) calls start_due_wave(); a wave is claimed in the
database (an Event "whatsapp_wave") before anything is sent, so two paths can never send the same wave twice.
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import DispatchStatus, Event, Ticket, WhatsAppMessage, utcnow

log = logging.getLogger("whatsapp.waves")

FIRST_WAVE = 15  # helpers in the first wave
NEXT_WAVE = 10  # helpers in every later wave
WAVE_GAP = timedelta(hours=1)  # wait between waves
NO_TIME_WINDOW = timedelta(hours=24)  # a task without a scheduled time stops this long after it was created
WAVE_EVENT = "whatsapp_wave"
ALERT_PURPOSES = ("broadcast", "agent_broadcast", "work_order")  # ledger purposes of task alerts to helpers
_LOCK = threading.Lock()


def deadline(t: Ticket) -> Optional[datetime]:
    """No alert at or after this moment: the task's scheduled time (or creation + NO_TIME_WINDOW without one)."""
    if t.scheduled_at:
        return t.scheduled_at
    return t.created_at + NO_TIME_WINDOW if t.created_at else None


def is_open(t: Ticket) -> bool:
    return not t.assignee_id and t.dispatch_status not in (DispatchStatus.ASSIGNED, DispatchStatus.CLOSED)


def waves_sent(db: Session, ticket_id: str) -> list[Event]:
    return (db.query(Event).filter(Event.ticket_id == ticket_id, Event.kind == WAVE_EVENT)
            .order_by(Event.created_at.asc(), Event.id.asc()).all())


def due_wave(db: Session, t: Ticket, now: Optional[datetime] = None) -> Optional[int]:
    """The wave number that should go out now, or None (task assigned / closed / past, or the hour is not up)."""
    now = now or utcnow()
    end = deadline(t)
    if not is_open(t) or end is None or now >= end:
        return None
    waves = waves_sent(db, t.id)
    if not waves:
        return 1
    last = waves[-1]
    if "nobody left" in (last.message or ""):
        return None  # every matching helper already has this task
    return len(waves) + 1 if now - last.created_at >= WAVE_GAP else None


def _digits(phone: Any) -> str:
    return "".join(c for c in str(phone or "") if c.isdigit())[-10:]


def contacted(db: Session, ticket_id: str) -> tuple[set[str], set[str]]:
    """(helper ids, phone last-10-digits) already sent this task: from the waves and the WhatsApp message ledger."""
    ids: set[str] = set()
    for e in waves_sent(db, ticket_id):
        m = re.search(r"helpers: ([^|]*)", e.message or "")
        if m:
            ids.update(x.strip() for x in m.group(1).split(",") if x.strip())
    phones = {_digits(p) for (p,) in db.query(WhatsAppMessage.phone).filter(
        WhatsAppMessage.ticket_id == ticket_id, WhatsAppMessage.direction == "out",
        WhatsAppMessage.purpose.in_(ALERT_PURPOSES))}
    return ids, phones - {""}


def _next_batch(db: Session, t: Ticket, size: int) -> list[dict]:
    """The next `size` matching helpers in priority order who have not had this task yet."""
    from app.services.dispatch import helper_priority

    from .service import get_whatsapp_service

    _, helpers = get_whatsapp_service().get_location_helpers_for_task(t.id, db=db)
    ids, phones = contacted(db, t.id)
    fresh = [h for h in helpers if str(h.get("helper_id")) not in ids and _digits(h.get("phone")) not in phones]
    fresh.sort(key=helper_priority)
    return fresh[:size]


def claim_wave(db: Session, ticket_id: str, now: Optional[datetime] = None) -> Optional[tuple[int, list[dict]]]:
    """If a wave is due, pick its helpers and record it (the claim) before anything is sent: returns
    (wave number, helpers), or None. Thread-safe; the database record stops other processes too."""
    with _LOCK:
        t = db.get(Ticket, ticket_id)
        if t is None:
            return None
        n = due_wave(db, t, now)
        if n is None:
            return None
        batch = _next_batch(db, t, FIRST_WAVE if n == 1 else NEXT_WAVE)
        verified = sum(1 for h in batch if h.get("aadhaar_verified", h.get("is_verified")))
        if not batch:
            msg = f"Wave {n}: nobody left to message (every matching helper already has this task)"
        else:
            msg = (f"Wave {n}: WhatsApp task alert to {len(batch)} helper(s), {verified} Aadhaar verified"
                   f"{'' if n == 1 else ' (nobody assigned after the previous wave)'} | helpers: "
                   + ",".join(str(h.get("helper_id")) for h in batch))
        db.add(Event(ticket_id=ticket_id, kind=WAVE_EVENT, message=msg, created_at=now or utcnow()))
        db.commit()
        log.info("Ticket %s: %s", ticket_id, msg.split(" | ")[0])
        return (n, batch) if batch else None


def _send(ticket_id: str, batch: list[dict]) -> dict:
    from .service import get_whatsapp_service

    with SessionLocal() as db:
        return asyncio.run(get_whatsapp_service().broadcast_task_to_location_helpers(ticket_id, db=db, helpers=batch))


def start_due_wave(ticket_id: str, wait: bool = False) -> bool:
    """Sends the task's next wave if one is due (in the background unless wait=True). True when a wave started."""
    with SessionLocal() as db:
        claimed = claim_wave(db, ticket_id)
    if not claimed:
        return False
    _, batch = claimed
    if wait:
        _send(ticket_id, batch)
        return True

    def _run() -> None:
        try:
            res = _send(ticket_id, batch)
            log.info("Ticket %s wave sent: %s", ticket_id, res.get("summary"))
        except Exception:  # noqa: BLE001
            log.exception("WhatsApp wave for ticket %s failed", ticket_id)

    threading.Thread(target=_run, daemon=True, name=f"wa-wave-{ticket_id[:8]}").start()
    return True


def run_waves(db: Session) -> int:
    """Worker job: sends every open task's due wave. Returns how many waves started."""
    now = utcnow()
    started = 0
    for (tid,) in (db.query(Ticket.id)
                   .filter(Ticket.assignee_id.is_(None),
                           Ticket.dispatch_status.notin_((DispatchStatus.ASSIGNED, DispatchStatus.CLOSED)))):
        t = db.get(Ticket, tid)
        if t is not None and due_wave(db, t, now) is not None:
            started += int(start_due_wave(tid))
    return started
