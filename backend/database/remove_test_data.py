"""Removes test and mock data from the database, so the application holds real data only.

Removed (see app/services/real_data.py for the rules):
  - tickets that are not real customers' Works: mock rows (task_1008 ...), Works posted by the ExtraHand team,
    and Works of test accounts - together with their calls, follow-ups, escalations, dispatch runs, feedback
    and events;
  - helpers that are testers, test-named or mock rows (helper_002 ...);
  - customers that are testers, test-named or mock rows (cust_003 ...).
Every removed row is first saved to database/backups/test-data-removed-<timestamp>.json.

Usage (from backend/):  python database/remove_test_data.py            (dry run: only counts)
                        python database/remove_test_data.py --apply    (backup, then delete)
"""
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.models import (CallAttempt, Customer, CustomerFeedback, DispatchRun, Escalation, Event,  # noqa: E402
                        FollowUp, Helper, Ticket)
from app.services.real_data import is_real_helper, is_real_task, is_real_task_id, is_real_user  # noqa: E402


def row_dict(obj):
    out = {}
    for col in obj.__table__.columns.keys():
        v = getattr(obj, col)
        out[col] = v.isoformat() if isinstance(v, (datetime, date)) else v
    return out


def live_tasks():
    """ExtraHand's current view of every Work and the test-account ids (None when ExtraHand is unreachable)."""
    try:
        from user_engagement.extrahand_data import all_tasks, test_accounts

        tasks, _ = all_tasks()
        return {str(t.get("_id") or t.get("taskId")): t for t in tasks}, test_accounts()["ids"]
    except Exception as exc:  # noqa: BLE001
        print(f"ExtraHand not reachable ({exc}); using the stored records only")
        return None, set()


def main(apply: bool) -> None:
    db = SessionLocal()
    live, testers = live_tasks()

    bad_tickets = []
    for t in db.query(Ticket).all():
        if not is_real_task_id(t.id):
            bad_tickets.append(t)
            continue
        record = (live or {}).get(t.id) or (t.raw if isinstance(t.raw, dict) else {})
        record = {**record, "_id": t.id, "customerName": record.get("customerName") or t.customer_name}
        if not is_real_task(record, testers):
            bad_tickets.append(t)
    ids = [t.id for t in bad_tickets]

    related = {
        "customer_feedback": db.query(CustomerFeedback).filter(CustomerFeedback.ticket_id.in_(ids)).all(),
        "call_attempts": db.query(CallAttempt).filter(CallAttempt.ticket_id.in_(ids)).all(),
        "followups": db.query(FollowUp).filter(FollowUp.ticket_id.in_(ids)).all(),
        "escalations": db.query(Escalation).filter(Escalation.ticket_id.in_(ids)).all(),
        "dispatch_runs": db.query(DispatchRun).filter(DispatchRun.ticket_id.in_(ids)).all(),
        "events": db.query(Event).filter(Event.ticket_id.in_(ids)).all(),
    }
    bad_helpers = [h for h in db.query(Helper).all() if not is_real_helper(h)]
    bad_customers = [c for c in db.query(Customer).all()
                     if not is_real_user({"name": c.name}, c.id) or c.id in testers]

    print(f"Tickets to remove: {len(bad_tickets)} (of {db.query(Ticket).count()})")
    for k, rows in related.items():
        print(f"  with their {k}: {len(rows)}")
    print(f"Helpers to remove: {len(bad_helpers)} (of {db.query(Helper).count()}): "
          f"{sorted({h.name or h.id for h in bad_helpers})}")
    print(f"Customers to remove: {len(bad_customers)} (of {db.query(Customer).count()})")
    if not apply:
        print("\nDry run only. Run with --apply to back up and remove.")
        return

    backup_dir = Path(__file__).resolve().parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    backup = backup_dir / f"test-data-removed-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    backup.write_text(json.dumps({
        "tickets": [row_dict(t) for t in bad_tickets],
        **{k: [row_dict(r) for r in rows] for k, rows in related.items()},
        "helpers": [row_dict(h) for h in bad_helpers],
        "customers": [row_dict(c) for c in bad_customers],
    }, default=str, indent=1), encoding="utf-8")
    print(f"Backup saved: {backup}")

    # children first (feedback -> calls -> follow-ups / escalations / runs / events), then tickets
    for key in ("customer_feedback", "call_attempts", "followups", "escalations", "dispatch_runs", "events"):
        for r in related[key]:
            db.delete(r)
        db.flush()
    for t in bad_tickets:
        db.delete(t)
    for h in bad_helpers:
        db.delete(h)
    for c in bad_customers:
        db.delete(c)
    db.commit()
    print(f"Removed. Now: {db.query(Ticket).count()} tickets, {db.query(Helper).count()} helpers, "
          f"{db.query(Customer).count()} customers.")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
