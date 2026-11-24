"""Regions: customers and helpers grouped by state and city, from the location each user saved in ExtraHand
(``location.addressDetails`` state / city / country).

Nothing is hard-coded per region: every state and city that appears in the data becomes a region, so a user from
a new state or city creates its card on the next refresh. Only the list of India's 36 states and union territories
is fixed, so typed-in values can be checked:
  - a state is matched to that list (spelling, capitals and short forms such as "TS" are tidied);
  - when the state field holds something else (a city, an area), the state is taken from the city when that city
    is seen under a real state elsewhere in the data; otherwise the user counts under "State unclear";
  - a location outside India counts under "Outside India";
  - a "city" that is only numbers or an address fragment ("2-1-1", "116/P") counts as "City not set".
Test accounts are left out, as on the dashboard. All users are read every 5 minutes in the background.
"""

from __future__ import annotations

import re
import time
from datetime import timedelta
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from .extrahand_data import (
    IST, POLL_SECONDS, _cache, _lock, _get, _refresh_in_background, extract_list, is_test_name, now_ist, parse_time,
)

NO_LOCATION = "Location not set"
UNCLEAR = "State unclear"
ABROAD = "Outside India"
NO_CITY = "City not set"
ACTIVE_DAYS = 30  # active = booked a Work (customer) or was given one (helper) in the last 30 days
# App opens are not counted: ExtraHand's lastActive is set once at signup and never updated (checked Nov 2026), and
# isActive is true for every account, so the Works are the only real sign of use.

STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
]
_KEY = lambda s: re.sub(r"[^a-z]", "", s.lower())  # noqa: E731
_STATE_BY_KEY = {_KEY(s): s for s in STATES}
_STATE_BY_KEY.update({
    "ts": "Telangana", "tg": "Telangana", "telengana": "Telangana", "telagana": "Telangana", "telanagana": "Telangana",
    "ap": "Andhra Pradesh", "andhra": "Andhra Pradesh", "tn": "Tamil Nadu", "ka": "Karnataka", "mh": "Maharashtra",
    "dl": "Delhi", "newdelhi": "Delhi", "nctofdelhi": "Delhi", "nationalcapitalterritoryofdelhi": "Delhi",
    "up": "Uttar Pradesh", "mp": "Madhya Pradesh", "wb": "West Bengal", "kl": "Kerala", "gj": "Gujarat",
    "rj": "Rajasthan", "pb": "Punjab", "hr": "Haryana", "orissa": "Odisha", "uttaranchal": "Uttarakhand",
    "pondicherry": "Puducherry", "jk": "Jammu and Kashmir", "jammukashmir": "Jammu and Kashmir",
})
_CITY_ALIASES = {"hyd": "Hyderabad", "hyderbad": "Hyderabad", "bangalore": "Bengaluru", "bengaluru": "Bengaluru",
                 "bombay": "Mumbai", "madras": "Chennai", "gurgaon": "Gurugram", "calcutta": "Kolkata"}
_INDIA = {"", "india", "in", "bharat"}


def _tidy(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" ,.-")


def _state(value: Any) -> Optional[str]:
    """The real state for a typed-in value, or None."""
    return _STATE_BY_KEY.get(_KEY(_tidy(value))) if _tidy(value) else None


def _city(value: Any) -> str:
    text = _tidy(value)
    letters = sum(c.isalpha() for c in text)
    if not text or letters < 3 or text[0].isdigit() or letters < len(text.replace(" ", "")) * 0.6:
        return NO_CITY  # empty, a house number or an address fragment
    return _CITY_ALIASES.get(text.lower()) or text.title()


def _raw_place(user: Dict[str, Any]) -> Optional[Tuple[str, str, str]]:
    """(state as typed, city as typed, country) from the user's saved location, or None when there is none."""
    for key in ("location", "homeLocation"):
        loc = user.get(key) if isinstance(user.get(key), dict) else {}
        d = loc.get("addressDetails") if isinstance(loc.get("addressDetails"), dict) else {}
        if _tidy(d.get("state")) or _tidy(d.get("city")):
            return _tidy(d.get("state")), _tidy(d.get("city")), _tidy(d.get("country")).lower()
    return None


def _read_role(role: str) -> List[Dict[str, Any]]:
    """Every user of a role, test accounts left out (pages read four at a time)."""
    first = _get("/users", {"role": role, "page": 1, "limit": 100})
    pages = min(int((first.get("pagination") or {}).get("pages") or 1), 100)
    with ThreadPoolExecutor(max_workers=4) as pool:
        rest = list(pool.map(lambda p: extract_list(_get("/users", {"role": role, "page": p, "limit": 100})), range(2, pages + 1)))
    users = [u for chunk in [extract_list(first), *rest] for u in chunk]
    return [u for u in users if not (u.get("isPaymentTester") or is_test_name(u.get("name")))]


def _active_ids() -> Optional[Tuple[set, set]]:
    """(customer ids, helper ids) with a Work in the last ACTIVE_DAYS days (by when it was posted or scheduled).
    ExtraHand's isActive / updatedAt say nothing about use (every account is "active", bulk updates move updatedAt),
    so activity is read from the Works. None when the Works cannot be read."""
    from .extrahand_data import all_tasks

    try:
        tasks = all_tasks()[0]
    except Exception:  # noqa: BLE001 - ExtraHand offline: the counts are shown without "active"
        return None
    since = now_ist().astimezone(IST) - timedelta(days=ACTIVE_DAYS)
    customers, helpers = set(), set()
    for t in tasks:
        when = [parse_time(t.get(k)) for k in ("createdAt", "scheduledDate")]
        if not any(w and w >= since for w in when):
            continue
        customers.update(str(t[k]) for k in ("CustomerId", "customerId", "requesterId") if t.get(k))
        helper_ids = {str(t[k]) for k in ("assigneeId", "assigneeUid", "partnerId", "partnerUid") if t.get(k)}
        if isinstance(t.get("assignedTo"), dict) and t["assignedTo"].get("userId"):
            helper_ids.add(str(t["assignedTo"]["userId"]))
        helpers.update(helper_ids)
    return customers, helpers


def _load_regions() -> Dict[str, Any]:
    month_start = now_ist().date().replace(day=1)
    active = _active_ids()
    people = [(who, u, _raw_place(u)) for role, who in (("customer", "customers"), ("partner", "helpers"))
              for u in _read_role(role)]

    # learn which real state each city belongs to, from users whose state is valid (used to fix bad state fields)
    votes: Dict[str, Counter] = defaultdict(Counter)
    for _, _, raw in people:
        if raw and raw[2] in _INDIA and _state(raw[0]):
            votes[_city(raw[1])][_state(raw[0])] += 1
    city_state = {c: v.most_common(1)[0][0] for c, v in votes.items() if c != NO_CITY}

    cell = lambda: {"customers": 0, "helpers": 0, "new_customers": 0, "new_helpers": 0,  # noqa: E731
                    "active_customers": 0, "active_helpers": 0}
    states: Dict[str, Dict[str, Any]] = defaultdict(lambda: {**cell(), "cities": defaultdict(cell)})
    for who, u, raw in people:
        if not raw:
            state, city = NO_LOCATION, NO_CITY
        elif raw[2] not in _INDIA:
            state, city = ABROAD, _tidy(raw[2]).title() or NO_CITY
        else:
            city = _city(raw[1])
            if not _state(raw[0]) and _state(raw[1]):  # the state was typed in the city field
                state, city = _state(raw[1]), (_city(raw[0]) if _city(raw[0]) in city_state else NO_CITY)
            else:
                state = _state(raw[0]) or city_state.get(city) or city_state.get(_city(raw[0])) or UNCLEAR
            if city == NO_CITY and not _state(raw[0]) and _city(raw[0]) in city_state:
                city = _city(raw[0])  # the city was typed in the state field
        created = parse_time(u.get("createdAt"))
        new = bool(created and created.astimezone(IST).date() >= month_start)
        ids = {str(u[k]) for k in ("_id", "uid", "userId", "profileId") if u.get(k)}
        is_active = bool(active and ids & (active[0] if who == "customers" else active[1]))
        for row in (states[state], states[state]["cities"][city]):
            row[who] += 1
            row[f"new_{who}"] += 1 if new else 0
            row[f"active_{who}"] += 1 if is_active else 0

    def ordered(rows: Dict[str, Dict[str, int]], last: Tuple[str, ...]) -> List[Dict[str, Any]]:
        out = [{"name": k, **v} for k, v in rows.items()]
        # biggest first; the catch-all groups last, in a fixed order
        return sorted(out, key=lambda r: (last.index(r["name"]) if r["name"] in last else -1,
                                          -(r["customers"] + r["helpers"]), r["name"]))

    state_list = []
    for s in ordered({k: {kk: vv for kk, vv in v.items() if kk != "cities"} for k, v in states.items()},
                     (UNCLEAR, ABROAD, NO_LOCATION)):
        cities = ordered(states[s["name"]]["cities"], (NO_CITY,))
        state_list.append({**s, "kind": "state" if s["name"] in STATES else "other",
                           "city_count": sum(1 for c in cities if c["name"] != NO_CITY), "cities": cities})
    real = [s for s in state_list if s["kind"] == "state"]
    return {
        "fetched_at": now_ist().isoformat(),
        "totals": {
            "states": len(real),
            "cities": sum(s["city_count"] for s in real),
            "customers": sum(s["customers"] for s in state_list),
            "helpers": sum(s["helpers"] for s in state_list),
            "customers_placed": sum(s["customers"] for s in real),
            "helpers_placed": sum(s["helpers"] for s in real),
            "active_customers": sum(s["active_customers"] for s in state_list),
            "active_helpers": sum(s["active_helpers"] for s in state_list),
        },
        "active_days": ACTIVE_DAYS,
        "active_known": active is not None,
        "states": state_list,
    }


def regions_summary() -> Optional[Dict[str, Any]]:
    """The cached regions, refreshed in the background when older than 5 minutes. None while the very first read
    (about half a minute: every customer and helper) is still running, so a request never waits for it."""
    with _lock:
        hit = _cache.get("regions")
    if hit is None:
        _refresh_in_background("regions", _load_regions)
        return None
    if time.time() - hit[0] >= POLL_SECONDS:
        _refresh_in_background("regions", _load_regions)
    return hit[1]
