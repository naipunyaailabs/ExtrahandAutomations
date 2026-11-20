"""Automatic job-offer calls start 6 hours (dispatch_lead_hours) before the task's scheduled time."""

from datetime import timedelta

import pytest

from app.models import DispatchStatus, utcnow
from app.services import worker
from app.services.common import call_window, save_runtime_settings
from tests.factories import make_ticket


@pytest.fixture
def auto(db):
    save_runtime_settings(db, {"auto_dispatch": True, "calling_agent_active": True})
    db.commit()


def _new(db, id, when):
    return make_ticket(db, id=id, scheduled_at=when, dispatch_status=DispatchStatus.NEW,
                       assignee_id=None, assignee_name=None, assignee_phone=None)


def test_window_states():
    now = utcnow()

    class T:  # minimal stand-in for a ticket
        dispatch_status = DispatchStatus.NEW

    t = T()
    t.scheduled_at = now + timedelta(hours=7)
    assert call_window(t, 6, now) == ("waiting", t.scheduled_at - timedelta(hours=6))
    t.scheduled_at = now + timedelta(hours=5)
    assert call_window(t, 6, now)[0] == "open"
    t.scheduled_at = now - timedelta(minutes=10)  # uploaded "for now" a moment ago
    assert call_window(t, 6, now)[0] == "open"
    t.scheduled_at = now - timedelta(hours=1)
    assert call_window(t, 6, now)[0] == "missed"
    t.scheduled_at = None
    assert call_window(t, 6, now) == ("flexible", None)


def test_auto_dispatch_waits_until_six_hours_before(db, auto, monkeypatch):
    started = []
    monkeypatch.setattr(worker, "start_dispatch", lambda db, tid, trigger: started.append(tid))
    _new(db, "far", utcnow() + timedelta(hours=8))
    _new(db, "near", utcnow() + timedelta(hours=5))
    _new(db, "now", utcnow() - timedelta(minutes=5))
    _new(db, "old", utcnow() - timedelta(days=1))
    db.commit()
    worker.auto_dispatch(db)
    assert sorted(started) == ["near", "now"]


def test_lead_hours_is_a_runtime_setting(client, db):
    assert client.put("/api/settings", json={"dispatch_lead_hours": 3}).json()["dispatch_lead_hours"] == 3
    assert client.put("/api/settings", json={"dispatch_lead_hours": 0}).status_code == 400
