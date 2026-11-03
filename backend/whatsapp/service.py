import asyncio
import logging
from typing import Optional
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, session_scope
from app.models import Ticket, Helper, DispatchStatus
from .openwa_client import get_openwa_client
from .models import WhatsAppDispatchPayload, WhatsAppMessageResponse

logger = logging.getLogger("whatsapp.service")


class WhatsAppDispatchService:
    """Service handling WhatsApp automated dispatches and reminders for ExtraHand."""

    def __init__(self):
        self.client = get_openwa_client()
        self.settings = get_settings()

    def format_task_dispatch_message(self, payload: WhatsAppDispatchPayload) -> str:
        helper_greeting = f"Hi {payload.helper_name}!" if payload.helper_name else "Hello!"
        base_url = self.settings.cors_origins.split(",")[0].strip()
        app_url = f"{base_url}/tickets/{payload.ticket_id}"
        return (
            f"🔔 *New {payload.task_title} Task in Your Area - {self.settings.company_name}*\n\n"
            f"{helper_greeting} A new job is available in your location matching your verified skills:\n\n"
            f"📋 *Service Task:* {payload.task_title}\n"
            f"📍 *Location:* {payload.location}\n"
            f"⏰ *Schedule:* {payload.scheduled_time}\n"
            f"💰 *Payout:* ₹{payload.payout} {self.settings.currency_word}\n\n"
            f"📲 *View Task & Accept:*\n{app_url}\n\n"
            f"_Reference Ticket ID: #{payload.ticket_id}_"
        )

    def format_task_assigned_message(self, payload: WhatsAppDispatchPayload) -> str:
        helper_greeting = f"Hi {payload.helper_name}!" if payload.helper_name else "Hello!"
        base_url = self.settings.cors_origins.split(",")[0].strip()
        app_url = f"{base_url}/tickets/{payload.ticket_id}"
        return (
            f"🎉 *Task Assigned - Work Order Confirmed*\n\n"
            f"{helper_greeting} You got this work on {self.settings.company_name}!\n\n"
            f"📋 *Task:* {payload.task_title}\n"
            f"📍 *Location:* {payload.location}\n"
            f"⏰ *Scheduled Time:* {payload.scheduled_time}\n"
            f"💰 *Earnings / Payout:* {payload.payout} {self.settings.currency_word}\n\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"📲 *View Complete Task Details in App:*\n"
            f"{app_url}\n\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"Please reach the location on time. Have a great shift!"
        )

    def format_reminder_message(self, helper_name: str, task_title: str, scheduled_time: str, address: str) -> str:
        return (
            f"⏰ *Upcoming Shift Reminder - {self.settings.company_name}*\n\n"
            f"Hi {helper_name}, your assigned task is starting soon:\n\n"
            f"📋 *Task:* {task_title}\n"
            f"⏰ *Time:* {scheduled_time}\n"
            f"📍 *Address:* {address}\n\n"
            f"Please make sure to arrive on time. Reply *OK* to confirm you are on your way."
        )

    async def send_dispatch_notification(self, payload: WhatsAppDispatchPayload) -> WhatsAppMessageResponse:
        """Send task dispatch alert to helper's WhatsApp."""
        message = self.format_task_dispatch_message(payload)
        logger.info("Sending WhatsApp dispatch for ticket %s to helper %s (%s)", payload.ticket_id, payload.helper_id, payload.helper_phone)
        return await self.client.send_text_message(to=payload.helper_phone, message=message)

    async def send_task_assigned_notification(self, payload: WhatsAppDispatchPayload) -> WhatsAppMessageResponse:
        """Send work assigned notification to helper with in-app task details link."""
        message = self.format_task_assigned_message(payload)
        logger.info("Sending WhatsApp work assignment confirmation for ticket %s to helper %s (%s)", payload.ticket_id, payload.helper_id, payload.helper_phone)
        return await self.client.send_text_message(to=payload.helper_phone, message=message)

    async def send_reminder(self, helper_phone: str, helper_name: str, task_title: str, scheduled_time: str, address: str) -> WhatsAppMessageResponse:
        """Send shift reminder message to helper."""
        message = self.format_reminder_message(helper_name, task_title, scheduled_time, address)
        return await self.client.send_text_message(to=helper_phone, message=message)

    def get_location_helpers_for_task(
        self,
        ticket_id: str,
        radius_km: Optional[float] = None,
        db: Optional[Session] = None
    ) -> tuple[Optional[Ticket], list[dict]]:
        """Find all eligible helpers located in the same area/city and strictly matching the requested service."""
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            ticket = db.get(Ticket, ticket_id)
            if not ticket:
                return None, []

            from app.services.dispatch import find_candidates, km_between, helper_matches_ticket_service
            from app.services.common import runtime_settings

            rt = runtime_settings(db)
            effective_radius = radius_km if radius_km is not None else (rt.match_radius_km or 10.0)

            # 1. Fetch matching candidates using core dispatch logic
            candidates_list, _ = find_candidates(db, ticket)

            # 2. Also search all helpers in local DB in same city / radius who have a phone number
            db_helpers = db.query(Helper).filter(
                (Helper.phone.isnot(None)) & (Helper.phone != "")
            ).all()

            merged: list[dict] = []
            seen_ids = set()
            seen_phones = set()

            for c in candidates_list:
                h_id = str(c.get("helper_id") or "")
                phone = str(c.get("phone") or "")
                clean_phone = "".join(ch for ch in phone if ch.isdigit())[-10:]
                # Strict service match verification
                if not helper_matches_ticket_service(ticket, c.get("skills"), c.get("categories")):
                    continue
                # Strict distance verification (must be <= effective_radius)
                c_dist = c.get("distance_km")
                if c_dist is not None and c_dist > effective_radius:
                    continue
                seen_ids.add(h_id)
                if clean_phone:
                    seen_phones.add(clean_phone)
                merged.append(c)

            for h in db_helpers:
                if str(h.id) in seen_ids:
                    continue
                clean_phone = "".join(ch for ch in (h.phone or "") if ch.isdigit())[-10:]
                if clean_phone and clean_phone in seen_phones:
                    continue

                # 1. Location match: strict coordinates within radius OR city match fallback
                dist = None
                has_coords = (
                    ticket.lat is not None and ticket.lng is not None and
                    h.lat is not None and h.lng is not None and
                    (ticket.lat != 0.0 or ticket.lng != 0.0) and
                    (h.lat != 0.0 or h.lng != 0.0)
                )
                if has_coords:
                    dist = km_between(ticket.lat, ticket.lng, h.lat, h.lng)
                    if dist is None or dist > effective_radius:
                        continue
                elif ticket.city and h.city:
                    t_city = ticket.city.strip().lower()
                    h_city = h.city.strip().lower()
                    if t_city not in h_city and h_city not in t_city:
                        continue
                    dist = 4.5
                else:
                    continue

                # 2. Strict Service / Skill match
                if not helper_matches_ticket_service(ticket, h.skills, h.categories):
                    continue

                seen_ids.add(str(h.id))
                if clean_phone:
                    seen_phones.add(clean_phone)

                merged.append({
                    "helper_id": h.id,
                    "profile_id": h.profile_id,
                    "name": h.name or "Helper",
                    "phone": h.phone,
                    "skills": h.skills or [],
                    "categories": h.categories or [],
                    "city": h.city,
                    "distance_km": round(dist, 2) if dist is not None else None,
                    "is_verified": getattr(h, "is_verified", True),
                    "status": getattr(h, "status", "active") or "active",
                })

            merged.sort(key=lambda c: (c.get("distance_km") is None, c.get("distance_km") or 0))
            return ticket, merged
        finally:
            if close_db:
                db.close()

    async def broadcast_task_to_location_helpers(
        self,
        ticket_id: str,
        radius_km: Optional[float] = None,
        db: Optional[Session] = None,
    ) -> dict:
        """Broadcasts task link & details via WhatsApp to ALL eligible helpers matching BOTH location AND service."""
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            ticket, helpers = self.get_location_helpers_for_task(ticket_id, radius_km, db)
            if not ticket:
                return {
                    "ok": False,
                    "error": f"Ticket {ticket_id} not found",
                    "ticket_id": ticket_id,
                    "location": None,
                    "service": None,
                    "total_helpers_in_location": 0,
                    "helpers_contacted": 0,
                    "sent_count": 0,
                    "simulated_count": 0,
                    "failed_count": 0,
                    "candidates": [],
                    "summary": f"Ticket #{ticket_id} not found."
                }

            loc_str = ticket.city or ticket.address or "Area Location"
            service_str = ticket.category or ticket.title or "General Service"
            schedule_str = ticket.scheduled_at.strftime("%d %b %Y, %I:%M %p") if ticket.scheduled_at else "Immediate / Flexible"
            payout_val = ticket.budget if (ticket.budget and ticket.budget > 0) else 500

            if not helpers:
                return {
                    "ok": True,
                    "ticket_id": ticket.id,
                    "task_title": ticket.title or ticket.category or f"Task #{ticket.id[:8]}",
                    "location": loc_str,
                    "service": service_str,
                    "total_helpers_in_location": 0,
                    "helpers_contacted": 0,
                    "sent_count": 0,
                    "simulated_count": 0,
                    "failed_count": 0,
                    "candidates": [],
                    "summary": f"No helpers found matching both '{loc_str}' location and '{service_str}' service."
                }

            sem = asyncio.Semaphore(25)

            async def _send_one(h: dict) -> dict:
                phone = h.get("phone")
                if not phone:
                    return None

                payload = WhatsAppDispatchPayload(
                    ticket_id=ticket.id,
                    helper_id=str(h.get("helper_id") or "unknown"),
                    helper_name=h.get("name") or "Helper",
                    helper_phone=phone,
                    task_title=ticket.title or ticket.category or "Service Task",
                    location=loc_str,
                    scheduled_time=schedule_str,
                    payout=str(payout_val),
                )

                async with sem:
                    resp = await self.send_dispatch_notification(payload)

                return {
                    "helper_id": h.get("helper_id"),
                    "name": h.get("name"),
                    "phone": phone,
                    "distance_km": h.get("distance_km"),
                    "city": h.get("city") or ticket.city,
                    "skills": h.get("skills", []),
                    "categories": h.get("categories", []),
                    "status": resp.status,
                    "message_id": resp.message_id,
                    "error": resp.error,
                }

            dispatched_items = await asyncio.gather(*[_send_one(h) for h in helpers])
            results = [r for r in dispatched_items if r is not None]

            sent_count = sum(1 for r in results if r["status"] == "sent")
            simulated_count = sum(1 for r in results if r["status"] == "simulated")
            failed_count = sum(1 for r in results if r["status"] not in ("sent", "simulated"))

            from app.services.common import log_event
            log_event(
                db,
                ticket.id,
                "whatsapp_location_broadcast",
                f"Dispatched WhatsApp task link to {len(results)} helper(s) matching '{service_str}' in {loc_str}. Status: {sent_count} sent, {simulated_count} simulated, {failed_count} failed."
            )
            db.commit()

            return {
                "ok": True,
                "ticket_id": ticket.id,
                "task_title": ticket.title or ticket.category or f"Task #{ticket.id[:8]}",
                "location": loc_str,
                "service": service_str,
                "total_helpers_in_location": len(helpers),
                "helpers_contacted": len(results),
                "sent_count": sent_count,
                "simulated_count": simulated_count,
                "failed_count": failed_count,
                "candidates": results,
                "summary": f"Notification successfully sent to {len(results)} helper(s) in {loc_str} matching {service_str}."
            }
        finally:
            if close_db:
                db.close()

    async def handle_inbound_reply(self, from_phone: str, body: str, session: Optional[Session] = None) -> dict:
        """Parse helper reply (1 / ACCEPT, 2 / REJECT) and update task dispatch state."""
        text = body.strip().upper()
        clean_phone = "".join(c for c in from_phone if c.isdigit())
        logger.info("Inbound WhatsApp message from %s: '%s'", from_phone, text)

        is_accept = text in ("1", "ACCEPT", "YES", "CONFIRM")
        is_reject = text in ("2", "REJECT", "NO", "DECLINE")

        if not (is_accept or is_reject):
            return {"action": "ignored", "reason": "unrecognized_keyword", "text": body}

        with session_scope() as db:
            helper = db.query(Helper).filter(
                (Helper.phone.contains(clean_phone[-10:])) | (Helper.alt_phone.contains(clean_phone[-10:]))
            ).first()

            if not helper:
                logger.warning("No helper found for phone %s", clean_phone)
                return {"action": "error", "error": "helper_not_found"}

            if is_accept:
                logger.info("Helper %s accepted job via WhatsApp!", helper.name or helper.id)
                # Automatically assign to the open/dispatching ticket
                ticket = db.query(Ticket).filter(
                    Ticket.assignee_id.is_(None),
                    Ticket.dispatch_status.in_([DispatchStatus.NEW, DispatchStatus.DISPATCHING])
                ).order_by(Ticket.created_at.desc()).first()

                assigned_ticket_id = None
                if ticket:
                    ticket.assignee_id = helper.id
                    ticket.assignee_profile_id = helper.profile_id
                    ticket.assignee_name = helper.name
                    ticket.assignee_phone = helper.phone
                    ticket.dispatch_status = DispatchStatus.ASSIGNED
                    assigned_ticket_id = ticket.id
                    try:
                        from app.services.common import log_event
                        log_event(db, ticket.id, "whatsapp_accepted", f"Helper {helper.name} ({clean_phone}) accepted via WhatsApp")
                    except Exception as log_err:
                        logger.warning("Could not log acceptance event: %s", log_err)
                    db.commit()

                await self.client.send_text_message(
                    to=from_phone,
                    message=f"✅ Thank you {helper.name or ''}! You have accepted this booking. Check your app for complete customer details."
                )
                return {"action": "accepted", "helper_id": helper.id, "phone": clean_phone, "ticket_id": assigned_ticket_id}

            elif is_reject:
                logger.info("Helper %s declined job via WhatsApp.", helper.name or helper.id)
                await self.client.send_text_message(
                    to=from_phone,
                    message="👌 Understood. We have released this task and will offer it to the next available helper."
                )
                return {"action": "rejected", "helper_id": helper.id, "phone": clean_phone}

        return {"action": "processed"}


_whatsapp_service: Optional[WhatsAppDispatchService] = None


def get_whatsapp_service() -> WhatsAppDispatchService:
    global _whatsapp_service
    if _whatsapp_service is None:
        _whatsapp_service = WhatsAppDispatchService()
    return _whatsapp_service


def trigger_whatsapp_task_broadcast(ticket_id: str, radius_km: Optional[float] = None) -> None:
    """Non-blocking background thread to broadcast a newly uploaded/synced customer task to all helpers matching location and service."""
    import threading
    def _runner():
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            wa = get_whatsapp_service()
            res = loop.run_until_complete(wa.broadcast_task_to_location_helpers(ticket_id, radius_km=radius_km))
            logger.info("Automatic WhatsApp task broadcast for ticket %s completed: %s", ticket_id, res.get("summary"))
        except Exception as err:
            logger.exception("Automatic WhatsApp task broadcast for ticket %s failed: %s", ticket_id, err)
        finally:
            try:
                loop.close()
            except Exception:
                pass

    t = threading.Thread(target=_runner, daemon=True)
    t.start()

