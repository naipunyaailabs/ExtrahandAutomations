"""Google Maps ratings and reviews through a self-hosted gosom/google-maps-scraper in web mode (GMAPS_SCRAPER_URL).

A job takes a few minutes; it runs once per area per pricing run."""

import asyncio
import csv
import io
import json
import logging
import re
import sys
from dataclasses import dataclass, field

import httpx

from app.config import get_settings

logger = logging.getLogger("pricing.maps")


@dataclass
class Place:
    title: str
    rating: float | None
    review_count: int | None
    reviews: list[str] = field(default_factory=list)
    url: str | None = None


def _num(v, kind):
    try:
        return kind(str(v).replace(",", "").strip()) if v not in (None, "") else None
    except ValueError:
        return None


def _review_texts(raw: str) -> list[str]:
    try:
        items = json.loads(raw) if raw else []
    except ValueError:
        return []
    texts = []
    for it in items if isinstance(items, list) else []:
        if isinstance(it, dict):
            t = it.get("Description") or it.get("description") or it.get("text") or ""
            if t.strip():
                texts.append(" ".join(t.split())[:400])
    return texts


def parse_results_csv(text: str) -> list[Place]:
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    return [
        Place(
            title=row.get("title") or "",
            rating=_num(row.get("review_rating"), float),
            review_count=_num(row.get("review_count"), int),
            reviews=_review_texts(row.get("user_reviews") or ""),
            url=row.get("link") or None,
        )
        for row in csv.DictReader(io.StringIO(text))
        if row.get("title")
    ]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def best_match(places: list[Place], competitor: str) -> Place | None:
    """The listing whose name contains the competitor's, with the most reviews."""
    key = _norm(competitor)
    hits = [p for p in places if key and key in _norm(p.title)]
    return max(hits, key=lambda p: p.review_count or 0, default=None)


async def maps_places(keywords: list[str], *, max_time_s: int = 600, poll_s: float = 15.0) -> list[Place] | None:
    """Every listing found for the keywords; None when the scraper is not configured or the job fails."""
    base = get_settings().gmaps_scraper_url.rstrip("/")
    if not base or not keywords:
        return None
    body = {
        "name": f"pricing {keywords[0]}"[:80], "keywords": keywords, "lang": "en", "zoom": 15, "depth": 1,
        "max_time": max_time_s, "fast_mode": False, "radius": 10000, "lat": "", "lon": "", "email": False,
        "extra_reviews": False,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(f"{base}/api/v1/jobs", json=body)
            res.raise_for_status()
            job_id = res.json()["id"]
            loop = asyncio.get_running_loop()
            deadline = loop.time() + max_time_s + 120
            status = "pending"
            while loop.time() < deadline:
                await asyncio.sleep(poll_s)
                job = (await client.get(f"{base}/api/v1/jobs/{job_id}")).json()
                status = str(job.get("Status") or job.get("status") or "").lower()
                if status in ("ok", "failed"):
                    break
            if status != "ok":
                logger.warning("[Pricing] maps job %s ended as %r", job_id, status)
                return None
            places = parse_results_csv((await client.get(f"{base}/api/v1/jobs/{job_id}/download")).text)
            await client.delete(f"{base}/api/v1/jobs/{job_id}")
            return places
    except Exception as exc:
        logger.warning("[Pricing] maps scraper failed: %s", exc)
        return None
