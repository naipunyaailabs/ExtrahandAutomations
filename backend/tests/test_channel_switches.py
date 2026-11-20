"""The four channel switches (calling automation, bulk calling, WhatsApp automation, WhatsApp bulk)
all start DEACTIVE and are toggled independently."""


def test_all_channels_start_deactive(client):
    from app.config import Settings

    # conftest forces CALLING_AGENT_ACTIVE=true for the other tests; the shipped default is off
    assert Settings.model_fields["calling_agent_active"].default is False
    assert client.get("/api/bulk-calling/agent/status").json()["active"] is False
    wa = client.get("/api/whatsapp/channel-controls").json()
    assert wa == {"automation_active": False, "bulk_active": False}


def test_channels_toggle_independently(client):
    client.post("/api/calling-agent/deactivate")
    client.post("/api/whatsapp/channel-controls", json={"bulk_active": True})
    assert client.get("/api/whatsapp/channel-controls").json() == {"automation_active": False, "bulk_active": True}

    client.post("/api/bulk-calling/agent/activate")
    assert client.get("/api/bulk-calling/agent/status").json()["active"] is True
    # Activating bulk channels does not turn on the automated calling agent
    assert client.get("/api/calling-agent/status").json()["active"] is False

    client.post("/api/calling-agent/activate")
    client.post("/api/bulk-calling/agent/deactivate")
    assert client.get("/api/calling-agent/status").json()["active"] is True
    assert client.get("/api/bulk-calling/agent/status").json()["active"] is False


def test_whatsapp_bulk_blocked_while_deactive(client):
    res = client.post(
        "/api/whatsapp/send-bulk",
        json={"recipients": [{"phone": "+919999999999", "name": "A"}], "message": "hi"},
    )
    assert res.status_code == 400
    assert "INACTIVE" in res.json()["detail"]
