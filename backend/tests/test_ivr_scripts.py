import re
from datetime import datetime, timedelta, timezone

import pytest

from app.integrations.mapping import IST
from app.services import ivr
from tests.factories import make_attempt, make_followup, make_ticket

TELUGU = re.compile(r"[ఀ-౿]")
PURPOSES = ("dispatch", "followup", "feedback")


def _attempt(db, ticket, purpose):
    extra = {"followup_id": make_followup(db, ticket).id} if purpose == "followup" else {}
    return make_attempt(db, ticket, purpose, **extra)


def _utc(local: datetime) -> datetime:
    """The naive-UTC form the database stores."""
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def test_offer_has_service_area_price_time_only(db):
    text = ivr.join(ivr.dispatch_parts(make_ticket(db), "Suresh"))
    assert "Kondapur" in text and "Cleaning" in text and "1500" in text
    for secret in ("Flat 302", "Sai Residency", "+91"):
        assert secret not in text


def test_accepted_closing_reads_full_address_not_customer_contact(db):
    ticket = make_ticket(db)
    parts = ivr.closing_parts(db, make_attempt(db, ticket, "dispatch"), "accepted")
    text = ivr.join(parts)
    assert "Flat 302, Sai Residency, Kondapur" in text
    assert "9000000001" not in text and "Ravi" not in text
    assert all(p.personal for p in parts if "Flat 302" in p.text)


@pytest.mark.parametrize("purpose", PURPOSES)
def test_personal_flags(db, purpose):
    ticket = make_ticket(db)
    parts = ivr.all_parts(db, _attempt(db, ticket, purpose))
    when = ivr.when_te(ticket.scheduled_at)
    for p in parts:
        if any(s in p.text for s in ("Suresh", "Ravi", "Kondapur", "Flat 302", when)):
            assert p.personal, p.text
    assert ivr.Part(ivr.REPEAT_PREFIX) in parts and ivr.Part(ivr.INVALID_KEY) in parts
    assert not any(p.personal for p in parts if p.text in (ivr.REPEAT_PREFIX, ivr.INVALID_KEY))


@pytest.mark.parametrize("purpose", PURPOSES)
def test_all_scripts_are_telugu(db, purpose):
    attempt = _attempt(db, make_ticket(db), purpose)
    outcomes = [*ivr.DIGIT_OUTCOMES[purpose].values(), "no_input"]
    texts = [ivr.join(ivr.prompt_parts(db, attempt))] + [ivr.join(ivr.closing_parts(db, attempt, o)) for o in outcomes]
    assert all(TELUGU.search(t) for t in texts), texts


def test_area_falls_back_to_city_when_no_address(db):
    ticket = make_ticket(db, address=None)
    assert ivr.area_of(ticket) == "Hyderabad"
    assert "Hyderabad" in ivr.join(ivr.dispatch_parts(ticket, "Suresh"))


def test_area_skips_pincode_and_city(db):
    assert ivr.area_of(make_ticket(db, address="Plot 5, Madhapur, Hyderabad, 500081")) == "Madhapur"


def test_area_never_exposes_a_house_level_address(db):
    assert ivr.area_of(make_ticket(db, address="Flat 302 Sai Residency Kondapur Hyderabad")) == "Hyderabad"


def test_when_te_names_the_day_and_part_of_day():
    now = datetime(2026, 11, 4, 9, 0, tzinfo=IST)

    def at(day, hour, minute=0):
        return _utc(datetime(2026, 11, day, hour, minute, tzinfo=IST))

    assert ivr.when_te(at(4, 15), now=now) == "ఈరోజు మధ్యాహ్నం 3 గంటలకు"
    assert ivr.when_te(at(5, 18, 30), now=now) == "రేపు సాయంత్రం 6:30 కి"
    assert ivr.when_te(at(7, 9), now=now) == "7 నవంబర్ ఉదయం 9 గంటలకు"
    assert ivr.when_te(at(4, 23), now=now) == "ఈరోజు రాత్రి 11 గంటలకు"
    assert ivr.when_te(None) == ivr.NO_TIME


def test_step_text_joins_its_parts():
    assert ivr.Step((ivr.Part("a"), ivr.Part("b"))).text == "a b"


def test_prompt_repeats_with_a_prefix_then_gives_up(db):
    attempt = make_attempt(db, make_ticket(db), "dispatch", status="ringing")
    first, second, third = (ivr.next_prompt(db, attempt) for _ in range(3))
    assert first.parts[0] != ivr.Part(ivr.REPEAT_PREFIX) and not first.hangup
    assert second.parts[0] == ivr.Part(ivr.REPEAT_PREFIX) and third.parts[0] == ivr.Part(ivr.REPEAT_PREFIX)
    last = ivr.next_prompt(db, attempt)
    assert last.hangup and attempt.outcome == "no_input"


def test_an_unknown_key_repeats_and_a_known_key_finishes(db):
    attempt = make_attempt(db, make_ticket(db), "dispatch", status="in_progress")
    wrong = ivr.press(db, attempt, "7")
    assert wrong.repeat and not wrong.hangup and wrong.parts == (ivr.Part(ivr.INVALID_KEY),)
    done = ivr.press(db, attempt, "2")
    assert done.hangup and attempt.outcome == "rejected"


def test_nothing_is_prepared_or_said_before_a_hand_off(db):
    # Every spoken line is a file Vobiz must download before it can play it, so the bridge to the agent starts at once.
    from tests.factories import make_attempt, make_ticket

    for purpose, digit in (("followup", "2"), ("feedback", "1")):
        attempt = make_attempt(db, make_ticket(db, id=f"t-{purpose}"), purpose, status="in_progress")
        step = ivr.press(db, attempt, digit, can_handoff=True)
        assert step.handoff and step.parts == ()
        assert not any("assistant" in part.text for part in ivr.all_parts(db, attempt))
