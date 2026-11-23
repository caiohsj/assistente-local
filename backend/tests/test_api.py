from types import SimpleNamespace

import pytest

from app.config import settings
from app.db import connect
from app.tools import build_registry
from tests.conftest import make_completion, make_tool_call


def test_chat_rejects_blank_message(client):
    assert client.post("/chat", json={"message": "   "}).status_code == 422
    assert client.post("/chat", json={"message": ""}).status_code == 422


def test_history_limit_validation(client):
    assert client.get("/history", params={"limit": 0}).status_code == 422
    assert client.get("/history", params={"limit": 501}).status_code == 422
    assert client.get("/history", params={"limit": 1}).status_code == 200


def test_cors_allows_loopback_and_rejects_other_origins(client):
    allowed = client.options(
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"

    denied = client.options(
        "/health",
        headers={
            "Origin": "https://exemplo.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert denied.status_code == 400


def test_cors_allows_tauri_webview_origins(client):
    # Linux/macOS usam tauri://localhost; Windows usa http://tauri.localhost.
    # Nenhuma outra origem pode ser liberada (ver teste loopback acima).
    for origin in ("tauri://localhost", "http://tauri.localhost"):
        response = client.options(
            "/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_lookalike_tauri_origins(client):
    for origin in ("tauri://localhost.evil.com", "http://tauri.localhost.evil.com"):
        response = client.options(
            "/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 400


def test_health_reports_database_and_model(client, fake_llm):
    fake_llm.models.data = [
        SimpleNamespace(id="outro-modelo", aliases=[]),
        SimpleNamespace(id="mais-um", aliases=[]),
    ]
    health = client.get("/health").json()
    assert health["backend"] == "ok"
    assert health["database"] == "ok"
    assert health["model_available"] is False
    assert health["llama_server"] == "reachable"

    fake_llm.models.data = [SimpleNamespace(id="x", aliases=["local-qwen3-4b"])]
    health = client.get("/health").json()
    assert health["model_available"] is True
    assert health["model_match"] == "alias"


def test_health_single_model_fallback(client, fake_llm):
    fake_llm.models.data = [SimpleNamespace(id="Qwen/Qwen3-4B-GGUF:Q4_K_M", aliases=[])]
    health = client.get("/health").json()
    assert health["model_available"] is True
    assert health["model_match"] == "single_model"


def test_health_model_error_is_generic(client, fake_llm):
    fake_llm.models.error = RuntimeError("detalhe secreto do servidor")
    health = client.get("/health").json()
    assert health["llama_server"] == "unavailable"
    assert health["model_available"] is False
    assert "detalhe secreto" not in str(health)


def test_health_database_error(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", str(tmp_path))
    health = client.get("/health").json()
    assert health["database"] == "error"


def test_chat_persists_user_and_assistant(client, fake_llm):
    fake_llm.completions.responses.append(make_completion("Olá!"))
    response = client.post("/chat", json={"message": "  oi  "})
    assert response.status_code == 200
    assert response.json()["reply"] == "Olá!"
    assert response.json()["tool_calls"] == []

    messages = client.get("/history").json()["messages"]
    assert [(item["role"], item["content"]) for item in messages] == [
        ("user", "oi"),
        ("assistant", "Olá!"),
    ]


def test_model_failure_persists_question_and_error_without_orphan(client, fake_llm):
    fake_llm.completions.responses.append(RuntimeError("modelo caiu"))
    response = client.post("/chat", json={"message": "qual a hora?"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Falha ao consultar o modelo local."

    messages = client.get("/history").json()["messages"]
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "qual a hora?"
    assert messages[0]["error"] == 0
    assert messages[1]["role"] == "assistant"
    assert messages[1]["error"] == 1
    assert "modelo caiu" not in messages[1]["content"]

    # A próxima chamada não deve reenviar a linha de erro ao modelo.
    fake_llm.completions.responses.append(make_completion("12:00"))
    assert client.post("/chat", json={"message": "de novo"}).status_code == 200
    sent_messages = fake_llm.completions.calls[-1]["messages"]
    assert all(item["content"] != messages[1]["content"] for item in sent_messages)


def test_tools_endpoint_when_disabled(client):
    data = client.get("/tools").json()
    assert data["enabled"] is False
    assert data["tools"] == []
    assert data["apps"]["enabled"] is False
    assert data["apps"]["aliases"] == {}
    assert client.post("/tools/get_current_datetime", json={"args": {}}).status_code == 403


def test_tools_without_roots_enable_system_and_apps(isolated_db, monkeypatch):
    monkeypatch.setattr(settings, "tools_enabled", True)
    monkeypatch.setattr(settings, "tool_read_roots", "")

    registry = build_registry(settings)
    assert registry.file_family_enabled is False
    assert registry.system_family_enabled is True
    assert registry.apps_family_enabled is True
    assert "read_file" not in registry.tools
    assert "get_system_info" in registry.tools
    assert {"open_app", "open_url"} <= set(registry.tools)


def test_invalid_root_fails_startup(isolated_db, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tools_enabled", True)
    monkeypatch.setattr(settings, "tool_read_roots", str(tmp_path / "nao-existe"))
    with pytest.raises(RuntimeError):
        build_registry(settings)


def test_tool_invoke_and_chat_summary(tool_client):
    client, fake_llm, registry, root = tool_client
    assert registry.enabled is True
    info = client.get("/tools").json()
    assert info["files"]["enabled"] is True
    assert info["system"]["enabled"] is True
    assert info["apps"]["enabled"] is True
    assert info["apps"]["url_command"] == "xdg-open"
    assert "terminal" in info["apps"]["aliases"]
    names = {tool["name"] for tool in info["tools"]}
    assert {"read_file", "get_current_datetime", "open_app", "open_url"} <= names

    health = client.get("/health").json()
    assert health["tools"]["apps"] is True

    direct = client.post("/tools/get_current_datetime", json={"args": {}})
    assert direct.status_code == 200
    assert direct.json()["ok"] is True

    forbidden = client.post("/tools/read_file", json={"args": {"path": ".env"}})
    assert forbidden.status_code == 400
    assert forbidden.json()["error"]["code"] == "forbidden_path"

    fake_llm.completions.responses.append(
        make_completion(tool_calls=[make_tool_call("get_current_datetime")])
    )
    fake_llm.completions.responses.append(make_completion("Agora são 12:00."))
    response = client.post("/chat", json={"message": "que horas são?"})
    assert response.status_code == 200
    calls = response.json()["tool_calls"]
    assert calls[0]["tool"] == "get_current_datetime"
    assert calls[0]["summary"] == "data/hora"
    assert calls[0]["ok"] is True

    with connect() as conn:
        rows = conn.execute(
            "SELECT tool, ok, error_code, result_chars FROM tool_calls ORDER BY id"
        ).fetchall()
    assert len(rows) == 3  # debug, recusa e chat
    assert all(row["tool"] in {"get_current_datetime", "read_file"} for row in rows)
    assert all(row["result_chars"] > 0 for row in rows)
