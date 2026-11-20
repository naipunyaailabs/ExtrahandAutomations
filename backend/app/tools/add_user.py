"""Create or replace a dashboard user.

    python -m app.tools.add_user ops@yourcompany.com --name "Ops Desk" --role Dispatcher

Asks for the password (twice), then prints the complete DASHBOARD_USERS line for the backend environment file. If
DASHBOARD_USERS is already set in the environment its other users are kept."""

import argparse
import getpass
import json
import os
import sys

from .. import auth

MIN_PASSWORD = 12


def merge(existing: str, email: str, name: str | None, role: str | None, password: str) -> list[dict]:
    """The user list with this user added (or replaced, moved last)."""
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"use a password of at least {MIN_PASSWORD} characters")
    email = email.strip().lower()
    kept = [u for u in (json.loads(existing) if existing.strip() else []) if str(u.get("email", "")).strip().lower() != email]
    entry = {"email": email, "password_hash": auth.hash_password(password)}
    if name:
        entry["name"] = name
    if role:
        entry["role"] = role
    return [*kept, entry]


def setting_line(users: list[dict]) -> str:
    return "DASHBOARD_USERS='" + json.dumps(users, separators=(",", ":"), ensure_ascii=False) + "'"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Create or replace a dashboard user.")
    parser.add_argument("email")
    parser.add_argument("--name")
    parser.add_argument("--role")
    parser.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
    args = parser.parse_args(argv)
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Again: "):
            print("The passwords differ.", file=sys.stderr)
            return 2
    try:
        users = merge(os.environ.get("DASHBOARD_USERS", ""), args.email, args.name, args.role, password)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(setting_line(users))
    return 0


if __name__ == "__main__":
    sys.exit(main())
