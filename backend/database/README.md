# ExtraHand Database Automation & Schema

This directory contains the automated database initialization scripts and PostgreSQL schema definitions for the ExtraHand Intelligence platform.

---

## 🚀 How to Automatically Create Database & Tables

Whenever you run this script, it **automatically**:
1. Connects to PostgreSQL using settings from `backend/.env` (or custom flags).
2. Creates the target database (e.g. `INT`) if it does not already exist.
3. Automatically creates all **9 required tables**, **indexes**, and **foreign keys** (`CREATE TABLE IF NOT EXISTS`).
4. Verifies all tables and prints a status table showing columns, indexes, and row counts.

---

### Option 1: Python Command (Recommended)

From `backend/` folder:
```bash
python init_db.py
```
Or from `backend/database/` folder:
```bash
python init_db.py
```
Or using the alias:
```bash
python create_tables.py
```

---

### Option 2: Windows 1-Click Batch File (`.bat`)

Simply double-click:
```
backend\database\run_init_db.bat
```
or run from Command Prompt:
```cmd
cd backend\database
run_init_db.bat
```
*(Automatically uses `backend/.venv` Python and keeps the terminal window open so you can view the results.)*

---

### Option 3: PowerShell Script

```powershell
cd backend\database
.\init_db.ps1
```

---

## ⚙️ Advanced CLI Options

| Flag | Description | Example |
| :--- | :--- | :--- |
| *(none)* | Creates all tables if missing, verifies status | `python database/init_db.py` |
| `--sync` | Automatically syncs live ExtraHand tickets and helpers after creating tables | `python database/init_db.py --sync` |
| `--reset` | Drops existing public tables and recreates from scratch | `python database/init_db.py --reset` |
| `--dbname` | Override database name | `python database/init_db.py --dbname INT` |
| `--user` | Override database user | `python database/init_db.py --user postgres` |
| `--password` | Override database password | `python database/init_db.py --password Manohar` |
| `--host` | Override database host | `python database/init_db.py --host localhost` |
| `--port` | Override database port | `python database/init_db.py --port 5432` |

---

## 📋 Created Tables (9 Total)

| Table | Purpose |
| :--- | :--- |
| `app_settings` | Runtime dynamic settings (auto-dispatch toggle, IVR offsets) |
| `customers` | Customer profiles retrieved from ExtraHand (`/users/{id}`) |
| `helpers` | ExtraHand service partners & dispatch helpers with skills & coverage |
| `tickets` | Bookings pulled from ExtraHand (`/tasks?postedBy=team`) |
| `dispatch_runs` | Automated calling attempts for unassigned tickets |
| `followups` | Scheduled reminder IVR calls before booking start times |
| `call_attempts` | Full audit log of all automated phone calls |
| `escalations` | Human customer care escalations for unassigned/rejected bookings |
| `events` | Audit trail of all platform dispatch events |

---

## 📁 Files in this Folder

- **`schema.sql`**: Full raw PostgreSQL DDL script with table definitions, data types, indexes, and constraints.
- **`init_db.py`**: Standalone Python script that automatically creates the database, executes `schema.sql`, and verifies tables.
- **`create_tables.py`**: Shortcut script running `init_db.py`.
- **`run_init_db.bat`**: 1-click Windows batch runner for double-clicking in File Explorer.
- **`init_db.ps1`**: PowerShell runner script.
