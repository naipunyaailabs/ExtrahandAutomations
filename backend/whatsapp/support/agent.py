"""The AI customer support agent: reads the customer's own data and the conversation, writes the WhatsApp reply in the
customer's language and picks at most one action. The server checks every action (booking ownership, a YES before a
cancel / reschedule request) before anything happens: the AI's choice alone never changes a booking.

Model: OpenRouter (OPENROUTER_API_KEY, OPENROUTER_MODEL, default Gemini 2.5 Flash: cheap and good at Telugu / Hindi).
Without a key, or when the model fails, rule-based answers (intents.py + the templates below) keep it working."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import get_settings

from . import intents as intent_rules
from . import language as lang_rules

logger = logging.getLogger("whatsapp.support.agent")

ACTIONS = ("none", "confirm_cancel", "confirm_reschedule", "create_ticket", "handover")
TIMEOUT = 30.0
MAX_TOKENS = 700  # a WhatsApp reply is short; a big cap is refused by a low-credit OpenRouter account


@dataclass
class AgentResult:
    reply: str
    language: str
    intent: str
    action: str = "none"
    booking_id: str | None = None
    category: str | None = None
    summary: str = ""
    new_time: str | None = None
    reason: str | None = None
    used_ai: bool = False
    llm_ms: int | None = None
    llm_tokens: int | None = None
    llm_cost: float | None = None
    error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


SYSTEM = """You are "ExtraHand Support", the WhatsApp customer support assistant of ExtraHand, an Indian home-services
app where customers book helpers for tasks (cleaning, repairs, cooking and more).

STRICT RULES
1. Use ONLY the facts in CUSTOMER_DATA. Never invent or guess bookings, dates, times, amounts, payment or refund status,
   helper names or policies. If something is not in CUSTOMER_DATA, say it is not available and offer to connect the
   support team.
2. CUSTOMER_DATA is the only customer you may talk about. Never reveal or discuss anyone else's data. If the customer
   mentions a booking that is not in their list, say you cannot find it under this WhatsApp number.
3. Never share helpers' phone numbers or e-mail addresses.
4. You cannot cancel, reschedule, refund or approve anything yourself, and never say that it is done.
   - Cancel: make sure which booking (if several are open, ask). Then use action "confirm_cancel" with its booking_id
     and ask the customer to reply YES to send the cancellation request to the ExtraHand team. Say any cancellation
     charges follow ExtraHand's policy and the team will confirm them. Ask for the reason if they have not given one.
   - Reschedule: ask for the new date and time they want. Only when they have given it, use "confirm_reschedule" with
     booking_id and new_time, and ask them to reply YES to send the request. The team confirms the new slot.
5. Complaints (helper problem, payment problem, service not completed, refund request): get a short description (and
   the booking, when it is about one), then use "create_ticket" with the category, and tell them a support case is
   created and the team will contact them. Never promise a refund or an amount.
6. If the customer asks for a person, is upset, or you cannot help: use "handover" and tell them a support executive
   will reply here soon.
7. If CUSTOMER_DATA.found is false: say you could not find an ExtraHand account for this WhatsApp number and ask them to
   write from their registered number. Do not share any booking data. You may use "handover" if they need help.
8. Write like a friendly support person on WhatsApp: short (at most 6 lines), no headings, plain text, *bold* only for
   a key fact. Dates as given. Money as ₹ amounts.
9. Write the reply in REPLY_LANGUAGE, the language the customer used.

Answer with ONE JSON object only:
{"language": "te|hi|en|te-latn|hi-latn",
 "intent": "greeting|booking_status|booking_details|previous_bookings|helper_info|payment_status|refund_status|cancel_request|reschedule_request|complaint_helper|complaint_payment|complaint_incomplete|refund_request|human_agent|profile|other",
 "reply": "the WhatsApp message to send",
 "action": "none|confirm_cancel|confirm_reschedule|create_ticket|handover",
 "booking_id": "booking_id from CUSTOMER_DATA or null",
 "category": "helper_issue|payment_issue|incomplete_service|refund_request|human_request|other or null",
 "summary": "one English line for the support team",
 "new_time": "the new date/time the customer asked for, or null",
 "reason": "the cancellation reason they gave, or null"}"""


def configured() -> bool:
    return bool(get_settings().openrouter_api_key.strip())


def _prompt(text: str, snap: dict, history: list[dict], pending: dict | None, lang_hint: str, intent_hint: str) -> str:
    data = {k: v for k, v in snap.items() if k not in ("customer_ids",)}
    convo = "\n".join(f"{'Customer' if m['sender'] == 'customer' else 'Support'}: {m['text']}" for m in history[-12:])
    return (
        f"CUSTOMER_DATA (as of {snap.get('as_of')}):\n{json.dumps(data, ensure_ascii=False, default=str)}\n\n"
        + (f"WAITING_FOR_CONFIRMATION: {json.dumps(pending, ensure_ascii=False)} (the customer has not said YES yet)\n\n"
           if pending else "")
        + f"CONVERSATION SO FAR:\n{convo or '(new conversation)'}\n\n"
        f"NEW MESSAGE FROM THE CUSTOMER:\n{text}\n\n"
        f"Detected language (a hint): {lang_hint}. Keyword intent (a hint): {intent_hint}.\n"
        f"REPLY_LANGUAGE: {lang_rules.REPLY_STYLE.get(lang_hint, 'the language the customer used')}"
    )


def _call(prompt: str) -> tuple[dict | None, dict]:
    """(parsed JSON, meta) from OpenRouter. meta has ms, tokens, cost and error."""
    from pricing.llm import parse_json

    s = get_settings()
    meta: dict[str, Any] = {"ms": None, "tokens": None, "cost": None, "error": None}
    payload: dict[str, Any] = {
        "model": s.openrouter_model, "temperature": 0.2, "max_tokens": MAX_TOKENS,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"}, "usage": {"include": True},
    }
    headers = {"Authorization": f"Bearer {s.openrouter_api_key}", "Content-Type": "application/json",
               "X-Title": "ExtraHand WhatsApp Support"}
    started = time.time()
    try:
        res = httpx.post(s.openrouter_api_url, json=payload, headers=headers, timeout=TIMEOUT)
        if res.status_code == 400 and "response_format" in res.text:
            payload.pop("response_format")
            res = httpx.post(s.openrouter_api_url, json=payload, headers=headers, timeout=TIMEOUT)
        meta["ms"] = int((time.time() - started) * 1000)
        if res.status_code != 200:
            meta["error"] = f"AI error {res.status_code}: {res.text[:200]}"
            return None, meta
        body = res.json()
        usage = body.get("usage") or {}
        meta["tokens"] = usage.get("total_tokens")
        meta["cost"] = usage.get("cost")
        content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        parsed = parse_json(content)
        if not isinstance(parsed, dict) or not str(parsed.get("reply") or "").strip():
            meta["error"] = "AI reply could not be read"
            return None, meta
        return parsed, meta
    except Exception as exc:  # noqa: BLE001 - network / timeout
        meta["ms"] = int((time.time() - started) * 1000)
        meta["error"] = f"AI unavailable: {str(exc)[:200]}"
        return None, meta


def respond(text: str, snap: dict, history: list[dict], pending: dict | None = None,
            known_language: str | None = None) -> AgentResult:
    detected = lang_rules.detect(text)
    # a one-word message ("ok", "1") says little: keep the conversation's language
    lang_hint = known_language if (known_language and detected == "en" and len(text.split()) <= 2) else detected
    intent_hint = intent_rules.classify(text)
    if configured():
        parsed, meta = _call(_prompt(text, snap, history, pending, lang_hint, intent_hint))
        if parsed:
            action = str(parsed.get("action") or "none").strip().lower()
            return AgentResult(
                reply=str(parsed["reply"]).strip()[:3500],
                language=lang_rules.clean(parsed.get("language"), lang_hint),
                intent=intent_rules.clean(parsed.get("intent") or intent_hint),
                action=action if action in ACTIONS else "none",
                booking_id=(str(parsed.get("booking_id")).strip() or None) if parsed.get("booking_id") not in (None, "null") else None,
                category=parsed.get("category") if parsed.get("category") not in (None, "null") else None,
                summary=str(parsed.get("summary") or "")[:400],
                new_time=parsed.get("new_time") if parsed.get("new_time") not in (None, "null") else None,
                reason=parsed.get("reason") if parsed.get("reason") not in (None, "null") else None,
                used_ai=True, llm_ms=meta["ms"], llm_tokens=meta["tokens"], llm_cost=meta["cost"],
            )
        result = fallback(text, snap, lang_hint, intent_hint)
        result.error, result.llm_ms = meta["error"], meta["ms"]
        return result
    return fallback(text, snap, lang_hint, intent_hint)


# ------------------------------------------------------------------------------------------ rule-based answers
def _base(lang: str) -> str:
    return {"te-latn": "te-latn", "hi-latn": "hi-latn", "te": "te", "hi": "hi"}.get(lang, "en")


T: dict[str, dict[str, str]] = {
    "en": {
        "hello": "Hello{name}! I'm ExtraHand Support. Ask me about your bookings, helper, payments or refunds.",
        "not_found": "Sorry, I could not find an ExtraHand account for this WhatsApp number. Please message us from "
                     "the number you registered with, or reply HELP to talk to our team.",
        "no_bookings": "I could not find any bookings for your account yet.",
        "latest": "Your latest booking: *{service}*\nStatus: {status}{when}{helper}{amount}",
        "handover": "I've passed this to our support team (case #{case}). A support executive will reply here soon.",
        "ticket": "Thanks for telling us. I've created support case #{case}; our team will contact you soon.",
        "cancel_sent": "Your cancellation request for *{service}* is sent to our team (case #{case}). They will confirm "
                       "the cancellation and any charges as per ExtraHand policy.",
        "reschedule_sent": "Your request to move *{service}* to {new_time} is sent to our team (case #{case}). They will "
                           "confirm the new slot.",
        "declined": "Okay, nothing has been changed. Anything else I can help with?",
        "confirm_hint": "Reply *YES* to confirm or *NO* to stop.",
        "which": "Which booking do you mean? Your open bookings:\n{list}",
        "not_possible": "This booking is {why}, so it cannot be {what}.",
        "helper_none": "\nHelper: not assigned yet", "helper": "\nHelper: {name}",
        "when": "\nScheduled: {date}{time}", "amount": "\nAmount: ₹{amount}",
    },
    "te": {
        "hello": "నమస్కారం{name}! నేను ExtraHand సపోర్ట్. మీ బుకింగ్స్, హెల్పర్, పేమెంట్ లేదా రీఫండ్ గురించి అడగండి.",
        "not_found": "క్షమించండి, ఈ WhatsApp నంబర్‌తో ExtraHand ఖాతా కనిపించలేదు. దయచేసి మీరు రిజిస్టర్ చేసిన నంబర్ "
                     "నుండి మెసేజ్ చేయండి, లేదా మా టీమ్‌తో మాట్లాడటానికి HELP అని పంపండి.",
        "no_bookings": "మీ ఖాతాలో ఇంకా బుకింగ్స్ ఏవీ కనిపించలేదు.",
        "latest": "మీ తాజా బుకింగ్: *{service}*\nస్థితి: {status}{when}{helper}{amount}",
        "handover": "మీ విషయం మా సపోర్ట్ టీమ్‌కు పంపాను (కేస్ #{case}). త్వరలో మా సపోర్ట్ ఎగ్జిక్యూటివ్ ఇక్కడ రిప్లై ఇస్తారు.",
        "ticket": "తెలియజేసినందుకు ధన్యవాదాలు. సపోర్ట్ కేస్ #{case} క్రియేట్ చేశాను; మా టీమ్ త్వరలో మిమ్మల్ని సంప్రదిస్తుంది.",
        "cancel_sent": "*{service}* రద్దు అభ్యర్థన మా టీమ్‌కు పంపబడింది (కేస్ #{case}). రద్దు మరియు ఏవైనా ఛార్జీలను "
                       "ExtraHand పాలసీ ప్రకారం టీమ్ నిర్ధారిస్తుంది.",
        "reschedule_sent": "*{service}* ను {new_time} కి మార్చే అభ్యర్థన మా టీమ్‌కు పంపబడింది (కేస్ #{case}). కొత్త "
                           "సమయాన్ని టీమ్ నిర్ధారిస్తుంది.",
        "declined": "సరే, ఏమీ మార్చలేదు. ఇంకేమైనా సహాయం కావాలా?",
        "confirm_hint": "నిర్ధారించడానికి *YES* లేదా ఆపడానికి *NO* అని పంపండి.",
        "which": "మీరు ఏ బుకింగ్ గురించి అడుగుతున్నారు? మీ ఓపెన్ బుకింగ్స్:\n{list}",
        "not_possible": "ఈ బుకింగ్ {why}, కాబట్టి {what} చేయలేము.",
        "helper_none": "\nహెల్పర్: ఇంకా కేటాయించలేదు", "helper": "\nహెల్పర్: {name}",
        "when": "\nతేదీ: {date}{time}", "amount": "\nమొత్తం: ₹{amount}",
    },
    "hi": {
        "hello": "नमस्ते{name}! मैं ExtraHand सपोर्ट हूँ। अपनी बुकिंग, हेल्पर, पेमेंट या रिफंड के बारे में पूछिए।",
        "not_found": "माफ़ कीजिए, इस WhatsApp नंबर से कोई ExtraHand अकाउंट नहीं मिला। कृपया अपने रजिस्टर्ड नंबर से "
                     "मैसेज करें, या हमारी टीम से बात करने के लिए HELP भेजें।",
        "no_bookings": "आपके अकाउंट में अभी कोई बुकिंग नहीं मिली।",
        "latest": "आपकी नई बुकिंग: *{service}*\nस्थिति: {status}{when}{helper}{amount}",
        "handover": "मैंने यह हमारी सपोर्ट टीम को भेज दिया है (केस #{case})। जल्द ही सपोर्ट एग्जीक्यूटिव यहाँ जवाब देंगे।",
        "ticket": "बताने के लिए धन्यवाद। मैंने सपोर्ट केस #{case} बना दिया है; हमारी टीम जल्द आपसे संपर्क करेगी।",
        "cancel_sent": "*{service}* की कैंसिलेशन रिक्वेस्ट हमारी टीम को भेज दी गई है (केस #{case})। टीम ExtraHand "
                       "पॉलिसी के अनुसार कैंसिलेशन और कोई चार्ज कन्फर्म करेगी।",
        "reschedule_sent": "*{service}* को {new_time} पर बदलने की रिक्वेस्ट टीम को भेज दी गई है (केस #{case})। टीम नया "
                           "समय कन्फर्म करेगी।",
        "declined": "ठीक है, कुछ नहीं बदला गया। और कोई मदद चाहिए?",
        "confirm_hint": "कन्फर्म करने के लिए *YES* या रोकने के लिए *NO* भेजें।",
        "which": "आप किस बुकिंग की बात कर रहे हैं? आपकी खुली बुकिंग:\n{list}",
        "not_possible": "यह बुकिंग {why} है, इसलिए {what} नहीं हो सकती।",
        "helper_none": "\nहेल्पर: अभी असाइन नहीं हुआ", "helper": "\nहेल्पर: {name}",
        "when": "\nतारीख: {date}{time}", "amount": "\nराशि: ₹{amount}",
    },
    "te-latn": {
        "hello": "Namaskaram{name}! Nenu ExtraHand Support. Mee bookings, helper, payment leda refund gurinchi adagandi.",
        "not_found": "Kshaminchandi, ee WhatsApp number tho ExtraHand account kanipinchaledu. Meeru register chesina "
                     "number nunchi message cheyandi, leda maa team tho matladataniki HELP ani pampandi.",
        "no_bookings": "Mee account lo inka bookings emi kanipinchaledu.",
        "latest": "Mee latest booking: *{service}*\nStatus: {status}{when}{helper}{amount}",
        "handover": "Mee vishayam maa support team ki pampanu (case #{case}). Tondaraga maa support executive ikkada "
                    "reply istaru.",
        "ticket": "Cheppinanduku thanks. Support case #{case} create chesanu; maa team tondaraga mimmalni contact chestundi.",
        "cancel_sent": "*{service}* cancel request maa team ki pampanu (case #{case}). Cancellation, charges unte, "
                       "ExtraHand policy prakaram team confirm chestundi.",
        "reschedule_sent": "*{service}* ni {new_time} ki marchadaniki request team ki pampanu (case #{case}). Kotha slot "
                           "team confirm chestundi.",
        "declined": "Sare, emi marchaledu. Inkemaina help kavala?",
        "confirm_hint": "Confirm cheyadaniki *YES*, aapadaniki *NO* ani pampandi.",
        "which": "Meeru e booking gurinchi adugutunnaru? Mee open bookings:\n{list}",
        "not_possible": "Ee booking {why}, kabatti {what} cheyalemu.",
        "helper_none": "\nHelper: inka assign avvaledu", "helper": "\nHelper: {name}",
        "when": "\nDate: {date}{time}", "amount": "\nAmount: ₹{amount}",
    },
    "hi-latn": {
        "hello": "Namaste{name}! Main ExtraHand Support hoon. Apni booking, helper, payment ya refund ke baare mein puchiye.",
        "not_found": "Maaf kijiye, is WhatsApp number se koi ExtraHand account nahi mila. Apne registered number se "
                     "message karein, ya hamari team se baat karne ke liye HELP bhejein.",
        "no_bookings": "Aapke account mein abhi koi booking nahi mili.",
        "latest": "Aapki latest booking: *{service}*\nStatus: {status}{when}{helper}{amount}",
        "handover": "Maine yeh hamari support team ko bhej diya hai (case #{case}). Jaldi hi support executive yahan "
                    "reply karenge.",
        "ticket": "Batane ke liye dhanyavaad. Support case #{case} bana diya hai; hamari team jaldi aapse contact karegi.",
        "cancel_sent": "*{service}* ki cancel request team ko bhej di gayi hai (case #{case}). Team ExtraHand policy ke "
                       "hisaab se cancellation aur charges confirm karegi.",
        "reschedule_sent": "*{service}* ko {new_time} par badalne ki request team ko bhej di hai (case #{case}). Team "
                           "naya slot confirm karegi.",
        "declined": "Theek hai, kuch nahi badla. Aur koi madad chahiye?",
        "confirm_hint": "Confirm karne ke liye *YES*, rokne ke liye *NO* bhejein.",
        "which": "Aap kis booking ki baat kar rahe hain? Aapki open bookings:\n{list}",
        "not_possible": "Yeh booking {why} hai, isliye {what} nahi ho sakti.",
        "helper_none": "\nHelper: abhi assign nahi hua", "helper": "\nHelper: {name}",
        "when": "\nDate: {date}{time}", "amount": "\nAmount: ₹{amount}",
    },
}


def text_for(lang: str, key: str, **kw: Any) -> str:
    return T[_base(lang)][key].format(**kw)


def latest_summary(lang: str, b: dict) -> str:
    when = text_for(lang, "when", date=b["scheduled_date"], time=f", {b['scheduled_time']}" if b.get("scheduled_time") else "") \
        if b.get("scheduled_date") else ""
    helper = text_for(lang, "helper", name=b["helper_name"]) if b.get("helper_name") else text_for(lang, "helper_none")
    amount = text_for(lang, "amount", amount=f"{b['amount_rupees']:,.0f}") if b.get("amount_rupees") else ""
    return text_for(lang, "latest", service=b.get("service") or b.get("category") or "Service",
                    status=(b.get("status") or "-").replace("_", " "), when=when, helper=helper, amount=amount)


def fallback(text: str, snap: dict, lang: str, intent: str) -> AgentResult:
    """Answers without the AI: facts for questions, a case for everything that needs a person."""
    name = (snap.get("customer") or {}).get("name")
    r = AgentResult(reply="", language=lang, intent=intent, summary=f"{intent_rules.LABELS[intent]}: {text[:200]}")
    if not snap.get("found"):
        if intent in ("human_agent",) or text.strip().lower() == "help":
            r.action, r.category = "handover", "human_request"
            r.reply = text_for(lang, "handover", case="{case}")
        else:
            r.reply = text_for(lang, "not_found")
        return r
    bookings = snap.get("bookings") or []
    if intent == "greeting":
        r.reply = text_for(lang, "hello", name=f" {name.split()[0]}" if name else "")
    elif intent in ("booking_status", "booking_details", "helper_info", "payment_status", "refund_status",
                    "previous_bookings", "profile"):
        r.reply = latest_summary(lang, bookings[0]) if bookings else text_for(lang, "no_bookings")
    else:
        category = {"complaint_helper": "helper_issue", "complaint_payment": "payment_issue",
                    "complaint_incomplete": "incomplete_service", "refund_request": "refund_request"}.get(intent, "human_request")
        # a cancel / reschedule without the AI goes to a person as a question, never as a confirmed request
        r.action, r.category = "handover", category
        r.booking_id = bookings[0]["booking_id"] if bookings and category != "human_request" else None
        r.reply = text_for(lang, "handover", case="{case}")
    return r
