"""Calls and WhatsApp work orders reach Aadhaar-verified helpers first, then the rest (nearest first in each group)."""

import app.integrations.extrahand as eh
from app.models import Helper
from app.services import dispatch
from app.services.dispatch import find_candidates, helper_priority, upsert_helper
from tests.factories import make_ticket


def test_aadhaar_verified_helpers_come_first_then_nearest():
    helpers = [
        {"helper_id": "near_unverified", "distance_km": 1.0, "aadhaar_verified": False},
        {"helper_id": "far_verified", "distance_km": 9.0, "aadhaar_verified": True},
        {"helper_id": "near_verified", "distance_km": 2.0, "aadhaar_verified": True},
        {"helper_id": "no_distance_verified", "distance_km": None, "aadhaar_verified": True},
        {"helper_id": "mid_unverified", "distance_km": 4.0, "aadhaar_verified": False},
    ]
    assert [h["helper_id"] for h in sorted(helpers, key=helper_priority)] == [
        "near_verified", "far_verified", "no_distance_verified", "near_unverified", "mid_unverified"]


def _cand(uid, km, aadhaar=None):
    c = {"uid": uid.ljust(24, "x"), "name": "Ravi Kumar", "phone": "9000000" + str(len(uid)).zfill(3) + uid[-1:],
         "role": "partner", "distanceKm": km, "skills": ["cleaning"]}
    if aadhaar is not None:
        c["isAadhaarVerified"] = aadhaar
    return c


def test_calls_go_to_aadhaar_verified_helpers_first(db, monkeypatch):
    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None)
    cands = [_cand("nearplain1", 1.0, False), _cand("farverified2", 8.0, True), _cand("midplain3", 3.0, False),
             _cand("nearverified4", 2.0, True)]

    class Src:
        def get_candidates(self, task_id, lat, lng, radius_km):
            return cands

    monkeypatch.setattr(dispatch, "get_source", lambda: Src())
    monkeypatch.setattr(eh, "get_source", lambda: Src())
    out, source = find_candidates(db, ticket)
    assert source == "matching_api"
    order = [c["helper_id"][:13].rstrip("x") for c in out]
    assert order == ["nearverified4", "farverified2", "nearplain1", "midplain3"]


def test_a_record_without_the_aadhaar_field_keeps_the_helpers_mark(db):
    db.add(Helper(id="h" * 24, name="Sita", phone="+919000000050", is_verified=True))
    db.flush()
    # e.g. a matching-API result that does not carry isAadhaarVerified
    upsert_helper(db, {"id": "h" * 24, "name": "Sita", "phone": "+919000000050", "is_verified": False, "verified_known": False})
    assert db.get(Helper, "h" * 24).is_verified is True
    # a full record that says "not verified" does update it
    upsert_helper(db, {"id": "h" * 24, "name": "Sita", "phone": "+919000000050", "is_verified": False, "verified_known": True})
    assert db.get(Helper, "h" * 24).is_verified is False


def test_whatsapp_work_orders_go_to_aadhaar_verified_helpers_first(db):
    from whatsapp.agent import WhatsAppTaskDispatchAgent

    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None, lat=17.4700, lng=78.3600)
    for hid, phone, verified, lat in (("plainnearbyhelper000001", "+919000000061", False, 17.4710),
                                      ("verifiedfarhelper000002", "+919000000062", True, 17.5000),
                                      ("verifiednearhelper00003", "+919000000063", True, 17.4720)):
        db.add(Helper(id=hid, name="Ravi Kumar", phone=phone, is_verified=verified, city="Hyderabad",
                      lat=lat, lng=78.3600, skills=["cleaning"], categories=["cleaning"]))
    db.flush()
    eligible = WhatsAppTaskDispatchAgent().filter_eligible_partners(db, ticket, max_radius_km=10)
    assert [e["helper_id"] for e in eligible] == ["verifiednearhelper00003", "verifiedfarhelper000002", "plainnearbyhelper000001"]
