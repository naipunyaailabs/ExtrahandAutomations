"""Cancellation Follow-up: the "what went wrong?" WhatsApp message to customers who cancel a Work, and their answers."""

import json
from datetime import timedelta, timezone

import pytest

from app.models import WhatsAppCancelFollowup, WhatsAppFeedbackRequest, utcnow
from whatsapp import cancel_followup as cf
from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.models import WhatsAppMessageResponse

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def meta(monkeypatch):
    sent = []

    async def get_def(self, name, language=None):
        return {"name": name, "status": "APPROVED"}

    async def send(self, to, template_name, language_code="en", components=None, **kw):
        sent.append({"to": to, "template": template_name, "components": components})
        return WhatsAppMessageResponse(status="sent", message_id=f"wamid.cx{len(sent)}")

    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", get_def)
    monkeypatch.setattr(MetaWhatsAppClient, "send_template_message", send)
    monkeypatch.setattr(cf, "_last_check", {"at": 0.0, "when": None})
    return sent


@pytest.fixture
def cancellations(monkeypatch):
    """The Cancelled Works rows the job reads (user_engagement/cancellations.py), set per test."""
    rows: list[dict] = []
    import user_engagement.cancellations as uc
    import user_engagement.extrahand_data as ed

    monkeypatch.setattr(uc, "cancellations_summary", lambda: {"rows": rows})
    monkeypatch.setattr(ed, "live_enabled", lambda: True)
    return rows


def _row(tid, minutes_ago=5, side="customer", phone="+919000000001", name="priya reddy", reason="Work no longer needed"):
    when = (utcnow() - timedelta(minutes=minutes_ago)).replace(tzinfo=timezone.utc).astimezone(IST).isoformat()
    return {"id": tid, "side": side, "cancelled_at": when, "customer_name": name, "customer_phone": phone,
            "customer_key": f"c-{phone}", "title": "Deep Bathroom Cleaning", "category": "Bathroom Cleaning",
            "city": "Siddipet", "reason": reason}


def _answer(token, reason="pricing", concern="Too costly for 1 hour"):
    resp = {"flow_token": token, "reason": reason, "concern": concern}
    return {"entry": [{"changes": [{"value": {"messages": [{
        "from": "919000000001", "type": "interactive",
        "interactive": {"type": "nfm_reply", "nfm_reply": {"name": "flow", "response_json": json.dumps(resp)}},
    }]}}]}]}


def test_message_and_form_fit_meta_limits():
    assert len(cf.TEMPLATE_BODY) <= 1024 and "{{1}}" in cf.TEMPLATE_BODY and "{{2}}" in cf.TEMPLATE_BODY
    assert "\n\n\n" not in cf.TEMPLATE_BODY and len(cf.TEMPLATE_FOOTER) <= 60 and len(cf.BUTTON) <= 25
    children = cf.FLOW_JSON["screens"][0]["layout"]["children"]
    radio = next(c for c in children if c["type"] == "RadioButtonsGroup")
    assert len(radio["label"]) <= 30 and all(len(o["title"]) <= 30 for o in radio["data-source"])
    assert len(next(c for c in children if c["type"] == "TextArea")["label"]) <= 20
    assert len(next(c for c in children if c["type"] == "TextSubheading")["text"]) <= 80
    assert len(next(c for c in children if c["type"] == "Footer")["label"]) <= 35


def test_starts_off_and_sends_nothing(client, db, meta, cancellations):
    cancellations.append(_row("w1"))
    ov = client.get("/api/whatsapp/cancel-followup/overview").json()
    assert ov["active"] is False
    assert cf.run_cancel_followup(db, force=True) == 0 and not meta


def test_only_customer_cancellations_after_activation_get_the_message(client, db, meta, cancellations):
    client.post("/api/whatsapp/cancel-followup/activate")
    cancellations.extend([
        _row("before", minutes_ago=60 * 24 * 10),        # cancelled before activation: never messaged
        _row("new"),
        _row("team", side="team", phone="+919000000002"),  # cancelled by ExtraHand, not the customer
        _row("nophone", phone=""),
    ])
    # activation was "now": move it back so the 5-minute-old cancellations count as after it
    cf._save_state(db, since=(utcnow() - timedelta(hours=1)).isoformat())

    assert client.post("/api/whatsapp/cancel-followup/check-now").json() == {"sent": 1}
    assert [m["to"] for m in meta] == ["+919000000001"] and meta[0]["template"] == cf.TEMPLATE
    body = [p["text"] for c in meta[0]["components"] if c["type"] == "body" for p in c["parameters"]]
    assert body == ["Priya", "Priya"]  # the name, in the English and the Telugu part
    button = next(c for c in meta[0]["components"] if c["type"] == "button")
    assert button["parameters"][0]["action"]["flow_token"].startswith("cxl_")

    assert {r.task_id: r.status for r in db.query(WhatsAppCancelFollowup)} == {"new": "sent", "nophone": "no_phone"}
    client.post("/api/whatsapp/cancel-followup/check-now")
    assert len(meta) == 1  # once per Work


def test_one_message_per_customer_per_week(client, db, meta, cancellations):
    client.post("/api/whatsapp/cancel-followup/activate")
    cf._save_state(db, since=(utcnow() - timedelta(hours=1)).isoformat())
    cancellations.extend([_row("a", minutes_ago=20), _row("b", minutes_ago=10)])  # same customer, two Works
    client.post("/api/whatsapp/cancel-followup/check-now")
    assert len(meta) == 1
    assert {r.task_id: r.status for r in db.query(WhatsAppCancelFollowup)} == {"a": "sent", "b": "skipped_repeat"}
    out = client.get("/api/whatsapp/cancel-followup/replies").json()
    assert [r["task_id"] for r in out["not_sent"]] == ["b"] and out["counts"]["all"] == 1  # listed apart from the messaged


def test_answer_is_stored_and_not_taken_as_feedback(client, db, meta, cancellations):
    client.post("/api/whatsapp/cancel-followup/activate")
    cf._save_state(db, since=(utcnow() - timedelta(hours=1)).isoformat())
    cancellations.append(_row("w1"))
    client.post("/api/whatsapp/cancel-followup/check-now")
    token = db.query(WhatsAppCancelFollowup).one().flow_token

    assert client.post("/api/whatsapp/webhook", json=_answer(token)).json()["status"] == "ok"
    db.expire_all()
    r = db.query(WhatsAppCancelFollowup).one()
    assert (r.status, r.answer_reason, r.answer_note) == ("answered", "pricing", "Too costly for 1 hour")
    assert db.query(WhatsAppFeedbackRequest).count() == 0

    ov = client.get("/api/whatsapp/cancel-followup/overview").json()
    assert ov["stats"]["answered"] == 1 and ov["stats"]["answer_rate"] == 100.0
    assert next(x for x in ov["stats"]["reasons"] if x["id"] == "pricing")["count"] == 1
    assert ov["recent"][0]["answer_reason_label"] == "Pricing issue"


def test_switch_off_stops_sending(client, db, meta, cancellations):
    client.post("/api/whatsapp/cancel-followup/activate")
    client.post("/api/whatsapp/cancel-followup/deactivate")
    cancellations.append(_row("w1"))
    assert cf.run_cancel_followup(db, force=True) == 0 and not meta


def test_messages_list_shows_status_and_answers_without_calling_meta(client, db, meta, cancellations, monkeypatch):
    client.post("/api/whatsapp/cancel-followup/activate")
    cf._save_state(db, since=(utcnow() - timedelta(hours=1)).isoformat())
    cancellations.extend([_row("w1"), _row("w2", phone="+919000000009", name="ravi")])
    client.post("/api/whatsapp/cancel-followup/check-now")
    token = db.query(WhatsAppCancelFollowup).filter_by(task_id="w1").one().flow_token
    client.post("/api/whatsapp/webhook", json=_answer(token, reason="helper_unavailable", concern=""))

    async def no_meta(*a, **k):
        raise AssertionError("the messages list must not call Meta")

    monkeypatch.setattr(cf, "_template_info", no_meta)
    out = client.get("/api/whatsapp/cancel-followup/messages").json()
    assert out["stats"]["sent"] == 2 and out["stats"]["answered"] == 1 and out["stats"]["waiting"] == 1
    assert out["stats"]["read"] == 1 and out["stats"]["with_note"] == 0  # an answer means it was read
    by_task = {r["task_id"]: r for r in out["rows"]}
    assert by_task["w1"]["answer_reason_label"] == "Helper unavailable" and by_task["w2"]["status"] == "sent"


def _typed(phone_digits, text, msg_id):
    return {"entry": [{"changes": [{"value": {"messages": [{
        "from": phone_digits, "id": msg_id, "type": "text", "text": {"body": text},
    }]}}]}]}


def test_replies_show_form_answers_and_typed_messages(client, db, meta, cancellations):
    client.post("/api/whatsapp/cancel-followup/activate")
    cf._save_state(db, since=(utcnow() - timedelta(hours=1)).isoformat())
    cancellations.extend([_row("w1"), _row("w2", phone="+919000000009", name="ravi")])
    # a message from this number BEFORE the follow-up is not a reply to it
    client.post("/api/whatsapp/webhook", json=_typed("919000000001", "earlier message", "wamid.in0"))
    client.post("/api/whatsapp/cancel-followup/check-now")
    token = db.query(WhatsAppCancelFollowup).filter_by(task_id="w1").one().flow_token
    client.post("/api/whatsapp/webhook", json=_answer(token, reason="pricing", concern="Too costly"))
    client.post("/api/whatsapp/webhook", json=_typed("919000000001", "Please call me back", "wamid.in1"))

    out = client.get("/api/whatsapp/cancel-followup/replies").json()
    assert out["counts"] == {"all": 2, "replied": 1, "form": 1, "typed": 1, "no_reply": 1}
    assert out["not_sent"] == []
    c = next(x for x in out["conversations"] if x["task_id"] == "w1")
    assert c["answer_reason_label"] == "Pricing issue" and c["answer_note"] == "Too costly"
    assert [t["text"] for t in c["texts"]] == ["Please call me back"]
    assert out["conversations"][0]["task_id"] == "w1"  # latest activity first


def test_test_sends_are_listed_on_request_and_costed(client, db, meta):
    assert client.post("/api/whatsapp/cancel-followup/test", json={"phone": "+91 90140 55636", "name": "manohar"}).json()["ok"]
    # hidden by default, shown with include_tests (marked as tests)
    assert client.get("/api/whatsapp/cancel-followup/replies").json()["counts"]["all"] == 0
    out = client.get("/api/whatsapp/cancel-followup/replies", params={"include_tests": True}).json()
    assert out["counts"]["all"] == 1 and out["conversations"][0]["is_test"] is True
    msgs = client.get("/api/whatsapp/cancel-followup/messages", params={"include_tests": True}).json()
    assert msgs["stats"]["sent"] == 1 and msgs["stats"]["tests"] == 1
    assert client.get("/api/whatsapp/cancel-followup/messages").json()["stats"]["sent"] == 0
    assert "webhook_last_seen" in out and "items" in out["costs"]
