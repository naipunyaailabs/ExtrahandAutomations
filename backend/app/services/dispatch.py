"""Calls eligible helpers one by one until one accepts, otherwise escalates."""

import logging
import math

from sqlalchemy.orm import Session

from ..config import get_settings
from ..integrations.extrahand import CandidatesUnavailable, ExtraHandError, get_source
from ..integrations.mapping import is_terminal, normalize_user
from ..models import CallAttempt, DispatchRun, DispatchStatus, Escalation, Helper, Ticket, utcnow
from ..telephony import TelephonyProvider, get_provider
from .common import calling_hours_state, engine_lock, log_event, runtime_settings
from .ivr import ACTIVE_STATUSES, dispatch_script
from .places import location_match
from .real_data import is_real_helper, is_real_user

log = logging.getLogger(__name__)


class DispatchError(Exception):
    pass


def km_between(lat1, lng1, lat2, lng2) -> float | None:
    if None in (lat1, lng1, lat2, lng2):
        return None
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


SERVICE_CLUSTERS = {
    "electrician": {"electric", "electrician", "electrical", "wiring", "switch", "socket", "fan", "light", "mcb", "fuse", "inverter", "switchboard", "geyser repair"},
    "plumbing": {"plumb", "plumber", "plumbing", "pipe", "leak", "tap", "faucet", "toilet", "flush", "basin", "drain", "water_tank", "tank", "sanitary"},
    "cleaning": {"clean", "cleaning", "deep clean", "housekeeping", "house keeping", "dusting", "mop", "sofa", "carpet", "sanitiz", "wash", "kitchen cleaning", "bathroom cleaning", "maid"},
    "ac_repair": {"ac", "air conditioner", "ac repair", "ac installation", "gas refill", "cooling", "ac service", "hvac", "compressor"},
    "carpentry": {"carpenter", "carpentry", "wood", "woodwork", "furniture", "assembly", "shelf", "wardrobe", "bed", "door", "window", "lock"},
    "painting": {"paint", "painting", "painter", "whitewash", "wall", "texture"},
    "pest_control": {"pest", "pest_control", "termite", "cockroach", "mosquito", "rodent", "bedbug", "fumigation"},
    "moving": {"pack", "packer", "packers", "mover", "moving", "shifting", "relocation", "loading", "unloading", "transport", "delivery", "logistics"},
    "gardening": {"garden", "gardening", "lawn", "plant", "tree", "weeding", "mowing", "landscaping"},
    "cooking": {"cook", "cooking", "chef", "meal", "catering", "tiffin"},
    "driver": {"driver", "driving", "chauffeur", "cab"},
    "appliance": {"appliance", "refrigerator", "fridge", "washing machine", "microwave", "oven", "tv repair", "water purifier", "ro repair"},
}

GENERIC_TAGS = {"other", "general", "none", "service", "task", "all", "works", "helper", ""}


def helper_matches_ticket_service(ticket: Ticket, skills: list[str] | None, categories: list[str] | None = None) -> bool:
    """Strictly verifies that helper's skills or categories match the requested task service."""
    text = f"{ticket.category or ''} {ticket.title or ''} {ticket.description or ''}".lower()
    h_tags = [
        str(s).lower().strip() for s in (skills or []) + (categories or [])
        if s and str(s).lower().strip() not in GENERIC_TAGS
    ]
    if not h_tags:
        return False

    # 1. Cluster matching (primary: matches trade synonyms like electrician <-> wiring_rewiring)
    matched_clusters = set()
    for cluster_name, keywords in SERVICE_CLUSTERS.items():
        if any(kw in text for kw in keywords):
            matched_clusters.add(cluster_name)
            if any(any(kw in tag for kw in keywords) for tag in h_tags):
                return True

    # 2. Direct keyword / tag matching if ticket is outside standard clusters
    if not matched_clusters:
        valid_words = [w for w in text.split() if len(w) > 3 and w not in GENERIC_TAGS]
        for w in valid_words:
            if any(w in tag or tag in w for tag in h_tags):
                return True

    return False


def _skill_matches(category: str | None, skills: list[str]) -> bool:
    if not skills or not category:
        return False
    c = category.lower()
    return any(s.lower() in c or c in s.lower() for s in skills if s.lower() not in GENERIC_TAGS)


def upsert_helper(db: Session, rec: dict) -> Helper:
    h = db.get(Helper, rec["id"])
    if not h:
        for obj in db.new:
            if isinstance(obj, Helper) and obj.id == rec["id"]:
                h = obj
                break
    h = h or Helper(id=rec["id"])
    scalar_fields = (
        "profile_id", "name", "phone", "alt_phone", "email",
        "city", "state", "pincode", "address", "lat", "lng",
        "status", "is_active", "is_verified", "can_accept_tasks", "work_shift_type",
    )
    for k in scalar_fields:
        if rec.get(k) is not None:
            setattr(h, k, rec[k])
    if rec.get("skills") is not None:
        h.skills = rec["skills"]
    if rec.get("categories") is not None:
        h.categories = rec["categories"]
    if rec.get("work_areas") is not None:
        h.work_areas = rec["work_areas"]
    if rec.get("raw") is not None:
        h.raw = rec["raw"]
    db.add(h)
    return h


def find_candidates(db: Session, ticket: Ticket) -> tuple[list[dict], str]:
    """Eligible helpers for the ticket's location and service, nearest first."""
    rt = runtime_settings(db)
    src = get_source()
    raw = []
    source, trusted = "matching_api", True
    try:
        raw = src.get_candidates(ticket.id, ticket.lat, ticket.lng, rt.match_radius_km)
    except CandidatesUnavailable as e:
        log.info("Matching API unavailable (%s); using helper list", e)
        if db.query(Helper).count() > 20:
            raw = []
            source, trusted = "db_cache", False
        else:
            raw = src.list_users(get_settings().extrahand_helper_role, max_pages=2)
            source, trusted = "helper_list", False

    out: list[dict] = []
    seen: set[str] = set()

    if raw:
        for item in raw:
            rec = normalize_user(item)
            if not rec["id"] or rec["id"] == "None" or rec["id"] in seen:
                continue
            seen.add(rec["id"])
            if not is_real_user(item if isinstance(item, dict) else {}, rec["id"]):
                continue  # tester / test / mock account: never called
            upsert_helper(db, rec)
            if not rec["phone"]:
                continue
            # Strict matching on BOTH location AND requested service
            if not helper_matches_ticket_service(ticket, rec.get("skills"), rec.get("categories")):
                continue
            dist = rec["distance_km"]  # from ExtraHand's matching API, when it gives one
            if dist is not None:
                if dist > rt.match_radius_km:
                    continue
            else:
                ok, dist = location_match(
                    db, ticket, rt.match_radius_km, lat=rec["lat"], lng=rec["lng"], city=rec.get("city"),
                    address=rec.get("address"), pincode=rec.get("pincode"), work_areas=rec.get("work_areas"),
                )
                if not ok:
                    continue
            out.append({
                "helper_id": rec["id"], "profile_id": rec["profile_id"], "name": rec["name"], "phone": rec["phone"],
                "skills": rec["skills"], "categories": rec.get("categories", []), "city": rec.get("city"),
                "distance_km": round(dist, 2) if dist is not None else None,
            })
    else:
        # Load and filter directly from local DB cache
        for h in db.query(Helper).filter(Helper.phone.isnot(None)).all():
            if str(h.id) in seen or not is_real_helper(h):
                continue
            seen.add(str(h.id))
            if not helper_matches_ticket_service(ticket, h.skills, h.categories):
                continue
            ok, dist = location_match(
                db, ticket, rt.match_radius_km, lat=h.lat, lng=h.lng, city=h.city, address=h.address,
                pincode=h.pincode, work_areas=h.work_areas,
            )
            if not ok:
                continue
            out.append({
                "helper_id": h.id, "profile_id": h.profile_id, "name": h.name, "phone": h.phone,
                "skills": h.skills or [], "categories": h.categories or [], "city": h.city,
                "distance_km": round(dist, 2) if dist is not None else None,
            })

    out = [c for c in out if _can_take_task(db, ticket, c["helper_id"])]
    out.sort(key=lambda c: (c["distance_km"] is None, c["distance_km"] or 0))
    return out[: rt.max_helpers_per_ticket], source


# Helpers in these ExtraHand states are never called (same rules as the Helper Details page)
BLOCKED_HELPER_STATUSES = {
    "rejected", "pending_review", "not_applied", "suspended", "blocked", "banned", "inactive", "deleted",
}


def _can_take_task(db: Session, ticket: Ticket, helper_id: str) -> bool:
    """A helper is called only when allowed to work (not rejected / suspended / inactive) and free:
    one helper, one task - anyone already assigned to another open task is skipped."""
    h = db.get(Helper, helper_id)
    if h is not None:
        status = (h.status or "").strip().lower().replace(" ", "_")
        if status in BLOCKED_HELPER_STATUSES or not h.is_active or not h.can_accept_tasks:
            return False
    other_tasks = (
        db.query(Ticket)
        .filter(Ticket.assignee_id == helper_id, Ticket.id != ticket.id, Ticket.dispatch_status != DispatchStatus.CLOSED)
        .all()
    )
    return all(is_terminal(t.status) for t in other_tasks)


def active_run(db: Session, ticket_id: str) -> DispatchRun | None:
    return db.query(DispatchRun).filter_by(ticket_id=ticket_id, status="running").first()


def start_dispatch(db: Session, ticket_id: str, trigger: str = "manual") -> DispatchRun:
    with engine_lock:
        ticket = db.get(Ticket, ticket_id)
        if not ticket:
            raise DispatchError("Ticket not found")
        r = runtime_settings(db)
        if r.emergency_stop_calls or not r.calling_agent_active:
            raise DispatchError("Calling Agent is DEACTIVATED (Safety Mode). Click 'Activate' to allow phone calls.")
        hours = calling_hours_state(db)
        if not hours["open"]:
            raise DispatchError(f"Outside calling hours ({hours['label']}). The agent calls helpers only in this window.")
        if run := active_run(db, ticket_id):
            return run
        if ticket.dispatch_status == DispatchStatus.CLOSED or is_terminal(ticket.status):
            raise DispatchError(f"Ticket is {ticket.status}")
        if ticket.dispatch_status == DispatchStatus.ASSIGNED:
            raise DispatchError("Ticket already has an assigned helper")

        try:
            candidates, source = find_candidates(db, ticket)
        except ExtraHandError as e:
            raise DispatchError(f"Could not load helpers: {e}") from e

        if ticket.assignee_id:
            # Re-dispatch after escalation (e.g. the helper cannot attend): skip that helper
            from .followups import cancel_for_ticket

            candidates = [c for c in candidates if c["helper_id"] != ticket.assignee_id]
            log_event(db, ticket.id, "assignee_cleared",
                      f"Previous helper {ticket.assignee_name or ticket.assignee_id} removed locally")
            cancel_for_ticket(db, ticket.id)
            if not ticket.assignment_local_only:
                ticket.ignored_remote_assignee_id = ticket.assignee_id
            for f in ("assignee_id", "assignee_profile_id", "assignee_name", "assignee_phone"):
                setattr(ticket, f, None)
            ticket.assignment_local_only = False

        run = DispatchRun(ticket_id=ticket.id, candidates=candidates, candidate_source=source)
        db.add(run)
        ticket.dispatch_status = DispatchStatus.DISPATCHING
        db.flush()
        log_event(db, ticket.id, "dispatch_started",
                  f"Dispatch started ({trigger}): {len(candidates)} eligible helper(s) from {source.replace('_', ' ')}")
        if not candidates:
            _close_run(db, run, "escalated", "No eligible helpers for this location/service")
            escalate(db, ticket, "no_eligible_helpers",
                     f"No helpers with a phone number matched {ticket.category or 'the service'} "
                     f"near {ticket.city or ticket.address or 'the task location'}.")
        else:
            _call_next(db, run)
        db.commit()
        return run


def _close_run(db: Session, run: DispatchRun, status: str, reason: str) -> None:
    run.status = status
    run.reason = reason
    run.finished_at = utcnow()


WAITING_FOR_HOURS = "waiting_for_calling_hours"


def _call_next(db: Session, run: DispatchRun) -> None:
    ticket = db.get(Ticket, run.ticket_id)
    hours = calling_hours_state(db)
    if not hours["open"]:
        # Calling hours ended mid-dispatch: the next helper is called when the window opens again
        run.reason = WAITING_FOR_HOURS
        log_event(db, ticket.id, "dispatch_paused_hours",
                  f"Calling hours are {hours['label']}; the next helper will be called when they open")
        return
    provider, provider_error = get_provider_safe()
    while True:
        run.current_index += 1
        if run.current_index >= len(run.candidates):
            _close_run(db, run, "escalated", "No helper accepted after all attempts")
            summary = ", ".join(
                f"{a.helper_name or a.phone}: {(a.outcome or '?').replace('_', ' ')}"
                for a in db.query(CallAttempt).filter_by(run_id=run.id).order_by(CallAttempt.id)
            )
            escalate(db, ticket, "no_helper_accepted",
                     f"Called {len(run.candidates)} helper(s), none accepted. {summary}")
            return
        c = run.candidates[run.current_index]
        attempt = CallAttempt(
            ticket_id=ticket.id, purpose="dispatch", run_id=run.id, helper_id=c["helper_id"],
            helper_name=c["name"], phone=c["phone"], provider=provider.name if provider else "none",
            script=dispatch_script(ticket, c["name"]),
        )
        db.add(attempt)
        db.flush()
        try:
            if provider is None:
                raise RuntimeError(provider_error)
            attempt.provider_call_id = provider.place_call(attempt)
            attempt.status = "ringing"
            log_event(db, ticket.id, "call_placed",
                      f"Calling helper {run.current_index + 1}/{len(run.candidates)}: {c['name']} ({c['phone']})")
            return
        except Exception as e:  # noqa: BLE001 - any provider failure moves on to the next helper
            attempt.status, attempt.outcome, attempt.error, attempt.ended_at = "ended", "failed", str(e)[:500], utcnow()
            log_event(db, ticket.id, "call_failed", f"Could not call {c['name']}: {e}")


def resume_waiting_runs(db: Session) -> int:
    """Continues dispatches that paused because calling hours ended. Returns how many resumed."""
    if not calling_hours_state(db)["open"]:
        return 0
    r = runtime_settings(db)
    if r.emergency_stop_calls or not r.calling_agent_active:
        return 0
    resumed = 0
    with engine_lock:
        for run in db.query(DispatchRun).filter_by(status="running", reason=WAITING_FOR_HOURS).all():
            run.reason = None
            log_event(db, run.ticket_id, "dispatch_resumed_hours", "Calling hours opened: calling the next helper")
            _call_next(db, run)
            resumed += 1
        db.commit()
    return resumed


def get_provider_safe() -> tuple[TelephonyProvider | None, str | None]:
    try:
        return get_provider(), None
    except Exception as e:  # noqa: BLE001 - misconfiguration is reported per call
        return None, str(e)


def on_call_finished(db: Session, attempt: CallAttempt) -> None:
    run = db.get(DispatchRun, attempt.run_id) if attempt.run_id else None
    if not run or run.status != "running":
        return
    if attempt.outcome == "accepted":
        _accept(db, run, attempt)
    else:
        _call_next(db, run)


def _accept(db: Session, run: DispatchRun, attempt: CallAttempt) -> None:
    ticket = db.get(Ticket, run.ticket_id)
    cand = run.candidates[run.current_index]
    _close_run(db, run, "accepted", f"Accepted by {attempt.helper_name}")
    ticket.assignee_id = cand["helper_id"]
    ticket.assignee_profile_id = cand.get("profile_id")
    ticket.assignee_name = cand["name"]
    ticket.assignee_phone = cand["phone"]
    ticket.dispatch_status = DispatchStatus.ASSIGNED
    log_event(db, ticket.id, "helper_accepted", f"{cand['name']} accepted the task")

    # Accepted on our call: assigned here at once, then written to ExtraHand in the background (see assignment.py).
    # The sync keeps this local assignment until ExtraHand shows it (or ExtraHand itself assigns someone else).
    from .assignment import mark_local_assignment, push_assignment_later

    mark_local_assignment(ticket, "call")
    log_event(db, ticket.id, "assigned_local", f"{cand['name']} accepted on our call and was assigned")
    push_assignment_later(db, ticket.id)

    from .followups import schedule_for_ticket

    schedule_for_ticket(db, ticket)


def cancel_dispatch(db: Session, ticket_id: str, reason: str = "Cancelled by operator") -> None:
    with engine_lock:
        run = active_run(db, ticket_id)
        if not run:
            return
        _close_run(db, run, "cancelled", reason)
        for a in db.query(CallAttempt).filter(CallAttempt.run_id == run.id, CallAttempt.status.in_(ACTIVE_STATUSES)):
            a.status, a.outcome, a.ended_at = "ended", "cancelled", utcnow()
            try:
                if p := get_provider_safe()[0]:
                    p.hangup(a)
            except Exception as e:  # noqa: BLE001
                log.warning("hangup failed: %s", e)
        ticket = db.get(Ticket, ticket_id)
        if ticket.dispatch_status == DispatchStatus.DISPATCHING:
            ticket.dispatch_status = DispatchStatus.NEW
        log_event(db, ticket_id, "dispatch_cancelled", reason)
        db.commit()


def escalate(db: Session, ticket: Ticket, reason: str, details: str, keep_status: bool = False) -> Escalation:
    """Hands the ticket to customer care / helper support. ``keep_status`` leaves the ticket's dispatch status alone
    (an alert about an assigned helper, not a failed dispatch)."""
    existing = db.query(Escalation).filter(
        Escalation.ticket_id == ticket.id, Escalation.reason == reason, Escalation.status != "resolved"
    ).first()
    if not keep_status:
        ticket.dispatch_status = DispatchStatus.ESCALATED
    if existing:
        existing.details = details
        return existing
    esc = Escalation(ticket_id=ticket.id, reason=reason, details=details)
    db.add(esc)
    log_event(db, ticket.id, "escalated", f"Moved to customer care: {reason.replace('_', ' ')}")
    return esc
