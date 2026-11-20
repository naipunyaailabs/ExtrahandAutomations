"""Is this deployment set up to place real calls safely? One list of checks, used twice: at start-up (production
refuses to boot while any blocking check fails) and by the Voice & IVR page. Nothing here reads a secret into its
output: a check says whether a value is set and sane, never what it is."""

import ipaddress
import re
from dataclasses import asdict, dataclass
from urllib.parse import urlparse

from .. import auth
from ..config import Settings

OK, WARN, FAIL, INFO = "ok", "warn", "fail", "info"

# Addresses that stop working when the laptop sleeps or the tunnel restarts, or that Vobiz cannot reach at all.
TUNNEL_SUFFIXES = (".lhr.life", ".localhost.run", ".ngrok.io", ".ngrok-free.app", ".ngrok.app", ".trycloudflare.com",
                   ".loca.lt", ".serveo.net", ".pinggy.link", ".pinggy.io", ".local")
LIVEKIT_SIP_HOST = re.compile(r"^[a-z0-9]{6,20}\.sip\.livekit\.cloud$")


@dataclass
class Check:
    id: str
    label: str
    status: str  # ok | warn | fail | info
    detail: str
    fix: str = ""
    ms: int | None = None  # how long a live check took

    def as_dict(self) -> dict:
        return asdict(self)


def filled(value: str) -> bool:
    """A setting that holds a real value: not empty, and not the CHANGE_ME of deploy/backend.env.example."""
    return bool(value.strip()) and value.strip().upper() != "CHANGE_ME"


def public_url_problem(url: str) -> str | None:
    """Why Vobiz could not use this as the address of the backend, or None if it looks usable."""
    if not url.strip():
        return "is not set"
    parsed = urlparse(url.strip())
    if parsed.scheme != "https":
        return "must start with https://"
    host = (parsed.hostname or "").lower()
    if not host or host == "localhost":
        return "is a local address"
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return "is a private network address"
    except ValueError:
        pass
    if host.endswith(TUNNEL_SUFFIXES):
        return "is a temporary tunnel address (slow, and it changes)"
    return None


def sip_host_of(uri: str) -> str:
    text = uri.strip().lower().removeprefix("sip:").removeprefix("sips:")
    return text.rpartition("@")[2].split(";")[0].split(":")[0]


def static_checks(s: Settings) -> list[Check]:
    prod = s.app_env == "production"
    bad = FAIL if prod else WARN  # the same problem: a stop in production, advice while developing
    real_calls = s.telephony_provider == "vobiz"
    checks: list[Check] = []

    def add(id, label, status, detail, fix=""):
        checks.append(Check(id, label, status, detail, fix))

    def for_vobiz(id, label, problem, ok_detail, fix):
        if not real_calls:
            add(id, label, INFO, "Not needed while calls are simulated.")
        elif problem:
            add(id, label, bad, problem, fix)
        else:
            add(id, label, OK, ok_detail)

    add("environment", "Environment", OK if prod else WARN,
        "Production." if prod else "Development mode: some safety checks are advice only.",
        "" if prod else "Set APP_ENV=production on the server.")

    # ---- who may use the dashboard
    problem = None
    if not s.dashboard_users.strip() and s.admin_email.strip() and s.admin_password:
        if len(s.admin_password) < 12:
            problem = "ADMIN_PASSWORD is shorter than 12 characters."
    elif not s.dashboard_users.strip():
        problem = "No admin login is configured (ADMIN_EMAIL and ADMIN_PASSWORD), so anyone who can reach the server can use it."
    else:
        try:
            auth.parse_users(s.dashboard_users)
        except ValueError as exc:
            problem = str(exc)
    add("login", "Dashboard login", bad if problem else OK, problem or "Login is required for the dashboard.",
        "Set ADMIN_EMAIL and a long ADMIN_PASSWORD (or DASHBOARD_USERS from python -m app.tools.add_user)." if problem else "")
    secret_ok = len(s.session_secret or s.auth_secret) >= 32
    add("session_secret", "Session secret", OK if secret_ok else bad,
        "Set." if secret_ok else "SESSION_SECRET is missing or shorter than 32 characters.",
        "" if secret_ok else 'Generate one: python -c "import secrets; print(secrets.token_urlsafe(48))"')

    # ---- data
    if s.extrahand_mode != "live":
        add("extrahand", "ExtraHand data source", bad, "Running on built-in sample data, not real bookings and helpers.",
            "Set EXTRAHAND_MODE=live with EXTRAHAND_EMAIL and EXTRAHAND_PASSWORD.")
    elif not (filled(s.extrahand_email) and filled(s.extrahand_password)):
        add("extrahand", "ExtraHand data source", bad, "Live mode needs EXTRAHAND_EMAIL and EXTRAHAND_PASSWORD.",
            "Set both in the backend environment.")
    else:
        add("extrahand", "ExtraHand data source", OK, "Live ExtraHand data.")
    sqlite = s.database_url.lower().startswith("sqlite")
    add("database", "Database", WARN if sqlite and prod else OK,
        "A local SQLite file." if sqlite else "SQL Server.",
        "Use the VPS SQL Server: set DATABASE_URL (see deploy/backend.env.example)." if sqlite and prod else "")

    # ---- phone calls
    if real_calls:
        add("telephony", "Phone provider", OK, "Vobiz: real calls will be placed.")
    else:
        add("telephony", "Phone provider", WARN if prod else INFO,
            f"{s.telephony_provider}: calls are simulated and nobody is dialled.",
            "Set TELEPHONY_PROVIDER=vobiz to place real calls." if prod else "")
    for_vobiz("vobiz_credentials", "Vobiz credentials",
              None if (filled(s.vobiz_auth_id) and filled(s.vobiz_auth_token)) else "VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN must both be set.",
              "Set.", "Copy the Auth ID and Auth Token from the Vobiz console.")
    for_vobiz("caller_number", "Caller number", None if filled(s.vobiz_from_number) else "VOBIZ_FROM_NUMBER is not set.",
              "Set.", "Use the IVR number registered under your TRAI A2P declaration, in +91… form.")
    for_vobiz("signatures", "Callback signature check",
              None if s.vobiz_validate_signature else "VOBIZ_VALIDATE_SIGNATURE is off: anyone could fake a Vobiz callback.",
              "On: only genuine Vobiz callbacks are accepted.", "Set VOBIZ_VALIDATE_SIGNATURE=true.")
    from ..config import public_base_url, public_url_dns_problem

    live_url = public_base_url()
    dead = public_url_dns_problem(live_url) if live_url else None
    problem = public_url_problem(live_url)
    for_vobiz("public_url", "Public address", dead or (f"PUBLIC_BASE_URL {problem}." if problem else None),
              f"Vobiz will call {live_url}.",
              "Use the https address of this server, for example https://ivr.yourcompany.com.")
    for_vobiz("sarvam", "Telugu voice (Sarvam)", None if filled(s.sarvam_api_key) else "SARVAM_API_KEY is not set.",
              "Key set.", "Create a key in the Sarvam dashboard.")
    audio_ok = len(s.audio_url_secret) >= 24
    for_vobiz("audio_secret", "Audio address secret",
              None if audio_ok else "AUDIO_URL_SECRET is missing or shorter than 24 characters, so per-call audio would have guessable addresses.",
              "Set.", 'Generate one: python -c "import secrets; print(secrets.token_urlsafe(32))"')

    # ---- hand-off to the voice agent (optional)
    has_uri, has_secret = filled(s.handoff_sip_uri), filled(s.handoff_secret)
    if not has_uri and not has_secret:
        add("handoff", "Hand-off to Maya", INFO,
            "Off: reminder key 2 and low ratings end with the keypad outcome and a support alert.",
            "To turn it on set HANDOFF_SIP_URI and HANDOFF_SECRET.")
    elif has_uri != has_secret:
        add("handoff", "Hand-off to Maya", WARN,
            "Half set up: it needs both HANDOFF_SIP_URI and HANDOFF_SECRET, so it is off.", "Set the missing one.")
    elif not LIVEKIT_SIP_HOST.match(sip_host_of(s.handoff_sip_uri)):
        add("handoff", "Hand-off to Maya", WARN,
            "HANDOFF_SIP_URI is not a LiveKit project SIP address (it looks like <id>.sip.livekit.cloud). "
            "Vobiz would be refused with 404 No trunk found.",
            "Copy the SIP URI from LiveKit Cloud > Project settings; it is built from the project id, not the web address.")
    else:
        add("handoff", "Hand-off to Maya", OK, f"Calls are bridged to {sip_host_of(s.handoff_sip_uri)}.")
    return checks


def blocking_problems(s: Settings) -> list[str]:
    """What must be fixed before a production server may start. Empty in development."""
    if s.app_env != "production":
        return []
    return [f"{c.label}: {c.detail}" for c in static_checks(s) if c.status == FAIL]


def assert_ready(s: Settings) -> None:
    problems = blocking_problems(s)
    if problems:
        raise RuntimeError("Refusing to start in production with unsafe settings:\n  - " + "\n  - ".join(problems))
