import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


DATABASE_PATH = Path(os.environ.get(
    "AI_BODY_SCAN_DATABASE",
    Path(__file__).parent / "data" / "scans.sqlite3",
))


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS scans (
                id TEXT PRIMARY KEY,
                access_token_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                observations TEXT NOT NULL,
                regions TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'submitted',
                doctor_comments TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS scan_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
                view TEXT NOT NULL,
                file_path TEXT NOT NULL,
                media_type TEXT NOT NULL,
                landmarks TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT,
                action TEXT NOT NULL,
                actor_role TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);
            CREATE INDEX IF NOT EXISTS idx_images_scan_id ON scan_images(scan_id);
            """
        )
        columns = {
            column["name"] for column in connection.execute("PRAGMA table_info(scans)").fetchall()
        }
        if "notes" not in columns:
            connection.execute("ALTER TABLE scans ADD COLUMN notes TEXT NOT NULL DEFAULT ''")


def audit(scan_id: str | None, action: str, actor_role: str, created_at: str) -> None:
    with connect() as connection:
        connection.execute(
            "INSERT INTO audit_log (scan_id, action, actor_role, created_at) VALUES (?, ?, ?, ?)",
            (scan_id, action, actor_role, created_at),
        )


def get_scan(scan_id: str) -> dict[str, Any] | None:
    with connect() as connection:
        scan = connection.execute("SELECT * FROM scans WHERE id = ?", (scan_id,)).fetchone()
        if scan is None:
            return None
        result = dict(scan)
        result["images"] = [
            dict(image) for image in connection.execute(
                "SELECT id, view, file_path, media_type, landmarks FROM scan_images WHERE scan_id = ? ORDER BY id",
                (scan_id,),
            ).fetchall()
        ]
        return result
