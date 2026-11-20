"""Reads web pages as plain text: Crawl4AI (renders JavaScript) when installed, else a plain HTTP fetch."""

import asyncio
import ipaddress
import logging
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from app.config import get_settings

from .search import USER_AGENT

logger = logging.getLogger("pricing.reader")

MAX_PAGE_BYTES = 2_000_000
MAX_REDIRECTS = 3


def public_http_url(url: str) -> bool:
    """True only for an http(s) address that resolves to public internet addresses. Search results are untrusted:
    this keeps a result (or a redirect) from making the server read its own network (SQL Server, SearXNG, the
    cloud metadata address). A DNS answer that changes between this check and the fetch is not covered."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80),
                                   type=socket.SOCK_STREAM)
        return bool(infos) and all(ipaddress.ip_address(str(i[4][0]).split("%")[0]).is_global for i in infos)
    except (OSError, ValueError):
        return False

# Text near these is where prices are; everything else is trimmed before the LLM sees it.
PRICE_MARK = re.compile(r"₹|\bRs\.?\s?\d|\bINR\b|\d\s?/-|\brupees?\b", re.I)


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag in ("p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "section"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._skip:
            return
        if self._in_title:
            self.title += data
        else:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    p = _TextExtractor()
    p.feed(html)
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.parts))
    text = re.sub(r"\n\s*\n+", "\n", text)
    return " ".join(p.title.split()), text.strip()


def price_excerpt(text: str, window: int = 300, limit: int = 3500) -> str:
    """The parts of a page around price mentions, merged and capped. Empty when the page names no price."""
    spans: list[list[int]] = []
    for m in PRICE_MARK.finditer(text):
        start, end = max(0, m.start() - window), min(len(text), m.end() + window)
        if spans and start <= spans[-1][1]:
            spans[-1][1] = end
        else:
            spans.append([start, end])
    out, size = [], 0
    for start, end in spans:
        chunk = text[start:end].strip()
        out.append(chunk)
        size += len(chunk)
        if size >= limit:
            break
    return "\n…\n".join(out)[:limit]


def crawl4ai_available() -> bool:
    try:
        import crawl4ai  # noqa: F401
    except ImportError:
        return False
    return True


class PageReader:
    """`async with PageReader() as r: title, text = await r.read(url)`. One browser per run with Crawl4AI."""

    def __init__(self, mode: str | None = None, transport: httpx.AsyncBaseTransport | None = None):
        mode = mode or get_settings().pricing_page_reader
        self.use_crawl4ai = mode == "crawl4ai" or (mode == "auto" and crawl4ai_available())
        self._transport = transport
        self._crawler = None
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self):
        if self.use_crawl4ai:
            from crawl4ai import AsyncWebCrawler

            self._crawler = AsyncWebCrawler()
            await self._crawler.__aenter__()
        else:
            # Redirects are followed by hand in read(), so every hop is checked
            self._http = httpx.AsyncClient(timeout=20.0, follow_redirects=False, headers={"User-Agent": USER_AGENT},
                                           transport=self._transport)
        return self

    async def __aexit__(self, *exc):
        if self._crawler is not None:
            await self._crawler.__aexit__(*exc)
        if self._http is not None:
            await self._http.aclose()

    async def read(self, url: str) -> tuple[str, str]:
        """(title, text); ('', '') when the page cannot be read or is not on the public internet. With Crawl4AI
        only the first address is checked: the browser follows redirects itself."""
        try:
            if not await asyncio.to_thread(public_http_url, url):
                logger.info("[Pricing] skipped non-public address %s", url)
                return "", ""
            if self._crawler is not None:
                result = await self._crawler.arun(url=url)
                if not result.success:
                    return "", ""
                title = ((result.metadata or {}).get("title") or "").strip()
                return title, str(result.markdown or "")
            return await self._fetch(url)
        except Exception as exc:
            logger.info("[Pricing] could not read %s: %s", url, exc)
            return "", ""

    async def _fetch(self, url: str) -> tuple[str, str]:
        assert self._http is not None
        for _ in range(MAX_REDIRECTS + 1):
            async with self._http.stream("GET", url) as res:
                if res.is_redirect and res.next_request is not None:
                    url = str(res.next_request.url)
                    if not await asyncio.to_thread(public_http_url, url):
                        logger.info("[Pricing] blocked redirect to %s", url)
                        return "", ""
                    continue
                if res.status_code != 200 or "html" not in res.headers.get("content-type", "html"):
                    return "", ""
                body = b""
                async for chunk in res.aiter_bytes():
                    body += chunk
                    if len(body) >= MAX_PAGE_BYTES:
                        break
                return html_to_text(body[:MAX_PAGE_BYTES].decode(res.encoding or "utf-8", errors="replace"))
        return "", ""
