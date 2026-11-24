"""Turns raw ExtraHand JSON into flat records.

The API guide (Doc/data.docx) documents routes but not response bodies, so every
field is looked up through a list of likely paths. When live responses are
available, adjust the path lists here - nothing else in the app reads raw JSON.
"""

import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from ..config import get_settings

IST = timezone(timedelta(hours=5, minutes=30))


def ist_text(dt: "datetime | None", fmt: str = "%d %b, %I:%M %p", default: str = "Flexible") -> str:
    """A stored time (naive UTC) as India time text, e.g. "18 Nov, 12:00 AM" - what helpers and customers see."""
    if dt is None:
        return default
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).strftime(fmt)

TERMINAL_STATUSES = {"completed", "complete", "cancelled", "canceled", "closed", "done", "expired", "rejected"}
ASSIGNED_STATUSES = {"assigned", "accepted", "in_progress", "inprogress", "ongoing", "started"}


def dig(obj: Any, path: str) -> Any:
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


def pick(obj: Any, *paths: str) -> Any:
    for p in paths:
        v = dig(obj, p)
        if v not in (None, "", [], {}):
            return v
    return None


def pick_str(obj: Any, *paths: str) -> str | None:
    v = pick(obj, *paths)
    if isinstance(v, dict):
        v = pick(v, "name", "title", "label", "_id", "id")
    return str(v).strip() if v not in (None, "") else None


def to_float(v: Any) -> float | None:
    if isinstance(v, dict):
        v = pick(v, "amount", "value", "min", "max")
    try:
        return float(str(v).replace(",", "").strip()) if v not in (None, "") else None
    except ValueError:
        return None


def normalize_phone(raw: Any) -> str | None:
    if raw in (None, ""):
        return None
    if isinstance(raw, dict):
        cc = str(raw.get("countryCode") or "")
        raw = cc + str(pick(raw, "number", "phone", "value") or "")
    s = str(raw).strip()
    digits = re.sub(r"\D", "", s)
    if len(digits) < 7:
        return None
    if s.startswith("+"):
        return "+" + digits
    cc = re.sub(r"\D", "", get_settings().default_country_code)
    if len(digits) == 10:
        return f"+{cc}{digits}"
    if digits.startswith("0") and len(digits) == 11:
        return f"+{cc}{digits[1:]}"
    return "+" + digits


def parse_datetime(date_val: Any, time_val: Any = None) -> datetime | None:
    """Returns naive UTC. Values without a timezone are assumed to be IST."""
    if date_val in (None, ""):
        return None
    if isinstance(date_val, (int, float)):
        ts = date_val / 1000 if date_val > 1e11 else date_val
        return datetime.fromtimestamp(ts, UTC).replace(tzinfo=None)
    s = str(date_val).strip()
    dt: datetime | None = None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d %b %Y", "%d-%m-%Y %H:%M"):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    t = _parse_time(str(time_val)) if time_val else None
    if t:
        # A date-only value: midnight UTC (that calendar day) or midnight IST, which ExtraHand sends as
        # "2026-11-18T18:30:00Z" for 19 Nov. Either way the separate time field is India time on that day.
        if dt.tzinfo is None:
            if dt.hour == 0 and dt.minute == 0:
                dt = dt.replace(hour=t[0], minute=t[1])
        else:
            utc, ist = dt.astimezone(UTC), dt.astimezone(IST)
            day = None
            if (ist.hour, ist.minute) == (0, 0):
                day = ist.date()
            elif (utc.hour, utc.minute) == (0, 0):
                day = utc.date()
            if day is not None:
                dt = datetime(day.year, day.month, day.day, t[0], t[1], tzinfo=IST)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return dt.astimezone(UTC).replace(tzinfo=None)


def task_schedule_end(raw: dict | None) -> datetime | None:
    """When the task should finish: the slot end time, else start + estimated duration (naive UTC)."""
    if not isinstance(raw, dict):
        return None
    date_val = pick(raw, "scheduledAt", "scheduledDateTime", "scheduledDate", "schedule.date", "preferredDate", "date")
    start_val = pick(raw, "scheduledTimeStart", "scheduledTime", "schedule.time")
    end_val = pick(raw, "scheduledTimeEnd", "schedule.endTime")
    if not start_val or not _parse_time(str(start_val)):
        return None  # no real start time: an end time would be a guess
    start = parse_datetime(date_val, start_val)
    end = parse_datetime(date_val, end_val) if end_val and _parse_time(str(end_val)) else None
    if start and end and end > start:
        return end
    mins = to_float(raw.get("estimatedDuration"))
    if start and mins and 0 < mins < 24 * 60:
        return start + timedelta(minutes=mins)
    return None


def _parse_time(s: str) -> tuple[int, int] | None:
    s = s.strip().upper()
    # Ranges like "10:00 AM - 12:00 PM": use the start
    s = re.split(r"\s*(?:-|TO)\s*", s)[0]
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$", s)
    if not m:
        return None
    h, mnt, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ap == "PM" and h < 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return (h, mnt) if h < 24 and mnt < 60 else None


def parse_coords(obj: Any) -> tuple[float | None, float | None]:
    coords = pick(obj, "location.coordinates", "address.location.coordinates", "geo.coordinates",
                  "location.geo.coordinates", "coordinates")
    if isinstance(coords, list) and len(coords) == 2:
        # GeoJSON order is [lng, lat]
        return to_float(coords[1]), to_float(coords[0])
    lat = to_float(pick(obj, "location.lat", "location.latitude", "address.lat", "address.latitude", "lat", "latitude"))
    lng = to_float(pick(obj, "location.lng", "location.lon", "location.longitude", "address.lng",
                        "address.longitude", "lng", "lon", "longitude"))
    return lat, lng


def _address(obj: Any) -> str | None:
    addr = pick(obj, "location.address", "location.formattedAddress", "address.fullAddress",
                "address.formattedAddress", "address", "fullAddress", "serviceAddress")
    if isinstance(addr, dict):
        parts = [pick_str(addr, k) for k in ("line1", "street", "area", "locality", "city", "state", "pincode", "zip")]
        addr = ", ".join(p for p in parts if p)
    return str(addr) if addr else None


def person_name(obj: Any, *prefixes: str) -> str | None:
    for pre in prefixes:
        base = dig(obj, pre) if pre else obj
        if isinstance(base, str) and pre:
            continue
        name = pick_str(base, "name", "fullName", "displayName")
        if name:
            return name
        first, last = pick_str(base, "firstName"), pick_str(base, "lastName")
        if first or last:
            return " ".join(p for p in (first, last) if p)
    return None


def _ref_id(v: Any) -> str | None:
    if isinstance(v, dict):
        v = pick(v, "uid", "firebaseUid", "_id", "id")
    return str(v) if v not in (None, "") else None


def normalize_task(t: dict) -> dict:
    status = (pick_str(t, "status", "taskStatus", "state") or "").lower() or None
    sched = parse_datetime(
        pick(t, "scheduledAt", "scheduledDateTime", "scheduledDate", "schedule.date", "schedule.startTime",
             "preferredDate", "date", "dueDate"),
        pick(t, "scheduledTimeStart", "scheduledTime", "schedule.time", "schedule.startTime", "timeSlot",
             "preferredTime", "time"),
    )
    lat, lng = parse_coords(t)
    customer = pick(t, "customer", "requester", "postedBy", "user", "createdBy")
    assignee = pick(t, "assignee", "assignedHelper", "assignedTo", "helper", "assignedPartner")
    return {
        "id": str(pick(t, "_id", "id", "taskId")),
        "title": pick_str(t, "title", "name", "serviceName", "service.name"),
        "description": pick_str(t, "description", "details", "notes"),
        "category": pick_str(t, "category.name", "category", "serviceType", "service.name", "subCategory", "subcategory"),
        "status": status,
        "budget": to_float(pick(t, "budget", "price", "amount", "totalAmount", "payment.amount", "estimatedPrice",
                                "pricing.total", "cost")),
        "address": _address(t),
        "city": pick_str(t, "location.city", "address.city", "city"),
        "lat": lat,
        "lng": lng,
        "scheduled_at": sched,
        "booking_source": pick_str(t, "bookingSource", "source"),
        "customer_id": _ref_id(pick(t, "customerId", "requesterId", "customerUid", "userId")) or _ref_id(customer),
        "customer_name": pick_str(t, "customerName", "requesterName", "contactName") or person_name(customer, ""),
        "customer_phone": normalize_phone(pick(t, "customerPhone", "requesterPhone", "contactPhone", "contactNumber",
                                               "customer.phone", "customer.phoneNumber", "requester.phone")),
        "customer_email": pick_str(t, "customerEmail", "customer.email", "requester.email"),
        "assignee_id": _ref_id(pick(t, "assigneeId", "assignedHelperId", "helperUid", "assignedToId")) or _ref_id(assignee),
        "assignee_profile_id": pick_str(t, "helperProfileId", "assignee.profileId", "assignee._id"),
        "assignee_name": pick_str(t, "assigneeName", "helperName", "assignedHelperName") or person_name(assignee, ""),
        "assignee_phone": normalize_phone(pick(t, "assigneePhone", "helperPhone", "assignee.phone",
                                               "assignee.phoneNumber", "assignedHelper.phone")),
        "remote_updated_at": pick_str(t, "updatedAt", "modifiedAt"),
    }


SKILL_METADATA_KEYS = {
    "updatedAt", "createdAt", "_id", "id", "certificates", "certified",
    "verified", "__v", "v", "status", "experience", "workPlace", "workPhotos",
    "activeForQCommerce", "activeForQCommerceOrders", "selfie", "dlNumber",
    "dlFront", "dlBack", "rc", "dob", "gender", "languages", "onboardingCompleted",
}


def is_clean_service_name(s: Any) -> bool:
    """Validates that a category or skill name is a legitimate service name and not a timestamp/metadata."""
    if not s or not isinstance(s, str):
        return False
    val = s.strip()
    if len(val) < 2:
        return False
    # Check ISO timestamp or date pattern (e.g. 2026-10-02T12:22:12.920Z, 2026-10-02)
    if re.search(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}", val) or re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", val):
        return False
    # Check MongoDB ObjectId (24 hex characters)
    if re.fullmatch(r"[0-9a-fA-F]{24}", val):
        return False
    # Check purely numeric / punctuation
    if re.fullmatch(r"[\d\s.,+-]+", val):
        return False
    # Check experience statements mistakenly entered as skill (e.g. "8 years experience", "5 yrs exp")
    if re.search(r"^\d+\+?\s*(?:years?|yrs?)\b", val, re.IGNORECASE):
        return False
    # Check booleans/nulls
    if val.lower() in ("true", "false", "null", "none", "undefined", "nan"):
        return False
    return True


def _categories(u: dict) -> list[str]:
    raw = pick(u, "partnerProfile.categories", "categories", "serviceCategories", "services")
    if isinstance(raw, str):
        raw = [s for s in re.split(r"[,;/]", raw)]
    out = []
    for s in raw or []:
        name = pick_str(s, "name", "title", "label") if isinstance(s, dict) else str(s)
        if name and is_clean_service_name(name) and name.strip() not in out:
            out.append(name.strip())
    return out


def _skills(u: dict) -> list[str]:
    raw = pick(u, "partnerProfile.skills", "skills", "helperProfile.skills", "profile.skills")
    out = []
    if isinstance(raw, dict):
        for k, sublist in raw.items():
            if k in SKILL_METADATA_KEYS:
                continue
            if isinstance(sublist, list):
                for item in sublist:
                    name = pick_str(item, "name", "title") if isinstance(item, dict) else str(item)
                    if name and is_clean_service_name(name) and name.strip() not in out:
                        out.append(name.strip())
            elif isinstance(sublist, str) and is_clean_service_name(sublist):
                if sublist.strip() not in out:
                    out.append(sublist.strip())
    elif isinstance(raw, str):
        for s in re.split(r"[,;/]", raw):
            if is_clean_service_name(s) and s.strip() not in out:
                out.append(s.strip())
    elif isinstance(raw, list):
        for s in raw:
            name = pick_str(s, "name", "title", "category") if isinstance(s, dict) else str(s)
            if name and is_clean_service_name(name) and name.strip() not in out:
                out.append(name.strip())
    if not out:
        out = _categories(u)
    return out


INDIAN_STATES = {
    "telangana", "andhra pradesh", "karnataka", "maharashtra", "tamil nadu",
    "kerala", "bihar", "uttar pradesh", "delhi", "rajasthan", "madhya pradesh",
    "gujarat", "west bengal", "odisha", "punjab", "haryana", "assam", "jharkhand",
}


def is_clean_location(loc: Any) -> bool:
    """Validates that a city/area name is legitimate and not a Plus Code, door number, or state name."""
    if not loc or not isinstance(loc, str):
        return False
    val = loc.strip()
    if len(val) < 2:
        return False
    if "+" in val:  # Google Plus code (e.g. V243+HPC)
        return False
    if re.fullmatch(r"\d+-\d+(?:-\d+)?", val):  # Door / building numbers (e.g. 1-189, 2-4-127)
        return False
    if re.fullmatch(r"[\d\s.,+-]+", val):  # Pure numbers
        return False
    if re.fullmatch(r"[0-9a-fA-F]{24}", val):  # ObjectIds
        return False
    if val.lower() in INDIAN_STATES:
        return False
    return True


def extract_city_from_address(addr: str | None) -> str | None:
    """Extracts the city/town/district from a full street address when ExtraHand sends door numbers or plus codes as city."""
    if not addr or not isinstance(addr, str):
        return None
    parts = [p.strip() for p in addr.split(",") if p.strip()]
    if not parts:
        return None
    parts = [p for p in parts if p.lower() != "india"]
    cleaned_parts = []
    for p in parts:
        if "+" in p or re.match(r"^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4}", p):
            continue
        if re.match(r"^\d+-\d+(?:-\d+)?$", p):
            continue
        p_no_pin = re.sub(r"\b\d{6}\b", "", p).strip()
        if p_no_pin.lower() in INDIAN_STATES or not p_no_pin:
            continue
        cleaned_parts.append(p_no_pin)

    if not cleaned_parts:
        return None
    for candidate in reversed(cleaned_parts):
        c_clean = re.sub(r"\s+(mandal|subdistrict|district|zone|circle|ward\s*\d+).*$", "", candidate, flags=re.I).strip()
        if c_clean and c_clean.lower() not in INDIAN_STATES and len(c_clean) > 2:
            return c_clean
    return cleaned_parts[-1]


def _work_areas(u: dict) -> list[str]:
    raw = pick(u, "partnerProfile.workAreas", "helperWorkAreas", "workAreas", "serviceAreas", "areas")
    if isinstance(raw, str):
        raw = [s for s in re.split(r"[,;/]", raw)]
    out = []
    for s in raw or []:
        name = pick_str(s, "name", "title", "area") if isinstance(s, dict) else str(s)
        if name and is_clean_location(name) and name.strip() not in out:
            out.append(name.strip())
    return out


def normalize_user(u: dict) -> dict:
    lat, lng = parse_coords(u)
    cats = _categories(u)
    skills = _skills(u)
    if not cats and skills:
        cats = list(dict.fromkeys(skills))

    is_act = pick(u, "isActive", "partnerProfile.isActive")
    if is_act is None:
        status_val = pick_str(u, "partnerProfile.status", "status", "accountStatus") or "active"
        is_act = status_val.lower() == "active"
    else:
        is_act = bool(is_act)

    # is_verified = Aadhaar verified on ExtraHand (isVerified is a fallback for records without the Aadhaar field)
    is_ver = bool(pick(u, "isAadhaarVerified", "isVerified", "partnerProfile.isVerified") or False)
    verified_known = any(dig(u, p) is not None for p in ("isAadhaarVerified", "isVerified", "partnerProfile.isVerified"))
    can_acc = pick(u, "roleVerifications.tasker.canAcceptTasks", "canAcceptTasks")
    can_acc = True if can_acc is None else bool(can_acc)
    user_addr = pick_str(u, "location.address", "address.fullAddress", "address.line1", "location.addressDetails.area") or _address(u)
    raw_user_city = pick_str(u, "location.addressDetails.city", "location.city", "address.city", "city")
    if not is_clean_location(raw_user_city):
        extracted = extract_city_from_address(user_addr)
        clean_user_city = extracted if is_clean_location(extracted) else None
    else:
        clean_user_city = raw_user_city

    return {
        "id": str(pick(u, "uid", "firebaseUid", "_id", "id")),
        "profile_id": pick_str(u, "_id", "profileId", "id"),
        "name": person_name(u, "", "profile"),
        "phone": normalize_phone(pick(u, "phone", "phoneNumber", "mobile", "contact.phone", "profile.phone")),
        "alt_phone": normalize_phone(pick(u, "alternatePhone", "alternatePhoneNumber", "altPhone", "secondaryPhone")),
        "email": pick_str(u, "email", "contact.email"),
        "skills": skills,
        "categories": cats,
        "work_areas": _work_areas(u),
        "address": user_addr,
        "city": clean_user_city,
        "state": pick_str(u, "location.addressDetails.state", "location.state", "address.state", "state"),
        "pincode": pick_str(u, "location.addressDetails.pinCode", "location.addressDetails.pincode", "location.pinCode", "pincode", "address.pincode"),
        "lat": lat,
        "lng": lng,
        "status": pick_str(u, "partnerProfile.status", "status") or "active",
        "is_active": is_act,
        "is_verified": is_ver,
        "verified_known": verified_known,  # False: the record had no verification field (do not overwrite it)
        "can_accept_tasks": can_acc,
        "work_shift_type": pick_str(u, "partnerProfile.workShiftType", "workShiftType"),
        "distance_km": to_float(pick(u, "distanceKm", "distance", "dist.calculated")),
        "raw": u,
    }


def extract_list(resp: Any) -> list[dict]:
    if isinstance(resp, list):
        return resp
    for path in ("data.items", "data.tasks", "data.users", "data.docs", "data.results", "data.helpers",
                 "data.candidates", "data", "items", "tasks", "users", "docs", "results", "candidates", "helpers"):
        v = dig(resp, path)
        if isinstance(v, list):
            return v
    return []


def extract_obj(resp: Any) -> dict:
    for path in ("data.task", "data.user", "data", "task", "user"):
        v = dig(resp, path)
        if isinstance(v, dict) and v:
            return v
    return resp if isinstance(resp, dict) else {}


def has_next_page(resp: Any, page: int, got: int, limit: int) -> bool:
    pag = pick(resp, "data.pagination", "pagination", "meta", "data.meta")
    if isinstance(pag, dict):
        if "hasNextPage" in pag:
            return bool(pag["hasNextPage"])
        total_pages = to_float(pick(pag, "totalPages", "pages"))
        if total_pages is not None:
            return page < total_pages
        total = to_float(pick(pag, "total", "totalCount", "totalItems"))
        if total is not None:
            return page * limit < total
    return got >= limit


def is_terminal(status: str | None) -> bool:
    return (status or "").replace(" ", "_") in TERMINAL_STATUSES


def is_assigned(rec: dict) -> bool:
    return bool(rec.get("assignee_id")) or (rec.get("status") or "").replace(" ", "_") in ASSIGNED_STATUSES
