"""User Engagement refunds: who started each refund, joining refunds to Works, and leaving out team / test ones."""

from user_engagement import refunds as rf


def test_who_started_the_refund():
    assert rf.started_by("Cancelled by customer", "poster") == "customer"
    assert rf.started_by("Found another solution", "poster") == "customer"
    assert rf.started_by("Helper could not come", "performer") == "helper"
    assert rf.started_by("Admin refund - Full customer refund via Razorpay", "poster") == "admin"
    assert rf.started_by("Full refund recorded by admin; database-only", None) == "admin"
    assert rf.started_by(None, None) == "unknown"


def _refund(rid, task, amount="470.82", paid="470.82", **kw):
    return {"id": rid, "taskId": task, "refundAmount": amount, "reason": "Cancelled by customer", "cancelledBy": "poster",
            "status": "completed", "razorpayRefundId": f"rfnd_{rid}", "createdAt": "2026-11-20T06:00:00Z",
            "completedAt": "2026-11-20T06:00:01Z", "escrow": {"amountInRupees": paid}, **kw}


def _work(tid, **kw):
    return {"_id": tid, "status": "cancelled", "customerId": f"c-{tid}", "customerName": "Asha", "customerPhone": "+91900",
            "title": "Cleaning", "categoryLabel": "Home Cleaning", "location": {"city": "Siddipet"}, "postedBy": "customer",
            "createdAt": "2026-11-19T05:00:00Z", "updatedAt": "2026-11-20T05:00:00Z", **kw}


def test_refunds_are_joined_and_filtered(monkeypatch):
    listed = [_work("a"), _work("b")]
    records = [
        _refund("1", "a"),
        _refund("2", "b", amount="271.82", cancellationFee="199", toPlatform="59.7", toOtherParty="139.3"),
        _refund("3", "gone"),                                   # Work deleted by ExtraHand
        _refund("4", "team"),                                   # ExtraHand team test booking
        _refund("5", "a", teamTest=True),
    ]
    details = {"a": {**_work("a"), "cancelledAt": "2026-11-20T04:00:00Z"}, "b": _work("b"),
               "team": _work("team", postedBy="team", isTeamPosted=True)}

    def read(tid):
        if tid == "gone":
            raise rf.EngagementDataUnavailable("GET /tasks/gone -> 404: Task not found")
        return details[tid]

    monkeypatch.setattr(rf, "_works", {})
    monkeypatch.setattr(rf, "refund_records", lambda: records)
    monkeypatch.setattr(rf, "test_accounts", lambda: {"ids": set(), "names": [], "count": 0})
    monkeypatch.setattr(rf, "all_tasks", lambda: (listed, 1_700_000_000))
    monkeypatch.setattr(rf, "_read_work", read)

    r = rf._load_refunds()
    rows = {x["id"]: x for x in r["rows"]}
    assert set(rows) == {"1", "2"}
    assert r["left_out"] == {"team_or_test": 2, "work_missing": 1, "not_read_yet": 0}
    assert r["amount"] == round(470.82 + 271.82, 2)
    assert rows["1"]["full"] and rows["1"]["hours_to_refund"] == 2.0 and rows["1"]["method"] == "razorpay"
    assert not rows["2"]["full"] and rows["2"]["fee_kept"] == 199 and rows["2"]["to_helper"] == 139.3
    assert rows["1"]["city"] == "Siddipet" and rows["1"]["started_by"] == "customer"
