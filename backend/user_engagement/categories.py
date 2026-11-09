"""Customer categories: real customers grouped by how many orders they placed in a month.

    Diamond   8 or more orders in the month
    Gold      5 - 7
    Platinum  1 - 4
    Silver    0      (registered customers who placed no order in the month)

An order counts in the month when it was booked or scheduled in that month (India time), the same rule the
dashboard uses. Only real customers: Works posted by the ExtraHand team and test accounts are left out.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .service import load_orders

# Highest first: (key, label, minimum orders, maximum orders or None)
TIERS = [
    ("diamond", "Diamond", 8, None),
    ("gold", "Gold", 5, 7),
    ("platinum", "Platinum", 1, 4),
    ("silver", "Silver", 0, 0),
]
SILVER_PAGE_SIZE = 50


def tier_for(orders: int) -> Optional[str]:
    for key, _label, low, high in TIERS:
        if orders >= low and (high is None or orders <= high):
            return key
    return None


def _month_bounds(month: Optional[str]) -> tuple[date, date]:
    from .extrahand_data import now_ist

    if month:
        year, mon = (int(x) for x in month.split("-"))
    else:
        today = now_ist().date()
        year, mon = today.year, today.month
    start = date(year, mon, 1)
    end = date(year + mon // 12, mon % 12 + 1, 1)
    return start, end


def get_customer_categories(db: Session, month: Optional[str] = None) -> Dict[str, Any]:
    """Real customers of the month in Diamond / Gold / Platinum / Silver, with their orders."""
    from .extrahand_data import now_ist

    start, end = _month_bounds(month)
    data = load_orders(db)

    def in_month(o: Dict[str, Any]) -> bool:
        days = [d for d in (o["created_day"], o["scheduled_day"]) if d]
        return any(start <= d < end for d in days)

    people: Dict[str, Dict[str, Any]] = {}
    lifetime: Dict[str, int] = {}
    for o in data["orders"]:
        key = o["customer_key"] or o["customer_phone"] or o["customer_name"]
        if not key:
            continue
        lifetime[key] = lifetime.get(key, 0) + 1
        if not in_month(o):
            continue
        c = people.setdefault(key, {
            "customer_key": key, "name": o["customer_name"], "phone": o["customer_phone"], "area": o["area"],
            "city": o["city"], "orders": 0, "completed": 0, "cancelled": 0, "pending": 0, "spent": 0.0,
            "services": {}, "last_order_at": None,
        })
        c["orders"] += 1
        c[{"success": "completed", "fail": "cancelled"}.get(o["state_type"], "pending")] += 1
        if o["state_type"] == "success":
            c["spent"] += o["budget"]
        c["services"][o["category"]] = c["services"].get(o["category"], 0) + 1
        when = o["created_at"] or o["scheduled_at"]
        if when and (c["last_order_at"] is None or when > c["last_order_at"]):
            c["last_order_at"] = when
        if not c["area"] and o["area"]:
            c["area"] = o["area"]

    customers: List[Dict[str, Any]] = []
    for key, c in people.items():
        services = sorted(c.pop("services").items(), key=lambda kv: -kv[1])
        customers.append({
            **c,
            "tier": tier_for(c["orders"]),
            "top_service": services[0][0] if services else "",
            "services": [s for s, _ in services],
            "lifetime_orders": lifetime.get(key, c["orders"]),
            "spent": round(c["spent"], 2),
        })
    customers.sort(key=lambda c: (-c["orders"], -c["completed"], c["name"].lower()))

    active = len(customers)
    # Silver = registered real customers with no order in the month (counted, listed page by page on request)
    registered = _registered_customers(db, active)
    silver = max(0, registered - active)
    tiers = []
    for key, label, low, high in TIERS:
        count = silver if key == "silver" else sum(1 for c in customers if c["tier"] == key)
        tiers.append({
            "key": key, "label": label, "min_orders": low, "max_orders": high,
            "range": "No orders" if high == 0 else (f"{low}+ orders" if high is None else f"{low} - {high} orders"),
            "count": count, "percent": round(count / registered * 100, 1) if registered else 0.0,
        })

    today = now_ist().date()
    months = []
    y, m = today.year, today.month
    for _ in range(6):  # this month and the five before it
        months.append({"value": f"{y}-{m:02d}", "label": date(y, m, 1).strftime("%B %Y")})
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)

    return {
        "month": start.strftime("%Y-%m"),
        "month_label": start.strftime("%B %Y"),
        "is_current_month": start.year == today.year and start.month == today.month,
        "months": months,
        "tiers": tiers,
        "customers": customers,
        "active_customers": active,
        "registered_customers": registered,
        "orders_in_month": sum(c["orders"] for c in customers),
        "source": data["source"],
        "fetched_at": data["fetched_at"],
        "source_note": data.get("reason", ""),
    }


def _registered_customers(db: Session, active: int) -> int:
    """Registered real customers (ExtraHand, test accounts left out); the local copy's count as a fallback."""
    from .extrahand_data import EngagementDataUnavailable, customers_summary, live_enabled

    if live_enabled():
        try:
            return int(customers_summary()["total"])
        except EngagementDataUnavailable:
            pass
    from app.models import Customer

    return max(active, db.query(Customer).count())


def get_silver_customers(db: Session, month: Optional[str] = None, page: int = 1) -> Dict[str, Any]:
    """One page of Silver customers: registered real customers with no order in the month (newest first).
    Read page by page from ExtraHand /users?role=customer; customers who ordered in the month and test accounts
    are left out of the page."""
    from .extrahand_data import (EngagementDataUnavailable, IST, _get, _user_ids, is_test_name, live_enabled,
                                 parse_time, test_accounts)
    from app.integrations.mapping import extract_list

    start, end = _month_bounds(month)
    if not live_enabled():
        return {"available": False, "reason": "The Silver list needs live ExtraHand data.", "customers": [],
                "page": page, "pages": 0}
    data = load_orders(db)
    ordered_in_month, lifetime, last_order = set(), {}, {}
    for o in data["orders"]:
        key = o["customer_key"]
        if not key:
            continue
        lifetime[key] = lifetime.get(key, 0) + 1
        when = o["created_at"] or o["scheduled_at"]
        if when and (key not in last_order or when > last_order[key]):
            last_order[key] = when
        days = [d for d in (o["created_day"], o["scheduled_day"]) if d]
        if any(start <= d < end for d in days):
            ordered_in_month.add(key)
    try:
        tests = test_accounts()
        res = _get("/users", {"role": "customer", "page": page, "limit": SILVER_PAGE_SIZE,
                              "sortBy": "createdAt", "sortOrder": "desc"})
    except EngagementDataUnavailable as exc:
        return {"available": False, "reason": str(exc)[:200], "customers": [], "page": page, "pages": 0}
    rows = []
    for u in extract_list(res):
        ids = set(_user_ids(u))
        if u.get("isPaymentTester") or is_test_name(u.get("name")) or ids & tests["ids"] or ids & ordered_in_month:
            continue
        created = parse_time(u.get("createdAt"))
        loc = u.get("location") if isinstance(u.get("location"), dict) else {}
        addr = loc.get("addressDetails") if isinstance(loc.get("addressDetails"), dict) else {}
        key = next((i for i in ids if i in lifetime), "")
        rows.append({
            "customer_key": str(u.get("_id") or u.get("uid") or ""),
            "name": u.get("name") or "Unnamed customer",
            "phone": u.get("phone") or "",
            "area": addr.get("area") or "",
            "city": addr.get("city") or "",
            "joined_at": created.astimezone(IST).isoformat() if created else None,
            "lifetime_orders": lifetime.get(key, 0),
            "last_order_at": last_order.get(key),
            "status": u.get("status") or "",
        })
    pagination = res.get("pagination") or {}
    return {"available": True, "month": start.strftime("%Y-%m"), "customers": rows, "page": page,
            "pages": int(pagination.get("pages") or 1), "registered": int(pagination.get("total") or 0)}
