"""Pulls tickets (Team-posted works) from ExtraHand into the local database."""

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from ..config import get_settings
from ..integrations.extrahand import ExtraHandError, ExtraHandSource, get_source
from ..integrations.mapping import is_assigned, is_terminal, normalize_task, normalize_user
from ..models import Customer, DispatchStatus, Event, Helper, Ticket, utcnow
from .common import engine_lock, log_event
from .real_data import is_real_task, is_real_user
from .dispatch import active_run, cancel_dispatch, upsert_helper
from .followups import cancel_for_ticket, schedule_for_ticket

log = logging.getLogger(__name__)

CONTACT_TTL = timedelta(hours=24)
TICKET_FIELDS = ("title", "description", "category", "status", "budget", "address", "city", "lat", "lng",
                 "scheduled_at", "booking_source", "remote_updated_at")
CUSTOMER_FIELDS = ("customer_id", "customer_name", "customer_phone", "customer_email")
ASSIGNEE_FIELDS = ("assignee_id", "assignee_profile_id", "assignee_name", "assignee_phone")

last_sync: dict = {"at": None, "ok": None, "error": None, "stats": None}
_missing_users: set[str] = set()


def _customer_contact(db: Session, src: ExtraHandSource, customer_id: str) -> Customer | None:
    c = db.get(Customer, customer_id)
    if c and (c.phone or utcnow() - c.updated_at < CONTACT_TTL):
        return c
    if customer_id in _missing_users:
        return c
    try:
        rec = normalize_user(src.get_user(customer_id))
    except ExtraHandError as e:
        _missing_users.add(customer_id)
        log.debug("customer %s lookup on ExtraHand failed: %s", customer_id, e)
        if not c:
            c = Customer(id=customer_id, updated_at=utcnow())
            db.add(c)
        else:
            c.updated_at = utcnow()
        return c
    c = c or Customer(id=customer_id)
    c.name, c.phone, c.alt_phone, c.email = rec["name"], rec["phone"], rec["alt_phone"], rec["email"]
    c.updated_at = utcnow()
    db.add(c)
    return c


def _helper_contact(db: Session, src: ExtraHandSource, helper_id: str) -> Helper | None:
    h = db.get(Helper, helper_id)
    if h and (h.phone or utcnow() - h.updated_at < CONTACT_TTL):
        return h
    if helper_id in _missing_users:
        return h
    try:
        raw = src.get_user(helper_id)
        if not is_real_user(raw if isinstance(raw, dict) else {}, helper_id):
            return h  # tester / test account: not saved as a helper
        return upsert_helper(db, normalize_user(raw) | {"id": helper_id})
    except ExtraHandError as e:
        _missing_users.add(helper_id)
        log.debug("helper %s lookup on ExtraHand failed: %s", helper_id, e)
        return h


def sync_helpers(db: Session) -> dict:
    """Fetches all registered helpers/partners from ExtraHand and upserts them into the database."""
    from ..config import get_settings

    src = get_source()
    stats = {"fetched": 0, "saved": 0, "errors": 0}
    role = get_settings().extrahand_helper_role or "partner"

    items: list[dict] = []
    for try_role in (role, "partner", "helper"):
        try:
            items = src.list_users(try_role)
            if items:
                break
        except Exception as e:
            log.warning("list_users(%s) failed: %s", try_role, e)

    stats["fetched"] = len(items)
    for raw in items:
        try:
            with engine_lock:
                rec = normalize_user(raw)
                if not is_real_user(raw, rec.get("id")):
                    stats["skipped_test"] = stats.get("skipped_test", 0) + 1  # tester / test / mock account
                    continue
                if rec.get("id") and rec["id"] != "None":
                    upsert_helper(db, rec)
                    stats["saved"] += 1
            db.commit()
        except Exception as e:
            db.rollback()
            stats["errors"] += 1
            log.exception("Failed to save helper: %s", e)
    return stats


def sync_tickets(db: Session) -> dict:
    src = get_source()
    stats = {"fetched": 0, "new": 0, "updated": 0, "assigned": 0, "closed": 0, "errors": 0}

    # Ensure helper directory is populated
    if db.query(Helper).count() == 0:
        try:
            h_stats = sync_helpers(db)
            stats["helpers_synced"] = h_stats.get("saved", 0)
        except Exception as e:
            log.warning("Initial helper sync failed: %s", e)

    try:
        items = src.iter_tasks()
    except ExtraHandError as e:
        err_msg = str(e)
        if "version" in err_msg or "No matching document" in err_msg:
            err_msg = "Temporary login collision on ExtraHand server (retrying shortly)"
        last_sync.update(at=utcnow(), ok=False, error=err_msg)
        raise
    stats["fetched"] = len(items)

    for raw in items:
        try:
            with engine_lock:
                _sync_one(db, src, raw, stats)
                db.commit()
        except Exception as e:  # noqa: BLE001 - one bad record must not stop the sync
            db.rollback()
            stats["errors"] += 1
            log.exception("sync failed for task: %s", e)

    last_sync.update(at=utcnow(), ok=True, error=None, stats=stats)

    # Automatically broadcast newly uploaded customer tasks to location + service helpers via WhatsApp
    try:
        s = get_settings()
        if not getattr(s, "whatsapp_simulated", True):
            from .common import runtime_settings
            r = runtime_settings(db)
            if r.auto_dispatch and r.workflow_helper_dispatch_enabled:
                from whatsapp.agent import get_whatsapp_dispatch_agent
                unbroadcast = db.query(Ticket).filter(
                    Ticket.dispatch_status == DispatchStatus.NEW,
                    Ticket.assignee_id.is_(None)
                ).all()
                now = utcnow()
                for ub in unbroadcast:
                    target_dt = ub.scheduled_at or ub.created_at
                    # Compare based on dates: only dispatch tasks scheduled for Today or Upcoming
                    if not target_dt or target_dt < now - timedelta(hours=2):
                        continue
                    already = db.query(Event).filter(Event.ticket_id == ub.id, Event.kind == "whatsapp_agent_broadcast").first()
                    if not already:
                        get_whatsapp_dispatch_agent().dispatch_for_task(ub.id)
    except Exception as e:
        log.warning("Failed triggering WhatsApp broadcasts after sync: %s", e)

    return stats


def _sync_one(db: Session, src: ExtraHandSource, raw: dict, stats: dict) -> None:
    # Real customers only: Works posted by the ExtraHand team, test accounts and mock rows are not saved
    if not is_real_task(raw):
        stats["skipped_test"] = stats.get("skipped_test", 0) + 1
        return
    rec = normalize_task(raw)
    if not rec["id"] or rec["id"] == "None":
        return
    t = db.get(Ticket, rec["id"])
    is_new = t is None
    if is_new or t.raw is None or rec["remote_updated_at"] != t.remote_updated_at:
        try:
            raw = {**raw, **src.get_task(rec["id"])}
            rec = normalize_task(raw)
        except ExtraHandError as e:
            log.warning("details for %s failed: %s", rec["id"], e)

    if is_new:
        t = Ticket(id=rec["id"])
        db.add(t)
        stats["new"] += 1
        log.info(
            "[ExtraHand Task New] #%s '%s' | Category: %s | Location: %s | Payout: Rs.%s | Customer: %s",
            rec["id"],
            rec.get("title", "Task"),
            rec.get("category", "General"),
            rec.get("address") or rec.get("city") or "Local",
            rec.get("budget", 0),
            rec.get("customer_name") or "Customer",
        )
    elif rec["remote_updated_at"] != t.remote_updated_at:
        stats["updated"] += 1

    prev_assignee = t.assignee_id
    for k in TICKET_FIELDS:
        setattr(t, k, rec[k])
    for k in CUSTOMER_FIELDS:
        if rec[k] is not None:
            setattr(t, k, rec[k])
    t.raw = raw
    t.synced_at = utcnow()
    db.flush()  # rows below reference the ticket

    if t.customer_id and not (t.customer_phone and t.customer_name):
        if c := _customer_contact(db, src, t.customer_id):
            t.customer_name = t.customer_name or c.name
            t.customer_phone = t.customer_phone or c.phone
            t.customer_email = t.customer_email or c.email

    remote_assigned = bool(is_assigned(rec) and rec["assignee_id"])
    if t.ignored_remote_assignee_id:
        if rec["assignee_id"] == t.ignored_remote_assignee_id:
            remote_assigned = False  # dropped locally; local workflow wins
        else:
            t.ignored_remote_assignee_id = None
    if remote_assigned:
        local_ids = {t.assignee_id, t.assignee_profile_id} - {None}
        ours = t.assigned_via in ("call", "whatsapp") and bool(
            local_ids & {rec["assignee_id"], rec.get("assignee_profile_id")})
        for k in ASSIGNEE_FIELDS:
            if rec[k] is not None or k == "assignee_id":
                setattr(t, k, rec[k])
        t.assignment_local_only = False
        if ours:
            t.extrahand_push = "ok"  # ExtraHand now shows the helper we assigned
            t.extrahand_push_error = None
        elif t.assigned_via != "extrahand" or t.assignee_id != prev_assignee:
            t.assigned_via, t.extrahand_push, t.extrahand_push_error = "extrahand", None, None
            t.assigned_at = t.assigned_at if t.assignee_id == prev_assignee and t.assigned_at else utcnow()
        if not t.assignee_phone or not t.assignee_name:
            if h := _helper_contact(db, src, t.assignee_id):
                t.assignee_phone = t.assignee_phone or h.phone
                t.assignee_name = t.assignee_name or h.name
                t.assignee_profile_id = t.assignee_profile_id or h.profile_id
        elif not db.get(Helper, t.assignee_id) and is_real_user({"name": t.assignee_name}, t.assignee_id):
            upsert_helper(db, {
                "id": t.assignee_id,
                "name": t.assignee_name or "Assigned Helper",
                "phone": t.assignee_phone,
                "profile_id": t.assignee_profile_id,
                "skills": [t.category] if t.category else [],
                "city": t.city,
                "status": "assigned",
                "is_active": True,
            })
            db.flush()
        if not prev_assignee and t.assignee_id:
            stats["assigned"] += 1
            log.info(
                "[ExtraHand Assigned] Ticket #%s '%s' assigned to Helper: %s (%s)",
                t.id,
                t.title or "Task",
                t.assignee_name or "Helper",
                t.assignee_phone or "Phone",
            )

    # --- reconcile local workflow state with ExtraHand -------------------------
    if is_terminal(t.status):
        if t.dispatch_status != DispatchStatus.CLOSED:
            if active_run(db, t.id):
                cancel_dispatch(db, t.id, f"Ticket {t.status} on ExtraHand")
            cancel_for_ticket(db, t.id)
            t.dispatch_status = DispatchStatus.CLOSED
            stats["closed"] += 1
            log_event(db, t.id, "closed", f"Ticket is {t.status} on ExtraHand")
        return

    if remote_assigned:
        changed = t.assignee_id != prev_assignee
        if t.dispatch_status in (DispatchStatus.NEW, DispatchStatus.DISPATCHING) or changed:
            if active_run(db, t.id):
                cancel_dispatch(db, t.id, "Helper assigned on ExtraHand")
            t.dispatch_status = DispatchStatus.ASSIGNED
            stats["assigned"] += 1
            log_event(db, t.id, "assigned_remote", f"Helper {t.assignee_name or t.assignee_id} assigned on ExtraHand")
    elif t.assignment_local_only and t.assignee_id:
        pass  # accepted on our call but not pushed to ExtraHand - keep it
    elif t.dispatch_status == DispatchStatus.ASSIGNED:
        for k in ASSIGNEE_FIELDS:
            setattr(t, k, None)
        t.assigned_via = t.assigned_at = t.extrahand_push = t.extrahand_push_error = None
        cancel_for_ticket(db, t.id)
        t.dispatch_status = DispatchStatus.NEW
        log_event(db, t.id, "unassigned_remote", "Helper was unassigned on ExtraHand")

    if t.dispatch_status == DispatchStatus.ASSIGNED:
        # Idempotent: picks up new assignments, start-time changes and new offsets
        schedule_for_ticket(db, t)
    if is_new:
        log_event(db, t.id, "synced", f"New ticket: {t.title or t.id}")
        if t.dispatch_status == DispatchStatus.NEW and not t.assignee_id:
            try:
                from whatsapp.agent import get_whatsapp_dispatch_agent
                get_whatsapp_dispatch_agent().dispatch_for_task(t.id)
            except Exception as wa_err:
                log.warning("WhatsApp dispatch agent trigger failed for new ticket %s: %s", t.id, wa_err)
