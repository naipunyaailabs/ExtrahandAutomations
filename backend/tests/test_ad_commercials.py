"""Advertisement Commercials: metering of the Advertisement Agent's OpenRouter requests and the cost report."""

import httpx
import pytest
from sqlalchemy import delete

from marketing import commercials, metering
from marketing.database import ad_ai_usage, engine, init_advestiment_db


@pytest.fixture
def openrouter(monkeypatch, db):
    """OpenRouter answers from a queue; the request bodies are kept."""
    init_advestiment_db()
    with engine.begin() as conn:
        conn.execute(delete(ad_ai_usage))
    queue, sent = [], []

    def fake_post(url, json=None, **kw):
        sent.append(json)
        status, body = queue.pop(0)
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(metering.httpx, "post", fake_post)
    return queue, sent


def _text(cost=None, tin=1000, tout=500):
    usage = {"prompt_tokens": tin, "completion_tokens": tout, **({"cost": cost} if cost is not None else {})}
    return 200, {"choices": [{"message": {"content": "{}"}}], "usage": usage}


def _image(cost=0.04):
    return 200, {"choices": [{"message": {"images": [{"image_url": {"url": "data:image/png;base64,AA=="}}]}}],
                 "usage": {"prompt_tokens": 300, "completion_tokens": 0, "cost": cost}}


def _post(op, model="m"):
    return metering.post(op, "https://openrouter.test/v1", json={"model": model, "messages": []})


def test_poster_job_groups_its_steps_and_uses_reported_cost(openrouter):
    queue, sent = openrouter
    queue += [_text(cost=0.001), _text(cost=0.002), (200, {"choices": [{"message": {}}], "usage": {"cost": 0.0}}),
              _text(cost=0.0005), _image(cost=0.04), _text(cost=0.0005)]
    with metering.job("poster", "ev-1", "Diwali"):
        with metering.job("research", "ev-1", "Diwali"):  # nested: stays in the poster job
            _post("research")
        _post("brief")
        _post("draw")  # answered without a poster: a failed draw
        _post("check")
        _post("draw")
        _post("check")
    assert all(body["usage"] == {"include": True} for body in sent)  # cost reporting is asked for

    rep = commercials.report()
    fx = rep["rates"]["usd_to_inr"]
    assert rep["periods"]["all"]["posters"] == 1 and rep["periods"]["all"]["requests"] == 6
    assert rep["periods"]["all"]["by_operation"]["draw"]["failed"] == 1
    job = rep["recent"][0]
    assert job["kind"] == "poster" and job["title"] == "Diwali" and job["draws"] == 2
    assert set(job["steps"]) == {"research", "brief", "draw", "check"}
    assert job["cost"] == pytest.approx(round(0.044 * fx, 2), abs=0.01)
    assert rep["unit"]["recipe_source"] == "measured" and rep["unit"]["first_try_rate"] == 0
    assert rep["unit"]["per_poster"] == pytest.approx(0.044 * fx, abs=0.02)


def test_missing_cost_is_estimated_and_refused_requests_cost_nothing(openrouter):
    queue, _ = openrouter
    queue += [_text(cost=None, tin=1_000_000, tout=0), (500, {"error": "down"})]
    with metering.job("scan", title="Festival scan"):
        _post("scan")
        _post("scan")
    rep = commercials.report()
    rates = rep["rates"]
    scan = rep["periods"]["all"]["by_operation"]["scan"]
    assert scan["requests"] == 2 and scan["failed"] == 1
    assert scan["cost"] == pytest.approx(rates["text_in_per_m"] * rates["usd_to_inr"], abs=0.01)
    assert rep["periods"]["all"]["reported_share"] == 0
    assert rep["unit"]["scans_measured"] == 1 and rep["unit"]["recipe_source"] == "estimate"


def test_report_without_usage_gives_rate_card_estimates(openrouter):
    rep = commercials.report()
    assert rep["periods"]["all"]["cost"] == 0 and rep["recent"] == []
    assert rep["unit"]["per_poster"] > 0 and rep["unit"]["per_scan"] > 0
    assert len(rep["daily"]) == 30


def test_rates_can_be_saved(openrouter, client):
    body = {**commercials.AdRates().model_dump(), "image_usd": 0.05, "usd_to_inr": 90}
    assert client.put("/api/advestiment/commercials/rates", json=body).status_code == 200
    rep = client.get("/api/advestiment/commercials").json()
    assert rep["rates"]["image_usd"] == 0.05 and rep["rates_customized"] is True


def test_festival_ledger_counts_versions_and_prices_unmetered_posters(openrouter):
    import json as _json
    from datetime import date, timedelta

    from marketing.database import ad_events

    soon = (date.today() + timedelta(days=1)).isoformat()
    past = (date.today() - timedelta(days=2)).isoformat()
    with engine.begin() as conn:
        conn.execute(delete(ad_events))
        conn.execute(ad_events.insert(), [
            {"id": "ev-a", "city": "All-India", "title": "Diwali", "date_start": soon, "date_end": soon, "discount_code": "D",
             "promo_template": "", "status": "Approved", "poster_url": "/p/a", "poster_theme": _json.dumps({"variant": 3})},
            {"id": "ev-b", "city": "All-India", "title": "Kids Day", "date_start": soon, "date_end": soon, "discount_code": "K",
             "promo_template": "", "status": "Pending Review", "poster_url": "", "poster_theme": ""},
            {"id": "ev-c", "city": "All-India", "title": "Old Puja", "date_start": past, "date_end": past, "discount_code": "O",
             "promo_template": "", "status": "Pending Review", "poster_url": "", "poster_theme": ""},
        ])
    queue, _ = openrouter
    queue += [_image(cost=0.05)]
    with metering.job("poster", "ev-a", "Diwali"):
        _post("draw")  # the 3rd version was measured; versions 1-2 were drawn before metering

    rep = commercials.report()
    f = rep["festivals"]
    assert (f["found"], f["approved"], f["pending"], f["with_poster"], f["versions"]) == (3, 1, 2, 1, 3)
    diwali = next(x for x in f["items"] if x["id"] == "ev-a")
    assert diwali["unmetered"] == 2
    assert diwali["estimated_cost"] == pytest.approx(2 * rep["unit"]["per_poster"], abs=0.02)
    assert diwali["measured_cost"] == pytest.approx(0.05 * rep["rates"]["usd_to_inr"], abs=0.01)
    assert [x["title"] for x in f["soon_pending"]] == ["Kids Day"]
    assert [x["title"] for x in f["past_pending"]] == ["Old Puja"]
