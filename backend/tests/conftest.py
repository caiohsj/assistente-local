import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db import init_db
from app.llm import get_llm
from app.main import app, get_registry
from app.tools import build_registry


class FakeCompletions:
    def __init__(self):
        self.responses: list = []
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        # Copia as mensagens para o registro não mudar quando o agente acrescenta
        # tool calls ao longo do loop.
        self.calls.append(
            {**kwargs, "messages": [dict(message) for message in kwargs["messages"]]}
        )
        if not self.responses:
            raise RuntimeError("fake sem respostas")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeModels:
    def __init__(self):
        self.data: list = []
        self.error: Exception | None = None

    async def list(self):
        if self.error is not None:
            raise self.error
        return SimpleNamespace(data=self.data)


class FakeLLM:
    def __init__(self):
        self.completions = FakeCompletions()
        self.chat = SimpleNamespace(completions=self.completions)
        self.models = FakeModels()


def make_completion(content: str | None = None, tool_calls: list | None = None):
    message = SimpleNamespace(content=content, tool_calls=tool_calls or [])
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def make_tool_call(name: str, arguments: dict | str | None = None, call_id: str = "call-1"):
    raw = arguments if isinstance(arguments, str) else json.dumps(arguments or {})
    return SimpleNamespace(
        id=call_id,
        type="function",
        function=SimpleNamespace(name=name, arguments=raw),
    )


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "assistant.sqlite3"))
    monkeypatch.setattr(settings, "tools_enabled", False)
    monkeypatch.setattr(settings, "tool_read_roots", "")
    # A família apps liga junto com tools_enabled; zera as chaves para os testes
    # não herdarem valores de um .env local.
    monkeypatch.setattr(settings, "tool_open_url_command", "xdg-open")
    monkeypatch.setattr(settings, "tool_open_url_domains", "")
    monkeypatch.setattr(settings, "tool_open_url_max_chars", 2048)
    monkeypatch.setattr(
        settings,
        "tool_open_app_aliases",
        "terminal=x-terminal-emulator|gnome-terminal|konsole|alacritty|kitty|xterm",
    )
    monkeypatch.setattr(settings, "tool_open_app_deny", "")
    init_db()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def fake_llm():
    return FakeLLM()


@pytest.fixture
def client(isolated_db, fake_llm):
    app.dependency_overrides[get_llm] = lambda: fake_llm
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def tool_client(isolated_db, tmp_path, monkeypatch, fake_llm):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(settings, "tools_enabled", True)
    monkeypatch.setattr(settings, "tool_read_roots", str(root))
    registry = build_registry(settings)
    app.dependency_overrides[get_llm] = lambda: fake_llm
    app.dependency_overrides[get_registry] = lambda: registry
    with TestClient(app) as test_client:
        yield test_client, fake_llm, registry, root
    app.dependency_overrides.clear()
