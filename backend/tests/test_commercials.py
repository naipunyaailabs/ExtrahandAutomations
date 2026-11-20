"""Commercials page: usage and cost of the IVR line and the Sarvam voice stack."""

import json
from datetime import timedelta

import pytest

from app.models import BulkCallCampaign, BulkCallItem, UsageEvent, utcnow
from tests.factories import make_attempt, make_ticket

RATES = {
    "vobiz_per_min": 1.0, "vobiz_pulse_seconds": 60, "handoff_leg_per_min": 0.5, "sarvam_stt_per_hour": 60.0,
    "sarvam_tts_per_10k_chars": 20.0, "agent_tts_chars_per_min": 500, "llm_per_min": 0.1, "livekit_per_min": 0.2,
    "monthly_budget": 1000.0,
}


def _trail(connected_at):
    stamp = connected_at.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return json.dumps([{"t": stamp, "event": "handoff_started"}, {"t": stamp, "event": "handoff_connected"}])


@pytest.fixture
def seeded(db, client):
    assert client.put("/api/commercials/rates", json=RATES).status_code == 200
    now = utcnow()
    t = make_ticket(db)
    # 61 s IVR call -> 2 billed minutes; Maya on it for the last 60 s
    make_attempt(db, t, "dispatch", provider="vobiz", status="ended", outcome="accepted", duration_seconds=61,
                 answered_at=now - timedelta(seconds=61), ended_at=now, timeline=_trail(now - timedelta(seconds=60)),
                 created_at=now - timedelta(seconds=70))
    make_attempt(db, t, "followup", provider="vobiz", status="ended", outcome="no_answer", duration_seconds=0,
                 created_at=now - timedelta(minutes=1))
    make_attempt(db, t, "dispatch", provider="simulator", status="ended", outcome="accepted", duration_seconds=30)
    camp = BulkCallCampaign(title="c", script="s")
    db.add(camp)
    db.flush()
    db.add(BulkCallItem(campaign_id=camp.id, phone="+91900", status="completed", call_id="u1", duration_seconds=30,
                        called_at=now - timedelta(minutes=1)))
    db.add(UsageEvent(service="sarvam_tts", source="ivr", units=5000, created_at=now - timedelta(minutes=1)))
    db.commit()


def test_summary_costs_each_line_from_the_rate_card(client, seeded):
    body = client.get("/api/commercials/summary").json()
    p = body["periods"]["all"]
    assert p["calls"] == 3 and p["connected"] == 2 and p["test_calls"] == 1
    assert p["ivr"]["billed_minutes"] == 3  # 2 for the 61 s call + 1 for the 30 s bulk call
    assert p["ivr"]["call_cost"] == 3.0
    assert p["ivr"]["handoff_leg_cost"] == 0.5
    assert p["sarvam"]["handoffs"] == 1 and p["sarvam"]["agent_minutes"] == 1
    assert p["sarvam"]["stt_cost"] == 1.0          # 1 min at 60/h
    assert p["sarvam"]["agent_tts_cost"] == 1.0    # 500 chars at 20/10K
    assert p["sarvam"]["ivr_tts_cost"] == 10.0     # 5000 chars at 20/10K
    assert p["agent_infra"]["cost"] == 0.3
    assert p["total_cost"] == 15.8
    dispatch = next(x for x in p["by_purpose"] if x["purpose"] == "dispatch")
    assert dispatch["wins"] == 1 and dispatch["cost_per_win"] == dispatch["cost"]
    assert body["periods"]["today"]["total_cost"] == 15.8
    assert len(body["daily"]) == 30 and len(body["monthly"]) == 6
    assert body["projection"]["budget"] == 1000.0


def test_rates_reject_negative_prices(client, db):
    assert client.put("/api/commercials/rates", json={**RATES, "vobiz_per_min": -1}).status_code == 422
    assert client.get("/api/commercials/rates").json()["vobiz_per_min"] == 0.5  # default kept
