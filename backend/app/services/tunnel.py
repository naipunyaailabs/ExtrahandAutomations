import atexit
import logging
import os
import re
import subprocess
import threading
import time
from pathlib import Path

import httpx

from ..config import BACKEND_DIR

log = logging.getLogger(__name__)
_tunnel_proc: subprocess.Popen | None = None
_tunnel_lock = threading.Lock()


def check_metrics_url(metrics_url: str = "http://127.0.0.1:20241") -> str | None:
    try:
        r = httpx.get(f"{metrics_url.rstrip('/')}/quicktunnel", timeout=1.2)
        host = r.json().get("hostname")
        if host and host.strip() and host.lower() != "api.trycloudflare.com":
            return f"https://{host.strip()}"
    except Exception:
        pass
    return None


def start_background_tunnel() -> str | None:
    """Spawns cloudflared.exe in background if not already running on metrics port 20241."""
    global _tunnel_proc
    with _tunnel_lock:
        existing = check_metrics_url()
        if existing:
            return existing

        cloudflared_bin = BACKEND_DIR / "cloudflared.exe"
        if not cloudflared_bin.exists():
            return None

        # Verify not already running
        if _tunnel_proc and _tunnel_proc.poll() is None:
            # Running, give it a moment to report metrics
            for _ in range(6):
                time.sleep(0.5)
                m = check_metrics_url()
                if m:
                    return m

        port = os.getenv("PORT", "5074")
        log.info(f"Auto-starting cloudflared tunnel in background on port {port} (metrics port 20241)...")
        cmd = [
            str(cloudflared_bin),
            "tunnel",
            "--url", f"http://127.0.0.1:{port}",
            "--metrics", "127.0.0.1:20241",
            "--no-autoupdate",
        ]

        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0x08000000

        try:
            _tunnel_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
        except Exception as e:
            log.warning("Could not auto-spawn cloudflared: %s", e)
            return None

        # Poll metrics endpoint up to 10 seconds for live tunnel hostname
        start = time.time()
        while time.time() - start < 10:
            time.sleep(0.6)
            live = check_metrics_url()
            if live:
                log.info("Cloudflare tunnel auto-started: %s", live)
                _update_env_file(live)
                return live

    return None


def _update_env_file(url: str):
    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        return
    try:
        content = env_file.read_text(encoding="utf-8")
        if "PUBLIC_BASE_URL=" in content:
            new_content = re.sub(r"(?m)^PUBLIC_BASE_URL=.*$", f"PUBLIC_BASE_URL={url}", content)
        else:
            new_content = content.rstrip() + f"\nPUBLIC_BASE_URL={url}\n"
        env_file.write_text(new_content, encoding="utf-8")
    except Exception as e:
        log.warning("Could not update .env with tunnel URL: %s", e)


def _cleanup():
    global _tunnel_proc
    if _tunnel_proc and _tunnel_proc.poll() is None:
        try:
            _tunnel_proc.terminate()
        except Exception:
            pass


atexit.register(_cleanup)
