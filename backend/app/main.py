import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import calls, escalations, feedback, helpers, reports, system, tickets, twilio_webhooks
from .config import get_settings
from .database import init_db
from .services.worker import run_forever

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Suppress noisy HTTP/watcher transport logs so backend shows clean ExtraHand data only
for noisy in ("httpx", "httpcore", "urllib3", "watchfiles", "uvicorn.access"):
    logging.getLogger(noisy).setLevel(logging.WARNING)


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
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# -----------------------------------------------------------------------------
# Modular Service Architecture
# -----------------------------------------------------------------------------
from calling import calling_router
from whatsapp import whatsapp_router
from marketing import marketing_router
from user_engagement import engagement_router

# Service 1: Automated Calling & Telephony Service
app.include_router(calling_router)

# Service 2: WhatsApp Dispatch & Meta Cloud Service
app.include_router(whatsapp_router)

# Service 3: Marketing & Festival Demand Radar Service
app.include_router(marketing_router)

# Service 4: User Engagement & Operational Analytics Service
app.include_router(engagement_router)




