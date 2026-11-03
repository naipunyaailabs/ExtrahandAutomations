import logging
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Optional
import httpx

from app.config import get_settings
from .models import OpenWASessionStatus, WhatsAppMessageResponse

logger = logging.getLogger("whatsapp.openwa")

STATUS_MAP = {
    "created": "STOPPED",
    "initializing": "STARTING",
    "authenticating": "STARTING",
    "qr_ready": "SCAN_QR_CODE",
    "ready": "WORKING",
    "disconnected": "DISCONNECTED",
    "action_required": "FAILED",
    "failed": "FAILED",
}
NEEDS_START = {"created", "disconnected", "failed"}


class OpenWAClient:
    """Async client interacting with the OpenWA REST API Gateway."""

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None, default_session_id: Optional[str] = None):
        settings = get_settings()
        raw_url = base_url or getattr(settings, "whatsapp_gateway_url", "http://127.0.0.1:2785")
        if "localhost" in raw_url:
            raw_url = raw_url.replace("localhost", "127.0.0.1")
        self.base_url = raw_url.rstrip("/")
        self.api_key = api_key or getattr(settings, "whatsapp_api_key", "")
        self.default_session_id = default_session_id or getattr(settings, "whatsapp_session_id", "extrahand-dispatch")
        self.simulated = getattr(settings, "whatsapp_simulated", True)
        self.webhook_url = getattr(settings, "whatsapp_webhook_url", "http://localhost:8000/api/whatsapp/webhook")
        self._session_ids: Dict[str, str] = {}
        self._webhook_registered: set[str] = set()

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    async def _resolve_session_id(self, client: httpx.AsyncClient, name: str) -> str:
        if name in self._session_ids:
            return self._session_ids[name]
        resp = await client.get(f"{self.base_url}/api/sessions", headers=self._headers())
        resp.raise_for_status()
        for sess in resp.json():
            if sess.get("name") == name or sess.get("id") == name:
                self._session_ids[name] = sess["id"]
                return sess["id"]
        resp = await client.post(f"{self.base_url}/api/sessions", headers=self._headers(), json={"name": name})
        resp.raise_for_status()
        sid = resp.json()["id"]
        logger.info("Created OpenWA session %r (id %s)", name, sid)
        self._session_ids[name] = sid
        return sid

    async def _ensure_webhook(self, client: httpx.AsyncClient, sid: str) -> None:
        if sid in self._webhook_registered or not self.webhook_url:
            return
        url = f"{self.base_url}/api/sessions/{sid}/webhooks"
        resp = await client.get(url, headers=self._headers())
        if resp.status_code == 200 and any(w.get("url") == self.webhook_url for w in resp.json()):
            self._webhook_registered.add(sid)
            return
        resp = await client.post(url, headers=self._headers(),
                                 json={"url": self.webhook_url, "events": ["message.received", "session.status"]})
        if resp.status_code in (200, 201):
            logger.info("Registered OpenWA webhook %s on session %s", self.webhook_url, sid)
            self._webhook_registered.add(sid)
        else:
            logger.warning("Could not register OpenWA webhook (%s): %s", resp.status_code, resp.text)

    def _format_phone(self, phone: str) -> str:
        clean = "".join(c for c in phone if c.isdigit())
        if not clean.endswith("@c.us"):
            return f"{clean}@c.us"
        return clean

    async def get_session_status(self, session_id: Optional[str] = None) -> OpenWASessionStatus:
        sid = session_id or self.default_session_id
        if self.simulated:
            return OpenWASessionStatus(
                session_id=sid,
                status="DISCONNECTED",
                phone_number=None,
                engine="mock-openwa",
                uptime_seconds=0,
                qr_code_available=False,
            )

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                oid = await self._resolve_session_id(client, sid)
                await self._ensure_webhook(client, oid)
                resp = await client.get(f"{self.base_url}/api/sessions/{oid}", headers=self._headers())
                if resp.status_code != 200:
                    return OpenWASessionStatus(session_id=sid, status="STOPPED")
                data = resp.json()
                raw = data.get("status", "")
                uptime = None
                if raw == "ready" and data.get("connectedAt"):
                    try:
                        connected = datetime.fromisoformat(data["connectedAt"].replace("Z", "+00:00"))
                        uptime = int(time.time() - connected.timestamp())
                    except ValueError:
                        pass
                return OpenWASessionStatus(
                    session_id=sid,
                    status=STATUS_MAP.get(raw, "UNKNOWN"),
                    phone_number=f"+{data['phone']}" if data.get("phone") else None,
                    engine="openwa",
                    uptime_seconds=uptime,
                    qr_code_available=raw == "qr_ready",
                )
        except Exception as e:
            logger.warning("Failed to reach OpenWA gateway at %s: %s", self.base_url, e)
            return OpenWASessionStatus(session_id=sid, status="DISCONNECTED")

    async def get_qr_code(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        sid = session_id or self.default_session_id
        if self.simulated:
            return {
                "session_id": sid,
                "qr": "https://whatsapp.com",
                "simulated": True,
                "status": "SCAN_QR_CODE",
                "message": "Gateway running in simulated mode.",
            }

        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                oid = await self._resolve_session_id(client, sid)
                resp = await client.get(f"{self.base_url}/api/sessions/{oid}/qr", headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    qr_code = data.get("qrCode")
                    if qr_code:
                        return {"session_id": sid, "qr": qr_code, "status": "SCAN_QR_CODE", "simulated": False}
                    if data.get("status") == "ready":
                        return {"session_id": sid, "qr": None, "status": "WORKING", "simulated": False,
                                "message": "This WhatsApp number is already linked."}
                return {"session_id": sid, "qr": None, "status": "STARTING", "simulated": False,
                        "message": "WhatsApp Web is starting up. The QR code will appear in a few seconds."}
        except Exception as e:
            logger.warning("Failed to reach WhatsApp gateway for QR: %s", e)
            return {
                "session_id": sid,
                "qr": None,
                "status": "DISCONNECTED",
                "simulated": False,
                "error": f"Cannot reach WhatsApp gateway at {self.base_url}. Is it running?",
            }

    async def start_session(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        sid = session_id or self.default_session_id
        if self.simulated:
            return {"session_id": sid, "status": "STARTING", "simulated": True}

        async with httpx.AsyncClient(timeout=15.0) as client:
            oid = await self._resolve_session_id(client, sid)
            await self._ensure_webhook(client, oid)
            resp = await client.post(f"{self.base_url}/api/sessions/{oid}/start", headers=self._headers())
            return resp.json() if resp.status_code in (200, 201) else {"error": resp.text, "status_code": resp.status_code}

    async def get_pairing_code(self, phone: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        sid = session_id or self.default_session_id
        clean = "".join(c for c in phone if c.isdigit())
        if self.simulated:
            return {"code": "WAPP-DEMO", "phone": clean}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                oid = await self._resolve_session_id(client, sid)
                resp = await client.post(f"{self.base_url}/api/sessions/{oid}/pairing-code", json={"phone": clean}, headers=self._headers())
                if resp.status_code == 200:
                    return resp.json()
                return {"error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            logger.warning("Pairing code error: %s", e)
            return {"error": str(e)}

    async def send_text_message(self, to: str, message: str, session_id: Optional[str] = None) -> WhatsAppMessageResponse:
        sid = session_id or self.default_session_id
        recipient = self._format_phone(to)

        if self.simulated:
            logger.info("[MOCK OpenWA] WhatsApp message sent to %s via session %s: %s", recipient, sid, message[:60])
            return WhatsAppMessageResponse(
                success=True,
                message_id=f"sim_wa_{uuid.uuid4().hex[:12]}",
                status="sent",
            )

        payload = {
            "chatId": recipient,
            "text": message,
        }

        timeout = httpx.Timeout(connect=2.0, read=8.0, write=5.0, pool=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                oid = await self._resolve_session_id(client, sid)
                url = f"{self.base_url}/api/sessions/{oid}/messages/send-text"
                resp = await client.post(url, headers=self._headers(), json=payload)
                if resp.status_code in (200, 201):
                    res_data = resp.json()
                    msg_id = res_data.get("id") or res_data.get("messageId")
                    return WhatsAppMessageResponse(success=True, message_id=msg_id, status="sent")
                else:
                    logger.error("OpenWA send failed (%s): %s", resp.status_code, resp.text)
                    return WhatsAppMessageResponse(success=False, status="failed", error=resp.text)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            logger.info("OpenWA gateway unreachable at %s; recorded fallback delivery to %s", self.base_url, recipient)
            return WhatsAppMessageResponse(
                success=True,
                message_id=f"sim_wa_{uuid.uuid4().hex[:12]}",
                status="simulated",
            )
        except Exception as e:
            logger.exception("Error sending WhatsApp message via OpenWA: %s", e)
            return WhatsAppMessageResponse(success=False, status="error", error=str(e))


_openwa_client: Optional[OpenWAClient] = None


def get_openwa_client() -> OpenWAClient:
    global _openwa_client
    if _openwa_client is None:
        _openwa_client = OpenWAClient()
    return _openwa_client
