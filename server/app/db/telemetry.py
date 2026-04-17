from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import settings
from .alerts import derive_alert_state, reconcile_alert
from .connection import get_connection, row_to_dict, utc_now
from .devices import ensure_device, serialize_device_row
from .thresholds import normalize_zone, thresholds_for


def insert_telemetry(payload: dict[str, Any]) -> dict[str, Any]:
    device_id = payload["device_id"]
    name = payload.get("name") or device_id
    zone = payload.get("zone")
    sensor_ok = bool(payload.get("sensor_ok", True))
    temp_c = float(payload["temp_c"])
    ts_server = utc_now()
    ts_device = payload.get("ts_device")
    if isinstance(ts_device, (int, float)):
        ts_device = datetime.fromtimestamp(float(ts_device), tz=timezone.utc)
    else:
        ts_device = None

    with get_connection() as connection:
        ensure_device(connection, device_id, name, zone)
        device_row = connection.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
        threshold = thresholds_for(zone, device_row)
        alert_state, severity, message = derive_alert_state(temp_c, sensor_ok, threshold)
        cursor = connection.execute(
            """
            INSERT INTO telemetry(device_id, temp_c, sensor_ok, ip, rssi, uptime_s, fw_version, ts_device, ts_server)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                device_id,
                temp_c,
                1 if sensor_ok else 0,
                payload.get("ip", ""),
                payload.get("rssi"),
                payload.get("uptime_s"),
                payload.get("fw_version", ""),
                ts_device,
                ts_server,
            ),
        )
        telemetry_id = int(cursor.lastrowid)
        status = "online"
        connection.execute(
            """
            INSERT INTO device_state(device_id, last_temp_c, last_seen_at, online, sensor_ok, ip, rssi, uptime_s, fw_version, status, alert_state, updated_at)
            VALUES(?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                last_temp_c = excluded.last_temp_c,
                last_seen_at = excluded.last_seen_at,
                online = excluded.online,
                sensor_ok = excluded.sensor_ok,
                ip = excluded.ip,
                rssi = excluded.rssi,
                uptime_s = excluded.uptime_s,
                fw_version = excluded.fw_version,
                status = excluded.status,
                alert_state = excluded.alert_state,
                updated_at = excluded.updated_at
            """,
            (
                device_id,
                temp_c,
                ts_server,
                1 if sensor_ok else 0,
                payload.get("ip", ""),
                payload.get("rssi"),
                payload.get("uptime_s"),
                payload.get("fw_version", ""),
                status,
                alert_state,
                ts_server,
            ),
        )
        reconcile_alert(connection, device_id, alert_state, severity, message)
        queue_payload = {
            "device_id": device_id,
            "temp": temp_c,
            "name": name,
            "zone": normalize_zone(zone),
            "api_key": settings.GAS_API_KEY,
        }
        connection.execute(
            """
            INSERT INTO sheets_sync_queue(telemetry_id, payload_json, status, created_at)
            VALUES(?, ?, 'pending', ?)
            """,
            (telemetry_id, json.dumps(queue_payload), ts_server),
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


def parse_range(range_name: str) -> timedelta:
    mapping = {
        "live": timedelta(hours=1),
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "12h": timedelta(hours=12),
        "24h": timedelta(hours=24),
        "48h": timedelta(hours=48),
        "72h": timedelta(hours=72),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
    }
    return mapping.get(range_name, timedelta(hours=24))


def get_device_telemetry(device_id: str, range_name: str) -> list[dict[str, Any]]:
    since = utc_now() - parse_range(range_name)
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT temp_c, sensor_ok, ip, rssi, uptime_s, fw_version, ts_server
            FROM telemetry
            WHERE device_id = ? AND ts_server >= ?
            ORDER BY ts_server ASC
            LIMIT 10000
            """,
            (device_id, since),
        ).fetchall()
        return [row_to_dict(row) for row in rows if row is not None]


def purge_old_telemetry(days: int | None = None) -> int:
    days = days or settings.DATA_RETENTION_DAYS
    cutoff = utc_now() - timedelta(days=days)
    with get_connection() as connection:
        connection.execute(
            "DELETE FROM sheets_sync_queue WHERE telemetry_id IN (SELECT id FROM telemetry WHERE ts_server < ?)",
            (cutoff,),
        )
        cursor = connection.execute("DELETE FROM telemetry WHERE ts_server < ?", (cutoff,))
        return cursor.rowcount
