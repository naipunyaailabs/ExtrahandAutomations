# Service B: WhatsApp Automation (OpenWA Integration)

This folder contains the **WhatsApp Automation Service** for ExtraHand, integrated with **OpenWA** (Open Source Self-Hosted WhatsApp API Gateway).

## 📌 What is OpenWA & Why Use It?

**Repository:** [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA)

OpenWA is a free, 100% open-source, self-hosted WhatsApp API Gateway. Instead of paying per-conversation fees with Meta's official WhatsApp Business Cloud API or third-party providers (like Twilio WhatsApp / Wati / Gupshup), OpenWA turns any regular or business WhatsApp number into a programmable REST API & Webhook gateway.

### Key Capabilities of OpenWA:
1. **Self-Hosted & Zero Subscription Fees**: Runs on your own server or Docker container with full data ownership.
2. **Dual Engine Support**:
   - `whatsapp-web.js`: Runs headless Chromium browser. Matches real WhatsApp Web traffic (lower ban risk).
   - `baileys`: Lightweight multi-device WebSocket connection (low memory ~50MB RAM).
3. **Full REST API & Webhooks**:
   - Outbound: Send text messages, media, interactive options, templates.
   - Inbound: Webhook push events for received messages, read receipts, session disconnects.
4. **Built-in Web Dashboard**: A modern React UI on port 2785 for scanning QR codes, managing sessions, inspecting queues, and setting API keys.
5. **Anti-Ban Guardrails**: Built-in human typing simulator (`SIMULATE_TYPING`), delay pacing between messages, and send rate limits.

---

## 🗂️ Folder Structure (Folder B)

```
backend/whatsapp/
├── openwa_client.py            # Async HTTP Client for OpenWA REST API
├── service.py                  # ExtraHand Dispatch & Reminder message builder
├── models.py                   # Pydantic schemas for messages & webhooks
├── router.py                   # FastAPI Router (/api/whatsapp/*)
├── docker-compose.openwa.yml   # 1-command Docker Compose for OpenWA gateway
└── README.md                   # Complete service documentation
```

---

## 🚀 How to Run & Connect

### Step 1: Start OpenWA Gateway (via Docker)
```powershell
docker compose -f backend/whatsapp/docker-compose.openwa.yml up -d
```
The OpenWA Dashboard and API will now be live on `http://localhost:2785`.

#### Without Docker (native Node.js 22.19+)
```powershell
git clone https://github.com/rmyndharis/OpenWA.git openwa-gateway   # from the repo root; it is gitignored
cd openwa-gateway
copy .env.minimal .env
# In .env, use your installed Chrome instead of downloading one:
#   PUPPETEER_EXECUTABLE_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
#   AUTO_START_SESSIONS=true
$env:PUPPETEER_SKIP_DOWNLOAD="true"; npm ci
npm run dev        # API on http://localhost:2785, dashboard on http://localhost:2886
```
On first boot OpenWA writes its admin API key to `openwa-gateway/data/.api-key`.

### Step 2: Point the backend at the gateway
In `backend/.env`:
```
WHATSAPP_SIMULATED=false
WHATSAPP_API_KEY=<contents of data/.api-key>
```
Restart the backend. It creates the `extrahand-dispatch` session in OpenWA on first use, starts it,
and registers `WHATSAPP_WEBHOOK_URL` so helper replies reach `/api/whatsapp/webhook`.

### Step 3: Link Your WhatsApp Number
1. In the dashboard, open **WhatsApp Agent > Device & Pairing** and click **Connect WhatsApp**.
2. Scan the QR code with the admin phone (**Settings > Linked Devices > Link a Device**). The QR refreshes itself while the dialog is open.
3. Once linked, the dialog closes and the status switches to `WORKING`.

*(Note: In development, if Docker is not running, the Python service automatically runs in simulated mode so you can test endpoints without a real WhatsApp number!)*

---

## 📡 FastAPI Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/whatsapp/status` | Check OpenWA gateway connection & session state |
| `GET` | `/api/whatsapp/qr` | Get live companion QR code |
| `POST` | `/api/whatsapp/start` | Initialize or restart WhatsApp session |
| `POST` | `/api/whatsapp/send-message` | Send arbitrary text message to any phone number |
| `POST` | `/api/whatsapp/send-dispatch` | Send structured job dispatch alert to a helper |
| `POST` | `/api/whatsapp/webhook` | Receives inbound replies (OpenWA webhook target) |

---

## 💬 Dispatch & Helper Reply Workflow

1. **Dispatch Alert**: Helper receives job details with task title, address, timing, and payout.
2. **Helper Replies**:
   - Replies **1** or **ACCEPT**: System accepts the booking, assigns the helper in SQLite DB, and schedules reminders.
   - Replies **2** or **REJECT**: System declines the task for this helper and dispatches to the next nearest candidate.

---

## ⚠️ Safe Sending Guidelines
- Use a dedicated SIM card for automation (never personal numbers).
- Warm up newly registered numbers gradually over the first week.
- Do not cold-blast unknown contacts. Only message opted-in helpers and customers.
