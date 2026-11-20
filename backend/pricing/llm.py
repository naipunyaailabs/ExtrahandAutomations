"""OpenRouter chat call that returns parsed JSON. Uses the marketing agent's key and, by default, free models."""

import asyncio
import json
import logging
import re

import httpx

from app.config import get_settings

logger = logging.getLogger("pricing.llm")

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# A cap on every reply. Without one OpenRouter reserves the model's maximum (65,535 tokens) against the account's
# credit, so an account with 15 cents left is refused even though the reply would cost a fraction of a cent.
MAX_TOKENS_JSON = 8192  # leaves room for the model's own reasoning before the JSON
MAX_TOKENS_TEXT = 4096
RETRY_PAUSE = 15.0  # seconds before a second pass when every model was rate limited (free models allow ~20 a minute)


class LLMUnavailable(RuntimeError):
    """OpenRouter refuses this key or account (no credit, bad key, free quota used up): every call would fail the same way."""


def llm_configured() -> bool:
    return bool(get_settings().openrouter_api_key)


def models_to_try() -> list[str]:
    s = get_settings()
    return [m.strip() for m in s.pricing_llm_models.split(",") if m.strip()] or [s.openrouter_model]


def parse_json(text: str):
    """JSON from a model reply, tolerating ```json fences and text around it."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"[\[{].*[\]}]", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                pass
    return None


def _refusal(res: httpx.Response) -> str:
    try:
        message = res.json()["error"]["message"]
    except Exception:
        message = res.text
    return f"OpenRouter refused the request ({res.status_code}): {' '.join(str(message).split())[:300]}"


def _read(res: httpx.Response, json_mode: bool):
    """The reply in a 200 answer (parsed JSON when json_mode); None when the model said nothing usable."""
    try:
        content = (res.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
    except Exception as exc:
        logger.warning("[Pricing] OpenRouter reply could not be read: %s", exc)
        return None
    if json_mode:
        return parse_json(content)
    return content.strip() or None


async def chat(prompt: str, *, system: str, json_mode: bool, temperature: float = 0.1, timeout: float = 90.0,
               transport: httpx.AsyncBaseTransport | None = None):
    """Model reply (parsed JSON when json_mode). The models in PRICING_LLM_MODELS are tried in order: a free model
    that is rate limited, retired, slow or answers badly is simply skipped. None when no key is set or nothing usable
    came back for an ordinary reason. Raises LLMUnavailable when OpenRouter refuses the key or account, the free
    quota for the day is used up, or every model was turned away (rate limit, data policy, retired)."""
    s = get_settings()
    if not s.openrouter_api_key:
        return None
    payload = {
        "temperature": temperature,
        "max_tokens": MAX_TOKENS_JSON if json_mode else MAX_TOKENS_TEXT,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    headers = {
        "Authorization": f"Bearer {s.openrouter_api_key}",
        "HTTP-Referer": "https://extrahand.in",
        "X-Title": "ExtraHand Pricing Agent",
    }
    turned_away = ""  # why OpenRouter would not serve a model (rate limit, data policy, retired): reported if none works
    async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
        for attempt in range(2):
            rate_limited = False
            for model in models_to_try():
                try:
                    res = await client.post(OPENROUTER_API_URL, headers=headers, json=payload | {"model": model})
                except Exception as exc:
                    logger.warning("[Pricing] OpenRouter call to %s failed: %s", model, exc)
                    continue
                if res.status_code in (401, 402, 403):
                    raise LLMUnavailable(_refusal(res))
                if res.status_code == 200:
                    reply = _read(res, json_mode)
                    if reply is not None:
                        return reply
                    logger.warning("[Pricing] %s gave no usable reply; trying the next model", model)
                    continue
                logger.warning("[Pricing] OpenRouter returned %s for %s: %s", res.status_code, model, res.text[:200])
                if res.status_code in (404, 429):
                    turned_away = _refusal(res)
                    if res.status_code == 429 and "per-day" in res.text:
                        raise LLMUnavailable(turned_away + " (the free models' daily allowance is used up)")
                    rate_limited = rate_limited or res.status_code == 429
            if not rate_limited:
                break
            if attempt == 0:
                await asyncio.sleep(RETRY_PAUSE)
    if turned_away:
        raise LLMUnavailable(turned_away)
    return None
