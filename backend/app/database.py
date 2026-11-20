from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import BACKEND_DIR, get_settings

settings = get_settings()
is_sqlite = settings.database_url.startswith("sqlite")

if is_sqlite:
    (BACKEND_DIR / "database").mkdir(exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 30} if is_sqlite else {},
    pool_pre_ping=not is_sqlite,  # a database restart (e.g. its container) does not leave broken connections
)

if is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# --- Schemas (used by the Pricing Agent's tables) -------------------------------------------------
# On SQL Server a module can keep its tables in its own schema; SQLite / PostgreSQL use the one engine as is.
base_engine = engine
is_mssql = engine.dialect.name == "mssql"


def _check_schema_name(name: str) -> str:
    import re

    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name or ""):
        raise RuntimeError(f"Invalid database schema name: {name!r}")
    return name


def engine_for_schema(schema: str):
    """SQL Server: unqualified tables live in `schema`. Other databases: the normal engine."""
    if not is_mssql:
        return base_engine
    return base_engine.execution_options(schema_translate_map={None: _check_schema_name(schema)})


def ensure_schema(schema: str) -> None:
    """SQL Server: create the schema if it does not exist yet (nothing to do elsewhere)."""
    if is_mssql:
        name = _check_schema_name(schema)
        with base_engine.begin() as conn:
            conn.exec_driver_sql(f"IF SCHEMA_ID(N'{name}') IS NULL EXEC('CREATE SCHEMA [{name}]')")


class Base(DeclarativeBase):
    pass


def _migrate_helpers_table() -> None:
    new_cols = [
        ("email", "VARCHAR(200)"),
        ("categories", "JSON" if is_sqlite else "JSONB"),
        ("work_areas", "JSON" if is_sqlite else "JSONB"),
        ("address", "VARCHAR(500)"),
        ("state", "VARCHAR(100)"),
        ("pincode", "VARCHAR(20)"),
        ("status", "VARCHAR(50) DEFAULT 'active'"),
        ("is_active", "BOOLEAN DEFAULT 1" if is_sqlite else "BOOLEAN DEFAULT true"),
        ("is_verified", "BOOLEAN DEFAULT 0" if is_sqlite else "BOOLEAN DEFAULT false"),
        ("can_accept_tasks", "BOOLEAN DEFAULT 1" if is_sqlite else "BOOLEAN DEFAULT true"),
        ("work_shift_type", "VARCHAR(50)"),
    ]
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(helpers)").fetchall()}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE helpers ADD COLUMN {col_name} {col_type}")
        else:
            for col_name, col_type in new_cols:
                conn.exec_driver_sql(f"ALTER TABLE helpers ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        conn.commit()


def _migrate_call_attempts_table() -> None:
    new_cols = [
        ("customer_id", "VARCHAR(64)"),
        ("customer_name", "VARCHAR(200)"),
        ("language", "VARCHAR(20) DEFAULT 'en'"),
        ("transcript", "TEXT"),
        ("summary", "TEXT"),
        ("duration_seconds", "INTEGER DEFAULT 0"),
        ("recording_url", "VARCHAR(500)"),
        ("handoff_json", "TEXT"),
        ("timeline", "TEXT"),
    ]
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(call_attempts)").fetchall()}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE call_attempts ADD COLUMN {col_name} {col_type}")
        else:
            for col_name, col_type in new_cols:
                conn.exec_driver_sql(f"ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        conn.commit()


def _migrate_followups_table() -> None:
    new_cols = [("retry_of", "INTEGER")]
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(followups)").fetchall()}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE followups ADD COLUMN {col_name} {col_type}")
        else:
            for col_name, col_type in new_cols:
                conn.exec_driver_sql(f"ALTER TABLE followups ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        conn.commit()


def _migrate_whatsapp_messages_table() -> None:
    new_cols = [("body", "TEXT")]
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(whatsapp_messages)").fetchall()}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE whatsapp_messages ADD COLUMN {col_name} {col_type}")
        else:
            for col_name, col_type in new_cols:
                conn.exec_driver_sql(f"ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        conn.commit()


def _migrate_whatsapp_feedback_table() -> None:
    new_cols = [("reply_message_id", "VARCHAR(128)"), ("reply_raw", "TEXT")]
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(whatsapp_feedback)").fetchall()}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE whatsapp_feedback ADD COLUMN {col_name} {col_type}")
        else:
            for col_name, col_type in new_cols:
                conn.exec_driver_sql(f"ALTER TABLE whatsapp_feedback ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        conn.commit()


def _migrate_tickets_table() -> None:
    new_cols = [("assigned_via", "VARCHAR(20)"), ("assigned_at", "TIMESTAMP"), ("extrahand_push", "VARCHAR(10)"),
                ("extrahand_push_error", "VARCHAR(300)")]
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tickets)").fetchall()}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE tickets ADD COLUMN {col_name} {col_type}")
        else:
            for col_name, col_type in new_cols:
                conn.exec_driver_sql(f"ALTER TABLE tickets ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        conn.commit()


def _migrate_task_seed_table() -> None:
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(task_seed_contacts)").fetchall()}
            if cols and "services" not in cols:
                conn.exec_driver_sql("ALTER TABLE task_seed_contacts ADD COLUMN services VARCHAR(200)")
        else:
            conn.exec_driver_sql("ALTER TABLE task_seed_contacts ADD COLUMN IF NOT EXISTS services VARCHAR(200)")
        conn.commit()


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    Base.metadata.create_all(engine)
    _migrate_tickets_table()
    _migrate_helpers_table()
    _migrate_call_attempts_table()
    _migrate_followups_table()
    _migrate_whatsapp_messages_table()
    _migrate_whatsapp_feedback_table()
    _migrate_task_seed_table()


def create_all_tables() -> list[str]:
    """Creates every table of the platform that is missing, and adds new columns to existing ones:
    the core tables (app/models.py), the Advertisement tables (marketing/database.py) and the Pricing tables
    (pricing/tables.py). Safe to run any number of times: it never drops or empties anything.
    Returns the table names now in the database."""
    from sqlalchemy import inspect

    from marketing.database import init_advestiment_db
    from pricing.tables import init_pricing_db

    init_db()
    init_advestiment_db()
    init_pricing_db()
    return sorted(inspect(engine).get_table_names())


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
