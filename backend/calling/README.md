# Service 1: Automated Calling & Telephony Service

## Overview
The Calling Service orchestrates voice-based helper dispatch, live IVR phone calls, customer service follow-ups, helper performance matching, and customer care escalations.

## Key Endpoints
- `/api/tickets` - Task ingestion, scheduling, and live ExtraHand sync
- `/api/tickets/{id}/dispatch` - Trigger sequential voice outreach to nearby helpers
- `/api/calls` - Real-time call tracking and telephony attempt logs
- `/api/simulator/calls/{id}` - Interactive IVR keypad simulator for testing
- `/api/helpers` - ExtraHand service partner directory, skills, and shift availability
- `/api/escalations` - Customer care resolution queue for unaccepted or delayed bookings
- `/api/feedback` - Automated post-service customer satisfaction voice ratings & complaints
- `/api/reports` - Operational dispatch and conversion analytics

## Architecture
- **Provider**: Twilio Voice API / Interactive Simulator
- **TTS Engine**: Amazon Polly (Aditi - Indian English / Hindi / Telugu prompts)
- **Database**: PostgreSQL / SQLite (tickets, call_attempts, helpers, escalations, followups)

