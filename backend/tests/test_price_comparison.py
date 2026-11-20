"""Competitive Pricing: our live prices per service compared with competitor prices typed in by the team."""

import pytest

from app.api import pricing


@pytest.fixture
def orders(monkeypatch):
    """Replace the live ExtraHand orders with a fixed list."""
    rows = []

    def fake_load_orders(db):
        return {"orders": rows, "source": "live", "fetched_at": 0}

    import user_engagement.service as svc

    monkeypatch.setattr(svc, "load_orders", fake_load_orders)
    return rows


def _order(title, budget, created):
    return {"title": title, "category": "AC Services", "budget": budget, "created_at": created}


def test_our_price_is_the_latest_booking_with_range(client, orders):
    orders += [_order("AC Repair", 249, "2026-10-01"), _order("AC Repair", 199, "2026-11-01"), _order("AC Repair", 0, "2026-11-02")]
    row = client.get("/api/pricing").json()["services"][0]
    assert (row["service"], row["works"], row["our_price"], row["min_price"], row["max_price"]) == ("AC Repair", 2, 199, 199, 249)
    assert row["position"] == "no_competitor"


def test_cheaper_same_and_costlier_against_the_cheapest_competitor(client, orders):
    orders += [_order("AC Repair", 200, "2026-11-01"), _order("Fan Install", 100, "2026-11-01"), _order("Tap Repair", 150, "2026-11-01")]
    for body in ({"service": "ac repair", "competitor": "Rival A", "price": 300},
                 {"service": "AC Repair", "competitor": "Rival B", "price": 250},
                 {"service": "Fan Install", "competitor": "Rival A", "price": 99},
                 {"service": "Tap Repair", "competitor": "Rival A", "price": 120}):
        assert client.post("/api/pricing/competitor-prices", json=body).status_code == 200
    data = client.get("/api/pricing").json()
    rows = {r["service"]: r for r in data["services"]}
    assert rows["AC Repair"]["cheapest_competitor"] == "Rival B" and rows["AC Repair"]["position"] == "cheaper"
    assert rows["AC Repair"]["gap_pct"] == -20.0
    assert rows["Fan Install"]["position"] == "same"
    assert rows["Tap Repair"]["position"] == "costlier" and rows["Tap Repair"]["gap"] == 30
    s = data["summary"]
    assert (s["compared"], s["cheaper"], s["same"], s["costlier"]) == (3, 1, 1, 1)
    assert s["competitors"] == ["Rival A", "Rival B"]


def test_saving_the_same_competitor_again_updates_its_price(client, orders):
    first = client.post("/api/pricing/competitor-prices", json={"service": "AC Repair", "competitor": "Rival", "price": 300}).json()
    again = client.post("/api/pricing/competitor-prices", json={"service": " ac  repair ", "competitor": "rival", "price": 280}).json()
    assert again["id"] == first["id"] and again["price"] == 280
    assert client.get("/api/pricing").json()["summary"]["competitor_prices"] == 1


def test_a_service_we_do_not_offer_is_listed_but_not_compared(client, orders):
    client.post("/api/pricing/competitor-prices", json={"service": "Sofa Cleaning", "competitor": "Rival", "price": 500})
    row = client.get("/api/pricing").json()["services"][0]
    assert row["position"] == "not_offered" and row["our_price"] is None


def test_invalid_prices_are_refused_and_delete_works(client, orders):
    assert client.post("/api/pricing/competitor-prices", json={"service": "AC", "competitor": "R", "price": 0}).status_code == 422
    assert client.post("/api/pricing/competitor-prices", json={"service": "  ", "competitor": "R", "price": 5}).status_code == 422
    p = client.post("/api/pricing/competitor-prices", json={"service": "AC", "competitor": "R", "price": 5}).json()
    assert client.delete(f"/api/pricing/competitor-prices/{p['id']}").json() == {"ok": True}
    assert client.delete(f"/api/pricing/competitor-prices/{p['id']}").status_code == 404


def test_pricing_module_is_importable():
    assert pricing.SAME_BAND_PCT == 2.0
