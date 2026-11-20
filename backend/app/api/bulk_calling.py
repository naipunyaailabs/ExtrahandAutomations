"""Customized Bulk Calling Agent.

Allows users to upload custom voice scripts (Telugu/English), add phone numbers manually
or via Excel/CSV, and run sequential one-by-one calls with an independent Active/Inactive switch.
"""

import asyncio
import csv
import hashlib
import io
import logging
import os
import re
import threading
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Literal
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal, get_db
from ..models import BulkCallCampaign, BulkCallItem, utcnow
from ..services import tts_audio
from ..services.common import runtime_settings, save_runtime_settings
from ..services.ivr import Part

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bulk-calling", tags=["bulk-calling"])

# In-memory tracking of active background campaign worker tasks
ACTIVE_RUNNERS: dict[int, asyncio.Task] = {}
# In-memory cache for synthesized voice broadcast audio
AUDIO_CACHE: dict[str, bytes] = {}
_AUDIO_LOCK = threading.Lock()


def campaign_audio(campaign_id: int, script: str) -> Path:
    """The campaign's voice message as a WAV file. Every member hears the same message, so it is made once
    (one Sarvam charge per campaign, not per call) and shared. The file name carries a hash of the script,
    so editing the script makes fresh audio."""
    script = script.strip()
    digest = hashlib.sha256(script.encode()).hexdigest()[:16]
    path = tts_audio._dir() / f"bulk_{campaign_id}_{digest}.wav"
    if path.exists():
        return path
    with _AUDIO_LOCK:
        if path.exists():
            return path
        if get_settings().sarvam_api_key:
            wav = tts_audio._synthesize(script, source="bulk")
        else:
            from tests.vobiz_helpers import spoken_wav
            wav = spoken_wav(script[:100])
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.tmp")
        tmp.write_bytes(wav)
        os.replace(tmp, path)  # written whole, then renamed: never served half-written
    return path


def normalize_phone(raw: str) -> tuple[bool, str, str]:
    """Validates and formats a phone number, standardizing Indian 10-digit numbers to +91."""
    if not raw:
        return False, "", "Empty number"
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 10:
        return True, f"+91{digits}", "Valid (IN)"
    if len(digits) == 12 and digits.startswith("91"):
        return True, f"+{digits}", "Valid (IN)"
    if len(digits) >= 10:
        formatted = f"+{digits}" if not str(raw).strip().startswith("+") else f"+{digits}"
        return True, formatted, "Valid"
    return False, raw.strip(), "Invalid (requires at least 10 digits)"


class ContactPayload(BaseModel):
    name: str | None = None
    phone: str


class CreateCampaignPayload(BaseModel):
    title: str
    script: str
    language: str = "te-IN"
    contacts: list[ContactPayload]


class PreviewAudioPayload(BaseModel):
    script: str
    language: str = "te-IN"


# ---------------------------------------------------------------------------------------------------
# File Upload & Parsing (Excel & CSV - Pure Python Standard Library)
# ---------------------------------------------------------------------------------------------------

def _col_ref_to_index(cell_ref: str) -> int:
    """Converts Excel cell reference like 'A1' or 'BC23' to 0-based column index."""
    letters = re.sub(r"\d", "", cell_ref).upper()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx - 1


def _parse_xlsx_bytes(contents: bytes) -> list[list[str]]:
    """Zero-dependency parser for .xlsx spreadsheets using standard zipfile and xml modules."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(contents))
    except Exception as exc:
        raise ValueError(f"Not a valid Excel .xlsx archive: {exc}") from exc

    shared_strings: list[str] = []
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    # 1. Parse shared strings table if present
    if "xl/sharedStrings.xml" in zf.namelist():
        tree = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in tree.findall(f".//{ns}si") or tree.findall(".//si"):
            text = "".join(t.text or "" for t in (si.findall(f".//{ns}t") or si.findall(".//t")))
            shared_strings.append(text)

    # 2. Locate the primary worksheet
    sheet_name = next((n for n in zf.namelist() if n.startswith("xl/worksheets/sheet")), None)
    if not sheet_name:
        return []

    stree = ET.fromstring(zf.read(sheet_name))
    rows: list[list[str]] = []

    row_elements = stree.findall(f".//{ns}row") or stree.findall(".//row")
    for row in row_elements:
        cell_dict: dict[int, str] = {}
        max_col = -1
        cell_elements = row.findall(f".//{ns}c") or row.findall(".//c")
        for c in cell_elements:
            ref = c.attrib.get("r", "")
            col_idx = _col_ref_to_index(ref) if ref else len(cell_dict)
            if col_idx > max_col:
                max_col = col_idx

            val = ""
            # Direct string inside inlineStr or <t>
            t_elem = c.find(f".//{ns}t") if c.find(f".//{ns}t") is not None else c.find(".//t")
            if t_elem is not None and t_elem.text:
                val = t_elem.text.strip()
            else:
                v = c.find(f"{ns}v") if c.find(f"{ns}v") is not None else c.find("v")
                if v is not None and v.text:
                    if c.attrib.get("t") == "s":
                        try:
                            s_idx = int(v.text)
                            val = shared_strings[s_idx] if s_idx < len(shared_strings) else ""
                        except (ValueError, IndexError):
                            val = v.text
                    else:
                        val = v.text.strip()

            if val.endswith(".0"):
                val = val[:-2]
            cell_dict[col_idx] = val

        if max_col >= 0:
            row_vals = [cell_dict.get(i, "").strip() for i in range(max_col + 1)]
            if any(row_vals):
                rows.append(row_vals)

    return rows


@router.post("/parse-file")
async def parse_contacts_file(file: UploadFile = File(...)):
    """Parses Excel (.xlsx, .xls) or CSV (.csv, .tsv, .txt) files into structured validated contacts."""
    filename = file.filename or "upload.csv"
    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Uploaded file is empty")

    contacts = []
    rows: list[list[str]] = []

    try:
        lower_name = filename.lower()
        if lower_name.endswith((".xlsx", ".xls")):
            # Try zero-dependency zip/xml parser first
            try:
                rows = _parse_xlsx_bytes(contents)
            except Exception as xlsx_err:
                log.info("Direct xlsx parser failed (%s), attempting text/csv fallback", xlsx_err)
                # Fallback: maybe it's actually CSV saved with .xlsx/.xls extension
                text = contents.decode("utf-8", errors="replace")
                reader = csv.reader(io.StringIO(text))
                rows = list(reader)
        else:
            # CSV, TSV, or TXT
            text = contents.decode("utf-8", errors="replace")
            # Auto-detect delimiter
            sample = text[:1024]
            delimiter = "\t" if "\t" in sample and "," not in sample else (";" if ";" in sample and "," not in sample else ",")
            reader = csv.reader(io.StringIO(text), delimiter=delimiter)
            rows = list(reader)

        if not rows:
            raise HTTPException(400, "File contains no rows or readable contact data")

        # Determine header indices for phone and name
        header = [str(c).lower().strip() for c in rows[0]]
        phone_patterns = r"phone|mobile|cell|contact|number|tel|whatsapp"
        name_patterns = r"name|customer|helper|person|recipient|user"

        phone_idx = next((i for i, c in enumerate(header) if re.search(phone_patterns, c)), None)
        name_idx = next((i for i, c in enumerate(header) if re.search(name_patterns, c) and i != phone_idx), None)

        start_idx = 1 if (phone_idx is not None or name_idx is not None) else 0

        # If phone column not identified in header, scan rows for digits
        if phone_idx is None:
            max_cols = max(len(r) for r in rows)
            digit_counts = [0] * max_cols
            for r in rows[:10]:
                for i, val in enumerate(r):
                    if i < max_cols and len(re.sub(r"\D", "", val)) >= 10:
                        digit_counts[i] += 1
            if any(digit_counts):
                phone_idx = digit_counts.index(max(digit_counts))
            else:
                phone_idx = 1 if len(rows[0]) > 1 else 0

        if name_idx is None:
            name_idx = 0 if phone_idx != 0 else (1 if len(rows[0]) > 1 else None)

        for row in rows[start_idx:]:
            if not row or not any(row):
                continue
            raw_phone = row[phone_idx].strip() if phone_idx < len(row) else ""
            raw_name = row[name_idx].strip() if name_idx is not None and name_idx < len(row) else ""

            # Swap if phone digits are accidentally in name column
            if not re.search(r"\d", raw_phone) and re.search(r"\d", raw_name):
                raw_phone, raw_name = raw_name, raw_phone

            if not raw_phone:
                continue

            is_valid, formatted, reason = normalize_phone(raw_phone)
            contacts.append({
                "name": raw_name or "Contact",
                "phone": raw_phone,
                "formatted": formatted,
                "is_valid": is_valid,
                "reason": reason,
            })

    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Error parsing bulk contacts file: %s", exc)
        raise HTTPException(400, f"Could not parse file: {exc}") from exc

    valid_count = sum(1 for c in contacts if c["is_valid"])
    return {
        "filename": filename,
        "total": len(contacts),
        "valid_count": valid_count,
        "invalid_count": len(contacts) - valid_count,
        "contacts": contacts,
    }


# ---------------------------------------------------------------------------------------------------
# Audio Preview (Sarvam TTS)
# ---------------------------------------------------------------------------------------------------

@router.post("/preview-audio")
def preview_bulk_audio(payload: PreviewAudioPayload):
    """Synthesizes custom voice script using Sarvam AI (or simulator) and returns audio WAV stream."""
    script = payload.script.strip()
    if not script:
        raise HTTPException(400, "Script text cannot be empty")

    s = get_settings()
    try:
        if s.sarvam_api_key:
            wav_bytes = tts_audio._synthesize(script, source="preview")
        else:
            # Fallback mock audio tone
            from tests.vobiz_helpers import spoken_wav
            wav_bytes = spoken_wav(script[:100])
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as exc:
        log.warning("Could not synthesize preview audio: %s", exc)
        raise HTTPException(503, f"TTS synthesis failed: {exc}") from exc


# ---------------------------------------------------------------------------------------------------
# Bulk Calling Audio Serving & Vobiz Webhooks
# ---------------------------------------------------------------------------------------------------

@router.get("/audio/{campaign_id}/{item_id}.wav")
def get_bulk_call_audio(campaign_id: int, item_id: int, db: Session = Depends(get_db)):
    """Serves synthesized WAV audio for the bulk call broadcast with full byte-range support."""
    camp = db.get(BulkCallCampaign, campaign_id)
    if not camp:
        raise HTTPException(404, "Campaign not found")
    try:
        audio_path = campaign_audio(campaign_id, camp.script.strip())
        return FileResponse(path=str(audio_path), media_type="audio/wav")
    except Exception as exc:
        log.exception("Audio synthesis error for bulk call item %d: %s", item_id, exc)
        raise HTTPException(500, f"Audio error: {exc}") from exc


@router.post("/calls/{item_id}/answer")
@router.get("/calls/{item_id}/answer")
def bulk_call_answer(item_id: int, request: Request, db: Session = Depends(get_db)):
    """Vobiz calls this when recipient answers. Returns VobizXML that plays announcement and hangs up."""
    item = db.get(BulkCallItem, item_id)
    if not item:
        raise HTTPException(404, "Bulk call item not found")
    camp = db.get(BulkCallCampaign, item.campaign_id)

    # Automatically derive public base URL from latest .env or request host
    get_settings.cache_clear()
    s = get_settings()
    from ..config import public_base_url

    base_url = public_base_url()
    if not base_url or "localhost" in base_url or "127.0.0.1" in base_url:
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
        base_url = f"https://{host}"

    # Telephony providers strictly require HTTPS for external audio streaming
    if base_url.startswith("http://"):
        base_url = "https://" + base_url[7:]

    audio_url = f"{base_url}/api/bulk-calling/audio/{camp.id}/{item.id}.wav"
    from ..telephony.vobiz import play_and_hangup
    return Response(content=play_and_hangup([audio_url]), media_type="application/xml")


@router.post("/calls/{item_id}/hangup")
@router.get("/calls/{item_id}/hangup")
async def bulk_call_hangup(item_id: int, request: Request, db: Session = Depends(get_db)):
    """Vobiz posts duration and final status when the call ends."""
    item = db.get(BulkCallItem, item_id)
    if item:
        try:
            form = dict(await request.form()) if "form" in request.headers.get("content-type", "") else {}
            dur = form.get("Duration") or form.get("CallDuration")
            if dur:
                item.duration_seconds = int(float(dur))
            status = form.get("CallStatus", "").lower()
            if status in ("completed", "answered"):
                item.status = "completed"
            elif status in ("busy", "failed", "no-answer"):
                item.status = status
            db.commit()
        except Exception as exc:
            log.warning("Error processing hangup for bulk item %d: %s", item_id, exc)
    return {"status": "recorded"}


# ---------------------------------------------------------------------------------------------------
# Campaign Management & Sequential Execution
# ---------------------------------------------------------------------------------------------------

@router.get("/campaigns")
def list_campaigns(db: Session = Depends(get_db)):
    """Lists all bulk calling campaigns ordered newest first."""
    campaigns = db.query(BulkCallCampaign).order_by(BulkCallCampaign.id.desc()).all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "script": c.script,
            "language": c.language,
            "status": c.status,
            "total_contacts": c.total_contacts,
            "completed_calls": c.completed_calls,
            "failed_calls": c.failed_calls,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "started_at": c.started_at.isoformat() if c.started_at else None,
            "finished_at": c.finished_at.isoformat() if c.finished_at else None,
        }
        for c in campaigns
    ]


@router.post("/campaigns")
def create_campaign(payload: CreateCampaignPayload, db: Session = Depends(get_db)):
    """Creates a new customized bulk calling campaign in inactive state."""
    if not payload.script.strip():
        raise HTTPException(400, "Voice script cannot be empty")
    if not payload.contacts:
        raise HTTPException(400, "Please provide at least one contact phone number")

    campaign = BulkCallCampaign(
        title=payload.title.strip() or f"Bulk Call Campaign {datetime.now().strftime('%d %b %H:%M')}",
        script=payload.script.strip(),
        language=payload.language or "te-IN",
        status="inactive",
        total_contacts=len(payload.contacts),
        completed_calls=0,
        failed_calls=0,
    )
    db.add(campaign)
    db.flush()

    for c in payload.contacts:
        is_valid, formatted, _ = normalize_phone(c.phone)
        item = BulkCallItem(
            campaign_id=campaign.id,
            name=c.name or "Contact",
            phone=formatted if is_valid else c.phone,
            status="pending",
        )
        db.add(item)

    db.commit()
    db.refresh(campaign)

    return {
        "id": campaign.id,
        "title": campaign.title,
        "status": campaign.status,
        "total_contacts": campaign.total_contacts,
        "message": "Campaign created in INACTIVE state. Click 'Activate' to start sequential dialing.",
    }


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Returns details and full live contact-by-contact calling statuses for a campaign."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    items = db.query(BulkCallItem).filter_by(campaign_id=campaign_id).order_by(BulkCallItem.id.asc()).all()
    return {
        "id": campaign.id,
        "title": campaign.title,
        "script": campaign.script,
        "language": campaign.language,
        "status": campaign.status,
        "total_contacts": campaign.total_contacts,
        "completed_calls": campaign.completed_calls,
        "failed_calls": campaign.failed_calls,
        "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
        "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
        "finished_at": campaign.finished_at.isoformat() if campaign.finished_at else None,
        "contacts": [
            {
                "id": it.id,
                "name": it.name,
                "phone": it.phone,
                "status": it.status,
                "duration_seconds": it.duration_seconds,
                "error_message": it.error_message,
                "called_at": it.called_at.isoformat() if it.called_at else None,
            }
            for it in items
        ],
    }


async def _dial_one_by_one(campaign_id: int):
    """Background task that dials each pending recipient sequentially one by one."""
    log.info("Bulk Calling Agent starting campaign #%d one by one...", campaign_id)
    while True:
        with SessionLocal() as db:
            camp = db.get(BulkCallCampaign, campaign_id)
            if not camp or camp.status != "active":
                log.info("Campaign #%d is %s. Halting dialer.", campaign_id, camp.status if camp else "deleted")
                break
            if not runtime_settings(db).bulk_calling_active:
                # Global Bulk Calling switch is off: stop dialing; the campaign resumes when it is activated again
                log.info("Bulk Calling is DEACTIVE. Holding campaign #%d.", campaign_id)
                break

            # Find next pending contact
            item = (
                db.query(BulkCallItem)
                .filter(BulkCallItem.campaign_id == campaign_id, BulkCallItem.status == "pending")
                .order_by(BulkCallItem.id.asc())
                .first()
            )
            if not item:
                # All contacts finished!
                camp.status = "completed"
                camp.finished_at = utcnow()
                db.commit()
                log.info("Campaign #%d successfully completed all calls!", campaign_id)
                break

            # Mark item as calling
            item.status = "calling"
            item.called_at = utcnow()
            db.commit()
            item_id = item.id
            phone_num = item.phone
            script_text = camp.script

        # Perform the actual call execution
        get_settings.cache_clear()
        s = get_settings()
        call_success = True
        duration = 0
        error_msg = None
        call_uuid = None  # set only for a real (Vobiz) call; the Commercials page bills these

        try:
            if s.telephony_provider == "vobiz" and s.vobiz_auth_token and s.vobiz_from_number:
                # Live Vobiz Outbound Call
                from ..telephony.vobiz import VobizProvider, _digits
                provider = VobizProvider()

                from ..config import public_base_url, public_url_dns_problem

                pub_url = public_base_url()
                if pub_url.startswith("http://"):
                    pub_url = "https://" + pub_url[7:]
                if problem := public_url_dns_problem(pub_url):
                    raise Exception(problem)

                answer_url = f"{pub_url}/api/bulk-calling/calls/{item_id}/answer"
                hangup_url = f"{pub_url}/api/bulk-calling/calls/{item_id}/hangup"

                # Pre-synthesize the voice audio and save directly to disk for immediate serving
                if s.sarvam_api_key:
                    try:
                        await asyncio.to_thread(campaign_audio, campaign_id, script_text)  # made once per campaign, reused for every member
                    except Exception as synth_err:
                        log.warning("Pre-synthesis warning for bulk item %s: %s", item_id, synth_err)

                body = {
                    "from": _digits(s.vobiz_from_number),
                    "to": _digits(phone_num),
                    "answer_url": answer_url,
                    "answer_method": "POST",
                    "hangup_url": hangup_url,
                    "hangup_method": "POST",
                    "ring_timeout": str(s.call_ring_timeout_seconds or 30),
                }

                r = httpx.post(provider._api("/Call/"), headers=provider._headers(), json=body, timeout=20)
                if r.status_code >= 400:
                    raise Exception(f"Vobiz API error {r.status_code}: {r.text[:200]}")

                res_data = r.json()
                call_uuid = res_data.get("request_uuid") or res_data.get("call_id")
                log.info("Vobiz outbound bulk call initiated: UUID=%s to %s", call_uuid, phone_num)
                duration = 10
                call_success = True
            else:
                # Simulator mode: simulate realistic ringing & speech playback
                await asyncio.sleep(2.5)
                duration = 6
                call_success = True

        except Exception as exc:
            log.warning("Call to %s failed: %s", phone_num, exc)
            call_success = False
            error_msg = str(exc)

        # Update DB after call finishes
        with SessionLocal() as db:
            item = db.get(BulkCallItem, item_id)
            camp = db.get(BulkCallCampaign, campaign_id)
            if item:
                item.status = "completed" if call_success else "failed"
                item.duration_seconds = duration if call_success else 0
                item.error_message = error_msg
                if call_uuid:
                    item.call_id = str(call_uuid)
            if camp:
                if call_success:
                    camp.completed_calls += 1
                else:
                    camp.failed_calls += 1
            db.commit()

        # Space out calls by 2 seconds
        await asyncio.sleep(2.0)

    # Clean up runner record
    ACTIVE_RUNNERS.pop(campaign_id, None)


def _launch_runner(campaign_id: int):
    runner = ACTIVE_RUNNERS.get(campaign_id)
    if runner is not None and not runner.done():
        return  # already dialing this campaign
    try:
        loop = asyncio.get_running_loop()
        ACTIVE_RUNNERS[campaign_id] = loop.create_task(_dial_one_by_one(campaign_id))
    except RuntimeError:
        import threading
        t = threading.Thread(target=lambda: asyncio.run(_dial_one_by_one(campaign_id)), daemon=True)
        t.start()


def _bulk_status(db: Session) -> dict:
    active = runtime_settings(db).bulk_calling_active
    return {
        "active": active,
        "status": "active" if active else "deactive",
        "message": (
            "Bulk Calling is ACTIVE. Active campaigns dial contacts one by one."
            if active
            else "Bulk Calling is DEACTIVE. No bulk calls will be placed."
        ),
    }


@router.get("/agent/status")
def bulk_calling_status(db: Session = Depends(get_db)):
    """Global Bulk Calling switch (independent of the automated Calling Agent). Starts DEACTIVE."""
    return _bulk_status(db)


@router.post("/agent/activate")
async def activate_bulk_calling(db: Session = Depends(get_db)):
    save_runtime_settings(db, {"bulk_calling_active": True})
    db.commit()
    # Resume every campaign that was left active while the switch was off
    for (cid,) in db.query(BulkCallCampaign.id).filter(BulkCallCampaign.status == "active").all():
        _launch_runner(cid)
    return _bulk_status(db)


@router.post("/agent/deactivate")
def deactivate_bulk_calling(db: Session = Depends(get_db)):
    save_runtime_settings(db, {"bulk_calling_active": False})
    db.commit()
    return _bulk_status(db)


@router.post("/campaigns/{campaign_id}/activate")
async def activate_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Activates the campaign; starts sequential one-by-one dialing."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    if not runtime_settings(db).bulk_calling_active:
        raise HTTPException(
            409, "Bulk Calling is DEACTIVE. Click 'Activate Bulk Calling' at the top before starting a campaign."
        )

    campaign.status = "active"
    if not campaign.started_at:
        campaign.started_at = utcnow()
    db.commit()

    _launch_runner(campaign_id)

    return {
        "id": campaign.id,
        "status": "active",
        "message": "Bulk Calling Agent ACTIVATED. Dialing contacts one by one.",
    }


@router.post("/campaigns/{campaign_id}/deactivate")
def deactivate_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Deactivates / pauses the bulk campaign; stops sequential dialing immediately."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    campaign.status = "paused"
    db.commit()

    return {
        "id": campaign.id,
        "status": "paused",
        "message": "Bulk Calling Agent DEACTIVATED (Paused). No further calls will be placed.",
    }


@router.post("/campaigns/{campaign_id}/cancel")
def cancel_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Cancels the campaign and marks all remaining pending items as cancelled."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    campaign.status = "cancelled"
    campaign.finished_at = utcnow()
    db.query(BulkCallItem).filter(
        BulkCallItem.campaign_id == campaign_id,
        BulkCallItem.status == "pending"
    ).update({"status": "failed", "error_message": "Campaign cancelled by user"})
    db.commit()

    return {
        "id": campaign.id,
        "status": "cancelled",
        "message": "Campaign cancelled.",
    }


@router.post("/campaigns/{campaign_id}/reset")
def reset_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Resets all contacts in a campaign back to pending state so it can be re-dialed."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    db.query(BulkCallItem).filter(
        BulkCallItem.campaign_id == campaign_id
    ).update({"status": "pending", "duration_seconds": 0, "error_message": None, "called_at": None})
    campaign.status = "inactive"
    campaign.completed_calls = 0
    campaign.failed_calls = 0
    campaign.started_at = None
    campaign.finished_at = None
    db.commit()

    return {
        "id": campaign.id,
        "status": "inactive",
        "message": "Campaign contacts reset to pending. Click 'Activate' to start dialing.",
    }


@router.post("/campaigns/{campaign_id}/retry-failed")
def retry_failed_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Resets only failed contacts back to pending so they can be re-dialed."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    failed_items = (
        db.query(BulkCallItem)
        .filter(BulkCallItem.campaign_id == campaign_id, BulkCallItem.status == "failed")
        .all()
    )
    count = len(failed_items)
    for it in failed_items:
        it.status = "pending"
        it.duration_seconds = 0
        it.error_message = None
        it.called_at = None

    campaign.failed_calls = max(0, campaign.failed_calls - count)
    campaign.status = "inactive"
    db.commit()

    return {
        "id": campaign.id,
        "status": "inactive",
        "retried_count": count,
        "message": f"Reset {count} failed contacts to pending. Click 'Activate' to retry.",
    }


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Deletes a campaign and its items."""
    campaign = db.get(BulkCallCampaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    db.delete(campaign)
    db.commit()
    return {"ok": True, "message": "Campaign deleted."}
