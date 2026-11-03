"""Calling & Voice Dispatch Service (Service 1)

This module encapsulates all telephony, IVR, dispatch engine, helper outreach,
ticket workflows, customer care escalations, and post-service feedback.
"""

from fastapi import APIRouter
from app.api import calls, escalations, feedback, helpers, system, tickets, twilio_webhooks

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
    feedback,
):
    calling_router.include_router(module.router)

