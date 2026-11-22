import sqlite3
from contextlib import closing
from pathlib import Path

from .config import settings


def connect() -> sqlite3.Connection:
    path = Path(settings.db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    with closing(connect()) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                error INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        # Migração idempotente para bancos criados antes da coluna error.
        _ensure_column(conn, "messages", "error", "INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                tool TEXT NOT NULL,
                args_json TEXT NOT NULL,
                ok INTEGER NOT NULL,
                error_code TEXT,
                duration_ms INTEGER NOT NULL,
                result_chars INTEGER NOT NULL
            )
            """
        )


def add_message(role: str, content: str, error: int = 0) -> dict:
    with closing(connect()) as conn, conn:
        cursor = conn.execute(
            "INSERT INTO messages(role, content, error) VALUES (?, ?, ?)",
            (role, content, 1 if error else 0),
        )
        row = conn.execute(
            "SELECT id, created_at FROM messages WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return {"id": row["id"], "created_at": row["created_at"]}


def recent_messages(limit: int, include_errors: bool = False) -> list[dict]:
    limit = max(1, int(limit))
    where = "" if include_errors else "WHERE error = 0"
    with closing(connect()) as conn:
        rows = conn.execute(
            f"""
            SELECT id, role, content, error, created_at
            FROM messages
            {where}
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def add_tool_call(
    tool: str,
    args_json: str,
    ok: bool,
    error_code: str | None,
    duration_ms: int,
    result_chars: int,
) -> None:
    """Auditoria sem conteúdo: apenas metadados da chamada."""
    with closing(connect()) as conn, conn:
        conn.execute(
            """
            INSERT INTO tool_calls(tool, args_json, ok, error_code, duration_ms, result_chars)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (tool, args_json, 1 if ok else 0, error_code, duration_ms, result_chars),
        )


def database_ok() -> bool:
    try:
        with closing(connect()) as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except (sqlite3.Error, OSError):
        return False
