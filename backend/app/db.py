import sqlite3
from pathlib import Path
from .config import settings


def connect():
    path = Path(settings.db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()


def add_message(role: str, content: str):
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages(role, content) VALUES (?, ?)",
            (role, content)
        )
        conn.commit()


def recent_messages(limit: int):
    with connect() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return [dict(row) for row in reversed(rows)]
