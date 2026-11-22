import json

import pytest

from app.agent import _forced_open_tool, _summary_for, run_agent
from app.config import settings
from app.db import connect
from app.tools import ToolError, ToolRegistry, ToolSpec
from tests.conftest import FakeLLM, make_completion, make_tool_call


def echo_registry():
    registry = ToolRegistry(settings)

    def echo(x: int = 1):
        return {"value": x}

    registry.register(
        ToolSpec(
            name="echo",
            description="Ecoa um valor.",
            parameters={
                "type": "object",
                "properties": {"x": {"type": "integer"}},
                "additionalProperties": False,
            },
            handler=echo,
            family="test",
        )
    )
    return registry


def open_registry():
    registry = ToolRegistry(settings)
    for name in ("open_app", "open_url"):
        registry.register(
            ToolSpec(
                name=name,
                description=f"Teste de {name}.",
                parameters={"type": "object", "properties": {}},
                handler=lambda **kwargs: {"launched": True},
                family="apps",
            )
        )
    return registry


def audit_rows():
    with connect() as conn:
        return [
            dict(row)
            for row in conn.execute(
                "SELECT tool, ok, error_code, duration_ms, result_chars FROM tool_calls"
            ).fetchall()
        ]


@pytest.mark.asyncio
async def test_agent_executes_tool_and_returns_final_reply(isolated_db):
    llm = FakeLLM()
    llm.completions.responses.extend(
        [
            make_completion(tool_calls=[make_tool_call("echo", {"x": 2}, "call-a")]),
            make_completion("pronto"),
        ]
    )

    result = await run_agent(
        llm,
        echo_registry(),
        [{"role": "user", "content": "eco"}],
        settings,
    )

    assert result.reply == "pronto"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].tool == "echo"
    assert result.tool_calls[0].ok is True
    assert result.tool_calls[0].summary == "echo"

    second_request = llm.completions.calls[1]
    tool_messages = [m for m in second_request["messages"] if m["role"] == "tool"]
    assert len(tool_messages) == 1
    assert tool_messages[0]["tool_call_id"] == "call-a"
    assert json.loads(tool_messages[0]["content"])["result"]["value"] == 2
    assert second_request["tool_choice"] == "auto"

    rows = audit_rows()
    assert rows == [
        {
            "tool": "echo",
            "ok": 1,
            "error_code": None,
            "duration_ms": rows[0]["duration_ms"],
            "result_chars": rows[0]["result_chars"],
        }
    ]


@pytest.mark.asyncio
async def test_agent_caps_calls_and_forces_tool_choice_none(isolated_db, monkeypatch):
    monkeypatch.setattr(settings, "agent_max_tool_rounds", 1)
    monkeypatch.setattr(settings, "agent_max_tool_calls", 1)
    llm = FakeLLM()
    llm.completions.responses.extend(
        [
            make_completion(
                tool_calls=[
                    make_tool_call("echo", {"x": 1}, "call-a"),
                    make_tool_call("echo", {"x": 2}, "call-b"),
                ]
            ),
            make_completion("fim"),
        ]
    )

    result = await run_agent(
        llm, echo_registry(), [{"role": "user", "content": "dois ecos"}], settings
    )

    assert result.reply == "fim"
    assert len(result.tool_calls) == 1
    assert llm.completions.calls[1]["tool_choice"] == "none"
    tool_messages = [
        m for m in llm.completions.calls[1]["messages"] if m["role"] == "tool"
    ]
    assert len(tool_messages) == 2
    assert json.loads(tool_messages[1]["content"])["ok"] is False
    assert len(audit_rows()) == 1


@pytest.mark.asyncio
async def test_agent_tool_error_becomes_result(isolated_db):
    registry = ToolRegistry(settings)

    def fail():
        raise ToolError("forbidden_path", "caminho bloqueado")

    registry.register(
        ToolSpec(
            name="fail",
            description="Falha.",
            parameters={"type": "object", "properties": {}},
            handler=fail,
            family="test",
        )
    )
    llm = FakeLLM()
    llm.completions.responses.extend(
        [
            make_completion(tool_calls=[make_tool_call("fail", {}, "call-fail")]),
            make_completion("entendi a recusa"),
        ]
    )

    result = await run_agent(llm, registry, [{"role": "user", "content": "tente"}], settings)
    assert result.tool_calls[0].ok is False
    assert result.tool_calls[0].error_code == "forbidden_path"
    assert result.tool_calls[0].summary == "falhou: forbidden_path"
    tool_message = [
        m for m in llm.completions.calls[1]["messages"] if m["role"] == "tool"
    ][0]
    assert json.loads(tool_message["content"])["error"]["code"] == "forbidden_path"


@pytest.mark.asyncio
async def test_agent_invalid_json_and_unknown_tool(isolated_db):
    llm = FakeLLM()
    llm.completions.responses.extend(
        [
            make_completion(
                tool_calls=[
                    make_tool_call("echo", "{", "call-bad-json"),
                    make_tool_call("nao_existe", {}, "call-unknown"),
                ]
            ),
            make_completion("ok"),
        ]
    )

    result = await run_agent(
        llm, echo_registry(), [{"role": "user", "content": "x"}], settings
    )
    assert [item.error_code for item in result.tool_calls] == [
        "invalid_args",
        "unavailable",
    ]


def test_summary_for_apps_tools():
    assert (
        _summary_for(
            "open_app",
            {"app": "firefox"},
            {"ok": True, "result": {"app": "firefox"}},
        )
        == "abriu firefox"
    )
    assert (
        _summary_for(
            "open_url",
            {"url": "https://example.com"},
            {"ok": True, "result": {"host": "example.com"}},
        )
        == "abriu example.com"
    )
    assert (
        _summary_for(
            "open_app",
            {"app": "nao-existe"},
            {"ok": False, "error": {"code": "not_found"}},
        )
        == "falhou: not_found"
    )


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Abra o Telegram, por favor.", "open_app"),
        ("abra o discord novamente", "open_app"),
        ("ABRA o terminal", "open_app"),
        ("inicie o kitty", "open_app"),
        ("abra https://example.com/x", "open_url"),
        ("Abra o site example.com", "open_url"),
        ("Você pode abrir o Telegram?", None),
        ("abra o arquivo notas.txt", None),
        ("abra /usr/bin/firefox", None),
        ("que horas são?", None),
    ],
)
def test_forced_open_tool_only_for_explicit_open_requests(message, expected):
    assert _forced_open_tool(message, open_registry()) == expected


@pytest.mark.asyncio
async def test_agent_retries_open_app_despite_stale_failure_in_history(isolated_db):
    llm = FakeLLM()
    llm.completions.responses.extend(
        [
            make_completion(
                tool_calls=[make_tool_call("open_app", {"app": "Telegram"}, "call-tg")]
            ),
            make_completion("Aberto."),
        ]
    )
    history = [
        {"role": "user", "content": "Abra o Telegram, por favor."},
        {
            "role": "assistant",
            "content": "O Telegram não está instalado no sistema.",
        },
        {"role": "user", "content": "Abra o Telegram, por favor."},
    ]

    result = await run_agent(llm, open_registry(), history, settings)

    assert result.tool_calls[0].ok is True
    first_request = llm.completions.calls[0]
    assert first_request["tool_choice"] == {
        "type": "function",
        "function": {"name": "open_app"},
    }
    first_messages = first_request["messages"]
    assert first_messages[1] == {
        "role": "user",
        "content": "Abra o Telegram, por favor.",
    }
    # O histórico com a falha antiga não entra no contexto deste pedido.
    assert len(first_messages) == 2
    assert all(m["role"] != "assistant" for m in first_messages)
    assert llm.completions.calls[1]["tool_choice"] == "auto"


@pytest.mark.asyncio
async def test_agent_without_tools_does_not_send_tools(isolated_db):
    llm = FakeLLM()
    llm.completions.responses.append(make_completion("só conversa"))
    result = await run_agent(
        llm,
        ToolRegistry(settings),
        [{"role": "user", "content": "oi"}],
        settings,
    )
    assert result.reply == "só conversa"
    assert result.tool_calls == []
    assert "tools" not in llm.completions.calls[0]
