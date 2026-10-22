"""Root-level shortcut to run database table creation and verification.

Usage:
    python init_db.py
    python init_db.py --sync
    python init_db.py --reset
"""

import sys
from pathlib import Path

# Add database folder to path
sys.path.insert(0, str(Path(__file__).resolve().parent / "database"))
from init_db import main

if __name__ == "__main__":
    main()
