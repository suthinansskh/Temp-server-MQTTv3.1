from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")
DB_PATH = Path(os.getenv("IOT_DB_PATH", PROJECT_ROOT / "server" / "data" / "iot.sqlite3"))
DASHBOARD_PATH = PROJECT_ROOT / "dashboard.html"

MQTT_HOST = os.getenv("IOT_MQTT_HOST", "4bdec66bf5984176a4d9eba86f41c7e9.s1.eu.hivemq.cloud")
MQTT_PORT = int(os.getenv("IOT_MQTT_PORT", "8883"))
MQTT_USERNAME = os.getenv("IOT_MQTT_USERNAME", "admin")
MQTT_PASSWORD = os.getenv("IOT_MQTT_PASSWORD", "Admin10700")
MQTT_TLS = os.getenv("IOT_MQTT_TLS", "true").lower() in ("1", "true", "yes")
MQTT_CLIENT_ID = os.getenv("IOT_MQTT_CLIENT_ID", "iot-backend")

MQTT_SUBSCRIPTIONS = [
    ("factory/#", 0),
    ("factory/+/ip/+", 0),
    ("hospital/temp/+", 1),
    ("hospital/status/+", 1),
    ("hospital/devices/+/telemetry", 1),
    ("hospital/devices/+/status", 1),
    ("hospital/devices/+/event", 1),
]

DEFAULT_MIN_TEMP = float(os.getenv("IOT_DEFAULT_MIN_TEMP", "2.0"))
DEFAULT_MAX_TEMP = float(os.getenv("IOT_DEFAULT_MAX_TEMP", "8.0"))
DEFAULT_WARN_MARGIN = float(os.getenv("IOT_DEFAULT_WARN_MARGIN", "0.5"))
STALE_AFTER_SECONDS = int(os.getenv("IOT_STALE_AFTER_SECONDS", "120"))
OFFLINE_AFTER_SECONDS = int(os.getenv("IOT_OFFLINE_AFTER_SECONDS", "300"))

GAS_URL = os.getenv("IOT_GAS_URL", "")
GAS_API_KEY = os.getenv("IOT_GAS_API_KEY", "")
SHEETS_SYNC_INTERVAL_SECONDS = int(os.getenv("IOT_SHEETS_SYNC_INTERVAL_SECONDS", "30"))
SHEETS_SYNC_BATCH_SIZE = int(os.getenv("IOT_SHEETS_SYNC_BATCH_SIZE", "50"))

API_KEY = os.getenv("IOT_API_KEY", "")
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("IOT_ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

DATA_RETENTION_DAYS = int(os.getenv("IOT_DATA_RETENTION_DAYS", "90"))

ZONE_THRESHOLDS = {
    "default": {"min": DEFAULT_MIN_TEMP, "max": DEFAULT_MAX_TEMP, "warn_margin": DEFAULT_WARN_MARGIN},
    "CHEMO": {"min": 2.0, "max": 8.0, "warn_margin": 0.5},
    "FREEZER": {"min": -25.0, "max": -15.0, "warn_margin": 1.0},
}