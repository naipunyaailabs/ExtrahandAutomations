"""WhatsApp commercials: the message ledger, Meta's status/pricing webhooks, and the two summaries."""

import asyncio
import time

import httpx
import pytest

from app.models import WhatsAppCampaign, WhatsAppMessage, utcnow
from whatsapp import meta_client
from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.metering import tagged


@pytest.fixture
def live_client(monkeypatch, db):
    """A configured client whose Meta API answers with message ids wamid.1, wamid.2, ..."""
    n = {"i": 0}

    class FakeAsyncClient:
        def __init__(self, *a, **kw): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            n["i"] += 1
            return httpx.Response(200, json={"messages": [{"id": f"wamid.{n['i']}"}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(meta_client.httpx, "AsyncClient", FakeAsyncClient)
    c = MetaWhatsAppClient(phone_number_id="pn", access_token="tok")
    c.simulated = False
    return c


def _wait_for(db, n):
    for _ in range(50):
        db.expire_all()
        if db.query(WhatsAppMessage).count() >= n:
            return
        time.sleep(0.02)


def _status(mid, status, **pricing):
    st = {"id": mid, "status": status, "timestamp": str(int(time.time()))}
    if pricing:
        st["pricing"] = pricing
    return {"entry": [{"changes": [{"value": {"statuses": [st]}}]}]}


def test_sends_are_recorded_with_their_label(live_client, db):
    async def go():
        with tagged("automation", "work_order", "t1"):
            await live_client.send_text_message("9000000001", "hi")
        await live_client.send_template_message("9000000002", "promo")
    asyncio.run(go())
    _wait_for(db, 2)
    rows = {m.provider_message_id: m for m in db.query(WhatsAppMessage).all()}
    assert rows["wamid.1"].source == "automation" and rows["wamid.1"].purpose == "work_order"
    assert rows["wamid.1"].ticket_id == "t1" and rows["wamid.1"].phone == "919000000001"
    assert rows["wamid.2"].kind == "template" and rows["wamid.2"].template == "promo"


def test_meta_reports_set_delivery_and_measured_cost(client, db):
    put = {"marketing": 1.0, "utility": 0.2, "authentication": 0.2, "service": 0.0, "automation_category": "utility",
           "bulk_category": "marketing", "automation_budget": 100, "bulk_budget": 100}
    assert client.put("/api/whatsapp/commercials/rates", json=put).status_code == 200
    camp = WhatsAppCampaign(message_preview="Offer", total=3)
    db.add(camp)
    db.flush()
    now = utcnow()
    for i, kind in enumerate(["template", "template", "text"], start=1):
        db.add(WhatsAppMessage(source="bulk", purpose="bulk", kind=kind, phone=f"91900000000{i}", campaign_id=camp.id,
                               provider_message_id=f"w{i}", status="sent", created_at=now))
    db.add(WhatsAppMessage(source="bulk", kind="text", phone="919000000009", status="failed", error="bad", created_at=now))
    db.add(WhatsAppMessage(source="bulk", kind="text", phone="919000000008", status="simulated", provider_message_id="sim", created_at=now))
    db.commit()

    client.post("/api/whatsapp/webhook", json=_status("w1", "read", billable=True, category="marketing", type="regular"))
    client.post("/api/whatsapp/webhook", json=_status("w2", "delivered"))  # no pricing yet: template estimated
    fail = _status("w3", "failed")
    fail["entry"][0]["changes"][0]["value"]["statuses"][0]["errors"] = [{"code": 131047, "title": "Re-engagement message"}]
    client.post("/api/whatsapp/webhook", json=fail)

    body = client.get("/api/whatsapp/commercials/bulk").json()
    p = body["periods"]["all"]
    assert p["attempted"] == 4 and p["simulated"] == 1
    assert p["accepted"] == 3 and p["api_failed"] == 1 and p["delivery_failed"] == 1
    assert p["delivered"] == 2 and p["read"] == 1
    assert p["measured_cost"] == 1.0 and p["estimated_cost"] == 1.0 and p["cost"] == 2.0
    assert any(x["reason"].startswith("131047") for x in p["failure_reasons"])
    c = body["campaigns"][0]
    assert c["sent"] == 3 and c["read"] == 1 and c["cost"] == 2.0
    assert len(body["daily"]) == 30


def test_text_inside_the_service_window_is_free_and_counted_as_a_reply(client, db):
    now = utcnow()
    db.add(WhatsAppMessage(direction="in", source="inbound", phone="919000000001", status="received", created_at=now))
    db.add(WhatsAppMessage(source="automation", purpose="reply", kind="text", phone="919000000001",
                           provider_message_id="x1", status="delivered", created_at=now))
    db.add(WhatsAppMessage(source="automation", purpose="broadcast", kind="text", phone="919000000002",
                           provider_message_id="x2", status="sent", created_at=now))
    db.commit()
    p = client.get("/api/whatsapp/commercials/automation").json()["periods"]["all"]
    assert p["cost"] == 0
    assert p["texts_outside_window"] == 1  # the broadcast went to someone who had not written in 24 h
    assert p["template_equivalent_cost"] == 0.25  # 2 x default utility rate
