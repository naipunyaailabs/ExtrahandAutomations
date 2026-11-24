"""The sender's own ExtraHand data, matched on the WhatsApp phone number.

Everything comes from the ExtraHand Main Admin API (the same live data as the rest of the app): the Work list (cached
for 5 minutes), the open Works read fresh, the customer's account and the refunds. Only Works whose customer phone or
customer id belongs to this number are returned, so the agent can never see or act on another customer's booking.
Nothing is invented: a field ExtraHand does not have is left out and the agent says it is not available."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from app.integrations.mapping import extract_list

from .settings import phone_key

logger = logging.getLogger("whatsapp.support.data")
IST = timezone(timedelta(hours=5, minutes=30))
MAX_BOOKINGS = 8  # most recent bookings given to the agent
OPEN = {"open", "pending", "posted", "assigned", "accepted", "confirmed", "scheduled", "in_progress", "in-progress",
        "inprogress", "started", "ongoing", "active", "booked", "matched", "awaiting_payment"}
DONE = {"completed", "closed", "done"}
CANCELLED = {"cancelled", "canceled", "cancelled_by_customer", "cancelled_by_admin", "expired", "rejected"}

_account_cache: dict[str, tuple[float, Any]] = {}
ACCOUNT_TTL = 300


# --------------------------------------------------------------------------------------------- data sources
# (functions, so the tests can swap them for fixed data)
def _all_tasks() -> list[dict]:
    from user_engagement.extrahand_data import all_tasks

    return all_tasks()[0]


def _get(path: str, params: dict | None = None) -> dict:
    from user_engagement.extrahand_data import _get as get

    return get(path, params or {})


def _refunds_by_task() -> dict[str, dict]:
    from user_engagement.refunds import refunds_by_task

    return refunds_by_task()


SOURCES: dict[str, Callable[..., Any]] = {"tasks": _all_tasks, "get": _get, "refunds": _refunds_by_task}


# --------------------------------------------------------------------------------------------- helpers
def _first(d: dict, *keys: str) -> Any:
    for k in keys:
        cur: Any = d
        for part in k.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur not in (None, "", [], {}):
            return cur
    return None


def _iso(v: Any) -> str | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()
    except ValueError:
        return str(v)


def _pretty_day(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso).astimezone(IST).strftime("%a %d %b %Y")
    except ValueError:
        return iso


def _customer_ids(t: dict) -> set[str]:
    ids = {str(t[k]) for k in ("CustomerId", "customerId", "requesterId", "customerUid", "userId") if t.get(k)}
    for k in ("customer", "requester", "postedBy", "createdBy"):
        v = t.get(k)
        if isinstance(v, dict):
            ids.update(str(v[x]) for x in ("_id", "uid", "id") if v.get(x))
        elif isinstance(v, str) and len(v) > 12:
            ids.add(v)
    return ids


def _task_phone(t: dict) -> str:
    return phone_key(_first(t, "customerPhone", "requesterPhone", "contactPhone", "contactNumber",
                            "customer.phone", "customer.phoneNumber", "requester.phone"))


def task_id(t: dict) -> str:
    return str(t.get("_id") or t.get("taskId") or t.get("id") or "")


# --------------------------------------------------------------------------------------------- account
def find_account(phone: str) -> dict | None:
    """The customer account registered with this phone number (None when there is none or it cannot be read)."""
    key = phone_key(phone)
    hit = _account_cache.get(key)
    if hit and time.time() - hit[0] < ACCOUNT_TTL:
        return hit[1]
    account = None
    try:
        data = SOURCES["get"]("/users", {"role": "customer", "search": key, "page": 1, "limit": 20})
        for u in extract_list(data):
            phones = {phone_key(_first(u, p)) for p in ("phone", "phoneNumber", "mobile", "contact.phone", "profile.phone")}
            if key in phones:
                loc = u.get("location") if isinstance(u.get("location"), dict) else {}
                account = {
                    "ids": sorted({str(u[k]) for k in ("_id", "uid", "userId", "profileId") if u.get(k)}),
                    "name": _first(u, "name", "fullName", "profile.name") or None,
                    "email": _first(u, "email", "contact.email"),
                    "city": _first(loc, "addressDetails.city", "city") or _first(u, "address.city", "city"),
                    "member_since": _pretty_day(_iso(u.get("createdAt"))),
                }
                break
    except Exception as exc:  # noqa: BLE001 - ExtraHand offline / mock mode: fall back to the bookings
        logger.info("[WhatsApp Support] account lookup failed: %s", exc)
    _account_cache[key] = (time.time(), account)
    return account


# --------------------------------------------------------------------------------------------- bookings
def _fresh(t: dict) -> dict:
    """An open Work read again from ExtraHand (status and helper change often); the cached copy if that fails."""
    try:
        data = SOURCES["get"](f"/tasks/{task_id(t)}")
        d = data.get("data", data) if isinstance(data, dict) else {}
        if isinstance(d, dict) and isinstance(d.get("task"), dict):
            d = d["task"]
        if isinstance(d, dict) and d:
            return {**t, **d}
    except Exception as exc:  # noqa: BLE001
        logger.info("[WhatsApp Support] could not refresh Work %s: %s", task_id(t), exc)
    return t


def booking_view(t: dict, refund: dict | None = None) -> dict[str, Any]:
    """What the agent may tell the customer about one of their bookings (only fields ExtraHand really has)."""
    status = str(t.get("status") or "").strip().lower() or None
    loc = t.get("location") if isinstance(t.get("location"), dict) else {}
    slot = " - ".join(x for x in (t.get("scheduledTimeStart"), t.get("scheduledTimeEnd")) if x) or None
    scheduled = _iso(_first(t, "scheduledDate", "scheduledAt", "scheduledDateTime", "preferredDate"))
    amount = _first(t, "paymentAmount", "budget", "price", "amount", "totalAmount")
    paid = _first(t, "paymentStatus", "payment.status")
    if paid is None and t.get("isPaid") is not None:
        paid = "paid" if t.get("isPaid") else "not paid"
    helper = _first(t, "assignedHelperName", "assigneeName", "helperName", "assignee.name", "assignedHelper.name")
    view: dict[str, Any] = {
        "booking_id": task_id(t),
        "booking_ref": t.get("taskId") if t.get("taskId") and str(t.get("taskId")) != task_id(t) else None,
        "service": t.get("title") or None,
        "category": t.get("categoryLabel") or t.get("category") or None,
        "status": status,
        "booked_on": _pretty_day(_iso(t.get("createdAt"))),
        "scheduled_date": _pretty_day(scheduled),
        "scheduled_time": slot,
        "amount_rupees": float(amount) if isinstance(amount, (int, float, str)) and str(amount).replace(".", "", 1).isdigit() else None,
        "payment_type": t.get("paymentType") or t.get("paymentMode") or None,
        "payment_status": paid,
        "helper_assigned": bool(helper),
        "helper_name": helper,
        "area": loc.get("taskArea") or loc.get("area") or None,
        "city": loc.get("city") or None,
    }
    if status in CANCELLED:
        view["cancelled_on"] = _pretty_day(_iso(t.get("cancelledAt")))
        view["cancellation_reason"] = t.get("cancellationReason") or None
    if refund:
        view["refund"] = {"refunded": True, "amount_rupees": refund.get("amount"),
                          "refunded_on": _pretty_day(_iso(refund.get("refunded_at"))), "status": refund.get("status")}
    elif status in CANCELLED:
        view["refund"] = {"refunded": bool(t.get("isRefunded")),
                          "refunded_on": _pretty_day(_iso(t.get("refundedAt"))) if t.get("isRefunded") else None,
                          "note": None if t.get("isRefunded") else "ExtraHand has no refund recorded for this booking"}
    return {k: v for k, v in view.items() if v is not None}


def snapshot(phone: str, refresh_open: bool = True) -> dict[str, Any]:
    """The sender's account and bookings, newest first. found=False when the number has no account and no bookings."""
    key = phone_key(phone)
    out: dict[str, Any] = {"found": False, "customer": None, "bookings": [], "total_bookings": 0,
                           "as_of": datetime.now(IST).strftime("%d %b %Y %I:%M %p"), "error": None}
    if len(key) < 10:
        return out
    account = find_account(phone)
    ids = set(account["ids"]) if account else set()
    try:
        tasks = SOURCES["tasks"]()
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"Bookings could not be read from ExtraHand right now ({str(exc)[:120]})"
        tasks = []
    mine = [t for t in tasks if _task_phone(t) == key or (ids and _customer_ids(t) & ids)]
    mine.sort(key=lambda t: str(t.get("createdAt") or ""), reverse=True)
    if not account and mine:
        t = mine[0]
        account = {"ids": sorted(_customer_ids(t)), "name": t.get("customerName") or None, "email": None, "city": None,
                   "member_since": None}
    try:
        refunds = SOURCES["refunds"]() if any(str(t.get("status") or "").lower() in CANCELLED for t in mine[:MAX_BOOKINGS]) else {}
    except Exception:  # noqa: BLE001
        refunds = {}
    views = []
    for i, t in enumerate(mine[:MAX_BOOKINGS]):
        if refresh_open and i < 3 and str(t.get("status") or "").lower() not in DONE | CANCELLED:
            t = _fresh(t)
        views.append(booking_view(t, refunds.get(task_id(t))))
    out.update({
        "found": bool(account or mine),
        "customer": {k: v for k, v in (account or {}).items() if v and k != "ids"} or None,
        "customer_ids": (account or {}).get("ids", []),
        "bookings": views,
        "total_bookings": len(mine),
    })
    return out


def owned_booking(snap: dict[str, Any], booking_id: str | None) -> dict | None:
    """The booking when it belongs to this customer (by id or reference), else None. Checked before every action."""
    if not booking_id:
        return None
    b = str(booking_id).strip().lstrip("#")
    for v in snap.get("bookings") or []:
        if b in (v.get("booking_id"), v.get("booking_ref")):
            return v
    return None


def can_cancel(view: dict) -> tuple[bool, str]:
    s = (view.get("status") or "").lower()
    if s in CANCELLED:
        return False, "already cancelled"
    if s in DONE:
        return False, "already completed"
    return True, ""
