"""Real data only: tells real ExtraHand customers' tasks and real helpers apart from test and mock data.

Used everywhere data enters or is shown (sync, dispatch, WhatsApp agent, dashboards, lists):

Task (Work) is real when
  - it has a real ExtraHand id (24 hex characters; mock rows look like task_1008),
  - it was posted by a customer, not by the ExtraHand team (isTeamPosted / postedBy=team: test bookings),
  - the customer is not a test account (named like "Test User", or flagged isPaymentTester).
User (helper or customer) is real when
  - it has a real ExtraHand id (a long uid; mock rows look like helper_002 / cust_003),
  - it is not flagged isPaymentTester,
  - its name does not look like a test account (test, dummy, demo).
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

TEST_NAME = re.compile(r"test|dummy|demo", re.I)
REAL_TASK_ID = re.compile(r"[0-9a-f]{24}")
REAL_USER_ID = re.compile(r"[A-Za-z0-9]{20,}")


def is_test_name(name: Any) -> bool:
    return bool(TEST_NAME.search(str(name or "")))


def is_real_task_id(task_id: Any) -> bool:
    return bool(REAL_TASK_ID.fullmatch(str(task_id or "")))


def is_real_task(raw: dict, tester_ids: Iterable[str] = ()) -> bool:
    """A Work booked by a real customer (raw = the ExtraHand task record)."""
    if not isinstance(raw, dict):
        return False
    task_id = raw.get("_id") or raw.get("taskId") or raw.get("id")
    if not is_real_task_id(task_id):
        return False
    if raw.get("isTeamPosted") is True or str(raw.get("postedBy") or "").lower() == "team":
        return False
    customer = raw.get("customer") if isinstance(raw.get("customer"), dict) else {}
    name = raw.get("customerName") or customer.get("name")
    if is_test_name(name):
        return False
    customer_id = str(raw.get("CustomerId") or raw.get("customerId") or raw.get("requesterId") or "")
    return not (customer_id and customer_id in set(tester_ids))


def is_real_user(raw: dict, user_id: Optional[str] = None) -> bool:
    """A real helper or customer account (raw = the ExtraHand user record)."""
    if not isinstance(raw, dict):
        raw = {}
    uid = user_id or raw.get("uid") or raw.get("id") or raw.get("_id")
    if not REAL_USER_ID.fullmatch(str(uid or "")):
        return False
    if raw.get("isPaymentTester"):
        return False
    return not is_test_name(raw.get("name"))


def is_real_helper(helper: Any) -> bool:
    """A real helper row (app.models.Helper)."""
    raw = helper.raw if isinstance(getattr(helper, "raw", None), dict) else {}
    return is_real_user({**raw, "name": helper.name or raw.get("name")}, helper.id)
