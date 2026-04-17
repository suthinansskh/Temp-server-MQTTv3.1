"""Database package — modular SQLite data layer.

Submodules:
  connection   — DB connection management & schema initialization
  thresholds   — Zone normalization & threshold lookup
  devices      — Device CRUD & runtime status
  telemetry    — Telemetry ingestion, queries & retention
  alerts       — Alert state machine & queries
  sheets_queue — Google Sheets sync queue management
"""

from .alerts import acknowledge_alert, derive_alert_state, get_alerts, reconcile_alert
from .connection import get_connection, init_db, row_to_dict, utc_now
from .devices import (
    delete_device,
    derive_runtime_status,
    ensure_device,
    get_device,
    get_devices,
    serialize_device_row,
    update_device_status,
)
from .sheets_queue import (
    dequeue_sheets_batch,
    mark_sheets_failed,
    mark_sheets_retry,
    mark_sheets_sent,
    pending_sheets_count,
)
from .telemetry import get_device_telemetry, insert_telemetry, purge_old_telemetry
from .thresholds import normalize_zone, thresholds_for

__all__ = [
    "acknowledge_alert",
    "delete_device",
    "dequeue_sheets_batch",
    "derive_alert_state",
    "derive_runtime_status",
    "ensure_device",
    "get_alerts",
    "get_connection",
    "get_device",
    "get_device_telemetry",
    "get_devices",
    "init_db",
    "insert_telemetry",
    "mark_sheets_failed",
    "mark_sheets_retry",
    "mark_sheets_sent",
    "normalize_zone",
    "pending_sheets_count",
    "purge_old_telemetry",
    "reconcile_alert",
    "row_to_dict",
    "serialize_device_row",
    "thresholds_for",
    "update_device_status",
    "utc_now",
]
