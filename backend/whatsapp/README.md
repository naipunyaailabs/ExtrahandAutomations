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
| `cancel_followup.py` | Cancellation Follow-up: bilingual "what went wrong?" template + reason form (Flow) to customers who cancel a Work; off until activated |

## Endpoints

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/whatsapp/status` | Live Meta connection state and real / simulated / failed message counts |
| `POST` | `/api/whatsapp/send-message` | Send one text message |
| `POST` | `/api/whatsapp/send-dispatch` | Send a work order to one helper |
| `POST` | `/api/whatsapp/broadcast-task` | Send a task alert to all matched helpers |
| `POST` | `/api/whatsapp/send-bulk` | Bulk message to uploaded contacts |
| `GET/POST` | `/api/whatsapp/webhook` | Meta webhook verification and inbound messages |
| `GET` | `/api/whatsapp/cancel-followup/overview` | Cancellation Follow-up: switch, template + form, Meta status, results, customers messaged |
| `POST` | `/api/whatsapp/cancel-followup/setup` | Create + publish the reason form and submit the template to Meta |
| `POST` | `/api/whatsapp/cancel-followup/activate` / `deactivate` | Switch on (only cancellations from then on) / off |
| `POST` | `/api/whatsapp/cancel-followup/test` | Send the message to one number to try it |

## WhatsApp Support (AI customer support agent) — `whatsapp/support/`

Customer Engagement → WhatsApp Support (Dashboard, Conversations, Support Cases, Settings & Test).

- A registered customer writes to the business number in Telugu, Hindi or English (also in English letters); the agent
  answers in the same language from **their own** ExtraHand data (Main Admin API: Works, account, refunds), matched on
  the WhatsApp number. It never shows another customer's booking.
- Cancel / reschedule: the agent asks for a **YES**; only then a Customer Care case is created for the team (the agent
  never cancels, reschedules or refunds by itself: ExtraHand's cancel / reschedule APIs are not available to this app).
- Complaints and "talk to a person" become Customer Care cases (`escalations.source = whatsapp`, task link optional);
  "handover" pauses the AI until the team hands the chat back (Conversations page).
- Starts **OFF** and in **test mode** (only test numbers get AI replies). Settings live in `app_settings` (`wa_support_*`).
- Webhook: `/api/whatsapp/webhook` checks Meta's `X-Hub-Signature-256` when `META_APP_SECRET` is set; each message id
  is processed once; helpers who are not customers keep the work-order flows; STOP stays with the opt-out handling.
- AI: OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, default Gemini 2.5 Flash). Without it (or when it fails)
  fixed replies in the customer's language answer status questions and hand the rest to the team.
- Tables: `wa_support_conversations`, `wa_support_messages` (+ new columns on `escalations`).
- API: `/api/whatsapp/support/*` (settings, overview, conversations, reply / takeover / handback / close, cases, test-chat).
