from __future__ import annotations

import sqlite3

from .. import settings


def normalize_zone(zone: str | None) -> str:
    if not zone:
        return "UNASSIGNED"
    return zone.strip().upper()


def thresholds_for(zone: str | None, device_row: sqlite3.Row | None = None) -> dict[str, float]:
    if device_row and device_row["min_temp"] is not None and device_row["max_temp"] is not None:
        return {
            "min": float(device_row["min_temp"]),
            "max": float(device_row["max_temp"]),
            "warn_margin": float(device_row["warn_margin"] or settings.DEFAULT_WARN_MARGIN),
        }
    return settings.ZONE_THRESHOLDS.get(normalize_zone(zone), settings.ZONE_THRESHOLDS["default"])
