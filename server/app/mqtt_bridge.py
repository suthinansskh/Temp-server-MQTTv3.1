from __future__ import annotations

import json
import logging
import ssl
import threading
from typing import Any

import paho.mqtt.client as mqtt

from . import database, settings
from .realtime import RealtimeHub

logger = logging.getLogger("mqtt-bridge")


class MqttIngestService:
    def __init__(self, hub: RealtimeHub) -> None:
        self._hub = hub
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=settings.MQTT_CLIENT_ID)
        if settings.MQTT_TLS:
            self._client.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
        if settings.MQTT_USERNAME:
            self._client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        self._thread: threading.Thread | None = None
        self._stopped = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stopped.clear()
        self._thread = threading.Thread(target=self._run, name="mqtt-ingest", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        try:
            self._client.disconnect()
        except Exception:
            pass

    def _run(self) -> None:
        backoff = 1
        while not self._stopped.is_set():
            try:
                self._client.connect(settings.MQTT_HOST, settings.MQTT_PORT, 60)
                backoff = 1
                self._client.loop_forever(retry_first_connection=True)
            except Exception:
                if self._stopped.wait(backoff):
                    break
                backoff = min(backoff * 2, 300)

    def _on_connect(self, client: mqtt.Client, userdata: Any, flags: Any, rc: int, properties: Any = None) -> None:
        if rc != 0:
            return
        for topic, qos in settings.MQTT_SUBSCRIPTIONS:
            client.subscribe(topic, qos)

    def _on_message(self, client: mqtt.Client, userdata: Any, message: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except Exception:
            logger.warning("Invalid JSON on %s", message.topic)
            return
        kind, device_id = self._classify_topic(message.topic)
        if not kind or not device_id:
            return
        if kind == "ip":
            device = database.update_device_status(device_id, True, payload)
            if device:
                self._hub.broadcast_from_thread({"type": "status", "device": device})
            return
        if kind == "telemetry":
            normalized = self._normalize_telemetry(device_id, payload)
            if normalized is None:
                return
            device = database.insert_telemetry(normalized)
            if device:
                self._hub.broadcast_from_thread({"type": "telemetry", "device": device})
            return
        if kind == "status":
            online = payload.get("status", "online") != "offline" and bool(payload.get("online", True))
            device = database.update_device_status(device_id, online, payload)
            if device:
                self._hub.broadcast_from_thread({"type": "status", "device": device})

    def _classify_topic(self, topic: str) -> tuple[str | None, str | None]:
        parts = topic.split("/")
        # factory/{zone}/temp/{device}  (HiveMQ dashboard format)
        if parts[0] == "factory" and len(parts) >= 4 and parts[2] == "temp":
            device_id = f"{parts[1]}/{parts[3]}"
            return "telemetry", device_id
        # factory/{zone}/ip/{device}  (IP announcement from ESP)
        if parts[0] == "factory" and len(parts) >= 4 and parts[2] == "ip":
            device_id = f"{parts[1]}/{parts[3]}"
            return "ip", device_id
        if parts[:2] == ["hospital", "temp"] and len(parts) >= 3:
            return "telemetry", parts[2]
        if parts[:2] == ["hospital", "status"] and len(parts) >= 3:
            return "status", parts[2]
        if parts[:2] == ["hospital", "devices"] and len(parts) >= 4:
            device_id = parts[2]
            if parts[3] == "telemetry":
                return "telemetry", device_id
            if parts[3] in {"status", "event"}:
                return "status", device_id
        return None, None

    def _normalize_telemetry(self, device_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        raw_temp = payload.get("temp_c", payload.get("t", payload.get("temp")))
        if raw_temp is None:
            return None
        try:
            temp_c = float(raw_temp)
        except (TypeError, ValueError):
            return None
        return {
            "device_id": payload.get("device_id", payload.get("id", device_id)),
            "name": payload.get("name", payload.get("n", device_id)),
            "zone": payload.get("zone", payload.get("z", "UNASSIGNED")),
            "temp_c": temp_c,
            "sensor_ok": payload.get("sensor_ok", temp_c not in (-127.0, 85.0)),
            "ip": payload.get("ip", ""),
            "rssi": payload.get("rssi"),
            "uptime_s": payload.get("uptime_s"),
            "fw_version": payload.get("fw_version", ""),
            "ts_device": payload.get("ts_device"),
        }