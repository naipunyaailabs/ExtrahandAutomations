"""WhatsApp task alerts in waves: 15 helpers, then 10 more every hour while nobody is assigned; never after the task's
time; Aadhaar-verified helpers first; nobody gets the same task twice."""

from datetime import timedelta

import pytest

from app.models import DispatchStatus, Event, Helper, utcnow
from app.services import dispatch
from tests.factories import make_ticket
from whatsapp import waves
from whatsapp.service import WhatsAppDispatchService as WhatsAppService
from whatsapp.models import WhatsAppMessageResponse


@pytest.fixture
def setup(db, monkeypatch):
    """An open task in Hyderabad and 30 matching helpers (12 Aadhaar verified); WhatsApp sends are recorded."""
    t = make_ticket(db, id="taskwave1", scheduled_at=utcnow() + timedelta(hours=10), lat=17.47, lng=78.36,
                    assignee_id=None, assignee_name=None, assignee_phone=None)
    for i in range(30):
        db.add(Helper(id=f"helper{i:02d}".ljust(24, "x"), name=f"Ravi {i}", phone=f"+9190000001{i:02d}",
                      is_verified=i % 5 < 2, city="Hyderabad", lat=17.47 + i * 0.001, lng=78.36,
                      skills=["cleaning"], categories=["cleaning"]))
    db.commit()
    sent: list[str] = []

    async def send(self, payload):
        sent.append(payload.helper_id)
        return WhatsAppMessageResponse(status="sent", message_id=f"wamid.{len(sent)}")

    monkeypatch.setattr(dispatch, "find_candidates", lambda db_, ticket: ([], "db_cache"))
    monkeypatch.setattr(WhatsAppService, "send_dispatch_notification", send)
    return t, sent


def _wave(db, t, now=None):
    claimed = waves.claim_wave(db, t.id, now)
    if claimed:
        waves._send(t.id, claimed[1])
    return claimed


def test_first_wave_is_15_aadhaar_verified_first(db, setup):
    t, sent = setup
    n, batch = _wave(db, t)
    assert n == 1 and len(sent) == 15
    verified = {h.id for h in db.query(Helper).filter(Helper.is_verified.is_(True))}
    assert set(sent[:12]) == verified  # all 12 verified helpers come first...
    assert not set(sent[12:]) & verified  # ...then 3 unverified (nearest)
    assert waves.claim_wave(db, t.id) is None  # the hour is not up: nothing more yet


def test_after_an_hour_10_more_and_nobody_twice(db, setup):
    t, sent = setup
    _wave(db, t)
    later = utcnow() + timedelta(hours=1, minutes=1)
    n, batch = _wave(db, t, later)
    assert n == 2 and len(batch) == 10 and len(sent) == 25 and len(set(sent)) == 25
    n, batch = _wave(db, t, later + timedelta(hours=1, minutes=1))
    assert n == 3 and len(batch) == 5 and len(set(sent)) == 30  # only 5 left
    assert waves.claim_wave(db, t.id, later + timedelta(hours=3)) is None  # nobody left: waves stop
    assert "nobody left" in waves.waves_sent(db, t.id)[-1].message


def test_waves_stop_once_someone_is_assigned(db, setup):
    t, sent = setup
    _wave(db, t)
    t.assignee_id, t.dispatch_status = "helper00".ljust(24, "x"), DispatchStatus.ASSIGNED
    db.commit()
    assert waves.claim_wave(db, t.id, utcnow() + timedelta(hours=2)) is None and len(sent) == 15


def test_nothing_is_sent_once_the_task_time_has_passed(db, setup):
    t, sent = setup
    _wave(db, t)
    assert waves.claim_wave(db, t.id, t.scheduled_at + timedelta(minutes=1)) is None
    late = make_ticket(db, id="tasklate1", scheduled_at=utcnow() - timedelta(minutes=5),
                       assignee_id=None, assignee_name=None, assignee_phone=None)
    db.commit()
    assert waves.claim_wave(db, late.id) is None and len(sent) == 15


def test_the_worker_sends_the_next_wave_when_due(db, setup, monkeypatch):
    t, sent = setup
    # the worker's own path, sending right away instead of in a background thread
    monkeypatch.setattr(waves, "start_due_wave", lambda tid, wait=False: bool(_wave(db, db.get(type(t), tid))))
    assert waves.run_waves(db) == 1 and len(sent) == 15
    assert waves.run_waves(db) == 0  # within the hour
    for e in db.query(Event).filter(Event.kind == waves.WAVE_EVENT):
        e.created_at -= timedelta(hours=1, minutes=1)  # an hour later
    db.commit()
    assert waves.run_waves(db) == 1 and len(sent) == 25
