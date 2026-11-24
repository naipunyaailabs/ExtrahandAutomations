"""User Engagement cancelled Works: who cancelled (customer / ExtraHand team / not recorded) and the row details."""

from user_engagement import cancellations as c


def test_who_cancelled():
    me = {"cust1"}
    assert c.cancelled_by("Work no longer needed", "cust1", me) == "customer"      # the customer's own account
    assert c.cancelled_by("Cancelled by customer", None, me) == "customer"         # ExtraHand's customer label
    assert c.cancelled_by("Cancelled by customer", "staff9", me) == "customer"     # entered by staff for the customer
    assert c.cancelled_by("Admin refund via Razorpay", None, me) == "team"
    assert c.cancelled_by("Cancelled orphaned test tasks to unblock dev user deletion", None, me) == "team"
    assert c.cancelled_by(None, "staff9", me) == "team"
    assert c.cancelled_by(None, None, me) == "unknown"


def _task(tid, status="cancelled", **kw):
    return {"_id": tid, "status": status, "customerId": f"c-{tid}", "customerName": "Asha", "customerPhone": "+91900",
            "title": "Cleaning", "categoryLabel": "Home Cleaning", "location": {"city": "Siddipet", "taskArea": "Ganesh Nagar"},
            "createdAt": "2026-11-20T05:00:00Z", "updatedAt": "2026-11-21T05:00:00Z", "paymentAmount": 177,
            "postedBy": "customer", **kw}


def test_rows_are_built_and_details_read_once(monkeypatch):
    tasks = [_task("a"), _task("b"), _task("c"), _task("d", status="completed"),
             _task("e", isTeamPosted=True, postedBy="team")]
    details = {
        "a": {"cancellationReason": "Found another solution", "cancelledAt": "2026-11-21T04:00:00Z", "cancelledById": "c-a"},
        "b": {"cancellationReason": "Admin refund via Razorpay", "cancelledAt": "2026-11-22T04:00:00Z",
              "isRefunded": True, "refundedAt": "2026-11-22T04:00:00Z"},
        "c": {},
    }
    reads = []
    from user_engagement import refunds as rf

    monkeypatch.setattr(rf, "refunds_by_task", lambda: {"a": {"amount": 177.0, "refunded_at": "2026-11-21T05:00:00Z"}})
    monkeypatch.setattr(c, "_details", {})
    monkeypatch.setattr(c, "test_accounts", lambda: {"ids": set(), "names": [], "count": 0})
    monkeypatch.setattr(c, "all_tasks", lambda: (tasks, 1_700_000_000))
    monkeypatch.setattr(c, "_read_detail", lambda tid: reads.append(tid) or details[tid])

    r = c._load_cancellations()
    rows = {x["id"]: x for x in r["rows"]}
    assert set(rows) == {"a", "b", "c"}                       # completed and team-posted Works left out
    assert r["by_side"] == {"customer": 1, "team": 1, "unknown": 1}
    assert rows["a"]["side"] == "customer" and rows["a"]["reason"] == "Found another solution"
    assert rows["a"]["cancelled_at"].startswith("2026-11-21") and rows["a"]["city"] == "Siddipet"
    assert rows["b"]["side"] == "team" and rows["b"]["refunded"]                # Work's own isRefunded flag
    assert rows["a"]["refunded"] and rows["a"]["refund_amount"] == 177.0        # from the refunds API
    assert rows["c"]["side"] == "unknown" and rows["c"]["cancelled_at"] is None
    assert r["rows"][0]["id"] == "b"                          # newest cancellation first
    assert [x["id"] for x in r["completed"]] == ["d"] and r["completed"][0]["amount"] == 177  # completed Works for the cards

    c._load_cancellations()
    assert sorted(reads) == ["a", "b", "c"]                   # details are not read again when nothing changed
    tasks[0]["updatedAt"] = "2026-11-23T05:00:00Z"
    c._load_cancellations()
    assert sorted(reads) == ["a", "a", "b", "c"]              # ...but are when ExtraHand changed the Work


def test_card_numbers_are_computed_by_the_api(client, monkeypatch):
    import user_engagement.extrahand_data as ed

    data = {
        "fetched_at": "2026-11-23T10:00:00+05:30",
        "rows": [
            {"id": "a", "side": "customer", "cancelled_at": "2026-11-20T10:00:00+05:30", "booked_at": None, "city": "Siddipet",
             "category": "plumbing", "reason": "Pricing", "amount": 300.0, "refunded": True, "refund_amount": 250.0, "payment_type": "paid"},
            {"id": "b", "side": "customer", "cancelled_at": "2026-11-21T10:00:00+05:30", "booked_at": None, "city": "",
             "category": "Bathroom Cleaning", "reason": None, "amount": 500.0, "refunded": False, "refund_amount": None, "payment_type": "paid"},
            {"id": "c", "side": "team", "cancelled_at": "2026-11-21T10:00:00+05:30", "booked_at": None, "city": "Siddipet",
             "category": "plumbing", "reason": "Admin", "amount": 999.0, "refunded": False, "refund_amount": None, "payment_type": "paid"},
        ],
        "completed": [
            {"id": "x", "when": "2026-11-20T09:00:00+05:30", "amount": 400.0, "city": "Siddipet", "category": "plumbing"},
            {"id": "y", "when": "2026-10-01T09:00:00+05:30", "amount": 600.0, "city": "Hyderabad", "category": "Kitchen Cleaning"},
        ],
    }
    monkeypatch.setattr(ed, "live_enabled", lambda: True)
    monkeypatch.setattr(c, "cancellations_summary", lambda: data)

    s = client.get("/api/engagement/cancellations/summary").json()
    assert s["cancelled"] == {"count": 2, "value": 800.0, "rate": 50}
    assert s["refunded"] == {"count": 1, "share": 50, "returned": 250.0, "paid": 300.0}
    assert s["not_refunded"] == {"count": 1, "share": 50, "value": 500.0, "paid_bookings": 1}
    assert s["completed"] == {"count": 2, "received": 1000.0, "average": 500.0}

    # filters: period (to is exclusive), city, category as shown on the page, who cancelled
    s = client.get("/api/engagement/cancellations/summary", params={"from": "2026-11-01", "to": "2026-12-01", "city": "Siddipet"}).json()
    assert s["cancelled"]["count"] == 1 and s["completed"] == {"count": 1, "received": 400.0, "average": 400.0}
    s = client.get("/api/engagement/cancellations/summary", params={"category": "Plumbing", "side": "all"}).json()
    assert s["cancelled"]["count"] == 2 and s["completed"]["count"] == 1
    assert client.get("/api/engagement/cancellations/summary", params={"city": "City not set"}).json()["cancelled"]["count"] == 1
