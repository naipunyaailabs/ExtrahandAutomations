"""Live ExtraHand data for User Engagement (Main Admin API, see Doc/data.docx and Doc/Access and clarification.docx).

Endpoints used (read-only; the account needs user.list, task.view and support.ticket.list):
  GET /users?role=customer        customers (pagination.total = registered customers; newest first for "new today")
  GET /tasks                      every Work, all pages (status, customer, category, schedule, booking source)
  GET /support/tickets            customer-care tickets (optional: reported as unavailable when the API errors)

Real customers only: Works posted by the ExtraHand team (isTeamPosted / postedBy=team) and test accounts (flagged
isPaymentTester, or named like "Test User") are left out of every number.

Polling: the Work list is read at most once every 5 minutes (the approved polling interval) and cached;
pagination, timeouts and errors are handled, and each Work is counted once (deduplicated by its id).
"Today" and "this month" are Indian Standard Time (UTC+05:30).

The app's single authenticated ExtraHand client is reused (one login shared with dispatch), but never its mock
fallback: if ExtraHand cannot be reached, callers get an error and say so instead of showing mock data.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.config import get_settings
from app.integrations.extrahand import LiveExtraHandClient, get_source
from app.integrations.mapping import extract_list

logger = logging.getLogger("user_engagement.extrahand")

IST = timezone(timedelta(hours=5, minutes=30))
POLL_SECONDS = 5 * 60          # approved Work-list polling interval
PAGE_SIZE = 100
MAX_TASK_PAGES = 100           # safety stop: 10,000 Works

_lock = threading.Lock()
_cache: Dict[str, Any] = {}


class EngagementDataUnavailable(RuntimeError):
    """ExtraHand live data could not be read (not configured, offline or refused)."""


def live_enabled() -> bool:
    return get_settings().extrahand_mode == "live"


def _client() -> LiveExtraHandClient:
    """The app's authenticated live client (shared login), without the mock fallback."""
    src = get_source()
    live = getattr(src, "live", src)
    if not isinstance(live, LiveExtraHandClient):
        raise EngagementDataUnavailable("ExtraHand is in mock mode (EXTRAHAND_MODE is not 'live').")
    return live


def parse_time(value: Any) -> Optional[datetime]:
    """ExtraHand ISO timestamp -> aware datetime (None when missing or unreadable)."""
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def now_ist() -> datetime:
    return datetime.now(IST)


def _get(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    client = _client()
    for attempt in (1, 2):
        try:
            data = client._main("GET", path, params=params)
            return data if isinstance(data, dict) else {"data": data}
        except EngagementDataUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 - network, auth or API errors
            # ExtraHand sometimes rejects a login made at the same moment as another one ("version ... refreshTokens");
            # wait a moment and try once more
            if attempt == 1 and ("Login failed" in str(exc) or "version" in str(exc)):
                time.sleep(1.5)
                continue
            raise EngagementDataUnavailable(f"GET {path} failed: {exc}") from exc
    raise EngagementDataUnavailable(f"GET {path} failed")


_refreshing: set = set()


def _refresh_in_background(key: str, loader) -> None:
    """Reload one cached value on a worker thread (at most one reload per key at a time)."""
    with _lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def _run() -> None:
        try:
            value = loader()
            with _lock:
                _cache[key] = (time.time(), value)
        except Exception as exc:  # noqa: BLE001 - keep serving the last good data
            logger.warning("[User Engagement] Background reload of %s failed: %s", key, exc)
        finally:
            with _lock:
                _refreshing.discard(key)

    threading.Thread(target=_run, daemon=True, name=f"extrahand-reload-{key}").start()


def _cached(key: str, loader, max_age: float = POLL_SECONDS):
    """Cached ExtraHand data. Reading all Works takes several seconds, so once something is cached a request
    never waits for ExtraHand: stale data is returned at once and reloaded in the background."""
    with _lock:
        hit = _cache.get(key)
    if hit:
        if time.time() - hit[0] >= max_age:
            _refresh_in_background(key, loader)
        return hit[1], hit[0]
    value = loader()
    stamp = time.time()
    with _lock:
        _cache[key] = (stamp, value)
    return value, stamp


# ---------------------------------------------------------------------------- Works
def _load_all_tasks() -> List[Dict[str, Any]]:
    tasks: Dict[str, Dict[str, Any]] = {}
    page = 1
    while page <= MAX_TASK_PAGES:
        # ExtraHand's /tasks lists only team-posted Works unless postedBy=all is given (API change, Nov 2026);
        # read every Work so customer Works are counted and team-posted ones can still be reported as left out
        data = _get("/tasks", {"page": page, "limit": PAGE_SIZE, "postedBy": "all"})
        items = extract_list(data)
        for t in items:
            tid = str(t.get("_id") or t.get("taskId") or "")
            if tid:
                tasks[tid] = t  # deduplicated by Work id
        pages = (data.get("pagination") or {}).get("pages") or 1
        if page >= pages or not items:
            break
        page += 1
    logger.info("[User Engagement] Read %d Works from ExtraHand", len(tasks))
    return list(tasks.values())


def all_tasks() -> tuple[List[Dict[str, Any]], float]:
    """Every Work (cached for the approved 5-minute polling interval) and when it was fetched."""
    return _cached("tasks", _load_all_tasks)


# ---------------------------------------------------------------------------- test accounts
def is_test_name(name: Any) -> bool:
    """Test accounts that are not flagged as testers: a name containing test / dummy / demo (shared app rule)."""
    from app.services.real_data import is_test_name as _shared

    return _shared(name)


def _user_ids(u: Dict[str, Any]) -> List[str]:
    return [str(u[k]) for k in ("_id", "uid", "userId", "profileId") if u.get(k)]


def _load_test_accounts() -> Dict[str, Any]:
    """Customer accounts that are not real customers: flagged isPaymentTester, or named like a test account."""
    ids, names = set(), set()
    for params in ({"isPaymentTester": "true"}, {"search": "test"}):
        page = 1
        while page <= 10:
            data = _get("/users", {"role": "customer", "page": page, "limit": 50, **params})
            for u in extract_list(data):
                if u.get("isPaymentTester") or is_test_name(u.get("name")):
                    ids.update(_user_ids(u))
                    names.add(str(u.get("name") or ""))
            if page >= ((data.get("pagination") or {}).get("pages") or 1):
                break
            page += 1
    accounts = len({n for n in names}) if names else 0
    return {"ids": ids, "names": sorted(n for n in names if n), "count": accounts}


def test_accounts() -> Dict[str, Any]:
    value, _ = _cached("test_accounts", _load_test_accounts)
    return value


def is_real_customer_work(task: Dict[str, Any], tests: Dict[str, Any]) -> bool:
    """A Work posted by a real customer: not posted by the ExtraHand team and not by a test account."""
    if task.get("isTeamPosted") is True or str(task.get("postedBy") or "").lower() == "team":
        return False
    customer = str(task.get("CustomerId") or task.get("customerId") or task.get("requesterId") or "")
    if customer and customer in tests["ids"]:
        return False
    return not is_test_name(task.get("customerName"))


# ---------------------------------------------------------------------------- customers
def _load_customers() -> Dict[str, Any]:
    tests = test_accounts()
    first = _get("/users", {"role": "customer", "page": 1, "limit": 100, "sortBy": "createdAt", "sortOrder": "desc"})
    # real customers only: the test accounts are not counted
    total = max(0, int((first.get("pagination") or {}).get("total") or 0) - tests["count"])
    today = now_ist().date()
    month_start = today.replace(day=1)
    new_today = new_month = 0
    page, items = 1, extract_list(first)
    # newest first: read pages until the customers are older than this month
    while items and page <= 40:
        stop = False
        for u in items:
            if u.get("isPaymentTester") or is_test_name(u.get("name")) or set(_user_ids(u)) & tests["ids"]:
                continue  # test account
            created = parse_time(u.get("createdAt"))
            if not created:
                continue
            day = created.astimezone(IST).date()
            if day < month_start:
                stop = True
                break
            new_month += 1
            if day == today:
                new_today += 1
        pages = (first.get("pagination") or {}).get("pages") or 1
        if stop or page >= pages:
            break
        page += 1
        items = extract_list(_get("/users", {"role": "customer", "page": page, "limit": 100,
                                             "sortBy": "createdAt", "sortOrder": "desc"}))
    return {"total": total, "new_today": new_today, "new_month": new_month}


def customers_summary() -> Dict[str, Any]:
    value, _ = _cached("customers", _load_customers)
    return value


# ---------------------------------------------------------------------------- helpers
def _load_helpers() -> Dict[str, Any]:
    """Every helper (ExtraHand role "partner"), test accounts left out: how many, who joined this month and today,
    and how many are verified. Read whole (about 20 pages) because ExtraHand ignores filters such as isVerified."""
    today = now_ist().date()
    month_start = today.replace(day=1)
    total = new_today = new_month = verified = aadhaar = pan = bank = kyc = with_jobs = blocked = 0
    page = 1
    while page <= 60:
        data = _get("/users", {"role": "partner", "page": page, "limit": 100, "sortBy": "createdAt", "sortOrder": "desc"})
        items = extract_list(data)
        for u in items:
            if u.get("isPaymentTester") or is_test_name(u.get("name")):
                continue  # test account
            total += 1
            created = parse_time(u.get("createdAt"))
            day = created.astimezone(IST).date() if created else None
            if day and day >= month_start:
                new_month += 1
                new_today += 1 if day == today else 0
            verified += 1 if u.get("isVerified") else 0
            aadhaar += 1 if u.get("isAadhaarVerified") else 0
            pan += 1 if u.get("isPANVerified") else 0
            bank += 1 if u.get("isBankVerified") else 0
            kyc += 1 if (u.get("isAadhaarVerified") and u.get("isPANVerified") and u.get("isBankVerified")) else 0
            with_jobs += 1 if int(u.get("completedTasks") or 0) > 0 else 0
            blocked += 1 if (u.get("bannedAt") or u.get("suspendedAt")
                             or str(u.get("status") or "active").lower() not in ("active", "")) else 0
        if page >= ((data.get("pagination") or {}).get("pages") or 1) or not items:
            break
        page += 1
    return {"total": total, "new_today": new_today, "new_month": new_month, "verified": verified,
            "aadhaar_verified": aadhaar, "pan_verified": pan, "bank_verified": bank, "kyc_complete": kyc,
            "with_completed_jobs": with_jobs, "blocked": blocked}


def helpers_summary() -> Dict[str, Any]:
    value, _ = _cached("helpers", _load_helpers)
    return value


# ---------------------------------------------------------------------------- support tickets
def _load_support() -> Dict[str, Any]:
    try:
        data = _get("/support/tickets", {"page": 1, "limit": 100})
    except EngagementDataUnavailable as exc:
        return {"available": False, "reason": str(exc)[:200]}
    items = extract_list(data)
    total = int((data.get("pagination") or {}).get("total") or len(items))
    by_status: Dict[str, int] = {}
    for t in items:
        s = str(t.get("status") or "unknown").lower()
        by_status[s] = by_status.get(s, 0) + 1
    open_count = sum(n for s, n in by_status.items() if s not in ("resolved", "closed", "cancelled"))
    return {"available": True, "total": total, "open": open_count, "by_status": by_status}


def support_summary() -> Dict[str, Any]:
    value, _ = _cached("support", _load_support)
    return value


def clear_cache() -> None:
    with _lock:
        _cache.clear()


# ---------------------------------------------------------------------------- background refresh
_poller_started = False


def _load_regions_lazy() -> Dict[str, Any]:
    from .regions import _load_regions  # regions.py imports this module

    return _load_regions()


def _load_cancellations_lazy() -> Dict[str, Any]:
    from .cancellations import _load_cancellations  # cancellations.py imports this module

    return _load_cancellations()


def _load_refund_records_lazy() -> List[Dict[str, Any]]:
    from .refunds import _load_records

    return _load_records()


def _load_refunds_lazy() -> Dict[str, Any]:
    from .refunds import _load_refunds

    return _load_refunds()


def start_poller() -> None:
    """Read ExtraHand when the backend starts and then every 5 minutes (the approved polling interval), so the
    dashboard always opens from fresh cached data. Does nothing unless EXTRAHAND_MODE=live."""
    global _poller_started
    if _poller_started or not live_enabled():
        return
    _poller_started = True

    def _loop() -> None:
        while True:
            try:
                for key, loader in (("test_accounts", _load_test_accounts), ("tasks", _load_all_tasks),
                                    ("customers", _load_customers), ("helpers", _load_helpers), ("regions", _load_regions_lazy),
                                    ("refund_records", _load_refund_records_lazy),
                                    ("cancellations", _load_cancellations_lazy), ("refunds", _load_refunds_lazy),
                                    ("support", _load_support)):
                    value = loader()
                    with _lock:
                        _cache[key] = (time.time(), value)
            except Exception as exc:  # noqa: BLE001 - keep polling; the dashboard reports the problem itself
                logger.warning("[User Engagement] Background refresh from ExtraHand failed: %s", exc)
            try:  # Welcomer history / dashboard: their signup lists take ~40 s to read, so they are read here too
                from whatsapp.welcomers import warm_registrations

                warm_registrations()
            except Exception as exc:  # noqa: BLE001
                logger.warning("[User Engagement] Welcomer signups refresh failed: %s", exc)
            time.sleep(POLL_SECONDS)

    threading.Thread(target=_loop, daemon=True, name="engagement-poller").start()
