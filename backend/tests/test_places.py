"""Places are learned from synced ExtraHand data, so a task or helper without GPS is matched in any city."""

import pytest

from app.models import Helper, Ticket
from app.services import places


@pytest.fixture(autouse=True)
def _fresh_index():
    places.reset_cache()
    yield
    places.reset_cache()


def _known(db):
    # A task and a helper with GPS in a city that no list mentions: the index learns "Ponnal", its PIN and areas
    db.add(Ticket(id="gps1", title="x", city="Ponnal", lat=18.0746, lng=78.8544,
                  address="3VF3+JQ, Kasturi Nagar, Ponnal, Telangana 502103, India",
                  raw={"location": {"pinCode": "502103"}}))
    db.add(Helper(id="gpsH", name="Known", phone="9", city="Ponnal", lat=18.08, lng=78.85,
                  address="Plot 12-3, Kasturi Nagar, Ponnal, Telangana 502103"))
    db.flush()


def test_index_learns_city_pin_and_areas_but_not_house_numbers(db):
    _known(db)
    idx = places.place_index(db)
    assert {"ponnal", "502103", "kasturi nagar"} <= set(idx)
    assert not any(k.startswith("3vf3") or k.startswith("plot") for k in idx)


def test_task_without_gps_is_placed_by_pin_and_matched_by_distance(db):
    _known(db)
    t = Ticket(id="t", title="x", city="Siddipet district", address="near temple 502103")
    ok, dist = places.location_match(db, t, 10, lat=18.10, lng=78.85, city="Somewhere")
    assert ok and dist is not None and dist < 5


def test_helper_work_area_counts(db):
    _known(db)
    t = Ticket(id="t", title="x", city="Ponnal", lat=18.0746, lng=78.8544)
    # home 100 km away, but works in Kasturi Nagar (learned from data, slug form as ExtraHand sends it)
    ok, _ = places.location_match(db, t, 10, lat=17.2, lng=78.5, city="Far", work_areas=["kasturi-nagar"])
    assert ok
    ok, _ = places.location_match(db, t, 10, lat=17.2, lng=78.5, city="Far", work_areas=["unknown-area"])
    assert not ok


def test_same_city_still_matches_without_any_gps(db):
    t = Ticket(id="t", title="x", city="Bobbili")
    assert places.location_match(db, t, 10, city="bobbili")[0]
    assert not places.location_match(db, t, 10, city="Warangal")[0]


def test_whatsapp_alert_times_are_india_time():
    """Stored times are UTC; helpers must see the task's India time (18:30 UTC = 12:00 AM next day IST)."""
    from datetime import datetime

    from app.integrations.mapping import ist_text

    assert ist_text(datetime(2026, 11, 17, 18, 30)) == "18 Nov, 12:00 AM"
    assert ist_text(None) == "Flexible"
