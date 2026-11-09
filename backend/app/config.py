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

    # Matching
    match_radius_km: float = 10.0
    max_helpers_per_ticket: int = 10

    # Telephony
    telephony_provider: Literal["simulator", "twilio"] = "simulator"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    public_base_url: str = ""
    twilio_validate_signature: bool = True
    tts_voice: str = "Polly.Aditi"
    tts_language: str = "en-IN"
    ivr_max_prompts: int = 3
    ivr_gather_timeout_seconds: int = 7
    call_ring_timeout_seconds: int = 30
    call_stale_minutes: int = 10
    calling_hours_start: str = "09:00"
    calling_hours_end: str = "21:00"
    feedback_call_delay_minutes: int = 15
    max_helper_call_attempts: int = 3

    # Scheduling
    followup_offsets_minutes: str = "120,60,30"
    sync_interval_seconds: int = 300
    worker_tick_seconds: int = 10
    auto_dispatch: bool = False

    # Official Meta WhatsApp Business Cloud API
    meta_wa_phone_number_id: str = ""
    meta_wa_access_token: str = ""
    meta_wa_business_account_id: str = ""
    # Must be set in .env before the Meta webhook can be verified (no shared default token).
    meta_wa_webhook_verify_token: str = ""
    meta_wa_api_version: str = "v21.0"

    whatsapp_enabled: bool = True
    whatsapp_simulated: bool = False
    whatsapp_gateway_url: str = "http://127.0.0.1:2785"
    whatsapp_api_key: str = ""
    whatsapp_session_id: str = "extrahand-dispatch"
    whatsapp_webhook_url: str = "http://localhost:8050/api/whatsapp/webhook"

    # Poster agent AI (OpenRouter): poster design and artwork. Festivals themselves are registered by hand.
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.5-flash"
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
    cors_origins: str = "http://localhost:5180,http://127.0.0.1:5180,http://localhost:3050,http://127.0.0.1:3050,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
