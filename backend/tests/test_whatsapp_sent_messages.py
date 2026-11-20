"""Sent Messages view: message text is recorded and messages are split into utility / marketing."""

import asyncio

from app.models import WhatsAppMessage, utcnow
from tests.test_whatsapp_commercials import _wait_for, live_client  # noqa: F401  (fixture)


def _add(db, **kw):
    row = dict(direction="out", source="automation", kind="text", phone="919000000001", status="sent",
               provider_message_id=f"wamid.{kw.get('body')}", created_at=utcnow())
    row.update(kw)
    db.add(WhatsAppMessage(**row))


def test_template_send_records_filled_text_and_category(live_client, db):  # noqa: F811
    async def fake_def(name, language=None):
        return {"name": name, "category": "MARKETING", "components": [
            {"type": "BODY", "text": "Hi {{1}}, get {{2}} off today!"},
            {"type": "FOOTER", "text": "ExtraHand"},
        ]}

    live_client.get_template_def = fake_def
    comps = [{"type": "body", "parameters": [{"type": "text", "text": "Ravi"}, {"type": "text", "text": "20%"}]}]
    asyncio.run(live_client.send_template_message("9000000002", "promo", components=comps))
    asyncio.run(live_client.send_text_message("9000000003", "Your work order is ready"))
    _wait_for(db, 2)
    rows = {m.kind: m for m in db.query(WhatsAppMessage).all()}
    assert rows["template"].body == "Hi Ravi, get 20% off today!\n\nExtraHand"
    assert rows["template"].category == "marketing"
    assert rows["text"].body == "Your work order is ready"


def test_messages_split_by_category(client, db):
    _add(db, body="tpl-marketing", kind="template", category="marketing")
    _add(db, body="meta-utility", kind="template", category="utility", billable=True)
    _add(db, body="bulk-text", source="bulk")  # no category yet -> rate card: bulk = marketing
    _add(db, body="auto-text")  # no category yet -> rate card: automation = utility
    _add(db, body="svc", category="service", billable=False)
    db.add(WhatsAppMessage(direction="in", source="inbound", phone="919000000001", status="received"))
    db.commit()

    res = client.get("/api/whatsapp/messages").json()
    assert res["counts"] == {"all": 5, "utility": 2, "marketing": 2, "other": 1}

    mk = client.get("/api/whatsapp/messages", params={"category": "marketing"}).json()
    assert {i["body"] for i in mk["items"]} == {"tpl-marketing", "bulk-text"}
    origins = {i["body"]: i["category_origin"] for i in mk["items"]}
    assert origins == {"tpl-marketing": "template", "bulk-text": "estimated"}

    ut = client.get("/api/whatsapp/messages", params={"category": "utility"}).json()
    assert {i["body"]: i["category_origin"] for i in ut["items"]} == {"meta-utility": "meta", "auto-text": "estimated"}

    other = client.get("/api/whatsapp/messages", params={"category": "other"}).json()
    assert [i["body"] for i in other["items"]] == ["svc"]

    found = client.get("/api/whatsapp/messages", params={"q": "auto"}).json()
    assert found["counts"]["all"] == 1 and found["items"][0]["body"] == "auto-text"


def test_tabs_split_sent_and_failed(client, db):
    _add(db, body="ok1", kind="template", category="utility", status="delivered")
    _add(db, body="ok2", kind="template", category="utility", status="read")
    _add(db, body="bad", kind="template", category="utility", status="failed")
    _add(db, body="sim", kind="template", category="marketing", status="simulated")
    db.commit()
    o = client.get("/api/whatsapp/messages").json()["outcomes"]
    assert o["utility"] == {"ok": 2, "failed": 1, "unsent": 0}
    assert o["marketing"] == {"ok": 0, "failed": 0, "unsent": 1}
    assert o["all"] == {"ok": 2, "failed": 1, "unsent": 1}
