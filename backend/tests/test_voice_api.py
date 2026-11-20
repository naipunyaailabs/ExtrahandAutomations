import io
import json
import wave

import httpx
import pytest

from app import auth
from app.services import tts_audio, voice_checks
from tests.factories import make_ticket


def ids(body):
    return {c["id"]: c for c in body["checks"]}


# ---- status ---------------------------------------------------------------------------------------------

def test_status_summarises_the_setup_and_the_timings(client, env, tmp_path):
    (tmp_path / ("c-" + "0" * 40 + ".wav")).write_bytes(b"x" * 2048)
    body = client.get("/api/voice/status").json()
    assert body["provider"] == "vobiz" and body["environment"] == "development"
    assert body["summary"].keys() == {"ok", "warn", "fail", "info"} and sum(body["summary"].values()) == len(body["checks"])
    assert body["timing"] == {"max_prompts": 3, "key_wait_seconds": 7, "ring_seconds": 30, "handoff_limit_seconds": 150,
                              "handoff_ring_seconds": 20, "retry_after_minutes": 10}
    assert body["audio"]["files"] == 1
    assert body["urls"]["inbound"] == "https://ivr.test/api/telephony/vobiz/inbound"
    assert body["urls"]["answer"] == "https://ivr.test/api/telephony/vobiz/answer"


def test_status_says_ready_only_when_nothing_fails(client, env, settings):
    assert client.get("/api/voice/status").json()["ready"] is True
    settings(sarvam_api_key="", app_env="production")
    body = client.get("/api/voice/status").json()
    assert body["ready"] is False and ids(body)["sarvam"]["status"] == "fail"


def test_status_never_contains_a_secret(client, env, settings):
    secrets = {"vobiz_auth_token": "vobiz-token-7788", "sarvam_api_key": "sarvam-secret-3344",
               "audio_url_secret": "audio-secret-5566-long-enough", "session_secret": "session-secret-9900-long-enough-ok",
               "handoff_secret": "handoff-secret-1122"}
    settings(**secrets)
    response = client.get("/api/voice/status").text + client.get("/api/voice/scripts?purpose=dispatch").text
    for value in secrets.values():
        assert value not in response


def test_voice_pages_need_a_session_when_login_is_on(client, env, settings):
    users = [{"email": "ops@extrahand.in", "password_hash": auth.hash_password("a long enough password")}]
    settings(dashboard_users=json.dumps(users), session_secret="s" * 40)
    for path in ("/api/voice/status", "/api/voice/scripts?purpose=dispatch", "/api/voice/preview?purpose=dispatch&step=prompt"):
        assert client.get(path).status_code == 401, path
    assert client.post("/api/voice/checks").status_code == 401


# ---- scripts --------------------------------------------------------------------------------------------

def test_the_job_offer_script_lists_every_step_a_helper_can_hear(client, env):
    body = client.get("/api/voice/scripts?purpose=dispatch").json()
    steps = {s["key"]: s for s in body["steps"]}
    assert body["sample"] is True
    assert list(steps) == ["prompt", "repeat", "invalid", "star", "after:accepted", "after:rejected", "after:no_input"]
    assert steps["after:rejected"]["when"] == "Key 0 or 2" and steps["star"]["when"] == "Key *"
    prompt = " ".join(p["text"] for p in steps["prompt"]["parts"])
    assert "నమస్కారం" in prompt and "1 నొక్కండి" in prompt
    assert any(p["personal"] for p in steps["prompt"]["parts"])  # the name and the job are made per call
    accepted = steps["after:accepted"]["parts"]
    assert accepted[1]["personal"] and "Kondapur" in accepted[1]["text"]  # the address comes only after key 1
    assert not any("9000000" in p["text"] for s in steps.values() for p in s["parts"])  # no phone number is ever read
    assert [(k["digit"], k["outcome"]) for k in body["keys"]] == [
        ("1", "accepted"), ("0", "rejected"), ("2", "rejected"), ("*", "repeat")]


def test_the_reminder_script_has_the_hand_off_step_on_key_2(client, env):
    body = client.get("/api/voice/scripts?purpose=followup").json()
    steps = {s["key"]: s for s in body["steps"]}
    assert "handoff" in steps and steps["handoff"]["handoff"] is True and steps["handoff"]["parts"] == []
    assert "Maya" in steps["handoff"]["note"]
    assert [k["digit"] for k in body["keys"] if k["handoff"]] == ["2"]


def test_the_rating_script_covers_every_star_and_the_call_back_key(client, env):
    body = client.get("/api/voice/scripts?purpose=feedback").json()
    keys = {s["key"] for s in body["steps"]}
    assert {"after:rating_1", "after:rating_5", "after:callback_requested", "handoff"} <= keys
    assert [k["digit"] for k in body["keys"] if k["handoff"]] == ["1", "2"]


def test_a_real_ticket_can_be_previewed(client, env, db):
    make_ticket(db, id="t77", category="Plumbing", address="Plot 9, Madhapur, Hyderabad")
    db.commit()
    body = client.get("/api/voice/scripts?purpose=dispatch&ticket_id=t77").json()
    assert body["sample"] is False and body["ticket"]["id"] == "t77"
    prompt = " ".join(p["text"] for p in body["steps"][0]["parts"])
    assert "Plumbing" in prompt and "Madhapur" in prompt


def test_unknown_purpose_and_unknown_ticket_are_refused(client, env):
    assert client.get("/api/voice/scripts?purpose=sales").status_code == 422
    assert client.get("/api/voice/scripts?purpose=dispatch&ticket_id=nope").status_code == 404


# ---- audio preview --------------------------------------------------------------------------------------

def test_a_step_can_be_played_as_one_wav_file(client, env):
    r = client.get("/api/voice/preview?purpose=dispatch&step=prompt")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(r.content)) as w:
        assert w.getnframes() > 0 and w.getframerate() == 8000
    assert r.headers["cache-control"] == "no-store"


def test_previewing_an_unknown_step_is_a_404(client, env):
    assert client.get("/api/voice/preview?purpose=dispatch&step=nope").status_code == 404


def test_previewing_without_a_voice_key_explains_why(client, env, settings):
    settings(sarvam_api_key="")
    r = client.get("/api/voice/preview?purpose=dispatch&step=prompt")
    assert r.status_code == 503 and "SARVAM_API_KEY" in r.json()["detail"]


def test_previewing_when_sarvam_is_down_is_a_503_not_a_crash(client, env):
    env.fail_on = "నమస్కారం"
    r = client.get("/api/voice/preview?purpose=dispatch&step=prompt")
    assert r.status_code == 503 and "Sarvam" in r.json()["detail"]


# ---- live checks ----------------------------------------------------------------------------------------

class FakeNet:
    """Stands in for the network: Vobiz's API, this server's own public address, and the audio download."""

    def __init__(self, monkeypatch):
        self.vobiz_status, self.health, self.measure = 200, httpx.Response(200, json={"ok": True}), (0.2, 0.4, 100_000)
        self.requests = []
        monkeypatch.setattr(voice_checks.httpx, "get", self.get)
        monkeypatch.setattr(voice_checks, "measure_download", lambda url: self.measure)

    def get(self, url, **kw):
        self.requests.append((url, kw))
        request = httpx.Request("GET", url)
        if "/Account/" in url:
            return httpx.Response(self.vobiz_status, json={"objects": []}, request=request)
        if isinstance(self.health, Exception):
            raise self.health
        return httpx.Response(self.health.status_code, json=self.health.json(), request=request)


@pytest.fixture
def net(monkeypatch):
    return FakeNet(monkeypatch)


def run_checks(client):
    r = client.post("/api/voice/checks")
    assert r.status_code == 200
    return ids(r.json())


def test_live_checks_pass_on_a_healthy_setup(client, env, net):
    got = run_checks(client)
    assert {k: v["status"] for k, v in got.items()} == {"sarvam": "ok", "vobiz_live": "ok", "public_reachable": "ok", "audio_speed": "ok"}
    assert all(v["ms"] is not None for v in got.values())
    vobiz_call = [r for r in net.requests if "/Account/" in r[0]][0]
    assert vobiz_call[1]["headers"] == {"X-Auth-ID": "AID", "X-Auth-Token": "TOK"}


def test_vobiz_refusing_the_credentials_is_a_failure(client, env, net):
    net.vobiz_status = 401
    got = run_checks(client)
    assert got["vobiz_live"]["status"] == "fail" and "rejected" in got["vobiz_live"]["detail"].lower()


def test_sarvam_being_down_is_a_failure_without_leaking_the_key(client, env, net, settings):
    settings(sarvam_api_key="sarvam-secret-3344")
    env.fail_on = "తెలుగు"
    got = run_checks(client)
    assert got["sarvam"]["status"] == "fail" and "Sarvam" in got["sarvam"]["detail"]
    assert "sarvam-secret" not in json.dumps(got)


def test_a_server_that_cannot_reach_its_own_public_address_is_warned(client, env, net):
    net.health = httpx.ConnectError("no route")
    got = run_checks(client)
    assert got["public_reachable"]["status"] == "warn" and "audio_speed" in got
    assert got["audio_speed"]["status"] in ("info", "warn")


def test_the_public_address_must_answer_as_this_backend(client, env, net):
    net.health = httpx.Response(200, json={"hello": "world"})
    assert run_checks(client)["public_reachable"]["status"] == "fail"


@pytest.mark.parametrize("measure, status", [
    ((0.1, 0.3, 160_000), "ok"),        # a 10 second message would start in well under 2 seconds
    ((1.5, 14.0, 95_000), "fail"),      # the free tunnel: seconds of silence before the first word
    ((0.5, 3.0, 160_000), "warn"),
])
def test_audio_speed_is_judged_by_when_the_first_word_would_start(client, env, net, measure, status):
    net.measure = measure
    assert run_checks(client)["audio_speed"]["status"] == status


def test_estimate_scales_a_small_sample_up_to_a_typical_message():
    # 60 KB took 6.1 s at 1.5 s to first byte: 4.6 s for 60 KB = 13 KB/s, so a 160 KB message takes 1.5 + 12.3 s
    assert voice_checks.estimate_start_seconds(1.5, 6.1, 60_000) == pytest.approx(1.5 + 160_000 / (60_000 / 4.6), rel=0.01)


def test_with_the_simulator_nothing_is_dialled_or_synthesised(client, settings, monkeypatch):
    settings(telephony_provider="simulator")
    net = FakeNet(monkeypatch)
    got = run_checks(client)
    assert {v["status"] for v in got.values()} == {"info"} and net.requests == []
