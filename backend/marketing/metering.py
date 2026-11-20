"""Metering of the Advertisement Agent's paid AI requests (all through OpenRouter).

Every request goes through ``post``: it asks OpenRouter to report the request's cost (usage accounting), times the
request and stores one ``ad_ai_usage`` row with its tokens, images and cost. When OpenRouter does not report a cost
the row is priced from the rate card on the Advertisement Commercials page. A failed write never fails the request.

``job`` groups the requests of one piece of work (one festival scan, one poster) so the page can show what a whole
poster or scan cost. Jobs nest: research done inside a poster job belongs to that poster.
"""

from __future__ import annotations

import contextvars
import logging
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, Optional

import httpx

logger = logging.getLogger("marketing.metering")

_job: contextvars.ContextVar[Optional[Dict[str, str]]] = contextvars.ContextVar("ad_ai_job", default=None)


@contextmanager
def job(kind: str, event_id: str = "", title: str = "") -> Iterator[Dict[str, str]]:
    """Requests made inside share one job id. Inside another job, the outer job is kept (only the festival changes)."""
    outer = _job.get()
    if outer:
        current = {**outer, "event_id": event_id or outer["event_id"], "title": title or outer["title"]}
    else:
        current = {"job_id": uuid.uuid4().hex[:16], "kind": kind, "event_id": event_id, "title": title}
    token = _job.set(current)
    try:
        yield current
    finally:
        _job.reset(token)


def _usage(res: Optional[httpx.Response]) -> Dict[str, Any]:
    if res is None or res.status_code != 200:
        return {}
    try:
        data = res.json()
    except ValueError:
        return {}
    usage = data.get("usage") or {}
    message = ((data.get("choices") or [{}])[0] or {}).get("message") or {}
    cost = usage.get("cost")
    return {
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "images": len(message.get("images") or []),
        "cost_usd": float(cost) if isinstance(cost, (int, float)) else None,
    }


def record(operation: str, model: str, usage: Dict[str, Any], ok: bool, latency_ms: int,
           billed: Optional[bool] = None) -> None:
    """Store one request. ``billed`` is False when OpenRouter refused it (no charge). Never raises."""
    try:
        from .commercials import estimate_usd, load_rates
        from .database import ad_ai_usage, engine, init_advestiment_db

        init_advestiment_db()
        ctx = _job.get() or {"job_id": uuid.uuid4().hex[:16], "kind": operation, "event_id": "", "title": ""}
        cost = usage.get("cost_usd")
        if not (ok if billed is None else billed):
            cost, source = 0.0, "none"  # OpenRouter does not bill a failed request
        elif cost is None:
            cost, source = estimate_usd(load_rates(), operation, usage), "estimate"
        else:
            source = "openrouter"
        with engine.begin() as conn:
            conn.execute(ad_ai_usage.insert().values(
                job_id=ctx["job_id"], job_kind=ctx["kind"], operation=operation, model=model,
                event_id=ctx["event_id"], title=(ctx["title"] or "")[:300],
                prompt_tokens=usage.get("prompt_tokens") or 0, completion_tokens=usage.get("completion_tokens") or 0,
                images=usage.get("images") or 0, cost_usd=float(cost), cost_source=source, ok=1 if ok else 0,
                latency_ms=latency_ms, created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
            ))
    except Exception as exc:  # noqa: BLE001  (metering must never fail an agent)
        logger.warning("[Ad metering] Could not record %s: %s", operation, exc)


def post(operation: str, url: str, *, json: Dict[str, Any], **kwargs: Any) -> httpx.Response:
    """``httpx.post`` to OpenRouter that also records the request's usage and cost."""
    body = {**json, "usage": {"include": True}}  # OpenRouter usage accounting: the response carries the cost
    started = time.monotonic()
    res: Optional[httpx.Response] = None
    try:
        res = httpx.post(url, json=body, **kwargs)
        return res
    finally:
        billed = res is not None and res.status_code == 200
        usage = _usage(res)
        ok = billed and (operation != "draw" or bool(usage.get("images")))  # a draw with no poster is a failure
        record(operation, str(json.get("model") or ""), usage, ok, int((time.monotonic() - started) * 1000), billed)
