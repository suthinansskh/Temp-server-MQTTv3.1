from __future__ import annotations

import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.request

from . import database, settings

logger = logging.getLogger("sheets-sync")
MAX_RETRIES = 10


class SheetsSyncWorker:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._ctx = ssl.create_default_context()

    @property
    def enabled(self) -> bool:
        return bool(settings.GAS_URL)

    def start(self) -> None:
        if not self.enabled:
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="sheets-sync", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            batch = database.dequeue_sheets_batch(settings.SHEETS_SYNC_BATCH_SIZE)
            if not batch:
                self._stop.wait(settings.SHEETS_SYNC_INTERVAL_SECONDS)
                continue
            for row in batch:
                queue_id = int(row["id"])
                retry_count = int(row["retry_count"] or 0)
                if retry_count >= MAX_RETRIES:
                    database.mark_sheets_failed(queue_id)
                    logger.warning("Queue %d exceeded max retries, marked failed", queue_id)
                    continue
                try:
                    payload = row["payload_json"]
                    request = urllib.request.Request(
                        settings.GAS_URL,
                        data=payload.encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(request, context=self._ctx, timeout=20) as response:
                        response.read()
                    database.mark_sheets_sent(queue_id)
                except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                    database.mark_sheets_retry(queue_id, str(exc))
                    backoff = min(2 ** retry_count, 60)
                    logger.warning("Sheets sync retry %d for queue %d: %s (backoff %ds)", retry_count + 1, queue_id, exc, backoff)
                    self._stop.wait(backoff)
            # Short pause between batches when draining backlog, longer when idle
            self._stop.wait(2)