"""New-task alerts to helpers use the Utility template once Meta approved it, else the old text."""

import asyncio

from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.models import WhatsAppMessageResponse
from whatsapp.service import TASK_ALERT_TEMPLATE, send_task_alert

TEMPLATE = {
    "name": TASK_ALERT_TEMPLATE, "category": "UTILITY", "status": "APPROVED",
    "components": [
        {"type": "BODY", "text": "Hi {{1}}, a new {{2}} task.\nTask: {{3}}\nLocation: {{4}}\nSchedule: {{5}}\nPayout: {{6}}"},
        {"type": "BUTTONS", "buttons": [{"type": "URL", "text": "View task", "url": "https://extrahand.in/tasks/{{1}}"}]},
    ],
}


def _client(monkeypatch, status):
    sent = {"template": [], "text": []}

    async def get_def(self, name, language=None):
        return {**TEMPLATE, "status": status} if name == TASK_ALERT_TEMPLATE else None

    async def send_tpl(self, to, template, language_code="en", components=None):
        sent["template"].append((template, components))
        return WhatsAppMessageResponse(status="sent", message_id="wamid.t")

    async def send_text(self, to, message, preview_url=True):
        sent["text"].append(message)
        return WhatsAppMessageResponse(status="sent", message_id="wamid.x")

    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", get_def)
    monkeypatch.setattr(MetaWhatsAppClient, "_send_template", send_tpl)
    monkeypatch.setattr(MetaWhatsAppClient, "_send_text", send_text)
    c = MetaWhatsAppClient(phone_number_id="pn", access_token="tok")
    c.simulated = False
    return c, sent


VALUES = ["Ravi", "Home Cleaning", "2BHK deep\ncleaning", "Madhapur", "18 Nov, 10:00 AM", "Rs800"]


def test_approved_template_is_used_with_task_button(monkeypatch, db):
    c, sent = _client(monkeypatch, "APPROVED")
    asyncio.run(send_task_alert(c, "9000000001", "task123", VALUES, "fallback text"))
    assert not sent["text"]
    name, comps = sent["template"][0]
    assert name == TASK_ALERT_TEMPLATE
    body = [p["text"] for x in comps if x["type"] == "body" for p in x["parameters"]]
    assert body == ["Ravi", "Home Cleaning", "2BHK deep cleaning", "Madhapur", "18 Nov, 10:00 AM", "Rs800"]
    button = next(x for x in comps if x["type"] == "button")
    assert button["parameters"][0]["text"] == "task123"


def test_pending_template_falls_back_to_text(monkeypatch, db):
    c, sent = _client(monkeypatch, "PENDING")
    asyncio.run(send_task_alert(c, "9000000001", "task123", VALUES, "fallback text"))
    assert sent["text"] == ["fallback text"] and not sent["template"]


def test_dashboard_endpoint_shows_status_and_filled_example(client, db, monkeypatch):
    async def fetch(self):
        return [{**TEMPLATE, "status": "PENDING"}]

    monkeypatch.setattr(MetaWhatsAppClient, "fetch_meta_templates", fetch)
    r = client.get("/api/whatsapp/task-alert-template").json()
    assert r["status"] == "PENDING" and r["in_use"] == "text" and r["category"] == "UTILITY"
    assert [v["n"] for v in r["variables"]] == ["1", "2", "3", "4", "5", "6"]
    assert "{{" not in r["sample"]["filled_body"] and r["sample"]["filled_body"].startswith("Hi Ravi")
    assert r["button"]["text"] == "View task" and r["fallback_text"]


def test_each_task_is_alerted_once_whichever_path_fires(db, monkeypatch):
    """Upload, sync, after-sync catch-up and the worker all claim first: one task = one alert round."""
    from datetime import timedelta

    from app.models import utcnow
    from tests.factories import make_ticket
    from whatsapp import service

    monkeypatch.setattr(service, "_ALERTED", set())
    future = make_ticket(db, id="task_future", scheduled_at=utcnow() + timedelta(hours=5))
    past = make_ticket(db, id="task_past", scheduled_at=utcnow() - timedelta(days=1))
    db.commit()

    assert service.claim_task_alert(future.id) is True
    assert service.claim_task_alert(future.id) is False  # second path in the same process
    monkeypatch.setattr(service, "_ALERTED", set())  # e.g. after a restart: the DB event still blocks it
    assert service.claim_task_alert(future.id) is False
    assert service.claim_task_alert(past.id) is False  # task time passed: nobody is alerted


def test_auto_paths_respect_the_claim(db, monkeypatch):
    from datetime import timedelta

    from app.models import utcnow
    from tests.factories import make_ticket
    from whatsapp import service
    from whatsapp.agent import get_whatsapp_dispatch_agent

    monkeypatch.setattr(service, "_ALERTED", set())
    monkeypatch.setattr(service, "whatsapp_automation_active", lambda: True)
    started = []
    monkeypatch.setattr(service.threading if hasattr(service, "threading") else __import__("threading"), "Thread",
                        lambda target=None, **kw: type("T", (), {"start": lambda self: started.append(target)})())
    # an open task (nobody assigned yet): only then are helpers alerted
    make_ticket(db, id="task_x", scheduled_at=utcnow() + timedelta(hours=3), assignee_id=None, assignee_name=None,
                assignee_phone=None)
    db.add(__import__("app.models", fromlist=["Helper"]).Helper(
        id="helperx" * 4, name="Ravi Kumar", phone="+919000000071", city="Hyderabad", skills=["cleaning"], categories=["cleaning"]))
    db.commit()

    get_whatsapp_dispatch_agent().dispatch_for_task("task_x")  # sync / upload path
    service.trigger_whatsapp_task_broadcast("task_x")  # worker path
    get_whatsapp_dispatch_agent().dispatch_for_task("task_x")  # after-sync catch-up
    assert len(started) == 1
