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
    if not is_sqlite:
        return
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(helpers)").fetchall()}
        if not cols:
            return
        new_cols = [
            ("email", "VARCHAR(200)"),
            ("categories", "JSON"),
            ("work_areas", "JSON"),
            ("address", "VARCHAR(500)"),
            ("state", "VARCHAR(100)"),
            ("pincode", "VARCHAR(20)"),
            ("status", "VARCHAR(50) DEFAULT 'active'"),
            ("is_active", "BOOLEAN DEFAULT 1"),
            ("is_verified", "BOOLEAN DEFAULT 0"),
            ("can_accept_tasks", "BOOLEAN DEFAULT 1"),
            ("work_shift_type", "VARCHAR(50)"),
        ]
        for col_name, col_type in new_cols:
            if col_name not in cols:
                conn.exec_driver_sql(f"ALTER TABLE helpers ADD COLUMN {col_name} {col_type}")
        conn.commit()


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    Base.metadata.create_all(engine)
    _migrate_helpers_table()


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
