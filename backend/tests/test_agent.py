import json

import pytest

from app.agent import run_agent
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
