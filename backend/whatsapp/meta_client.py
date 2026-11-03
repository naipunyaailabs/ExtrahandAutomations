"""Official Meta WhatsApp Business Cloud API Client.

Directly integrates with Meta Graph API (v21.0):
https://graph.facebook.com/v21.0/{phone_number_id}/messages

Features:
- Official cloud delivery directly from Meta's infrastructure.
- Zero local browser/Puppeteer/Node.js dependencies.
- Handles text messages and pre-approved WhatsApp templates.
- Automatic fallback to safe simulation when credentials are not yet configured.
"""

import logging
import uuid
from typing import Any, Dict, Optional
import httpx

from app.config import get_settings
from .models import WhatsAppMessageResponse

logger = logging.getLogger("whatsapp.meta")


class MetaWhatsAppClient:
    """Client for Meta's official WhatsApp Business Cloud API."""

    def __init__(
        self,
        phone_number_id: Optional[str] = None,
        access_token: Optional[str] = None,
        api_version: str = "v21.0",
    ):
        settings = get_settings()
        self.phone_number_id = phone_number_id or getattr(settings, "meta_wa_phone_number_id", "")
        self.access_token = access_token or getattr(settings, "meta_wa_access_token", "")
        self.api_version = api_version or getattr(settings, "meta_wa_api_version", "v21.0")
        self.is_configured = bool(self.phone_number_id and self.access_token)
        self.base_url = f"https://graph.facebook.com/{self.api_version}"

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _clean_phone(self, phone: str) -> str:
        """Strips symbols to format as E.164 without '+' sign (Meta requirement)."""
        cleaned = "".join(c for c in phone if c.isdigit())
        if len(cleaned) == 10:
            cleaned = f"91{cleaned}"
        return cleaned

    async def send_text_message(
        self,
        to: str,
        message: str,
        preview_url: bool = True,
    ) -> WhatsAppMessageResponse:
        """Sends an official WhatsApp text message to any phone number via Meta Cloud API."""
        clean_to = self._clean_phone(to)

        # If Meta credentials are not set, safely log and simulate
        if not self.is_configured:
            simulated_id = f"meta_sim_{uuid.uuid4().hex[:12]}"
            logger.info(
                "[Meta WhatsApp Cloud API - Simulated] Message to +%s: '%s'",
                clean_to,
                message[:60].replace("\n", " "),
            )
            return WhatsAppMessageResponse(
                status="simulated",
                message_id=simulated_id,
                details=f"Simulated Meta delivery to +{clean_to}. (Set META_WA_PHONE_NUMBER_ID and META_WA_ACCESS_TOKEN in .env for live Meta delivery)",
            )

        endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": clean_to,
            "type": "text",
            "text": {
                "preview_url": preview_url,
                "body": message,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(endpoint, json=payload, headers=self._headers())

            if res.status_code in (200, 201):
                data = res.json()
                msg_id = data.get("messages", [{}])[0].get("id", f"meta_{uuid.uuid4().hex[:8]}")
                logger.info("[Meta WhatsApp Cloud API] Message successfully sent to +%s (ID: %s)", clean_to, msg_id)
                return WhatsAppMessageResponse(
                    status="sent",
                    message_id=msg_id,
                    details=f"Sent via Meta Cloud API to +{clean_to}",
                )
            else:
                err_text = res.text[:300]
                logger.error("[Meta WhatsApp Cloud API Error] Status %s: %s", res.status_code, err_text)
                return WhatsAppMessageResponse(
                    status="failed",
                    error=f"Meta API error ({res.status_code}): {err_text}",
                )
        except Exception as e:
            logger.exception("[Meta WhatsApp Cloud API Exception] Failed sending to +%s: %s", clean_to, e)
            return WhatsAppMessageResponse(status="failed", error=str(e))

    async def send_template_message(
        self,
        to: str,
        template_name: str,
        language_code: str = "en",
        components: Optional[list] = None,
    ) -> WhatsAppMessageResponse:
        """Sends an approved WhatsApp Business Template message via Meta Cloud API."""
        clean_to = self._clean_phone(to)

        if not self.is_configured:
            simulated_id = f"meta_tmpl_sim_{uuid.uuid4().hex[:12]}"
            logger.info("[Meta WhatsApp - Simulated Template] %s to +%s", template_name, clean_to)
            return WhatsAppMessageResponse(
                status="simulated",
                message_id=simulated_id,
                details=f"Simulated Meta template '{template_name}' to +{clean_to}",
            )

        endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": components or [],
            },
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(endpoint, json=payload, headers=self._headers())

            if res.status_code in (200, 201):
                data = res.json()
                msg_id = data.get("messages", [{}])[0].get("id", f"meta_{uuid.uuid4().hex[:8]}")
                return WhatsAppMessageResponse(status="sent", message_id=msg_id)
            else:
                return WhatsAppMessageResponse(status="failed", error=f"Meta Template error: {res.text[:300]}")
        except Exception as e:
            return WhatsAppMessageResponse(status="failed", error=str(e))

    def get_status(self) -> Dict[str, Any]:
        """Returns the configuration and readiness status of the Meta WhatsApp Cloud API."""
        return {
            "engine": "Meta WhatsApp Business Cloud API",
            "api_version": self.api_version,
            "configured": self.is_configured,
            "phone_number_id": self.phone_number_id or "Not configured",
            "status": "WORKING" if self.is_configured else "READY_SIMULATED",
            "mode": "Official Meta Cloud API" if self.is_configured else "Simulation Mode (Needs Meta Token)",
        }


_meta_client: Optional[MetaWhatsAppClient] = None


def get_meta_whatsapp_client() -> MetaWhatsAppClient:
    global _meta_client
    if _meta_client is None:
        _meta_client = MetaWhatsAppClient()
    return _meta_client

