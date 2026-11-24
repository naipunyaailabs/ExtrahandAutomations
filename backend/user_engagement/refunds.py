"""Refunded Works: every refund ExtraHand made to a real customer, joined to its Work.

Source: GET /payments/refunds (Main Admin API). It pages with ``offset`` / ``limit`` (at most 200 a call) and returns
``total``. Each refund has the amount, status (completed / processing), the Razorpay refund id, the reason, who
cancelled (``cancelledBy``: poster = customer, performer = helper), the fee kept (``cancellationFee``, split into
``toPlatform`` and ``toOtherParty`` = the helper) and its escrow (``amountInRupees`` = what the customer paid).

The Work of each refund is read from the Work list; Works missing from it (deleted, e.g. ExtraHand team test
bookings) are read once by id (GET /tasks/{id}) so they can be checked. Only real customers: team-posted Works and
test accounts are left out, as everywhere in User Engagement. Refreshed every 5 minutes in the background.

Who started the refund:
  admin     the reason says an admin made or recorded it ("Admin refund ...", "... recorded by admin ...")
  customer  cancelledBy = poster
  helper    cancelledBy = performer (the helper cancelled, the customer got their money back)
  unknown   nothing recorded
Method: "razorpay" when a Razorpay refund id exists, otherwise "recorded" (written in ExtraHand's database only,
e.g. "database-only, no payment-provider call").
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional

from .extrahand_data import (
    IST, POLL_SECONDS, EngagementDataUnavailable, _cache, _cached, _get, _lock, _refresh_in_background, all_tasks,
    extract_list, is_real_customer_work, parse_time, test_accounts,
)

logger = logging.getLogger("user_engagement.refunds")

PAGE = 100   # 200 is allowed but each refund carries its escrow record, and big pages can time out
MAX_REFUNDS = 20000
TASK_FIELDS = ("_id", "taskId", "status", "title", "categoryLabel", "category", "customerName", "customerPhone",
               "CustomerId", "customerId", "requesterId", "postedBy", "isTeamPosted", "location", "createdAt",
               "scheduledDate", "scheduledTimeStart", "scheduledTimeEnd", "assignedHelperName", "assigneeName",
               "paymentAmount", "budget", "bookingSource", "cancelledAt", "cancellationReason", "updatedAt")

# task id -> (version, Work fields): Works read by id; version = the list's updatedAt, or "detail" for unlisted ones
_works: Dict[str, tuple] = {}


# ---------------------------------------------------------------------------- refund records
def _load_records() -> List[Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    offset = 0
    while offset < MAX_REFUNDS:
        try:
            data = _get("/payments/refunds", {"limit": PAGE, "offset": offset})
        except EngagementDataUnavailable:
            time.sleep(2)  # one more try: a slow ExtraHand reply should not lose the whole read
            data = _get("/payments/refunds", {"limit": PAGE, "offset": offset})
        items = extract_list(data)
        for r in items:
            rid = str(r.get("id") or r.get("refundId") or "")
            if rid:
                out[rid] = r
        offset += len(items)
        if len(items) < PAGE or offset >= int(data.get("total") or 0):
            break
    logger.info("[User Engagement] Read %d refunds from ExtraHand", len(out))
    return list(out.values())


def refund_records() -> List[Dict[str, Any]]:
    """Every refund record (cached for the 5-minute polling interval)."""
    value, _ = _cached("refund_records", _load_records)
    return value


def refunds_by_task() -> Dict[str, Dict[str, Any]]:
    """task id -> {amount, refunded_at, status}: refunds summed per Work. Empty when the refunds cannot be read,
    so callers (the Cancelled Works page) still work."""
    try:
        records = refund_records()
    except EngagementDataUnavailable:
        return {}
    by: Dict[str, Dict[str, Any]] = {}
    for r in records:
        tid = str(r.get("taskId") or "")
        if not tid:
            continue
        b = by.setdefault(tid, {"amount": 0.0, "refunded_at": None, "status": "completed"})
        b["amount"] += _money(r.get("refundAmount"))
        when = r.get("completedAt") or r.get("createdAt")
        if when and (b["refunded_at"] is None or when > b["refunded_at"]):
            b["refunded_at"] = when
        if str(r.get("status") or "").lower() != "completed":
            b["status"] = str(r.get("status") or "processing").lower()
    return by


# ---------------------------------------------------------------------------- helpers
def _money(v: Any) -> float:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def _opt_money(v: Any) -> Optional[float]:
    return None if v in (None, "") else _money(v)


def _iso(value: Any) -> Optional[str]:
    dt = parse_time(value)
    return dt.astimezone(IST).isoformat() if dt else None


def started_by(reason: Optional[str], cancelled_by: Optional[str]) -> str:
    """admin | customer | helper | unknown (see the module notes)."""
    r = (reason or "").lower()
    if "admin" in r:
        return "admin"
    by = (cancelled_by or "").lower()
    if by in ("poster", "customer"):
        return "customer"
    if by in ("performer", "helper", "tasker"):
        return "helper"
    return "unknown"


def _read_work(task_id: str) -> Dict[str, Any]:
    data = _get(f"/tasks/{task_id}", {})
    t = data.get("data", data) if isinstance(data, dict) else {}
    if isinstance(t, dict) and isinstance(t.get("task"), dict):
        t = t["task"]
    return {k: t.get(k) for k in TASK_FIELDS} if isinstance(t, dict) else {}


def _works_for(task_ids: List[str], listed: Dict[str, Dict[str, Any]]) -> None:
    """Read by id the Works of the refunds (six at a time): listed ones again only when they changed (for the
    cancel time, which the list does not carry); unlisted ones once."""
    todo = []
    for tid in task_ids:
        version = listed[tid].get("updatedAt") if tid in listed else "detail"
        seen = _works.get(tid)
        if seen is None or seen[0] != version:
            todo.append((tid, version))
    if not todo:
        return

    def one(item):
        tid, version = item
        try:
            _works[tid] = (version, _read_work(tid))
        except EngagementDataUnavailable as exc:
            if "404" in str(exc):
                _works[tid] = (version, {"_missing": True})  # ExtraHand no longer has this Work: do not ask again
            else:  # timeout or outage: try again on the next refresh
                logger.warning("[User Engagement] Could not read the Work %s of a refund: %s", tid, exc)

    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(one, todo))
    logger.info("[User Engagement] Read %d Works of refunds", len(todo))


# ---------------------------------------------------------------------------- rows
def _row(r: Dict[str, Any], t: Dict[str, Any]) -> Dict[str, Any]:
    escrow = r.get("escrow") if isinstance(r.get("escrow"), dict) else {}
    loc = t.get("location") if isinstance(t.get("location"), dict) else {}
    amount = _money(r.get("refundAmount"))
    paid = _opt_money(escrow.get("amountInRupees")) or _opt_money(t.get("paymentAmount"))
    reason = (r.get("reason") or "").strip() or None
    requested = parse_time(r.get("createdAt"))
    cancelled = parse_time(t.get("cancelledAt"))
    hours = round((requested - cancelled).total_seconds() / 3600, 1) if requested and cancelled and requested >= cancelled else None
    customer_ids = sorted(str(t[k]) for k in ("CustomerId", "customerId", "requesterId") if t.get(k))
    status = str(r.get("status") or "").lower() or "unknown"
    return {
        "id": str(r.get("id") or r.get("refundId") or ""),
        "refund_id": r.get("refundId") or "",
        "razorpay_refund_id": r.get("razorpayRefundId") or "",
        "payment_id": r.get("paymentId") or escrow.get("razorpayPaymentId") or "",
        "task_id": str(r.get("taskId") or ""),
        "requested_at": _iso(r.get("createdAt")),
        "completed_at": _iso(r.get("completedAt")),
        "status": status,
        "method": "razorpay" if r.get("razorpayRefundId") else "recorded",
        "amount": amount,
        "paid": paid,
        "full": paid is None or amount >= paid - 0.5,
        "fee_kept": _opt_money(r.get("cancellationFee")),
        "to_platform": _opt_money(r.get("toPlatform")),
        "to_helper": _opt_money(r.get("toOtherParty")),
        "reason": reason,
        "started_by": started_by(reason, r.get("cancelledBy")),
        "cancelled_at": _iso(t.get("cancelledAt")),
        "hours_to_refund": hours,
        "title": t.get("title") or "Service Work",
        "category": t.get("categoryLabel") or t.get("category") or escrow.get("taskCategory") or "General",
        "work_status": str(t.get("status") or ""),
        "customer_name": t.get("customerName") or "Unknown",
        "customer_phone": t.get("customerPhone") or "",
        "customer_key": customer_ids[0] if customer_ids else (t.get("customerPhone") or ""),
        "city": loc.get("city") or "",
        "area": loc.get("taskArea") or loc.get("area") or "",
        "booked_at": _iso(t.get("createdAt")),
        "scheduled_at": _iso(t.get("scheduledDate")),
        "scheduled_slot": " - ".join(x for x in (t.get("scheduledTimeStart"), t.get("scheduledTimeEnd")) if x),
        "helper_name": t.get("assignedHelperName") or t.get("assigneeName") or "",
        "booking_source": t.get("bookingSource") or "",
    }


def _load_refunds() -> Dict[str, Any]:
    records = refund_records()
    tests = test_accounts()
    every_task, fetched = all_tasks()
    listed = {str(t.get("_id") or t.get("taskId") or ""): t for t in every_task}
    task_ids = sorted({str(r.get("taskId")) for r in records if r.get("taskId")})
    _works_for(task_ids, listed)

    rows: List[Dict[str, Any]] = []
    left_out = {"team_or_test": 0, "work_missing": 0, "not_read_yet": 0}
    missing_amount = 0.0
    for r in records:
        tid = str(r.get("taskId") or "")
        work = {**(_works.get(tid, (None, {}))[1]), **listed.get(tid, {})}
        if work.get("_missing"):
            # the Work is gone (deleted, or a booking that never became a Work): customer cannot be checked
            left_out["work_missing"] += 1
            missing_amount += _money(r.get("refundAmount"))
        elif not work:
            left_out["not_read_yet"] += 1
        elif r.get("teamTest") is True or not is_real_customer_work(work, tests):
            left_out["team_or_test"] += 1
        else:
            rows.append(_row(r, work))
    rows.sort(key=lambda x: x["requested_at"] or "", reverse=True)
    return {
        "fetched_at": datetime.fromtimestamp(fetched, IST).isoformat(),
        "total": len(rows),
        "amount": round(sum(x["amount"] for x in rows), 2),
        "left_out": left_out,
        "work_missing_amount": round(missing_amount, 2),
        "rows": rows,
    }


def refunds_summary() -> Optional[Dict[str, Any]]:
    """Cached refunds, refreshed in the background when older than 5 minutes. None while the very first read
    (every refund and its Work: a couple of minutes, as deleted Works are read one by one) is still running."""
    with _lock:
        hit = _cache.get("refunds")
    if hit is None:
        _refresh_in_background("refunds", _load_refunds)
        return None
    if time.time() - hit[0] >= POLL_SECONDS:
        _refresh_in_background("refunds", _load_refunds)
    return hit[1]
