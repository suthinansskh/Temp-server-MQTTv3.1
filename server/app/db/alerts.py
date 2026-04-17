from __future__ import annotations

import sqlite3
from typing import Any

from .connection import get_connection, row_to_dict, utc_now


def derive_alert_state(temp_c: float, sensor_ok: bool, threshold: dict[str, float]) -> tuple[str, str, str]:
    if not sensor_ok:
        return "sensor_fault", "critical", "Sensor reported invalid value"
    if temp_c < threshold["min"] or temp_c > threshold["max"]:
        return "critical", "critical", f"Temperature {temp_c:.1f}C out of range"
    if temp_c < threshold["min"] + threshold["warn_margin"] or temp_c > threshold["max"] - threshold["warn_margin"]:
        return "warn", "warning", f"Temperature {temp_c:.1f}C near threshold"
    return "ok", "info", "Temperature within range"


def reconcile_alert(connection: sqlite3.Connection, device_id: str, alert_state: str, severity: str, message: str) -> None:
    now = utc_now()
    active = connection.execute(
        "SELECT * FROM alerts WHERE device_id = ? AND ended_at IS NULL ORDER BY started_at DESC",
        (device_id,),
    ).fetchall()
    if alert_state in {"critical", "sensor_fault"}:
        alert_type = "temperature_out_of_range" if alert_state == "critical" else "sensor_fault"
        if not any(row["alert_type"] == alert_type for row in active):
            connection.execute(
                """
                INSERT INTO alerts(device_id, alert_type, severity, message, started_at)
                VALUES(?, ?, ?, ?, ?)
                """,
                (device_id, alert_type, severity, message, now),
            )
        for row in active:
            if row["alert_type"] != alert_type:
                connection.execute("UPDATE alerts SET ended_at = ? WHERE id = ?", (now, row["id"]))
        return

    if active:
        connection.execute(
            "UPDATE alerts SET ended_at = ? WHERE device_id = ? AND ended_at IS NULL",
            (now, device_id),
        )


def get_alerts(status: str) -> list[dict[str, Any]]:
    _ALERT_FILTERS = {
        "open": "WHERE ended_at IS NULL",
        "closed": "WHERE ended_at IS NOT NULL",
        "all": "",
    }
    where = _ALERT_FILTERS.get(status, "")
    query = f"SELECT * FROM alerts {where} ORDER BY started_at DESC LIMIT 200"
    with get_connection() as connection:
        rows = connection.execute(query).fetchall()
        return [row_to_dict(row) for row in rows if row is not None]


def acknowledge_alert(alert_id: int, ack_by: str) -> dict[str, Any] | None:
    now = utc_now()
    with get_connection() as connection:
        connection.execute(
            "UPDATE alerts SET ack_by = ?, ack_at = ? WHERE id = ?",
            (ack_by, now, alert_id),
        )
        row = connection.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        return row_to_dict(row)
