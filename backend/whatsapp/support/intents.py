"""What the customer wants, by keywords (English, Telugu / Hindi script and in English letters).

The AI decides the intent itself; this is used when it is unavailable and as a hint in its prompt."""

from __future__ import annotations

import re

INTENTS = (
    "greeting", "booking_status", "booking_details", "previous_bookings", "helper_info", "payment_status",
    "refund_status", "cancel_request", "reschedule_request", "complaint_helper", "complaint_payment",
    "complaint_incomplete", "refund_request", "human_agent", "profile", "other",
)

LABELS = {
    "greeting": "Greeting", "booking_status": "Booking status", "booking_details": "Booking details",
    "previous_bookings": "Previous bookings", "helper_info": "Helper details", "payment_status": "Payment status",
    "refund_status": "Refund status", "cancel_request": "Cancel a booking", "reschedule_request": "Reschedule",
    "complaint_helper": "Helper complaint", "complaint_payment": "Payment problem",
    "complaint_incomplete": "Service not completed", "refund_request": "Refund request",
    "human_agent": "Asked for a person", "profile": "Profile details", "other": "Other",
}

# checked in this order: the first match wins (complaints before plain questions)
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("human_agent", ("human", "person", "agent", "executive", "customer care", "call me", "talk to", "manishi",
                     "evaraina", "insaan", "aadmi", "baat karni", "మనిషి", "व्यक्ति", "बात")),
    ("refund_request", ("refund kavali", "refund ivvandi", "refund chahiye", "refund do", "want refund", "need refund",
                        "money back", "paise wapas", "dabbulu ivvandi", "रिफंड चाहिए", "డబ్బులు తిరిగి")),
    ("complaint_payment", ("charged twice", "double charge", "payment failed", "payment problem", "deducted",
                           "cut ho", "katt", "kat gaya", "payment issue", "కట్ అయ్యాయి", "पैसे कट")),
    ("complaint_incomplete", ("not completed", "incomplete", "half work", "poorti nahi", "adhura", "adhoora",
                              "complete cheyaledu", "pani poorthi", "పూర్తి చేయలేదు", "अधूरा")),
    ("complaint_helper", ("rude", "misbehav", "came late", "very late", "late ga", "late vachadu", "late aaya", "late aya", "not come", "didn't come", "did not come", "no show", "raaledu",
                          "raledu", "nahi aaya", "nahi aya", "bad helper", "complaint", "complain", "fight",
                          "రాలేదు", "नहीं आया", "शिकायत", "ఫిర్యాదు")),
    ("cancel_request", ("cancel", "రద్దు", "रद्द", "radd", "raddu", "कैंसिल", "క్యాన్సిల్")),
    ("reschedule_request", ("reschedule", "change date", "change time", "another day", "postpone", "date marchandi",
                            "time marchandi", "time badal", "date badal", "samay badal", "తేదీ మార్చ",
                            "समय बदल")),
    ("refund_status", ("refund", "రీఫండ్", "रिफंड", "wapas")),
    ("payment_status", ("payment", "paid", "pay", "amount", "bill", "dabbulu", "paisa", "paise", "పేమెంట్", "भुगतान",
                        "पेमेंट")),
    ("helper_info", ("helper", "who is coming", "evaru vastharu", "kaun aayega", "హెల్పర్", "हेल्पर", "partner")),
    ("previous_bookings", ("previous", "old booking", "past", "history", "all bookings", "patha", "purani", "पुरानी")),
    ("booking_status", ("status", "where", "when", "booking", "order", "eppudu", "kab", "ekkada", "బుకింగ్", "बुकिंग")),
    ("profile", ("my profile", "my details", "my account", "naa details", "mera account", "प्रोफाइल")),
    ("greeting", ("hi", "hello", "hey", "namaste", "namaskaram", "vanakkam", "నమస్కారం", "नमस्ते", "good morning")),
]


def classify(text: str) -> str:
    t = (text or "").lower()
    for intent, words in _RULES:
        for w in words:
            if (re.search(rf"\b{re.escape(w)}", t) if w.isascii() else w in t):
                return intent
    return "other"


def clean(intent: str | None) -> str:
    intent = (intent or "").strip().lower()
    return intent if intent in INTENTS else "other"
