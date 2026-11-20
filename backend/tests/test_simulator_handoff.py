from app.models import CustomerFeedback, Escalation
from app.services import ivr
from tests.factories import make_attempt, make_followup, make_ticket

LATE = {"kind": "reminder", "decision": "running_late", "eta_minutes": 30, "reason": "Traffic",
        "summary": "Stuck in traffic.", "transcript": "[Maya]: why late?"}
COMPLAINT = {"kind": "rating", "complaint_category": "rude_behavior", "details": "Helper was rude",
             "summary": "Customer upset."}


def _ringing_call(db, purpose):
    ticket = make_ticket(db, dispatch_status="assigned")
    extra = {"followup_id": make_followup(db, ticket, 60, status="calling").id} if purpose == "followup" else {}
    attempt = make_attempt(db, ticket, purpose, status="ringing", **extra)  # a simulated call by default
    db.commit()
    return ticket, attempt


def _act(client, attempt, action, **fields):
    return client.post(f"/api/simulator/calls/{attempt.id}", json={"action": action, **fields})


def _reasons(db, ticket):
    return [e.reason for e in db.query(Escalation).filter_by(ticket_id=ticket.id)]


def test_simulator_reminder_handoff_running_late(client, db):
    ticket, attempt = _ringing_call(db, "followup")
    _act(client, attempt, "answer")
    pressed = _act(client, attempt, "press", digit="2").json()
    assert pressed["call"]["status"] == "handoff" and not pressed["spoken"]  # nothing is said before the agent
    done = _act(client, attempt, "handoff_result", result=LATE).json()
    assert done["call"]["status"] == "ended" and done["call"]["outcome"] == "running_late"
    assert done["call"]["summary"] == "Stuck in traffic."
    assert done["call"]["handoff"]["eta_minutes"] == 30 and "transcript" not in done["call"]["handoff"]
    db.refresh(ticket)
    assert ticket.dispatch_status == "assigned" and _reasons(db, ticket) == ["helper_running_late"]


def test_simulator_handoff_failed_falls_back(client, db):
    ticket, attempt = _ringing_call(db, "followup")
    _act(client, attempt, "answer")
    _act(client, attempt, "press", digit="2")
    done = _act(client, attempt, "handoff_failed").json()
    assert done["call"]["status"] == "ended" and done["call"]["outcome"] == "declined"
    assert done["spoken"] == ivr.CLOSING_LINES["declined"]
    assert _reasons(db, ticket) == ["helper_cannot_attend"]


def test_simulator_rating_handoff_records_the_complaint(client, db):
    ticket, attempt = _ringing_call(db, "feedback")
    _act(client, attempt, "answer")
    pressed = _act(client, attempt, "press", digit="1").json()
    assert pressed["call"]["status"] == "handoff" and not pressed["spoken"]
    done = _act(client, attempt, "handoff_result", result=COMPLAINT).json()
    assert done["call"]["outcome"] == "rating_1"
    assert db.query(CustomerFeedback).filter_by(ticket_id=ticket.id).one().complaint_category == "rude_behavior"


def test_simulator_hangup_during_handoff_falls_back(client, db):
    ticket, attempt = _ringing_call(db, "followup")
    _act(client, attempt, "answer")
    _act(client, attempt, "press", digit="2")
    done = _act(client, attempt, "hangup").json()
    assert done["call"]["outcome"] == "declined" and _reasons(db, ticket) == ["helper_cannot_attend"]


def test_handoff_actions_need_a_call_that_is_with_the_agent(client, db):
    ticket, attempt = _ringing_call(db, "followup")
    _act(client, attempt, "answer")
    for action, fields in (("handoff_result", {"result": LATE}), ("handoff_failed", {})):
        r = _act(client, attempt, action, **fields)
        assert r.status_code == 400 and "voice agent" in r.json()["detail"]
    _act(client, attempt, "press", digit="2")
    assert _act(client, attempt, "press", digit="1").status_code == 400  # no keys while with the agent
    r = _act(client, attempt, "handoff_result")
    assert r.status_code == 400 and "result" in r.json()["detail"]


def test_a_result_of_the_wrong_kind_is_refused_and_the_call_stays_with_the_agent(client, db):
    ticket, attempt = _ringing_call(db, "followup")
    _act(client, attempt, "answer")
    _act(client, attempt, "press", digit="2")
    assert _act(client, attempt, "handoff_result", result=COMPLAINT).status_code == 400
    assert client.get("/api/calls").json()[0]["status"] == "handoff"


def test_calls_without_a_hand_off_report_none(client, db):
    ticket, attempt = _ringing_call(db, "followup")
    assert client.get("/api/calls").json()[0]["handoff"] is None
