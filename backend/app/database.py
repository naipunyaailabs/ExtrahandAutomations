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


def _pg_add_column(conn, table: str, column: str, col_type: str) -> None:
    """PostgreSQL: adds the column only when it is missing. "ADD COLUMN IF NOT EXISTS" takes an exclusive lock on the
    table even when the column exists, so a start would queue behind any open transaction (and every query of the
    live server would queue behind the start). A missing column is added with a short lock timeout: when the table
    is busy the start goes on and the column is added on a later start."""
    from sqlalchemy import text

    exists = conn.execute(text("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
                               "AND table_name = :t AND column_name = :c"), {"t": table, "c": column}).first()
    if exists:
        return
    _pg_locked(conn, f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {col_type}")


def _pg_locked(conn, sql: str) -> None:
    """Runs one schema change with a 5-second lock timeout (in a savepoint, so a timeout does not undo the others)."""
    import logging

    try:
        with conn.begin_nested():
            conn.exec_driver_sql("SET LOCAL lock_timeout = '5s'")
            conn.exec_driver_sql(sql)
    except Exception as exc:  # noqa: BLE001 - busy table: try again on the next start
        logging.getLogger("database").warning("Schema change skipped for now (%s): %s", sql, str(exc).splitlines()[0])


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
                _pg_add_column(conn, "helpers", col_name, col_type)
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
                _pg_add_column(conn, "call_attempts", col_name, col_type)
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
                _pg_add_column(conn, "followups", col_name, col_type)
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
                _pg_add_column(conn, "whatsapp_messages", col_name, col_type)
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
                _pg_add_column(conn, "whatsapp_feedback", col_name, col_type)
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
                _pg_add_column(conn, "tickets", col_name, col_type)
        conn.commit()


def _migrate_task_seed_table() -> None:
    with engine.connect() as conn:
        if is_sqlite:
            cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(task_seed_contacts)").fetchall()}
            if cols and "services" not in cols:
                conn.exec_driver_sql("ALTER TABLE task_seed_contacts ADD COLUMN services VARCHAR(200)")
        else:
            _pg_add_column(conn, "task_seed_contacts", "services", "VARCHAR(200)")
        conn.commit()


def _migrate_escalations_table() -> None:
    new_cols = [("outcome", "VARCHAR(12)"), ("source", "VARCHAR(20)"), ("customer_name", "VARCHAR(200)"),
                ("customer_phone", "VARCHAR(32)"), ("booking_id", "VARCHAR(64)"), ("category", "VARCHAR(40)"),
                ("conversation_id", "INTEGER")]
    with engine.connect() as conn:
        if is_sqlite:
            info = conn.exec_driver_sql("PRAGMA table_info(escalations)").fetchall()
            cols = {row[1] for row in info}
            if not cols:
                return
            for col_name, col_type in new_cols:
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE escalations ADD COLUMN {col_name} {col_type}")
            # a WhatsApp Support case may have no task: SQLite cannot drop NOT NULL, so the table is rebuilt once
            if any(row[1] == "ticket_id" and row[3] for row in info):
                conn.commit()
                _rebuild_sqlite_escalations(conn)
        else:
            for col_name, col_type in new_cols:
                _pg_add_column(conn, "escalations", col_name, col_type)
            from sqlalchemy import text

            nullable = conn.execute(text("SELECT is_nullable FROM information_schema.columns WHERE table_schema = "
                                         "current_schema() AND table_name = 'escalations' AND column_name = 'ticket_id'")).scalar()
            if nullable == "NO":
                _pg_locked(conn, "ALTER TABLE escalations ALTER COLUMN ticket_id DROP NOT NULL")
        conn.commit()


def _rebuild_sqlite_escalations(conn) -> None:
    from .models import Escalation

    cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(escalations)").fetchall()]
    keep = [c.name for c in Escalation.__table__.columns if c.name in cols]
    names = ", ".join(keep)
    conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
    conn.exec_driver_sql("ALTER TABLE escalations RENAME TO escalations_old")
    for ix in Escalation.__table__.indexes:
        conn.exec_driver_sql(f"DROP INDEX IF EXISTS {ix.name}")
    Escalation.__table__.create(conn)
    conn.exec_driver_sql(f"INSERT INTO escalations ({names}) SELECT {names} FROM escalations_old")
    conn.exec_driver_sql("DROP TABLE escalations_old")
    conn.exec_driver_sql("PRAGMA foreign_keys=ON")
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
    _migrate_escalations_table()


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
