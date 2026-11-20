# Database tables

Every table is defined in Python and created by Python. There is no SQL file to run.

| Where the tables are defined | Tables |
|---|---|
| `app/models.py` | core: tickets, helpers, customers, calls, follow-ups, WhatsApp, Task Seeding, settings, logs (21) |
| `marketing/database.py` | Advertisement: cities, festivals, posters, festival runs, AI usage (5) |
| `pricing/tables.py` | Pricing Agent (9) |

**35 tables in total.**

## They are created automatically

The backend calls `create_all_tables()` (`app/database.py`) every time it starts:

- creates any table that is missing, with its indexes;
- adds new columns to existing tables;
- never drops or empties anything, so it is safe to run again and again.

On the server (Docker) nothing needs to be run by hand: `docker compose up -d` starts the app and the tables are
created on the first start.

## Running it by hand (optional)

From the `backend/` folder:

```
python database/init_db.py            # create the database if missing, create every table, show a status table
python database/init_db.py --sync     # ...and pull the live tickets and helpers from ExtraHand
python database/init_db.py --reset    # DANGER: deletes ALL data, then creates every table empty
```

In Docker: `docker compose exec app python database/init_db.py`

It uses `DATABASE_URL` from `backend/.env` (or the environment), or `--host --port --user --password --dbname`.

## Adding a table or a column

1. Add it to the Python definition (`app/models.py`, `marketing/database.py` or `pricing/tables.py`).
2. A new table is created on the next start by itself.
3. A new column on an existing table also needs one line in the `_migrate_...` helpers in `app/database.py`
   (or `_add_missing_columns` in `marketing/database.py`), because `create_all` does not change existing tables.
