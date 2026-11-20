"""Templates offered in Bulk Msgs. Bulk is marketing, so only templates on this list are shown there.

The list starts with the three ExtraHand marketing templates; every template created from Bulk Msgs is submitted
to Meta as MARKETING and added to the list (it becomes sendable once Meta approves it).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .meta_client import get_meta_whatsapp_client

router = APIRouter(prefix="/bulk-templates", tags=["WhatsApp Bulk Templates"])

KEY = "whatsapp_bulk_templates"
DEFAULT = ["extrahand_event_announcement", "extrahand_helper_welcome", "extrahand_customer_welcome"]
NAME_RE = re.compile(r"^[a-z0-9_]{1,512}$")
VAR_RE = re.compile(r"\{\{\s*(\d+)\s*\}\}")


def allowed_names() -> List[str]:
    from app.database import SessionLocal
    from app.models import AppSetting

    with SessionLocal() as db:
        row = db.get(AppSetting, KEY)
        if row:
            try:
                names = json.loads(row.value)
                if isinstance(names, list):
                    return [str(n) for n in names]
            except ValueError:
                pass
    return list(DEFAULT)


def _save_names(names: List[str]) -> None:
    from app.database import SessionLocal
    from app.models import AppSetting

    with SessionLocal() as db:
        row = db.get(AppSetting, KEY) or AppSetting(key=KEY)
        row.value = json.dumps(names)
        db.add(row)
        db.commit()


def _out(t: dict) -> dict:
    """A Meta template as Bulk Msgs lists it; `protected` = used by an automation (cannot be deleted from Meta)."""
    body = next((c.get("text", "") for c in t.get("components", []) if c.get("type") == "BODY"), "")
    name = t.get("name", "")
    return {
        "id": name,
        "name": name.replace("_", " ").title(),
        "category": t.get("category", "MARKETING"),
        "language": t.get("language", "en"),
        "status": t.get("status", "PENDING"),
        "template": body,
        "variables": sorted(set(VAR_RE.findall(body)), key=int),
        "used_by": protected_templates().get(name),
    }


@router.get("")
async def list_bulk_templates() -> List[dict]:
    """Templates on the bulk list with their live Meta status (APPROVED / PENDING / REJECTED), in list order."""
    names = allowed_names()
    live = {t.get("name"): t for t in await get_meta_whatsapp_client().fetch_meta_templates()}
    return [_out(live[n]) for n in names if n in live]


class NewTemplate(BaseModel):
    name: str = Field(..., description="lowercase letters, numbers and underscores")
    body: str = Field(..., min_length=1, max_length=1024)
    examples: List[str] = Field(default_factory=list, description="sample value for {{1}}, {{2}}, ... in order")
    footer: Optional[str] = Field(None, max_length=60)
    language: str = Field("en", description="Meta language code of the text, e.g. en, te, hi")
    header_image: Literal["none", "brand", "banner"] = Field(
        "none", description="none = text only; brand = ExtraHand header as the sample; banner = an uploaded banner")
    banner_filename: Optional[str] = Field(None, description="file name returned by /api/whatsapp/upload-banner")


LANG_RE = re.compile(r"^[a-z]{2,3}(_[A-Z]{2})?$")


async def _header_handle(payload: NewTemplate) -> Optional[str]:
    """Uploads the chosen sample header image to Meta and returns its handle (None for a text-only template)."""
    if payload.header_image == "none":
        return None
    from app.services import media_store

    from .meta_client import BRAND_HEADER

    if payload.header_image == "brand":
        fname, data = BRAND_HEADER.name, BRAND_HEADER.read_bytes()
    else:
        fname = Path(payload.banner_filename or "").name
        data = media_store.get("whatsapp_banners", fname) if fname else None
        if data is None:
            raise HTTPException(400, "Upload a banner image first, or pick the ExtraHand header.")
    ext = Path(fname).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png"):
        raise HTTPException(400, "Meta only accepts JPG or PNG header images.")
    mime = "image/png" if ext == ".png" else "image/jpeg"
    res = await get_meta_whatsapp_client().upload_template_sample(data, mime, filename=fname)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Could not upload the header image to Meta.")
    return res["handle"]


@router.post("")
async def create_bulk_template(payload: NewTemplate) -> dict[str, Any]:
    """Submits a MARKETING template to Meta for approval and adds it to the bulk list."""
    name = payload.name.strip().lower().replace(" ", "_")
    if not NAME_RE.match(name):
        raise HTTPException(400, "Name may only use lowercase letters, numbers and underscores (e.g. diwali_offer_2026).")
    if not LANG_RE.match(payload.language):
        raise HTTPException(400, "Language must be a Meta language code such as en, te or hi.")
    if re.search(r"\{(?!\{)\s*[a-zA-Z_]+\s*\}", payload.body):
        raise HTTPException(400, "Meta only accepts numbered variables: use {{1}} for the name instead of {name}.")
    nums = [int(n) for n in VAR_RE.findall(payload.body)]
    if nums and sorted(set(nums)) != list(range(1, max(nums) + 1)):
        raise HTTPException(400, "Variables must be numbered in order: {{1}}, {{2}}, {{3}} ...")
    needed = max(nums) if nums else 0
    examples = [e.strip() for e in payload.examples][:needed]
    if len(examples) < needed or not all(examples):
        raise HTTPException(400, f"Give a sample value for each of the {needed} variable(s); Meta needs them to review.")

    handle = await _header_handle(payload)
    res = await get_meta_whatsapp_client().create_template(
        name=name, category="MARKETING", body=payload.body.strip(), language=payload.language,
        examples=examples or None, footer=(payload.footer or "").strip() or None, header_handle=handle,
    )
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Meta rejected the template.")
    names = allowed_names()
    if name not in names:
        _save_names(names + [name])
    return {**res, "name": name}


def protected_templates() -> dict[str, str]:
    """Templates the automations send: these can be removed from Bulk Msgs but never deleted from Meta here."""
    from .service import TASK_ALERT_TEMPLATE
    from .welcomers import AUDIENCES

    used = {TASK_ALERT_TEMPLATE: "new-task alerts to helpers",
            "extrahand_event_announcement": "the default Bulk Msgs template"}
    for audience, cfg in AUDIENCES.items():
        used[cfg["template"]] = f"the {audience.title()} Welcomer"
    return used


@router.delete("/{name}")
async def delete_bulk_template(name: str, from_meta: bool = False) -> dict[str, Any]:
    """Removes a template from the Bulk Msgs list; with from_meta=true also deletes it permanently from Meta."""
    if from_meta:
        used = protected_templates()
        if name in used:
            raise HTTPException(409, f"'{name}' is used by {used[name]}, so it can't be deleted from Meta. "
                                     "You can still remove it from Bulk Msgs.")
        res = await get_meta_whatsapp_client().delete_template(name)
        if not res.get("ok"):
            raise HTTPException(400, res.get("error") or "Meta could not delete the template.")
    names = allowed_names()
    if name in names:
        _save_names([n for n in names if n != name])
    return {"ok": True, "name": name, "deleted_from_meta": from_meta}
