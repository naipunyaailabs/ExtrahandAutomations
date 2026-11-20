import io
import pytest
from app.models import BulkCallCampaign, BulkCallItem

def test_normalize_phone():
    from app.api.bulk_calling import normalize_phone
    valid, formatted, _ = normalize_phone("9876543210")
    assert valid is True
    assert formatted == "+919876543210"

    valid, formatted, _ = normalize_phone("+919876543210")
    assert valid is True
    assert formatted == "+919876543210"

    valid, _, _ = normalize_phone("123")
    assert valid is False

def test_parse_csv_file(client):
    csv_data = "Name,Phone\nSuresh,9876543210\nNaresh,+919123456789\nBad,123\n"
    res = client.post(
        "/api/bulk-calling/parse-file",
        files={"file": ("test.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 3
    assert data["valid_count"] == 2
    assert data["invalid_count"] == 1
    assert data["contacts"][0]["name"] == "Suresh"
    assert data["contacts"][0]["formatted"] == "+919876543210"

def test_campaign_create_and_lifecycle(client, db):
    payload = {
        "title": "Festival Reminder Bulk",
        "script": "నమస్కారం! ExtraHand నుండి ప్రత్యేక ఆఫర్.",
        "language": "te-IN",
        "contacts": [
            {"name": "Helper 1", "phone": "9876543210"},
            {"name": "Helper 2", "phone": "9876543211"}
        ]
    }
    res = client.post("/api/bulk-calling/campaigns", json=payload)
    assert res.status_code == 200
    camp_id = res.json()["id"]
    assert res.json()["status"] == "inactive"
    assert res.json()["total_contacts"] == 2

    # Get campaign details
    res = client.get(f"/api/bulk-calling/campaigns/{camp_id}")
    assert res.status_code == 200
    assert len(res.json()["contacts"]) == 2
    assert res.json()["contacts"][0]["status"] == "pending"

    # Bulk Calling starts DEACTIVE: a campaign cannot start until the global switch is activated
    assert client.get("/api/bulk-calling/agent/status").json()["active"] is False
    res = client.post(f"/api/bulk-calling/campaigns/{camp_id}/activate")
    assert res.status_code == 409
    res = client.post("/api/bulk-calling/agent/activate")
    assert res.json()["active"] is True

    # Activate campaign
    res = client.post(f"/api/bulk-calling/campaigns/{camp_id}/activate")
    assert res.status_code == 200
    assert res.json()["status"] == "active"

    # Deactivate / pause campaign
    res = client.post(f"/api/bulk-calling/campaigns/{camp_id}/deactivate")
    assert res.status_code == 200
    assert res.json()["status"] == "paused"

    # Cancel campaign
    res = client.post(f"/api/bulk-calling/campaigns/{camp_id}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"


def test_parse_xlsx_file(client):
    import zipfile
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as zf:
        zf.writestr(
            "xl/sharedStrings.xml",
            '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><t>Phone</t></si><si><t>Kiran</t></si></sst>'
        )
        zf.writestr(
            "xl/worksheets/sheet1.xml",
            '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9876543210</v></c></row>'
            '</sheetData></worksheet>'
        )
    bio.seek(0)
    res = client.post(
        "/api/bulk-calling/parse-file",
        files={"file": ("test.xlsx", bio, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["valid_count"] == 1
    assert data["contacts"][0]["name"] == "Kiran"
    assert data["contacts"][0]["formatted"] == "+919876543210"


