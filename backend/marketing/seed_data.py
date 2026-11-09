"""Loads the monitored regions (All-India and the cities) from backend/marketing/data/regions.json."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

DATA_DIR = Path(__file__).resolve().parent / "data"


@lru_cache
def _load(name: str) -> Dict[str, Any]:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def seed_regions() -> List[Dict[str, Any]]:
    """All-India plus the monitored cities (name, region_type, state)."""
    return list(_load("regions.json")["regions"])
