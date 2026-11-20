from ..config import get_settings
from .base import TelephonyProvider


def get_provider() -> TelephonyProvider:
    if get_settings().telephony_provider == "twilio":
        from .twilio import TwilioProvider

        return TwilioProvider()
    if get_settings().telephony_provider == "vobiz":
        from .vobiz import VobizProvider

        return VobizProvider()
    from .simulator import SimulatorProvider

    return SimulatorProvider()
