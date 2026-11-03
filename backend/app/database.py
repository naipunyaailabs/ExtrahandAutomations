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
)

if is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


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


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    Base.metadata.create_all(engine)
    _migrate_helpers_table()
    _migrate_call_attempts_table()


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
