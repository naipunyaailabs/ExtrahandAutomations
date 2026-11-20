"""Reviews & Feedback: WhatsApp feedback form to the customer when a task is completed, and the answers."""

import json
from datetime import timedelta

import pytest

from app.models import CustomerFeedback, WhatsAppFeedbackRequest, utcnow
from tests.factories import make_ticket
from whatsapp import feedback
from whatsapp.meta_client import MetaWhatsAppClient
from whatsapp.models import WhatsAppMessageResponse


@pytest.fixture
def meta(monkeypatch):
    sent = []

    async def get_def(self, name, language=None):
        return {"name": name, "status": "APPROVED"}

    async def send(self, to, template_name, language_code="en", components=None, **kw):
        sent.append({"to": to, "template": template_name, "components": components})
        return WhatsAppMessageResponse(status="sent", message_id=f"wamid.{len(sent)}")

    monkeypatch.setattr(MetaWhatsAppClient, "get_template_def", get_def)
    monkeypatch.setattr(MetaWhatsAppClient, "send_template_message", send)
    monkeypatch.setattr(feedback, "_last_check", {"at": 0.0})
    return sent


def _done(db, tid, phone="+919000000001", **kw):
    t = make_ticket(db, id=tid, status="completed", customer_name="ravi kumar", customer_phone=phone,
                    assignee_name="Anand", title="Ceiling Fan Replacement", scheduled_at=utcnow() - timedelta(hours=2), **kw)
    db.commit()
    return t


def _answer(token, work="5", behaviour="4", on_time="2", comment="Came 40 minutes late"):
    resp = {"flow_token": token, "work": work, "behaviour": behaviour, "on_time": on_time, "comment": comment}
    return {"entry": [{"changes": [{"value": {"messages": [{
        "from": "919000000001", "type": "interactive",
        "interactive": {"type": "nfm_reply", "nfm_reply": {"name": "flow", "response_json": json.dumps(resp)}},
    }]}}]}]}


def test_starts_deactive_and_sends_nothing(client, db, meta):
    _done(db, "t_old")
    assert client.get("/api/whatsapp/feedback/requests").json()["counts"]["all"] == 0
    assert feedback.run_feedback(db, force=True) == 0 and not meta


def test_only_tasks_completed_after_activation_get_the_form(client, db, meta):
    _done(db, "t_old")
    client.post("/api/whatsapp/feedback/activate")
    _done(db, "t_new")
    _done(db, "t_nophone", phone=None)

    assert client.post("/api/whatsapp/feedback/check-now").json() == {"sent": 1}
    assert [m["to"] for m in meta] == ["+919000000001"] and meta[0]["template"] == feedback.TEMPLATE
    body = [p["text"] for c in meta[0]["components"] if c["type"] == "body" for p in c["parameters"]]
    assert body == ["Ravi", "Ceiling Fan Replacement", "Anand"]
    button = next(c for c in meta[0]["components"] if c["type"] == "button")
    assert button["sub_type"] == "flow" and button["parameters"][0]["action"]["flow_token"]

    by_ticket = {r.ticket_id: r.status for r in db.query(WhatsAppFeedbackRequest)}
    assert by_ticket == {"t_old": "skipped", "t_new": "sent", "t_nophone": "no_phone"}
    client.post("/api/whatsapp/feedback/check-now")
    assert len(meta) == 1  # once per task


def test_answer_from_whatsapp_is_stored_and_shown(client, db, meta):
    client.post("/api/whatsapp/feedback/activate")
    _done(db, "t1")
    client.post("/api/whatsapp/feedback/check-now")
    token = db.query(WhatsAppFeedbackRequest).filter_by(ticket_id="t1").one().flow_token

    assert client.post("/api/whatsapp/webhook", json=_answer(token)).json()["status"] == "ok"
    db.expire_all()
    r = db.query(WhatsAppFeedbackRequest).filter_by(ticket_id="t1").one()
    assert (r.status, r.work_rating, r.behaviour_rating, r.on_time_rating) == ("answered", 5, 4, 2)
    assert r.comment == "Came 40 minutes late"
    cf = db.query(CustomerFeedback).filter_by(ticket_id="t1").one()
    assert cf.channel == "whatsapp" and cf.complaint_category == "late_arrival" and cf.resolution_status == "new"

    tabs = client.get("/api/whatsapp/feedback/requests", params={"tab": "low"}).json()
    assert tabs["counts"]["received"] == 1 and tabs["counts"]["low"] == 1 and tabs["counts"]["awaiting"] == 0
    item = tabs["items"][0]
    assert item["ratings"] == {"work": 5, "behaviour": 4, "on_time": 2} and item["average"] == 3.67

    ov = client.get("/api/whatsapp/feedback/overview").json()
    assert ov["averages"]["work"] == 5 and ov["counts"]["answered"] == 1 and ov["response_rate"] == 100.0
    assert ov["webhook_last_seen"]

    # a second submit for the same form is ignored
    client.post("/api/whatsapp/webhook", json=_answer(token, work="1"))
    db.expire_all()
    assert db.query(WhatsAppFeedbackRequest).filter_by(ticket_id="t1").one().work_rating == 5


def test_quiet_hours_hold_the_form(client, db, meta, monkeypatch):
    from app.services import common

    client.post("/api/whatsapp/feedback/activate")
    _done(db, "t_night")
    common.save_runtime_settings(db, {"calling_hours_start": "07:30", "calling_hours_end": "21:30"})
    db.commit()
    from datetime import datetime

    monkeypatch.setattr(common, "utcnow", lambda: datetime(2026, 11, 16, 17, 0))  # 22:30 IST
    assert feedback.run_feedback(db, force=True) == 0 and not meta


def test_customer_asked_on_whatsapp_is_not_phoned(client, db, meta, monkeypatch):
    from app.services import feedback_agent

    client.post("/api/whatsapp/feedback/activate")
    _done(db, "t_call")
    client.post("/api/whatsapp/feedback/check-now")
    called = []
    monkeypatch.setattr(feedback_agent, "start_customer_feedback_call", lambda db_, **kw: called.append(kw["ticket_id"]))
    monkeypatch.setattr(feedback_agent, "is_within_calling_hours", lambda db_: True)
    feedback_agent.process_due_feedback_calls(db)
    assert "t_call" not in called


def test_tasks_view_buckets_and_feedback(client, db, meta):
    from app.models import WhatsAppFeedbackRequest as R

    now = utcnow()
    make_ticket(db, id="past_done", status="completed", scheduled_at=now - timedelta(days=3))
    make_ticket(db, id="past_cancel", status="cancelled", scheduled_at=now - timedelta(days=2))
    make_ticket(db, id="future_open", status="open", scheduled_at=now + timedelta(days=3))
    make_ticket(db, id="future_assigned", status="assigned", scheduled_at=now + timedelta(days=2))
    db.add(R(ticket_id="past_done", status="answered", flow_token="tok", work_rating=5, behaviour_rating=5,
             on_time_rating=4, comment="Great"))
    db.commit()

    prev = client.get("/api/whatsapp/feedback/tasks", params={"when": "previous"}).json()
    assert prev["counts"]["previous"] == 2 and prev["counts"]["upcoming"] == 2
    assert prev["states"]["completed"] == 1 and prev["states"]["cancelled"] == 1
    done = next(i for i in prev["items"] if i["id"] == "past_done")
    assert done["state"] == "completed" and done["feedback"]["average"] == 4.67 and done["customer"]["phone"]

    up = client.get("/api/whatsapp/feedback/tasks", params={"when": "upcoming", "state": "in_progress"}).json()
    assert [i["id"] for i in up["items"]] == ["future_assigned"]

    ex = client.get("/api/whatsapp/feedback/example").json()
    assert "{{" not in ex["filled_body"] and [v["n"] for v in ex["values"]] == ["1", "2", "3"]


def test_replies_tabs_and_task_feedback_filter(client, db, meta):
    from app.models import WhatsAppFeedbackRequest as R

    now = utcnow()
    for tid, w, c in (("a", 5, "Super"), ("b", 2, "Late and rude"), ("c", 5, None)):
        make_ticket(db, id=tid, status="completed", scheduled_at=now - timedelta(days=2))
        db.add(R(ticket_id=tid, status="answered", flow_token=f"tok{tid}", work_rating=w, behaviour_rating=w,
                 on_time_rating=w, comment=c, answered_at=now))
    make_ticket(db, id="d", status="completed", scheduled_at=now - timedelta(days=2))
    db.commit()

    counts = client.get("/api/whatsapp/feedback/requests", params={"tab": "received"}).json()["counts"]
    assert (counts["received"], counts["low"], counts["commented"], counts["five_star"]) == (3, 1, 2, 2)

    t = client.get("/api/whatsapp/feedback/tasks", params={"when": "previous", "fb": "not_asked"}).json()
    assert [i["id"] for i in t["items"]] == ["d"]
    assert t["feedback"] == {"best": 2, "good": 0, "worst": 1, "awaiting": 0, "not_asked": 1, "replied": 3, "all": 4}
    worst = client.get("/api/whatsapp/feedback/tasks", params={"when": "previous", "fb": "worst"}).json()
    assert [i["id"] for i in worst["items"]] == ["b"]
    best = client.get("/api/whatsapp/feedback/tasks", params={"when": "previous", "fb": "best"}).json()
    assert sorted(i["id"] for i in best["items"]) == ["a", "c"]


def test_tasks_view_period_funnel(client, db, meta):
    from app.models import WhatsAppFeedbackRequest as R

    now = utcnow()
    for tid, st in (("f1", "answered"), ("f2", "sent"), ("f3", None), ("f4", "failed")):
        make_ticket(db, id=tid, status="completed", scheduled_at=now - timedelta(days=2))
        if st:
            db.add(R(ticket_id=tid, status=st, flow_token=f"t{tid}"))
    make_ticket(db, id="f5", status="open", scheduled_at=now - timedelta(days=2))
    db.commit()
    f = client.get("/api/whatsapp/feedback/tasks", params={"when": "previous", "state": "open"}).json()["funnel"]
    assert f == {"completed": 4, "sent": 2, "received": 1, "pending": 1, "not_asked": 1, "failed": 1, "reply_rate": 50.0}


def test_real_reply_is_kept_exactly_and_marked(client, db, meta):
    client.post("/api/whatsapp/feedback/activate")
    _done(db, "t_form")
    _done(db, "t_text", phone="+919000000002")
    client.post("/api/whatsapp/feedback/check-now")
    token = db.query(WhatsAppFeedbackRequest).filter_by(ticket_id="t_form").one().flow_token

    form = _answer(token, work="4", behaviour="5", on_time="3", comment="Good, a bit late")
    form["entry"][0]["changes"][0]["value"]["messages"][0]["id"] = "wamid.HBgMOTE5MDAwMDAwMDAxFQIAEhgg"
    client.post("/api/whatsapp/webhook", json=form)
    typed = {"entry": [{"changes": [{"value": {"messages": [{
        "from": "919000000002", "id": "wamid.HBgMOTE5MDAwMDAwMDAyFQIAEhgh", "type": "text",
        "text": {"body": "Helper did not clean the fan properly"}}]}}]}]}
    client.post("/api/whatsapp/webhook", json=typed)

    items = {i["id"]: i for i in client.get("/api/whatsapp/feedback/tasks", params={"when": "today"}).json()["items"]}
    rf = items["t_form"]["feedback"]["reply"]
    assert rf["verified"] and rf["source"] == "whatsapp" and rf["via"] == "form" and not rf["stars_guessed"]
    assert rf["raw"] == {"work": "4", "behaviour": "5", "on_time": "3", "comment": "Good, a bit late"}
    assert [a["picked"] for a in rf["answer"]] == ["★★★★  Good", "★★★★★  Excellent", "★★★  Late"]

    rt = items["t_text"]["feedback"]["reply"]
    assert rt["via"] == "text" and rt["stars_guessed"] and rt["raw"]["text"] == "Helper did not clean the fan properly"
    assert rt["messages"][0]["text"] == "Helper did not clean the fan properly" and rt["messages"][0]["verified"]


def test_feedback_commercials(client, db, meta):
    from app.models import WhatsAppMessage as M

    client.post("/api/whatsapp/feedback/activate")
    _done(db, "c1")
    _done(db, "c2", phone="+919000000002")
    client.post("/api/whatsapp/feedback/check-now")
    for i, phone in enumerate(("919000000001", "919000000002")):  # what the Meta client writes for each send
        db.add(M(direction="out", source="automation", purpose="feedback_request", kind="template",
                 template="extrahand_service_feedback", phone=phone, provider_message_id=f"wamid.HBgfb{i}",
                 status="sent", category="utility", created_at=utcnow()))
    db.commit()
    token = db.query(WhatsAppFeedbackRequest).filter_by(ticket_id="c1").one().flow_token
    client.post("/api/whatsapp/webhook", json=_answer(token))

    rep = client.get("/api/whatsapp/feedback/commercials").json()
    today = rep["periods"]["today"]
    assert today["sent"] == 2 and today["replies"] == 1 and today["reply_rate"] == 50.0
    assert today["cost"] > 0 and today["cost_per_reply"] == today["cost"]
    assert len(rep["daily"]) == 30 and rep["daily"][-1]["sent"] == 2
    # _answer() gives 5, 4, 2 -> average 3.67 -> "best"; it has a concern
    assert (today["best"], today["good"], today["worst"], today["with_concerns"]) == (1, 0, 0, 1)
    assert today["avg_rating"] == 3.67
