from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..integrations.mapping import is_clean_location, is_clean_service_name
from ..models import CallAttempt, Helper, Ticket, utcnow
from ..services.sync import sync_helpers
from .serializers import call_out, helper_out, iso, ticket_out

router = APIRouter(prefix="/api/helpers", tags=["helpers"])


@router.get("")
def list_helpers(
    q: str | None = None,
    service: str | None = None,
    location: str | None = None,
    status: str | None = None,
    is_verified: bool | None = None,
    can_accept_tasks: bool | None = None,
    db: Session = Depends(get_db),
):
    """Retrieve helper directory with optional filters for service, location, status, and verification."""
    # If database is empty, auto-sync helpers
    if db.query(Helper).count() == 0:
        sync_helpers(db)

    # Pre-fetch counts for active assigned tickets and calls
    assigned_counts = dict(
        db.query(Ticket.assignee_id, func.count())
        .filter(Ticket.assignee_id.isnot(None), Ticket.dispatch_status == "assigned")
        .group_by(Ticket.assignee_id)
        .all()
    )
    call_counts = dict(
        db.query(CallAttempt.helper_id, func.count())
        .filter(CallAttempt.helper_id.isnot(None))
        .group_by(CallAttempt.helper_id)
        .all()
    )

    query = db.query(Helper)

    if status == "assigned":
        assigned_ids = list(assigned_counts.keys())
        query = query.filter(Helper.id.in_(assigned_ids))
    elif status:
        query = query.filter(Helper.status == status)

    if is_verified is not None:
        query = query.filter(Helper.is_verified == is_verified)

    if can_accept_tasks is not None:
        query = query.filter(Helper.can_accept_tasks == can_accept_tasks)

    helpers_list = query.order_by(Helper.name).all()

    # In-memory filtering for flexible JSON/text matching
    results = []
    q_lower = q.strip().lower() if q else None
    service_lower = service.strip().lower() if service else None
    loc_lower = location.strip().lower() if location else None

    for h in helpers_list:
        skills = [s.lower() for s in (h.skills or [])]
        categories = [c.lower() for c in (h.categories or [])]
        areas = [a.lower() for a in (h.work_areas or [])]
        city = (h.city or "").lower()

        # Service / Category filter
        if service_lower:
            match_service = any(service_lower in c or c in service_lower for c in categories) or any(
                service_lower in s or s in service_lower for s in skills
            )
            if not match_service:
                continue

        # Location filter (city or work areas)
        if loc_lower:
            match_loc = (loc_lower in city) or any(loc_lower in a or a in loc_lower for a in areas)
            if not match_loc:
                continue

        # Free-text search filter
        if q_lower:
            searchable = [
                h.name or "",
                h.phone or "",
                h.alt_phone or "",
                h.email or "",
                h.id or "",
                h.profile_id or "",
                h.city or "",
                h.address or "",
                *(h.skills or []),
                *(h.categories or []),
                *(h.work_areas or []),
            ]
            if not any(q_lower in str(v).lower() for v in searchable):
                continue

        active_t = assigned_counts.get(h.id, 0)
        total_c = call_counts.get(h.id, 0)
        results.append(helper_out(h, active_tickets=active_t, total_calls=total_c))

    return results


@router.get("/filters")
def helper_filter_options(db: Session = Depends(get_db)):
    """Returns available distinct services, categories, and locations for filter dropdowns."""
    helpers = db.query(Helper).all()
    if not helpers:
        sync_helpers(db)
        helpers = db.query(Helper).all()

    cities = set()
    areas = set()
    services = set()

    for h in helpers:
        if h.city and is_clean_location(h.city):
            cities.add(h.city.strip())
        for a in h.work_areas or []:
            if a and is_clean_location(a):
                areas.add(a.strip())
        for c in h.categories or []:
            if c and is_clean_service_name(c):
                services.add(c.strip())
        for s in h.skills or []:
            if s and is_clean_service_name(s):
                services.add(s.strip())

    assigned_helpers_count = (
        db.query(Ticket.assignee_id)
        .filter(Ticket.assignee_id.isnot(None), Ticket.dispatch_status == "assigned")
        .distinct()
        .count()
    )
    assigned_tickets_count = (
        db.query(Ticket.id)
        .filter(Ticket.dispatch_status == "assigned")
        .count()
    )

    return {
        "cities": sorted(cities),
        "areas": sorted(areas),
        "locations": sorted(cities | areas),
        "services": sorted(services),
        "total_helpers": len(helpers),
        "assigned_helpers_count": assigned_helpers_count,
        "assigned_tickets_count": assigned_tickets_count,
    }


@router.post("/sync")
def sync_helpers_now(db: Session = Depends(get_db)):
    """Explicitly triggers sync of all helpers from ExtraHand."""
    stats = sync_helpers(db)
    total = db.query(Helper).count()
    return {"ok": True, "stats": stats, "total": total}


@router.get("/{helper_id}")
def get_helper_detail(helper_id: str, db: Session = Depends(get_db)):
    """Returns full helper profile, recent assigned tickets, and call history."""
    h = db.get(Helper, helper_id)
    if not h:
        raise HTTPException(404, f"Helper {helper_id} not found")

    tickets = db.query(Ticket).filter(Ticket.assignee_id == h.id).order_by(Ticket.updated_at.desc()).limit(10).all()
    calls = db.query(CallAttempt).filter(CallAttempt.helper_id == h.id).order_by(CallAttempt.id.desc()).limit(20).all()

    out = helper_out(h, active_tickets=len(tickets), total_calls=len(calls))
    out["raw"] = h.raw
    out["tickets"] = [ticket_out(t) for t in tickets]
    out["calls"] = [call_out(c) for c in calls]
    return out


class HelperUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    alt_phone: str | None = None
    email: str | None = None
    city: str | None = None
    address: str | None = None
    skills: list[str] | None = None
    categories: list[str] | None = None
    work_areas: list[str] | None = None
    status: str | None = None
    is_active: bool | None = None
    is_verified: bool | None = None
    can_accept_tasks: bool | None = None
    work_shift_type: str | None = None


@router.patch("/{helper_id}")
def update_helper(helper_id: str, body: HelperUpdate, db: Session = Depends(get_db)):
    h = db.get(Helper, helper_id)
    if not h:
        raise HTTPException(404, f"Helper {helper_id} not found")

    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(h, k, v)
    h.updated_at = utcnow()
    db.commit()
    db.refresh(h)
    return helper_out(h)
