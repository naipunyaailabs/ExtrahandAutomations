import json
import time

import pytest

from app import auth

USER = {"email": "ops@extrahand.in", "name": "Ops Desk", "role": "Dispatcher"}
PASSWORD = "correct horse battery staple"
PASSWORD_HASH = auth.hash_password(PASSWORD)  # deliberately slow: made once for the whole file


@pytest.fixture(autouse=True)
def fresh_throttle():
    auth.THROTTLE.reset()
    yield
    auth.THROTTLE.reset()


@pytest.fixture
def secured(settings):
    """One dashboard user exists, so the API is closed to anyone without a session."""
    users = [{**USER, "password_hash": PASSWORD_HASH}]
    return settings(dashboard_users=json.dumps(users), session_secret="s" * 40, session_cookie_secure="false")


def login(client, password=PASSWORD, email=USER["email"], remember=True):
    return client.post("/api/auth/login", json={"email": email, "password": password, "remember": remember})


# ---- passwords ----------------------------------------------------------------------------------------

def test_a_password_hash_verifies_only_the_right_password():
    stored = auth.hash_password(PASSWORD)
    assert stored.startswith("scrypt$") and PASSWORD not in stored
    assert auth.verify_password(PASSWORD, stored)
    assert not auth.verify_password("wrong", stored)
    assert auth.hash_password(PASSWORD) != stored  # salted
    for broken in ("", "plain", "scrypt$1$2", "bcrypt$a$b$c$d$e", "scrypt$x$8$1$zz$zz"):
        assert not auth.verify_password(PASSWORD, broken)


# ---- who is let in ------------------------------------------------------------------------------------

def test_with_no_users_configured_the_api_is_open_as_in_development(client):
    assert client.get("/api/calls").status_code == 200
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["auth_enabled"] is False


def test_dashboard_routes_need_a_session_once_a_user_exists(client, secured):
    for method, path in (("get", "/api/calls"), ("get", "/api/tickets"), ("get", "/api/config"), ("post", "/api/sync"),
                         ("put", "/api/settings"), ("post", "/api/settings/emergency-stop"), ("get", "/api/helpers"),
                         ("get", "/api/whatsapp/status"), ("post", "/api/advestiment/scan")):
        r = getattr(client, method)(path)
        assert r.status_code == 401 and r.json()["detail"] == auth.GATE_DETAIL, path


def test_routes_the_phone_provider_and_the_voice_agent_call_stay_reachable(client, secured):
    # each has its own check (signature, token, unguessable name); the gate must not answer for them
    calls = (("get", "/api/health"), ("post", "/api/telephony/vobiz/answer"), ("post", "/api/telephony/vobiz/gather"),
             ("post", "/api/telephony/vobiz/hangup"), ("post", "/api/telephony/vobiz/inbound"),
             ("post", "/api/telephony/twilio/voice"), ("get", "/api/telephony/audio/c-" + "0" * 40 + ".wav"),
             ("get", "/api/handoff/1/context"), ("post", "/api/handoff/1/result"), ("get", "/api/whatsapp/webhook"))
    for method, path in calls:
        r = getattr(client, method)(path)
        gated = r.status_code == 401 and r.headers.get("content-type", "").startswith("application/json")             and r.json().get("detail") == auth.GATE_DETAIL
        assert not gated, path
    assert client.get("/api/health").status_code == 200


# ---- signing in ---------------------------------------------------------------------------------------

def test_login_gives_a_http_only_session_cookie_that_opens_the_api(client, secured):
    r = login(client)
    assert r.status_code == 200
    body = r.json()
    token = body.pop("token")  # also given to the dashboard, as a fallback when a browser blocks the cookie
    assert body == {"email": USER["email"], "name": USER["name"], "role": USER["role"], "auth_enabled": True}
    assert auth.read_session(token)["e"] == USER["email"]
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie and "secure" not in cookie
    assert client.get("/api/calls").status_code == 200
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == USER["email"]


def test_the_cookie_is_marked_secure_when_the_setting_says_so(client, secured, settings):
    settings(session_cookie_secure="true")
    r = client.post("/api/auth/login", json={"email": USER["email"], "password": PASSWORD, "remember": True},
                    headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()  # over https (behind the proxy: X-Forwarded-Proto)


def test_the_email_is_not_case_sensitive(client, secured):
    assert login(client, email="OPS@ExtraHand.in").status_code == 200


def test_wrong_password_and_unknown_email_get_the_same_answer(client, secured):
    wrong, unknown = login(client, password="nope"), login(client, email="nobody@extrahand.in")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() and "set-cookie" not in wrong.headers
    assert client.get("/api/calls").status_code == 401


def test_logout_ends_the_session(client, secured):
    login(client)
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/calls").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_remembering_the_user_makes_the_cookie_last_longer(client, secured):
    def max_age(remember):
        client.cookies.clear()
        header = login(client, remember=remember).headers["set-cookie"].lower()
        return int(header.split("max-age=")[1].split(";")[0])

    assert max_age(False) == 12 * 3600
    assert max_age(True) == 30 * 24 * 3600


def test_a_tampered_or_expired_cookie_is_refused(client, secured):
    user = auth.users()[USER["email"]]
    good, _ = auth.issue_session(user, remember=False)
    body, signature = good.split(".")
    for bad in (f"{body}.{signature[:-2]}ab", f"{body}x.{signature}", "garbage", "", f"{body}."):
        client.cookies.clear()
        client.cookies.set(auth.COOKIE, bad)
        assert client.get("/api/calls").status_code == 401, bad
    expired, _ = auth.issue_session(user, remember=False, now=time.time() - 13 * 3600)
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, expired)
    assert client.get("/api/calls").status_code == 401
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, good)
    assert client.get("/api/calls").status_code == 200


def test_a_cookie_signed_with_another_secret_is_refused(client, secured, settings):
    user = auth.users()[USER["email"]]
    token, _ = auth.issue_session(user, remember=False)
    settings(session_secret="another secret entirely, also long enough")
    client.cookies.set(auth.COOKIE, token)
    assert client.get("/api/calls").status_code == 401


def test_repeated_wrong_passwords_lock_the_client_out_even_for_the_right_one(client, secured):
    for _ in range(5):
        assert login(client, password="nope").status_code == 401
    locked = login(client)
    assert locked.status_code == 429 and "set-cookie" not in locked.headers
    assert client.get("/api/calls").status_code == 401


def test_the_lockout_ends_after_the_window(client, secured):
    for _ in range(5):
        login(client, password="nope")
    assert login(client).status_code == 429
    auth.THROTTLE.reset()  # what the passing of the window does
    assert login(client).status_code == 200


def test_a_user_list_that_cannot_be_read_locks_everyone_out_instead_of_opening_the_api(client, settings):
    settings(dashboard_users="{not json", session_secret="s" * 40)
    assert client.get("/api/calls").status_code == 401
    assert login(client).status_code == 401


def test_login_without_a_session_secret_is_a_server_error_not_a_weak_session(client, settings):
    users = [{**USER, "password_hash": PASSWORD_HASH}]
    settings(dashboard_users=json.dumps(users), session_secret="")
    r = login(client)
    assert r.status_code == 503 and "set-cookie" not in r.headers


def test_the_single_admin_from_env_signs_in_and_everything_else_needs_a_session(client, settings):
    settings(admin_email="Admin@ExtraHand.in", admin_password="a-long-admin-pass", admin_name="Sai",
             auth_secret="k" * 40, session_cookie_secure="false")
    assert auth.auth_enabled()
    assert client.get("/api/stats").status_code == 401  # closed before signing in
    assert client.get("/api/auth/me").status_code == 401
    assert login(client, password="wrong", email="admin@extrahand.in").status_code == 401
    assert login(client, password="a-long-admin-pass", email="someone@else.in").status_code == 401
    r = login(client, password="a-long-admin-pass", email=" admin@extrahand.in ")
    assert r.status_code == 200, r.text
    body = r.json()
    token = body.pop("token")
    assert body == {"email": "admin@extrahand.in", "name": "Sai", "role": "Admin", "auth_enabled": True}
    assert client.get("/api/auth/me").json()["role"] == "Admin"
    assert client.get("/api/stats").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/stats").status_code == 401


def test_admin_login_readiness_in_production(settings):
    from app.services.readiness import static_checks

    s = settings(app_env="production", dashboard_users="", admin_email="admin@extrahand.in", admin_password="short",
                 session_secret="", auth_secret="")
    checks = {c.id: c for c in static_checks(s)}
    assert checks["login"].status == "fail" and "12" in checks["login"].detail
    assert checks["session_secret"].status == "fail"
    s = settings(admin_password="a-long-admin-pass", auth_secret="k" * 40)
    checks = {c.id: c for c in static_checks(s)}
    assert checks["login"].status == "ok" and checks["session_secret"].status == "ok"


def test_session_cookie_fits_the_address_the_browser_is_on(client, settings):
    settings(admin_email="admin@extrahand.in", admin_password="a-long-admin-pass", auth_secret="k" * 40,
             session_cookie_domain=".extrahand.in", session_cookie_secure="true")
    body = {"email": "admin@extrahand.in", "password": "a-long-admin-pass"}
    # on another address (localhost, a server IP): no foreign domain, or the browser would drop the cookie
    r = client.post("/api/auth/login", json=body, headers={"host": "localhost:3074"})
    assert r.status_code == 200 and "domain=" not in r.headers["set-cookie"].lower()
    # on the real site over https: shared with the subdomains, Secure
    r = client.post("/api/auth/login", json=body, headers={"host": "intelligence.extrahand.in", "x-forwarded-proto": "https"})
    cookie = r.headers["set-cookie"].lower()
    assert "domain=.extrahand.in" in cookie and "secure" in cookie
    # plain http on a server address: not Secure, or the browser would drop it
    r = client.post("/api/auth/login", json=body, headers={"host": "203.0.113.9", "x-forwarded-proto": "http"})
    assert "secure" not in r.headers["set-cookie"].lower()



def test_only_the_configured_admin_and_password_sign_in(client, settings):
    settings(admin_email="admin@extrahand.in", admin_password="a-long-admin-pass", auth_secret="k" * 40,
             session_cookie_secure="false")
    # no built-in passwords, no other emails, no made-up accounts
    for email, password in [("admin@extrahand.in", "admin"), ("admin@extrahand.in", "admin@123"),
                            ("admin@cognitbotz.com", "a-long-admin-pass"), ("anyone@else.in", "admin")]:
        assert login(client, password=password, email=email).status_code == 401, (email, password)
        auth.THROTTLE.reset()
    # the token alone opens the API (for browsers that block the cookie)
    token = login(client, password="a-long-admin-pass", email="admin@extrahand.in").json()["token"]
    client.cookies.clear()
    assert client.get("/api/stats").status_code == 401
    assert client.get("/api/stats", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    # changing the admin email signs the old session out
    settings(admin_email="new@extrahand.in")
    assert client.get("/api/stats", headers={"Authorization": f"Bearer {token}"}).status_code == 401
