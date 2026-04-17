from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from .. import settings
from .connection import get_connection, row_to_dict, utc_now
from .thresholds import normalize_zone, thresholds_for


def ensure_device(connection: sqlite3.Connection, device_id: str, name: str | None, zone: str | None) -> None:
    now = utc_now()
    current = connection.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
    normalized_zone = normalize_zone(zone)
    if current is None:
        connection.execute(
            """
            INSERT INTO devices(id, name, zone, min_temp, max_temp, warn_margin, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                device_id,
                name or device_id,
                normalized_zone,
                None,
                None,
                None,
                now,
                now,
            ),
        )
        return

    connection.execute(
        """
        UPDATE devices
        SET name = ?, zone = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            name or current["name"],
            normalized_zone or current["zone"],
            now,
            device_id,
        ),
    )


def derive_runtime_status(row: sqlite3.Row) -> str:
    now = utc_now()
    last_seen = row["last_seen_at"]
    if isinstance(last_seen, str):
        last_seen = datetime.fromisoformat(last_seen)
    if row["online"] == 0:
        return "offline"
    if last_seen is None:
        return "unknown"
    age_seconds = (now - last_seen.astimezone(timezone.utc)).total_seconds()
    if age_seconds >= settings.OFFLINE_AFTER_SECONDS:
        return "offline"
    if age_seconds >= settings.STALE_AFTER_SECONDS:
        return "stale"
    if row["sensor_ok"] == 0:
        return "sensor_fault"
    if row["alert_state"] == "critical":
        return "critical"
    if row["alert_state"] == "warn":
        return "warn"
    return "ok"


def serialize_device_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    threshold = thresholds_for(row["zone"], row)
    payload = row_to_dict(row) or {}
    payload["status"] = derive_runtime_status(row)
    payload["thresholds"] = threshold
    payload["t"] = payload.get("last_temp_c")
    payload["n"] = payload.get("name")
    payload["z"] = payload.get("zone")
    payload["ip"] = payload.get("ip") or ""
    return payload


def get_devices() -> list[dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT d.id, d.name, d.zone, ds.last_temp_c, ds.last_seen_at, ds.online, ds.sensor_ok,
                   ds.ip, ds.rssi, ds.uptime_s, ds.fw_version, ds.status, ds.alert_state,
                   d.min_temp, d.max_temp, d.warn_margin
            FROM devices d
            LEFT JOIN device_state ds ON ds.device_id = d.id
            WHERE d.enabled = 1
            ORDER BY d.zone, d.name
            """
        ).fetchall()
        return [serialize_device_row(row) for row in rows if row is not None]


def get_device(device_id: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT d.id, d.name, d.zone, ds.last_temp_c, ds.last_seen_at, ds.online, ds.sensor_ok,
                   ds.ip, ds.rssi, ds.uptime_s, ds.fw_version, ds.status, ds.alert_state,
                   d.min_temp, d.max_temp, d.warn_margin
            FROM devices d
            LEFT JOIN device_state ds ON ds.device_id = d.id
            WHERE d.id = ?
            """,
            (device_id,),
        ).fetchone()
        return serialize_device_row(row)


def update_device_status(device_id: str, online: bool, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    payload = payload or {}
    with get_connection() as connection:
        current_device = connection.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
        if current_device is None:
            ensure_device(connection, device_id, payload.get("name") or device_id, payload.get("zone"))
        elif payload.get("name") or payload.get("zone"):
            new_name = payload.get("name") or current_device["name"]
            new_zone = normalize_zone(payload.get("zone")) if payload.get("zone") else current_device["zone"]
            if new_name != current_device["name"] or new_zone != current_device["zone"]:
                connection.execute(
                    "UPDATE devices SET name = ?, zone = ?, updated_at = ? WHERE id = ?",
                    (new_name, new_zone, utc_now(), device_id),
                )
        current_state = connection.execute("SELECT * FROM device_state WHERE device_id = ?", (device_id,)).fetchone()
        now = utc_now()
        connection.execute(
            """
            INSERT INTO device_state(device_id, last_temp_c, last_seen_at, online, sensor_ok, ip, rssi, uptime_s, fw_version, status, alert_state, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                online = excluded.online,
                ip = excluded.ip,
                rssi = excluded.rssi,
                uptime_s = excluded.uptime_s,
                fw_version = excluded.fw_version,
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (
                device_id,
                current_state["last_temp_c"] if current_state else None,
                now,
                1 if online else 0,
                current_state["sensor_ok"] if current_state else 1,
                payload.get("ip", current_state["ip"] if current_state else ""),
                payload.get("rssi", current_state["rssi"] if current_state else None),
                payload.get("uptime_s", current_state["uptime_s"] if current_state else None),
                payload.get("fw_version", current_state["fw_version"] if current_state else ""),
                "online" if online else "offline",
                current_state["alert_state"] if current_state else "unknown",
                now,
            ),
        )
        if not online:
            active = connection.execute(
                "SELECT * FROM alerts WHERE device_id = ? AND ended_at IS NULL AND alert_type = 'device_offline'",
                (device_id,),
            ).fetchone()
            if active is None:
                connection.execute(
                    """
                    INSERT INTO alerts(device_id, alert_type, severity, message, started_at)
                    VALUES(?, 'device_offline', 'warning', 'Device reported offline', ?)
                    """,
                    (device_id, now),
                )
        else:
            connection.execute(
                "UPDATE alerts SET ended_at = ? WHERE device_id = ? AND alert_type = 'device_offline' AND ended_at IS NULL",
                (now, device_id),
            )
        row = connection.execute(
            """
            SELECT d.id, d.name, d.zone, ds.last_temp_c, ds.last_seen_at, ds.online, ds.sensor_ok,
                   ds.ip, ds.rssi, ds.uptime_s, ds.fw_version, ds.status, ds.alert_state,
                   d.min_temp, d.max_temp, d.warn_margin
            FROM devices d
            JOIN device_state ds ON ds.device_id = d.id
            WHERE d.id = ?
            """,
            (device_id,),
        ).fetchone()
        return serialize_device_row(row)


def delete_device(device_id: str) -> bool:
    with get_connection() as connection:
        row = connection.execute("SELECT id FROM devices WHERE id = ?", (device_id,)).fetchone()
        if row is None:
            return False
        connection.execute("DELETE FROM sheets_sync_queue WHERE telemetry_id IN (SELECT id FROM telemetry WHERE device_id = ?)", (device_id,))
        connection.execute("DELETE FROM alerts WHERE device_id = ?", (device_id,))
        connection.execute("DELETE FROM telemetry WHERE device_id = ?", (device_id,))
        connection.execute("DELETE FROM device_state WHERE device_id = ?", (device_id,))
        connection.execute("DELETE FROM devices WHERE id = ?", (device_id,))
        return True
