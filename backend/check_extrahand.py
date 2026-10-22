"""Read-only check of the live ExtraHand connection.

Logs in, fetches the first page of Team-posted works and one work's details,
then prints the raw JSON and how it maps to ticket fields. Changes nothing.

Usage (backend folder, virtual environment activated, .env filled in):
    python check_extrahand.py
"""

import json
import sys

from app.config import get_settings
from app.integrations.extrahand import ExtraHandError, LiveExtraHandClient
from app.integrations.mapping import extract_list, normalize_task


def main() -> int:
    s = get_settings()
    if not (s.extrahand_email and s.extrahand_password):
        print("Set EXTRAHAND_EMAIL and EXTRAHAND_PASSWORD in backend/.env first.")
        return 1

    client = LiveExtraHandClient()
    try:
        client._token_value()
        print("1. Login OK")

        resp = client._main("GET", "/tasks", params={"postedBy": s.extrahand_posted_by, "page": 1, "limit": 5})
        tasks = extract_list(resp)
        print(f"2. GET /tasks OK - {len(tasks)} work(s) on the first page")
        if not tasks:
            print("   Raw response:", json.dumps(resp, indent=2, default=str)[:2000])
            return 0

        task_id = str(tasks[0].get("_id") or tasks[0].get("id"))
        detail = client.get_task(task_id)
        print(f"3. GET /tasks/{task_id} OK\n")
        print("----- RAW work details (from ExtraHand) -----")
        print(json.dumps(detail, indent=2, default=str)[:4000])
        print("\n----- How the app reads it (empty = field name needs mapping) -----")
        for k, v in normalize_task({**tasks[0], **detail}).items():
            print(f"   {k:20} {v}")
    except ExtraHandError as e:
        print("FAILED:", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
