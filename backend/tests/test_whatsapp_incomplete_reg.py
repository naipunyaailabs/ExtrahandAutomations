"""Incomplete Registration Engagement: detection, 5-hour wait, single-send lock, Telugu templates & commercials."""

from datetime import timedelta

import pytest

from app.models import WhatsAppIncompleteReg, WhatsAppMessage, utcnow
from whatsapp import incomplete_reg as ir
from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.models import WhatsAppMessageResponse


def _user(uid, role, hours_ago, name="Ravi Kumar", phone="9000000001", **kw):
    created = (utcnow() - timedelta(hours=hours_ago)).isoformat() + "Z"
    clean_uid = uid.replace("_", "").ljust(24, "x")
    return {
        "uid": clean_uid,
        "_id": clean_uid,
        "role": role,
        "roles": [role] if role != "unknown" else [],
        "name": name,
        "phone": phone,
        "createdAt": created,
        **kw,
    }


@pytest.fixture
def fake(monkeypatch):
    users: list[dict] = []
    sent: list[dict] = []
    created_templates: list[dict] = []

    class Src:
        def list_users(self, role, max_pages=60):
            return [u for u in users if u.get("role") == role or role in (u.get("roles") or [])]

    async def get_def(self, name, language=None):
        for t in created_templates:
            if t["name"] == name:
                return {"name": name, "status": "APPROVED", "language": t["language"], "category": t["category"]}
        return {"name": name, "status": "APPROVED", "language": language or "te", "category": "MARKETING"}

    async def create_tmpl(self, name, category, body, language="te", examples=None, **kw):
        created_templates.append({"name": name, "category": category, "body": body, "language": language, "examples": examples})
        return {"ok": True, "id": f"tmpl_{name}", "status": "PENDING", "category": category}

    async def send(self, to, template_name, language_code="te", components=None, variables=None, **kw):
        sent.append({"to": to, "template": template_name, "language": language_code, "components": components, "variables": variables})
        from whatsapp.metering import record_outbound

        await record_outbound(
            to,
            "sent",
            f"wamid.ir.{len(sent)}",
            kind="template",
            template=template_name,
            body=ir.TEMPLATES["customer" if "customer" in template_name else "helper"]["body"],
            category="marketing",
        )
        return WhatsAppMessageResponse(status="sent", message_id=f"wamid.ir.{len(sent)}")

    import app.integrations.extrahand as eh

    monkeypatch.setattr(eh, "get_source", lambda: Src())
    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", get_def)
    monkeypatch.setattr(MetaWhatsAppClient, "create_template", create_tmpl)
    monkeypatch.setattr(MetaWhatsAppClient, "send_template_message", send)
    monkeypatch.setattr(ir, "_last_check", {"at": 0.0, "when": None})
    monkeypatch.setattr(ir, "_scan_cache", {"at": 0.0, "fetched_at": None, "users": [], "completed": [], "error": None})
    return users, sent, created_templates


def test_starts_inactive_and_has_exact_telugu_templates(client, db, fake):
    d = client.get("/api/whatsapp/incomplete-reg/dashboard").json()
    assert d["active"] is False
    assert d["wait_hours"] == 5
    assert "మీ Helper Registration ఇంకా Pending లో ఉంది." in d["templates"]["helper"]["body"]
    assert "సహాయం చేయండి, రోజూ సంపాదించండి" in d["templates"]["helper"]["body"]
    assert "మీ Customer Registration ఇంకా Pending లో ఉంది." in d["templates"]["customer"]["body"]
    assert "మీకు దగ్గరలోనే నమ్మకమైన సహాయం" in d["templates"]["customer"]["body"]
    assert client.post("/api/whatsapp/incomplete-reg/check-now").json() == {}


def _activated_hours_ago(client, db, hours):
    """Activates, then moves the activation time back so fixture users created after it count as new signups."""
    client.post("/api/whatsapp/incomplete-reg/activate")
    ir._save_state(db, activated_at=(utcnow() - timedelta(hours=hours)).isoformat())
    db.expire_all()


def test_users_who_signed_up_before_activation_are_ignored(client, db, fake):
    users, sent, _ = fake
    users.append(_user("c_before", "customer", 30, name="Old Cust", phone="9000000031"))
    users.append(_user("h_before", "partner", 30, name="Old Helper", phone="9000000032",
                       partnerProfile={"status": "not_applied", "onboardingCompleted": False}))
    users.append(_user("c_after", "customer", 8, name="New Cust", phone="9000000033"))

    # While inactive, everyone already signed up would be skipped once activated
    before = client.get("/api/whatsapp/incomplete-reg/users", params={"refresh": True}).json()
    assert before["counts"]["old_skipped"] == 3 and before["counts"]["ready"] == 0

    _activated_hours_ago(client, db, 10)  # c_before/h_before signed up 30h ago, c_after 8h ago
    res = client.post("/api/whatsapp/incomplete-reg/check-now").json()
    assert res["sent"] == 1 and [s["to"] for s in sent] == ["+919000000033"]

    d = client.get("/api/whatsapp/incomplete-reg/dashboard").json()
    assert d["counts"]["old_skipped"] == 2 and d["counts"]["ready_to_send"] == 0
    statuses = {x["name"]: x["msg_status"] for x in client.get("/api/whatsapp/incomplete-reg/users").json()["items"]}
    assert statuses["Old Cust"] == "old_skipped" and statuses["Old Helper"] == "old_skipped"

    # Running again never picks up the old users
    assert client.post("/api/whatsapp/incomplete-reg/check-now").json()["sent"] == 0


def test_detection_and_5_hour_rule_and_single_send(client, db, fake):
    users, sent, _ = fake
    # 1. Eligible existing incomplete helper (>5h)
    users.append(_user("h_old", "partner", 10, name="Suresh", phone="9000000011",
                       partnerProfile={"status": "rejected", "onboardingCompleted": False, "categories": [], "workAreas": []}))
    # 2. Eligible existing incomplete helper: profile filled, KYC pending (>5h)
    users.append(_user("h_kyc", "partner", 8, name="Ramesh", phone="9000000012",
                       isAadhaarVerified=False,
                       location={"addressDetails": {"city": "Hyderabad", "state": "Telangana"}},
                       partnerProfile={"status": "rejected", "onboardingCompleted": True, "categories": ["cleaning"], "workAreas": ["madhapur"]}))
    # 3. Approved / complete helper -> must NEVER be messaged
    users.append(_user("h_ok", "partner", 12, name="Done Helper", phone="9000000013",
                       isAadhaarVerified=True,
                       location={"addressDetails": {"city": "Hyderabad", "state": "Telangana"}},
                       partnerProfile={"status": "approved", "onboardingCompleted": True, "categories": ["cleaning"], "workAreas": ["madhapur"]}))
    # 4. New incomplete helper (<5h, 2 hours ago) -> must WAIT until 5h
    users.append(_user("h_new", "partner", 2, name="Wait Helper", phone="9000000014",
                       partnerProfile={"status": "not_applied", "onboardingCompleted": False}))
    # 5. Eligible incomplete customer: no location (>5h)
    users.append(_user("c_noloc", "customer", 7, name="Priya Sharma", phone="9000000021"))
    # 6. Eligible unknown role user (>5h)
    users.append(_user("c_unk", "unknown", 6, name="Kiran", phone="9000000022"))
    # 7. Complete customer with location + name -> must NEVER be messaged
    users.append(_user("c_ok", "customer", 10, name="Ananya", phone="9000000023",
                       location={"addressDetails": {"city": "Siddipet", "state": "Telangana"}}))
    # 8. Customer without location BUT already posted a task -> must NEVER be messaged
    users.append(_user("c_ordered", "customer", 10, name="Booked User", phone="9000000024", postedTasks=1))
    # 9. New customer (<5h, 1 hour ago) -> must WAIT
    users.append(_user("c_new", "customer", 1, name="Fresh Cust", phone="9000000025"))
    # 10. Test account -> excluded
    users.append(_user("tester1", "partner", 10, name="Test Account", phone="9000000099", isPaymentTester=True))

    # Activated 11h ago: every fixture user signed up after activation
    _activated_hours_ago(client, db, 11)
    assert client.get("/api/whatsapp/incomplete-reg/dashboard").json()["active"] is True
    u_resp = client.get("/api/whatsapp/incomplete-reg/users", params={"refresh": True}).json()
    assert u_resp["counts"]["all"] == 6  # h_old, h_kyc, h_new, c_noloc, c_unk, c_new
    assert u_resp["counts"]["ready"] == 4
    assert u_resp["counts"]["waiting_5h"] == 2
    res = client.post("/api/whatsapp/incomplete-reg/check-now").json()
    assert res["sent"] == 4 and res["helper"] == 2 and res["customer"] == 2

    sent_phones = {s["to"] for s in sent}
    assert sent_phones == {"+919000000011", "+919000000012", "+919000000021", "+919000000022"}
    # Customer template fills first name
    cust_sends = [s for s in sent if s["template"] == "extrahand_customer_reg_pending"]
    assert {s["variables"]["1"] for s in cust_sends} == {"Priya", "Kiran"}

    # Re-running never sends twice to any user
    res2 = client.post("/api/whatsapp/incomplete-reg/check-now").json()
    assert res2["sent"] == 0 and len(sent) == 4

    # Suppose c_new crosses 5 hours AND stayed incomplete, while h_new completed registration
    for u in users:
        if u["uid"].startswith("cnew"):
            u["createdAt"] = (utcnow() - timedelta(hours=6)).isoformat() + "Z"
        if u["uid"].startswith("hnew"):
            u["createdAt"] = (utcnow() - timedelta(hours=6)).isoformat() + "Z"
            u["partnerProfile"] = {"status": "approved", "onboardingCompleted": True}

    res3 = client.post("/api/whatsapp/incomplete-reg/check-now").json()
    assert res3["sent"] == 1
    assert sent[-1]["to"] == "+919000000025"  # only c_new received it; h_new completed so skipped

    # Duplicate account with same phone is also prevented ("per one user one msg thats it")
    users.append(_user("c_dup_phone", "customer", 10, name="Dup", phone="9000000021"))
    res4 = client.post("/api/whatsapp/incomplete-reg/check-now").json()
    assert res4["sent"] == 0
    assert db.query(WhatsAppIncompleteReg).count() == 5


def test_dashboard_shows_completed_users(client, db, fake):
    users, sent, _ = fake
    users.append(_user("h_old", "partner", 10, name="Suresh", phone="9000000011",
                       partnerProfile={"status": "rejected", "onboardingCompleted": False}))
    users.append(_user("h_ok", "partner", 12, name="Done Helper", phone="9000000013",
                       partnerProfile={"status": "approved", "onboardingCompleted": True}))
    users.append(_user("c_noloc", "customer", 7, name="Priya Sharma", phone="9000000021"))
    users.append(_user("c_ok", "customer", 10, name="Ananya", phone="9000000023",
                       location={"addressDetails": {"city": "Siddipet", "state": "Telangana"}}))
    users.append(_user("c_ordered", "customer", 10, name="Booked User", phone="9000000024", postedTasks=1))
    users.append(_user("tester1", "partner", 10, name="Test Account", phone="9000000099", isPaymentTester=True))

    d = client.get("/api/whatsapp/incomplete-reg/dashboard", params={"refresh": True}).json()
    assert d["counts"]["total_incomplete"] == 2
    assert d["counts"]["total_completed"] == 3
    assert d["counts"]["helper_completed"] == 1 and d["counts"]["customer_completed"] == 2
    assert d["counts"]["completed_after_reminder"] == 0

    _activated_hours_ago(client, db, 11)
    client.post("/api/whatsapp/incomplete-reg/check-now")
    # Reminded customer now adds a location -> counted as completed after reminder
    for u in users:
        if u["uid"].startswith("cnoloc"):
            u["location"] = {"addressDetails": {"city": "Hyderabad", "state": "Telangana"}}
    d2 = client.get("/api/whatsapp/incomplete-reg/dashboard", params={"refresh": True}).json()
    assert d2["counts"]["total_incomplete"] == 1
    assert d2["counts"]["total_completed"] == 4
    assert d2["counts"]["completed_after_reminder"] == 1

    lst = client.get("/api/whatsapp/incomplete-reg/completed").json()
    assert lst["total"] == 4 and lst["counts"]["reminded"] == 1 and lst["counts"]["organic"] == 3
    names = {x["name"] for x in lst["items"]}
    assert {"Done Helper", "Ananya", "Booked User", "Priya Sharma"} == names
    assert "Test Account" not in names
    rem = client.get("/api/whatsapp/incomplete-reg/completed", params={"reminded": "yes"}).json()
    assert [x["name"] for x in rem["items"]] == ["Priya Sharma"] and rem["items"][0]["reminded"] is True
    helpers = client.get("/api/whatsapp/incomplete-reg/completed", params={"audience": "helper", "q": "done"}).json()
    assert helpers["total"] == 1 and helpers["items"][0]["phone"]


def test_history_commercials_setup_and_test_send(client, db, fake, monkeypatch):
    users, sent, created_templates = fake
    users.extend([
        _user("h1", "partner", 8, name="Helper One", phone="9000000101",
              partnerProfile={"status": "not_applied", "onboardingCompleted": False}),
        _user("c1", "customer", 8, name="Cust One", phone="9000000102"),
    ])
    _activated_hours_ago(client, db, 11)
    client.post("/api/whatsapp/incomplete-reg/check-now")

    # Wait briefly for metering write thread
    import time
    for _ in range(50):
        db.expire_all()
        if db.query(WhatsAppMessage).filter(WhatsAppMessage.source == "incomplete_reg").count() >= 2:
            break
        time.sleep(0.02)

    # Test send excluded from normal history and commercials
    test_res = client.post("/api/whatsapp/incomplete-reg/test", json={"phone": "+919999988888", "audience": "customer", "name": "Sita"})
    assert test_res.status_code == 200 and test_res.json()["ok"] is True

    hist = client.get("/api/whatsapp/incomplete-reg/history").json()
    assert hist["counts"]["all"] == 2 and hist["counts"]["sent"] == 2
    hist_with_tests = client.get("/api/whatsapp/incomplete-reg/history", params={"include_tests": True}).json()
    assert hist_with_tests["counts"]["all"] == 3

    comm = client.get("/api/whatsapp/incomplete-reg/commercials").json()["periods"]["today"]
    assert comm["helper"]["sent"] == 1 and comm["customer"]["sent"] >= 1

    # Setup submits missing templates cleanly
    async def missing_def(self, name, language=None):
        return None

    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", missing_def)
    setup = client.post("/api/whatsapp/incomplete-reg/setup").json()
    assert setup["ok"] is True
    assert {t["name"] for t in created_templates} == {"extrahand_helper_reg_pending", "extrahand_customer_reg_pending"}
    assert all(t["language"] == "te" for t in created_templates)
