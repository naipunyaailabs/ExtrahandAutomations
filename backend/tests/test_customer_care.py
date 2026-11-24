"""Customer Care: cases closed as achieved / rejected, dashboard counts per period, and the care team."""

from datetime import timedelta

from app.models import Escalation, utcnow
from tests.factories import make_ticket


def _case(db, cid, status="open", outcome=None, assigned_to=None, days_ago=0, resolved_days_ago=None):
    t = make_ticket(db, id=f"task{cid}")
    e = Escalation(id=cid, ticket_id=t.id, reason="no_helper_accepted", status=status, outcome=outcome,
                   assigned_to=assigned_to, created_at=utcnow() - timedelta(days=days_ago),
                   resolved_at=(utcnow() - timedelta(days=resolved_days_ago)) if resolved_days_ago is not None else None)
    db.add(e)
    db.commit()
    return e


def test_closing_a_case_records_achieved_or_rejected(client, db):
    _case(db, 1)
    _case(db, 2)
    r = client.patch("/api/escalations/1", json={"status": "resolved", "outcome": "achieved"}).json()
    assert r["status"] == "resolved" and r["outcome"] == "achieved"
    r = client.patch("/api/escalations/2", json={"status": "resolved", "outcome": "rejected", "notes": "Customer cancelled"}).json()
    assert r["outcome"] == "rejected"
    assert client.patch("/api/escalations/2", json={"status": "open"}).json()["outcome"] is None  # reopened
    client.patch("/api/escalations/1", json={"status": "open"})
    assert client.patch("/api/escalations/1", json={"status": "resolved", "outcome": "maybe"}).status_code == 400


def test_dashboard_counts_per_period_and_per_member(client, db):
    client.post("/api/care-team", json={"name": "Anitha", "phone": "+91 90000 00001"})
    _case(db, 1, assigned_to="Anitha")                                              # today, pending
    _case(db, 2, status="in_progress", assigned_to="anitha")                         # today, pending (name, any case)
    _case(db, 3, status="resolved", outcome="achieved", assigned_to="Anitha", days_ago=0, resolved_days_ago=0)
    _case(db, 4, status="resolved", outcome="rejected", days_ago=40, resolved_days_ago=40)  # long ago
    s = client.get("/api/escalations/stats").json()
    today, all_time = s["periods"]["today"], s["periods"]["all"]
    assert today == {"received": 3, "done": 1, "achieved": 1, "rejected": 0, "pending": 2, "achieved_rate": 100}
    assert all_time["received"] == 4 and all_time["achieved"] == 1 and all_time["rejected"] == 1 and all_time["achieved_rate"] == 50
    assert s["now"]["open"] == 1 and s["now"]["in_progress"] == 1 and s["now"]["unassigned"] == 0
    anitha = s["members"][0]
    assert (anitha["name"], anitha["assigned"], anitha["working_on"], anitha["achieved"]) == ("Anitha", 3, 2, 1)


def test_team_members_can_be_added_and_removed(client, db):
    r = client.post("/api/care-team", json={"name": "  Ravi   Kumar ", "phone": "+91 98765-43210", "role": "Lead"}).json()
    assert r["name"] == "Ravi Kumar" and r["phone"] == "+919876543210" and r["role"] == "Lead"
    assert client.post("/api/care-team", json={"name": "ravi kumar"}).status_code == 400  # already in the team
    assert client.post("/api/care-team", json={"name": "  "}).status_code == 400
    assert [m["name"] for m in client.get("/api/care-team").json()] == ["Ravi Kumar"]
    assert client.delete(f"/api/care-team/{r['id']}").json() == {"ok": True}
    assert client.get("/api/care-team").json() == []


def test_team_member_can_be_edited_and_keeps_their_cases(client, db):
    a = client.post("/api/care-team", json={"name": "Anitha"}).json()
    client.post("/api/care-team", json={"name": "Ravi"})
    _case(db, 1, assigned_to="anitha")
    r = client.patch(f"/api/care-team/{a['id']}", json={"name": "Anitha Reddy", "phone": "+91 90000 00001", "role": "Lead"}).json()
    assert (r["name"], r["phone"], r["role"]) == ("Anitha Reddy", "+919000000001", "Lead")
    db.expire_all()
    assert db.get(Escalation, 1).assigned_to == "Anitha Reddy"
    member = client.get("/api/escalations/stats").json()["members"][0]
    assert member["name"] == "Anitha Reddy" and member["assigned"] == 1
    assert client.patch(f"/api/care-team/{a['id']}", json={"name": "ravi"}).status_code == 400  # name taken
    assert client.patch("/api/care-team/999", json={"name": "X"}).status_code == 404
