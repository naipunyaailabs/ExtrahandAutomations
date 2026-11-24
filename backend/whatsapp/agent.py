"""Autonomous WhatsApp Task Dispatch Agent.
Located in backend/whatsapp/agent.py

Workflow:
1. When a new customer task is uploaded or synced from ExtraHand, this agent activates.
2. Extracts Location (city, address, coordinates) and Service (category & trade skills).
3. Evaluates all registered helpers:
   - Location Filter: Haversine distance within configured radius (km) or matching city.
   - Service Filter: Matches helper trade skill tags against service taxonomy clusters.
4. Concurrently broadcasts formatted WhatsApp work alerts to all matching helpers with direct in-app accept links.
5. Records audit events and logs in the database.
"""

import asyncio
import logging
import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.integrations.mapping import ist_text
from app.branding import company, task_link
from app.config import get_settings
from app.database import SessionLocal
from app.models import DispatchStatus, Event, Helper, Ticket, utcnow
from app.services.common import log_event, runtime_settings
from app.services.dispatch import helper_matches_ticket_service
from app.services.places import location_match
from whatsapp.models import WhatsAppDispatchPayload
from whatsapp.meta_client import get_meta_whatsapp_client
from whatsapp.metering import tagged

logger = logging.getLogger("whatsapp.dispatch_agent")






class WhatsAppTaskDispatchAgent:
    """Autonomous Python Agent for location- and service-based helper dispatch on WhatsApp."""

    def __init__(self):
        self.settings = get_settings()
        self.client = get_meta_whatsapp_client()

    def filter_eligible_partners(
        self,
        db: Session,
        ticket: Ticket,
        max_radius_km: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """Strictly filter helpers matching BOTH the requested service and customer location."""
        rt = runtime_settings(db)
        effective_radius = max_radius_km if max_radius_km is not None else (rt.match_radius_km or self.settings.match_radius_km)

        # Query all active helpers with a valid phone number
        helpers = db.query(Helper).filter(
            Helper.phone.isnot(None),
            Helper.phone != ""
        ).all()

        eligible: List[Dict[str, Any]] = []
        seen_phones = set()

        from app.services.real_data import is_real_helper

        for h in helpers:
            if not is_real_helper(h):
                continue  # tester / test / mock account: never messaged
            clean_phone = "".join(c for c in (h.phone or "") if c.isdigit())[-self.settings.phone_local_digits:]
            if not clean_phone or clean_phone in seen_phones:
                continue

            # 1. Location: GPS distance, else places learned from ExtraHand data (PIN / city / areas / work areas)
            location_matched, dist_km = location_match(
                db, ticket, effective_radius, lat=h.lat, lng=h.lng, city=h.city, address=h.address,
                pincode=h.pincode, work_areas=h.work_areas,
            )
            if not location_matched:
                continue
            dist_km = round(dist_km, 1) if dist_km is not None else None

            # 2. Service & Skill Matching: Check if helper skills match task category
            service_matched = helper_matches_ticket_service(ticket, h.skills, getattr(h, "categories", None))
            if not service_matched:
                continue

            seen_phones.add(clean_phone)
            eligible.append({
                "helper_id": h.id,
                "name": h.name or "Partner",
                "phone": clean_phone,
                "distance_km": dist_km,
                "city": h.city or "Local",
                "skills": h.skills or [],
                "is_verified": bool(h.is_verified),
                "aadhaar_verified": bool(h.is_verified),
            })

        # Aadhaar-verified helpers first, then the rest; nearest first within each group (same order as calls)
        from app.services.dispatch import helper_priority

        eligible.sort(key=helper_priority)
        return eligible

    def compose_notification_message(self, ticket: Ticket, partner: Dict[str, Any]) -> str:
        """Compose a high-converting, professional WhatsApp work order notification."""
        partner_first_name = partner.get("name", "").split()[0] or "Partner"
        category = ticket.category or "General Service"
        title = ticket.title or f"{category} Service"
        loc = ticket.address or ticket.city or "-"
        budget = f"{self.settings.currency_symbol}{ticket.budget}" if ticket.budget else "To be confirmed"

        scheduled_str = "Immediate / Flexible"
        if ticket.scheduled_at:
            try:
                scheduled_str = ist_text(ticket.scheduled_at)
            except Exception:
                scheduled_str = str(ticket.scheduled_at)

        app_url = task_link(ticket.id, helper=str(partner["helper_id"]), source="whatsapp_agent")

        dist_info = f" ({partner['distance_km']} km away)" if partner.get("distance_km") else ""

        message = (
            f"🔔 *New {company()} Work Order Alert*\n\n"
            f"Hello *{partner_first_name}*! A new task matching your skill (*{category}*) has been booked nearby{dist_info}:\n\n"
            f"📌 *Task:* {title}\n"
            f"📍 *Location:* {loc}\n"
            f"💰 *Payout:* {budget}\n"
            f"⏰ *Scheduled:* {scheduled_str}\n"
            f"🆔 *Ticket ID:* #{ticket.id}\n\n"
            f"⚡ *Accept this task directly in the {company()} Partner App:*\n"
            f"{app_url}\n\n"
            f"_Reply 'YES' to accept or 'PASS' to decline._"
        )
        return message

    async def broadcast_task_async(
        self,
        ticket_id: str,
        radius_km: Optional[float] = None,
        db: Optional[Session] = None
    ) -> Dict[str, Any]:
        """Execute automated filtering and broadcast to all matching partners asynchronously."""
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            ticket = db.get(Ticket, ticket_id)
            if not ticket:
                logger.warning("WhatsApp Dispatch Agent: Task #%s not found in database.", ticket_id)
                return {"ok": False, "error": f"Ticket #{ticket_id} does not exist."}

            partners = self.filter_eligible_partners(db, ticket, max_radius_km=radius_km)
            loc_str = ticket.city or ticket.address or "Local Area"
            service_str = ticket.category or ticket.title or "General"

            if not partners:
                log_event(
                    db,
                    ticket.id,
                    "whatsapp_agent_no_match",
                    f"WhatsApp Agent checked: 0 partners matched service '{service_str}' in location '{loc_str}'."
                )
                db.commit()
                return {
                    "ok": True,
                    "ticket_id": ticket.id,
                    "task_title": ticket.title,
                    "location": loc_str,
                    "service": service_str,
                    "helpers_matched": 0,
                    "messages_sent": 0,
                    "summary": f"No partners found matching both '{loc_str}' location and '{service_str}' service."
                }

            # Broadcast messages concurrently (up to 20 at a time)
            sem = asyncio.Semaphore(20)

            async def _send_to_partner(p: Dict[str, Any]) -> Dict[str, Any]:
                from .service import send_task_alert

                msg_body = self.compose_notification_message(ticket, p)
                schedule = ist_text(ticket.scheduled_at)
                payout = f"{self.settings.currency_symbol}{ticket.budget}" if ticket.budget else "To be confirmed"
                async with sem:
                    with tagged("automation", "agent_broadcast", ticket.id):
                        resp = await send_task_alert(
                            self.client,
                            phone=p["phone"],
                            ticket_id=ticket.id,
                            values=[
                                (p.get("name") or "Partner").split(" ")[0] or "Partner",
                                service_str,
                                ticket.title or service_str,
                                ticket.address or ticket.city or loc_str,
                                schedule,
                                payout,
                            ],
                            fallback_text=msg_body,
                        )
                return {
                    "helper_id": p["helper_id"],
                    "name": p["name"],
                    "phone": p["phone"],
                    "distance_km": p["distance_km"],
                    "status": resp.status,
                    "message_id": resp.message_id,
                    "error": resp.error,
                }

            results = await asyncio.gather(*[_send_to_partner(p) for p in partners])
            # Real sends, test (simulated) sends and failures are counted separately: a simulated message never reached anyone
            sent_count = sum(1 for r in results if r["status"] in ("sent", "delivered"))
            simulated_count = sum(1 for r in results if r["status"] == "simulated")
            failed_count = len(results) - sent_count - simulated_count

            # Log audit event in database (same "Status: …" format the dashboard counters read)
            log_event(
                db,
                ticket.id,
                "whatsapp_agent_broadcast",
                f"WhatsApp Dispatch Agent sent task alerts to {len(results)} partner(s) in {loc_str} matching '{service_str}'. "
                f"Status: {sent_count} sent, {simulated_count} simulated, {failed_count} failed."
            )
            db.commit()

            logger.info("WhatsApp Dispatch Agent completed broadcast for Task #%s: %d sent to %s", ticket.id, sent_count, loc_str)

            return {
                "ok": True,
                "ticket_id": ticket.id,
                "task_title": ticket.title or "",
                "location": loc_str,
                "service": service_str,
                "total_helpers_in_location": len(partners),
                "helpers_matched": len(partners),
                "helpers_contacted": sent_count,
                "sent_count": sent_count,
                "simulated_count": simulated_count,
                "failed_count": failed_count,
                "candidates": results,
                "recipients": results,
                "summary": (f"WhatsApp sent to {sent_count} of {len(results)} partner(s) in {loc_str}"
                            + (f"; {simulated_count} only simulated (not delivered)" if simulated_count else "")
                            + (f"; {failed_count} failed" if failed_count else "") + "."),
            }
        finally:
            if close_db:
                db.close()

    def dispatch_for_task(self, ticket_id: str, radius_km: Optional[float] = None) -> None:
        """Called whenever a customer creates/uploads a task: sends its first WhatsApp wave (15 helpers; the next
        waves of 10 follow hourly from the worker until someone is assigned - see waves.py)."""
        from .service import whatsapp_automation_active
        from .waves import start_due_wave

        if not whatsapp_automation_active():
            logger.info("WhatsApp Automation is DEACTIVE; not dispatching ticket %s", ticket_id)
            return
        start_due_wave(ticket_id)


_agent: Optional[WhatsAppTaskDispatchAgent] = None


def get_whatsapp_dispatch_agent() -> WhatsAppTaskDispatchAgent:
    global _agent
    if _agent is None:
        _agent = WhatsAppTaskDispatchAgent()
    return _agent
