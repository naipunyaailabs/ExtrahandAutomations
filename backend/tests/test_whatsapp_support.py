"""WhatsApp Support: language and intent detection, only the sender's own data, YES before a cancel / reschedule
request, cases for the care team, human takeover, duplicates, switches and the webhook signature."""

import hashlib
import hmac
import json

import pytest

from app.models import Escalation, Helper, WaSupportConversation, WaSupportMessage
from whatsapp.support import agent, customer_data, language, intents, webhook
from whatsapp.support import settings as support_settings

ME = "919876500001"
OTHER = "919876500002"

TASKS = [
    {"_id": "w1", "taskId": "EH-101", "title": "Kitchen deep cleaning", "category": "cleaning", "status": "assigned",
     "customerPhone": "+91 98765 00001", "customerName": "Anitha Reddy", "createdAt": "2026-11-20T05:00:00Z",
     "scheduledDate": "2026-11-26T00:00:00Z", "scheduledTimeStart": "10:00", "scheduledTimeEnd": "12:00",
     "paymentAmount": 899, "paymentStatus": "paid", "assignedHelperName": "Ravi", "location": {"city": "Hyderabad"}},
    {"_id": "w2", "title": "AC repair", "status": "completed", "customerPhone": "9876500001",
     "createdAt": "2026-10-01T05:00:00Z", "paymentAmount": 600},
    {"_id": "w9", "title": "Someone else's plumbing", "status": "assigned", "customerPhone": "+919876500002",
     "customerName": "Other Person", "createdAt": "2026-11-21T05:00:00Z", "paymentAmount": 450},
]


@pytest.fixture
def data(monkeypatch):
    monkeypatch.setitem(customer_data.SOURCES, "tasks", lambda: TASKS)
    monkeypatch.setitem(customer_data.SOURCES, "get", lambda path, params=None: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setitem(customer_data.SOURCES, "refunds", lambda: {})
    customer_data._account_cache.clear()
    monkeypatch.setattr(webhook, "SPAWN", lambda fn, *a: fn(*a))
    sent = []
    monkeypatch.setattr(webhook, "_send", lambda phone, text, send: (sent.append((phone, text)) or ("sent", f"wamid.out{len(sent)}")) if send else ("simulated", None))
    monkeypatch.setattr("whatsapp.support.tickets.notify_care_team", lambda db, case: None)
    return sent


def ai(monkeypatch, **reply):
    """The AI answers with this JSON."""
    base = {"language": "en", "intent": "other", "reply": "ok", "action": "none", "booking_id": None,
            "category": None, "summary": "", "new_time": None, "reason": None}
    monkeypatch.setattr(agent, "configured", lambda: True)
    monkeypatch.setattr(agent, "_call", lambda prompt: ({**base, **reply}, {"ms": 5, "tokens": 10, "cost": 0.0001, "error": None}))


# ------------------------------------------------------------------------------------------------ language / intents
@pytest.mark.parametrize("text,lang", [
    ("నా బుకింగ్ ఎప్పుడు?", "te"), ("मेरी बुकिंग कब है?", "hi"), ("naa booking eppudu vastharu?", "te-latn"),
    ("meri booking kab aayegi bhai", "hi-latn"), ("When is my booking?", "en"),
])
def test_language_detection(text, lang):
    assert language.detect(text) == lang


@pytest.mark.parametrize("text,intent", [
    ("I want to cancel my booking", "cancel_request"), ("booking raddu cheyandi", "cancel_request"),
    ("helper raaledu", "complaint_helper"), ("money got deducted twice, charged twice", "complaint_payment"),
    ("where is my refund", "refund_status"), ("naa latest booking status enti?", "booking_status"),
    ("helper came late", "complaint_helper"), ("can I talk to a person", "human_agent"), ("hello", "greeting"),
])
def test_intent_rules(text, intent):
    assert intents.classify(text) == intent


def test_yes_no_words():
    assert language.yes_or_no("YES") == "yes" and language.yes_or_no("avunu") == "yes" and language.yes_or_no("हाँ") == "yes"
    assert language.yes_or_no("no") == "no" and language.yes_or_no("vaddu") == "no"
    assert language.yes_or_no("yes but first tell me the charges for this booking please") is None


# ------------------------------------------------------------------------------------------------ own data only
def test_snapshot_has_only_the_senders_bookings(data):
    snap = customer_data.snapshot(ME)
    assert snap["found"] and snap["total_bookings"] == 2
    assert {b["booking_id"] for b in snap["bookings"]} == {"w1", "w2"}
    b = customer_data.owned_booking(snap, "EH-101")
    assert b["helper_name"] == "Ravi" and b["amount_rupees"] == 899 and b["payment_status"] == "paid"
    assert customer_data.owned_booking(snap, "w9") is None  # another customer's booking


def test_unknown_number_gets_no_data(db, data, monkeypatch):
    monkeypatch.setattr(agent, "configured", lambda: False)
    r = webhook.process_message("919000000000", "booking status", wamid="wamid.a1")
    assert "could not find an ExtraHand account" in r["reply"]
    assert "Kitchen" not in r["reply"]


def test_fallback_answers_status_in_the_customers_language(db, data, monkeypatch):
    monkeypatch.setattr(agent, "configured", lambda: False)
    r = webhook.process_message(ME, "naa booking status enti?", wamid="wamid.a2")
    assert r["language"] == "te-latn" and "Kitchen deep cleaning" in r["reply"] and "Ravi" in r["reply"]
    assert data == [(ME, r["reply"])]  # sent on WhatsApp
    conv = db.query(WaSupportConversation).one()
    assert conv.customer_name == "Anitha Reddy" and conv.language == "te-latn"


# ------------------------------------------------------------------------------------------------ cancel needs YES
def test_cancel_request_needs_yes_and_becomes_a_case(db, data, monkeypatch):
    ai(monkeypatch, intent="cancel_request", action="confirm_cancel", booking_id="w1", reason="plans changed",
       reply="Do you want to cancel Kitchen deep cleaning?", summary="Customer wants to cancel w1")
    r = webhook.process_message(ME, "please cancel my kitchen cleaning", wamid="wamid.c1")
    assert "YES" in r["reply"] and db.query(Escalation).count() == 0  # nothing done yet
    assert json.loads(db.query(WaSupportConversation).one().pending_action)["booking_id"] == "w1"

    r = webhook.process_message(ME, "yes", wamid="wamid.c2")
    case = db.query(Escalation).one()
    assert r["action"] == "cancel_request" and f"#{case.id}" in r["reply"]
    assert (case.source, case.category, case.booking_id, case.ticket_id) == ("whatsapp", "cancel_request", "w1", None)
    assert "plans changed" in case.details and "YES on WhatsApp" in case.details
    assert db.query(WaSupportConversation).one().pending_action is None


def test_no_stops_the_request(db, data, monkeypatch):
    ai(monkeypatch, action="confirm_cancel", booking_id="w1", reply="Cancel it?")
    webhook.process_message(ME, "cancel", wamid="wamid.n1")
    r = webhook.process_message(ME, "no", wamid="wamid.n2")
    assert r["action"] == "declined" and db.query(Escalation).count() == 0


def test_cannot_cancel_someone_elses_booking(db, data, monkeypatch):
    ai(monkeypatch, action="confirm_cancel", booking_id="w9", reply="Cancel it?")
    r = webhook.process_message(ME, "cancel w9", wamid="wamid.x1")
    # w9 is not theirs: the only open booking of theirs is offered instead, never w9
    pending = json.loads(db.query(WaSupportConversation).one().pending_action)
    assert pending["booking_id"] == "w1"
    assert "w9" not in r["reply"]


def test_completed_booking_cannot_be_cancelled(db, data, monkeypatch):
    ai(monkeypatch, action="confirm_cancel", booking_id="w2", reply="Cancel it?")
    r = webhook.process_message(ME, "cancel the AC repair", wamid="wamid.x2")
    assert r["action"] == "not_possible" and db.query(WaSupportConversation).one().pending_action is None


# ------------------------------------------------------------------------------------------------ cases / handover
def test_complaint_creates_a_case_and_handover_pauses_the_ai(db, data, monkeypatch):
    ai(monkeypatch, intent="complaint_helper", action="create_ticket", category="helper_issue", booking_id="w1",
       reply="Sorry! I've created a support case.", summary="Helper was rude")
    webhook.process_message(ME, "the helper was rude", wamid="wamid.h1")
    case = db.query(Escalation).one()
    assert case.category == "helper_issue" and case.booking_id == "w1" and case.customer_name == "Anitha Reddy"

    ai(monkeypatch, intent="human_agent", action="handover", category="human_request", reply="Connecting you.")
    webhook.process_message(ME, "I want to talk to a person", wamid="wamid.h2")
    conv = db.query(WaSupportConversation).one()
    assert conv.mode == "human" and db.query(Escalation).count() == 2
    sent_before = len(data)
    r = webhook.process_message(ME, "hello?", wamid="wamid.h3")
    assert r["skipped"] == "human" and len(data) == sent_before  # a person answers now


def test_duplicate_message_is_answered_once(db, data, monkeypatch):
    monkeypatch.setattr(agent, "configured", lambda: False)
    webhook.process_message(ME, "hi", wamid="wamid.d1")
    assert webhook.process_message(ME, "hi", wamid="wamid.d1") == {"skipped": "duplicate"}
    assert db.query(WaSupportMessage).filter(WaSupportMessage.direction == "in").count() == 1


def test_helpers_who_are_not_customers_keep_their_flows(db, data, monkeypatch):
    db.add(Helper(id="h1", name="Helper One", phone="+919111111111"))
    db.commit()
    assert webhook.process_message("919111111111", "yes I will come", wamid="wamid.p1") == {"skipped": "helper"}


# ------------------------------------------------------------------------------------------------ switches / webhook
def _hook(phone, text, wamid="wamid.w1"):
    return {"entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": phone, "profile": {"name": "Anitha"}}],
        "messages": [{"from": phone, "id": wamid, "type": "text", "text": {"body": text}}]}}]}]}


def test_switches_off_and_test_mode(db, data, monkeypatch):
    monkeypatch.setattr(agent, "configured", lambda: False)
    assert webhook.handle_webhook(_hook(ME, "hi")) == 0  # starts OFF
    support_settings.save(db, {"active": True})
    assert webhook.handle_webhook(_hook(ME, "hi")) == 0  # on, but in test mode without test numbers
    support_settings.save(db, {"test_numbers": ["98765 00001"]})
    assert webhook.handle_webhook(_hook(ME, "hi", "wamid.w2")) == 1
    assert webhook.handle_webhook(_hook(OTHER, "hi", "wamid.w3")) == 0
    assert webhook.handle_webhook(_hook(ME, "STOP", "wamid.w4")) == 0  # opt-out stays with its own handling


def test_webhook_signature(client, db, data, settings):
    settings(meta_app_secret="s3cret")
    body = json.dumps(_hook(ME, "hi")).encode()
    assert client.post("/api/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": "sha256=bad"}).status_code == 403
    good = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    res = client.post("/api/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": good,
                                                                      "Content-Type": "application/json"})
    assert res.status_code == 200


# ------------------------------------------------------------------------------------------------ pages
def test_pages_api(client, db, data, monkeypatch):
    monkeypatch.setattr(agent, "configured", lambda: False)
    r = client.post("/api/whatsapp/support/test-chat", json={"phone": "98765 00001", "text": "booking status"}).json()
    assert "Kitchen deep cleaning" in r["reply"]
    assert data == []  # the tester never sends on WhatsApp
    assert client.get("/api/whatsapp/support/conversations").json() == []  # tester chats are hidden by default
    convs = client.get("/api/whatsapp/support/conversations?include_tests=true").json()
    assert convs[0]["is_test"] and convs[0]["phone"] == ME
    detail = client.get(f"/api/whatsapp/support/conversations/{convs[0]['id']}").json()
    assert len(detail["messages"]) == 2 and detail["customer"]["total_bookings"] == 2
    ov = client.get("/api/whatsapp/support/overview?include_tests=true").json()
    assert ov["periods"]["today"]["messages_in"] == 1 and ov["periods"]["today"]["solved_by_ai"] == 1
    s = client.post("/api/whatsapp/support/settings", json={"active": True, "test_numbers": "9876500001"}).json()
    assert s["active"] and s["test_mode"] and s["test_numbers"] == [ME]


def test_team_reply_and_case_list(client, db, data, monkeypatch):
    monkeypatch.setattr(agent, "configured", lambda: False)
    webhook.process_message(ME, "I want to talk to a person", wamid="wamid.t1")  # fallback: handover
    conv = db.query(WaSupportConversation).one()
    assert conv.mode == "human"
    m = client.post(f"/api/whatsapp/support/conversations/{conv.id}/reply", json={"text": "Hi, Anitha here", "by": "Anitha"}).json()
    assert m["sender"] == "human" and m["status"] == "sent" and data[-1] == (ME, "Hi, Anitha here")
    assert client.post(f"/api/whatsapp/support/conversations/{conv.id}/handback").json()["mode"] == "ai"
    cases = client.get("/api/whatsapp/support/cases").json()
    assert cases[0]["category"] == "human_request" and cases[0]["customer_phone"] == ME
    # the case is a normal Customer Care case, without a task
    listed = client.get("/api/escalations").json()
    assert listed[0]["source"] == "whatsapp" and listed[0]["ticket"] is None
    assert client.patch(f"/api/escalations/{listed[0]['id']}", json={"status": "resolved"}).json()["outcome"] == "achieved"
