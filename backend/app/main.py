import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import auth
from .api import calls, escalations, feedback, helpers, reports, system, tickets, twilio_webhooks
from .config import get_settings
from .database import create_all_tables
from .services import readiness
from .services.worker import run_forever

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Suppress noisy HTTP/watcher transport logs so backend shows clean ExtraHand data only
for noisy in ("httpx", "httpcore", "urllib3", "watchfiles", "uvicorn.access"):
    logging.getLogger(noisy).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from pricing import pricing_scheduler

    readiness.assert_ready(get_settings())  # production refuses to start with unsafe settings
    create_all_tables()  # every table (core, Advertisement, Pricing) exists before the first request
    stop = asyncio.Event()
    task = asyncio.create_task(run_forever(stop))
    pricing_task = asyncio.create_task(pricing_scheduler(stop))  # Pricing Agent: scheduled competitor scans
    yield
    stop.set()
    await task
    await pricing_task


_production = get_settings().app_env == "production"
# In production the interactive docs would list every route to anyone who can reach the server.
app = FastAPI(
    title="Intelligence Platform",
    lifespan=lifespan,
    docs_url=None if _production else "/docs",
    redoc_url=None if _production else "/redoc",
    openapi_url=None if _production else "/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
# Compress JSON (the helper list is ~550 KB raw, a fraction of that gzipped); small replies are left as is
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(auth.AuthGate)  # added last = outermost: nothing under /api is reached without a session
app.include_router(auth.router)
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

# Service 5: Competitive Pricing
#  - pricing/ (Pricing Agent): competitor research -> recommended price per service and area, public price API
#  - app/api/pricing.py: our live ExtraHand prices vs competitor prices entered by the team
from pricing import pricing_router  # noqa: E402
from app.api import pricing as pricing_api  # noqa: E402

app.include_router(pricing_router)
app.include_router(pricing_api.router)


# ------------------------------------------------------------------ one port: the dashboard is served here too
# Registered last, so every API, webhook and docs route above wins; anything else is the React app.
from fastapi import HTTPException  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402


def frontend_dist() -> Path:
    custom = (get_settings().frontend_dist or "").strip()
    return Path(custom) if custom else Path(__file__).resolve().parents[2] / "frontend" / "dist"


@app.get("/{full_path:path}", include_in_schema=False)
async def dashboard(full_path: str):
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(404, "Not found")
    dist = frontend_dist().resolve()
    index = dist / "index.html"
    if not index.is_file():
        raise HTTPException(404, "The dashboard is not built yet: run `npm run build` in the frontend folder.")
    if full_path:
        f = (dist / full_path).resolve()
        if f.is_file() and dist in f.parents:
            # hashed build files never change; everything else is checked again
            cache = "public, max-age=31536000, immutable" if full_path.startswith("assets/") else "no-cache"
            return FileResponse(f, headers={"Cache-Control": cache})
    return FileResponse(index, headers={"Cache-Control": "no-cache"})  # client-side routes (/advertisement/...)
