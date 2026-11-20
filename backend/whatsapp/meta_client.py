"""Official Meta WhatsApp Business Cloud API Client.

Directly integrates with Meta Graph API (v21.0):
https://graph.facebook.com/v21.0/{phone_number_id}/messages

Features:
- Official cloud delivery directly from Meta's infrastructure.
- Zero local browser/Puppeteer/Node.js dependencies.
- Handles text messages and pre-approved WhatsApp templates.
- Without credentials a send fails, unless WHATSAPP_SIMULATED=true (test mode) is set on purpose.
- get_status() checks the number and token with Meta itself (cached for a minute).
"""

import logging
from pathlib import Path
import re
import time
import uuid
from typing import Any, Dict, Optional
import httpx

from app.config import get_settings
from .metering import record_outbound
from .models import WhatsAppMessageResponse

logger = logging.getLogger("whatsapp.meta")

BRAND_HEADER = Path(__file__).parent / "assets" / "extrahand_header.jpg"


def param_text(value: object) -> str:
    """A template variable value Meta accepts: no new-lines or tabs, at most 4 consecutive spaces (error #132018)."""
    text = re.sub(r"[\r\n\t]+", " ", str(value))
    return re.sub(r" {4,}", " ", text).strip()


class MetaWhatsAppClient:
    """Client for Meta's official WhatsApp Business Cloud API."""

    def __init__(
        self,
        phone_number_id: Optional[str] = None,
        access_token: Optional[str] = None,
        api_version: Optional[str] = None,
    ):
        settings = get_settings()
        self.phone_number_id = phone_number_id or settings.meta_wa_phone_number_id
        self.access_token = access_token or settings.meta_wa_access_token
        self.api_version = api_version or settings.meta_wa_api_version or "v23.0"
        self.simulated = bool(settings.whatsapp_simulated)
        self.country_digits = "".join(c for c in settings.default_country_code if c.isdigit())
        self.local_digits = settings.phone_local_digits
        self.is_configured = bool(self.phone_number_id and self.access_token)
        self.base_url = f"https://graph.facebook.com/{self.api_version}"
        self._status_cache: Dict[str, Any] = {"at": 0.0, "value": None}
        self._templates_cache: Dict[str, Any] = {"at": 0.0, "data": []}
        self._brand_header: Dict[str, Any] = {"at": 0.0, "id": None}

    def _not_ready(self, to: str, what: str) -> WhatsAppMessageResponse:
        """No Meta credentials: a test-mode simulation only when WHATSAPP_SIMULATED=true, otherwise a clear failure."""
        if self.simulated:
            logger.info("[Meta WhatsApp - test mode] %s to +%s (not sent)", what, to)
            return WhatsAppMessageResponse(
                status="simulated",
                message_id=f"meta_sim_{uuid.uuid4().hex[:12]}",
                details=f"Test mode (WHATSAPP_SIMULATED=true): {what} to +{to} was not sent.",
            )
        return WhatsAppMessageResponse(
            status="failed",
            error="Meta WhatsApp is not configured: set META_WA_PHONE_NUMBER_ID and META_WA_ACCESS_TOKEN in the backend .env.",
        )

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _clean_phone(self, phone: str) -> str:
        """Strips symbols to format as E.164 without '+' sign (Meta requirement)."""
        cleaned = "".join(c for c in phone if c.isdigit())
        if len(cleaned) == self.local_digits and self.country_digits:
            cleaned = f"{self.country_digits}{cleaned}"
        return cleaned

    async def _send_text(
        self,
        to: str,
        message: str,
        preview_url: bool = True,
    ) -> WhatsAppMessageResponse:
        """Sends an official WhatsApp text message to any phone number via Meta Cloud API."""
        clean_to = self._clean_phone(to)

        if not self.is_configured or self.simulated:
            return self._not_ready(clean_to, "message")

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

    async def upload_media(
        self,
        file_bytes: bytes,
        filename: str = "banner.jpg",
        mime_type: str = "image/jpeg",
    ) -> Optional[str]:
        """Uploads an image or document directly to Meta's Cloud API media storage.
        Returns Meta media_id if successful, or None."""
        if not self.is_configured or self.simulated:
            return None
        endpoint = f"{self.base_url}/{self.phone_number_id}/media"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        data = {"messaging_product": "whatsapp", "type": mime_type}
        files = {"file": (filename, file_bytes, mime_type)}

        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                res = await client.post(endpoint, headers=headers, data=data, files=files)
            if res.status_code in (200, 201):
                media_id = res.json().get("id")
                logger.info("[Meta WhatsApp Media] Uploaded %s -> media_id: %s", filename, media_id)
                return str(media_id)
            else:
                logger.warning("[Meta WhatsApp Media] Upload failed (%s): %s", res.status_code, res.text[:200])
                return None
        except Exception as e:
            logger.warning("[Meta WhatsApp Media Exception] %s", e)
            return None

    async def default_header_image(self) -> Dict[str, str]:
        """The ExtraHand logo + name header (whatsapp/assets/extrahand_header.jpg) used when no banner is uploaded.
        Uploaded to Meta once and reused by media id (cached 24 h); falls back to the public backend URL."""
        now = time.monotonic()
        if self._brand_header["id"] and now - self._brand_header["at"] < 24 * 3600:
            return {"id": self._brand_header["id"]}
        try:
            media_id = await self.upload_media(BRAND_HEADER.read_bytes(), filename=BRAND_HEADER.name, mime_type="image/jpeg")
        except OSError as e:
            logger.warning("Brand header image missing: %s", e)
            media_id = None
        if media_id:
            self._brand_header = {"at": now, "id": media_id}
            return {"id": media_id}
        from app.config import public_base_url

        base = public_base_url()
        if base.startswith("http://"):
            base = "https://" + base[7:]
        return {"link": f"{base}/api/whatsapp/brand-header.jpg"}

    async def _send_template(
        self,
        to: str,
        template_name: str,
        language_code: str = "en",
        components: Optional[list] = None,
    ) -> WhatsAppMessageResponse:
        """Sends an approved WhatsApp Business Template message via Meta Cloud API."""
        clean_to = self._clean_phone(to)

        if not self.is_configured or self.simulated:
            return self._not_ready(clean_to, f"template '{template_name}'")

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

    async def send_text_message(self, to: str, message: str, preview_url: bool = True) -> WhatsAppMessageResponse:
        """Sends a free-form text message and records it in the message ledger (see metering.py)."""
        resp = await self._send_text(to, message, preview_url)
        await record_outbound(self._clean_phone(to), resp.status, resp.message_id, kind="text", error=resp.error,
                              body=message)
        return resp

    async def send_image_message(
        self,
        to: str,
        image: str,
        caption: Optional[str] = None,
    ) -> WhatsAppMessageResponse:
        """Sends an image with optional caption via Meta Cloud API."""
        clean_to = self._clean_phone(to)
        if not self.is_configured or self.simulated:
            return self._not_ready(clean_to, "image message")

        endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
        img_payload = {"id": image} if image.isdigit() else {"link": image}
        if caption:
            img_payload["caption"] = caption

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": clean_to,
            "type": "image",
            "image": img_payload,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(endpoint, json=payload, headers=self._headers())
            if res.status_code in (200, 201):
                data = res.json()
                msg_id = data.get("messages", [{}])[0].get("id", f"meta_{uuid.uuid4().hex[:8]}")
                resp = WhatsAppMessageResponse(status="sent", message_id=msg_id)
            else:
                resp = WhatsAppMessageResponse(status="failed", error=f"Meta API error ({res.status_code}): {res.text[:300]}")
        except Exception as e:
            resp = WhatsAppMessageResponse(status="failed", error=str(e))

        await record_outbound(clean_to, resp.status, resp.message_id, kind="image", error=resp.error,
                              body=caption or "[Image]")
        return resp

    async def get_template_defs(self, template_name: str) -> list[dict]:
        """Every language version Meta has of a template name (one name can exist in English and Telugu)."""
        now = time.monotonic()
        if not self._templates_cache["data"] or now - self._templates_cache["at"] > 300:
            raw = await self.fetch_meta_templates()
            self._templates_cache = {"at": now, "data": raw}
        return [t for t in self._templates_cache["data"] if t.get("name") == template_name]

    async def get_template_def(self, template_name: str, language: Optional[str] = None) -> Optional[dict]:
        """Look up the raw Meta template definition by name; with language, that language's version."""
        versions = await self.get_template_defs(template_name)
        if language:
            return next((t for t in versions if t.get("language") == language), None)
        return versions[0] if versions else None

    async def build_components_for_template(
        self,
        template_name: str,
        variables: Optional[dict] = None,
        image_url: Optional[str] = None,
        button_slug: Optional[str] = None,
        language: Optional[str] = None,
    ) -> list[dict]:
        """Automatically constructs Meta template components (Header Image, Body params, Dynamic URL buttons)."""
        tmpl = (await self.get_template_def(template_name, language) if language else None) or             await self.get_template_def(template_name)
        if not tmpl:
            return []
        components = []
        comps = tmpl.get("components", [])

        # 1. Header (Image)
        header_comp = next((c for c in comps if c.get("type") == "HEADER"), None)
        if header_comp and header_comp.get("format") == "IMAGE":
            img = (image_url or "").strip()
            if img:
                if img.isdigit():
                    img_param = {"id": img}
                elif img.startswith("http://") or img.startswith("https://"):
                    img_param = {"link": img}
                else:
                    img_param = {"id": img}
            else:
                img_param = await self.default_header_image()

            components.append({
                "type": "header",
                "parameters": [{"type": "image", "image": img_param}]
            })

        # 2. Body Parameters
        body_comp = next((c for c in comps if c.get("type") == "BODY"), None)
        if body_comp:
            text = body_comp.get("text", "")
            matches = re.findall(r"\{\{(\d+)\}\}", text)
            if matches:
                params = []
                v = variables or {}
                for m_num in sorted(set(matches), key=int):
                    val = v.get(m_num) or v.get(f"param{m_num}")
                    if not val:
                        if m_num == "1":
                            val = v.get("1") or v.get("name") or v.get("title") or "Customer"
                        elif m_num == "2":
                            val = v.get("2") or v.get("message") or v.get("event") or v.get("task") or v.get("category") or "Special Offer"
                        elif m_num == "3":
                            val = v.get("3") or v.get("link") or v.get("location") or "https://extrahand.in"
                        else:
                            val = "ExtraHand"
                    params.append({"type": "text", "text": param_text(val)})
                if params:
                    components.append({"type": "body", "parameters": params})

        # 3. Dynamic Buttons
        btn_comp = next((c for c in comps if c.get("type") == "BUTTONS"), None)
        if btn_comp:
            buttons = btn_comp.get("buttons", [])
            for idx, b in enumerate(buttons):
                if b.get("type") == "URL" and "{{" in b.get("url", ""):
                    slug = button_slug or (variables.get("ticket_id") if variables else None) or "open"
                    components.append({
                        "type": "button",
                        "sub_type": "url",
                        "index": str(idx),
                        "parameters": [{"type": "text", "text": str(slug)}]
                    })

        return components

    async def send_template_message(
        self,
        to: str,
        template_name: str,
        language_code: Optional[str] = None,
        components: Optional[list] = None,
        variables: Optional[dict] = None,
        image_url: Optional[str] = None,
        button_slug: Optional[str] = None,
    ) -> WhatsAppMessageResponse:
        """Sends an approved template and records it in the message ledger (see metering.py).
        Without language_code the template's own language is used (e.g. "te" for a Telugu template)."""
        if not language_code:
            try:
                tmpl = await self.get_template_def(template_name)
            except Exception:  # noqa: BLE001
                tmpl = None
            language_code = (tmpl or {}).get("language") or "en"
        if components is None:
            components = await self.build_components_for_template(
                template_name,
                variables=variables,
                image_url=image_url,
                button_slug=button_slug,
                language=language_code,
            )
        resp = await self._send_template(to, template_name, language_code, components)
        body, category = await self._template_text(template_name, components, language_code)
        await record_outbound(self._clean_phone(to), resp.status, resp.message_id, kind="template",
                              template=template_name, error=resp.error, body=body, category=category)
        return resp

    async def _template_text(self, template_name: str, components: Optional[list],
                             language: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
        """(text the recipient saw, Meta category) of a template send, for the Sent Messages view. Never raises."""
        try:
            tmpl = (await self.get_template_def(template_name, language) if language else None) or                 await self.get_template_def(template_name)
        except Exception:  # noqa: BLE001
            tmpl = None
        if not tmpl:
            return None, None
        params: list[dict] = []
        for c in components or []:
            if str(c.get("type", "")).lower() == "body":
                params = [p for p in c.get("parameters") or [] if isinstance(p, dict)]
        named = {p["parameter_name"]: p for p in params if p.get("parameter_name")}

        def fill(m: "re.Match[str]") -> str:
            key = m.group(1)
            p = named.get(key)
            if p is None and key.isdigit() and 0 < int(key) <= len(params):
                p = params[int(key) - 1]
            return str(p.get("text", m.group(0))) if p else m.group(0)

        parts = []
        for c in tmpl.get("components") or []:
            kind = c.get("type")
            if kind == "HEADER" and c.get("format") == "TEXT" and c.get("text"):
                parts.append(c["text"])
            elif kind == "BODY" and c.get("text"):
                parts.append(re.sub(r"\{\{\s*(\w+)\s*\}\}", fill, c["text"]))
            elif kind == "FOOTER" and c.get("text"):
                parts.append(c["text"])
        category = tmpl.get("category")
        return ("\n\n".join(parts) or None), (str(category).lower() if category else None)

    async def fetch_meta_templates(self) -> list[dict]:
        """Fetches live message templates directly from Meta WABA account."""
        settings = get_settings()
        waba_id = settings.meta_wa_business_account_id
        if not waba_id or not self.access_token:
            return []
        endpoint = f"{self.base_url}/{waba_id}/message_templates"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(endpoint, headers=self._headers())
                if res.status_code == 200:
                    return res.json().get("data", [])
        except Exception as e:
            logger.warning("Failed to fetch templates from Meta: %s", e)
        return []

    async def delete_template(self, name: str) -> Dict[str, Any]:
        """Permanently deletes a message template (all its languages) from the WhatsApp Business Account."""
        waba_id = get_settings().meta_wa_business_account_id
        if not waba_id or not self.access_token:
            return {"ok": False, "error": "Set META_WA_BUSINESS_ACCOUNT_ID and META_WA_ACCESS_TOKEN in the backend .env."}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.delete(f"{self.base_url}/{waba_id}/message_templates", params={"name": name},
                                          headers=self._headers())
            data = res.json() if res.content else {}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Could not reach Meta: {e}"}
        if res.status_code == 200 and data.get("success"):
            self._templates_cache = {"at": 0, "data": []}
            return {"ok": True}
        err = data.get("error") or {}
        return {"ok": False, "error": err.get("error_user_msg") or err.get("message") or f"Meta error {res.status_code}"}

    async def upload_template_sample(self, file_bytes: bytes, mime_type: str, filename: str = "header.jpg") -> Dict[str, Any]:
        """Uploads a sample header image with Meta's Resumable Upload API (needed to review an IMAGE-header template).
        Returns {ok, handle} or {ok: False, error}."""
        app_id = get_settings().meta_app_id
        if not app_id or not self.access_token:
            return {"ok": False, "error": "Set META_APP_ID and META_WA_ACCESS_TOKEN in the backend .env to submit a header image."}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                start = await client.post(
                    f"{self.base_url}/{app_id}/uploads",
                    params={"file_name": filename, "file_length": len(file_bytes), "file_type": mime_type},
                    headers={"Authorization": f"Bearer {self.access_token}"},
                )
                session = (start.json() if start.content else {}).get("id")
                if not session:
                    err = (start.json() if start.content else {}).get("error") or {}
                    return {"ok": False, "error": f"Meta upload start failed: {err.get('message') or start.status_code}"}
                res = await client.post(
                    f"{self.base_url}/{session}",
                    content=file_bytes,
                    headers={"Authorization": f"OAuth {self.access_token}", "file_offset": "0"},
                )
            data = res.json() if res.content else {}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Could not reach Meta: {e}"}
        if data.get("h"):
            return {"ok": True, "handle": data["h"]}
        err = data.get("error") or {}
        return {"ok": False, "error": f"Meta upload failed: {err.get('message') or res.status_code}"}

    async def create_template(self, name: str, category: str, body: str, language: str = "en",
                              examples: Optional[list] = None, footer: Optional[str] = None,
                              buttons: Optional[list] = None, header_handle: Optional[str] = None) -> Dict[str, Any]:
        """Submits a new message template to Meta for review. Returns {ok, id, status, category} or {ok: False, error}.
        header_handle (from upload_template_sample) adds an IMAGE header; the real image is chosen at send time."""
        waba_id = get_settings().meta_wa_business_account_id
        if not waba_id or not self.access_token:
            return {"ok": False, "error": "Set META_WA_BUSINESS_ACCOUNT_ID and META_WA_ACCESS_TOKEN in the backend .env."}
        body_comp: Dict[str, Any] = {"type": "BODY", "text": body}
        if examples:
            body_comp["example"] = {"body_text": [[str(x) for x in examples]]}
        components: list = []
        if header_handle:
            components.append({"type": "HEADER", "format": "IMAGE", "example": {"header_handle": [header_handle]}})
        components.append(body_comp)
        if footer:
            components.append({"type": "FOOTER", "text": footer})
        if buttons:
            components.append({"type": "BUTTONS", "buttons": buttons})
        payload = {"name": name, "category": category.upper(), "language": language, "components": components}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(f"{self.base_url}/{waba_id}/message_templates", json=payload, headers=self._headers())
            data = res.json() if res.content else {}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Could not reach Meta: {e}"}
        if res.status_code in (200, 201) and data.get("id"):
            self._templates_cache = {"at": 0, "data": []}  # next lookup sees the new template
            return {"ok": True, "id": data["id"], "status": data.get("status", "PENDING"),
                    "category": data.get("category", category.upper())}
        err = data.get("error") or {}
        return {"ok": False, "error": err.get("error_user_msg") or err.get("message") or f"Meta error {res.status_code}"}

    async def edit_template(self, template_id: str, body: str, examples: Optional[list] = None,
                            footer: Optional[str] = None, buttons: Optional[list] = None) -> Dict[str, Any]:
        """Changes the text of a template already at Meta (approved or rejected); Meta reviews it again.
        Meta allows this once a day and 10 times a month per template."""
        if not self.access_token:
            return {"ok": False, "error": "Set META_WA_ACCESS_TOKEN in the backend .env."}
        body_comp: Dict[str, Any] = {"type": "BODY", "text": body}
        if examples:
            body_comp["example"] = {"body_text": [[str(x) for x in examples]]}
        components: list = [body_comp]
        if footer:
            components.append({"type": "FOOTER", "text": footer})
        if buttons:
            components.append({"type": "BUTTONS", "buttons": buttons})
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(f"{self.base_url}/{template_id}", json={"components": components},
                                        headers=self._headers())
            data = res.json() if res.content else {}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Could not reach Meta: {e}"}
        if res.status_code == 200 and data.get("success"):
            self._templates_cache = {"at": 0, "data": []}
            return {"ok": True, "id": template_id, "status": "PENDING"}
        err = data.get("error") or {}
        return {"ok": False, "error": err.get("error_user_msg") or err.get("message") or f"Meta error {res.status_code}"}

    def get_status(self) -> Dict[str, Any]:
        """Real connection state: asks Meta for the sending number (cached 60 s), so a wrong or expired token
        shows as an error instead of "working"."""
        base = {
            "engine": "Meta WhatsApp Business Cloud API",
            "api_version": self.api_version,
            "configured": self.is_configured,
            "simulated": self.simulated,
            "phone_number_id": self.phone_number_id or None,
            "phone_number": None,
            "verified_name": None,
            "quality_rating": None,
            "error": None,
        }
        if self.simulated:
            return {**base, "status": "SIMULATED", "mode": "Test mode (WHATSAPP_SIMULATED=true): nothing is sent"}
        if not self.is_configured:
            return {**base, "status": "NOT_CONFIGURED",
                    "mode": "Set META_WA_PHONE_NUMBER_ID and META_WA_ACCESS_TOKEN in the backend .env"}

        now = time.monotonic()
        cached = self._status_cache
        if cached["value"] is not None and now - cached["at"] < 60:
            return cached["value"]
        try:
            res = httpx.get(
                f"{self.base_url}/{self.phone_number_id}",
                params={"fields": "display_phone_number,verified_name,quality_rating"},
                headers=self._headers(),
                timeout=5.0,
            )
            if res.status_code == 200:
                d = res.json()
                value = {**base, "status": "WORKING", "mode": "Official Meta Cloud API",
                         "phone_number": d.get("display_phone_number"), "verified_name": d.get("verified_name"),
                         "quality_rating": d.get("quality_rating")}
            else:
                try:
                    msg = res.json().get("error", {}).get("message") or res.text[:200]
                except ValueError:
                    msg = res.text[:200]
                state = "AUTH_FAILED" if res.status_code in (401, 403) or "token" in msg.lower() else "FAILED"
                value = {**base, "status": state, "mode": "Meta rejected the request", "error": f"Meta API ({res.status_code}): {msg}"}
        except Exception as exc:  # noqa: BLE001 - network problem
            value = {**base, "status": "DISCONNECTED", "mode": "Could not reach Meta", "error": str(exc)[:200]}
        self._status_cache = {"at": now, "value": value}
        return value


_meta_client: Optional[MetaWhatsAppClient] = None


def get_meta_whatsapp_client() -> MetaWhatsAppClient:
    global _meta_client
    if _meta_client is None:
        _meta_client = MetaWhatsAppClient()
    return _meta_client

