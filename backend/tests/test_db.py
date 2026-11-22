import sqlite3

from app import db
from app.config import settings


def test_init_db_migrates_legacy_messages_table(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.sqlite3"
    monkeypatch.setattr(settings, "db_path", str(db_path))
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute("INSERT INTO messages(role, content) VALUES ('user', 'antiga')")
    conn.commit()
    conn.close()

    db.init_db()
    db.init_db()  # idempotente

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
    assert "error" in columns
    error = conn.execute("SELECT error FROM messages").fetchone()[0]
    assert error == 0
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "tool_calls" in tables
    conn.close()


def test_add_message_returns_id_and_created_at(isolated_db):
    first = db.add_message("user", "olá")
    second = db.add_message("assistant", "oi")
    assert first["id"] == 1
    assert second["id"] == 2
    assert first["created_at"]
    assert second["created_at"]


def test_recent_messages_excludes_errors_by_default(isolated_db):
    db.add_message("user", "pergunta")
    db.add_message("assistant", "falhou", error=1)
    db.add_message("assistant", "resposta")

    visible = db.recent_messages(10)
    assert [item["content"] for item in visible] == ["pergunta", "resposta"]
    assert all(item["error"] == 0 for item in visible)

    everything = db.recent_messages(10, include_errors=True)
    assert [item["content"] for item in everything] == ["pergunta", "falhou", "resposta"]


def test_database_ok_detects_broken_path(isolated_db, tmp_path, monkeypatch):
    assert db.database_ok() is True
    monkeypatch.setattr(settings, "db_path", str(tmp_path))
    assert db.database_ok() is False
