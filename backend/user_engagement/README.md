# Service 4: User Engagement

Everything for User Engagement lives in this folder:

| File | What it does |
|---|---|
| `extrahand_data.py` | Reads live data from the ExtraHand Main Admin API (customers, Works, support tickets) |
| `service.py` | Dashboard numbers for today, real-customer orders, operational KPIs and CSV exports |
| `categories.py` | Category module: customers of a month in Diamond / Gold / Platinum / Silver |
| `router.py` | The `/api/engagement/...` endpoints |
| `models.py` | Response models |

## Data source (see `Doc/data.docx` and `Doc/Access and clarification.docx`)
Live from the ExtraHand Main Admin API when `EXTRAHAND_MODE=live` (credentials in `backend/.env`, never in code):

- `GET /users?role=customer` - registered customers (total, new today, new this month)
- `GET /tasks` - every Work, all pages (today's / this month's orders, status, active customers)
- `GET /support/tickets` - customer-care tickets (shown as unavailable while the ExtraHand API returns an error)

**Real customers only:** Works posted by the ExtraHand team (`isTeamPosted: true` / `postedBy: team`, which use
test names such as "Customer" and "James Smith") and test accounts (`isPaymentTester`, or a name containing "test")
are left out of every number. The dashboard says how many were left out.

The app's single ExtraHand login is reused (shared with dispatch). The data is read when the backend starts and then
every **5 minutes** (the approved polling interval) in the background; Works are deduplicated by id.
"Today" and "this month" are **India time (IST, UTC+05:30)**. If ExtraHand cannot be reached, the dashboard shows
the local database copy and says so (it never shows mock data).

Order outcome: `completed` = success, `cancelled` / `failed` / `expired` / `rejected` = fail, anything else
(open, assigned, in progress...) = pending. Today's orders = Works booked or scheduled today.

## Endpoints
- `GET /api/engagement/dashboard` - today's dashboard (date, source, customers, active users, orders, support)
- `GET /api/engagement/categories?month=YYYY-MM` - customers of the month by orders placed: Diamond 8+, Gold 5-7,
  Platinum 1-4, Silver 0 (orders booked or scheduled in the month; default this month)
- `GET /api/engagement/categories/silver?page=N` - Silver customers (no order in the month), 50 per page
- `GET /api/engagement/cancellations` - every cancelled real-customer Work, newest first: who cancelled it
  (customer / ExtraHand team / not recorded), reason, time, helper, amount, refund (`cancellations.py`)
- `GET /api/engagement/refunds` - every refund to a real customer (ExtraHand `GET /payments/refunds`, paged with
  `offset`), joined to its Work: amount, amount paid, fee kept, status, Razorpay id, reason, who started it and how
  long after the cancellation (`refunds.py`). Refunds on team / test bookings or on Works ExtraHand no longer has are
  counted separately, not shown
- `GET /api/engagement/kpis` - operational KPIs (volume, acceptance rate, completion rate)
- `GET /api/engagement/overview` - bookings, calls, CSAT and cost overview
- `GET /api/engagement/export?type=bookings|calls|feedback|helpers` - CSV exports
- `GET /api/reports/summary`, `GET /api/reports/export` - older paths, kept for compatibility

