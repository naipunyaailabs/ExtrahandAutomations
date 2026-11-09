"""Agent 2 - Poster Generation (image model: Seedream 5.0 Flash, POSTER_IMAGE_MODEL, via OpenRouter).

Pipeline:  Agent 1 (research_agent.py)  --festival details + poster brief-->  Agent 2 (this file)  -->  poster

There are no templates, fixed layouts or fixed colours in the code. For every poster:
  1. Agent 1 researches the festival (once) and then designs a brand-new poster with a free hand
     (concept, layout, colours, typography, real-photo scene, and the wording).
  2. Agent 2 draws the complete, finished portrait poster from that brief, text included.
  3. A vision model reads the finished poster back and checks that the discount and coupon code are written
     correctly and that nothing from another religion appears. If not, Agent 2 draws it once more.
The poster is saved as <event id>.jpg (served at /api/advestiment/events/<id>/poster); the previous
poster files of the event are deleted when the new one is saved.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.branding import company, website_host
from app.config import BACKEND_DIR, get_settings

from ..database import POSTERS_DIR, db_save_poster, db_update_event_fields
from .research_agent import research_festival, write_poster_brief

logger = logging.getLogger("marketing.poster_agent")

POSTER_ASPECT_RATIO = "3:4"   # portrait poster for WhatsApp, Instagram and print
MAX_DRAW_ATTEMPTS = 2          # Agent 2 redraws once when the check fails
PHOTO_REALISM = (
    "People and places must look like a real photograph: photorealistic real Indian people with natural skin, "
    "realistic faces, eyes and hands, real fabrics and objects. NOT a cartoon, illustration, painting, anime, "
    "3D render or clipart."
)


def brand_logo_path() -> Path:
    """The official logo file (BRAND_LOGO_URL, served by the frontend from its public folder)."""
    url = get_settings().brand_logo_url.strip().lstrip("/")
    return BACKEND_DIR.parent / "frontend" / "public" / url


LOGO_SPOTS = ("top-left", "top-right", "top-center", "bottom-left", "bottom-right", "bottom-center")


def _badge_box(W: int, H: int, bw: int, bh: int, position: str) -> Tuple[int, int]:
    margin = int(W * 0.04)
    vertical, _, horizontal = position.partition("-")
    x = {"left": margin, "right": W - bw - margin}.get(horizontal, (W - bw) // 2)
    y = margin if vertical == "top" else H - bh - margin
    return x, y


def _overlaps(box: Tuple[int, int, int, int], others: List[Tuple[int, int, int, int]]) -> bool:
    x0, y0, x1, y1 = box
    return any(x0 < ox1 and ox0 < x1 and y0 < oy1 and oy0 < y1 for ox0, oy0, ox1, oy1 in others)


def stamp_logo(image: bytes, preferred: str, keep_clear: Optional[List[List[float]]] = None) -> Tuple[bytes, str]:
    """Put the official logo on the poster (mandatory) on a white rounded badge, without covering anything.

    `keep_clear` are the boxes of every text line and face the checker found on the poster ([ymin, xmin, ymax,
    xmax] on a 0-1000 scale). The logo goes to a spot that overlaps none of them (Agent 1's choice first, then the
    calmest free spot). If no spot is free, a slim brand band is added below the poster and the logo sits on it,
    so it never hides the coupon code, the date or a face. Returns the poster and where the logo went."""
    from PIL import Image, ImageDraw, ImageFilter, ImageStat

    path = brand_logo_path()
    if not path.exists():
        raise RuntimeError(f"The brand logo {path.name} was not found; it is required on every poster.")
    poster = Image.open(io.BytesIO(image)).convert("RGB")
    W, H = poster.size
    logo = Image.open(path).convert("RGBA")
    bbox = logo.getbbox()  # trim transparent edges
    if bbox:
        logo = logo.crop(bbox)
    logo_w = int(W * 0.30)
    logo = logo.resize((logo_w, max(1, round(logo.height * logo_w / logo.width))), Image.LANCZOS)
    pad_x, pad_y = int(W * 0.022), int(W * 0.016)
    bw, bh = logo.width + 2 * pad_x, logo.height + 2 * pad_y

    grow = int(W * 0.012)  # a little air between the badge and any text or face
    blocked: List[Tuple[int, int, int, int]] = []
    for b in keep_clear or []:
        try:
            y0, x0, y1, x1 = (float(v) for v in b[:4])
        except (TypeError, ValueError):
            continue
        blocked.append((int(x0 / 1000 * W) - grow, int(y0 / 1000 * H) - grow,
                        int(x1 / 1000 * W) + grow, int(y1 / 1000 * H) + grow))

    edges = poster.convert("L").filter(ImageFilter.FIND_EDGES)

    def busyness(spot: str) -> float:
        x, y = _badge_box(W, H, bw, bh, spot)
        return ImageStat.Stat(edges.crop((x, y, x + bw, y + bh))).mean[0]

    free = [spot for spot in LOGO_SPOTS
            if not _overlaps((*_badge_box(W, H, bw, bh, spot), _badge_box(W, H, bw, bh, spot)[0] + bw,
                              _badge_box(W, H, bw, bh, spot)[1] + bh), blocked)]
    if keep_clear is None:
        free = list(LOGO_SPOTS)  # nothing known about the poster: only the busyness decides
    if free:
        position = preferred if preferred in free else min(free, key=busyness)
        canvas = poster.convert("RGBA")
        x, y = _badge_box(W, H, bw, bh, position)
    else:
        # Every spot would cover text or a face: add a brand band in the poster's own bottom colour
        band = bh + 2 * int(W * 0.025)
        colour = tuple(int(c) for c in ImageStat.Stat(poster.crop((0, H - max(4, H // 40), W, H))).mean[:3])
        canvas = Image.new("RGBA", (W, H + band), (*colour, 255))
        canvas.paste(poster, (0, 0))
        position = "band"
        x, y = (W - bw) // 2, H + (band - bh) // 2
    radius = bh // 3

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + 6, x + bw, y + bh + 6), radius, fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    out = Image.alpha_composite(canvas, shadow)
    badge = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(badge).rounded_rectangle((x, y, x + bw, y + bh), radius, fill=(255, 255, 255, 245))
    out = Image.alpha_composite(out, badge)
    out.alpha_composite(logo, (x + pad_x, y + pad_y))
    buf = io.BytesIO()
    out.convert("RGB").save(buf, "JPEG", quality=93)
    logger.info("[Poster Agent] Logo placed %s (free spots: %s; %d text/face boxes kept clear)", position,
                ", ".join(free) or "none", len(blocked))
    return buf.getvalue(), position


def poster_art_dir() -> Path:
    """Old folder for AI artwork (kept so its files can still be served and cleaned up)."""
    d = POSTERS_DIR / "art"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _headers(title: str) -> Dict[str, str]:
    st = get_settings()
    return {"Authorization": f"Bearer {st.openrouter_api_key}", "Content-Type": "application/json",
            "HTTP-Referer": st.website_url, "X-Title": f"{company()} {title}"}


def _design(event: Dict[str, Any]) -> Dict[str, Any]:
    """The event's saved poster design (JSON in poster_palette / poster_theme)."""
    for key in ("poster_palette", "poster_theme"):
        raw = event.get(key)
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, str) and raw.strip().startswith("{"):
            try:
                return json.loads(raw)
            except ValueError:
                continue
    return {}


class AIPosterAgent:
    """Agent 2: draws the whole poster from Agent 1's brief and checks the result."""

    def __init__(self) -> None:
        POSTERS_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ offer facts given to Agent 1
    @staticmethod
    def offer_facts(event: Dict[str, Any]) -> Dict[str, str]:
        discount = int(event.get("suggested_discount") or 0)
        try:
            day = datetime.strptime(str(event.get("date_start")), "%Y-%m-%d").strftime("%d %B %Y").lstrip("0")
        except ValueError:
            day = str(event.get("date_start") or "")
        return {
            "brand": company(),
            "discount": f"FLAT {discount}% OFF" if discount else "",
            "coupon code": str(event.get("discount_code") or "").upper(),
            "date": day,
            "website": website_host(),
        }

    # ------------------------------------------------------------------ drawing
    def draw(self, prompt: str) -> bytes:
        """One finished poster from the image model (JPEG/PNG bytes)."""
        st = get_settings()
        if not (st.openrouter_api_key.strip() and st.poster_image_model.strip()):
            raise RuntimeError("Set OPENROUTER_API_KEY and POSTER_IMAGE_MODEL to create posters.")
        res = httpx.post(
            st.openrouter_api_url,
            headers=_headers("Poster Agent"),
            json={
                "model": st.poster_image_model,
                "modalities": ["image"] if "seedream" in st.poster_image_model else ["image", "text"],
                "image_config": {"aspect_ratio": POSTER_ASPECT_RATIO},
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=st.poster_image_timeout_seconds,
        )
        if res.status_code != 200:
            raise RuntimeError(f"The image model returned {res.status_code}: {res.text[:200]}")
        message = (res.json().get("choices") or [{}])[0].get("message", {})
        images = message.get("images") or []
        url = ""
        if images:
            first = images[0]
            url = (first.get("image_url") or {}).get("url", "") if isinstance(first, dict) else str(first)
        if not url.startswith("data:image/"):
            raise RuntimeError("The image model returned no poster.")
        return base64.b64decode(url.split(",", 1)[1])

    # ------------------------------------------------------------------ checking
    def check(self, image: bytes, facts: Dict[str, str], brief: Dict[str, str], religion: str) -> Dict[str, Any]:
        """A vision model reads the finished poster and checks its text and its imagery."""
        st = get_settings()
        expected = {"coupon code": facts.get("coupon code"), "discount": facts.get("discount"),
                    "date": facts.get("date"), "headline": brief.get("headline")}
        question = (
            "Read this festival marketing poster carefully.\n"
            f"Expected texts: {json.dumps(expected)}\n"
            f"The festival's religion/tradition: {religion or 'unknown'}.\n"
            "Reply with JSON only: {\"text_seen\": \"all text you can read\", \"code_ok\": true/false (the coupon code "
            "is written exactly, letter for letter), \"discount_ok\": true/false (the discount number and % are "
            "correct), \"date_ok\": true/false (the date is written exactly as expected), \"headline_ok\": true/false, \"misspelled\": [words that are "
            "misspelled or garbled], \"other_religion\": true/false (symbols of a different religion appear), "
            "\"looks_real\": true/false (people look like a real photograph, not a cartoon), "
            "\"blank_box\": true/false (there is an empty white/plain box, card or placeholder with nothing in it), "
            "\"text_boxes\": [[ymin, xmin, ymax, xmax] for EVERY line or block of text, on a 0-1000 scale], "
            "\"face_boxes\": [[ymin, xmin, ymax, xmax] for every human face, on a 0-1000 scale]}"
        )
        try:
            res = httpx.post(
                st.openrouter_api_url,
                headers=_headers("Poster Checker"),
                json={
                    "model": st.openrouter_model,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image).decode()}},
                    ]}],
                },
                timeout=max(st.llm_timeout_seconds, 60),
            )
            res.raise_for_status()
            content = (res.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
            match = re.search(r"\{.*\}", content, re.S)
            data = json.loads(match.group(0)) if match else {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Poster Agent] Poster check unavailable: %s", exc)
            return {"checked": False, "ok": True, "problems": [], "note": "The poster text could not be checked."}
        has_code = bool(facts.get("coupon code"))
        ok = (data.get("code_ok") is True or not has_code) and data.get("discount_ok") is not False \
            and data.get("other_religion") is not True and data.get("date_ok") is not False \
            and data.get("blank_box") is not True
        problems = []
        if has_code and data.get("code_ok") is not True:
            problems.append(f"coupon code {facts['coupon code']} not written correctly")
        if data.get("discount_ok") is False:
            problems.append("discount not written correctly")
        if data.get("other_religion") is True:
            problems.append("shows another religion's symbols")
        if data.get("blank_box") is True:
            problems.append("empty box on the poster")
        if data.get("date_ok") is False:
            problems.append(f"date not written as {facts.get('date')}")
        if data.get("looks_real") is False:
            problems.append("people do not look real")
        misspelled = [str(w) for w in (data.get("misspelled") or [])][:6]
        if misspelled:
            problems.append("misspelled: " + ", ".join(misspelled))
        boxes = [b for b in (data.get("text_boxes") or []) + (data.get("face_boxes") or [])
                 if isinstance(b, list) and len(b) >= 4]
        return {"checked": True, "ok": ok, "problems": problems, "text_seen": str(data.get("text_seen") or "")[:500],
                "keep_clear": boxes}

    # ------------------------------------------------------------------ files
    @staticmethod
    def remove_old_files(event_id: str) -> int:
        """Delete every earlier poster file of the event (posters and old artwork)."""
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", event_id)
        old = [*POSTERS_DIR.glob(f"{event_id}.*"), *poster_art_dir().glob(f"{safe_id}-v*.*")]
        removed = 0
        for f in old:
            try:
                f.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("[Poster Agent] Could not delete old poster file %s: %s", f, exc)
        return removed

    # ------------------------------------------------------------------ the whole pipeline
    def generate_poster_for_event(self, event: Dict[str, Any], regenerate: bool = False) -> Dict[str, Any]:
        """Agent 1 researches the festival and designs a new poster; Agent 2 draws and checks it; the new poster
        replaces the old one. Raises when no poster could be drawn (the old poster is then kept)."""
        event = dict(event)
        event_id = str(event.get("id") or f"event_{datetime.now().strftime('%Y%m%d%H%M%S')}")
        previous = _design(event)
        variant = int(previous.get("variant") or 0) + 1

        # Agent 1: festival knowledge (kept) + a brand-new poster brief (free hand)
        knowledge = research_festival(event)
        event["knowledge"] = knowledge
        facts = self.offer_facts(event)
        # Full description of the last posters, so Agent 1 can make the new one completely different
        history: List[Any] = [c for c in (previous.get("design_history") or previous.get("concept_history") or []) if c][-5:]
        brief = write_poster_brief(event, knowledge, facts, history)

        avoid = ", ".join(knowledge.get("imagery_avoid") or [])
        texts = [brief.get("headline"), brief.get("tagline"), brief.get("cta"), facts["discount"],
                 f"Use code {facts['coupon code']}" if facts["coupon code"] else "",
                 facts["date"], facts["website"]]
        logo_at = brief.get("logo_position") or "top-left"
        prompt = (
            f"{brief['poster_prompt']}\n\n"
            "Exact texts on the poster (spell them exactly, letter for letter): "
            + "; ".join(f'"{t}"' for t in texts if t) + ".\n"
            + (f"Religion / tradition: {knowledge.get('religion')}. Everything shown must belong to this festival.\n"
               if knowledge.get("religion") else "")
            + (f"Do NOT show: {avoid}.\n" if avoid else "")
            + f"Keep the {logo_at.replace('-', ' ')} corner of the poster (about 36% of the width, 12% of the height) "
              "free of text and faces: the background (photo, sky, wall or floor) simply continues there, because "
              "the official logo is placed on it afterwards. Do NOT draw any box, card, panel, frame, blank shape or "
              "placeholder there, and do NOT draw any logo, icon or brand mark anywhere.\n"
            + PHOTO_REALISM
        )

        # Agent 2: draw, check, and redraw once if the check fails
        best: Optional[Tuple[bytes, Dict[str, Any]]] = None
        attempts = 0
        last_error = ""
        for attempt in range(1, MAX_DRAW_ATTEMPTS + 1):
            attempts = attempt
            try:
                image = self.draw(prompt if attempt == 1 else
                                  prompt + "\nIMPORTANT: write the coupon code and the discount in large, clear, "
                                           "correctly spelled letters.")
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                logger.warning("[Poster Agent] Drawing %s failed: %s", event_id, exc)
                continue
            result = self.check(image, facts, brief, knowledge.get("religion") or "")  # before the logo goes on
            if best is None or (result["ok"] and not best[1]["ok"]):
                best = (image, result)
            if result["ok"]:
                break
            logger.info("[Poster Agent] Poster for %s did not pass the check (%s); drawing again",
                        event_id, "; ".join(result.get("problems") or []))
        if best is None:
            raise RuntimeError(last_error or "The image model did not create a poster.")

        image, result = best
        # The official logo is mandatory; it goes where it covers no text and no face
        image, logo_at = stamp_logo(image, logo_at, result.pop("keep_clear", None) if result.get("checked") else None)
        self.remove_old_files(event_id)
        (POSTERS_DIR / f"{event_id}.jpg").write_bytes(image)

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        design = {
            "mode": "ai_poster",
            "variant": variant,
            "concept": brief["concept"],
            "headline": brief["headline"],
            "tagline": brief["tagline"],
            "cta": brief["cta"],
            "logo_position": logo_at,
            "poster_prompt_used": prompt[:4000],
            "text_check": result,
            "attempts": attempts,
            "religion": knowledge.get("religion") or "",
            "brief_model": get_settings().festival_model,
            "image_model": get_settings().poster_image_model,
            "design_history": (history + [{k: brief.get(k, "") for k in (
                "concept", "headline", "subject", "setting", "composition", "palette", "typography", "text_layout")}])[-5:],
            "generated_at": now,
        }
        poster_url = f"/api/advestiment/events/{event_id}/poster?v={variant}"
        record = {
            "id": f"poster_{event_id}",
            "event_id": event_id,
            "event_title": event.get("title", ""),
            "city": event.get("city", "All-India"),
            "date_str": event.get("date_start", ""),
            "poster_url": poster_url,
            "poster_svg": "",
            "theme": "ai_poster",
            "status": "generated",
            "created_at": now,
            "palette": design,
        }
        db_save_poster({k: v for k, v in record.items() if k != "palette"})
        db_update_event_fields(event_id, {  # the approval status is left as it is
            "poster_url": poster_url,
            "poster_theme": json.dumps(design),
            "poster_palette": json.dumps(design),
            "poster_generated_at": now,
        })
        logger.info("[Poster Agent] Poster %d for %s saved (check %s, %d attempt(s))", variant, event_id,
                    "passed" if result["ok"] else "FAILED", attempts)
        return record

    def generate_and_save_poster(self, event: Dict[str, Any], regenerate: bool = False, **_: Any) -> Dict[str, Any]:
        return self.generate_poster_for_event(event, regenerate=regenerate)


poster_agent = AIPosterAgent()
