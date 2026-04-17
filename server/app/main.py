from __future__ import annotations

import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

import httpx

from . import database, settings
from .mqtt_bridge import MqttIngestService
from .realtime import RealtimeHub
from .sheets_sync import SheetsSyncWorker

logger = logging.getLogger("iot-backend")


hub = RealtimeHub()
mqtt_service = MqttIngestService(hub)
sheets_worker = SheetsSyncWorker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    hub.set_loop(asyncio.get_running_loop())
    mqtt_service.start()
    sheets_worker.start()
    yield
    mqtt_service.stop()
    sheets_worker.stop()


app = FastAPI(title="Sisaket IoT Backend", version="1.0.0", lifespan=lifespan)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info("%s %s %d %.1fms", request.method, request.url.path, response.status_code, elapsed_ms)
        return response


app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=settings.PROJECT_ROOT / "static"), name="static")


def verify_api_key(request: Request) -> None:
    """Optional API key check. Skipped when IOT_API_KEY is not configured."""
    if not settings.API_KEY:
        return
    key = request.headers.get("x-api-key") or request.query_params.get("api_key")
    if not key or not secrets.compare_digest(key, settings.API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(settings.DASHBOARD_PATH)


@app.get("/device.html")
def device_view() -> FileResponse:
    return FileResponse(settings.PROJECT_ROOT / "device.html")


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "mqtt_host": settings.MQTT_HOST,
        "mqtt_port": settings.MQTT_PORT,
        "db_path": str(settings.DB_PATH),
        "pending_sheets": database.pending_sheets_count(),
        "sheets_enabled": sheets_worker.enabled,
        "data_retention_days": settings.DATA_RETENTION_DAYS,
        "auth_enabled": bool(settings.API_KEY),
    }


@app.post("/api/maintenance/purge")
def purge_old_data(days: int = Query(None), _: None = Depends(verify_api_key)) -> dict:
    deleted = database.purge_old_telemetry(days)
    return {"status": "ok", "deleted_rows": deleted}


@app.get("/api/devices")
def list_devices(_: None = Depends(verify_api_key)) -> dict:
    return {"status": "ok", "devices": database.get_devices()}


@app.get("/api/devices/{device_id}")
def get_device(device_id: str, _: None = Depends(verify_api_key)) -> dict:
    device = database.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"status": "ok", "device": device}


@app.get("/api/devices/{device_id}/telemetry")
def get_device_telemetry(device_id: str, range: str = Query("24h"), _: None = Depends(verify_api_key)) -> dict:
    device = database.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    rows = database.get_device_telemetry(device_id, range)
    return {"status": "ok", "device_id": device_id, "range": range, "points": rows}


@app.get("/api/alerts")
def list_alerts(status: str = Query("open"), _: None = Depends(verify_api_key)) -> dict:
    return {"status": "ok", "alerts": database.get_alerts(status)}


@app.post("/api/alerts/{alert_id}/ack")
def acknowledge_alert(alert_id: int, ack_by: str = Query("operator"), _: None = Depends(verify_api_key)) -> dict:
    alert = database.acknowledge_alert(alert_id, ack_by)
    if alert is None:
      raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "ok", "alert": alert}


@app.delete("/api/devices/{device_id}")
def delete_device(device_id: str, _: None = Depends(verify_api_key)) -> dict:
    ok = database.delete_device(device_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Device not found")
    hub.broadcast_from_thread({"type": "device_deleted", "device_id": device_id})
    return {"status": "ok", "device_id": device_id}


@app.get("/api/devices/{device_id}/scan")
async def scan_device_sensors(device_id: str, _: None = Depends(verify_api_key)) -> dict:
    """Proxy scan request to the ESP device's /api/scan endpoint."""
    device = database.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    ip = device.get("ip")
    if not ip:
        raise HTTPException(status_code=400, detail="Device has no IP address")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"http://{ip}/api/scan", auth=("admin", "admin"))
            resp.raise_for_status()
            return {"status": "ok", "device_id": device_id, "scan": resp.json()}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Device {ip} did not respond (timeout)")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach device at {ip}: {exc}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    try:
        await websocket.send_json({"type": "snapshot", "devices": database.get_devices()})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(websocket)
    except Exception as exc:
        logger.debug("WebSocket error: %s", exc)
        hub.disconnect(websocket)