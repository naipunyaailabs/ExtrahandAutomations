# Service B: WhatsApp Automation (Meta WhatsApp Business Cloud API)

All WhatsApp messages are sent through Meta's official **WhatsApp Business Cloud API**
(`meta_client.py`, Graph API `https://graph.facebook.com/{version}/{phone_number_id}/messages`).
There is no gateway to run and no phone to pair: Meta hosts the sending number.

## Setup

1. In Meta Business Settings create a **System User**, give it the WhatsApp app, and generate a
   **permanent** access token with `whatsapp_business_messaging` and `whatsapp_business_management`.
   (Tokens from the API Setup page expire after ~24 hours / 60 days.)
2. Set in `backend/.env`:

   ```env
   META_WA_PHONE_NUMBER_ID=...      # WhatsApp > API Setup > Phone number ID
   META_WA_ACCESS_TOKEN=...         # the permanent System User token
   META_WA_BUSINESS_ACCOUNT_ID=...
   META_WA_WEBHOOK_VERIFY_TOKEN=... # any long random value
   META_WA_API_VERSION=v21.0
   WHATSAPP_SIMULATED=false         # true = test mode, nothing is sent
   ```
3. In the Meta app, set the webhook URL to `{PUBLIC_BASE_URL}/api/whatsapp/webhook` with the same
   verify token, and subscribe to `messages`.

`GET /api/whatsapp/status` asks Meta for the sending number, so an expired or wrong token shows as
`AUTH_FAILED` (with Meta's error) on the dashboard instead of "working".

## Files

| File | Purpose |
|---|---|
| `meta_client.py` | Meta Cloud API client: text + template sends, live status check |
| `agent.py` | Matches helpers by location + service and broadcasts task alerts |
| `service.py` | Dispatch / reminder messages used by the worker |
| `router.py` | `/api/whatsapp/*` endpoints (status, send, bulk, templates, webhook) |
| `models.py` | Request / response models |

## Endpoints

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/whatsapp/status` | Live Meta connection state and real / simulated / failed message counts |
| `POST` | `/api/whatsapp/send-message` | Send one text message |
| `POST` | `/api/whatsapp/send-dispatch` | Send a work order to one helper |
| `POST` | `/api/whatsapp/broadcast-task` | Send a task alert to all matched helpers |
| `POST` | `/api/whatsapp/send-bulk` | Bulk message to uploaded contacts |
| `GET/POST` | `/api/whatsapp/webhook` | Meta webhook verification and inbound messages |
