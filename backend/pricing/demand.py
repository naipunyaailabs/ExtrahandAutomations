"""Local demand: how many ExtraHand tasks (synced into the tickets table) each area got for each service."""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.integrations.mapping import parse_datetime, pick_str
from app.models import Ticket, utcnow

GENERIC_WORDS = {"house", "home", "service", "services", "general", "work"}


def default_keywords(name: str) -> list[str]:
    """'House Cleaning' -> ['house cleaning', 'cleaning']; the team can edit them."""
    name = " ".join(name.lower().split())
    words = [w for w in name.split() if len(w) >= 5 and w not in GENERIC_WORDS]
    return list(dict.fromkeys([name, *words]))


def _created(t: Ticket) -> datetime:
    return parse_datetime(pick_str(t.raw or {}, "createdAt", "created_at")) or t.created_at


def task_counts(areas: list[dict], services: list[dict], window_days: int) -> dict[tuple[int, int], int]:
    """{(area_id, service_id): task count in the last `window_days`}."""
    since = utcnow() - timedelta(days=window_days)
    with SessionLocal() as db:
        tickets = db.query(Ticket).all()
    rows = []
    for t in tickets:
        if _created(t) < since:
            continue
        raw = t.raw or {}
        place = " ".join(filter(None, [
            t.city, t.address, pick_str(raw, "location.taskArea", "location.city", "location.address", "location.pinCode"),
        ])).lower()
        what = " ".join(filter(None, [
            t.category, t.title, pick_str(raw, "categorySlug", "categoryLabel", "category"),
        ])).lower().replace("-", " ")
        rows.append((place, what))

    counts = {}
    for a in areas:
        city, area, pin = a["city"].lower(), (a["area"] or "").lower(), (a.get("pincode") or "").lower()
        in_area = [w for p, w in rows if city in p and (not area or area in p or (pin and pin in p))]
        for s in services:
            keys = [k.lower() for k in (s["keywords"] or default_keywords(s["name"]))]
            counts[(a["id"], s["id"])] = sum(1 for w in in_area if any(k in w for k in keys))
    return counts
