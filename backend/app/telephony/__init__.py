from ..config import get_settings
from .base import TelephonyProvider


def get_provider() -> TelephonyProvider:
    if get_settings().telephony_provider == "twilio":
        from .twilio import TwilioProvider

        return TwilioProvider()
    from .simulator import SimulatorProvider

    return SimulatorProvider()
