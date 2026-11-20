"""Welcomers: welcome template to helpers / customers who register after the switch was activated."""

from datetime import timedelta

import pytest

from app.models import WhatsAppMessage, WhatsAppWelcome, utcnow
from whatsapp import welcomers
from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.models import WhatsAppMessageResponse


def _user(uid, role, minutes_ago, name="Ravi Kumar", phone="9000000001", **kw):
    created = (utcnow() - timedelta(minutes=minutes_ago)).isoformat() + "Z"
    return {"uid": uid.ljust(24, "x"), "role": role, "name": name, "phone": phone, "createdAt": created, **kw}


@pytest.fixture
def fake(monkeypatch, db):
    users: list[dict] = []
    sent: list[tuple[str, str, dict]] = []

    class Src:
        def list_users(self, role, max_pages=10):
            return [u for u in users if role in ("partner", "helper", "customer")]

    async def send(self, to, template_name, language_code="en", components=None, variables=None, **kw):
        sent.append((to, template_name, variables))
        from whatsapp.metering import record_outbound
        await record_outbound(to, "sent", f"wamid.{len(sent)}", kind="template", template=template_name, category="marketing")
        return WhatsAppMessageResponse(status="sent", message_id=f"wamid.{len(sent)}")

    import app.integrations.extrahand as eh
    monkeypatch.setattr(eh, "get_source", lambda: Src())
    monkeypatch.setattr(MetaWhatsAppClient, "send_template_message", send)
    return users, sent


def test_both_welcomers_start_deactive(client, db):
    st = client.get("/api/whatsapp/welcomers/status").json()
    assert st["helper"]["active"] is False and st["customer"]["active"] is False
    assert st["helper"]["template"] == "extrahand_helper_welcome"
    assert st["customer"]["template"] == "extrahand_customer_welcome"


def test_only_new_signups_after_activation_are_welcomed_once(client, db, fake):
    users, sent = fake
    users.append(_user("oldhelper", "partner", 60 * 24))  # registered before activation
    client.post("/api/whatsapp/welcomers/helper/activate")
    users.extend([
        _user("newhelper", "partner", -1, name="Sita Devi", phone="9000000002"),
        _user("newcustomer", "customer", 1, phone="9000000003"),  # customer welcomer is off
        _user("tester", "partner", -1, phone="9000000004", isPaymentTester=True),
        _user("nophone", "partner", -1, phone=""),
    ])

    assert client.post("/api/whatsapp/welcomers/check-now").json() == {"helper": 1}
    assert [(to, t, v["1"]) for to, t, v in sent] == [("+919000000002", "extrahand_helper_welcome", "Sita")]

    # running again does not welcome the same helper twice
    client.post("/api/whatsapp/welcomers/check-now")
    assert len(sent) == 1
    assert db.query(WhatsAppWelcome).count() == 1

    client.post("/api/whatsapp/welcomers/customer/activate")
    users.append(_user("latecustomer", "customer", -2, phone="9000000005"))
    client.post("/api/whatsapp/welcomers/check-now")
    assert sent[-1][:2] == ("+919000000005", "extrahand_customer_welcome")
    assert len(sent) == 2  # newcustomer registered before the customer welcomer was activated


def test_deactivate_stops_and_commercials_split_by_audience(client, db, fake):
    users, sent = fake
    client.post("/api/whatsapp/welcomers/helper/activate")
    client.post("/api/whatsapp/welcomers/customer/activate")
    users.extend([_user("h1", "partner", -1, phone="9000000010"), _user("c1", "customer", -1, phone="9000000011")])
    client.post("/api/whatsapp/welcomers/check-now")
    assert len(sent) == 2

    import time
    for _ in range(50):
        db.expire_all()
        if db.query(WhatsAppMessage).count() >= 2:
            break
        time.sleep(0.02)
    rep = client.get("/api/whatsapp/welcomer-commercials").json()["periods"]["today"]
    assert rep["helper"]["sent"] == 1 and rep["customer"]["sent"] == 1 and rep["total"]["sent"] == 2
    assert rep["total"]["cost"] > 0

    client.post("/api/whatsapp/welcomers/helper/deactivate")
    users.append(_user("h2", "partner", -2, phone="9000000012"))
    client.post("/api/whatsapp/welcomers/check-now")
    assert len(sent) == 2
    detail = client.get("/api/whatsapp/welcomers/helper").json()
    assert detail["active"] is False and detail["recent"][0]["phone"] == "+919000000010"


def test_history_counts_registrations_and_process_per_day(client, db, fake, monkeypatch):
    users, sent = fake
    monkeypatch.setattr(welcomers, "_history_cache", {})
    users.extend([
        _user("before", "partner", 30, phone="9000000020"),  # registered while the welcomer was off
        _user("nophone", "partner", 20, phone=""),
        _user("acustomer", "customer", 10, phone="9000000021"),  # other audience: not counted for helpers
        _user("tester", "partner", 10, phone="9000000022", isPaymentTester=True),  # test account: not counted
        _user("olduser", "partner", 60 * 24 * 40, phone="9000000023"),  # older than 31 days
    ])
    client.post("/api/whatsapp/welcomers/helper/activate")
    users.append(_user("fresh", "partner", -1, phone="9000000024"))
    client.post("/api/whatsapp/welcomers/check-now")

    h = client.get("/api/whatsapp/welcomers/helper/history", params={"refresh": True}).json()
    last30 = h["periods"]["last30"]
    assert last30["registered"] == 3
    assert last30["with_phone"] == 2
    assert last30["welcomed"] == 1
    assert last30["welcomer_off"] == 1 and last30["no_phone"] == 1
    assert len(h["daily"]) == 31 and sum(d["registered"] for d in h["daily"]) == 3
    assert h["periods"]["month"]["registered"] <= 3


def test_people_lists_every_registration_with_its_outcome(client, db, fake, monkeypatch):
    users, sent = fake
    monkeypatch.setattr(welcomers, "_history_cache", {})
    users.extend([_user("before", "partner", 30, name="Old Timer", phone="9000000030"),
                  _user("nophone", "partner", 20, name="No Phone", phone="")])
    client.post("/api/whatsapp/welcomers/helper/activate")
    users.append(_user("fresh", "partner", -1, name="Sita Devi", phone="9000000031"))
    client.post("/api/whatsapp/welcomers/check-now")
    welcomers._history_cache.clear()

    res = client.get("/api/whatsapp/welcomers/helper/people").json()
    assert res["counts"]["all"] == 3 and res["counts"]["sent"] == 1
    by_name = {p["name"]: p["status"] for p in res["items"]}
    assert by_name == {"Old Timer": "welcomer_off", "No Phone": "no_phone", "Sita Devi": "welcomed"}
    assert res["items"][0]["name"] == "Sita Devi"  # newest first

    sent_only = client.get("/api/whatsapp/welcomers/helper/people", params={"status": "sent"}).json()
    assert [p["name"] for p in sent_only["items"]] == ["Sita Devi"] and sent_only["items"][0]["welcomed_at"]
    assert client.get("/api/whatsapp/welcomers/helper/people", params={"q": "timer"}).json()["total"] == 1
    assert client.get("/api/whatsapp/welcomers/helper/people", params={"day": "2000-01-01"}).json()["total"] == 0


def test_dashboard_counts_registrations_and_welcomes_for_both_audiences(client, db, fake, monkeypatch):
    users, sent = fake
    monkeypatch.setattr(welcomers, "_history_cache", {})
    users.extend([
        _user("before", "partner", 30, phone="9000000040"),  # registered while the helper welcomer was off
        _user("nophone", "partner", 20, phone=""),
        _user("cbefore", "customer", 15, phone="9000000041"),
        _user("tester", "partner", 10, phone="9000000042", isPaymentTester=True),  # test account: not counted
    ])
    client.post("/api/whatsapp/welcomers/helper/activate")
    client.post("/api/whatsapp/welcomers/customer/activate")
    users.extend([_user("hnew", "partner", -1, phone="9000000043"), _user("cnew", "customer", -1, phone="9000000044")])
    client.post("/api/whatsapp/welcomers/check-now")
    welcomers._history_cache.clear()

    d = client.get("/api/whatsapp/welcomers/dashboard").json()
    h, c = d["audiences"]["helper"], d["audiences"]["customer"]
    assert h["active"] and c["active"]
    assert h["periods"]["last30"]["registered"] == 3 and c["periods"]["last30"]["registered"] == 2
    assert h["periods"]["today"]["sent"] == 1 and c["periods"]["today"]["sent"] == 1
    assert h["funnel"] == {"registered": 3, "with_phone": 2, "welcomed": 1, "delivered": 0, "read": 0}
    assert h["outcomes"]["welcomer_off"] == 1 and h["outcomes"]["no_phone"] == 1
    assert h["coverage"] == 50.0 and c["coverage"] == 50.0
    assert len(d["daily"]) == 30 and sum(x["helper_registered"] for x in d["daily"]) == 3
    assert sum(x["customer_sent"] for x in d["daily"]) == 1 and len(d["hours"]) == 24 and sum(d["hours"]) == 5
