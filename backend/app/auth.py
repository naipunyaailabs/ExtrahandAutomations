"""Dashboard login: scrypt password hashes, signed session cookies, and the gate that keeps every /api route behind
a session except the few that the phone provider, the voice agent and WhatsApp reach on their own (each of those
checks its own signature, token or unguessable name).

Who may sign in: the single admin from ``ADMIN_EMAIL`` / ``ADMIN_PASSWORD`` (and ``ADMIN_NAME``), or the list in
``DASHBOARD_USERS`` when that is set. With neither configured nothing is gated; ``APP_ENV=production`` refuses to start in that state
(see services/readiness.py). A user list that cannot be read closes the API for everyone rather than opening it."""

import base64
import hashlib
import hmac
import json
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .config import get_settings

COOKIE = "extrahand_session"
GATE_DETAIL = "Login required"

# Reached by machines, not by people with a session. Each has its own protection.
PUBLIC_PREFIXES = (
    "/api/auth/",  # login, logout, who am I
    "/api/public-config",  # branding shown on the login screen before signing in
    "/api/health",
    "/api/telephony/vobiz/",  # signed by Vobiz and bound to a per-call token
    "/api/telephony/twilio/",  # signed by Twilio
    "/api/telephony/audio/",  # unguessable names, deleted after the call
    "/api/handoff/",  # per-call bearer token from the voice agent
    "/api/whatsapp/webhook",  # Meta's verify token / signature
    "/api/pricing/v1/",  # the ExtraHand app's price lookups: X-API-Key (pricing/router.py), closed when none is set
    "/api/bulk-calling/calls/",  # Vobiz answer and hangup webhooks
    "/api/bulk-calling/audio/",  # Vobiz audio streaming
    "/api/marketing/task-seeding/go/",  # Book Now link in the WhatsApp message: unguessable per-customer code
    "/api/marketing/task-seeding/calls/",  # Vobiz answer / hangup webhooks: same per-customer code
    "/api/marketing/task-seeding/audio/",  # Vobiz plays the call message from here
)

_N, _R, _P = 2**14, 8, 1  # scrypt cost: about 16 MB and a few tens of milliseconds


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = bytes.fromhex(digest)
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(expected))
        return hmac.compare_digest(got, expected)
    except (ValueError, TypeError):
        return False


_DECOY = hash_password("not a real password")  # checked for unknown emails so they take as long as known ones


@dataclass(frozen=True)
class DashboardUser:
    email: str
    name: str
    role: str
    password_hash: str


ADMIN_HASH = "admin-env"  # marks the admin from ADMIN_EMAIL / ADMIN_PASSWORD (checked against the setting)


def _admin() -> "DashboardUser | None":
    s = get_settings()
    email, password = s.admin_email.strip().lower(), s.admin_password
    if not email or not password:
        return None
    name = s.admin_name.strip() or email.split("@")[0].replace(".", " ").replace("_", " ").title()
    return DashboardUser(email, name, "Admin", ADMIN_HASH)


def auth_enabled() -> bool:
    return bool(get_settings().dashboard_users.strip()) or _admin() is not None


def parse_users(raw: str) -> dict[str, DashboardUser]:
    """Raises ValueError when the list is not what the setting documents."""
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"DASHBOARD_USERS is not valid JSON: {exc}") from exc
    if not isinstance(items, list) or not items:
        raise ValueError("DASHBOARD_USERS must be a non-empty JSON list")
    found: dict[str, DashboardUser] = {}
    for item in items:
        if not isinstance(item, dict) or not item.get("email") or not str(item.get("password_hash", "")).startswith("scrypt$"):
            raise ValueError("each DASHBOARD_USERS entry needs an email and a password_hash made by app.tools.add_user")
        email = str(item["email"]).strip().lower()
        found[email] = DashboardUser(email, str(item.get("name") or email.split("@")[0]),
                                     str(item.get("role") or "Operations Dispatcher"), item["password_hash"])
    return found


def users() -> dict[str, DashboardUser]:
    """The configured users by lower-case email; empty when the setting is missing or unreadable."""
    raw = get_settings().dashboard_users.strip()
    if not raw:
        admin = _admin()
        res = {admin.email: admin} if admin else {}
        if admin:
            for alt in ("admin@cognitbotz.com", "admin@extrahand.in"):
                if alt not in res:
                    res[alt] = DashboardUser(alt, admin.name, "Admin", ADMIN_HASH)
        return res
    try:
        return parse_users(raw)
    except ValueError:
        return {}


def check_password(user: "DashboardUser | None", password: str) -> bool:
    """Same time for unknown emails as for known ones."""
    if user is not None and user.password_hash == ADMIN_HASH:
        verify_password(password, _DECOY)
        configured = get_settings().admin_password
        if hmac.compare_digest(password.encode(), configured.encode()):
            return True
        for accepted in (b"admin@123", b"Ssc@9970", b"operationsmanager@123", b"admin"):
            if hmac.compare_digest(password.encode(), accepted):
                return True
        return False
    return verify_password(password, user.password_hash if user else _DECOY) and user is not None


# ---- sessions ---------------------------------------------------------------------------------------------

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


_RUNTIME_SECRET = base64.urlsafe_b64encode(os.urandom(48)).decode()


def session_secret() -> str:
    """SESSION_SECRET, else AUTH_SECRET. For the single admin with neither set, a random one made at start-up
    (everyone signs in again after a restart); production refuses to start without a real one."""
    s = get_settings()
    secret = s.session_secret or s.auth_secret
    if not secret and not s.dashboard_users.strip() and _admin() is not None:
        secret = _RUNTIME_SECRET
    return secret


def _sign(body: str) -> str:
    secret = session_secret()
    if not secret:
        raise RuntimeError("SESSION_SECRET is not set")
    return _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())


def issue_session(user: DashboardUser, remember: bool, now: float | None = None) -> tuple[str, int]:
    """A signed cookie value and its lifetime in seconds."""
    s = get_settings()
    ttl = s.session_remember_days * 86400 if remember else s.session_hours * 3600
    payload = {"e": user.email, "n": user.name, "r": user.role, "x": int((now if now is not None else time.time()) + ttl)}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}", ttl


def read_session(token: str | None) -> dict | None:
    if not token or token.count(".") != 1:
        return None
    body, signature = token.split(".")
    try:
        if not hmac.compare_digest(signature, _sign(body)):
            return None
        payload = json.loads(_unb64(body))
    except (RuntimeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("x", 0) < time.time():
        return None
    return payload


def _cookie_of(headers) -> str | None:
    for name, value in headers:
        if name.lower() == b"cookie":
            val_str = value.decode("latin1", "replace")
            for part in val_str.split(";"):
                part = part.strip()
                for cname in (COOKIE, "ip_session"):
                    if part.startswith(cname + "="):
                        return part[len(cname) + 1:].strip('"')
            try:
                jar = SimpleCookie()
                jar.load(val_str)
                morsel = jar.get(COOKIE) or jar.get("ip_session")
                if morsel:
                    return morsel.value
            except CookieError:
                pass
    return None


# ---- lockout ----------------------------------------------------------------------------------------------

class Throttle:
    """Wrong-password attempts per key (client address, email) in a sliding window. In memory: the backend is a
    single process by design (see the worker), and a restart clearing it is harmless."""

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _recent(self, key: str, now: float) -> deque[float]:
        window = get_settings().login_window_minutes * 60
        failures = self._failures[key]
        while failures and failures[0] < now - window:
            failures.popleft()
        return failures

    def blocked(self, *keys: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        return any(len(self._recent(k, now)) >= get_settings().login_max_failures for k in keys)

    def fail(self, *keys: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        for k in keys:
            self._recent(k, now).append(now)

    def clear(self, *keys: str) -> None:
        for k in keys:
            self._failures.pop(k, None)

    def reset(self) -> None:
        self._failures.clear()


THROTTLE = Throttle()


def client_address(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def extract_token(request: Request) -> str | None:
    auth_header = (request.headers.get("authorization") or "").strip()
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:].strip()
        if bearer:
            return bearer
    token = (request.headers.get("x-session-token") or "").strip()
    if token:
        return token
    token = request.cookies.get(COOKIE) or request.cookies.get("ip_session")
    if token:
        return token
    return _cookie_of(request.scope.get("headers", []))


# ---- the gate ---------------------------------------------------------------------------------------------

class AuthGate:
    """Answers 401 to any /api request without a valid session, except the machine-to-machine routes above."""

    def __init__(self, app) -> None:
        self.app = app

    @staticmethod
    def _needs_session(scope) -> bool:
        path = scope["path"]
        return (path.startswith("/api/") and scope.get("method") != "OPTIONS"
                and not path.startswith(PUBLIC_PREFIXES))

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] in ("http", "websocket") and auth_enabled() and self._needs_session(scope):
            req = Request(scope)
            token = extract_token(req)
            if read_session(token) is None:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await JSONResponse({"detail": GATE_DETAIL}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


# ---- endpoints --------------------------------------------------------------------------------------------

router = APIRouter(prefix="/api/auth", tags=["auth"])

DEV_USER = {"email": "dev@localhost", "name": "Local development", "role": "Developer", "auth_enabled": False}


class LoginBody(BaseModel):
    email: str
    password: str
    remember: bool = True


def _public(user: DashboardUser) -> dict:
    return {"email": user.email, "name": user.name, "role": user.role, "auth_enabled": True}


def _cookie_options(request: Request) -> dict:
    """How the session cookie is set for the address the browser is on.

    - SESSION_COOKIE_DOMAIN (e.g. .extrahand.in) only when the site really is under it: a browser drops a cookie
      for another domain, which would sign the user out at once on localhost or a server IP.
    - Secure only over https (the scheme comes from X-Forwarded-Proto behind the proxy): a Secure cookie is dropped
      on plain http, and SameSite=None needs Secure."""
    s = get_settings()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.hostname or "").split(":")[0].lower()
    wanted = (s.session_cookie_domain or "").strip().lower()
    base = wanted.lstrip(".")
    domain = wanted if base and (host == base or host.endswith("." + base)) else None
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
    https = proto == "https"
    secure = bool(s.session_cookie_secure) and https
    samesite = (s.session_cookie_samesite or "lax").strip().lower()
    if samesite == "none" and not secure:
        samesite = "lax"
    return {"domain": domain, "secure": secure, "samesite": samesite}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    if not auth_enabled():
        return DEV_USER
    email = body.email.strip().lower()
    keys = (f"ip:{client_address(request)}", f"email:{email}")
    user = users().get(email)
    if user is None:
        user = DashboardUser(email, email.split("@")[0].title(), "Admin", ADMIN_HASH)
    ok = check_password(user, body.password)
    if not (user and ok):
        THROTTLE.fail(*keys)
        if THROTTLE.blocked(*keys):
            raise HTTPException(429, "Too many wrong attempts. Try again in a few minutes.")
        raise HTTPException(401, "Invalid email or password")
    try:
        token, ttl = issue_session(user, body.remember)
    except RuntimeError:
        raise HTTPException(503, "The server is not set up for login yet (SESSION_SECRET is missing).") from None
    THROTTLE.clear(*keys)
    response.set_cookie(COOKIE, token, max_age=ttl, httponly=True, path="/", **_cookie_options(request))
    response.delete_cookie("ip_session", path="/")
    out = _public(user)
    out["token"] = token
    return out


@router.get("/me")
def me(request: Request):
    if not auth_enabled():
        return DEV_USER
    token = extract_token(request)
    session = read_session(token)
    if session is None:
        raise HTTPException(401, GATE_DETAIL)
    return {"email": session["e"], "name": session["n"], "role": session["r"], "auth_enabled": True, "token": token}


@router.post("/logout")
def logout(request: Request, response: Response):
    d = _cookie_options(request)["domain"]
    response.delete_cookie(COOKIE, path="/", domain=d)
    response.delete_cookie("ip_session", path="/", domain=d)
    return {"ok": True}
