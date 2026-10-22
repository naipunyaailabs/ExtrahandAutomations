from ..models import CallAttempt


class SimulatorProvider:
    """No real phone call: the call rings on the dashboard and is answered there."""

    name = "simulator"

    def place_call(self, attempt: CallAttempt) -> str:
        return f"SIM-{attempt.id}"

    def hangup(self, attempt: CallAttempt) -> None:
        pass
