"""Bulk Msgs template list (marketing allow-list) and creating new templates through Meta."""

from whatsapp import bulk_templates
from whatsapp.meta_client import MetaWhatsAppClient

LIVE = [
    {"name": "extrahand_event_announcement", "category": "MARKETING", "status": "APPROVED",
     "components": [{"type": "BODY", "text": "Namaste {{1}}! {{2}}"}]},
    {"name": "extrahand_work_reminder", "category": "UTILITY", "status": "APPROVED",
     "components": [{"type": "BODY", "text": "Reminder {{1}}"}]},
    {"name": "teej_template", "category": "MARKETING", "status": "APPROVED", "components": []},
]


def _fake_meta(monkeypatch, created):
    live = [dict(t) for t in LIVE]

    async def fetch(self):
        return live

    async def create(self, **kw):
        created.append(kw)
        live.append({"name": kw["name"], "category": "MARKETING", "status": "PENDING",
                     "components": [{"type": "BODY", "text": kw["body"]}]})
        return {"ok": True, "id": "123", "status": "PENDING", "category": "MARKETING"}

    monkeypatch.setattr(MetaWhatsAppClient, "fetch_meta_templates", fetch)
    monkeypatch.setattr(MetaWhatsAppClient, "create_template", create)


def test_only_allowed_templates_are_listed(client, db, monkeypatch):
    _fake_meta(monkeypatch, [])
    res = client.get("/api/whatsapp/bulk-templates").json()
    assert [t["id"] for t in res] == ["extrahand_event_announcement"]
    assert res[0]["variables"] == ["1", "2"]
    assert set(bulk_templates.DEFAULT) == {"extrahand_event_announcement", "extrahand_helper_welcome", "extrahand_customer_welcome"}


def test_create_template_submits_marketing_and_adds_to_list(client, db, monkeypatch):
    created = []
    _fake_meta(monkeypatch, created)
    bad = client.post("/api/whatsapp/bulk-templates", json={"name": "Diwali Offer", "body": "Hi {{1}}", "examples": []})
    assert bad.status_code == 400 and "sample value" in bad.json()["detail"]

    res = client.post("/api/whatsapp/bulk-templates",
                      json={"name": "Diwali Offer", "body": "Hi {{1}}, get {{2}} off!", "examples": ["Ravi", "20%"]})
    assert res.status_code == 200, res.text
    assert created[0]["name"] == "diwali_offer" and created[0]["category"] == "MARKETING"
    assert created[0]["examples"] == ["Ravi", "20%"]
    ids = [t["id"] for t in client.get("/api/whatsapp/bulk-templates").json()]
    assert ids == ["extrahand_event_announcement", "diwali_offer"]


def test_bulk_send_fills_blanks_from_typed_values_without_newlines(client, db, monkeypatch):
    """Meta error #132018: a blank must not get the whole multi-line message box text."""
    import asyncio

    client.post("/api/whatsapp/channel-controls", json={"bulk_active": True})
    tmpl = {"name": "extrahand_event_announcement", "category": "MARKETING", "status": "APPROVED",
            "components": [{"type": "BODY", "text": "Namaste {{1}}!\nUpdate: {{2}}.\nClaim: {{3}}"}]}
    sent = []

    async def get_def(self, name, language=None):
        return tmpl

    async def send(self, to, template_name, language_code, components):
        sent.append(components)
        from whatsapp.models import WhatsAppMessageResponse
        return WhatsAppMessageResponse(status="sent", message_id="wamid.x")

    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", get_def)
    monkeypatch.setattr(MetaWhatsAppClient, "_send_template", send)
    res = client.post("/api/whatsapp/send-bulk", json={
        "recipients": [{"phone": "+919392426145", "name": "Manu"}],
        "message": "Namaste {{1}}!\n\nUpdate: {{2}}.",
        "template_id": "extrahand_event_announcement",
        "variables": {"2": "Rs 100 OFF\non cleaning", "3": "https://extrahand.in/offers"},
    })
    assert res.json()["sent_count"] == 1, res.text
    params = [p["text"] for c in sent[0] if c["type"] == "body" for p in c["parameters"]]
    assert params == ["Manu", "Rs 100 OFF on cleaning", "https://extrahand.in/offers"]


def test_delete_template_from_list_and_from_meta(client, db, monkeypatch):
    created, deleted = [], []
    _fake_meta(monkeypatch, created)

    async def delete(self, name):
        deleted.append(name)
        return {"ok": True}

    monkeypatch.setattr(MetaWhatsAppClient, "delete_template", delete)
    client.post("/api/whatsapp/bulk-templates", json={"name": "diwali_offer", "body": "Hi {{1}}", "examples": ["Ravi"]})
    listed = {t["id"]: t["used_by"] for t in client.get("/api/whatsapp/bulk-templates").json()}
    assert listed["extrahand_event_announcement"] == "the default Bulk Msgs template" and listed["diwali_offer"] is None

    # automation templates are protected from deletion at Meta, but can be hidden from Bulk Msgs
    res = client.delete("/api/whatsapp/bulk-templates/extrahand_event_announcement", params={"from_meta": True})
    assert res.status_code == 409 and not deleted
    assert client.delete("/api/whatsapp/bulk-templates/extrahand_event_announcement").json()["ok"]
    assert "extrahand_event_announcement" not in [t["id"] for t in client.get("/api/whatsapp/bulk-templates").json()]

    res = client.delete("/api/whatsapp/bulk-templates/diwali_offer", params={"from_meta": True}).json()
    assert res["deleted_from_meta"] and deleted == ["diwali_offer"]
    assert bulk_templates.allowed_names() == ["extrahand_helper_welcome", "extrahand_customer_welcome"]


def test_create_template_with_language_and_header_image(client, db, monkeypatch):
    created, uploads = [], []
    _fake_meta(monkeypatch, created)

    async def upload(self, data, mime, filename="header.jpg"):
        uploads.append((len(data), mime))
        return {"ok": True, "handle": "4::abc"}

    monkeypatch.setattr(MetaWhatsAppClient, "upload_template_sample", upload)
    body = "నమస్తే {{1}} గారు! ExtraHand వచ్చేసింది!"
    res = client.post("/api/whatsapp/bulk-templates", json={
        "name": "hyd_launch_te", "body": body, "examples": ["Ravi"], "language": "te", "header_image": "brand"})
    assert res.status_code == 200, res.text
    assert created[0]["language"] == "te" and created[0]["header_handle"] == "4::abc"
    assert uploads and uploads[0][1] == "image/jpeg"

    # an uploaded banner must exist; path tricks are not followed
    bad = client.post("/api/whatsapp/bulk-templates", json={
        "name": "x1", "body": "Hi {{1}}", "examples": ["Ravi"], "header_image": "banner", "banner_filename": "../../.env"})
    assert bad.status_code == 400 and "banner" in bad.json()["detail"].lower()


def test_create_template_rejects_named_tags_and_bad_language(client, db, monkeypatch):
    _fake_meta(monkeypatch, [])
    res = client.post("/api/whatsapp/bulk-templates", json={"name": "a", "body": "Hi {name}", "examples": []})
    assert res.status_code == 400 and "{{1}}" in res.json()["detail"]
    res = client.post("/api/whatsapp/bulk-templates",
                      json={"name": "a", "body": "Hi {{1}}", "examples": ["R"], "language": "telugu"})
    assert res.status_code == 400 and "language" in res.json()["detail"].lower()


def test_template_send_uses_the_templates_language(monkeypatch):
    import asyncio

    c = MetaWhatsAppClient(phone_number_id="pn", access_token="tok")
    langs = []

    async def get_def(self, name, language=None):
        return {"name": name, "language": "te", "status": "APPROVED", "components": []}

    async def send(self, to, template_name, language_code, components):
        langs.append(language_code)
        from whatsapp.models import WhatsAppMessageResponse
        return WhatsAppMessageResponse(status="failed", error="test")

    async def record(*a, **kw):
        return None

    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", get_def)
    monkeypatch.setattr(MetaWhatsAppClient, "_send_template", send)
    monkeypatch.setattr("whatsapp.meta_client.record_outbound", record)
    asyncio.run(c.send_template_message("9000000001", "hyd_launch_te"))
    asyncio.run(c.send_template_message("9000000001", "hyd_launch_te", language_code="en"))
    assert langs == ["te", "en"]
