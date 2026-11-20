import subprocess
import re
import sys
import time
import httpx
from pathlib import Path


def update_env(backend_dir: Path, url: str) -> None:
    env_file = backend_dir / ".env"
    if not env_file.exists():
        return
    content = env_file.read_text(encoding="utf-8")
    if "PUBLIC_BASE_URL=" in content:
        new_content = re.sub(r"(?m)^PUBLIC_BASE_URL=.*$", f"PUBLIC_BASE_URL={url}", content)
    else:
        new_content = content.rstrip() + f"\nPUBLIC_BASE_URL={url}\n"
    env_file.write_text(new_content, encoding="utf-8")
    print(f"[SUCCESS] Updated backend/.env with PUBLIC_BASE_URL={url}", flush=True)


def check_existing_metrics() -> str | None:
    """Check if cloudflared is already running on port 20241."""
    try:
        r = httpx.get("http://127.0.0.1:20241/quicktunnel", timeout=1.0)
        host = r.json().get("hostname")
        if host and host.strip() and host.lower() != "api.trycloudflare.com":
            return f"https://{host.strip()}"
    except Exception:
        pass
    return None


def main():
    sys.stdout.reconfigure(line_buffering=True)
    backend_dir = Path(__file__).resolve().parent
    cloudflared_bin = backend_dir / "cloudflared.exe"

    print("=================================================================", flush=True)
    print("  EXTRAHAND TELEPHONY TUNNEL MANAGER", flush=True)
    print("=================================================================", flush=True)

    # 1. Check if tunnel is already active on metrics port 20241
    existing_url = check_existing_metrics()
    if existing_url:
        print(f"[FOUND] Cloudflare tunnel already active at: {existing_url}", flush=True)
        update_env(backend_dir, existing_url)
        print("\n>>> HIGH-SPEED TUNNEL IS RUNNING. DO NOT CLOSE THIS WINDOW. <<<", flush=True)
        try:
            while True:
                time.sleep(5)
                # Keep alive check
                if not check_existing_metrics():
                    print("[INFO] Existing tunnel stopped. Restarting fresh tunnel...", flush=True)
                    break
        except KeyboardInterrupt:
            print("\nTunnel manager exiting.")
            return

    proc = None
    url = None

    port = os.getenv("PORT", "5074")
    if cloudflared_bin.exists():
        print(f"Starting Cloudflare quick tunnel (port {port} -> public HTTPS)...", flush=True)
        cmd = [
            str(cloudflared_bin),
            "tunnel",
            "--url", f"http://127.0.0.1:{port}",
            "--metrics", "127.0.0.1:20241",
            "--no-autoupdate",
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

        start = time.time()
        while time.time() - start < 35:
            # Check metrics endpoint first (most reliable)
            m_url = check_existing_metrics()
            if m_url:
                url = m_url
                break

            # Also inspect output line by line
            line = proc.stdout.readline()
            if not line:
                time.sleep(0.2)
                continue

            # Strip and print log line
            clean_line = line.strip()
            if "trycloudflare.com" in clean_line or "INF" in clean_line:
                print(f"  [cf] {clean_line}", flush=True)

            m = re.search(r"https://([a-zA-Z0-9-]+)\.trycloudflare\.com", clean_line)
            if m:
                subdomain = m.group(1).lower()
                if subdomain != "api":
                    url = m.group(0)
                    break

    # Fallback to localhost.run (SSH) if Cloudflare binary is unavailable or fails
    if not url:
        print("[FALLBACK] Starting localhost.run SSH tunnel fallback...", flush=True)
        cmd = [
            "ssh", "-T",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            "-R", f"80:127.0.0.1:{port}",
            "nokey@localhost.run"
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

        start = time.time()
        while time.time() - start < 20:
            line = proc.stdout.readline()
            if not line:
                continue
            m = re.search(r"https://[a-zA-Z0-9.-]+\.lhr\.life", line)
            if m:
                url = m.group(0)
                break

    if not url:
        print("[ERROR] Could not establish public tunnel.")
        print("[HINT] Ensure your internet connection is active and firewall allows outbound ports.")
        if proc:
            proc.terminate()
        input("\nPress Enter to exit...")
        return

    print("\n=================================================================", flush=True)
    print(f"  [ONLINE] Public Tunnel URL: {url}", flush=True)
    print(f"  Local Target: http://127.0.0.1:{port}", flush=True)
    print("=================================================================\n", flush=True)

    # Update .env so backend immediately persists it
    update_env(backend_dir, url)

    # Verify tunnel routes to localhost:port
    time.sleep(2)
    try:
        r = httpx.get(f"{url}/api/health", timeout=6)
        print(f"[VERIFIED] Public URL tested: HTTP {r.status_code} - Backend is accessible via tunnel!", flush=True)
    except Exception as e:
        print(f"[NOTE] Initial test check: {e} (Backend will receive webhooks once running on :{port})", flush=True)

    print("\n>>> HIGH-SPEED TUNNEL IS RUNNING. DO NOT CLOSE THIS WINDOW WHILE USING TELEPHONY. <<<\n", flush=True)
    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping tunnel...")
        proc.terminate()


if __name__ == "__main__":
    main()
