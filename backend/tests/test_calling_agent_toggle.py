import pytest
from app.services import dispatch
from app.services.common import runtime_settings, save_runtime_settings
from tests.factories import make_ticket

def test_calling_agent_status_endpoint(client, db):
    # Set to deactive
    client.post("/api/calling-agent/deactivate")
    res = client.get("/api/calling-agent/status")
    assert res.status_code == 200
    data = res.json()
    assert data["active"] is False
    assert data["status"] == "deactive"
    assert data["emergency_stop_calls"] is True

    # Activate
    res = client.post("/api/calling-agent/activate")
    assert res.status_code == 200
    assert res.json()["active"] is True
    assert res.json()["status"] == "active"

    # Status check
    res = client.get("/api/calling-agent/status")
    assert res.json()["active"] is True
    assert res.json()["status"] == "active"

    # Toggle to deactive
    res = client.post("/api/calling-agent/toggle")
    assert res.json()["active"] is False
    assert res.json()["status"] == "deactive"

    # Toggle to active
    res = client.post("/api/calling-agent/toggle", json={"active": True})
    assert res.json()["active"] is True
    assert res.json()["status"] == "active"

def test_dispatch_blocked_when_deactive(client, db):
    client.post("/api/calling-agent/deactivate")
    ticket = make_ticket(db)
    db.commit()

    with pytest.raises(dispatch.DispatchError) as exc_info:
        dispatch.start_dispatch(db, ticket.id)
    assert "DEACTIVATED" in str(exc_info.value)

