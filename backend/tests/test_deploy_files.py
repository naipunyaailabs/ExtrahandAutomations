"""The files in deploy/ are what runs on the VPS, so they are held to the same rules as the code."""

import re
from pathlib import Path

import pytest

from app.config import Settings
from app.services import readiness

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"


def example_values() -> dict[str, str]:
    values = {}
    for line in (DEPLOY / "backend.env.example").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip("'\"")
    return values


def settings_from(values: dict[str, str]) -> Settings:
    return Settings(_env_file=None, **{k.lower(): v for k, v in values.items()})


def test_every_setting_in_the_example_exists():
    unknown = [k for k in example_values() if k.lower() not in Settings.model_fields]
    assert unknown == []


def test_the_example_is_a_production_setup_behind_nginx():
    s = settings_from(example_values())
    assert s.app_env == "production" and s.session_cookie_secure is True
    assert s.trust_proxy_headers is True and s.vobiz_validate_signature is True
    assert s.telephony_provider == "vobiz" and s.extrahand_mode == "live"
    assert s.cors_origins.strip() == ""  # the dashboard and the API share one address: no cross-origin access


def test_the_example_cannot_be_started_as_it_is():
    # copying it without filling in the secrets must stop at start-up, not run with placeholders
    problems = readiness.blocking_problems(settings_from(example_values()))
    joined = " ".join(problems)
    for needed in ("Dashboard login", "Session secret", "ExtraHand data source", "Vobiz credentials", "Caller number",
                   "Telugu voice", "Audio address secret"):
        assert needed.lower() in joined.lower(), needed


def test_the_systemd_unit_runs_one_worker_without_reload():
    unit = (DEPLOY / "extrahand-backend.service").read_text(encoding="utf-8")
    command = next(line for line in unit.splitlines() if line.startswith("ExecStart="))
    # calls, the dispatch lock and the login lockout live in this one process: a second worker would split them
    assert re.search(r"--workers 1\b", command) and "--reload" not in command
    assert "--proxy-headers" in command and "127.0.0.1" in command
    assert "EnvironmentFile=" in unit and "Restart=always" in unit


def test_nginx_puts_https_in_front_of_both_containers():
    conf = (DEPLOY / "nginx" / "extrahand-intelligence.conf").read_text(encoding="utf-8")
    assert "server_name intelligence.extrahand.in;" in conf and "server_name backend.intelligence.extrahand.in;" in conf
    assert "proxy_pass http://127.0.0.1:3074" in conf and "proxy_pass http://127.0.0.1:5074" in conf
    assert re.search(r"location = /api/auth/login \{[^}]*limit_req zone=ex_login", conf)  # password guessing is slowed down
    assert re.search(r"location ~ \^/api/\(telephony\|handoff\|whatsapp/webhook\) \{[^}]*limit_req zone=ex_hooks", conf)
    assert re.search(r"location ~ \^/\(docs\|redoc\|openapi", conf)  # no route listing, even if the app served one
    assert "return 301 https://" in conf


@pytest.mark.parametrize("name", ["backend.env.example", "env.production.example", "extrahand-backend.service", "nginx-dashboard.conf.example",
                                  "nginx/extrahand-intelligence.conf", "README.md",
                                  "pricing-tools/docker-compose.yml", "pricing-tools/searxng/settings.yml"])
def test_no_real_secret_is_committed_in_deploy(name):
    text = (DEPLOY / name).read_text(encoding="utf-8")
    assert not re.search(r"scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{20,}", text)  # a real password hash
    assert not re.search(r"MA_[A-Z0-9]{8,}", text)  # a real Vobiz auth id


def test_the_pricing_api_is_rate_limited_in_nginx_and_its_tools_listen_on_loopback_only():
    conf = (DEPLOY / "nginx" / "extrahand-intelligence.conf").read_text(encoding="utf-8")
    assert re.search(r"location /api/pricing/v1/ \{[^}]*limit_req zone=ex_pricing[^}]*proxy_pass http://127\.0\.0\.1:5074", conf)
    assert "zone=ex_pricing:" in conf
    compose = (DEPLOY / "pricing-tools" / "docker-compose.yml").read_text(encoding="utf-8")
    ports = re.findall(r'ports: \["([^"]+)"\]', compose)
    assert len(ports) == 2 and all(p.startswith("127.0.0.1:") for p in ports)
    assert "SEARXNG_SECRET: ${SEARXNG_SECRET:?" in compose  # no committed secret, and it will not start without one
    assert "json" in (DEPLOY / "pricing-tools" / "searxng" / "settings.yml").read_text(encoding="utf-8")
    example = example_values()
    assert example["SEARXNG_URL"].endswith(":8888") and example["GMAPS_SCRAPER_URL"].endswith(":8080")
    assert example["PRICING_API_KEY"] == "CHANGE_ME"


def test_the_pricing_api_key_placeholder_is_refused_in_production(client, settings):
    settings(app_env="production", pricing_api_key=example_values()["PRICING_API_KEY"])
    assert client.get("/api/pricing/v1/prices", params={"city": "Hyderabad"}).status_code == 503


ROOT = DEPLOY.parent


def test_docker_images_run_one_backend_worker_and_keep_secrets_out():
    backend = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert '"--workers", "1"' in backend and '"--port", "5074"' in backend and "EXPOSE 5074" in backend
    assert "USER extrahand" in backend and "APP_ENV=production" in backend and "/api/health" in backend
    assert "IVR_AUDIO_DIR=/audio" in backend and "TZ=Asia/Kolkata" in backend
    frontend = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    assert "npm run build" in frontend and "COPY --from=build /app/dist /usr/share/nginx/html" in frontend
    site = (ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    assert "try_files $uri $uri/ /index.html" in site  # /login, /home and every page load the app
    ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    for must in ("**/.env", "backend/.venv", "frontend/node_modules", "backend/database/*.db"):
        assert must in ignore


def test_compose_publishes_only_on_loopback():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    # only nginx on the server reaches the containers; Docker would otherwise open them past the firewall
    assert '"127.0.0.1:5074:5074"' in compose and '"127.0.0.1:3074:80"' in compose
    assert "dockerfile: backend/Dockerfile" in compose and "dockerfile: frontend/Dockerfile" in compose
    assert "voiceaudio:/audio" in compose and "appdata:/data" in compose
    assert 'PUBLIC_BASE_URL: "https://backend.intelligence.extrahand.in"' in compose


def test_every_table_is_created_by_python_on_an_empty_database(tmp_path, monkeypatch):
    """A fresh server database gets all tables from the Python definitions (no SQL file)."""
    import sqlalchemy

    from app import database as appdb
    from app.database import Base
    from marketing import database as mdb
    from pricing import tables as ptables

    fresh = sqlalchemy.create_engine(f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}")
    monkeypatch.setattr(appdb, "engine", fresh)
    monkeypatch.setattr(mdb, "engine", fresh)
    monkeypatch.setattr(mdb, "_initialized", False)
    monkeypatch.setattr(ptables, "base_engine", fresh)
    monkeypatch.setattr(ptables, "_ready", False)
    monkeypatch.setattr(ptables, "_engine", ptables._engine)  # put back after the test
    monkeypatch.setattr(ptables, "_SessionLocal", ptables._SessionLocal)
    created = set(appdb.create_all_tables())
    expected = set(Base.metadata.tables) | set(mdb.metadata.tables) | set(ptables.PricingBase.metadata.tables)
    assert len(expected) == 35 and expected <= created
    assert set(appdb.create_all_tables()) == created  # running it again changes nothing
    assert not (DEPLOY.parent / "backend" / "database" / "schema.sql").exists()
