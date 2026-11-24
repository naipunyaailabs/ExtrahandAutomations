"""Calling & Voice Dispatch Service (Service 1)

This module encapsulates all telephony, IVR, dispatch engine, helper outreach,
ticket workflows, customer care escalations, and post-service feedback.
"""

from fastapi import APIRouter
from app.api import (
    bulk_calling,
    calls,
    commercials,
    escalations,
    feedback,
    handoff,
    helpers,
    ivr_audio,
    system,
    tickets,
    twilio_webhooks,
    vobiz_webhooks,
    voice,
)

# Master router for Service 1: Calling & Dispatch Operations
calling_router = APIRouter(tags=["Calling Service"])

# Register all calling service sub-modules
for module in (
    tickets,
    calls,
    escalations,
    helpers,
    system,
    twilio_webhooks,
    ivr_audio,
    vobiz_webhooks,
    handoff,
    feedback,
    voice,
    bulk_calling,
    commercials,
):
    calling_router.include_router(module.router)
calling_router.include_router(escalations.team_router)  # Customer Care team: /api/care-team

