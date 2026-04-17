from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from .. import settings


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_parent_dir() -> None:
    settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def adapt_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


sqlite3.register_adapter(datetime, adapt_datetime)


def convert_timestamp(value: bytes) -> datetime:
    return datetime.fromisoformat(value.decode("utf-8"))


sqlite3.register_converter("timestamp", convert_timestamp)


@contextmanager
def get_connection():
    ensure_parent_dir()
    connection = sqlite3.connect(
        settings.DB_PATH,
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                zone TEXT NOT NULL,
                location TEXT DEFAULT '',
                min_temp REAL,
                max_temp REAL,
                warn_margin REAL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL
            );

            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                temp_c REAL NOT NULL,
                sensor_ok INTEGER NOT NULL,
                ip TEXT DEFAULT '',
                rssi INTEGER,
                uptime_s INTEGER,
                fw_version TEXT DEFAULT '',
                ts_device TIMESTAMP,
                ts_server TIMESTAMP NOT NULL,
                FOREIGN KEY (device_id) REFERENCES devices(id)
            );

            CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry(device_id, ts_server DESC);
            CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts_server DESC);

            CREATE TABLE IF NOT EXISTS device_state (
                device_id TEXT PRIMARY KEY,
                last_temp_c REAL,
                last_seen_at TIMESTAMP,
                online INTEGER NOT NULL DEFAULT 0,
                sensor_ok INTEGER NOT NULL DEFAULT 1,
                ip TEXT DEFAULT '',
                rssi INTEGER,
                uptime_s INTEGER,
                fw_version TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'unknown',
                alert_state TEXT NOT NULL DEFAULT 'unknown',
                updated_at TIMESTAMP NOT NULL,
                FOREIGN KEY (device_id) REFERENCES devices(id)
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                message TEXT NOT NULL,
                started_at TIMESTAMP NOT NULL,
                ended_at TIMESTAMP,
                ack_by TEXT,
                ack_at TIMESTAMP,
                FOREIGN KEY (device_id) REFERENCES devices(id)
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(device_id, ended_at, started_at DESC);

            CREATE TABLE IF NOT EXISTS sheets_sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telemetry_id INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at TIMESTAMP NOT NULL,
                sent_at TIMESTAMP,
                FOREIGN KEY (telemetry_id) REFERENCES telemetry(id)
            );
            """
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row)
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.astimezone(timezone.utc).isoformat()
    return data
