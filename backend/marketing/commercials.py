"""Advertisement Commercials: what the Advertisement Agent's AI costs.

The agent pays OpenRouter for five kinds of request:
  scan      GPT-OSS-20B reads Drik Panchang pages and picks the month's major festivals (many steps per month)
  research  GPT-OSS-20B studies one festival (religion, symbols, image prompt); kept and reused for later posters
  brief     GPT-OSS-20B writes a fresh poster brief (concept, headline, prompt)
  draw      Seedream 5.0 Flash draws the poster (redrawn once when the check fails)
  check     Gemini 2.5 Flash reads the poster and checks its text and imagery

Each request is metered in ``ad_ai_usage`` (see metering.py). Its cost is what OpenRouter reported ("reported");
otherwise it is priced from this rate card ("estimate"). Prices are in USD at OpenRouter and shown in INR.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.database import SessionLocal
from app.models import AppSetting

router = APIRouter(prefix="/commercials", tags=["Advertisement Commercials"])

IST = timezone(timedelta(hours=5, minutes=30))
RATES_KEY = "advertisement_commercials_rates"
OPERATIONS = ("scan", "research", "brief", "draw", "check")
POSTER_STEPS = ("research", "brief", "draw", "check")

# What one request typically uses, for estimates before anything has been measured
TYPICAL: Dict[str, Dict[str, float]] = {
    "scan": {"prompt_tokens": 8000, "completion_tokens": 600},  # one step of the scan agent (a page in context)
    "research": {"prompt_tokens": 900, "completion_tokens": 1500},
    "brief": {"prompt_tokens": 1800, "completion_tokens": 1800},
    "draw": {"images": 1},
    "check": {"prompt_tokens": 1900, "completion_tokens": 450},  # the poster image is ~1,300 input tokens
}
TYPICAL_DRAWS_PER_POSTER = 1.3  # a share of posters fail the check and are drawn again
TYPICAL_SCAN_REQUESTS = 18  # 3 months × ~6 steps (open pages, read, answer)


class AdRates(BaseModel):
    """OpenRouter list prices (USD) and the exchange rate. Defaults are estimates: replace them with your invoice."""

    usd_to_inr: float = Field(88.0, gt=0)
    text_in_per_m: float = Field(0.04, ge=0, description="GPT-OSS-20B input, USD per 1M tokens")
    text_out_per_m: float = Field(0.15, ge=0, description="GPT-OSS-20B output, USD per 1M tokens")
    vision_in_per_m: float = Field(0.30, ge=0, description="Gemini 2.5 Flash input, USD per 1M tokens")
    vision_out_per_m: float = Field(2.50, ge=0, description="Gemini 2.5 Flash output, USD per 1M tokens")
    image_usd: float = Field(0.035, ge=0, description="Seedream 5.0 Flash, USD per poster image")
    monthly_budget: float = Field(3000.0, ge=0, description="Monthly budget in INR")


def load_rates() -> AdRates:
    with SessionLocal() as db:
        row = db.get(AppSetting, RATES_KEY)
        if row:
            try:
                return AdRates(**json.loads(row.value))
            except (ValueError, TypeError):
                pass
    return AdRates()


def _rates_customized() -> bool:
    with SessionLocal() as db:
        return db.get(AppSetting, RATES_KEY) is not None


def estimate_usd(r: AdRates, operation: str, usage: Dict[str, Any]) -> float:
    """Rate-card price of one request."""
    tin, tout = float(usage.get("prompt_tokens") or 0), float(usage.get("completion_tokens") or 0)
    if operation == "draw":
        return float(usage.get("images") or 0) * r.image_usd
    if operation == "check":
        return (tin * r.vision_in_per_m + tout * r.vision_out_per_m) / 1e6
    return (tin * r.text_in_per_m + tout * r.text_out_per_m) / 1e6


@router.get("/rates")
def get_rates() -> Dict[str, Any]:
    return load_rates().model_dump()


@router.put("/rates")
def put_rates(body: AdRates) -> Dict[str, Any]:
    with SessionLocal() as db:
        row = db.get(AppSetting, RATES_KEY) or AppSetting(key=RATES_KEY)
        row.value = body.model_dump_json()
        db.add(row)
        db.commit()
    return body.model_dump()


# ------------------------------------------------------------------------------------------------- report


def _r(x: float, n: int = 2) -> float:
    return round(x, n)


def _rows() -> List[Dict[str, Any]]:
    from .database import ad_ai_usage, engine, init_advestiment_db

    init_advestiment_db()
    with engine.connect() as conn:
        rows = conn.execute(select(ad_ai_usage).order_by(ad_ai_usage.c.created_at)).mappings().all()
    out = []
    for row in rows:
        d = dict(row)
        try:
            d["t"] = datetime.strptime(d["created_at"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).astimezone(IST)
        except ValueError:
            continue
        out.append(d)
    return out


def _bounds(now: datetime) -> Dict[str, tuple]:
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = day - timedelta(days=day.weekday())
    month = day.replace(day=1)
    prev_month = (month - timedelta(days=1)).replace(day=1)
    return {
        "today": (day, now, day - timedelta(days=1), now - timedelta(days=1)),
        "week": (week, now, week - timedelta(days=7), now - timedelta(days=7)),
        "month": (month, now, prev_month, prev_month + (now - month)),
        "all": (datetime(2000, 1, 1, tzinfo=IST), now, None, None),
    }


def _summ(rows: List[Dict[str, Any]], fx: float) -> Dict[str, Any]:
    by_op = {op: {"cost": 0.0, "requests": 0, "failed": 0} for op in OPERATIONS}
    posters, scans = set(), set()
    for x in rows:
        o = by_op.setdefault(x["operation"], {"cost": 0.0, "requests": 0, "failed": 0})
        o["cost"] += (x["cost_usd"] or 0) * fx
        o["requests"] += 1
        o["failed"] += 0 if x["ok"] else 1
        if x["job_kind"] == "poster" and x["operation"] == "draw" and x["ok"]:
            posters.add(x["job_id"])
        if x["job_kind"] == "scan":
            scans.add(x["job_id"])
    cost = sum(o["cost"] for o in by_op.values())
    return {
        "cost": _r(cost),
        "requests": len(rows),
        "failed": sum(1 for x in rows if not x["ok"]),
        "tokens_in": sum(x["prompt_tokens"] or 0 for x in rows),
        "tokens_out": sum(x["completion_tokens"] or 0 for x in rows),
        "images": sum(x["images"] or 0 for x in rows),
        "posters": len(posters),
        "scans": len(scans),
        "cost_per_poster": _r(cost / len(posters)) if posters else None,
        "reported_share": _r(sum(1 for x in rows if x["cost_source"] == "openrouter") / len(rows), 3) if rows else 0,
        "by_operation": {k: {**v, "cost": _r(v["cost"])} for k, v in by_op.items()},
    }


def _jobs(rows: List[Dict[str, Any]], fx: float) -> Dict[str, Dict[str, Any]]:
    jobs: Dict[str, Dict[str, Any]] = {}
    for x in rows:
        j = jobs.setdefault(x["job_id"], {
            "job_id": x["job_id"], "kind": x["job_kind"], "title": x["title"], "event_id": x["event_id"],
            "started": x["t"], "ended": x["t"], "steps": defaultdict(lambda: {"cost": 0.0, "requests": 0, "failed": 0}),
            "cost": 0.0, "draws": 0, "images": 0, "tokens": 0, "latency_ms": 0, "ok": False,
        })
        j["ended"] = x["t"]
        j["title"] = j["title"] or x["title"]
        j["event_id"] = j["event_id"] or x["event_id"]
        s = j["steps"][x["operation"]]
        c = (x["cost_usd"] or 0) * fx
        s["cost"] += c
        s["requests"] += 1
        s["failed"] += 0 if x["ok"] else 1
        j["cost"] += c
        j["tokens"] += (x["prompt_tokens"] or 0) + (x["completion_tokens"] or 0)
        j["latency_ms"] += x["latency_ms"] or 0
        if x["operation"] == "draw":
            j["draws"] += 1
            j["images"] += x["images"] or 0
            j["ok"] = j["ok"] or bool(x["ok"])
        if j["kind"] != "poster" and x["ok"]:
            j["ok"] = True
    return jobs


def _poster_urls(event_ids: List[str]) -> Dict[str, Dict[str, str]]:
    from .database import ad_events, engine

    ids = [i for i in set(event_ids) if i]
    if not ids:
        return {}
    with engine.connect() as conn:
        rows = conn.execute(select(ad_events.c.id, ad_events.c.poster_url, ad_events.c.city, ad_events.c.date_start)
                            .where(ad_events.c.id.in_(ids))).mappings().all()
    return {r["id"]: {"poster_url": r["poster_url"] or "", "city": r["city"] or "", "date": r["date_start"] or ""}
            for r in rows}


def _upcoming_without_poster(days: int = 60) -> int:
    from .database import ad_events, engine

    today = date.today().isoformat()
    until = (date.today() + timedelta(days=days)).isoformat()
    with engine.connect() as conn:
        rows = conn.execute(select(ad_events.c.poster_url, ad_events.c.status)
                            .where(ad_events.c.date_start >= today, ad_events.c.date_start <= until)).all()
    return sum(1 for url, status in rows if not url and (status or "").lower() not in ("rejected",))


def _typical_poster(r: AdRates) -> Dict[str, float]:
    """Rate-card cost (INR) of each step of one typical poster."""
    fx = r.usd_to_inr
    return {
        "research": estimate_usd(r, "research", TYPICAL["research"]) * fx,
        "brief": estimate_usd(r, "brief", TYPICAL["brief"]) * fx,
        "draw": estimate_usd(r, "draw", TYPICAL["draw"]) * fx * TYPICAL_DRAWS_PER_POSTER,
        "check": estimate_usd(r, "check", TYPICAL["check"]) * fx * TYPICAL_DRAWS_PER_POSTER,
    }


def _festivals(jobs: Dict[str, Dict[str, Any]], per_poster: float, per_scan: float) -> Dict[str, Any]:
    """Every festival the agent noticed, its approval, its poster versions and what they cost. Posters drawn before
    metering started (the poster's version number counts every drawing) are priced at the per-poster rate."""
    from .database import ad_events, ad_festival_runs, engine

    with engine.connect() as conn:
        events = conn.execute(select(ad_events.c.id, ad_events.c.title, ad_events.c.city, ad_events.c.date_start,
                                     ad_events.c.status, ad_events.c.source, ad_events.c.poster_url,
                                     ad_events.c.poster_theme, ad_events.c.poster_generated_at)
                              .order_by(ad_events.c.date_start)).mappings().all()
        runs = conn.execute(select(ad_festival_runs.c.status)).scalars().all()
    measured: Dict[str, Dict[str, float]] = defaultdict(lambda: {"posters": 0, "cost": 0.0})
    for j in jobs.values():
        if j["kind"] == "poster" and j["event_id"]:
            m = measured[j["event_id"]]
            m["cost"] += j["cost"]
            m["posters"] += 1 if j["ok"] else 0
    today = date.today()
    items, status_counts = [], defaultdict(int)
    for e in events:
        try:
            design = json.loads(e["poster_theme"] or "{}") if str(e["poster_theme"] or "").startswith("{") else {}
        except ValueError:
            design = {}
        versions = int(design.get("variant") or (1 if e["poster_url"] else 0))
        m = measured.get(e["id"], {"posters": 0, "cost": 0.0})
        unmetered = max(0, versions - int(m["posters"]))
        status = (e["status"] or "Pending Review").strip()
        status_counts[status] += 1
        try:
            days = (date.fromisoformat(e["date_start"]) - today).days
        except (TypeError, ValueError):
            days = None
        items.append({
            "id": e["id"], "title": e["title"], "city": e["city"], "date": e["date_start"], "days": days,
            "status": status, "source": e["source"] or "", "poster_url": e["poster_url"] or "",
            "versions": versions, "measured_cost": _r(m["cost"]), "estimated_cost": _r(unmetered * per_poster),
            "cost": _r(m["cost"] + unmetered * per_poster), "unmetered": unmetered,
        })
    pending = [x for x in items if x["status"].lower().startswith("pending")]
    scans_measured = sum(1 for j in jobs.values() if j["kind"] == "scan")
    scans_unmetered = max(0, sum(1 for st in runs if st == "success") - scans_measured)
    posters_est = sum(x["estimated_cost"] for x in items)
    return {
        "found": len(items),
        "approved": sum(1 for x in items if x["status"].lower() == "approved"),
        "pending": len(pending),
        "rejected": sum(1 for x in items if x["status"].lower() == "rejected"),
        "with_poster": sum(1 for x in items if x["poster_url"]),
        "versions": sum(x["versions"] for x in items),
        "scans_run": len(runs),
        "by_status": dict(status_counts),
        "before_metering": {"posters": sum(x["unmetered"] for x in items), "scans": scans_unmetered,
                            "cost": _r(posters_est + scans_unmetered * per_scan)},
        "soon_pending": [x for x in pending if x["days"] is not None and 0 <= x["days"] <= 3],
        "past_pending": [x for x in pending if x["days"] is not None and x["days"] < 0],
        "items": items,
    }


@router.get("")
@router.get("/")
def report() -> Dict[str, Any]:
    r = load_rates()
    fx = r.usd_to_inr
    rows = _rows()
    now = datetime.now(IST)

    periods, previous = {}, {}
    for key, (start, end, pstart, pend) in _bounds(now).items():
        periods[key] = _summ([x for x in rows if start <= x["t"] <= end], fx)
        previous[key] = _summ([x for x in rows if pstart <= x["t"] < pend], fx)["cost"] if pstart else None

    # Last 30 days, by step
    day0 = (now - timedelta(days=29)).date()
    daily = {(day0 + timedelta(days=i)).isoformat(): {op: 0.0 for op in OPERATIONS} for i in range(30)}
    for x in rows:
        k = x["t"].date().isoformat()
        if k in daily:
            daily[k][x["operation"]] = daily[k].get(x["operation"], 0.0) + (x["cost_usd"] or 0) * fx
    daily_list = [{"date": k, **{op: _r(v) for op, v in ops.items()}, "total": _r(sum(ops.values()))}
                  for k, ops in daily.items()]

    jobs = _jobs(rows, fx)
    poster_jobs = [j for j in jobs.values() if j["kind"] == "poster" and j["ok"]]
    scan_jobs = [j for j in jobs.values() if j["kind"] == "scan"]

    # One poster: measured averages where posters exist, else the rate card
    typical = _typical_poster(r)
    if poster_jobs:
        recipe = {op: sum(j["steps"][op]["cost"] for j in poster_jobs if op in j["steps"]) / len(poster_jobs)
                  for op in POSTER_STEPS}
        draws = sum(j["draws"] for j in poster_jobs) / len(poster_jobs)
        first_try = sum(1 for j in poster_jobs if j["draws"] <= 1) / len(poster_jobs)
        recipe_source = "measured"
    else:
        recipe, draws, first_try, recipe_source = typical, TYPICAL_DRAWS_PER_POSTER, 0.7, "estimate"
    per_poster = sum(recipe.values())
    per_scan = (sum(j["cost"] for j in scan_jobs) / len(scan_jobs)) if scan_jobs else \
        estimate_usd(r, "scan", TYPICAL["scan"]) * fx * TYPICAL_SCAN_REQUESTS

    # Models
    models: Dict[str, Dict[str, Any]] = {}
    for x in rows:
        m = models.setdefault(x["model"] or "unknown", {"model": x["model"] or "unknown", "operations": set(),
                                                        "requests": 0, "failed": 0, "tokens_in": 0, "tokens_out": 0,
                                                        "images": 0, "cost_usd": 0.0, "reported": 0, "latency_ms": 0})
        m["operations"].add(x["operation"])
        m["requests"] += 1
        m["failed"] += 0 if x["ok"] else 1
        m["tokens_in"] += x["prompt_tokens"] or 0
        m["tokens_out"] += x["completion_tokens"] or 0
        m["images"] += x["images"] or 0
        m["cost_usd"] += x["cost_usd"] or 0
        m["reported"] += 1 if x["cost_source"] == "openrouter" else 0
        m["latency_ms"] += x["latency_ms"] or 0
    model_list = sorted(({**m, "operations": sorted(m["operations"]), "cost_usd": _r(m["cost_usd"], 4),
                          "cost_inr": _r(m["cost_usd"] * fx), "avg_latency_ms": int(m["latency_ms"] / m["requests"])}
                         for m in models.values()), key=lambda m: -m["cost_inr"])

    # Recent work (newest first)
    recent = sorted(jobs.values(), key=lambda j: j["started"], reverse=True)[:24]
    posters = _poster_urls([j["event_id"] for j in recent])
    recent_list = [{
        "job_id": j["job_id"], "kind": j["kind"], "title": j["title"], "event_id": j["event_id"],
        "started": j["started"].isoformat(), "seconds": int(j["latency_ms"] / 1000),
        "cost": _r(j["cost"]), "draws": j["draws"], "tokens": j["tokens"], "ok": j["ok"],
        "steps": {op: {**s, "cost": _r(s["cost"])} for op, s in j["steps"].items()},
        **posters.get(j["event_id"], {"poster_url": "", "city": "", "date": ""}),
    } for j in recent]

    month = periods["month"]["cost"]
    day_of_month = now.day
    days_in_month = ((now.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
    upcoming = _upcoming_without_poster()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rates": r.model_dump(),
        "rates_customized": _rates_customized(),
        "periods": periods,
        "previous": previous,
        "daily": daily_list,
        "unit": {
            "per_poster": _r(per_poster),
            "per_scan": _r(per_scan),
            "draws_per_poster": _r(draws),
            "first_try_rate": _r(first_try, 3),
            "recipe": {op: _r(v, 3) for op, v in recipe.items()},
            "recipe_source": recipe_source,
            "typical": {op: _r(v, 3) for op, v in typical.items()},
            "posters_measured": len(poster_jobs),
            "scans_measured": len(scan_jobs),
        },
        "models": model_list,
        "recent": recent_list,
        "budget": {
            "monthly": r.monthly_budget,
            "spent": month,
            "projected": _r(month / day_of_month * days_in_month) if day_of_month else month,
        },
        "pipeline": {"upcoming_without_poster": upcoming, "projected_cost": _r(upcoming * per_poster)},
        "festivals": _festivals(jobs, per_poster, per_scan),
    }
