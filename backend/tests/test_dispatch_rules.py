"""Who gets called for a task: only helpers allowed to work, and only when free (one helper, one task)."""

import pytest

from app.config import public_url_dns_problem
from app.models import Helper
from app.services.dispatch import _can_take_task
from tests.factories import make_ticket


def _helper(db, hid="h9", **kw) -> Helper:
    h = Helper(id=hid, name="Ramu", phone="+919000000009", **kw)
    db.add(h)
    db.flush()
    return h


def test_a_free_active_helper_can_be_called(db):
    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None)
    _helper(db)
    assert _can_take_task(db, ticket, "h9")


@pytest.mark.parametrize("kw", [
    {"status": "rejected"}, {"status": "Pending Review"}, {"status": "suspended"},
    {"is_active": False}, {"can_accept_tasks": False},
])
def test_blocked_helpers_are_never_called(db, kw):
    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None)
    _helper(db, **kw)
    assert not _can_take_task(db, ticket, "h9")


def test_a_helper_busy_on_another_open_task_is_skipped(db):
    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None)
    _helper(db)
    make_ticket(db, id="t2", assignee_id="h9", status="assigned")
    assert not _can_take_task(db, ticket, "h9")


def test_a_helper_whose_other_task_is_finished_is_free_again(db):
    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None)
    _helper(db)
    make_ticket(db, id="t2", assignee_id="h9", status="completed")
    assert _can_take_task(db, ticket, "h9")


@pytest.mark.real_dns
def test_an_address_that_does_not_exist_is_reported():
    assert "does not exist" in (public_url_dns_problem("https://nothing-here.invalid") or "")
