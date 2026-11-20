# IVR hand-off voice agent

Takes over a bridged IVR call (a helper pressing 2 on a reminder, a customer rating 1 or 2 stars) in Maya's voice,
asks the one question, records the answer in the backend and hangs up. Design: `Docs/2026-11-04-hybrid-ivr-vobiz-design.md`.

## Tests
```
python -m pip install -r requirements.txt -r requirements-dev.txt     # Python 3.12
python -m pytest -q
```

## Deploy the agent (once; needs the LiveKit CLI `lk`, flag names per `lk agent --help`)
```
cd voice-handoff
lk cloud auth                  # pick the project in livekit.toml (extrahand-x225lfad)
lk agent create                # builds the Dockerfile and writes the agent id into livekit.toml
# secrets for the agent: SARVAM_API_KEY, OPENROUTER_API_KEY, BACKEND_BASE_URL (the backend's public https address)
lk agent deploy                # after later code changes
```

## LiveKit trunk and dispatch rule
```
python setup_livekit.py --env-file ../../CallingVoiceAgentUI/.env --dry-run --vobiz-addresses --sip-uri <SIP URI>
python setup_livekit.py --env-file ../../CallingVoiceAgentUI/.env --vobiz-addresses --sip-uri <SIP URI>
```
- **`--sip-uri` is the project's SIP address**: LiveKit Cloud > Project settings > SIP URI (`sip:<id>.sip.livekit.cloud`), or
  the project id `p_<id>`. It is built from the project id, **not** from the project's web address (`<name>.livekit.cloud`),
  so it cannot be worked out from `LIVEKIT_URL`. A call to a guessed address is refused with `404 No trunk found`, and Vobiz
  then reports `Network Error` (code 5000).
- `--vobiz-addresses` allows the SIP signaling addresses Vobiz publishes
  (<https://www.vobiz.ai/docs/concepts/ip-whitelisting>); add others with `--allowed-address <CIDR>`.
- The called address is `ivr-<attempt>-<token>`, not a phone number, so the trunk accepts any number, and LiveKit then
  requires SIP credentials or an address allow-list. LiveKit saves `allowed_addresses` but **does not enforce it until its
  support enables the field for the project**; ask them to, otherwise anyone who knows the SIP address can start a session
  (the agent still refuses a call without a valid token). Vobiz's `<Dial><User>` documents no way to send SIP credentials.
- The script prints `HANDOFF_SIP_URI` for the backend.

## Backend `.env` (`backend/.env`, never committed)
```
TELEPHONY_PROVIDER=vobiz
VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN      from CallingVoiceAgentUI/.env
VOBIZ_FROM_NUMBER                    the dedicated IVR number (E.164)
SARVAM_API_KEY                       Maya's Sarvam key
PUBLIC_BASE_URL                      https address Vobiz can reach (tunnel now, the VPS later)
AUDIO_URL_SECRET, HANDOFF_SECRET     random: python -c "import secrets; print(secrets.token_urlsafe(32))"
HANDOFF_SIP_URI                      printed by setup_livekit.py
```
Point the IVR number's inbound URL at `<PUBLIC_BASE_URL>/api/telephony/vobiz/inbound`.

## Before any live call
- **Switch rating calls off for the checklist**: set `workflow_customer_feedback_enabled` to `false` in the dashboard
  settings (or run the backend with `EXTRAHAND_MODE=mock`). With `TELEPHONY_PROVIDER=vobiz` the worker really calls the
  customers of recently completed jobs: those whose job was scheduled within the last `feedback_call_max_age_hours`
  (default 48). Reminders and offers only go to helpers once `auto_dispatch` is on or a ticket is dispatched by hand.
- **Run the backend as a single process** (`uvicorn ... --workers 1`): the lock that keeps a call's state consistent
  lives in the process.

## Live checklist (your own phone only, until the number is declared for automated calls under the TRAI rule)
1. Job offer: Telugu offer with service, area and time only; **1** reads the address; **2** declines.
2. Reminder: **1** confirms. **2** puts Maya on the same call: tell her "running late, 30 minutes" (ticket stays assigned,
   support alert shows ~HH:MM); again with "cannot come" (escalation carries her reason); again with the agent stopped
   (closing line plus the usual alert).
3. Rating: **1** puts Maya on the call and the complaint is saved; **9** brings a call-back about 2 hours later; a missed
   reminder is re-dialled after 10 minutes.
4. What the first call settles: Vobiz's `CallUUID` equals the id the backend stored (if not, every webhook answers 403);
   the SIP headers or the called address reach the agent (log "no call id and token" means neither did); Sarvam reads the
   digits in an address ("Flat 302") sensibly; the hangup callback fields match what `provider_status` reads.
