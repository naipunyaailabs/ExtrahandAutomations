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

    # Matching
    match_radius_km: float = 50
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

    default_country_code: str = "+91"
    currency_word: str = "rupees"
    company_name: str = "ExtraHand"
    cors_origins: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()
