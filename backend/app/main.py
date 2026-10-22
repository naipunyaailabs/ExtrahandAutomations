import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import calls, escalations, helpers, system, tickets, twilio_webhooks
from .config import get_settings
from .database import init_db
from .services.worker import run_forever

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    stop = asyncio.Event()
    task = asyncio.create_task(run_forever(stop))
    yield
    stop.set()
    await task


app = FastAPI(title="Intelligence Platform", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
for module in (tickets, calls, escalations, helpers, system, twilio_webhooks):
    app.include_router(module.router)

