from app.models import Ticket
from tests.factories import make_ticket


def test_ticket_round_trips(db):
    make_ticket(db)
    db.commit()
    assert db.get(Ticket, "t1").city == "Hyderabad"
