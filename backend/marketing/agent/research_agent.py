"""Agent 1 - Festival Research & Prompt Generator (text LLM: GPT-OSS-20B, FESTIVAL_MODEL, via OpenRouter).

Pipeline:  Agent 1 (this file) --structured festival details + image prompt--> Agent 2 (poster_agent.py) --> poster

Finding the festivals and their dates (and checking them against Drik Panchang / IMD) is done by the festival
finder (festival_finder.py), which also belongs to Agent 1. For every festival this module then:
  - understands the festival: what it is, its religion, its story, rituals, symbols, colours, clothing,
    food, places, regions and greeting, and what a respectful poster must show and must avoid;
  - writes a detailed poster-generation prompt for the image model (Agent 2).
The result is saved on the festival as `knowledge` and is made again only when the festival name changes.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Callable, Dict, Optional

import httpx

from app.branding import company
from app.config import get_settings

from ..database import db_update_event_fields

logger = logging.getLogger("marketing.research_agent")

TEXT_FIELDS = ("summary", "religion", "significance", "greeting", "image_prompt")
LOGO_POSITIONS = ("top-left", "top-right", "top-center", "bottom-left", "bottom-right", "bottom-center")
LIST_FIELDS = ("figures", "rituals", "symbols", "colors", "attire", "foods", "places", "regions",
               "imagery_do", "imagery_avoid")


def _ask(prompt: str, temperature: float = 0.3) -> Dict[str, Any]:
    st = get_settings()
    res = httpx.post(
        st.openrouter_api_url,
        headers={"Authorization": f"Bearer {st.openrouter_api_key}", "HTTP-Referer": st.website_url,
                 "X-Title": f"{company()} Festival Research Agent"},
        json={
            "model": st.festival_model,
            "messages": [
                {"role": "system", "content": "You are an expert on Indian festivals and religions and a prompt "
                                              "writer for image generation models. Reply with JSON only."},
                {"role": "user", "content": prompt},
            ],
            "reasoning": {"effort": "low"},
            "temperature": temperature,
        },
        timeout=st.festival_llm_timeout_seconds,
    )
    if res.status_code != 200:
        raise RuntimeError(f"{st.festival_model} returned {res.status_code}: {res.text[:160]}")
    content = (res.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
    match = re.search(r"\{.*\}", content, re.S)
    return json.loads(match.group(0)) if match else {}


def research_festival(event: Dict[str, Any], chat: Optional[Callable[[str], Dict[str, Any]]] = None,
                      force: bool = False) -> Dict[str, Any]:
    """Structured festival details + image prompt for one festival (Agent 1). Returns the saved result when it is
    still valid, {} when no model is available."""
    title = str(event.get("title") or "").strip()
    old = event.get("knowledge") if isinstance(event.get("knowledge"), dict) else {}
    if not force and old.get("summary") and old.get("_for") == title:
        return old
    st = get_settings()
    if not title or not (chat or st.openrouter_api_key.strip()):
        return old
    where = "all of India" if event.get("city") in ("All-India", "", None) else f"{event.get('city')}, India"
    prompt = (
        "Research this Indian festival so that a culturally correct marketing poster can be made for it.\n"
        f"Festival: {title}\nDate: {event.get('date_start', '')}\nWhere: {where}\n"
        f"Notes from the admin: {event.get('description') or '-'}\n\n"
        "Reply with JSON only, with these keys:\n"
        "summary (2 sentences: what the festival is), religion (the religion or tradition it belongs to: Hindu, "
        "Muslim, Christian, Sikh, Buddhist, Jain, Parsi, tribal/regional, or national/secular), significance "
        "(1-2 sentences: its story or meaning), greeting (the customary greeting); arrays of short items: figures "
        "(deities, saints or people honoured), rituals, symbols, colors (traditional colours), attire, foods, places "
        "(where it is celebrated: church, gurudwara, mosque, temple, home, river ghat...), regions (parts of India), "
        "imagery_do (what a poster for it should show), imagery_avoid (symbols, deities or imagery of OTHER religions "
        "or festivals that must not appear, and anything disrespectful);\n"
        "image_prompt: a detailed prompt (80-140 words) for an image generation model to create the hero picture of "
        f"this festival's poster as a REAL PHOTOGRAPH (photorealistic, real Indian people, not a cartoon, illustration "
        f"or painting), set in {where}: the main subject, the setting, the people and their attire, the "
        "ritual moment, the festival's own symbols, lighting, colours and mood. It must be true to this festival's "
        "religion and show nothing from other religions. No text, letters, numbers or logos in the picture.\n"
        "If you are not sure about something, leave it out rather than guess."
    )
    try:
        data = (chat or _ask)(prompt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Agent 1] Research on %s failed: %s", title, exc)
        return old
    result: Dict[str, Any] = {k: str(data.get(k) or "").strip()[:1200 if k == "image_prompt" else 400]
                              for k in TEXT_FIELDS}
    for k in LIST_FIELDS:
        v = data.get(k)
        items = v if isinstance(v, list) else ([v] if v else [])
        result[k] = [str(x).strip()[:80] for x in items if str(x).strip()][:8]
    if not result["summary"]:
        return old
    result.update(_for=title, model=st.festival_model, learned_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    if event.get("id"):
        db_update_event_fields(event["id"], {"knowledge": result})
    logger.info("[Agent 1] Researched %s (%s); image prompt ready", title, result["religion"] or "tradition unknown")
    return result


def write_poster_brief(event: Dict[str, Any], knowledge: Dict[str, Any], offer: Dict[str, str],
                       previous_concepts: Optional[list] = None,
                       chat: Optional[Callable[[str], Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Agent 1 designs a brand-new poster for the festival, with a free hand: the creative concept, layout,
    colours, typography, the real-photo scene and where every line of text goes. Only the offer facts in
    `offer` (brand, discount, coupon code, date, website) are given and must be written exactly.
    Returns {concept, headline, tagline, cta, poster_prompt}; raises when the model gives no prompt."""
    title = str(event.get("title") or "").strip()
    where = "all of India" if event.get("city") in ("All-India", "", None) else f"{event.get('city')}, India"
    facts = "\n".join(f"- {k}: {v}" for k, v in offer.items() if v)
    learnt = "\n".join(
        f"- {k}: {', '.join(v) if isinstance(v, list) else v}"
        for k, v in knowledge.items()
        if v and k in ("summary", "religion", "significance", "greeting", "figures", "rituals", "symbols", "colors",
                       "attire", "foods", "places", "imagery_do", "imagery_avoid")
    )
    past = []
    for i, d in enumerate(previous_concepts or [], 1):
        if isinstance(d, dict):
            past.append(f"{i}. " + "; ".join(f"{k}: {d[k]}" for k in ("concept", "headline", "subject", "setting", "composition",
                                                                       "palette", "typography", "text_layout") if d.get(k)))
        elif d:
            past.append(f"{i}. concept: {d}")
    prompt = (
        f"You are the creative director of {company()}, an Indian home-services company. Design a NEW, eye-catching "
        f"festival marketing poster for {title} ({event.get('date_start', '')}, {where}). You have a completely free "
        "hand: choose the concept, layout, composition, colour palette, typography, decorative elements and the "
        "scene yourself. Make it premium and attractive, like a top Indian brand's festival campaign.\n\n"
        f"What we know about the festival:\n{learnt or '- ' + title}\n"
        f"Admin notes: {event.get('description') or '-'}\n\n"
        f"Offer facts that MUST appear on the poster exactly as written (keep the coupon code letter-for-letter):\n{facts}\n\n"
        + ("Earlier posters for this festival (the new one must look COMPLETELY different from every one of them: "
           "a different main subject, setting, camera angle/composition, colour palette, typography, text layout and headline wording):\n"
           + "\n".join(past) + "\n\n" if past else "")
        + "Creative process: first brainstorm 4 very different poster ideas. Vary the main subject (not always a family "
        "- for example one person in a striking portrait, hands performing a ritual in close-up, an aerial or "
        "wide view of a place, a still life of the festival's objects and food, a street or community celebration, "
        "a home being prepared, children, elders, a couple), the setting, the time of day and light, the camera "
        "angle, the colour palette (bold, pastel, monochrome, jewel tones, warm or cool) and the typography and text "
        "layout. Then choose the idea that is MOST different from the earlier posters and design that one.\n\n"
        + "Rules: the people and places must look like a REAL PHOTOGRAPH (photorealistic real Indian people, natural "
        "skin, real faces and hands; not a cartoon, illustration, painting or 3D render). Everything must be true to "
        "this festival and its religion; show nothing from other religions or festivals. Keep the text short and "
        "large so it is easy to read; spell every word correctly.\n"
        f"Brand logo (mandatory): the official {company()} logo is placed on the finished poster afterwards, on a "
        "small white rounded badge about 34% of the poster width. Choose where it goes (logo_position) and keep that "
        "corner free of text and faces, with the background (photo, sky, wall or floor) simply continuing there - no "
        "empty box, card, panel or placeholder. Do NOT draw any logo, icon or brand mark "
        f"yourself, and do not write the brand name \"{company()}\" separately (the logo carries it).\n\n"
        "Reply with JSON only:\n"
        "ideas: the 4 brainstormed ideas, one short sentence each,\n"
        "concept: one sentence describing the chosen idea,\n"
        "subject: the main subject in a few words, setting: the place and time of day, composition: the camera angle "
        "and framing, palette: the main colours, typography: the font style, text_layout: where the texts are placed,\n"
        "headline: the big greeting / festival line (max 6 words),\n"
        "tagline: a short supporting line (max 10 words),\n"
        "cta: a call to action inviting customers to book a home service and get the discount (max 10 words, must "
        "include the discount),\n"
        "logo_position: one of top-left, top-right, top-center, bottom-left, bottom-right, bottom-center,\n"
        "poster_prompt: a complete, detailed prompt (180-260 words) for an image generation model to create the "
        "FINISHED portrait poster: describe the layout from top to bottom, the photographic scene, the colour palette, "
        "the typography style, the decorative elements, which corner stays free for the logo, and place each text in "
        "double quotes exactly as it must be written: the headline, the tagline, the cta, the discount, the coupon "
        "code, the date and the website."
    )
    data = chat(prompt) if chat else _ask(prompt, temperature=0.95)  # creative: high temperature
    brief = {k: re.sub(r"\s+", " ", str(data.get(k) or "")).strip()
             for k in ("concept", "headline", "tagline", "cta", "poster_prompt", "logo_position", "subject",
                       "setting", "composition", "palette", "typography", "text_layout")}
    if brief["logo_position"] not in LOGO_POSITIONS:
        brief["logo_position"] = "top-left"
    if len(brief["poster_prompt"]) < 80:
        raise RuntimeError("Agent 1 did not write a poster prompt.")
    logger.info("[Agent 1] Poster brief for %s: %s", title, brief["concept"][:120])
    return brief
