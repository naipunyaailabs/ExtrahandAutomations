# Intelligence Platform: helper dispatch (Flow 1)

Pulls bookings from ExtraHand, calls helpers with a keypad (IVR) agent, schedules reminder calls, and hands unplaced tickets to customer care.

```
frontend/   React + Vite dashboard (port 5173)
backend/    FastAPI + SQLAlchemy API and background worker (port 8000)
  database/ SQLite database file (intelligence.db, created on first run)
Doc/        ExtraHand API guide (data.docx)
```

## Flow

1. **Sync.** Every `SYNC_INTERVAL_SECONDS`, or with the *Sync* button, the backend calls `GET /tasks?postedBy=team` (all pages) and `GET /tasks/{id}` for new or changed tickets. If the task has no customer contact, it also calls `GET /users/{customerId}`.
2. **Ticket already has a helper.** Reminder calls are scheduled to that helper before the task starts (default 2h, 1h and 30 min; change this in Settings).
   - Press 1 to confirm. Press 2 for "can't attend", which goes to customer care.
   - If the helper does not confirm on the last reminder, the ticket also goes to customer care.
3. **Ticket has no helper.** Click *Call helpers*, or turn on auto-dispatch.
   - Eligible helpers for the ticket's location and service come from the Task Service matching API (`/api/v1/matches/tasks/{id}/candidates`).
   - If that API isn't configured, the backend falls back to `GET /users?role=helper` and filters by skill and distance itself.
   - Helpers are called one at a time, nearest first. The agent reads out the task, the place, the time and the payment.
     - **1** accepts: the helper is assigned, then reminder calls are scheduled.
     - **2** rejects: the next helper is called.
     - **No key pressed**: the message is repeated, up to 3 times in total, then the agent hangs up and calls the next helper.
     - No answer, busy, or a failed call also moves on to the next helper.
4. **Nobody accepted, or no eligible helpers.** The ticket moves to **Customer care**. From there a person can add notes, mark it resolved, or press *Call helpers again*.

## Run

```powershell
# backend (FastAPI) - first time only
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env

# backend - every time
cd backend
.venv\Scripts\activate
python run.py      # http://127.0.0.1:8000  (API docs: /docs)

# frontend (second terminal)
cd frontend
npm install        # first time only
npm run dev        # http://localhost:5173
```

The frontend calls the FastAPI backend at `/api/...`; the Vite dev server forwards those calls to port 8000 (`frontend/vite.config.ts`).

Out of the box it runs on **mock data** with a **call simulator**: calls ring on the dashboard and you play the helper (Answer, press 1 or 2, Stay silent, and so on). No credentials are needed.

## Going live

In `backend/.env`:

| Setting | Purpose |
|---|---|
| `EXTRAHAND_MODE=live`, `EXTRAHAND_EMAIL`, `EXTRAHAND_PASSWORD` | Real ExtraHand data (login → bearer token, refreshed on 401). |
| `EXTRAHAND_SERVICE_AUTH`, `EXTRAHAND_SERVICE_USER_ID` | Enables the Task Service matching API. Server-side only. |
| `EXTRAHAND_ALLOW_ASSIGNMENT=true` | Lets an accepted call run `POST /tasks/{id}/assign`. Off by default, as the doc warns. While off, the acceptance is recorded only in this platform. |
| `TELEPHONY_PROVIDER=twilio`, `TWILIO_*`, `PUBLIC_BASE_URL` | Real phone calls. `PUBLIC_BASE_URL` must be reachable by Twilio (for example an ngrok URL); the webhooks are under `/api/telephony/twilio/*` and are signature-checked. |

The API guide has no example responses, so all field mapping lives in `backend/app/integrations/mapping.py`. Check it against real responses first: open a ticket and click *Show raw ExtraHand data*.
