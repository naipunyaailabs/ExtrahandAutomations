"""Convenience entry-point to create all database tables.

Usage:
    python database/create_tables.py
    python database/create_tables.py --sync
    python database/create_tables.py --reset
"""

from init_db import main

if __name__ == "__main__":
    main()
