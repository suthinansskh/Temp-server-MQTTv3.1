# Backend Server

This backend is the new system core for the project.

It provides:

- MQTT ingestion
- SQLite storage
- REST API for dashboard
- WebSocket live updates
- Optional Google Sheets sync queue

## Quick Start

1. Create a Python virtual environment.
2. Install dependencies from `server/requirements.txt`.
3. Start the API server with uvicorn.

Example:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r server\requirements.txt
uvicorn server.app.main:app --reload
```

Open:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/api/health`

## Environment Variables

- `IOT_MQTT_HOST`
- `IOT_MQTT_PORT`
- `IOT_MQTT_USERNAME`
- `IOT_MQTT_PASSWORD`
- `IOT_DB_PATH`
- `IOT_GAS_URL`
- `IOT_GAS_API_KEY`

## Current MQTT Compatibility

The backend accepts both topic styles:

- Legacy: `hospital/temp/{device_id}` and `hospital/status/{device_id}`
- Target: `hospital/devices/{device_id}/telemetry` and `hospital/devices/{device_id}/status`

## Notes

- SQLite runs in WAL mode.
- Google Sheets is downstream only and uses the retry queue.
- The dashboard should connect to this backend, not to MQTT directly.