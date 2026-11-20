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


def test_nginx_forwards_to_the_one_port_container():
    conf = (DEPLOY / "nginx-dashboard.conf.example").read_text(encoding="utf-8")
    assert "location /api/" in conf and "proxy_pass http://127.0.0.1:8050" in conf
    assert re.search(r"location / \{\s*proxy_pass http://127\.0\.0\.1:8050", conf)  # the dashboard comes from the container
    assert "127.0.0.1:8000" not in conf
    assert "limit_req" in conf  # login and the public webhooks are rate limited
    assert re.search(r"location ~ \^/\(docs\|redoc\|openapi", conf)  # no route listing, even if the app served one
    assert "return 301 https://" in conf


@pytest.mark.parametrize("name", ["backend.env.example", "env.production.example", "extrahand-backend.service", "nginx-dashboard.conf.example", "README.md",
                                  "pricing-tools/docker-compose.yml", "pricing-tools/searxng/settings.yml"])
def test_no_real_secret_is_committed_in_deploy(name):
    text = (DEPLOY / name).read_text(encoding="utf-8")
    assert not re.search(r"scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{20,}", text)  # a real password hash
    assert not re.search(r"MA_[A-Z0-9]{8,}", text)  # a real Vobiz auth id


def test_the_pricing_api_is_rate_limited_in_nginx_and_its_tools_listen_on_loopback_only():
    conf = (DEPLOY / "nginx-dashboard.conf.example").read_text(encoding="utf-8")
    assert re.search(r"location /api/pricing/v1/ \{[^}]*limit_req zone=ex_pricing[^}]*proxy_pass http://127\.0\.0\.1:8050", conf)
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


def test_docker_image_is_one_port_one_worker_and_keeps_secrets_out():
    docker = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "npm run build" in docker and "COPY --from=dashboard /web/dist /app/frontend/dist" in docker
    assert '"--workers", "1"' in docker and '"--port", "8050"' in docker and "EXPOSE 8050" in docker
    assert "USER extrahand" in docker and "APP_ENV=production" in docker and "/api/health" in docker
    ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    for must in ("**/.env", "backend/.venv", "frontend/node_modules", "backend/database/*.db"):
        assert must in ignore


def test_compose_publishes_only_on_loopback_and_needs_a_db_password():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert '"127.0.0.1:${APP_PORT:-8050}:8050"' in compose
    assert compose.count("POSTGRES_PASSWORD:?") == 2  # will not start with an empty password
    assert "env_file: .env" in compose and "appdata:/data" in compose and "pgdata:" in compose
    db = compose.split("  db:")[1]
    assert "ports:" not in db  # the database is never published
    example = (DEPLOY / "env.production.example").read_text(encoding="utf-8")
    assert "POSTGRES_PASSWORD=CHANGE_ME" in example and "SESSION_SECRET=CHANGE_ME" in example


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
