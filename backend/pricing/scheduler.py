"""Starts a pricing run when the last finished one is older than the strategy's refresh_days."""

import asyncio
import logging

from sqlalchemy import func, select

from app.config import get_settings
from app.models import utcnow

from . import llm
from .agent import RunBusy, fail_interrupted_runs, get_strategy, start_run
from .tables import Area, Run, Service, pricing_session

logger = logging.getLogger("pricing.scheduler")

CHECK_EVERY_SECONDS = 600


def run_is_due() -> bool:
    with pricing_session() as db:
        if db.scalar(select(Run.id).where(Run.status == "running")):
            return False
        if not db.scalar(select(func.count(Area.id)).where(Area.active)) or not db.scalar(select(func.count(Service.id)).where(Service.active)):
            return False
        last_start = db.scalar(select(func.max(Run.started_at)))
        last_done = db.scalar(select(func.max(Run.finished_at)).where(Run.status == "done"))
        refresh_days = get_strategy(db).refresh_days
    now = utcnow()
    if last_start and (now - last_start).total_seconds() < 6 * 3600:
        return False  # a run started recently (and maybe failed): don't retry in a tight loop
    return last_done is None or (now - last_done).days >= refresh_days


async def pricing_scheduler(stop: asyncio.Event) -> None:
    try:
        fail_interrupted_runs()
    except Exception:
        logger.exception("[Pricing] could not clean up interrupted runs")
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=CHECK_EVERY_SECONDS)
            break
        except asyncio.TimeoutError:
            pass
        if not get_settings().pricing_scheduler_enabled or not llm.llm_configured():
            continue
        try:
            if await asyncio.to_thread(run_is_due):
                run_id = start_run("schedule")
                logger.info("[Pricing] scheduled run %s started", run_id)
        except RunBusy:
            pass
        except Exception:
            logger.exception("[Pricing] scheduler check failed")
