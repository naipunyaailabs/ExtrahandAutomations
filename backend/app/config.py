from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'database' / 'intelligence.db').as_posix()}"

    # ExtraHand
    extrahand_mode: Literal["mock", "live"] = "mock"
    extrahand_main_base_url: str = "https://extrahand-main-admin-server.backend.extrahand.in/api/v1"
    extrahand_task_base_url: str = "https://extrahand-task-service.backend.extrahand.in"
    extrahand_email: str = ""
    extrahand_password: str = ""
    extrahand_dashboard_type: str = "main_admin"
    extrahand_posted_by: str = "team"
    extrahand_service_auth: str = ""
    extrahand_service_user_id: str = ""
    extrahand_helper_role: str = "helper"
    extrahand_allow_assignment: bool = False
    # Use mock data when live ExtraHand is unreachable (testing only: mock rows would be saved as real data)
    extrahand_mock_fallback: bool = False
    # Write a helper assigned here (accepted on our call / WhatsApp YES) to ExtraHand as well
    extrahand_push_assignments: bool = True

    # Matching
    match_radius_km: float = 10.0
    max_helpers_per_ticket: int = 10

    # Telephony
    calling_agent_active: bool = False  # Initially Deactive: safety guard for real ExtraHand data
    telephony_provider: Literal["simulator", "twilio", "vobiz"] = "simulator"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    public_base_url: str = ""
    # The built dashboard (npm run build). Served by this server, so backend and frontend share one port.
    # Empty = ../frontend/dist next to the backend folder.
    frontend_dist: str = ""
    # Task-Seeding Agent: fixed https address for the tracked Book Now link (falls back to PUBLIC_BASE_URL when
    # that is not a temporary tunnel). Empty: the button opens extrahand.in/book directly and clicks are not counted.
    task_seeding_link_base: str = ""
    # cloudflared metrics address(es); used to read a quick tunnel's current *.trycloudflare.com hostname
    cloudflared_metrics_urls: str = "http://127.0.0.1:20241,http://127.0.0.1:20242,http://127.0.0.1:20243"
    twilio_validate_signature: bool = True
    vobiz_api_base: str = "https://api.vobiz.ai/api/v1"
    vobiz_auth_id: str = ""
    vobiz_auth_token: str = ""  # also keys the signature of Vobiz's callbacks
    vobiz_from_number: str = ""  # the IVR's own caller number, separate from Maya's
    vobiz_validate_signature: bool = True
    tts_voice: str = "Polly.Aditi"
    tts_language: str = "en-IN"
    ivr_max_prompts: int = 3
    ivr_gather_timeout_seconds: int = 7
    call_ring_timeout_seconds: int = 30
    call_stale_minutes: int = 10
    calling_hours_start: str = "07:30"  # India time; the calling agent only places calls inside this window
    calling_hours_end: str = "21:30"
    feedback_call_delay_minutes: int = 15
    max_helper_call_attempts: int = 3

    # IVR Telugu audio (Sarvam text-to-speech; Maya's voice)
    sarvam_api_key: str = ""
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_tts_speaker: str = "ritu"
    sarvam_tts_language: str = "te-IN"
    sarvam_tts_sample_rate: int = 8000
    ivr_audio_dir: str = str(BACKEND_DIR / "database" / "ivr_audio")
    audio_url_secret: str = ""  # keys the unguessable names of per-call audio files

    # Hand-off of a live call to the voice agent (LiveKit SIP). Off while either of the first two is empty.
    handoff_sip_uri: str = ""
    handoff_secret: str = ""  # signs the tokens the voice agent uses to read and report on a call
    handoff_time_limit_seconds: int = 150  # the agent's talk time on one call, from when it connects
    handoff_ring_timeout_seconds: int = 20  # how long to wait for the agent to pick up

    # Scheduling
    followup_offsets_minutes: str = "60"  # one reminder call, 1 hour before the task
    # Call again 10 min later when the reminder is not answered (off: exactly one reminder call)
    followup_retry_no_answer: bool = False
    sync_interval_seconds: int = 300
    worker_tick_seconds: int = 10
    # false on a developer's computer: the API works, but no automations run (no WhatsApp / calls / sync), so a local
    # backend on the production database never sends anything twice next to the server
    run_background_worker: bool = True
    auto_dispatch: bool = False
    # Automatic job-offer calls (IVR) start this many hours before the task's scheduled time
    dispatch_lead_hours: float = 6.0

    # Official Meta WhatsApp Business Cloud API
    meta_wa_phone_number_id: str = ""
    meta_wa_access_token: str = ""
    meta_wa_business_account_id: str = ""
    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_business_portfolio_id: str = ""
    meta_registered_phone_number: str = ""
    # Must be set in .env before the Meta webhook can be verified (no shared default token).
    meta_wa_webhook_verify_token: str = ""
    meta_wa_api_version: str = "v23.0"

    whatsapp_enabled: bool = True
    whatsapp_simulated: bool = False

    # Poster agent AI (OpenRouter): poster design and artwork. Festivals themselves are registered by hand.
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.5-flash"
    # Pricing Agent: free OpenRouter models, tried in this order until one answers. Empty = use OPENROUTER_MODEL.
    pricing_llm_models: str = (
        "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,dots-studio/dots-3-note-preview:free,"
        "google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free"
    )

    # Pricing agent (competitor research -> recommended price per service and area)
    pricing_database_schema: str = "pricing"  # SQL Server only: the pricing tables' own schema
    pricing_api_key: str = ""  # X-API-Key the app team sends to /api/pricing/v1/*; empty = open (dev only)
    searxng_url: str = ""  # self-hosted SearXNG, e.g. http://127.0.0.1:8888; empty = public engines through ddgs
    pricing_search_engines: str = "yahoo,brave,startpage,duckduckgo"  # ddgs engines, in the order tried
    pricing_search_attempts: int = 3  # per engine: they fail at random from a server address
    gmaps_scraper_url: str = ""  # gosom/google-maps-scraper web mode, e.g. http://127.0.0.1:8080; empty = web reviews only
    pricing_page_reader: Literal["auto", "crawl4ai", "http"] = "auto"  # auto = Crawl4AI when installed
    pricing_results_per_query: int = 5
    pricing_max_pages_per_service: int = 8
    pricing_scheduler_enabled: bool = True
    openrouter_api_url: str = "https://openrouter.ai/api/v1/chat/completions"
    llm_timeout_seconds: float = 8.0
    # Image model used to create new poster artwork on each regenerate (empty = reuse photo library)
    poster_image_model: str = "bytedance-seed/seedream-5-0-flash"  # Seedream 5.0 Flash via OpenRouter
    poster_image_aspect_ratio: str = "4:3"
    poster_image_timeout_seconds: float = 120.0
    # Create AI artwork automatically for each registered festival's poster
    poster_auto_artwork: bool = True

    # All-India festival finder agent ("Find Festivals" button): GPT-OSS-20B via OPENROUTER_API_KEY,
    # reads Drik Panchang, admin approval required
    festival_model: str = "openai/gpt-oss-20b"
    festival_llm_timeout_seconds: float = 90.0
    # Drik Panchang pages read for each month: the month's festival list and the year's Indian calendar
    # (the year page adds Christian, Muslim, Sikh and national days)
    festival_source_url: str = "https://www.drikpanchang.com/festivals/month/festivals-{month_name}.html?year={year}"
    festival_source_year_url: str = "https://www.drikpanchang.com/calendars/indian/indiancalendar.html?year={year}"
    # IMD Rashtriya Panchang page used to verify dates (empty = no check)
    festival_verify_url: str = ""
    festival_search_months: int = 3          # current month + next two
    festival_search_every_months: int = 3    # recommended interval between runs
    festival_max_per_month: int = 8

    marketing_posters_dir: str = (BACKEND_DIR / "database" / "posters").as_posix()
    whatsapp_banners_dir: str = (BACKEND_DIR / "database" / "whatsapp_banners").as_posix()  # banner images uploaded for WhatsApp
    # Posters and WhatsApp banners: "auto" = Azure Blob when the connection string is set, else the folders above.
    media_storage: str = "auto"  # auto | azure | local
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "extrahand-media"  # private container; the app serves the images itself
    # Festival photos used on posters (served by the frontend at /posters/)
    poster_assets_dir: str = (BACKEND_DIR.parent / "frontend" / "public" / "posters").as_posix()
    marketing_default_state: str = "Telangana"
    marketing_default_discount: int = 20

    # Admin login (checked by the backend). Login is refused until both are set.
    admin_email: str = ""
    admin_password: str = ""
    admin_name: str = ""
    admin_role: str = "Operations Dispatcher"
    # Secret used to sign login tokens. If empty, a random one is generated at startup
    # (everyone is logged out when the backend restarts).
    auth_secret: str = ""
    auth_session_hours: int = 8
    auth_remember_days: int = 30

    # Public brand links used in messages, posters and the UI
    website_url: str = "https://extrahand.in"
    # Logo shown on posters (a file in frontend/public, or a full URL)
    brand_logo_url: str = "/extrahand_full_logo_transparent.png"
    booking_url: str = "https://extrahand.in/book"
    offers_url: str = "https://extrahand.in/offers"
    task_url_template: str = "https://extrahand.in/tasks/{task_id}"
    bulk_message_template: str = (
        "Namaste {name}! 🎉 {company} is offering an exclusive discount on all home maintenance, "
        "plumbing, and electrical services this week. Book your expert partner now at {link}. "
        "Reply STOP to unsubscribe."
    )

    # Default operating costs (editable in Settings at runtime)
    cost_per_call_minute: float = 0.50
    cost_per_whatsapp_msg: float = 0.25

    default_country_code: str = "+91"
    phone_local_digits: int = 10
    currency_word: str = "rupees"
    currency_code: str = "INR"
    currency_symbol: str = "₹"
    company_name: str = "ExtraHand"
    cors_origins: str = "https://intelligence.extrahand.in,http://intelligence.extrahand.in,https://backend.intelligence.extrahand.in,http://localhost:3074,http://127.0.0.1:3074,http://localhost:5180,http://127.0.0.1:5180,http://localhost:3050,http://127.0.0.1:3050,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"

    # Deployment. "production" makes the backend refuse to start with unsafe settings (see services/readiness.py).
    app_env: Literal["development", "production"] = "development"
    # Dashboard login: a JSON list of {"email", "name", "role", "password_hash"} (make an entry with
    # `python -m app.tools.add_user`). Empty = no login, which is only acceptable in development.
    dashboard_users: str = ""
    session_secret: str = ""  # signs the session cookie; at least 32 random characters
    session_hours: int = 12
    session_remember_days: int = 30
    session_cookie_secure: bool = True  # send the cookie over https only
    session_cookie_domain: str = ""     # e.g. .extrahand.in for sharing across subdomains
    session_cookie_samesite: str = "lax" # lax or none (if none, secure must be True)
    login_max_failures: int = 5  # wrong passwords per client (or per email) in the window before a lockout
    login_window_minutes: int = 10
    trust_proxy_headers: bool = False  # true behind nginx: the client address is the first X-Forwarded-For entry


_tunnel_cache: dict = {"at": 0.0, "url": ""}


def public_base_url() -> str:
    """The https address Vobiz / Twilio should call back, without a trailing slash.

    A Cloudflare quick tunnel (*.trycloudflare.com) gets a new random hostname every time cloudflared restarts,
    which silently breaks every call ("answer_url parameter is not valid"). When PUBLIC_BASE_URL is such a
    tunnel (or empty), the live hostname is read from cloudflared's metrics server instead (cached 30 s)."""
    import logging
    import time

    import httpx

    s = get_settings()
    base = (s.public_base_url or "").strip().rstrip("/")
    if base and ".trycloudflare.com" not in base:
        return base
    now = time.monotonic()
    if now - _tunnel_cache["at"] < 30 and _tunnel_cache["url"]:
        return _tunnel_cache["url"]
    live = ""
    for metrics in (u.strip() for u in s.cloudflared_metrics_urls.split(",") if u.strip()):
        try:
            host = httpx.get(f"{metrics.rstrip('/')}/quicktunnel", timeout=1.5).json().get("hostname")
        except Exception:  # noqa: BLE001 - cloudflared not running on this port
            continue
        if host and host.strip() and host.lower() != "api.trycloudflare.com":
            live = f"https://{host.strip()}"
            break
    if live:
        _tunnel_cache.update(at=now, url=live)
        if live != base:
            logging.getLogger(__name__).info("Using live cloudflared tunnel %s (PUBLIC_BASE_URL is %s)", live, base or "unset")
        return live
    if not (base and ".trycloudflare.com" not in base):
        try:
            from .services.tunnel import start_background_tunnel
            live = start_background_tunnel() or ""
        except Exception:
            pass
        if live:
            _tunnel_cache.update(at=now, url=live)
            return live
    if base.lower() == "https://api.trycloudflare.com":
        return ""
    return _tunnel_cache["url"] or base


def public_url_dns_problem(url: str | None = None) -> str | None:
    """Why Vobiz could not reach the public address (it does not resolve), or None."""
    import socket
    from urllib.parse import urlparse

    url = url if url is not None else public_base_url()
    host = urlparse(url).hostname if url else None
    if not host or host.lower() == "api.trycloudflare.com":
        return ("No active public tunnel found. Please launch the tunnel using start_tunnel.bat "
                "(or start.bat) to establish a live public callback address for Vobiz.")
    try:
        socket.getaddrinfo(host, 443)
    except socket.gaierror:
        hint = (" The Cloudflare quick tunnel has expired: run start_tunnel.bat "
                "or start.bat to generate a fresh tunnel.")
        return f"The public address {url} does not exist (DNS lookup failed), so Vobiz rejects the call.{hint}"
    return None


@lru_cache
def get_settings() -> Settings:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env", override=True)
    return Settings()
