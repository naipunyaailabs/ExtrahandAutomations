"""A helper assigned here (accepted on our call / WhatsApp YES) is written to ExtraHand, and the task shows who
assigned it and whether ExtraHand has it."""

import asyncio
from datetime import timedelta

from app.models import DispatchStatus, Helper, Ticket, WhatsAppMessage, utcnow
from app.services import assignment

from .factories import make_ticket


class FakeWriter:
    def __init__(self, fail=None):
        self.calls, self.fail = [], fail

    def assign_helper(self, task_id, uid, profile_id, name):
        if self.fail:
            raise RuntimeError(self.fail)
        self.calls.append((task_id, uid, profile_id, name))
        return {"success": True}


def _local(db, via="call"):
    t = make_ticket(db, assignee_id="uid1", assignee_profile_id="prof1", dispatch_status=DispatchStatus.ASSIGNED)
    assignment.mark_local_assignment(t, via)
    db.commit()
    return t


def test_push_ok_marks_ticket_but_keeps_it_local_until_sync_confirms(db, monkeypatch):
    w = FakeWriter()
    monkeypatch.setattr(assignment, "_writer", lambda: w)
    t = _local(db)
    assert t.extrahand_push == "pending" and t.assigned_via == "call"
    assert assignment.push_assignment(db, t.id)
    db.refresh(t)
    assert w.calls == [("t1", "uid1", "prof1", "Suresh")]
    assert t.extrahand_push == "ok" and t.assignment_local_only  # the sync must still see it before trusting it


def test_push_failure_is_recorded(db, monkeypatch):
    monkeypatch.setattr(assignment, "_writer", lambda: FakeWriter(fail="403 forbidden"))
    t = _local(db, via="whatsapp")
    assert not assignment.push_assignment(db, t.id)
    db.refresh(t)
    assert t.extrahand_push == "failed" and "403" in t.extrahand_push_error and t.assignment_local_only


def test_push_starts_only_after_commit(db, monkeypatch):
    started = []
    monkeypatch.setattr(assignment, "_start", started.append)
    t = _local(db)
    assignment.push_assignment_later(db, t.id)
    assert started == []
    db.commit()
    assert started == ["t1"]


def test_retry_endpoint(client, db, monkeypatch):
    monkeypatch.setattr(assignment, "_writer", lambda: FakeWriter(fail="timeout"))
    t = _local(db)
    assert client.post(f"/api/tickets/{t.id}/push-assignment").status_code == 502
    monkeypatch.setattr(assignment, "_writer", lambda: FakeWriter())
    res = client.post(f"/api/tickets/{t.id}/push-assignment")
    assert res.status_code == 200 and res.json()["extrahand_push"] == "ok"
    out = client.get(f"/api/tickets/{t.id}").json()
    assert out["assigned_via"] == "call" and out["extrahand_push"] == "ok"


def test_whatsapp_yes_assigns_the_alerted_task_and_pass_declines(db, monkeypatch):
    from whatsapp.service import get_whatsapp_service

    sent = []

    async def fake_send(to, message, preview_url=True):
        sent.append(message)

    svc = get_whatsapp_service()
    monkeypatch.setattr(svc.client, "send_text_message", fake_send)
    started = []
    monkeypatch.setattr(assignment, "_start", started.append)

    db.add(Helper(id="uidH", profile_id="profH", name="Mahipal", phone="+919812345678"))
    alerted = make_ticket(db, id="alerted", assignee_id=None, assignee_name=None, assignee_phone=None,
                          dispatch_status=DispatchStatus.NEW, created_at=utcnow() - timedelta(hours=1))
    make_ticket(db, id="newer", assignee_id=None, assignee_name=None, assignee_phone=None,
                dispatch_status=DispatchStatus.NEW, created_at=utcnow())
    db.add(WhatsAppMessage(direction="out", phone="919812345678", ticket_id="alerted", purpose="agent_broadcast"))
    db.commit()

    res = asyncio.run(svc.handle_inbound_reply("919812345678", "YES"))
    assert res["action"] == "accepted" and res["ticket_id"] == "alerted"
    db.expire_all()
    t = db.get(Ticket, "alerted")
    assert t.assignee_id == "uidH" and t.assigned_via == "whatsapp" and t.extrahand_push == "pending"
    assert db.get(Ticket, "newer").assignee_id is None
    assert started == ["alerted"]

    # nothing else was alerted to this helper: no assignment, an honest reply
    res = asyncio.run(svc.handle_inbound_reply("919812345678", "YES"))
    assert res["action"] == "no_open_task" and "already been taken" in sent[-1]

    assert asyncio.run(svc.handle_inbound_reply("919812345678", "pass"))["action"] == "rejected"


def test_ticket_list_shows_whatsapp_and_call_summary(client, db):
    from app.models import CallAttempt, Event

    make_ticket(db, id="t1", assignee_id=None, assignee_name=None, assignee_phone=None)
    make_ticket(db, id="t2", assignee_id=None, assignee_name=None, assignee_phone=None)
    for st in ("delivered", "read", "failed", "sent"):
        db.add(WhatsAppMessage(direction="out", phone="91900000000", ticket_id="t1", purpose="agent_broadcast", status=st))
    db.add(WhatsAppMessage(direction="out", phone="91900000000", ticket_id="t1", purpose="reply", status="sent"))
    db.add(CallAttempt(ticket_id="t1", purpose="dispatch", phone="1", provider="simulator", outcome="no_answer"))
    db.add(CallAttempt(ticket_id="t1", purpose="dispatch", phone="2", provider="simulator", outcome="accepted",
                       answered_at=utcnow()))
    db.add(Event(ticket_id="t2", kind="whatsapp_agent_no_match", message="0 matched"))
    db.commit()
    rows = {t["id"]: t for t in client.get("/api/tickets", params={"real_only": False}).json()}
    w = rows["t1"]["whatsapp"]
    assert (w["total"], w["delivered"], w["read"], w["failed"], w["sent"]) == (4, 1, 1, 1, 1)
    c = rows["t1"]["call_summary"]
    assert (c["placed"], c["answered"], c["accepted"], c["last_outcome"]) == (2, 1, 1, "accepted")
    assert rows["t2"]["whatsapp"]["no_match"] and rows["t2"]["call_summary"] is None


def test_old_broadcasts_count_from_their_event(client, db):
    from app.models import Event

    make_ticket(db, id="old", assignee_id=None, assignee_name=None, assignee_phone=None)
    db.add(Event(ticket_id="old", kind="whatsapp_location_broadcast",
                 message="Dispatched WhatsApp task link to 12 helper(s). Status: 9 sent, 2 simulated, 1 failed."))
    db.commit()
    w = {t["id"]: t for t in client.get("/api/tickets", params={"real_only": False}).json()}["old"]["whatsapp"]
    assert (w["total"], w["sent"], w["simulated"], w["failed"]) == (12, 9, 2, 1)
    s = client.get("/api/tickets/outreach-status").json()
    assert set(s) >= {"whatsapp_on", "calls_on", "calling_hours"}
