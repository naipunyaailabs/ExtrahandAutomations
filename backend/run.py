"""Unified Intelligence Platform & ExtraHand Dispatch Runner.

Single command starts everything:
    python run.py

- Runs FastAPI backend with live ExtraHand integration.
- Powered by official Meta WhatsApp Business Cloud API (pure Python, zero external node scripts).
- Supervised background worker for periodic sync and auto-dispatch.
"""

import logging
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load backend/.env
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Silence noisy external HTTP transport loggers
for noisy in ("httpx", "httpcore", "urllib3", "watchfiles", "uvicorn.access"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

logger = logging.getLogger("run")


def main():
    print("=================================================================")
    print("  EXTRAHAND INTELLIGENCE PLATFORM")
    print("  Backend Server & Autonomous Dispatch Engine (Meta Cloud API)")
    print("=================================================================")

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8050")),
        reload=os.getenv("RELOAD", "true").lower() == "true",
    )


if __name__ == "__main__":
    main()
