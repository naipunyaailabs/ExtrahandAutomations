"""All-India festival finder agent (started with the "Find Festivals" button on the All-India calendar).

For the current month and the next two, the agent (GPT-OSS-20B, FESTIVAL_MODEL, through OpenRouter) uses its
open_website tool to visit Drik Panchang (the month's festival list and the year's Indian calendar) and,
when FESTIVAL_VERIFY_URL is set, IMD Rashtriya Panchang. It reads the festival names and dates from those
pages, picks the major Indian festivals and important events, and writes a description and coupon code.
A festival is kept only if its name and date are really written on a Drik Panchang page the agent opened.
Every festival is saved as "Pending Review": an admin approves it (then its poster is designed) or rejects
it. Only approved festivals are published.
"""
from __future__ import annotations

import html
import json
import logging
import re
import threading
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from app.branding import promo_message
from app.config import get_settings

from . import metering
from .agent.research_agent import research_festival
from .database import (
    db_get_event_by_id,
    db_get_last_festival_run,
    db_save_festival_run,
    db_save_or_update_event,
)

logger = logging.getLogger("marketing.festival_finder")

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
MAX_PAGE_CHARS = 16000   # text of one page handed to the agent
MAX_AGENT_STEPS = 8      # model turns per month
MODEL_NAME = "GPT-OSS-20B"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
}

_run_lock = threading.Lock()
_state: Dict[str, Any] = {"running": False, "step": "", "error": ""}


# ---------------------------------------------------------------------------
# Window and websites
# ---------------------------------------------------------------------------

def search_window(today: Optional[date] = None) -> List[Tuple[int, int]]:
    """(year, month) for the current month and the following months (FESTIVAL_SEARCH_MONTHS in total)."""
    d = today or date.today()
    out = []
    for i in range(max(1, get_settings().festival_search_months)):
        m = d.month - 1 + i
        out.append((d.year + m // 12, m % 12 + 1))
    return out


def source_urls(year: int, month: int) -> List[str]:
    """The Drik Panchang pages the agent is told to open for a month."""
    st = get_settings()
    urls = [st.festival_source_url, st.festival_source_year_url]
    return [u.format(month_name=MONTHS[month - 1], year=year, month=month) for u in urls if u.strip()]


def _page_lines(raw_html: str) -> List[str]:
    text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw_html)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", text))
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def _allowed(url: str) -> bool:
    """The agent may only open Drik Panchang and the IMD Rashtriya Panchang page."""
    host = (urlparse(url).hostname or "").lower()
    hosts = {"www.drikpanchang.com", "drikpanchang.com"}
    verify = get_settings().festival_verify_url.strip()
    if verify:
        hosts.add((urlparse(verify).hostname or "").lower())
    return url.startswith("https://") and host in hosts


def open_website(url: str, opened: Dict[str, str]) -> str:
    """The agent's tool: the readable text of a web page."""
    if not _allowed(url):
        return "Not allowed: only Drik Panchang and the IMD Rashtriya Panchang page can be opened."
    if url not in opened:
        try:
            res = httpx.get(url, headers=_HEADERS, timeout=30, follow_redirects=True)
            res.raise_for_status()
            opened[url] = "\n".join(_page_lines(res.text))
        except Exception as exc:  # noqa: BLE001
            return f"Could not open {url}: {exc}"
    return opened[url][:MAX_PAGE_CHARS]


# ---------------------------------------------------------------------------
# The agent: GPT-OSS-20B opens the websites and reads the festivals and dates itself
# ---------------------------------------------------------------------------

_TOOLS = [{
    "type": "function",
    "function": {
        "name": "open_website",
        "description": "Open a web page and return its text (Drik Panchang or IMD Rashtriya Panchang only).",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "Full https URL of the page"}},
            "required": ["url"],
        },
    },
}]


def llm_ready() -> bool:
    return bool(get_settings().openrouter_api_key.strip())


def _chat(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """One chat turn with GPT-OSS-20B (FESTIVAL_MODEL) through OpenRouter; returns the assistant message."""
    st = get_settings()
    key = st.openrouter_api_key.strip()
    if not key:
        raise RuntimeError("Set OPENROUTER_API_KEY in backend/.env to use the festival finder.")
    res = metering.post(
        "scan", st.openrouter_api_url,
        headers={"Authorization": f"Bearer {key}", "HTTP-Referer": st.website_url, "X-Title": "ExtraHand Festival Finder"},
        json={
            "model": st.festival_model,
            "messages": messages,
            "tools": _TOOLS,
            "tool_choice": "auto",
            "reasoning": {"effort": "medium"},
            "temperature": 0.2,
        },
        timeout=st.festival_llm_timeout_seconds,
    )
    if res.status_code != 200:
        raise RuntimeError(f"{MODEL_NAME} returned {res.status_code}: {res.text[:200]}")
    return res.json()["choices"][0]["message"]


def run_agent(year: int, month: int, opened: Dict[str, str], chat=_chat) -> List[Dict[str, Any]]:
    """The agent opens the websites for one month, reads the festivals and dates, and picks the major ones."""
    st = get_settings()
    label = f"{MONTHS[month - 1].title()} {year}"
    verify = st.festival_verify_url.strip()
    task = (
        f"Find the major Indian festivals and important national events in {label}.\n"
        "Use the open_website tool to open these Drik Panchang pages and read the festival names and dates from them:\n"
        + "\n".join(f"- {u}" for u in source_urls(year, month))
        + (f"\nThen open the IMD Rashtriya Panchang page {verify} and check each festival there." if verify else "")
        + f"\n\nPick at most {st.festival_max_per_month} festivals that are celebrated widely across India and are worth a "
        "customer promotion (for example Diwali, Holi, Ganesh Chaturthi, Christmas, Eid, Republic Day). Skip minor vrats, "
        "monthly observances, astronomy events and regional-only days. If two entries are the same celebration on the "
        "same day, pick only the main one. Use only festivals and dates that are written on the pages; do not guess. "
        f"Only dates in {label}.\n"
        "When you are done, reply with JSON only:\n"
        '{"festivals": [{"page_name": "name exactly as written on the page", "title": "clean festival name", '
        '"date": "YYYY-MM-DD", "tithi": "tithi or detail line from the page, if any", "source_url": "page you read it on", '
        '"imd_confirmed": false, "description": "one or two sentences about the festival and a home-service offer", '
        '"coupon_code": "UPPERCASE letters + discount number, e.g. DIWALI25", "importance": 90, "reason": "why it is major"}]}'
    )
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": "You are the festival research agent of an Indian home-services company. "
                                      "You read websites with the open_website tool and answer in JSON."},
        {"role": "user", "content": task},
    ]
    for _ in range(MAX_AGENT_STEPS):
        msg = chat(messages)
        calls = msg.get("tool_calls") or []
        if not calls:
            match = re.search(r"\{.*\}", msg.get("content") or "", re.S)
            if not match:
                raise RuntimeError("The agent did not return a festival list.")
            return _checked(json.loads(match.group(0)), year, month, opened)
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for call in calls:
            try:
                url = str(json.loads(call["function"].get("arguments") or "{}").get("url") or "")
            except (ValueError, TypeError, AttributeError):
                url = ""
            _state["step"] = f"Agent reading {urlparse(url).hostname or 'a page'} · {label}"
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": open_website(url, opened)})
    raise RuntimeError("The agent did not finish within the step limit.")


def _checked(data: Dict[str, Any], year: int, month: int, opened: Dict[str, str]) -> List[Dict[str, Any]]:
    """Keep only festivals whose name and date are really written on a Drik Panchang page the agent opened."""
    st = get_settings()
    lines = [ln.lower() for u, t in opened.items() if "drikpanchang.com" in u for ln in t.split("\n")]

    def on_page(name: str, written: str) -> bool:
        """The name is written right next to the date (within two lines) on a Drik Panchang page."""
        n = name.lower()
        return any(written in ln and any(n in x for x in lines[max(0, i - 2): i + 3])
                   for i, ln in enumerate(lines))

    out: List[Dict[str, Any]] = []
    seen = set()
    for item in data.get("festivals") or []:
        if not isinstance(item, dict):
            continue
        try:
            d = datetime.strptime(str(item.get("date") or ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        name = str(item.get("page_name") or item.get("title") or "").strip()
        written = f"{MONTHS[d.month - 1]} {d.day}, {d.year}"
        if (d.year, d.month) != (year, month) or not name or not on_page(name, written):
            logger.info("[Festival Finder] Dropped %r on %s: not on the pages the agent opened", name, d)
            continue
        if (name.lower(), d) in seen:
            continue
        seen.add((name.lower(), d))
        src = str(item.get("source_url") or "")
        try:
            importance = max(0, min(100, int(item.get("importance") or 80)))
        except (TypeError, ValueError):
            importance = 80
        out.append({
            "name": name[:160],
            "date": d.isoformat(),
            "tithi": str(item.get("tithi") or "").strip()[:80],
            "source_url": src if src in opened else source_urls(year, month)[0],
            "imd_confirmed": item.get("imd_confirmed") is True,
            "title": (str(item.get("title") or name).strip() or name)[:160],
            "description": str(item.get("description") or "").strip()[:600],
            "coupon_code": re.sub(r"[^A-Z0-9]", "", str(item.get("coupon_code") or "").upper())[:40],
            "importance": importance,
            "reason": str(item.get("reason") or "").strip()[:300],
        })
    return out[: st.festival_max_per_month]


# ---------------------------------------------------------------------------
# Saving
# ---------------------------------------------------------------------------

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "festival"


def _coupon(title: str, code: str) -> Tuple[str, int]:
    discount = get_settings().marketing_default_discount
    if not code:
        word = (re.findall(r"[A-Za-z]+", title.upper()) or ["FEST"])[0][:8]
        code = f"{word}{discount}"
    m = re.search(r"(\d{1,2})$", code)
    if m and 0 < int(m.group(1)) <= 90:
        discount = int(m.group(1))
    return code, discount


def save_pending(festival: Dict[str, Any], imd_checked: bool) -> bool:
    """Save one festival as Pending Review. Festivals already in the calendar (any status) are left alone."""
    event_id = f"ind-dp-{festival['date']}-{_slug(festival['name'])}"
    if db_get_event_by_id(event_id):
        return False
    code, discount = _coupon(festival["title"], festival["coupon_code"])
    if not imd_checked:
        verified, check = False, "IMD Rashtriya Panchang check not available"
    else:
        verified = festival["imd_confirmed"]
        check = "Confirmed in IMD Rashtriya Panchang" if verified else "Not found in IMD Rashtriya Panchang"
    db_save_or_update_event({
        "id": event_id,
        "city": "All-India",
        "title": festival["title"],
        "category": "Festival",
        "date_start": festival["date"],
        "date_end": festival["date"],
        "impact_level": "High",
        "target_services": [],
        "description": festival["description"],
        "demand_surge": "",
        "suggested_discount": discount,
        "discount_code": code,
        "promo_template": promo_message(festival["title"], "All-India", discount, [], code),
        "source": "drik_panchang",
        "status": "Pending Review",
        "importance_score": festival["importance"],
        "importance_reason": festival["reason"],
        "event_scope": "national",
        "source_url": festival["source_url"],
        "source_name": "Drik Panchang",
        "is_verified": verified,
        "confidence_score": 100 if verified else 80,
        "admin_notes": " · ".join(x for x in (festival.get("tithi"), check) if x),
        "discovery_date": date.today().isoformat(),
    })
    return True


# ---------------------------------------------------------------------------
# Run (background) and status
# ---------------------------------------------------------------------------

def run_finder(chat=_chat) -> Dict[str, Any]:
    """Let the agent search the window and save the major festivals it finds for approval."""
    window = search_window()
    period = f"{window[0][0]}-{window[0][1]:02d} to {window[-1][0]}-{window[-1][1]:02d}"
    with metering.job("scan", title=f"Festival scan {period}"):  # its requests are costed as one scan
        return _run_finder(window, period, chat)


def _run_finder(window, period: str, chat) -> Dict[str, Any]:
    st = get_settings()
    found = saved = 0
    errors: List[str] = []
    opened: Dict[str, str] = {}  # pages the agent opened (the year page is shared by the months)
    verify = st.festival_verify_url.strip()
    for year, month in window:
        label = f"{MONTHS[month - 1].title()} {year}"
        try:
            _state["step"] = f"Agent starting · {label}"
            picked = run_agent(year, month, opened, chat=chat)
            found += len(picked)
            imd_checked = bool(verify) and verify in opened
            for f in picked:
                if f["date"] < date.today().isoformat() or not save_pending(f, imd_checked):
                    continue
                saved += 1
                # Agent 1 also studies the festival and writes its poster prompt, ready for the admin and Agent 2
                _state["step"] = f"Agent 1 researching {f['title']} · {label}"
                ev = db_get_event_by_id(f"ind-dp-{f['date']}-{_slug(f['name'])}")
                if ev:
                    research_festival(ev)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Festival Finder] %s failed: %s", label, exc)
            errors.append(f"{label}: {exc}")
    status = "failed" if errors and not found else "success"
    summary = f"{found} major festivals found for {period}; {saved} new awaiting approval."
    if errors:
        summary += " Problems: " + "; ".join(errors)
    if not (verify and verify in opened):
        summary += " IMD Rashtriya Panchang check was not available."
    db_save_festival_run(period=period, status=status, found=found, saved=saved, summary=summary,
                         model=MODEL_NAME)
    return {"ok": status == "success", "found": found, "saved": saved, "summary": summary}


def start_finder() -> bool:
    """Start the agent in a background thread. False when it is already running."""
    if not _run_lock.acquire(blocking=False):
        return False

    def _run() -> None:
        model = MODEL_NAME
        _state.update(running=True, step="Starting", error="")
        try:
            run_finder()
        except Exception as exc:  # noqa: BLE001
            logger.exception("[Festival Finder] Run failed")
            _state["error"] = str(exc)
            db_save_festival_run(period="", status="failed", found=0, saved=0, summary=str(exc), model=model)
        finally:
            _state.update(running=False, step="")
            _run_lock.release()

    threading.Thread(target=_run, daemon=True, name="festival-finder").start()
    return True


def finder_status() -> Dict[str, Any]:
    st = get_settings()
    last = db_get_last_festival_run()
    next_due = None
    if last and last.get("status") == "success":
        ran = datetime.strptime(last["ran_at"][:10], "%Y-%m-%d").date()
        m = ran.month - 1 + st.festival_search_every_months
        next_due = date(ran.year + m // 12, m % 12 + 1, min(ran.day, 28)).isoformat()
    window = search_window()
    return {
        "configured": llm_ready(),
        "running": _state["running"],
        "step": _state["step"],
        "model": MODEL_NAME,
        "source": "Drik Panchang",
        "verify_source": "IMD Rashtriya Panchang" if st.festival_verify_url.strip() else "",
        "window": [f"{MONTHS[m - 1].title()} {y}" for y, m in window],
        "every_months": st.festival_search_every_months,
        "last_run": last,
        "next_due": next_due,
        "due": next_due is None or next_due <= date.today().isoformat(),
    }
