from __future__ import annotations

import sqlite3

from .connection import get_connection, utc_now


def pending_sheets_count() -> int:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS count FROM sheets_sync_queue WHERE status IN ('pending', 'retry')"
        ).fetchone()
        return int(row["count"])


def dequeue_sheets_batch(limit: int) -> list[sqlite3.Row]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM sheets_sync_queue
            WHERE status IN ('pending', 'retry')
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return rows


def mark_sheets_sent(queue_id: int) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE sheets_sync_queue SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?",
            (utc_now(), queue_id),
        )


def mark_sheets_retry(queue_id: int, error_message: str) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE sheets_sync_queue
            SET status = 'retry', retry_count = retry_count + 1, last_error = ?
            WHERE id = ?
            """,
            (error_message[:500], queue_id),
        )


def mark_sheets_failed(queue_id: int) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE sheets_sync_queue SET status = 'failed' WHERE id = ?",
            (queue_id,),
        )
