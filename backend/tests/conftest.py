"""Test setup: a throw-away SQLite database and mock integrations, set before the app is imported."""

import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

_TMP = Path(tempfile.mkdtemp(prefix="backend_tests_"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["EXTRAHAND_MODE"] = "mock"
os.environ["MEDIA_STORAGE"] = "local"  # never the real Azure account
os.environ["MARKETING_POSTERS_DIR"] = (_TMP / "posters").as_posix()
os.environ["WHATSAPP_BANNERS_DIR"] = (_TMP / "whatsapp_banners").as_posix()
os.environ["TELEPHONY_PROVIDER"] = "simulator"
os.environ["CALLING_AGENT_ACTIVE"] = "true"
os.environ["EMERGENCY_STOP_CALLS"] = "false"
os.environ["CALLING_HOURS_START"] = "00:00"  # same start and end = calls allowed all day (tests run at any hour)
os.environ["CALLING_HOURS_END"] = "00:00"

import dotenv  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

dotenv.load_dotenv = lambda *args, **kwargs: False  # marketing/agent.py would copy backend/.env into the environment
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401  (registers the tables)
from app.config import Settings, get_settings  # noqa: E402

Settings.model_config["env_file"] = None  # a developer's backend/.env (live keys, hand-off address...) must not reach the tests
get_settings.cache_clear()

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services import tts_audio  # noqa: E402
from app.telephony import vobiz  # noqa: E402
from tests.vobiz_helpers import _uuid, spoken_wav  # noqa: E402


@pytest.fixture(autouse=True)
def _no_dns_preflight(request, monkeypatch):
    """Calls check that the public address resolves; the test hostnames never do, so that check is off here."""
    if request.node.get_closest_marker("real_dns"):
        return
    import app.config as config

    monkeypatch.setattr(config, "public_url_dns_problem", lambda url=None: None)
    monkeypatch.setattr(vobiz, "public_url_dns_problem", lambda url=None: None)


@pytest.fixture(autouse=True)
def _fresh_place_index():
    """The learned place index is cached process-wide; each test learns from its own data only."""
    from app.services import places

    places.reset_cache()
    yield
    places.reset_cache()


@pytest.fixture
def db():
    """A session on an empty schema; every test starts from scratch."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def settings(monkeypatch):
    """settings(**overrides) sets environment variables and rebuilds the cached Settings."""

    def apply(**overrides):
        for key, value in overrides.items():
            monkeypatch.setenv(key.upper(), str(value))
        get_settings.cache_clear()
        return get_settings()

    yield apply
    get_settings.cache_clear()


@pytest.fixture
def client(db):
    """Not used as a context manager, so the app's startup (and its background worker) never runs."""
    return TestClient(app)


@pytest.fixture
def env(monkeypatch, tmp_path, settings):
    """Vobiz configured, Sarvam and the Vobiz API replaced. `fail_on`: Sarvam refuses any text containing it."""
    settings(telephony_provider="vobiz", vobiz_auth_id="AID", vobiz_auth_token="TOK",
             vobiz_from_number="+918000000000", public_base_url="https://ivr.test", sarvam_api_key="key",
             audio_url_secret="s3cret", ivr_audio_dir=str(tmp_path), vobiz_validate_signature="false")
    state = SimpleNamespace(posts=[], deletes=[], listing=[], dir=tmp_path, fail_on=None, status=200)

    def fake_synth(text, source="ivr"):
        if state.fail_on and state.fail_on in text:
            raise httpx.ConnectError("sarvam down")
        return spoken_wav(text)

    def fake_post(url, **kw):
        state.posts.append(SimpleNamespace(url=url, **kw))
        state.listing.append(sorted(p.name for p in tmp_path.glob("*.wav")))
        body = {"api_id": "a", "message": "Call fired", "request_uuid": _uuid(len(state.posts))}
        return httpx.Response(state.status, json=body, request=httpx.Request("POST", url))

    def fake_delete(url, **kw):
        state.deletes.append(SimpleNamespace(url=url, **kw))
        return httpx.Response(204, request=httpx.Request("DELETE", url))

    monkeypatch.setattr(tts_audio, "_synthesize", fake_synth)
    monkeypatch.setattr(vobiz.httpx, "post", fake_post)
    monkeypatch.setattr(vobiz.httpx, "delete", fake_delete)
    return state


def pytest_configure(config):
    config.addinivalue_line("markers", "real_dns: run the live DNS pre-flight instead of skipping it")
