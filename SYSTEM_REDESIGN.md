# IoT System Redesign

## Goal

Redesign the current temperature monitoring system to be simpler, more reliable, and easier to maintain using:

- ESP8266
- DS18B20
- MQTT broker
- Dashboard server
- SQLite database
- Google Sheets

## Current State

From the existing project:

- ESP8266 firmware publishes temperature via MQTT.
- A Python bridge forwards MQTT data to Google Sheets.
- The dashboard connects directly to MQTT from the browser.
- Google Apps Script is being used as both ingestion and reporting logic.
- SQLite is not yet the main data store.

## Main Problems In The Current Design

1. Browser dashboard connects directly to MQTT.
   - Broker address and credentials are exposed to the client.
   - UI becomes tightly coupled to broker availability.
   - Access control is hard to manage.

2. Google Sheets is being used too close to the ingestion path.
   - Sheets is slow compared to MQTT and local database writes.
   - It is not suitable as the primary operational datastore.
   - Large history queries will become expensive and fragile.

3. Ingestion and storage are not centralized enough.
   - Data flows from MQTT to Sheets, but there is no proper backend source of truth.
   - Alert logic, stale detection, and reporting are split across several places.

4. Device responsibilities are too broad.
   - Firmware currently includes device web UI and operational dashboard concerns.
   - Device should focus on sensing, connectivity, local config, and MQTT.

## Recommended Target Architecture

Use this data flow:

ESP8266 + DS18B20
-> MQTT Broker
-> Backend Ingestion Service
-> SQLite
-> Dashboard API / WebSocket
-> Web Dashboard
-> Google Sheets Sync Worker

### Design Principle

- MQTT is the transport layer.
- SQLite is the operational source of truth.
- Dashboard reads from backend API, not directly from MQTT.
- Google Sheets is only for reporting, backup visibility, and office workflows.

## Recommended Components

### 1. Device Layer: ESP8266 + DS18B20

Device responsibilities:

- Read DS18B20 temperature on schedule.
- Publish telemetry to MQTT.
- Publish device health/status.
- Support Wi-Fi provisioning and local maintenance page.
- Support OTA.
- Buffer a small number of unsent samples when Wi-Fi drops.

Device should not:

- Post directly to Google Sheets.
- Act as the primary dashboard host for fleet monitoring.
- Contain business reporting logic.

Recommended publish interval:

- Telemetry every 30 to 60 seconds for live monitoring.
- Heartbeat/status every 60 to 120 seconds.
- Immediate event publish on alarm transitions.

Recommended payload:

```json
{
  "device_id": "fridge-icu-01",
  "name": "ICU Vaccine Fridge 1",
  "zone": "ICU",
  "temp_c": 4.62,
  "sensor_ok": true,
  "rssi": -67,
  "uptime_s": 81234,
  "fw_version": "6.0.0",
  "ts_device": 1712550000
}
```

Recommended status payload:

```json
{
  "device_id": "fridge-icu-01",
  "online": true,
  "ip": "10.10.12.53",
  "heap": 28640,
  "wifi_ssid": "Hospital-IoT",
  "last_boot_reason": "power_on"
}
```

### 2. MQTT Broker

Use Mosquitto or EMQX.

Recommended topic structure:

- `hospital/devices/{device_id}/telemetry`
- `hospital/devices/{device_id}/status`
- `hospital/devices/{device_id}/event`
- `hospital/devices/{device_id}/command`
- `hospital/devices/{device_id}/config`

Topic rules:

- Telemetry: QoS 1, not retained.
- Status: QoS 1, retained.
- Command: QoS 1.
- Device online/offline: use Last Will and Testament.

Security:

- Separate users for devices, backend, and dashboard.
- Do not let browser clients connect with broker credentials.
- Restrict device publish/subscribe permissions by topic prefix.

### 3. Backend Ingestion Service

Recommended stack:

- Python FastAPI
- paho-mqtt or gmqtt
- SQLite with WAL mode
- Background worker for alerts and Google Sheets sync

Backend responsibilities:

- Subscribe to MQTT topics.
- Validate payloads.
- Normalize and write data to SQLite.
- Maintain latest device state.
- Detect stale devices and alert conditions.
- Expose REST API for dashboard.
- Expose WebSocket or Server-Sent Events for live updates.
- Queue selected records for Google Sheets sync.

This backend becomes the single operational core.

### 4. SQLite Database

SQLite is a good fit if:

- The system is on one server.
- Write rate is moderate.
- You want low maintenance.

Recommended tables:

#### `devices`

- `id` text primary key
- `name` text
- `zone` text
- `location` text
- `min_temp` real
- `max_temp` real
- `enabled` integer
- `created_at` datetime
- `updated_at` datetime

#### `telemetry`

- `id` integer primary key
- `device_id` text
- `temp_c` real
- `sensor_ok` integer
- `rssi` integer
- `uptime_s` integer
- `ts_device` datetime nullable
- `ts_server` datetime not null

Indexes:

- `(device_id, ts_server desc)`
- `(ts_server desc)`

#### `device_state`

- `device_id` text primary key
- `last_temp_c` real
- `last_seen_at` datetime
- `online` integer
- `sensor_ok` integer
- `rssi` integer
- `ip` text
- `fw_version` text
- `status` text
- `alert_state` text

#### `alerts`

- `id` integer primary key
- `device_id` text
- `alert_type` text
- `severity` text
- `message` text
- `started_at` datetime
- `ended_at` datetime nullable
- `ack_by` text nullable
- `ack_at` datetime nullable

#### `sheets_sync_queue`

- `id` integer primary key
- `telemetry_id` integer
- `payload_json` text
- `status` text
- `retry_count` integer
- `last_error` text nullable
- `created_at` datetime
- `sent_at` datetime nullable

SQLite settings:

- Enable WAL mode.
- Use periodic backups.
- Use retention rules for raw telemetry, for example 90 to 180 days.
- Aggregate old data into hourly summaries if needed.

### 5. Dashboard Server

Recommended dashboard architecture:

- Frontend calls backend API.
- Live updates come from backend WebSocket or SSE.
- Browser never connects directly to MQTT.

Dashboard views:

- Overview cards: total devices, online, warning, critical, stale.
- Device grid: current temp, zone, last seen, alert state.
- Device detail page: live temp, 24h chart, 7d chart, RSSI, uptime, sensor health.
- Alert page: open alerts, acknowledged alerts, closed alerts.
- Admin page: threshold config, device metadata, Google Sheets sync status.

Recommended API examples:

- `GET /api/devices`
- `GET /api/devices/{id}`
- `GET /api/devices/{id}/telemetry?range=24h`
- `GET /api/alerts?status=open`
- `POST /api/alerts/{id}/ack`
- `GET /api/system/health`

### 6. Google Sheets Integration

Use Google Sheets only as a downstream export layer.

Recommended flow:

- Backend writes telemetry to SQLite first.
- A sync worker periodically pushes selected rows to Google Sheets.
- If Sheets is unavailable, data stays safe in SQLite and retries later.

Do not make Sheets the real-time operational backend.

Recommended Sheets usage:

- Daily summary
- Monthly summary
- Audit sharing with non-technical staff
- Quick office reporting

## Recommended Alert Logic

Per device define:

- `min_temp`
- `max_temp`
- `warn_margin`
- `stale_after_sec`
- `offline_after_sec`

States:

- `ok`
- `warn`
- `critical`
- `stale`
- `offline`
- `sensor_fault`

Rules:

- `warn` when temperature approaches threshold margin.
- `critical` when outside min/max beyond debounce period.
- `stale` when no telemetry for 2 to 3 minutes.
- `offline` when no heartbeat for 5 minutes.
- `sensor_fault` when DS18B20 invalid or repeated CRC failure.

Add debounce to avoid alert flapping:

- Example: require 2 or 3 consecutive bad readings before opening a critical alert.

## Recommended Firmware Simplification

For ESP8266 firmware, keep these modules:

- `wifi_manager`
- `sensor_service`
- `mqtt_service`
- `config_store`
- `ota_service`
- `health_service`

Reduce these responsibilities:

- Remove direct cloud posting.
- Keep only a lightweight local config page on device.
- Keep a tiny JSON status endpoint for maintenance.

Recommended firmware message behavior:

- Publish telemetry payload to one topic.
- Publish retained status payload to one topic.
- Publish boot event after restart.
- Publish sensor fault event when sensor invalid.

## Recommended Migration Path

### Phase 1: Stabilize Current System

- Keep existing MQTT broker.
- Keep existing ESP publish flow.
- Add backend service that subscribes to MQTT and stores to SQLite.
- Keep Google Sheets bridge temporarily.

### Phase 2: Move Dashboard To Backend API

- Change dashboard to load from backend API.
- Remove direct browser MQTT connection.
- Use WebSocket or SSE from backend for live updates.

### Phase 3: Move Google Sheets Behind Queue

- Stop writing directly from MQTT to Apps Script.
- Sync from SQLite to Sheets in background.
- Add retry queue and sync status.

### Phase 4: Clean Firmware Responsibilities

- Remove legacy direct Sheets settings from device config.
- Keep only MQTT, Wi-Fi, OTA, and local maintenance UI.

## Best Practical Deployment

If you want a low-maintenance deployment on one machine:

- Mosquitto broker
- FastAPI backend service
- SQLite database file
- Nginx reverse proxy
- Static dashboard served by backend or Nginx
- Separate worker thread/process for Sheets sync

Suggested service layout:

- `mosquitto`
- `iot-backend`
- `iot-dashboard`
- `iot-sheets-sync`

## Recommended Folder Structure

```text
server/
  app/
    main.py
    api/
    mqtt/
    services/
    db/
    models/
    schemas/
    workers/
  dashboard/
  data/
    iot.sqlite3
```

## Concrete Recommendation For This Project

For this repository, the best redesign is:

1. Keep ESP8266 as MQTT sensor node.
2. Introduce a real backend service as the center of the system.
3. Store all telemetry and device state in SQLite.
4. Change dashboard to read from backend only.
5. Keep Google Sheets as reporting/export only.
6. Move alert logic to backend, not browser or Sheets script.

## What Should Be Removed Or Deprecated

- Direct browser-to-MQTT as the main dashboard data path.
- Google Sheets as the operational datastore.
- Direct cloud posting logic in firmware configuration.
- Business rules duplicated across firmware, dashboard, and Apps Script.

## Priority Order

If only three things are changed first, do these:

1. Build backend ingestion service with SQLite.
2. Move dashboard from MQTT client mode to backend API mode.
3. Convert Google Sheets to async export mode.

## Final Architecture Summary

Use this final model:

- ESP8266 reads DS18B20.
- ESP8266 publishes telemetry and status via MQTT.
- Backend subscribes to MQTT and writes to SQLite.
- Backend evaluates alerts and device state.
- Dashboard reads from backend API and live stream.
- Google Sheets receives delayed synced summaries or selected raw rows.

This is the cleanest architecture for reliability, maintainability, and hospital operations.