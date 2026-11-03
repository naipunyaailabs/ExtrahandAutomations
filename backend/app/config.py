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
    extrahand_task_service_base_url: str = "https://extrahand-task-service.backend.extrahand.in"
    extrahand_task_base_url: str = "https://extrahand-task-service.backend.extrahand.in"
    extrahand_email: str = ""
    extrahand_password: str = ""
    extrahand_dashboard_type: str = "main_admin"
    extrahand_posted_by: str = "team"
    extrahand_service_auth: str = ""
    extrahand_service_user_id: str = ""
    extrahand_helper_role: str = "helper"
    extrahand_allow_assignment: bool = False

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

    # Scheduling
    followup_offsets_minutes: str = "120,60,30"
    sync_interval_seconds: int = 300
    worker_tick_seconds: int = 10
    auto_dispatch: bool = False

    # Official Meta WhatsApp Business Cloud API
    meta_wa_phone_number_id: str = ""
    meta_wa_access_token: str = ""
    meta_wa_business_account_id: str = ""
    meta_wa_webhook_verify_token: str = "extrahand_meta_token"
    meta_wa_api_version: str = "v21.0"

    whatsapp_enabled: bool = True
    whatsapp_simulated: bool = False
    whatsapp_gateway_url: str = "http://127.0.0.1:2785"
    whatsapp_api_key: str = ""
    whatsapp_session_id: str = "extrahand-dispatch"
    whatsapp_webhook_url: str = "http://localhost:8000/api/whatsapp/webhook"

    # Marketing Agent & Festival Radar AI (OpenRouter)
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.5-flash"

    default_country_code: str = "+91"
    currency_word: str = "rupees"
    company_name: str = "ExtraHand"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
