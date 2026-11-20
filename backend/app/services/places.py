"""Where a place is, learned from ExtraHand's own data - no fixed list of cities or areas.

Every synced task and helper that has GPS coordinates teaches the index where its city, PIN code and the area
names in its address are. A task or helper without GPS is then placed by its PIN code, city, address areas or
(helpers) work areas, so a new city or area works as soon as ExtraHand has anyone there with GPS."""

from __future__ import annotations

import math
import re
import threading
import time
from collections import defaultdict
from typing import Iterable

from sqlalchemy.orm import Session

from ..models import Helper, Ticket

_CACHE_SECONDS = 600
_MAX_SPREAD_KM = 25.0  # a name whose sightings lie further apart is ambiguous ("road no 1") and is not used
_MIN_LEN = 3
_SKIP = {"india", "in", "telangana", "andhra pradesh", "karnataka", "tamil nadu", "maharashtra", "ap", "ts"}

_lock = threading.Lock()
_index: dict[str, tuple[float, float]] = {}
_built_at = 0.0


def norm(name: object) -> str:
    """'BN-Reddy-Nagar' -> 'bn reddy nagar'; 'Telangana 502103' -> 'telangana' (the PIN is used separately)."""
    s = re.sub(r"[-_/]+", " ", str(name or "").lower())
    s = re.sub(r"\b\d{6}\b", " ", s)
    s = re.sub(r"[^\w\s.]", " ", s)
    return re.sub(r"\s+", " ", s).strip(" .")


def _pin(value: object) -> str | None:
    m = re.search(r"\b(\d{6})\b", str(value or ""))
    return m.group(1) if m else None


def _valid(lat, lng) -> bool:
    return lat is not None and lng is not None and not (lat == 0 and lng == 0)


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _address_names(address: str | None) -> list[str]:
    """Area names in an address; house numbers, plot numbers and map plus-codes are not places."""
    out = []
    for part in str(address or "").split(","):
        if "+" in part:
            continue
        n = norm(part)
        if len(n) >= _MIN_LEN and n not in _SKIP and not re.search(r"\d", n):
            out.append(n)
    return out


def _task_pin(t: Ticket) -> str | None:
    loc = (t.raw or {}).get("location") if isinstance(t.raw, dict) else None
    return _pin((loc or {}).get("pinCode")) or _pin(t.address)


def _names_of(city, address, pin, extra: Iterable = ()) -> list[str]:
    names = []
    if pin:
        names.append(pin)
    if norm(city):
        names.append(norm(city))
    names += _address_names(address)
    names += [norm(x) for x in extra if len(norm(x)) >= _MIN_LEN]
    return names


def _build(db: Session) -> dict[str, tuple[float, float]]:
    seen: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for t in db.query(Ticket).filter(Ticket.lat.isnot(None), Ticket.lng.isnot(None)).all():
        if _valid(t.lat, t.lng):
            for n in set(_names_of(t.city, t.address, _task_pin(t))):
                seen[n].append((t.lat, t.lng))
    for h in db.query(Helper).filter(Helper.lat.isnot(None), Helper.lng.isnot(None)).all():
        if _valid(h.lat, h.lng):
            for n in set(_names_of(h.city, h.address, _pin(h.pincode) or _pin(h.address))):
                seen[n].append((h.lat, h.lng))
    index: dict[str, tuple[float, float]] = {}
    for name, pts in seen.items():
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        if name.isdigit() or max(km(c, p) for p in pts) <= _MAX_SPREAD_KM:
            index[name] = c
    return index


def place_index(db: Session) -> dict[str, tuple[float, float]]:
    """Name / PIN -> centre point, rebuilt from the database every few minutes."""
    global _index, _built_at
    with _lock:
        if not _index or time.monotonic() - _built_at > _CACHE_SECONDS:
            _index, _built_at = _build(db), time.monotonic()
        return _index


def reset_cache() -> None:
    global _index, _built_at
    with _lock:
        _index, _built_at = {}, 0.0


def _locate(index: dict, names: Iterable[str]) -> tuple[float, float] | None:
    for n in names:
        if n in index:
            return index[n]
    return None


def task_point(db: Session, t: Ticket) -> tuple[tuple[float, float] | None, bool]:
    """(where the task is, exact?) - its GPS, else learned from its PIN code / city / address areas."""
    if _valid(t.lat, t.lng):
        return (t.lat, t.lng), True
    return _locate(place_index(db), _names_of(t.city, t.address, _task_pin(t))), False


def helper_points(db: Session, lat, lng, city, address=None, pincode=None, work_areas=None) -> tuple[list, bool]:
    """(points where the helper is or works, exact?). Work areas count as places the helper covers."""
    index = place_index(db)
    pts: list[tuple[float, float]] = []
    exact = _valid(lat, lng)
    if exact:
        pts.append((lat, lng))
    else:
        p = _locate(index, _names_of(city, address, _pin(pincode) or _pin(address)))
        if p:
            pts.append(p)
    for area in work_areas or []:
        p = _locate(index, [norm(area)])
        if p:
            pts.append(p)
    return pts, exact


def same_city(a: str | None, b: str | None) -> bool:
    x, y = norm(a), norm(b)
    return bool(x and y and (x in y or y in x))


def location_match(db: Session, t: Ticket, radius_km: float, *, lat=None, lng=None, city=None, address=None,
                   pincode=None, work_areas=None) -> tuple[bool, float | None]:
    """Is the helper near the task? Returns (match, distance in km when known).

    Both have GPS -> the real distance decides. Otherwise the same city still matches (as before), and else
    both are placed with the learned index and the distance decides."""
    tp, t_exact = task_point(db, t)
    hps, h_exact = helper_points(db, lat, lng, city, address, pincode, work_areas)
    if t_exact and h_exact:  # nearest of the helper's home and work areas
        d = min(km(tp, p) for p in hps)
        return d <= radius_km, round(d, 2)
    if same_city(t.city, city):
        return True, None
    if tp and hps:
        d = min(km(tp, p) for p in hps)
        return d <= radius_km, round(d, 2)
    return False, None
