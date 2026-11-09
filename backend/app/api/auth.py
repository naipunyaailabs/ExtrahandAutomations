"""Admin login checked against ADMIN_EMAIL / ADMIN_PASSWORD from backend/.env.

Issues an HMAC-signed token (no extra dependencies). Set AUTH_SECRET so tokens survive restarts.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

_runtime_secret = secrets.token_hex(32)


def _secret() -> bytes:
    return (get_settings().auth_secret or _runtime_secret).encode()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        return payload if payload.get("exp", 0) > time.time() else None
    except (ValueError, json.JSONDecodeError):
        return None


class LoginRequest(BaseModel):
    email: str
    password: str
    remember: bool = True


def _user(s) -> dict:
    name = s.admin_name or s.admin_email.split("@")[0].replace(".", " ").replace("_", " ").title()
    return {"email": s.admin_email, "name": name, "role": s.admin_role}


@router.post("/login")
def login(body: LoginRequest):
    s = get_settings()
    if not s.admin_email or not s.admin_password:
        raise HTTPException(503, "Login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env.")
    email_ok = hmac.compare_digest(body.email.strip().lower(), s.admin_email.strip().lower())
    password_ok = hmac.compare_digest(body.password, s.admin_password)
    if not (email_ok and password_ok):
        raise HTTPException(401, "Incorrect email or password.")
    ttl = s.auth_remember_days * 86400 if body.remember else s.auth_session_hours * 3600
    expires = int(time.time()) + ttl
    user = _user(s)
    return {"token": make_token({"sub": user["email"], "exp": expires}), "expires": expires * 1000, "user": user}


@router.get("/me")
def me(authorization: str = Header(default="")):
    payload = read_token(authorization.removeprefix("Bearer ").strip())
    if not payload:
        raise HTTPException(401, "Session expired. Please sign in again.")
    return _user(get_settings())
