"""User Engagement regions: states and cities built from users' saved locations, with typed-in values tidied."""

from user_engagement import regions


def _user(state="", city="", country="India", created="2026-01-01T00:00:00Z", **kw):
    loc = {"addressDetails": {"state": state, "city": city, "country": country}} if (state or city) else {"type": "Point"}
    return {"name": "Someone", "createdAt": created, "location": loc, **kw}


def test_state_and_city_names_are_tidied():
    assert regions._state(" telangana ") == regions._state("TS") == regions._state("Telengana") == "Telangana"
    assert regions._state("Hyderabad") is None
    assert regions._city("hyderabad ") == "Hyderabad" and regions._city("Bangalore") == "Bengaluru"
    for junk in ("2-1-1", "116/P", "", "  ", "8-2-67/9/2"):
        assert regions._city(junk) == regions.NO_CITY, junk


def test_regions_are_built_from_the_data(monkeypatch):
    customers = [
        _user("Telangana", "Hyderabad"), _user("TS", "hyderabad"), _user("Telangana", "Siddipet"),
        _user("Hyderabad", "Hyderabad"),          # state field holds a city: state taken from the city
        _user("Madhapur", "Telangana"),           # state typed in the city field
        _user("Goa", "Panaji"),                   # a brand-new state appears on its own
        _user("Somewhere", "Nowhere"),            # unknown state and city
        _user("Hanoi", "Hanoi", country="Vietnam"),
        _user(),                                  # no location
        _user("Telangana", "Hyderabad", isPaymentTester=True),  # test account: left out
    ]
    helpers = [_user("Telangana", "Hyderabad"), _user("Telangana", "Warangal")]
    monkeypatch.setattr(regions, "_read_role", lambda role: [
        u for u in (customers if role == "customer" else helpers) if not u.get("isPaymentTester")])

    r = regions._load_regions()
    by = {s["name"]: s for s in r["states"]}
    tg = by["Telangana"]
    cities = {c["name"]: c for c in tg["cities"]}
    assert tg["customers"] == 5 and tg["helpers"] == 2
    assert cities["Hyderabad"]["customers"] == 3 and cities["Hyderabad"]["helpers"] == 1
    assert cities["Warangal"]["helpers"] == 1 and cities["Warangal"]["customers"] == 0
    assert by["Goa"]["customers"] == 1 and by["Goa"]["kind"] == "state"
    assert by[regions.UNCLEAR]["customers"] == 1 and by[regions.ABROAD]["customers"] == 1
    assert by[regions.NO_LOCATION]["customers"] == 1
    assert r["states"][0]["name"] == "Telangana"  # biggest first
    assert [s["name"] for s in r["states"][-3:]] == [regions.UNCLEAR, regions.ABROAD, regions.NO_LOCATION]
    assert r["totals"]["states"] == 2 and r["totals"]["customers"] == 9 and r["totals"]["helpers"] == 2
