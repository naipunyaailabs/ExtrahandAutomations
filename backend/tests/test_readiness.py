import json

import pytest

from app import auth
from app.services import readiness

HASH = auth.hash_password("x" * 12)  # deliberately slow: made once for the whole file

PRODUCTION = dict(
    app_env="production", dashboard_users=json.dumps([{"email": "ops@extrahand.in", "password_hash": HASH}]),
    session_secret="s" * 40, extrahand_mode="live", extrahand_email="ops@extrahand.in",
    extrahand_password="pw-private-1", telephony_provider="vobiz", vobiz_auth_id="MA_AAAA",
    vobiz_auth_token="tok-9f3a1c-private", vobiz_from_number="+919000000000", vobiz_validate_signature="true",
    public_base_url="https://ivr.extrahand.in", sarvam_api_key="k" * 20, audio_url_secret="a" * 32,
    handoff_sip_uri="sip:abc123def456.sip.livekit.cloud", handoff_secret="h" * 32, cors_origins="",
    database_url="mssql+pyodbc://app:pw@db.internal/extrahand?driver=ODBC+Driver+18+for+SQL+Server",
)


@pytest.fixture
def production(settings):
    def apply(**overrides):
        return settings(**{**PRODUCTION, **overrides})
    return apply


def by_id(s):
    return {c.id: c for c in readiness.static_checks(s)}


def test_a_complete_production_setup_has_nothing_blocking(production):
    s = production()
    assert readiness.blocking_problems(s) == []
    assert {c.status for c in readiness.static_checks(s)} <= {"ok", "info"}
    readiness.assert_ready(s)  # does not raise


@pytest.mark.parametrize("override, check", [
    (dict(dashboard_users=""), "login"),
    (dict(dashboard_users="{not json"), "login"),
    (dict(session_secret=""), "session_secret"),
    (dict(session_secret="short"), "session_secret"),
    (dict(extrahand_mode="mock"), "extrahand"),
    (dict(vobiz_auth_id=""), "vobiz_credentials"),
    (dict(vobiz_auth_token=""), "vobiz_credentials"),
    (dict(vobiz_from_number=""), "caller_number"),
    (dict(vobiz_validate_signature="false"), "signatures"),
    (dict(public_base_url=""), "public_url"),
    (dict(public_base_url="http://ivr.extrahand.in"), "public_url"),
    (dict(public_base_url="https://localhost:8000"), "public_url"),
    (dict(public_base_url="https://192.168.1.20"), "public_url"),
    (dict(public_base_url="https://d9f971cec976c3.lhr.life"), "public_url"),
    (dict(public_base_url="https://abc.trycloudflare.com"), "public_url"),
    (dict(sarvam_api_key=""), "sarvam"),
    (dict(audio_url_secret=""), "audio_secret"),
    (dict(audio_url_secret="guessable"), "audio_secret"),
])
def test_each_unsafe_setting_blocks_a_production_start(production, override, check):
    s = production(**override)
    assert by_id(s)[check].status == "fail"
    problems = readiness.blocking_problems(s)
    assert problems and any(by_id(s)[check].label in p for p in problems)
    with pytest.raises(RuntimeError) as exc:
        readiness.assert_ready(s)
    assert by_id(s)[check].label in str(exc.value)


def test_development_is_never_blocked_but_the_same_problems_are_shown_as_warnings(settings):
    s = settings(app_env="development", telephony_provider="vobiz", public_base_url="", dashboard_users="")
    assert readiness.blocking_problems(s) == []
    readiness.assert_ready(s)
    checks = by_id(s)
    assert checks["public_url"].status == "warn" and checks["login"].status == "warn"


def test_the_simulator_needs_no_phone_provider_settings(production):
    s = production(telephony_provider="simulator", vobiz_auth_id="", vobiz_auth_token="", vobiz_from_number="",
                   public_base_url="", sarvam_api_key="", audio_url_secret="")
    assert readiness.blocking_problems(s) == []
    assert by_id(s)["telephony"].status == "warn"  # nothing real will be dialled


def test_the_handoff_is_optional_but_half_set_up_is_called_out(production):
    off = by_id(production(handoff_sip_uri="", handoff_secret=""))["handoff"]
    assert off.status == "info" and "keypad" in off.detail.lower()
    half = by_id(production(handoff_sip_uri="sip:abc123def456.sip.livekit.cloud", handoff_secret=""))["handoff"]
    assert half.status == "warn"
    assert by_id(production())["handoff"].status == "ok"


@pytest.mark.parametrize("uri", ["sip:extrahand-x225lfad.livekit.cloud", "sip:ivr@pbx.example.com", "wss://x.livekit.cloud"])
def test_a_sip_address_that_is_not_a_livekit_project_sip_address_is_flagged(production, uri):
    check = by_id(production(handoff_sip_uri=uri))["handoff"]
    assert check.status == "warn" and "Project settings" in check.fix


def test_the_database_note_depends_on_what_is_in_use(production):
    assert by_id(production(database_url="mssql+pyodbc://u:p@db/x?driver=ODBC+Driver+18+for+SQL+Server"))["database"].status == "ok"
    assert by_id(production(database_url="sqlite:///x.db"))["database"].status == "warn"


def test_secrets_never_appear_in_any_check(production):
    s = production()
    text = json.dumps([c.as_dict() for c in readiness.static_checks(s)])
    for secret in ("tok-9f3a1c-private", "pw-private-1", "k" * 20, "a" * 32, "h" * 32, "s" * 40, HASH):
        assert secret not in text


def test_a_misconfigured_production_server_does_not_start(settings):
    from fastapi.testclient import TestClient

    from app.main import app

    settings(app_env="production")  # nothing else set
    with pytest.raises(RuntimeError, match="Refusing to start"):
        with TestClient(app):
            pass


# ---- creating dashboard users ---------------------------------------------------------------------------

def test_the_user_tool_adds_or_replaces_entries_and_prints_a_ready_setting(settings):
    from app.tools import add_user

    first = add_user.merge("", "Ops@ExtraHand.in", "Ops Desk", "Dispatcher", "first password 123")
    assert [u["email"] for u in first] == ["ops@extrahand.in"]
    second = add_user.merge(json.dumps(first), "lead@extrahand.in", None, None, "second password 456")
    assert [u["email"] for u in second] == ["ops@extrahand.in", "lead@extrahand.in"]
    replaced = add_user.merge(json.dumps(second), "OPS@extrahand.in", "Ops Desk", "Dispatcher", "new password 789")
    assert [u["email"] for u in replaced] == ["lead@extrahand.in", "ops@extrahand.in"]
    users = auth.parse_users(json.dumps(replaced))  # what the backend will read back
    assert auth.verify_password("new password 789", users["ops@extrahand.in"].password_hash)
    assert users["lead@extrahand.in"].name == "lead" and users["lead@extrahand.in"].role == "Operations Dispatcher"
    line = add_user.setting_line(replaced)
    assert line.startswith("DASHBOARD_USERS='[") and line.endswith("]'")


def test_the_user_tool_refuses_weak_passwords():
    from app.tools import add_user

    with pytest.raises(ValueError):
        add_user.merge("", "ops@extrahand.in", None, None, "short")


@pytest.mark.parametrize("field, check", [
    ("vobiz_auth_id", "vobiz_credentials"), ("vobiz_from_number", "caller_number"), ("sarvam_api_key", "sarvam"),
    ("extrahand_email", "extrahand"),
])
def test_the_placeholder_from_the_deploy_example_counts_as_missing(production, field, check):
    assert by_id(production(**{field: "CHANGE_ME"}))[check].status == "fail"
