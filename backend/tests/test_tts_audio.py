import base64
import os
import time
from datetime import timedelta

import httpx
import pytest

from app.services import tts_audio
from app.services.ivr import Part

FIXED = Part("ధన్యవాదాలు")
PERSONAL = Part("నమస్కారం Suresh!", personal=True)


@pytest.fixture
def synth(monkeypatch, tmp_path, settings):
    """Audio goes to a temp folder and the Sarvam call is replaced; the list records the texts asked for."""
    settings(ivr_audio_dir=str(tmp_path), audio_url_secret="s3cret", public_base_url="https://ivr.test/",
             sarvam_api_key="key")
    asked = []

    def fake(text):
        asked.append(text)
        return b"RIFF-fake-" + text.encode()

    monkeypatch.setattr(tts_audio, "_synthesize", fake)
    return asked


def _files(folder):
    return sorted(p.name for p in folder.glob("*.wav"))


def test_fixed_part_synthesized_once_across_calls(synth, tmp_path):
    tts_audio.prepare(1, [FIXED])
    tts_audio.prepare(2, [FIXED, FIXED])
    assert synth == [FIXED.text]
    assert tts_audio.name_for(1, FIXED) == tts_audio.name_for(2, FIXED)
    assert len(_files(tmp_path)) == 1


def test_personal_part_is_per_call_and_purged(synth, tmp_path):
    tts_audio.prepare(1, [FIXED, PERSONAL])
    tts_audio.prepare(12, [PERSONAL])
    assert tts_audio.name_for(1, PERSONAL).startswith("p1-")
    assert tts_audio.name_for(1, PERSONAL) != tts_audio.name_for(12, PERSONAL)
    assert synth == [FIXED.text, PERSONAL.text]  # the same private line is made once, then copied for call 12
    assert tts_audio.purge(1) == 1  # not p12's file
    left = _files(tmp_path)
    assert len(left) == 3  # fixed, call 12's own copy, and the private text cache
    assert any(n.startswith("c-") for n in left) and any(n.startswith("p12-") for n in left)
    assert any(n.startswith("t-") for n in left)


def test_personal_audio_needs_a_secret_for_its_name(synth, settings):
    settings(audio_url_secret="")
    with pytest.raises(tts_audio.AudioError):
        tts_audio.name_for(1, PERSONAL)


def test_route_serves_audio_and_rejects_bad_names(synth, client):
    name = tts_audio.ensure(1, FIXED)
    assert tts_audio.url_for(name) == f"https://ivr.test/api/telephony/audio/{name}.wav"
    ok = client.get(f"/api/telephony/audio/{name}.wav")
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/wav"
    assert ok.content == b"RIFF-fake-" + FIXED.text.encode()
    for bad in ("../x", "..%2Fx", "not-a-name", "c-" + "0" * 40, "p1-" + "g" * 40, "c-" + name[2:] + "0"):
        assert client.get(f"/api/telephony/audio/{bad}.wav").status_code == 404, bad


def test_sweep_removes_only_old_personal_files(synth, tmp_path):
    tts_audio.prepare(1, [FIXED, PERSONAL])
    tts_audio.prepare(2, [PERSONAL])
    old = time.time() - 3 * 3600
    for path in tmp_path.glob("*.wav"):
        if path.name.startswith(("c-", f"p{1}-")):
            os.utime(path, (old, old))
    assert tts_audio.sweep(timedelta(hours=2)) == 1  # the text cache is 3 h old: kept for a day
    left = _files(tmp_path)
    assert len(left) == 3 and any(n.startswith("c-") for n in left) and any(n.startswith("p2-") for n in left)

    day_old = time.time() - 25 * 3600
    for path in tmp_path.glob("t-*.wav"):
        os.utime(path, (day_old, day_old))
    assert tts_audio.sweep(timedelta(hours=2)) == 1
    assert not any(n.startswith("t-") for n in _files(tmp_path))


def test_same_task_line_is_made_once_for_many_helpers(synth, tmp_path, client):
    task = Part("Plumbing పని, Madhapur లో, ధర 500 రూపాయలు, రేపు ఉదయం 10 గంటలకు.", personal=True)
    for attempt in range(1, 11):  # ten helpers offered the same task
        tts_audio.prepare(attempt, [Part(f"నమస్కారం Helper{attempt}!", personal=True), task, FIXED])
    assert synth.count(task.text) == 1 and synth.count(FIXED.text) == 1
    assert tts_audio.name_for(1, task) != tts_audio.name_for(2, task)  # each call still has its own file
    cache = next(tmp_path.glob("t-*.wav")).stem
    assert client.get(f"/api/telephony/audio/{cache}.wav").status_code == 404  # the cache is never served


def test_synthesize_error_raises_audio_error(monkeypatch, synth, tmp_path):
    def boom(text):
        raise httpx.ConnectError("no network")

    monkeypatch.setattr(tts_audio, "_synthesize", boom)
    with pytest.raises(tts_audio.AudioError):
        tts_audio.prepare(1, [FIXED])
    assert _files(tmp_path) == []


def test_synthesize_posts_the_documented_request(monkeypatch, settings):
    settings(sarvam_api_key="key")
    seen = {}

    def fake_post(url, **kw):
        seen.update(url=url, **kw)
        body = {"request_id": "r", "audios": [base64.b64encode(b"WAVDATA").decode()]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(tts_audio.httpx, "post", fake_post)
    assert tts_audio._synthesize("నమస్కారం") == b"WAVDATA"
    assert seen["url"] == "https://api.sarvam.ai/text-to-speech"
    assert seen["headers"] == {"api-subscription-key": "key"}
    assert seen["timeout"] == 10  # a slow Sarvam must not hold the call (and the worker) for long
    assert seen["json"] == {"text": "నమస్కారం", "target_language_code": "te-IN", "speaker": "ritu",
                            "model": "bulbul:v3", "speech_sample_rate": 8000}


def test_synthesize_without_an_api_key_is_an_audio_error(settings):
    settings(sarvam_api_key="")
    with pytest.raises(tts_audio.AudioError):
        tts_audio._synthesize("x")


# ---- one message, one file ---------------------------------------------------------------------------
# Vobiz fetches each <Play> separately and each Sarvam clip carries silence at both ends, which is what made
# the caller wait between phrases. A message of several phrases is joined into a single file instead.

RATE = 8000


def wav_bytes(lead_ms=300, speech_ms=1000, trail_ms=400, rate=RATE):
    import array
    import io
    import wave

    def n(ms):
        return rate * ms // 1000

    samples = array.array("h", [0] * n(lead_ms) + [10000] * n(speech_ms) + [0] * n(trail_ms))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def samples_of(path):
    import array
    import wave

    with wave.open(str(path), "rb") as w:
        data = array.array("h")
        data.frombytes(w.readframes(w.getnframes()))
        return data, w.getframerate()


@pytest.fixture
def clips(monkeypatch, tmp_path, settings):
    """Every phrase is 1 s of speech with 300 ms of silence before and 400 ms after, unless the test says otherwise."""
    settings(ivr_audio_dir=str(tmp_path), audio_url_secret="s3cret", public_base_url="https://ivr.test", sarvam_api_key="key")
    state = type("Clips", (), {"asked": [], "make": staticmethod(lambda text: wav_bytes())})()

    def fake(text):
        state.asked.append(text)
        return state.make(text)

    monkeypatch.setattr(tts_audio, "_synthesize", fake)
    return state


A, B, C = Part("మొదటి మాట"), Part("రెండో మాట"), Part("మూడో మాట")


def test_phrases_are_joined_into_one_file_with_the_silence_around_them_cut(clips, tmp_path):
    name = tts_audio.merge(1, [A, B])
    data, rate = samples_of(tmp_path / f"{name}.wav")
    pad, pause = tts_audio._PAD_MS, tts_audio._PAUSE_MS
    assert len(data) * 1000 // rate == 2 * (1000 + 2 * pad) + pause  # far shorter than the 2 x 1700 ms it came from
    assert next(i for i, v in enumerate(data) if v) * 1000 // rate == pad  # starts almost at once
    assert sum(1 for v in data if v) == 2 * 1000 * rate // 1000  # all the speech is kept


def test_a_single_phrase_needs_no_joining(clips, tmp_path):
    assert tts_audio.merge(1, [A]) == tts_audio.name_for(1, A)
    assert _files(tmp_path) == [tts_audio.name_for(1, A) + ".wav"]


def test_joined_fixed_phrases_are_shared_by_every_call(clips, tmp_path):
    first = tts_audio.merge(1, [A, B])
    second = tts_audio.merge(2, [A, B])
    assert first == second and first.startswith("c-")
    assert clips.asked == [A.text, B.text]  # each phrase asked of Sarvam once
    assert len(_files(tmp_path)) == 3  # the two clips and the one joined file
    assert tts_audio.merge(1, [B, A]) != first  # order matters


def test_joined_audio_with_a_personal_phrase_belongs_to_the_call_and_is_purged_with_it(clips, tmp_path):
    name = tts_audio.merge(1, [A, PERSONAL, B])
    assert name.startswith("p1-") and name != tts_audio.merge(12, [A, PERSONAL, B])
    assert tts_audio.purge(1) == 2  # the personal clip and the joined file
    left = _files(tmp_path)
    assert not any(n.startswith("p1-") for n in left) and any(n.startswith("p12-") for n in left)
    assert any(n == tts_audio.name_for(1, A) + ".wav" for n in left)  # the shared clip stays


def test_clips_that_do_not_match_cannot_be_joined(clips):
    clips.make = lambda text: wav_bytes(rate=16000) if text == B.text else wav_bytes()
    with pytest.raises(tts_audio.AudioError):
        tts_audio.merge(1, [A, B])


def test_audio_that_is_not_a_wav_cannot_be_joined(clips):
    clips.make = lambda text: b"not audio at all"
    with pytest.raises(tts_audio.AudioError):
        tts_audio.merge(1, [A, B])


def test_a_silent_phrase_does_not_break_the_join(clips, tmp_path):
    clips.make = lambda text: wav_bytes(lead_ms=500, speech_ms=0, trail_ms=0) if text == B.text else wav_bytes()
    name = tts_audio.merge(1, [A, B, C])
    data, rate = samples_of(tmp_path / f"{name}.wav")
    assert len(data) > 0 and sum(1 for v in data if v) == 2 * 1000 * rate // 1000


def test_sweep_cleans_bulk_and_task_seeding_audio_after_a_day(settings, tmp_path):
    import os
    import time
    from datetime import timedelta

    from app.services import tts_audio

    settings(ivr_audio_dir=str(tmp_path))
    old = time.time() - 26 * 3600
    for name in ("bulk_3_abc.wav", "seed_abc.wav", "bulk_4_new.wav", "seed_new.wav", "welcome.wav"):
        (tmp_path / name).write_bytes(b"RIFF")
    for name in ("bulk_3_abc.wav", "seed_abc.wav", "welcome.wav"):
        os.utime(tmp_path / name, (old, old))
    assert tts_audio.sweep(timedelta(hours=2)) == 2
    assert sorted(p.name for p in tmp_path.iterdir()) == ["bulk_4_new.wav", "seed_new.wav", "welcome.wav"]
