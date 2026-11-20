"""Pure helpers copied from Maya's pipeline (no LiveKit imports, so they are unit-testable). The dialling-only
helpers of the ops agent are left out: this agent never dials."""

import asyncio
import logging
import re

import config

logger = logging.getLogger("handoff.textutils")

_QUESTION_TOKENS = ("కావాలా", "చెప్పండి", "ఏది", "क्या", "बताइए", "बता दीजिए", "चाहिए", "need", "want")

# The agent may only speak Telugu, Devanagari or Latin. Any word with another script is an LLM
# sampling slip that TTS would garble. Ranges: Arabic, Bengali..Tamil block, Kannada..Sinhala block.
_FOREIGN_SCRIPT_WORD_RE = re.compile(r"\S*[؀-ۿঀ-௿ಀ-෿]\S*")

_SENTENCE_END_RE = re.compile(r"(?<=[.!?…।॥])\s+")
_LEAK_START_RE = re.compile(r"(?i)\bcall\s+end_call\b|\bend_call\s*\(|\bgoodbye\s*=")
_LANG_DECIDE_MIN_CHARS = 60


def clean_reply_text(text: str) -> str:
    """Remove tool-call leakage, narrated hangups and foreign-script words from a reply."""
    stripped = _FOREIGN_SCRIPT_WORD_RE.sub("", text)
    if stripped != text:
        logger.warning("removed foreign-script word(s) from reply: %r", text)
        text = stripped
    text = re.sub(r"(?is)\bcall\s+end_call\s+with\s+goodbye\s*=.*", "", text)
    text = re.sub(r"(?is)\bend_call\s*\(.*", "", text)
    text = re.sub(r"(?is)\bgoodbye\s*=.*", "", text)
    text = re.sub(
        r"(?is)\b(?:now\s+)?i['’]?\s*(?:m|am|will|'ll)?\s*"
        r"(?:now\s+)?(?:going to\s+)?end(?:ing)?\s+(?:the\s+|this\s+)?call\b[.!]*", "", text)
    text = re.sub(r"(?is)\bending\s+(?:the\s+|this\s+)?call(?:\s+now)?\b[.!]*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,;:-–—")


def looks_like_question(text: str) -> bool:
    lowered = text.lower()
    return "?" in text or any(token in lowered for token in _QUESTION_TOKENS)


def estimated_playout_delay(text: str) -> float:
    return min(8.0, max(2.5, len(text) / 18.0))


def has_native_script(text: str) -> bool:
    return any(0x0C00 <= ord(ch) <= 0x0C7F or 0x0900 <= ord(ch) <= 0x097F for ch in text)


def pick_tts_language(text: str) -> str:
    """Telugu script -> te-IN, Devanagari -> hi-IN, Latin -> en-IN (native script wins over Latin)."""
    telugu = deva = latin = 0
    for ch in text:
        o = ord(ch)
        if 0x0C00 <= o <= 0x0C7F:
            telugu += 1
        elif 0x0900 <= o <= 0x097F:
            deva += 1
        elif ch.isascii() and ch.isalpha():
            latin += 1
    if telugu and telugu >= deva:
        return "te-IN"
    if deva:
        return "hi-IN"
    if latin:
        return "en-IN"
    return config.SARVAM_TTS_LANGUAGE


def apply_stt_corrections(text: str) -> str:
    corrected = text
    for wrong, right in config.STT_CORRECTIONS.items():
        corrected = re.sub(rf"(?<!\w){re.escape(wrong)}(?!\w)", right, corrected, flags=re.IGNORECASE)
    return corrected


async def stream_clean_sentences(text, on_language, spoken: list[str]):
    """Clean and sentence-chunk a streaming LLM reply for TTS so synthesis starts after the
    first sentence. `on_language` is called exactly once, as soon as the voice language is
    decidable; tool-call leakage is dropped and every spoken sentence is appended to `spoken`."""
    pending: list[str] = []
    decided = False

    def flush(finished: bool) -> list[str]:
        nonlocal decided
        if not decided:
            sample = " ".join(pending)
            if not sample:
                return []
            if not (finished or has_native_script(sample) or len(sample) >= _LANG_DECIDE_MIN_CHARS):
                return []
            on_language(sample)
            decided = True
        out = pending[:]
        pending.clear()
        spoken.extend(out)
        return out

    buf = ""
    async for chunk in text:
        buf += chunk
        sentences = _SENTENCE_END_RE.split(buf)
        buf = sentences.pop()
        leak = False
        for sentence in sentences:
            leak = bool(_LEAK_START_RE.search(sentence))
            cleaned = clean_reply_text(sentence)
            if cleaned:
                pending.append(cleaned)
            if leak:
                break
        for s in flush(finished=leak):
            yield s + " "
        if leak:
            return
    tail = clean_reply_text(buf)
    if tail:
        pending.append(tail)
    for s in flush(finished=True):
        yield s + " "


class CallerInactivityTimer:
    """Fire only after the agent finished speaking and the caller stayed silent for `timeout_s`."""

    def __init__(self, timeout_s: float, on_timeout) -> None:
        self.timeout_s = timeout_s
        self.on_timeout = on_timeout
        self.enabled = False
        self.closed = False
        self.agent_state = "initializing"
        self.user_speaking = False
        self._task: asyncio.Task | None = None
        self._generation = 0

    def enable(self) -> None:
        self.enabled = True
        self._arm_if_waiting()

    def close(self) -> None:
        self.closed = True
        self._cancel()

    def on_agent_state(self, new_state: str) -> None:
        self.agent_state = new_state
        if new_state in ("speaking", "thinking", "initializing"):
            self._cancel()
        else:
            self._arm_if_waiting()

    def on_user_state(self, new_state: str) -> None:
        self.user_speaking = new_state == "speaking"
        self._cancel()  # any detected speech resets the whole window
        if not self.user_speaking:
            self._arm_if_waiting()

    def _cancel(self) -> None:
        self._generation += 1
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    def _arm_if_waiting(self) -> None:
        if (self.closed or not self.enabled or self.user_speaking
                or self.agent_state not in ("idle", "listening")):
            return
        self._cancel()
        generation = self._generation

        async def wait() -> None:
            try:
                await asyncio.sleep(self.timeout_s)
                if generation == self._generation and not self.closed:
                    await self.on_timeout()
            except asyncio.CancelledError:
                return

        self._task = asyncio.create_task(wait(), name="caller-inactivity-timeout")
