"""Commercials: what the Calling Agent costs. Usage and spend of the IVR line (Vobiz) and of the Sarvam voice stack
(Telugu IVR audio plus the live hand-off agent), for today, this week, this month and all time.

Usage comes from the database: every call attempt (status, duration, hand-off trail), bulk-calling items and the
metered Sarvam text-to-speech characters (`usage_events`). Money is usage x the rate card, which the team edits on the
page (stored in `app_settings`) because provider prices differ by contract. Calls made by the simulator cost nothing
and are reported separately as test calls.
"""

from __future__ import annotations

import json
import math
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AppSetting, BulkCallCampaign, BulkCallItem, CallAttempt, UsageEvent

router = APIRouter(prefix="/api/commercials", tags=["commercials"])

IST = timezone(timedelta(hours=5, minutes=30))  # periods (today, this week, ...) follow the team's clock
RATES_KEY = "commercials_rates"
LIVE_PROVIDERS = ("vobiz", "twilio")
AGENT_CAP_SECONDS = 600  # a hand-off whose end was never recorded is not billed for hours


class Rates(BaseModel):
    """Rate card in INR. Defaults are list-price estimates: replace them with the rates on your invoices."""

    vobiz_per_min: float = Field(0.50, ge=0, description="IVR line: outbound call, per billed minute")
    vobiz_pulse_seconds: int = Field(60, ge=1, le=60, description="Billing pulse: calls are rounded up to this")
    handoff_leg_per_min: float = Field(0.50, ge=0, description="Bridged leg from Vobiz to the voice agent (SIP)")
    sarvam_stt_per_hour: float = Field(30.0, ge=0, description="Sarvam speech-to-text (Saaras v3), per hour of audio")
    sarvam_tts_per_10k_chars: float = Field(30.0, ge=0, description="Sarvam text-to-speech (Bulbul v3), per 10K chars")
    agent_tts_chars_per_min: int = Field(450, ge=0, description="Characters Maya speaks per minute of a hand-off")
    llm_per_min: float = Field(0.15, ge=0, description="LLM (Gemini 2.5 Flash via OpenRouter), per agent minute")
    livekit_per_min: float = Field(0.85, ge=0, description="LiveKit Cloud agent session, per agent minute")
    monthly_budget: float = Field(10000.0, ge=0, description="Monthly spend budget for the Calling Agent")
    automation_budget: float = Field(10000.0, ge=0, description="Monthly budget for IVR automation calls")
    bulk_budget: float = Field(5000.0, ge=0, description="Monthly budget for bulk calling campaigns")


def _rates(db: Session) -> Rates:
    row = db.get(AppSetting, RATES_KEY)
    if row:
        try:
            data = json.loads(row.value)
            if "automation_budget" not in data and "monthly_budget" in data:
                data["automation_budget"] = data["monthly_budget"]
            return Rates(**data)
        except (ValueError, TypeError):
            pass
    return Rates()


@router.get("/rates")
def get_rates(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _rates(db).model_dump()


@router.put("/rates")
def put_rates(body: Rates, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(AppSetting, RATES_KEY) or AppSetting(key=RATES_KEY)
    row.value = body.model_dump_json()
    db.add(row)
    db.commit()
    return body.model_dump()


# --------------------------------------------------------------------------------------------- usage lines


@dataclass
class Line:
    """One billable (or test) use, with when it happened (UTC, naive like the database) and what it cost."""

    t: datetime
    kind: str  # ivr | bulk | tts | test
    purpose: str = ""
    connected: bool = False
    talk_sec: int = 0
    billed_sec: int = 0
    handoff: bool = False
    agent_sec: int = 0
    tts_chars: int = 0
    outcome: str = ""
    cost: dict[str, float] = field(default_factory=dict)  # vobiz | handoff_leg | sarvam_stt | sarvam_tts_agent | sarvam_tts_ivr | llm | livekit

    @property
    def total(self) -> float:
        return sum(self.cost.values())


def _parse_t(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _agent_seconds(a: CallAttempt) -> tuple[bool, int]:
    """Whether the call reached the voice agent, and for how long Maya was on it."""
    try:
        trail = json.loads(a.timeline) if a.timeline else []
    except ValueError:
        trail = []
    connected_at = None
    started = False
    for item in trail if isinstance(trail, list) else []:
        ev = item.get("event") if isinstance(item, dict) else None
        if ev == "handoff_started":
            started = True
        elif ev == "handoff_connected" and connected_at is None:
            connected_at = _parse_t(item.get("t"))
    if connected_at is None:
        return (started or bool(a.handoff_json)), 0
    end = a.ended_at
    if end is None or end < connected_at:
        return True, 0
    return True, min(int((end - connected_at).total_seconds()), AGENT_CAP_SECONDS)


def _billed(seconds: int, pulse: int) -> int:
    return math.ceil(seconds / pulse) * pulse if seconds > 0 else 0


def _lines(db: Session, r: Rates) -> list[Line]:
    out: list[Line] = []
    cols = (CallAttempt.created_at, CallAttempt.provider, CallAttempt.purpose, CallAttempt.answered_at,
            CallAttempt.duration_seconds, CallAttempt.outcome, CallAttempt.timeline, CallAttempt.handoff_json,
            CallAttempt.ended_at)
    for a in db.query(CallAttempt).with_entities(*cols).all():
        if a.provider not in LIVE_PROVIDERS:
            out.append(Line(t=a.created_at, kind="test", purpose=a.purpose or "other", outcome=a.outcome or ""))
            continue
        talk = int(a.duration_seconds or 0)
        billed = _billed(talk, r.vobiz_pulse_seconds)
        handoff, agent_sec = _agent_seconds(a)
        agent_min = agent_sec / 60
        line = Line(t=a.created_at, kind="ivr", purpose=a.purpose or "other",
                    connected=a.answered_at is not None or talk > 0, talk_sec=talk, billed_sec=billed,
                    handoff=handoff, agent_sec=agent_sec, outcome=a.outcome or "")
        line.cost["vobiz"] = billed / 60 * r.vobiz_per_min
        if agent_sec:
            line.cost["handoff_leg"] = _billed(agent_sec, r.vobiz_pulse_seconds) / 60 * r.handoff_leg_per_min
            line.cost["sarvam_stt"] = agent_sec / 3600 * r.sarvam_stt_per_hour
            line.cost["sarvam_tts_agent"] = agent_min * r.agent_tts_chars_per_min / 10000 * r.sarvam_tts_per_10k_chars
            line.cost["llm"] = agent_min * r.llm_per_min
            line.cost["livekit"] = agent_min * r.livekit_per_min
        out.append(line)

    for b in db.query(BulkCallItem).with_entities(BulkCallItem.called_at, BulkCallItem.created_at, BulkCallItem.call_id,
                                                   BulkCallItem.status, BulkCallItem.duration_seconds).all():
        t = b.called_at or b.created_at
        if b.status in ("pending", "calling") or t is None:
            continue
        if not b.call_id:  # simulated bulk call
            out.append(Line(t=t, kind="test", purpose="bulk"))
            continue
        talk = int(b.duration_seconds or 0)
        billed = _billed(talk, r.vobiz_pulse_seconds)
        line = Line(t=t, kind="bulk", purpose="bulk", connected=b.status == "completed" and talk > 0,
                    talk_sec=talk, billed_sec=billed)
        line.cost["vobiz"] = billed / 60 * r.vobiz_per_min
        out.append(line)

    for u in db.query(UsageEvent).filter(UsageEvent.service == "sarvam_tts").all():
        line = Line(t=u.created_at, kind="tts", purpose=u.source, tts_chars=int(u.units or 0))
        line.cost["sarvam_tts_ivr"] = line.tts_chars / 10000 * r.sarvam_tts_per_10k_chars
        out.append(line)
    return out


# --------------------------------------------------------------------------------------------- aggregation

SARVAM_KEYS = ("sarvam_stt", "sarvam_tts_agent", "sarvam_tts_ivr")
IVR_KEYS = ("vobiz", "handoff_leg")
AGENT_INFRA_KEYS = ("llm", "livekit")
WIN_OUTCOMES = {"dispatch": ("accepted",), "followup": ("confirmed",), "feedback": ("rated",)}


def _r(x: float) -> float:
    return round(x, 2)


def _summarize(lines: list[Line]) -> dict[str, Any]:
    cost: dict[str, float] = defaultdict(float)
    for ln in lines:
        for k, v in ln.cost.items():
            cost[k] += v
    calls = [ln for ln in lines if ln.kind in ("ivr", "bulk")]
    ivr = [ln for ln in calls if ln.kind == "ivr"]
    bulk = [ln for ln in calls if ln.kind == "bulk"]
    tts = [ln for ln in lines if ln.kind == "tts"]
    handoffs = [ln for ln in ivr if ln.handoff]
    connected = sum(ln.connected for ln in calls)
    agent_sec = sum(ln.agent_sec for ln in handoffs)
    total = sum(cost.values())
    sarvam = sum(cost[k] for k in SARVAM_KEYS)
    ivr_cost = sum(cost[k] for k in IVR_KEYS)

    purposes: dict[str, dict[str, Any]] = {}
    for ln in calls:
        p = purposes.setdefault(ln.purpose, {"purpose": ln.purpose, "calls": 0, "connected": 0, "billed_minutes": 0.0,
                                             "handoffs": 0, "wins": 0, "cost": 0.0})
        p["calls"] += 1
        p["connected"] += ln.connected
        p["billed_minutes"] += ln.billed_sec / 60
        p["handoffs"] += ln.handoff
        p["wins"] += ln.outcome in WIN_OUTCOMES.get(ln.purpose, ())
        p["cost"] += ln.total
    for p in purposes.values():
        p["billed_minutes"] = _r(p["billed_minutes"])
        p["cost"] = _r(p["cost"])
        p["cost_per_call"] = _r(p["cost"] / p["calls"]) if p["calls"] else 0
        p["cost_per_win"] = _r(p["cost"] / p["wins"]) if p["wins"] else None

    tts_by_source: dict[str, int] = defaultdict(int)
    for ln in tts:
        tts_by_source[ln.purpose] += ln.tts_chars

    return {
        "total_cost": _r(total),
        "calls": len(calls),
        "connected": connected,
        "connect_rate": round(connected / len(calls) * 100, 1) if calls else 0,
        "test_calls": sum(ln.kind == "test" for ln in lines),
        "cost_per_call": _r(total / len(calls)) if calls else 0,
        "cost_per_connected": _r(total / connected) if connected else 0,
        "cost_per_minute": _r(total / (sum(ln.talk_sec for ln in calls) / 60)) if any(ln.talk_sec for ln in calls) else 0,
        "ivr": {
            "calls": len(ivr),
            "bulk_calls": len(bulk),
            "connected": connected,
            "talk_minutes": _r(sum(ln.talk_sec for ln in calls) / 60),
            "billed_minutes": _r(sum(ln.billed_sec for ln in calls) / 60),
            "avg_call_seconds": round(sum(ln.talk_sec for ln in calls) / connected) if connected else 0,
            "handoff_leg_cost": _r(cost["handoff_leg"]),
            "call_cost": _r(cost["vobiz"]),
            "cost": _r(ivr_cost),
        },
        "sarvam": {
            "handoffs": len(handoffs),
            "handoffs_connected": sum(1 for ln in handoffs if ln.agent_sec > 0),
            "agent_minutes": _r(agent_sec / 60),
            "avg_handoff_seconds": round(agent_sec / max(1, sum(1 for ln in handoffs if ln.agent_sec > 0))),
            "stt_cost": _r(cost["sarvam_stt"]),
            "agent_tts_cost": _r(cost["sarvam_tts_agent"]),
            "ivr_tts_chars": sum(ln.tts_chars for ln in tts),
            "ivr_tts_requests": len(tts),
            "ivr_tts_by_source": dict(tts_by_source),
            "ivr_tts_cost": _r(cost["sarvam_tts_ivr"]),
            "cost": _r(sarvam),
        },
        "agent_infra": {"llm_cost": _r(cost["llm"]), "livekit_cost": _r(cost["livekit"]),
                        "cost": _r(sum(cost[k] for k in AGENT_INFRA_KEYS))},
        "breakdown": [
            {"key": "vobiz", "label": "Vobiz call minutes", "group": "ivr", "cost": _r(cost["vobiz"])},
            {"key": "handoff_leg", "label": "Vobiz hand-off leg", "group": "ivr", "cost": _r(cost["handoff_leg"])},
            {"key": "sarvam_tts_ivr", "label": "Sarvam TTS (IVR audio)", "group": "sarvam", "cost": _r(cost["sarvam_tts_ivr"])},
            {"key": "sarvam_stt", "label": "Sarvam STT (agent)", "group": "sarvam", "cost": _r(cost["sarvam_stt"])},
            {"key": "sarvam_tts_agent", "label": "Sarvam TTS (agent)", "group": "sarvam", "cost": _r(cost["sarvam_tts_agent"])},
            {"key": "llm", "label": "LLM (Gemini Flash)", "group": "infra", "cost": _r(cost["llm"])},
            {"key": "livekit", "label": "LiveKit agent", "group": "infra", "cost": _r(cost["livekit"])},
        ],
        "by_purpose": sorted(purposes.values(), key=lambda p: -p["cost"]),
    }


def _ist_midnight(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _to_utc(d: datetime) -> datetime:
    return d.astimezone(timezone.utc).replace(tzinfo=None)


def _within(lines: list[Line], start: datetime | None, end: datetime | None = None) -> list[Line]:
    return [ln for ln in lines if (start is None or ln.t >= start) and (end is None or ln.t < end)]


def _bucket(lines: list[Line]) -> dict[str, float]:
    cost: dict[str, float] = defaultdict(float)
    calls = 0
    for ln in lines:
        calls += ln.kind in ("ivr", "bulk")
        for k, v in ln.cost.items():
            cost[k] += v
    return {"ivr": _r(sum(cost[k] for k in IVR_KEYS)), "sarvam": _r(sum(cost[k] for k in SARVAM_KEYS)),
            "infra": _r(sum(cost[k] for k in AGENT_INFRA_KEYS)), "calls": calls}


def _build_commercial_report(db: Session, mode: str = "all") -> dict[str, Any]:
    r = _rates(db)
    all_lines = _lines(db, r)
    if mode == "automation":
        lines = [ln for ln in all_lines if ln.kind in ("ivr", "tts") or (ln.kind == "test" and ln.purpose != "bulk")]
        budget = r.automation_budget or r.monthly_budget
    elif mode == "bulk":
        lines = [ln for ln in all_lines if ln.kind == "bulk" or (ln.kind == "test" and ln.purpose == "bulk")]
        budget = r.bulk_budget or (r.monthly_budget * 0.5)
    else:
        lines = all_lines
        budget = r.monthly_budget

    now = datetime.now(IST)
    today = _ist_midnight(now)
    week = today - timedelta(days=today.weekday())  # Monday
    month = today.replace(day=1)
    prev_month = (month - timedelta(days=1)).replace(day=1)

    periods = {
        "today": _summarize(_within(lines, _to_utc(today))),
        "week": _summarize(_within(lines, _to_utc(week))),
        "month": _summarize(_within(lines, _to_utc(month))),
        "all": _summarize(lines),
    }
    previous = {
        "today": _summarize(_within(lines, _to_utc(today - timedelta(days=1)), _to_utc(today)))["total_cost"],
        "week": _summarize(_within(lines, _to_utc(week - timedelta(days=7)), _to_utc(week)))["total_cost"],
        "month": _summarize(_within(lines, _to_utc(prev_month), _to_utc(month)))["total_cost"],
    }

    daily = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        daily.append({"date": d.strftime("%Y-%m-%d"), **_bucket(_within(lines, _to_utc(d), _to_utc(d + timedelta(days=1))))})

    monthly = []
    m = month
    starts = []
    for _ in range(6):
        starts.append(m)
        m = (m - timedelta(days=1)).replace(day=1)
    for start in reversed(starts):
        end = (start + timedelta(days=monthrange(start.year, start.month)[1]))
        monthly.append({"month": start.strftime("%Y-%m"), **_bucket(_within(lines, _to_utc(start), _to_utc(end)))})

    days_in_month = monthrange(now.year, now.month)[1]
    elapsed = (now - month).total_seconds() / 86400
    month_cost = periods["month"]["total_cost"]
    projected = _r(month_cost / elapsed * days_in_month) if elapsed > 0.25 else month_cost

    s = get_settings()
    res: dict[str, Any] = {
        "source": mode,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "currency": "INR",
        "timezone": "Asia/Kolkata",
        "provider": s.telephony_provider,
        "stack": {
            "telephony": "Vobiz" if s.telephony_provider == "vobiz" else s.telephony_provider.title(),
            "ivr_voice": f"Sarvam {s.sarvam_tts_model} ({s.sarvam_tts_speaker}, {s.sarvam_tts_language})",
            "agent": "Sarvam Saaras v3 STT + Gemini 2.5 Flash + Sarvam Bulbul v3 TTS on LiveKit",
            "handoff_enabled": bool(s.handoff_sip_uri and s.handoff_secret),
            "tts_metered_since": _first_meter(db),
        },
        "periods": periods,
        "previous": previous,
        "daily": daily,
        "monthly": monthly,
        "projection": {
            "month_to_date": month_cost,
            "projected_month": projected,
            "budget": budget,
            "budget_used_pct": round(month_cost / budget * 100, 1) if budget else None,
            "projected_budget_pct": round(projected / budget * 100, 1) if budget else None,
            "days_elapsed": round(elapsed, 1),
            "days_in_month": days_in_month,
        },
        "rates": r.model_dump(),
        "rates_customized": db.get(AppSetting, RATES_KEY) is not None,
    }

    if mode == "bulk":
        campaigns = []
        camps = db.query(BulkCallCampaign).order_by(BulkCallCampaign.created_at.desc()).limit(50).all()
        camp_items = defaultdict(list)
        for it in db.query(BulkCallItem).all():
            camp_items[it.campaign_id].append(it)
        for c in camps:
            items = camp_items.get(c.id, [])
            talk_sec = sum(int(it.duration_seconds or 0) for it in items)
            billed_sec = sum(_billed(int(it.duration_seconds or 0), r.vobiz_pulse_seconds) for it in items if it.call_id)
            completed = sum(1 for it in items if it.status == "completed")
            failed = sum(1 for it in items if it.status in ("failed", "busy", "no_answer"))
            cost = _r((billed_sec / 60) * r.vobiz_per_min)
            total_ct = c.total_contacts or len(items)
            connect_rate = round((completed / total_ct) * 100, 1) if total_ct else 0.0
            campaigns.append({
                "id": c.id,
                "title": c.title,
                "script": c.script,
                "language": c.language,
                "status": c.status,
                "total_contacts": total_ct,
                "completed_calls": completed,
                "failed_calls": failed,
                "duration_seconds": talk_sec,
                "billed_minutes": _r(billed_sec / 60),
                "cost": cost,
                "connect_rate": connect_rate,
                "cost_per_contact": _r(cost / total_ct) if total_ct else 0.0,
                "cost_per_connected": _r(cost / completed) if completed else 0.0,
                "created_at": c.created_at.isoformat() + "Z" if c.created_at else None,
                "started_at": c.started_at.isoformat() + "Z" if c.started_at else None,
                "finished_at": c.finished_at.isoformat() + "Z" if c.finished_at else None,
            })
        res["campaigns"] = campaigns

    return res


@router.get("/summary")
def summary(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _build_commercial_report(db, mode="all")


@router.get("/automation")
def automation_commercials(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _build_commercial_report(db, mode="automation")


@router.get("/bulk")
def bulk_commercials(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _build_commercial_report(db, mode="bulk")


def _first_meter(db: Session) -> str | None:
    first = db.query(UsageEvent.created_at).order_by(UsageEvent.created_at).first()
    return first[0].isoformat() + "Z" if first else None
