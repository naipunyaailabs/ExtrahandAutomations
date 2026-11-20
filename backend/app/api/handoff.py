"""What the hand-off voice agent calls while it is on a live call (see services/handoff.py)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CallAttempt
from ..services import handoff, ivr
from ..services.common import engine_lock
from ..services.handoff import RatingResult, ReminderResult

router = APIRouter(prefix="/api/handoff", tags=["handoff"])


def _waiting_call(db: Session, attempt_id: int, token: str | None) -> CallAttempt:
    if not handoff.valid_token(attempt_id, token or ""):
        raise HTTPException(403, "Invalid hand-off token")
    attempt = db.get(CallAttempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "Unknown call")
    if attempt.status != "handoff":
        raise HTTPException(409, "This call is not waiting for the voice agent")
    return attempt


@router.get("/{attempt_id}/context")
def get_context(attempt_id: int, x_handoff_token: Annotated[str | None, Header()] = None,
                db: Session = Depends(get_db)):
    with engine_lock:
        attempt = _waiting_call(db, attempt_id, x_handoff_token)
        if '"handoff_connected"' not in (attempt.timeline or ""):  # the agent may ask twice
            ivr.note(attempt, "handoff_connected")
            db.commit()
        return handoff.context(db, attempt)


@router.post("/{attempt_id}/result")
def post_result(attempt_id: int, result: Annotated[ReminderResult | RatingResult, Field(discriminator="kind")],
                x_handoff_token: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    with engine_lock:  # the status check and the finish are one step, so a second result always sees the first
        attempt = _waiting_call(db, attempt_id, x_handoff_token)
        try:
            handoff.apply_result(db, attempt, result)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        db.commit()
        return {"outcome": attempt.outcome}
