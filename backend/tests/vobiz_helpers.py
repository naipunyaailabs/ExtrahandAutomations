"""Shared by the Vobiz and hand-off tests: ids, callback URLs and small builders."""

import array
import hashlib
import hmac
import io
import wave
from urllib.parse import urlparse

from app.models import DispatchRun
from app.services import tts_audio
from tests.factories import make_attempt, make_ticket

BASE = "https://ivr.test/api/telephony/vobiz"
HOOK = "/api/telephony/vobiz"


def _run_with(db, ticket, *helpers):
    run = DispatchRun(ticket_id=ticket.id, current_index=-1, candidates=[
        {"helper_id": h, "name": n, "phone": p, "profile_id": f"p-{h}"} for h, n, p in helpers])
    db.add(run)
    db.flush()
    return run


def _ringing(db, purpose="dispatch", **kw):
    attempt = make_attempt(db, make_ticket(db), purpose, **{"status": "ringing", "provider": "vobiz", **kw})
    db.commit()
    return attempt


def _offer_in_progress(db):
    ticket = make_ticket(db, assignee_id=None, assignee_name=None, assignee_phone=None, dispatch_status="dispatching")
    run = _run_with(db, ticket, ("h1", "Suresh", "+919000000002"))
    run.current_index = 0
    attempt = make_attempt(db, ticket, "dispatch", run_id=run.id, status="in_progress", provider="vobiz",
                           helper_id="h1", helper_name="Suresh", phone="+919000000002")
    db.commit()
    return ticket, attempt


def spoken_wav(text):
    """What the fake Sarvam returns: a real WAV (a little silence either side) whose samples spell the text,
    so a test can read back what a call says even after clips have been joined."""
    sound = array.array("h", [1000 + b * 50 for b in text.encode()])
    samples = array.array("h", [0] * 100) + sound + array.array("h", [0] * 100)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def _spoken(root):
    """What the call says, phrase by phrase, across every <Play> (joined files are split at their pauses)."""
    texts = []
    for play in root.iter("Play"):
        name = urlparse(play.text).path.rsplit("/", 1)[1].removesuffix(".wav")
        _, samples = tts_audio._read(tts_audio.path_for(name))
        phrase = bytearray()
        for v in list(samples) + [0]:
            if v:
                phrase.append((v - 1000) // 50)
            elif phrase:
                texts.append(phrase.decode())
                phrase = bytearray()
    return texts


CALL_ID = "5a9fd4a0-3d4c-11ef-bef9-0242ac110005"
OTHER_ID = "11111111-2222-4333-8444-555555555555"


def _uuid(n):
    return f"00000000-0000-4000-8000-{n:012d}"


def _token(attempt_id):
    """What the callback URLs of a call must carry: a keyed hash of the attempt id (key: the Vobiz auth token)."""
    return hmac.new(b"TOK", f"callback|{attempt_id}".encode(), hashlib.sha256).hexdigest()[:32]


def _cb(attempt_id, name):
    """The callback URL Vobiz is given for this call."""
    return f"{BASE}/{name}?attempt_id={attempt_id}&t={_token(attempt_id)}"


def _hook(attempt, name):
    return f"{HOOK}/{name}?attempt_id={attempt.id}&t={_token(attempt.id)}"
