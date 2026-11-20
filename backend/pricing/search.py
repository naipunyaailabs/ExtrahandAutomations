"""Web search without a paid key: a self-hosted SearXNG (SEARXNG_URL), else the `ddgs` library, which reads the public
result pages of Yahoo, Brave, Startpage and DuckDuckGo and falls back from one engine to the next."""

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger("pricing.search")

WEB_SCHEMES = ("http://", "https://")  # results become links on the dashboard: nothing else is kept

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


class SearchUnavailable(RuntimeError):
    """Search cannot work as set up (SearXNG refusing us, ddgs not installed); trying again won't help."""


@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str


async def searxng_search(base_url: str, query: str, limit: int, transport: httpx.AsyncBaseTransport | None = None) -> list[SearchResult]:
    """SearXNG's JSON API (needs `json` under search.formats in its settings.yml)."""
    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        res = await client.get(f"{base_url.rstrip('/')}/search", params={"q": query, "format": "json", "language": "en-IN"})
        if res.status_code in (403, 429):
            raise SearchUnavailable(
                f"SearXNG answered {res.status_code}. A 403 usually means `json` is missing from search.formats in its settings.yml."
            )
        res.raise_for_status()
        data = res.json()
        rows = data.get("results") or []
        if not rows and data.get("unresponsive_engines"):
            logger.warning("[Pricing] SearXNG engines did not answer for %r: %s", query, data["unresponsive_engines"][:4])
    return [
        SearchResult(url=r["url"], title=r.get("title") or "", snippet=r.get("content") or "")
        for r in rows
        if str(r.get("url") or "").startswith(WEB_SCHEMES)
    ][:limit]


def ddgs_text(query: str, limit: int, engines: list[str], attempts: int, pause: float = 1.0) -> list[SearchResult]:
    """Blocking. Each engine is tried up to `attempts` times, then the next one. From a server address the engines
    fail at random (a query that fails once often works the next time) and each blocks different addresses."""
    from ddgs import DDGS

    for engine in engines:
        for attempt in range(attempts):
            try:
                rows = DDGS(timeout=15).text(query, region="in-en", max_results=limit, backend=engine)
            except Exception:  # "No results found.", a rate limit or a timeout all look the same: try again
                rows = []
            found = [SearchResult(url=r.get("href") or "", title=r.get("title") or "", snippet=r.get("body") or "") for r in rows]
            found = [r for r in found if r.url.startswith(WEB_SCHEMES)]
            if found:
                return found[:limit]
            if attempt + 1 < attempts:
                time.sleep(pause)
    return []


async def web_search(query: str, limit: int | None = None) -> list[SearchResult]:
    """A search that fails for an ordinary reason finds nothing; one that cannot work as set up raises SearchUnavailable."""
    s = get_settings()
    limit = limit or s.pricing_results_per_query
    try:
        if s.searxng_url:
            return await searxng_search(s.searxng_url, query, limit)
        engines = [e.strip() for e in s.pricing_search_engines.split(",") if e.strip()]
        return await asyncio.to_thread(ddgs_text, query, limit, engines, s.pricing_search_attempts)
    except SearchUnavailable:
        raise
    except ImportError as exc:
        raise SearchUnavailable("The ddgs package is not installed: pip install -r requirements.txt") from exc
    except Exception as exc:
        logger.warning("[Pricing] search failed for %r: %s", query, exc)
        return []
