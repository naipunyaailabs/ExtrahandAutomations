"""Configuration for the IVR hand-off voice agent: Maya's voice stack, run as its own LiveKit agent."""

import os

PERSONA_NAME = "Maya"
AGENT_NAME = os.environ.get("HANDOFF_AGENT_NAME", "extrahand-ivr-handoff").strip() or "extrahand-ivr-handoff"

# Same voice stack as the existing Maya agent.
SARVAM_STT_MODEL = "saaras:v3"
SARVAM_STT_MODE = "codemix"
SARVAM_STT_LANGUAGE = "unknown"  # auto-detect per utterance: Telugu, Hindi or English
SARVAM_STT_PROMPT = (
    "Phone call in Telugu, Hindi, or English about a home-service booking. "
    "Frequent words: ExtraHand, Maya, cleaning, plumbing, electrician, painting, driver, "
    "booking, helper, reminder, Hyderabad, Madhapur, Gachibowli, Hitec City."
)
SARVAM_TTS_MODEL = "bulbul:v3"
SARVAM_TTS_SPEAKER = "ritu"
SARVAM_TTS_LANGUAGE = "te-IN"  # default voice; switched per reply to match the reply's script
SARVAM_TTS_SPEED = 1.0
SARVAM_TTS_TEMPERATURE = 1.0
SARVAM_TTS_MIN_BUFFER_SIZE = 30
SARVAM_TTS_ENABLE_PREPROCESSING = True
OPENROUTER_MODEL = "google/gemini-2.5-flash"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

TALK_LIMIT_SECONDS = 120.0  # one short conversation: after this the agent says goodbye and ends the call
CALLER_INACTIVITY_SECONDS = 20.0

# How the LiveKit inbound trunk exposes what Vobiz sends on the bridged call (set up by setup_livekit.py).
ATTR_ATTEMPT = "handoff.attempt"
ATTR_TOKEN = "handoff.token"
SIP_CALLED_NUMBER_ATTR = "sip.trunkPhoneNumber"

STT_CORRECTIONS = {
    "naya": PERSONA_NAME,
    "maaya": PERSONA_NAME,
    "mayaa": PERSONA_NAME,
    "extra hand": "ExtraHand",
    "extrahand": "ExtraHand",
    "extra hands": "ExtraHand",
    "extra and": "ExtraHand",
    "extra han": "ExtraHand",
    "extrahaand": "ExtraHand",
    "ఎక్స్ట్రా హ్యాండ్": "ExtraHand",
    "ఎక్స్ట్రాహ్యాండ్": "ExtraHand",
    "ఎక్స్ట్రా హాండ్": "ExtraHand",
    "एक्स्ट्रा हैंड": "ExtraHand",
    "एक्स्ट्राहैंड": "ExtraHand",
    "మాయా": PERSONA_NAME,
    "माया": PERSONA_NAME,
}


def backend_base_url() -> str:
    """Base URL of the backend the agent reports to (must be reachable from LiveKit Cloud)."""
    return os.environ.get("BACKEND_BASE_URL", "").strip().rstrip("/")
