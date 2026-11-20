"""Task-Seeding Agent (Advertisement module): registration -> WhatsApp -> Book Now click -> call -> first booking."""

from datetime import date, timedelta

import pytest

from app.models import SeedContact, SeedOptOut, utcnow
from marketing import task_seeding as ts
from tests.factories import make_ticket
from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.models import WhatsAppMessageResponse

APPROVED = [{"language": lang, "status": "APPROVED", "button_url": "https://seed.test/api/marketing/task-seeding/go/{{1}}"}
            for lang in ("te", "hi", "en")]


def _day(n):
    """YYYY-MM-DD n days from today (India time)."""
    from datetime import datetime

    return (datetime.now(ts.IST).date() + timedelta(days=n)).isoformat()


def _customer(pid, hours_ago, name="Padma Rani", phone="+916300886259", city="Siddipet", state="Telangana", **kw):
    created = (utcnow() - timedelta(hours=hours_ago)).isoformat() + "Z"
    return {
        "_id": pid.ljust(24, "0"), "uid": f"uid{pid}".ljust(28, "x"), "role": "customer", "name": name, "phone": phone,
        "createdAt": created, "isActive": True,
        "location": {"type": "Point", "coordinates": [78.85, 18.10],
                     "addressDetails": {"city": city, "state": state, "pinCode": "502103"}},
        **kw,
    }


@pytest.fixture
def fake(monkeypatch, db):
    users: list[dict] = []
    sent: list[dict] = []
    state = {"versions": list(APPROVED), "festivals": []}

    class Src:
        def list_users(self, role, max_pages=10):
            return [u for u in users if role == "customer"]

    async def send(self, to, template_name, language_code="en", components=None, variables=None, button_slug=None, **kw):
        if to.endswith("0000000099"):
            return WhatsAppMessageResponse(status="failed", error="(#131026) Message undeliverable")
        sent.append({"to": to, "template": template_name, "lang": language_code, "vars": variables, "slug": button_slug})
        return WhatsAppMessageResponse(status="sent", message_id=f"wamid.seed{len(sent)}")

    async def versions():
        return state["versions"]

    import app.integrations.extrahand as eh

    monkeypatch.setattr(eh, "get_source", lambda: Src())
    monkeypatch.setattr(MetaWhatsAppClient, "send_template_message", send)
    monkeypatch.setattr(ts, "template_versions", versions)
    monkeypatch.setattr(ts, "upcoming_festivals", lambda today, days: state["festivals"])
    monkeypatch.setattr(ts, "_registrations", lambda db, days: {"registrations": len(users), "not_booked": None, "error": None})
    ts._last_run.update(at=0.0, when=None, result=None, blocked=None)
    return users, sent, state


def _enable(client, db, **extra):
    r = client.put("/api/marketing/task-seeding/settings", json={"enabled": True, **extra})
    assert r.status_code == 200, r.text
    # pretend it was switched on two days ago, so customers registered since then are in scope
    cfg = ts.config(db)
    cfg["since"] = (utcnow() - timedelta(days=2)).isoformat()
    ts.save_config(db, cfg)


def _run(client):
    r = client.post("/api/marketing/task-seeding/run-now")
    assert r.status_code == 200, r.text
    return r.json()


def test_starts_off_and_does_nothing(client, db, fake):
    users, sent, _ = fake
    users.append(_customer("a1", 30))
    st = client.get("/api/marketing/task-seeding/status").json()
    assert st["config"]["enabled"] is False and st["config"]["delay_hours"] == 24 and st["config"]["call"] is False
    assert ts.run_task_seeding(db, force=True) == {}
    assert client.post("/api/marketing/task-seeding/run-now").status_code == 400
    assert sent == [] and db.query(SeedContact).count() == 0


def test_full_journey_registration_to_first_booking(client, db, fake, settings, monkeypatch):
    users, sent, state = fake
    make_ticket(db, id="old1", category="cleaning", city="Siddipet", customer_id="someone-else",
                customer_phone="+919111111111", created_at=utcnow() - timedelta(days=20))
    db.commit()
    state["festivals"] = [{"id": "e1", "title": "Makara Sankranti", "city": "All-India", "date_start": _day(10),
                           "date_end": _day(10), "status": "Approved", "discount_code": "SANKRANTI20",
                           "target_services": []}]
    _enable(client, db)
    users.append(_customer("padma", 30))  # registered 30 h ago, has not booked
    users.append(_customer("fresh", 2, phone="+919000000002"))  # registered 2 h ago: still waiting

    # 1. 24 h after registration: one WhatsApp in Telugu with a festival suggestion and a tracked Book Now
    _run(client)
    assert len(sent) == 1
    msg = sent[0]
    assert msg["to"] == "+916300886259" and msg["template"] == ts.TEMPLATE and msg["lang"] == "te"
    assert msg["vars"]["1"] == "Padma" and "Makara Sankranti" in msg["vars"]["2"]
    # every festival service ExtraHand has in Siddipet (cleaning only, no repairs there), the festival's own first
    assert msg["vars"]["3"].startswith(ts.SERVICES["house_cleaning"]["te"] + ", ") and " మరియు " in msg["vars"]["3"]
    assert ts.SERVICES["home_maintenance"]["te"] not in msg["vars"]["3"] and msg["vars"]["4"] == "Siddipet"
    c = db.query(SeedContact).one()
    assert c.status == "messaged" and c.service == "house_cleaning" and c.reason == "festival"
    assert c.promo_code == "SANKRANTI20" and msg["slug"] == c.token

    # 2. running again never messages the same customer twice
    _run(client)
    assert len(sent) == 1

    # 3. Book Now click is counted and lands on ExtraHand's booking page for her city and service
    r = client.get(f"/api/marketing/task-seeding/go/{c.token}", follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://extrahand.in/book?") and "city=Siddipet" in loc and "category=cleaning" in loc
    assert "promo=SANKRANTI20" in loc
    db.expire_all()
    assert db.get(SeedContact, c.id).clicks == 1

    # 4. her first booking converts her and stops all contact
    make_ticket(db, id="first", category="cleaning", city="Siddipet", customer_id=c.user_id,
                customer_phone="+916300886259", created_at=utcnow())
    db.commit()
    _run(client)
    db.expire_all()
    c = db.get(SeedContact, c.id)
    assert c.status == "converted" and c.converted_ticket_id == "first"

    kpis = client.get("/api/marketing/task-seeding/status").json()["kpis"]
    assert kpis["messages_sent"] == 1 and kpis["link_clicks"] == 1 and kpis["first_bookings"] == 1
    assert kpis["conversion_rate"] == 100.0 and kpis["failures"] == 0

    hist = client.get("/api/marketing/task-seeding/contacts").json()
    assert hist["counts"]["converted"] == 1 and hist["items"][0]["service_name"].startswith("house cleaning, ")


def test_telugu_call_follows_when_no_click_or_booking(client, db, fake, settings, monkeypatch):
    users, sent, _ = fake
    settings(telephony_provider="vobiz", vobiz_auth_id="AID", vobiz_auth_token="TOK", vobiz_from_number="+918000000000",
             public_base_url="https://ivr.test", sarvam_api_key="key")
    monkeypatch.setattr("app.services.common.within_calling_hours", lambda db: True)
    from app.services.common import runtime_settings, save_runtime_settings

    save_runtime_settings(db, {"emergency_stop_calls": False})
    assert runtime_settings(db).emergency_stop_calls is False
    calls = []
    monkeypatch.setattr(ts, "_place_call", lambda c: calls.append((c.phone, ts.call_script(c))) or "call-uuid-1")
    make_ticket(db, id="old1", category="cleaning", city="Siddipet", customer_id="x", created_at=utcnow() - timedelta(days=9))
    db.commit()
    _enable(client, db, call=True, call_after_hours=24)
    users.append(_customer("ravi", 30, name="Ravi", phone="+919000000003"))

    _run(client)
    assert len(sent) == 1 and calls == []  # WhatsApp first; the call waits 24 h

    c = db.query(SeedContact).one()
    c.wa_sent_at = utcnow() - timedelta(hours=25)
    db.commit()
    _run(client)
    assert len(calls) == 1 and calls[0][0] == "+919000000003" and "రవి" not in calls[0][1] and "Ravi" in calls[0][1]
    db.expire_all()
    c = db.get(SeedContact, c.id)
    assert c.status == "called" and c.call_id == "call-uuid-1"

    # Vobiz reports the end of the call; there is never a second call
    client.post(f"/api/marketing/task-seeding/calls/{c.token}/hangup",
                data={"CallStatus": "completed", "Duration": "18"})
    db.expire_all()
    assert db.get(SeedContact, c.id).call_status == "completed" and db.get(SeedContact, c.id).call_duration == 18
    _run(client)
    assert len(calls) == 1


def test_skips_booked_unserved_area_duplicates_and_testers(client, db, fake):
    users, sent, _ = fake
    make_ticket(db, id="hyd1", category="Cleaning", city="Hyderabad", customer_id="x", lat=17.44, lng=78.38,
                created_at=utcnow() - timedelta(days=3))
    make_ticket(db, id="booked", category="cleaning", city="Hyderabad", customer_id="b00".ljust(24, "0"),
                created_at=utcnow() - timedelta(hours=20))
    db.commit()
    _enable(client, db)
    users.extend([
        _customer("b00", 30, phone="+919000000010", city="Hyderabad"),  # already booked by herself
        _customer("far", 30, phone="+919000000011", city="Guwahati", state="Assam",
                  location=None),  # nothing booked anywhere near her
        _customer("dup", 30, phone="+919000000012", city="Hyderabad"),
        _customer("dup2", 29, phone="+91 90000 00012", city="Hyderabad"),  # same phone, second account
        _customer("tst", 30, phone="+919000000013", city="Hyderabad", isPaymentTester=True),
    ])
    users[1]["location"] = {"addressDetails": {"city": "Guwahati", "state": "Assam"}}
    _run(client)
    rows = {c.user_id[:3]: c for c in db.query(SeedContact).all()}
    assert rows["b00"].status == "skipped" and rows["b00"].skip_reason == "already_booked"
    assert rows["far"].status == "skipped" and rows["far"].skip_reason == "no_service_in_area"
    assert rows["dup"].status == "messaged" and "dup2" not in {c.user_id[:4] for c in rows.values()}
    assert "tst" not in rows
    assert [m["to"] for m in sent] == ["+919000000012"]
    assert sent[0]["lang"] == "te" and sent[0]["vars"]["3"] == ts.SERVICES["bathroom_kitchen"]["te"]


def test_stop_reply_opts_out_for_good(client, db, fake):
    users, sent, _ = fake
    make_ticket(db, id="o", category="cleaning", city="Siddipet", customer_id="x", created_at=utcnow() - timedelta(days=1))
    db.commit()
    _enable(client, db)
    payload = {"entry": [{"changes": [{"value": {"messages": [{"from": "916300886259", "text": {"body": "Stop"}}]}}]}]}
    assert client.post("/api/whatsapp/webhook", json=payload).json()["status"] == "ok"
    assert db.query(SeedOptOut).count() == 1
    users.append(_customer("padma", 30))
    _run(client)
    assert sent == []
    assert db.query(SeedContact).one().status == "opted_out"
    assert ts.handle_inbound_text("+919999999999", "hello") is False


def test_waits_for_meta_approval_and_uses_english_until_telugu_is_approved(client, db, fake):
    users, sent, state = fake
    make_ticket(db, id="o", category="cleaning", city="Siddipet", customer_id="x", created_at=utcnow() - timedelta(days=1))
    db.commit()
    state["versions"] = [{"language": "te", "status": "PENDING"}]
    _enable(client, db)
    users.append(_customer("padma", 30))
    _run(client)
    assert sent == [] and db.query(SeedContact).one().status == "pending"
    assert client.get("/api/marketing/task-seeding/status").json()["blocked"]

    state["versions"] = [{"language": "te", "status": "PENDING"}, {"language": "en", "status": "APPROVED"}]
    _run(client)
    assert len(sent) == 1 and sent[0]["lang"] == "en"
    assert sent[0]["vars"]["3"] == "bathroom and kitchen cleaning"


def test_failed_send_is_retried_then_retry_button(client, db, fake):
    users, sent, _ = fake
    make_ticket(db, id="o", category="cleaning", city="Siddipet", customer_id="x", created_at=utcnow() - timedelta(days=1))
    db.commit()
    _enable(client, db)
    users.append(_customer("bad", 30, phone="+910000000099"))
    _run(client)
    c = db.query(SeedContact).one()
    assert c.status == "failed" and c.wa_attempts == 1 and "undeliverable" in c.wa_error
    _run(client)  # not before 30 minutes
    db.expire_all()
    assert db.get(SeedContact, c.id).wa_attempts == 1
    assert client.get("/api/marketing/task-seeding/status").json()["kpis"]["failures"] == 1

    assert client.post("/api/marketing/task-seeding/retry-failed").json() == {"retrying": 1}
    db.expire_all()
    assert db.get(SeedContact, c.id).status == "pending"
    _run(client)
    db.expire_all()
    assert db.get(SeedContact, c.id).wa_attempts == 1 and db.get(SeedContact, c.id).status == "failed"


def test_suggestion_rules():
    fam = {"cleaning": 3, "repair": 1}
    cfg = dict(ts.DEFAULTS)
    u = {"city": "Warangal", "state": "Telangana"}
    bathukamma = {"title": "Bathukamma", "city": "Telangana", "target_services": []}
    diwali = {"title": "Diwali", "city": "All-India", "target_services": [], "discount_code": "DIWALI25"}
    pick = ts.suggest(u, cfg, fam, [diwali, bathukamma], date(2026, 10, 1))
    assert pick["service"] == "festival_cleaning" and pick["language"] == "te"  # local festival before All-India
    assert ts.suggest(u, cfg, fam, [diwali], date(2026, 10, 1))["service"] == "deep_cleaning"
    assert ts.suggest(u, cfg, fam, [], date(2026, 5, 1))["service"] == "home_maintenance"  # summer
    assert ts.suggest(u, cfg, {"cleaning": 2}, [], date(2026, 5, 1))["service"] == "bathroom_kitchen"  # no repairs here
    assert ts.suggest(u, cfg, fam, [], date(2026, 11, 1))["service"] == "bathroom_kitchen"
    assert ts.suggest(u, cfg, {}, [diwali], date(2026, 11, 1)) is None
    assert ts.festival_service({"title": "Children's Day"}) is None
    assert ts.language_for("Uttar Pradesh") == "hi" and ts.language_for("Karnataka") == "en"
    assert ts.suggest(u, {**cfg, "festival_campaigns": False}, fam, [diwali], date(2026, 11, 1))["service"] == "bathroom_kitchen"


def test_festival_message_from_the_calendar_is_used(client, db, fake, monkeypatch):
    """A message set for a festival in the calendar: its service, coupon and festival line go to the customer."""
    users, sent, state = fake
    from marketing import database as mdb

    ev = {"id": "allindia-bathukamma-2026", "title": "Bathukamma", "city": "All-India", "date_start": _day(10),
          "date_end": _day(10), "status": "Approved", "discount_code": "BATHU20", "target_services": []}
    monkeypatch.setattr(mdb, "db_get_event_by_id", lambda eid: ev if eid == ev["id"] else None)
    monkeypatch.setattr(ts, "_month_events", lambda y, m: [ev])
    state["festivals"] = [ev]
    make_ticket(db, id="o", category="cleaning", city="Siddipet", customer_id="x", created_at=utcnow() - timedelta(days=1))
    db.commit()

    cal = client.get("/api/marketing/task-seeding/festivals?year=2026&month=12").json()
    (f,) = cal["festivals"]
    assert f["suggested_service"] == "festival_cleaning" and f["enabled"] and "Bathukamma" in f["hooks"]["te"]

    line = "బతుకమ్మ పండుగకు మీ ఇంటిని మెరిసేలా చేసుకోండి!"
    r = client.put(f"/api/marketing/task-seeding/festivals/{ev['id']}",
                   json={"enabled": True, "service": "deep_cleaning", "promo_code": "bathu30", "hooks": {"te": line + "\n"}})
    assert r.status_code == 200 and r.json()["customised"] and r.json()["service"] == "deep_cleaning"

    _enable(client, db)
    users.append(_customer("padma", 30))
    _run(client)
    assert sent[0]["vars"]["2"] == line and sent[0]["vars"]["3"] == ts.SERVICES["deep_cleaning"]["te"]
    assert db.query(SeedContact).one().promo_code == "BATHU30"

    # switched off for this festival: the agent falls back to the regular-day suggestion
    client.put(f"/api/marketing/task-seeding/festivals/{ev['id']}", json={"enabled": False})
    users.append(_customer("ravi", 30, name="Ravi", phone="+919000000044"))
    _run(client)
    assert sent[1]["vars"]["3"] == ts.SERVICES["bathroom_kitchen"]["te"]

    assert client.delete(f"/api/marketing/task-seeding/festivals/{ev['id']}").json() == {"ok": True}
    assert ts.festival_messages(db) == {}


def test_festival_sending_dates_set_in_the_calendar():
    cfg = dict(ts.DEFAULTS)
    u = {"city": "Siddipet", "state": "Telangana"}
    fam = {"cleaning": 2}
    ev = {"id": "e9", "title": "Diwali", "city": "All-India", "date_start": "2026-11-08", "date_end": "2026-11-08"}
    # default: 21 days before up to the festival day
    assert ts.suggest(u, cfg, fam, [ev], date(2026, 10, 20))["reason"] == "festival"
    assert ts.suggest(u, cfg, fam, [ev], date(2026, 10, 10))["reason"] == "regular"
    # own dates: only 1-5 Nov
    own = {"e9": {"enabled": True, "service": "deep_cleaning", "send_from": "2026-11-01", "send_until": "2026-11-05"}}
    assert ts.suggest(u, cfg, fam, [ev], date(2026, 10, 20), own)["reason"] == "regular"
    assert ts.suggest(u, cfg, fam, [ev], date(2026, 11, 3), own)["service"] == "deep_cleaning"
    assert ts.suggest(u, cfg, fam, [ev], date(2026, 11, 7), own)["reason"] == "regular"


def test_festival_message_with_several_services():
    ev = {"id": "e1", "title": "Diwali", "city": "All-India", "date_start": "2026-11-08", "date_end": "2026-11-08"}
    own = {"e1": {"enabled": True, "services": ["deep_cleaning", "home_maintenance", "bathroom_kitchen"]}}
    u = {"city": "Siddipet", "state": "Telangana"}
    pick = ts.suggest(u, dict(ts.DEFAULTS), {"cleaning": 3, "repair": 1}, [ev], date(2026, 11, 1), own)
    assert pick["services"] == ["deep_cleaning", "home_maintenance", "bathroom_kitchen"]
    only_cleaning = ts.suggest(u, dict(ts.DEFAULTS), {"cleaning": 3}, [ev], date(2026, 11, 1), own)
    assert only_cleaning["services"] == ["deep_cleaning", "bathroom_kitchen"]
    assert ts.service_names(["deep_cleaning", "bathroom_kitchen"], "en") == "home deep cleaning & bathroom and kitchen cleaning"
    assert ts.service_names(["house_cleaning", "deep_cleaning", "home_maintenance"], "en") ==         "house cleaning, home deep cleaning & home repairs and maintenance"


def test_added_service_is_offered_only_where_its_category_was_booked(client, db, fake):
    users, sent, state = fake
    ev = {"id": "e-pongal", "title": "Pongal", "city": "All-India", "date_start": _day(5), "date_end": _day(5),
          "status": "Approved", "discount_code": "", "target_services": []}
    state["festivals"] = [ev]
    from marketing import database as mdb
    import pytest as _pt

    mp = _pt.MonkeyPatch()
    mp.setattr(mdb, "db_get_event_by_id", lambda eid: ev if eid == ev["id"] else None)
    try:
        make_ticket(db, id="p1", category="Plumbing", city="Siddipet", customer_id="x", created_at=utcnow() - timedelta(days=4))
        make_ticket(db, id="c1", category="cleaning", city="Siddipet", customer_id="y", created_at=utcnow() - timedelta(days=4))
        db.commit()
        assert client.post("/api/marketing/task-seeding/services", json={"en": "Tap repair", "category": "moving"}).status_code == 400
        r = client.post("/api/marketing/task-seeding/services",
                        json={"en": "Tap and pipe repair", "te": "కుళాయి, పైపు రిపేర్", "category": "Plumbing"})
        assert r.status_code == 200, r.text
        key = r.json()["key"]
        assert client.post("/api/marketing/task-seeding/services", json={"en": "Tap and pipe repair", "category": "plumbing"}).status_code == 400

        client.put(f"/api/marketing/task-seeding/festivals/{ev['id']}", json={"enabled": True, "services": [key, "house_cleaning"]})
        _enable(client, db)
        users.append(_customer("padma", 30))  # Siddipet: plumbing and cleaning were booked there
        _run(client)
        assert sent[0]["vars"]["3"] == "కుళాయి, పైపు రిపేర్ మరియు " + ts.SERVICES["house_cleaning"]["te"]

        assert client.delete(f"/api/marketing/task-seeding/services/{key}").json() == {"ok": True}
        assert client.delete("/api/marketing/task-seeding/services/house_cleaning").status_code == 400
        ts.refresh_services(db)
        assert key not in ts.SERVICES
    finally:
        mp.undo()


def test_template_wording_is_edited_checked_and_sent_to_meta(client, db, fake, monkeypatch):
    _, _, state = fake
    created, edited = [], []

    async def create(self, **kw):
        created.append(kw)
        return {"ok": True, "id": "t-" + kw["language"], "status": "PENDING"}

    async def edit(self, template_id, **kw):
        edited.append((template_id, kw))
        return {"ok": True, "id": template_id, "status": "PENDING"}

    monkeypatch.setattr(MetaWhatsAppClient, "create_template", create)
    monkeypatch.setattr(MetaWhatsAppClient, "edit_template", edit)
    te = ts.TEMPLATE_TEXT["te"]
    # Meta has the built-in Telugu text approved, nothing for Hindi / English yet
    state["versions"] = [{"language": "te", "status": "APPROVED", "id": "t-te", "body": te["body"], "footer": te["footer"],
                          "button": te["button"], "button_url": None}]
    view = client.get("/api/marketing/task-seeding/template").json()
    meta = {x["language"]: x["meta"] for x in view["languages"]}
    assert meta["te"] == {"status": "APPROVED", "rejected_reason": None, "changed": False}
    assert meta["hi"]["status"] == "NOT_SUBMITTED"

    url = "/api/marketing/task-seeding/template/te"
    bad = client.put(url, json={"body": "Hi {{1}}, book {{3}} now.", "footer": te["footer"], "button": te["button"]})
    assert bad.status_code == 400 and "{{2}}" in bad.json()["detail"]
    assert client.put(url, json={"body": "{{1}} {{2}} {{3}} {{4}} ok", "footer": "x", "button": "Go"}).status_code == 400
    assert client.put(url, json={"body": te["body"], "footer": "x" * 61, "button": "Go"}).status_code == 400

    new_body = "హాయ్ {{1}} 🙏\n\n{{2}}\n\n{{4}}లో {{3}} ఇప్పుడే బుక్ చేసుకోండి."
    r = client.put(url, json={"body": new_body, "footer": te["footer"], "button": te["button"]})
    assert r.status_code == 200, r.text
    tel = next(x for x in r.json()["languages"] if x["language"] == "te")
    assert tel["edited"] and tel["meta"]["changed"] and tel["body"] == new_body
    assert client.get("/api/marketing/task-seeding/festivals").json()["template"]["te"]["body"] == new_body

    # Telugu: changed at Meta (edit, not a new template); only that language
    res = client.post("/api/marketing/task-seeding/template?language=te").json()
    assert res["results"] == {"te": {"ok": True, "already": False, "status": "PENDING", "error": None, "edited": True}}
    assert edited[0][0] == "t-te" and edited[0][1]["body"] == new_body and created == []
    # all: Hindi and English are created; Telugu is in review now, nothing more to send for it
    state["versions"][0].update(status="PENDING", body=new_body)
    res = client.post("/api/marketing/task-seeding/template").json()["results"]
    assert res["te"]["already"] and {c["language"] for c in created} == {"hi", "en"}

    # back to the built-in wording
    r = client.delete(url).json()
    assert next(x for x in r["languages"] if x["language"] == "te")["edited"] is False
