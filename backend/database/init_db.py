"""Database initialization & auto table creation script for ExtraHand Intelligence.

Automatically:
1. Connects to PostgreSQL using settings from .env (or CLI arguments).
2. Creates the target database (e.g. 'INT') if it doesn't already exist.
3. Executes database/schema.sql to create all 9 tables, indexes, and constraints.
4. Verifies all tables, columns, indexes, and row counts.
5. Optionally seeds/syncs live tickets and partners from ExtraHand (--sync).

Usage:
    python database/init_db.py
    python database/init_db.py --sync
    python database/init_db.py --reset
    python database/init_db.py --dbname INT --user postgres --password Manohar
"""

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

# Ensure Windows console supports UTF-8 and ANSI colors
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Terminal colors
GREEN = "\033[92m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def enable_windows_ansi():
    """Enables virtual terminal processing on Windows for ANSI colors."""
    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass


def load_env_file(search_paths: list[Path]) -> dict[str, str]:
    """Loads key-value pairs from .env file."""
    env = {}
    for p in search_paths:
        if p.is_file():
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        env[k] = v
                break
            except Exception:
                pass
    return env


def parse_db_url(url: str) -> dict:
    """Parses SQLAlchemy or Postgres connection URL into connection kwargs."""
    clean_url = re.sub(r"^[a-zA-Z0-9_+]+://", "postgresql://", url)
    parsed = urlparse(clean_url)
    return {
        "user": unquote(parsed.username or "postgres"),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/") or "INT",
    }


def get_connection_config(args: argparse.Namespace) -> dict:
    """Resolves database connection parameters from CLI args, .env, and environment variables."""
    base_dir = Path(__file__).resolve().parent
    env = load_env_file([
        base_dir.parent / ".env",
        base_dir / ".env",
        base_dir.parent.parent / ".env",
    ])

    cfg = {
        "user": "postgres",
        "password": "",
        "host": "localhost",
        "port": 5432,
        "dbname": "INT",
    }

    db_url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL")
    if db_url and "postgres" in db_url:
        cfg.update(parse_db_url(db_url))

    cfg["user"] = os.environ.get("PGUSER") or env.get("PGUSER") or os.environ.get("DB_USER") or env.get("DB_USER") or cfg["user"]
    cfg["password"] = os.environ.get("PGPASSWORD") or env.get("PGPASSWORD") or os.environ.get("DB_PASSWORD") or env.get("DB_PASSWORD") or cfg["password"]
    cfg["host"] = os.environ.get("PGHOST") or env.get("PGHOST") or os.environ.get("DB_HOST") or env.get("DB_HOST") or cfg["host"]
    port_val = os.environ.get("PGPORT") or env.get("PGPORT") or os.environ.get("DB_PORT") or env.get("DB_PORT")
    if port_val:
        try:
            cfg["port"] = int(port_val)
        except ValueError:
            pass
    cfg["dbname"] = os.environ.get("PGDATABASE") or env.get("PGDATABASE") or os.environ.get("DB_NAME") or env.get("DB_NAME") or cfg["dbname"]

    if args.user:
        cfg["user"] = args.user
    if args.password:
        cfg["password"] = args.password
    if args.host:
        cfg["host"] = args.host
    if args.port:
        cfg["port"] = args.port
    if args.dbname:
        cfg["dbname"] = args.dbname

    return cfg


def ensure_database_exists(cfg: dict) -> None:
    """Checks if target database exists; if not, creates it via default 'postgres' database."""
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    target_db = cfg["dbname"]
    admin_cfg = dict(cfg)
    admin_cfg["dbname"] = "postgres"

    try:
        conn = psycopg2.connect(**admin_cfg)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (target_db,))
        exists = cur.fetchone()

        if not exists:
            print(f"{CYAN}[*] Database '{target_db}' does not exist. Creating database now...{RESET}")
            cur.execute(f'CREATE DATABASE "{target_db}" WITH ENCODING \'UTF8\';')
            print(f"{GREEN}[OK] Database '{target_db}' created successfully!{RESET}\n")
        else:
            print(f"{DIM}[OK] Target database '{target_db}' exists.{RESET}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"{YELLOW}[!] Notice during maintenance DB check: {e}{RESET}")
        print(f"{DIM}    Attempting direct connection to '{target_db}'...{RESET}\n")


def execute_schema_sql(cfg: dict, schema_path: Path, reset: bool = False) -> None:
    """Executes schema.sql against target database."""
    import psycopg2

    if not schema_path.is_file():
        raise FileNotFoundError(f"Schema file not found at: {schema_path}")

    sql_content = schema_path.read_text(encoding="utf-8")

    conn = psycopg2.connect(**cfg)
    conn.autocommit = True
    cur = conn.cursor()

    if reset:
        print(f"{YELLOW}[!] Reset flag set: Dropping existing public schema tables...{RESET}")
        cur.execute("""
            DROP SCHEMA public CASCADE;
            CREATE SCHEMA public;
            GRANT ALL ON SCHEMA public TO postgres;
            GRANT ALL ON SCHEMA public TO public;
        """)
        print(f"{GREEN}[OK] Public schema reset.{RESET}\n")

    print(f"{CYAN}[*] Executing DDL schema: {schema_path.name}...{RESET}")
    cur.execute(sql_content)
    print(f"{GREEN}[OK] Schema DDL executed successfully!{RESET}\n")

    cur.close()
    conn.close()


def verify_tables(cfg: dict) -> list[dict]:
    """Inspects all created public tables and returns summary statistics."""
    import psycopg2

    conn = psycopg2.connect(**cfg)
    cur = conn.cursor()

    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    """)
    tables = [row[0] for row in cur.fetchall()]

    stats = []
    for t in tables:
        cur.execute("""
            SELECT count(*)
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s;
        """, (t,))
        col_count = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = %s;
        """, (t,))
        idx_count = cur.fetchone()[0]

        try:
            cur.execute(f'SELECT count(*) FROM public."{t}";')
            row_count = cur.fetchone()[0]
        except Exception:
            row_count = 0

        stats.append({
            "table": t,
            "columns": col_count,
            "indexes": idx_count,
            "rows": row_count,
        })

    # Ticket status breakdown
    ticket_breakdown = {}
    try:
        cur.execute("""
            SELECT dispatch_status, count(*)
            FROM public.tickets
            GROUP BY dispatch_status;
        """)
        ticket_breakdown = dict(cur.fetchall())
    except Exception:
        pass

    cur.close()
    conn.close()
    return stats, ticket_breakdown


def print_summary_table(stats: list[dict], ticket_breakdown: dict, dbname: str) -> None:
    """Prints a styled terminal table showing database status."""
    print(f"{BOLD}========================================================================{RESET}")
    print(f"{BOLD}  DATABASE STATUS: {CYAN}{dbname}{RESET}")
    print(f"{BOLD}========================================================================{RESET}")
    print(f"{'#':<3} {'Table Name':<22} {'Status':<14} {'Columns':<10} {'Indexes':<10} {'Rows':<8}")
    print(f"------------------------------------------------------------------------")

    expected_tables = {
        "app_settings",
        "customers",
        "helpers",
        "tickets",
        "dispatch_runs",
        "followups",
        "call_attempts",
        "escalations",
        "events",
    }

    found = set()
    for idx, s in enumerate(stats, 1):
        found.add(s["table"])
        status = f"{GREEN}READY{RESET}"
        print(
            f"{idx:<3} {BOLD}{s['table']:<22}{RESET} {status:<23} "
            f"{s['columns']:<10} {s['indexes']:<10} {CYAN}{s['rows']:<8}{RESET}"
        )

    missing = expected_tables - found
    if missing:
        print(f"\n{RED}[!] Missing expected tables: {', '.join(missing)}{RESET}")
    else:
        print(f"------------------------------------------------------------------------")
        print(f"{GREEN}[OK] All {len(stats)} platform tables are fully verified and ready!{RESET}")

    if ticket_breakdown:
        total = sum(ticket_breakdown.values())
        unassigned = ticket_breakdown.get("new", 0)
        assigned = ticket_breakdown.get("assigned", 0)
        calling = ticket_breakdown.get("dispatching", 0)
        escalated = ticket_breakdown.get("escalated", 0)
        closed = ticket_breakdown.get("closed", 0)

        print(f"\n{BOLD}Live Tasks Overview ({dbname}):{RESET}")
        print(f"  * {BOLD}Total Tasks   :{RESET} {CYAN}{total}{RESET}")
        print(f"  * {BOLD}Unassigned    :{RESET} {YELLOW}{unassigned}{RESET} (waiting for helper dispatch)")
        print(f"  * {BOLD}Assigned      :{RESET} {GREEN}{assigned}{RESET} (helper assigned)")
        if calling:
            print(f"  * {BOLD}Calling       :{RESET} {calling} (dispatch in progress)")
        if escalated:
            print(f"  * {BOLD}Customer care :{RESET} {escalated} (escalated)")
        print(f"  * {BOLD}Closed        :{RESET} {closed} (completed)")

    print(f"{BOLD}========================================================================{RESET}\n")


def trigger_sync() -> None:
    """Optionally triggers initial ticket and helper synchronization from ExtraHand."""
    print(f"{CYAN}[*] Running live data sync from ExtraHand...{RESET}")
    try:
        backend_dir = Path(__file__).resolve().parent.parent
        sys.path.insert(0, str(backend_dir))
        from app.database import SessionLocal
        from app.services.sync import sync_helpers, sync_tickets

        db = SessionLocal()
        h_stats = sync_helpers(db)
        print(f"{GREEN}[OK] Helpers synced:{RESET} {h_stats}")
        t_stats = sync_tickets(db)
        print(f"{GREEN}[OK] Tickets synced:{RESET} {t_stats}")
        db.close()
    except Exception as e:
        print(f"{RED}[!] Sync failed: {e}{RESET}")


def main():
    enable_windows_ansi()

    parser = argparse.ArgumentParser(
        description="Auto-create tables and initialize the PostgreSQL database for ExtraHand Intelligence."
    )
    parser.add_argument("--host", help="PostgreSQL host (default: from .env or localhost)")
    parser.add_argument("--port", type=int, help="PostgreSQL port (default: from .env or 5432)")
    parser.add_argument("--user", help="PostgreSQL user (default: from .env or postgres)")
    parser.add_argument("--password", help="PostgreSQL password (default: from .env)")
    parser.add_argument("--dbname", help="PostgreSQL database name (default: from .env or INT)")
    parser.add_argument("--schema-file", help="Path to custom schema.sql file")
    parser.add_argument("--reset", action="store_true", help="Drop existing tables before recreating")
    parser.add_argument("--sync", action="store_true", help="Sync live tickets and helpers immediately after creation")

    args = parser.parse_args()

    print(f"\n{BOLD}{CYAN}------------------------------------------------------------------------{RESET}")
    print(f"{BOLD}{CYAN}  ExtraHand Helper Dispatch - Auto Database Initializer{RESET}")
    print(f"{BOLD}{CYAN}------------------------------------------------------------------------{RESET}\n")

    cfg = get_connection_config(args)
    schema_path = (
        Path(args.schema_file).resolve()
        if args.schema_file
        else Path(__file__).resolve().parent / "schema.sql"
    )

    masked_pw = ("*" * len(cfg["password"])) if cfg["password"] else "(empty)"
    print(f"Target Database : {BOLD}{cfg['dbname']}{RESET}")
    print(f"Host / Port     : {cfg['host']}:{cfg['port']}")
    print(f"User            : {cfg['user']}")
    print(f"Password        : {masked_pw}")
    print(f"Schema File     : {schema_path}\n")

    # Step 1: Ensure target database exists
    try:
        ensure_database_exists(cfg)
    except Exception as e:
        print(f"{RED}Error checking database: {e}{RESET}")

    # Step 2: Execute DDL
    try:
        execute_schema_sql(cfg, schema_path, reset=args.reset)
    except Exception as e:
        print(f"{RED}Error executing schema.sql: {e}{RESET}")
        sys.exit(1)

    # Step 3: Verify created tables
    try:
        stats, ticket_breakdown = verify_tables(cfg)
        print_summary_table(stats, ticket_breakdown, cfg["dbname"])
    except Exception as e:
        print(f"{RED}Error verifying tables: {e}{RESET}")
        sys.exit(1)

    # Step 4: Optional sync
    if args.sync:
        trigger_sync()

    print(f"{GREEN}{BOLD}[DONE] Database setup completed successfully!{RESET}\n")
    print(f"Next steps:")
    print(f"  1. Start backend server : {CYAN}python run.py{RESET}")
    print(f"  2. Start frontend       : {CYAN}cd ../frontend && npm run dev{RESET}")
    print(f"  3. Open dashboard       : {CYAN}http://localhost:5173/{RESET}\n")


if __name__ == "__main__":
    main()
