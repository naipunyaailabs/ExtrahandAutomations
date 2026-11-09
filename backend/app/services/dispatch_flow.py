"""Today's dispatch pipelines (WhatsApp Dispatch Dashboard and Calling Agent flow), from real data only.

Orders: real customers only, live from ExtraHand (the same data as User Engagement: Works posted by the ExtraHand
team and test accounts are left out); "today" is India time and means booked or scheduled today.
Channel activity comes from this app's own records:
  WhatsApp  - the dispatch log ("Status: N sent, N simulated, N failed"): real sends, simulated sends (no Meta
              credentials, never delivered) and failures are counted separately.
  Calling   - call attempts, follow-ups and escalations; simulator calls are counted separately from real calls.
"""
from __future__ import annotations

import re
from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from ..models import CallAttempt, Escalation, Event, FollowUp, Helper

IST = timezone(timedelta(hours=5, minutes=30))
ASSIGNED_STATUSES = {"assigned", "accepted", "in_progress", "started", "on_the_way", "reached"}
CLOSED_STATUSES = {"completed", "closed", "done", "cancelled", "canceled", "failed", "expired", "rejected"}
UNUSABLE_HELPER_STATUSES = {"rejected", "suspended", "banned", "blocked", "inactive", "deleted"}
_SENT = re.compile(r"Status: (\d+) sent, (\d+) simulated, (\d+) failed")
_AGENT = re.compile(r"\((\d+) sent/simulated, (\d+) failed\)")


def _today_bounds_utc() -> tuple[datetime, datetime, Any]:
    """Start and end of today (India time) as naive UTC datetimes (how the app stores times), and the date."""
    today = datetime.now(IST).date()
    start = datetime.combine(today, dtime.min, IST).astimezone(timezone.utc).replace(tzinfo=None)
    return start, start + timedelta(days=1), today


def _today_orders(db: Session) -> Dict[str, Any]:
    """Real-customer orders, today's slice and the data source."""
    from user_engagement.service import load_orders

    data = load_orders(db)
    today = datetime.now(IST).date()
    orders = data["orders"]
    todays = [o for o in orders if today in (o["created_day"], o["scheduled_day"])]
    return {"all": orders, "today": todays, "source": data["source"], "fetched_at": data["fetched_at"],
            "note": data.get("reason", "")}


def real_customer_ticket_ids(db: Session) -> set[str]:
    """Ids of real-customer Works (no team-posted Works, no test accounts, no mock rows) - the tickets the
    dashboards count. The ticket lists show the same set."""
    from user_engagement.service import load_orders

    return {o["id"] for o in load_orders(db)["orders"]}


def _is_assigned(o: Dict[str, Any]) -> bool:
    return bool(o.get("helper_name")) or o["status"].lower() in ASSIGNED_STATUSES


def _progress(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    """How a group of orders stands right now: completed / in progress (open, assigned...) / cancelled."""
    return {
        "completed": sum(1 for o in rows if o["state_type"] == "success"),
        "in_progress": sum(1 for o in rows if o["state_type"] == "pending"),
        "cancelled": sum(1 for o in rows if o["state_type"] == "fail"),
    }


from .real_data import is_real_helper  # noqa: E402  (shared check: real helpers only)


def _usable_helpers(db: Session) -> List[Helper]:
    """Real helpers who can take work now: active, allowed to accept tasks, not rejected / suspended."""
    return [h for h in db.query(Helper).all()
            if is_real_helper(h) and h.is_active and h.can_accept_tasks
            and (h.status or "").lower() not in UNUSABLE_HELPER_STATUSES]


def _matches(helper: Helper, slugs: set[str]) -> bool:
    keys = {str(k).lower() for k in (helper.categories or []) + (helper.skills or [])}
    words = {w for k in keys for w in re.split(r"[\s_\-/&]+", k) if len(w) > 2}
    for slug in slugs:
        if slug in keys or any(w in words for w in re.split(r"[\s_\-/&]+", slug) if len(w) > 2):
            return True
    return False


def _base(orders: Dict[str, Any]) -> Dict[str, Any]:
    today = orders["today"]
    return {
        "today": datetime.now(IST).date().isoformat(),
        "source": orders["source"],
        "fetched_at": orders["fetched_at"],
        "source_note": orders["note"],
        "tasks_today": len(today),
        "total_orders": len(orders["all"]),
    }


# ---------------------------------------------------------------------------------------------- WhatsApp
def whatsapp_send_counts(db: Session) -> Dict[str, Dict[str, int]]:
    """Real / simulated / failed WhatsApp sends from the dispatch log, today (India time) and in total."""
    start, end, _ = _today_bounds_utc()
    out = {k: {"today": 0, "total": 0} for k in ("sent", "simulated", "failed")}
    for e in db.query(Event).filter(Event.kind.like("%whatsapp%")).all():
        is_today = e.created_at is not None and start <= e.created_at < end
        m = _SENT.search(e.message or "")
        if m:
            parts = (int(m[1]), int(m[2]), int(m[3]))
        else:
            m2 = _AGENT.search(e.message or "")
            if not m2:
                continue
            parts = (0, int(m2[1]), int(m2[2]))  # "sent/simulated": not confirmed as delivered
        for key, n in zip(("sent", "simulated", "failed"), parts):
            out[key]["total"] += n
            if is_today:
                out[key]["today"] += n
    return out


def whatsapp_flow(db: Session) -> Dict[str, Any]:
    orders = _today_orders(db)
    today = orders["today"]

    # helpers who can take today's open orders (approved / active, can accept tasks, matching service)
    open_today = [o for o in today if o["status"].lower() not in CLOSED_STATUSES and not _is_assigned(o)]
    slugs = {o.get("category_slug") or o["category"].lower() for o in open_today}
    usable = _usable_helpers(db)
    matched = [h for h in usable if _matches(h, slugs)] if slugs else []

    counts = whatsapp_send_counts(db)
    sent, simulated, failed = counts["sent"], counts["simulated"], counts["failed"]

    return {
        **_base(orders),
        "open_today": len(open_today),
        "eligible_helpers": len(matched),
        "helper_pool": len(usable),
        "sent_today": sent["today"],
        "sent_total": sent["total"],
        "simulated_today": simulated["today"],
        "simulated_total": simulated["total"],
        "failed_today": failed["today"],
        "failed_total": failed["total"],
        "in_progress_today": sum(1 for o in today if _is_assigned(o) and o["status"].lower() not in CLOSED_STATUSES),
        "completed_today": sum(1 for o in today if o["state_type"] == "success"),
        "delivery_tracking": False,  # Meta delivery receipts are not stored yet
    }


# ---------------------------------------------------------------------------------------------- Calling
def calling_flow(db: Session) -> Dict[str, Any]:
    orders = _today_orders(db)
    start, end, _ = _today_bounds_utc()
    today = orders["today"]
    # every task today is either assigned (a helper is on it) or not assigned, whatever its status now
    assigned = [o for o in today if _is_assigned(o)]
    not_assigned = [o for o in today if not _is_assigned(o)]
    today_ids = {o["id"] for o in today}

    calls_today = db.query(CallAttempt).filter(CallAttempt.created_at >= start, CallAttempt.created_at < end).all()
    real = [c for c in calls_today if c.provider != "simulator"]
    simulated = [c for c in calls_today if c.provider == "simulator"]
    dispatch = [c for c in calls_today if c.purpose == "dispatch"]
    followup_calls = [c for c in calls_today if c.purpose == "followup"]
    accepted = [c for c in dispatch if (c.outcome or "").startswith("accept") or c.outcome == "confirmed" or c.digits == "1"]
    active = db.query(CallAttempt).filter(CallAttempt.status.notin_(["ended", "failed", "completed"])).count()

    # follow-ups for today's real tasks only (not for other days' or mock tickets)
    followups = [f for f in db.query(FollowUp).filter(FollowUp.due_at >= start, FollowUp.due_at < end).all()
                 if f.ticket_id in today_ids]
    followups_due_today = [f for f in followups if (f.status or "") not in ("cancelled", "canceled")]
    escalations = db.query(Escalation).all()
    open_escalations = [e for e in escalations if (e.status or "").lower() == "open"]
    escalated_today = [e for e in escalations if e.created_at and start <= e.created_at < end]

    return {
        **_base(orders),
        "assigned_today": len(assigned),
        "unassigned_today": len(not_assigned),
        "assigned_progress": _progress(assigned),
        "unassigned_progress": _progress(not_assigned),
        "today_progress": _progress(today),
        "cancelled_today": sum(1 for o in today if o["state_type"] == "fail"),
        "calls_today": len(calls_today),
        "real_calls_today": len(real),
        "simulated_calls_today": len(simulated),
        "dispatch_calls_today": len(dispatch),
        "accepted_today": len(accepted),
        "followup_calls_today": len(followup_calls),
        "followups_due_today": len(followups_due_today),
        "followups_done_today": sum(1 for f in followups_due_today if (f.status or "") in ("done", "completed")),
        "followups_cancelled_today": len(followups) - len(followups_due_today),
        "active_calls": active,
        "open_escalations": len(open_escalations),
        "escalated_today": len(escalated_today),
    }
