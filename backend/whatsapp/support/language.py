"""Which language the customer wrote in: Telugu / Hindi script, Telugu / Hindi in English letters, or English.

The AI also reports the language; this is the quick, free check used for the stats, as a hint for the AI and when the
AI is unavailable."""

from __future__ import annotations

import re

LANGS = ("te", "hi", "en", "te-latn", "hi-latn")
LABELS = {
    "te": "Telugu", "hi": "Hindi", "en": "English",
    "te-latn": "Telugu (English letters)", "hi-latn": "Hindi (English letters)",
}
# How the agent must write its reply for each language
REPLY_STYLE = {
    "te": "Telugu, in Telugu script",
    "hi": "Hindi, in Devanagari script",
    "en": "simple English",
    "te-latn": "Telugu written in English letters (Tenglish), like the customer",
    "hi-latn": "Hindi written in English letters (Hinglish), like the customer",
}

_TELUGU = re.compile(r"[ఀ-౿]")
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")

_TE_WORDS = {
    "naa", "naaku", "naku", "nenu", "meeru", "miru", "enti", "endi", "ela", "elaa", "undi", "unnadi", "ledu", "ledhu",
    "kavali", "kaavali", "cheyandi", "cheyyandi", "chey", "emaindi", "eppudu", "ekkada", "chesanu", "chesaanu", "andi",
    "garu", "gaaru", "vachadu", "vacharu", "raaledu", "raledu", "cheppandi", "enduku", "inka", "avvaledu", "ayyindi",
    "em", "emi", "chala", "chaala", "bagundi", "dabbulu", "dabbu", "vaddu", "sare", "avunu", "kaadu", "kadu", "pani",
    "chesaru", "cheyaledu", "ivvandi", "ivvaledu", "vasthadu", "vastharu", "repu", "ninna", "ippudu", "telugu", "mee",
    "naadi", "booking", "cancel", "cheyali", "kaavalandi", "ani", "gurinchi", "evaru", "entha",
}
_HI_WORDS = {
    "mera", "meri", "mere", "mujhe", "muje", "kya", "hai", "hain", "nahi", "nahin", "kab", "kaise", "kyun", "kyon",
    "aap", "aapka", "aapki", "karo", "karna", "karni", "kar", "hua", "huaa", "raha", "rahi", "chahiye", "paisa", "paise",
    "wapas", "abhi", "tak", "bhai", "ji", "haan", "han", "hindi", "kahan", "kitna", "kitne", "kaun", "koi", "batao",
    "bataiye", "kijiye", "karein", "karen", "diya", "gaya", "aaya", "aya", "hoga", "mein", "main", "ka", "ki", "ke",
    "se", "ko", "par", "kal", "aaj", "theek", "thik", "accha", "acha",
}
# words both lists share or that say nothing about the language
_NEUTRAL = {"booking", "cancel", "ok", "okay", "hi", "hello", "helper", "refund", "payment", "status"}


def detect(text: str) -> str:
    """te | hi | en | te-latn | hi-latn"""
    t = text or ""
    te, hi = len(_TELUGU.findall(t)), len(_DEVANAGARI.findall(t))
    if te or hi:
        return "te" if te >= hi else "hi"
    words = [w for w in re.findall(r"[a-z]+", t.lower()) if w not in _NEUTRAL]
    te_hits = sum(1 for w in words if w in _TE_WORDS)
    hi_hits = sum(1 for w in words if w in _HI_WORDS)
    if te_hits > hi_hits and te_hits >= 1:
        return "te-latn"
    if hi_hits > te_hits and hi_hits >= 1:
        return "hi-latn"
    return "en"


def clean(lang: str | None, fallback: str = "en") -> str:
    lang = (lang or "").strip().lower().replace("_", "-")
    aliases = {"telugu": "te", "hindi": "hi", "english": "en", "tenglish": "te-latn", "hinglish": "hi-latn",
               "te-latin": "te-latn", "hi-latin": "hi-latn", "te-en": "te-latn", "hi-en": "hi-latn"}
    lang = aliases.get(lang, lang)
    return lang if lang in LANGS else fallback


# ---------------------------------------------------------------------------------------------- YES / NO
_YES = {
    "yes", "y", "yeah", "yep", "ok", "okay", "confirm", "confirmed", "sure", "done", "haan", "ha", "han", "haa", "ji",
    "avunu", "avnu", "sare", "sari", "cheyandi", "cheyyandi", "karo", "kar", "do",
    "అవును", "సరే", "ఓకే", "చేయండి", "हाँ", "हां", "हा", "ठीक", "जी", "करो", "कर", "दो",
}
_NO = {
    "no", "n", "nope", "dont", "don't", "stop", "nahi", "nahin", "na", "mat", "vaddu", "vadhu", "ledu", "kaadu", "kadu",
    "వద్దు", "లేదు", "కాదు", "नहीं", "नही", "मत", "ना",
}


def yes_or_no(text: str) -> str | None:
    """'yes' / 'no' when the message is a short answer, else None (a longer message goes to the AI)."""
    # split on spaces (Indic vowel signs are not "word" characters for \w, so a regex would cut हाँ in two)
    words = [w.strip(".,!?;:\"()") for w in (text or "").lower().split()]
    words = [w for w in words if w]
    if not words or len(words) > 4:
        return None
    if any(w in _NO for w in words):
        return "no"
    if any(w in _YES for w in words):
        return "yes"
    return None
