"""Cancelled Works: every real-customer Work that was cancelled, with who cancelled it and why.

ExtraHand's Work list (GET /tasks) only says ``status: cancelled``. The details are on the single Work
(GET /tasks/{id}): ``cancellationReason``, ``cancelledAt``, ``cancelledById``, ``isRefunded`` / ``refundedAt``.
There is no "cancelled by" role, so the side is worked out like this:

  customer   cancelledById is the customer's own account, or the reason is ExtraHand's "Cancelled by customer"
  team       the reason is an ExtraHand team action (admin refund, test clean-up...), or another account cancelled
             it without a customer reason
  unknown    no reason and no cancelling account recorded (older Works, from before ExtraHand recorded them)

A cancelled Work's details are read once and kept; they are read again only when ExtraHand changes the Work
(its ``updatedAt`` moves, e.g. a later refund). Only real customers: team-posted Works and test accounts are left out.
Refreshed with the other User Engagement data every 5 minutes in the background.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from .extrahand_data import (
    IST, POLL_SECONDS, EngagementDataUnavailable, _cache, _get, _lock, _refresh_in_background, all_tasks,
    is_real_customer_work, parse_time, test_accounts,
)

logger = logging.getLogger("user_engagement.cancellations")

CANCELLED = {"cancelled", "canceled"}
CUSTOMER_REASON = "cancelled by customer"
# Reasons that come from the ExtraHand team, not from the customer app
TEAM_WORDS = ("admin", "refund via", "orphaned", "test task", "by support", "by team")

# task id -> (updatedAt seen in the Work list, the cancellation details)
_details: Dict[str, tuple] = {}


def cancelled_by(reason: Optional[str], by_id: Optional[str], customer_ids: Set[str]) -> str:
    """customer | team | unknown (see the module notes)."""
    r = (reason or "").strip().lower()
    if by_id and by_id in customer_ids:
        return "customer"
    if r and any(w in r for w in TEAM_WORDS):
        return "team"
    if r == CUSTOMER_REASON:
        return "customer"
    if by_id:
        return "team"
    return "customer" if r else "unknown"


def _read_detail(task_id: str) -> Dict[str, Any]:
    data = _get(f"/tasks/{task_id}", {})
    t = data.get("data", data) if isinstance(data, dict) else {}
    if isinstance(t, dict) and isinstance(t.get("task"), dict):
        t = t["task"]
    t = t if isinstance(t, dict) else {}
    return {k: t.get(k) for k in ("cancellationReason", "cancelledAt", "cancelledById", "isRefunded", "refundedAt")}


def _fetch_details(tasks: List[Dict[str, Any]]) -> None:
    """Read the details of the cancelled Works not read yet (or changed since), six at a time."""
    todo = []
    for t in tasks:
        tid = str(t.get("_id") or t.get("taskId") or "")
        seen = _details.get(tid)
        if tid and (seen is None or seen[0] != t.get("updatedAt")):
            todo.append((tid, t.get("updatedAt")))
    if not todo:
        return

    def one(item):
        tid, updated = item
        try:
            _details[tid] = (updated, _read_detail(tid))
        except EngagementDataUnavailable as exc:  # keep the row; try again on the next refresh
            logger.warning("[User Engagement] Could not read cancelled Work %s: %s", tid, exc)

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(one, todo))
    logger.info("[User Engagement] Read details of %d cancelled Works", len(todo))


def _iso(value: Any) -> Optional[str]:
    dt = parse_time(value)
    return dt.astimezone(IST).isoformat() if dt else None


def _row(t: Dict[str, Any], d: Dict[str, Any], refund: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    loc = t.get("location") if isinstance(t.get("location"), dict) else {}
    customer_ids = {str(t[k]) for k in ("CustomerId", "customerId", "requesterId") if t.get(k)}
    reason = (d.get("cancellationReason") or "").strip() or None
    by_id = str(d.get("cancelledById") or "") or None
    side = cancelled_by(reason, by_id, customer_ids)
    note = ""
    if side == "customer" and by_id and by_id not in customer_ids:
        note = "Marked as cancelled by the customer, entered from an ExtraHand team account"
    elif side == "customer" and not by_id:
        note = "ExtraHand records the customer as the canceller"
    elif side == "unknown":
        note = "ExtraHand did not record who cancelled this Work or why"
    cancelled_at = _iso(d.get("cancelledAt"))
    return {
        "id": str(t.get("taskId") or t.get("_id") or ""),
        "title": t.get("title") or "Service Work",
        "category": t.get("categoryLabel") or t.get("category") or "General",
        "customer_name": t.get("customerName") or "Unknown",
        "customer_phone": t.get("customerPhone") or "",
        "customer_key": next(iter(sorted(customer_ids)), "") or t.get("customerPhone") or "",
        "city": loc.get("city") or "",
        "area": loc.get("taskArea") or loc.get("area") or "",
        "booked_at": _iso(t.get("createdAt")),
        "scheduled_at": _iso(t.get("scheduledDate")),
        "scheduled_slot": " - ".join(x for x in (t.get("scheduledTimeStart"), t.get("scheduledTimeEnd")) if x),
        # None when ExtraHand did not record it (updatedAt is no stand-in: bulk updates move it on old Works)
        "cancelled_at": cancelled_at,
        "reason": reason,
        "side": side,
        "side_note": note,
        "helper_name": t.get("assignedHelperName") or t.get("assigneeName") or "",
        "amount": float(t.get("paymentAmount") or t.get("budget") or 0),
        "payment_type": t.get("paymentType") or "",
        # the refunds API is the record of money returned; the Work's own isRefunded flag is rarely set
        "refunded": bool(refund) or bool(d.get("isRefunded")),
        "refunded_at": _iso((refund or {}).get("refunded_at") or d.get("refundedAt")),
        "refund_amount": round(refund["amount"], 2) if refund else None,
        "booking_source": t.get("bookingSource") or "",
    }


def _load_cancellations() -> Dict[str, Any]:
    tests = test_accounts()
    every_task, fetched = all_tasks()
    tasks = [t for t in every_task
             if str(t.get("status") or "").strip().lower() in CANCELLED and is_real_customer_work(t, tests)]
    _fetch_details(tasks)
    from .refunds import refunds_by_task  # refunds.py imports extrahand_data too; imported here to keep startup light

    refunds = refunds_by_task()
    rows = []
    for t in tasks:
        tid = str(t.get("_id") or t.get("taskId") or "")
        rows.append(_row(t, _details.get(tid, (None, {}))[1], refunds.get(tid)))
    rows.sort(key=lambda r: r["cancelled_at"] or r["booked_at"] or "", reverse=True)
    by_side = {s: sum(1 for r in rows if r["side"] == s) for s in ("customer", "team", "unknown")}
    return {
        "fetched_at": datetime.fromtimestamp(fetched, IST).isoformat(),
        "total": len(rows),
        "by_side": by_side,
        "rows": rows,
        "completed": _completed(every_task, tests),
    }


COMPLETED = {"completed", "closed", "done"}  # the same "success" statuses as the User Engagement dashboard


def _completed(every_task: List[Dict[str, Any]], tests: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Real-customer Works that were completed, for the "completed" and "money received" cards next to the
    cancellations: when (the day it was scheduled for, else booked), what the customer paid, city and service."""
    out = []
    for t in every_task:
        if str(t.get("status") or "").strip().lower() not in COMPLETED or not is_real_customer_work(t, tests):
            continue
        loc = t.get("location") if isinstance(t.get("location"), dict) else {}
        out.append({
            "id": str(t.get("taskId") or t.get("_id") or ""),
            "when": _iso(t.get("scheduledDate")) or _iso(t.get("createdAt")),
            "amount": float(t.get("paymentAmount") or t.get("budget") or 0),
            "city": loc.get("city") or "",
            "category": t.get("categoryLabel") or t.get("category") or "General",
        })
    return out


def cancellations_summary() -> Optional[Dict[str, Any]]:
    """The cached cancelled Works, refreshed in the background when older than 5 minutes. None while the very
    first read (every cancelled Work's details, about ten seconds) is still running."""
    with _lock:
        hit = _cache.get("cancellations")
    if hit is None:
        _refresh_in_background("cancellations", _load_cancellations)
        return None
    if time.time() - hit[0] >= POLL_SECONDS:
        _refresh_in_background("cancellations", _load_cancellations)
    return hit[1]


# ---------------------------------------------------------------------------- card numbers (computed here)
NO_REASON = "No reason given"
NO_CITY = "City not set"


def pretty_category(s: str) -> str:
    """A slug like plumbing-tap-mixer becomes "Plumbing tap mixer"; proper labels (Bathroom Cleaning) stay as they are
    (the same rule the page uses, so its category filter matches)."""
    if any(c.isupper() or c == " " for c in s):
        return s
    return (s[:1].upper() + s[1:]).replace("-", " ").replace("_", " ")


def _ist_day(iso_text: Optional[str]) -> Optional[str]:
    dt = parse_time(iso_text)
    return dt.astimezone(IST).date().isoformat() if dt else None


def summarize(data: Dict[str, Any], side: str = "customer", date_from: Optional[str] = None,
              date_to: Optional[str] = None, city: Optional[str] = None, category: Optional[str] = None,
              reason: Optional[str] = None, q: Optional[str] = None) -> Dict[str, Any]:
    """The numbers on the Cancelled Works cards for the given filters (dates are India days, from inclusive, to
    exclusive). Cancelled Works are placed on the day they were cancelled (booked, if that was not recorded);
    completed Works on the day they were scheduled for (booked, if not scheduled)."""
    def in_period(day: Optional[str]) -> bool:
        return date_from is None or (day is not None and day >= date_from and (date_to is None or day < date_to))

    needle = (q or "").strip().lower()
    fields = ("customer_name", "customer_phone", "title", "category", "city", "area", "reason", "id", "helper_name")
    rows = []
    for r in data.get("rows") or []:
        if side != "all" and r.get("side") != side:
            continue
        if not in_period(_ist_day(r.get("cancelled_at") or r.get("booked_at"))):
            continue
        if city and (r.get("city") or NO_CITY) != city:
            continue
        if category and pretty_category(r.get("category") or "") != category:
            continue
        if reason and (r.get("reason") or NO_REASON) != reason:
            continue
        if needle and not any(needle in str(r.get(k) or "").lower() for k in fields):
            continue
        rows.append(r)
    completed = [w for w in data.get("completed") or []
                 if in_period(_ist_day(w.get("when")))
                 and (not city or (w.get("city") or NO_CITY) == city)
                 and (not category or pretty_category(w.get("category") or "") == category)]

    def money(items: List[Dict[str, Any]]) -> float:
        return round(sum(float(x.get("amount") or 0) for x in items), 2)

    def share(part: List[Dict[str, Any]]) -> int:
        return round(100 * len(part) / len(rows)) if rows else 0

    refunded = [r for r in rows if r.get("refunded")]
    not_refunded = [r for r in rows if not r.get("refunded")]
    received = money(completed)
    finished = len(rows) + len(completed)
    return {
        "cancelled": {"count": len(rows), "value": money(rows),
                      "rate": round(100 * len(rows) / finished) if finished else None},
        "refunded": {"count": len(refunded), "share": share(refunded),
                     "returned": round(sum(float(r.get("refund_amount") or r.get("amount") or 0) for r in refunded), 2),
                     "paid": money(refunded)},
        "not_refunded": {"count": len(not_refunded), "share": share(not_refunded), "value": money(not_refunded),
                         "paid_bookings": sum(1 for r in not_refunded
                                              if r.get("payment_type") and r.get("payment_type") != "free")},
        "completed": {"count": len(completed), "received": received,
                      "average": round(received / len(completed), 2) if completed else None},
        "fetched_at": data.get("fetched_at"),
    }
