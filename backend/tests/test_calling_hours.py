"""The calling agent only places calls inside the calling hours (default 7:30 AM - 9:30 PM India time)."""

from datetime import datetime

import pytest

from app.config import Settings
from app.services import common
from app.services.common import calling_hours_state, save_runtime_settings


def test_default_window_is_730am_to_930pm():
    assert Settings.model_fields["calling_hours_start"].default == "07:30"
    assert Settings.model_fields["calling_hours_end"].default == "21:30"


@pytest.mark.parametrize("utc,open_", [
    ("2026-11-16T01:59", False),  # 07:29 IST
    ("2026-11-16T02:00", True),   # 07:30 IST
    ("2026-11-16T15:59", True),   # 21:29 IST
    ("2026-11-16T16:00", False),  # 21:30 IST
    ("2026-11-16T20:00", False),  # 01:30 IST
])
def test_window_in_india_time(db, utc, open_):
    save_runtime_settings(db, {"calling_hours_start": "07:30", "calling_hours_end": "21:30"})
    st = calling_hours_state(db, datetime.fromisoformat(utc))
    assert st["open"] is open_
    assert st["label"] == "7:30 AM – 9:30 PM IST"
    assert (st["next_open"] is None) == open_


def _closed(db, monkeypatch):
    save_runtime_settings(db, {"calling_hours_start": "07:30", "calling_hours_end": "21:30"})
    db.commit()
    monkeypatch.setattr(common, "utcnow", lambda: datetime(2026, 11, 16, 17, 0))  # 22:30 IST


def test_no_job_offer_calls_outside_hours(client, db, monkeypatch):
    from app.services.dispatch import DispatchError, start_dispatch
    from tests.factories import make_ticket

    t = make_ticket(db)
    db.commit()
    _closed(db, monkeypatch)
    with pytest.raises(DispatchError, match="Outside calling hours"):
        start_dispatch(db, t.id)


def test_running_dispatch_pauses_and_resumes(client, db, monkeypatch):
    from app.models import DispatchRun
    from app.services import dispatch
    from tests.factories import make_ticket

    t = make_ticket(db)
    run = DispatchRun(ticket_id=t.id, candidates=[{"helper_id": "h1", "name": "A", "phone": "+919000000001"}])
    db.add(run)
    db.commit()
    _closed(db, monkeypatch)
    dispatch._call_next(db, run)
    db.commit()  # callers commit after _call_next
    assert run.reason == dispatch.WAITING_FOR_HOURS and run.current_index == -1
    assert dispatch.resume_waiting_runs(db) == 0  # still closed

    monkeypatch.setattr(common, "utcnow", lambda: datetime(2026, 11, 17, 3, 0))  # 08:30 IST
    called = []
    monkeypatch.setattr(dispatch, "_call_next", lambda db_, r: called.append(r.id))
    assert dispatch.resume_waiting_runs(db) == 1 and called == [run.id]


def test_status_endpoint_shows_window(client, db):
    save_runtime_settings(db, {"calling_hours_start": "07:30", "calling_hours_end": "21:30"})
    db.commit()
    hours = client.get("/api/calling-agent/status").json()["calling_hours"]
    assert hours["label"] == "7:30 AM – 9:30 PM IST" and "open" in hours


IST = __import__("datetime").timedelta(hours=5, minutes=30)


@pytest.mark.parametrize("task_ist,opens_ist", [
    ("2026-11-18T09:00", "2026-11-17T17:00"),  # 1.5 h that morning + 4.5 h the evening before
    ("2026-11-18T07:00", "2026-11-17T15:30"),  # before opening: all 6 h the evening before
    ("2026-11-18T11:00", "2026-11-17T19:00"),
    ("2026-11-18T14:00", "2026-11-18T08:00"),  # no night inside the 6 h: same as plain 6 h
    ("2026-11-18T23:00", "2026-11-18T15:30"),  # after closing: counted back from 9:30 PM
])
def test_lead_time_skips_the_night(task_ist, opens_ist):
    from app.services.common import calls_open_at

    opens = calls_open_at(datetime.fromisoformat(task_ist) - IST, 6, "07:30", "21:30") + IST
    assert opens == datetime.fromisoformat(opens_ist)


def test_call_window_uses_calling_hours(db):
    from app.services.common import call_window
    from tests.factories import make_ticket

    t = make_ticket(db, scheduled_at=datetime.fromisoformat("2026-11-18T09:00") - IST)
    evening = datetime.fromisoformat("2026-11-17T18:00") - IST  # 6 PM the day before
    assert call_window(t, 6, evening)[0] == "waiting"  # plain 6 h: still waiting until 3 AM
    assert call_window(t, 6, evening, calling_hours=("07:30", "21:30"))[0] == "open"
