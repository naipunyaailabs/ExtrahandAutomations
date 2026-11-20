from datetime import timedelta

from app.models import CallAttempt, FollowUp, Ticket, utcnow


def make_ticket(db, **kw) -> Ticket:
    values = dict(
        id="t1", title="Deep cleaning", category="Cleaning", address="Flat 302, Sai Residency, Kondapur",
        city="Hyderabad", budget=1500, scheduled_at=utcnow() + timedelta(days=1),
        customer_name="Ravi", customer_phone="+919000000001",
        assignee_id="h1", assignee_name="Suresh", assignee_phone="+919000000002",
    )
    values.update(kw)
    ticket = Ticket(**values)
    db.add(ticket)
    db.flush()
    return ticket


def make_attempt(db, ticket: Ticket, purpose: str, **kw) -> CallAttempt:
    """A call to the assigned helper, or to the customer when the purpose is feedback."""
    if purpose == "feedback":
        who = dict(customer_id=ticket.customer_id, customer_name=ticket.customer_name, phone=ticket.customer_phone,
                   helper_id=ticket.assignee_id, helper_name=ticket.assignee_name)
    else:
        who = dict(helper_id=ticket.assignee_id, helper_name=ticket.assignee_name, phone=ticket.assignee_phone)
    attempt = CallAttempt(ticket_id=ticket.id, purpose=purpose, **{"provider": "simulator", **who, **kw})
    db.add(attempt)
    db.flush()
    return attempt


def make_followup(db, ticket: Ticket, offset_minutes: int = 60, **kw) -> FollowUp:
    values = dict(
        ticket_id=ticket.id, helper_id=ticket.assignee_id, helper_name=ticket.assignee_name,
        phone=ticket.assignee_phone, offset_minutes=offset_minutes,
        due_at=ticket.scheduled_at - timedelta(minutes=offset_minutes),
    )
    values.update(kw)
    followup = FollowUp(**values)
    db.add(followup)
    db.flush()
    return followup
