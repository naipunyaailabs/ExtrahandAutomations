from typing import Protocol

from ..models import CallAttempt


class TelephonyError(Exception):
    pass


class TelephonyProvider(Protocol):
    name: str

    def place_call(self, attempt: CallAttempt) -> str:
        """Starts an outbound call and returns the provider's call id.

        The call then reports back through ``services.ivr`` (webhooks for Twilio,
        dashboard buttons for the simulator)."""
        ...

    def hangup(self, attempt: CallAttempt) -> None: ...
