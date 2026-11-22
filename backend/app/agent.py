import asyncio
import json
import logging
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI

from .config import Settings
from .db import add_tool_call
from .prompts import build_system_prompt
from .schemas import ToolCallSummary
from .tools import ToolError, ToolRegistry
from .tools.apps import audit_arguments

logger = logging.getLogger(__name__)

MAX_AUDIT_ARGS_CHARS = 1000

OPEN_VERBS = (
    "abra",
    "abre",
    "abrir",
    "inicie",
    "iniciar",
    "lance",
    "lançar",
    "lancar",
    "launch",
    "open",
    "start",
)
URL_MARKERS = ("http://", "https://", "www.", "site", "pagina", "link", "url")
FILE_MARKERS = (
    "arquivo",
    "documento",
    "pasta",
    "diretorio",
    ".txt",
    ".pdf",
    ".env",
    "/",
    "~",
    "\\",
)
QUESTION_MARKERS = (
    "voce pode",
    "você pode",
    "consegue",
    "conseguiria",
    "suporta",
    "possivel",
)


def _normalize_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return decomposed.encode("ascii", "ignore").decode("ascii").casefold()


def _forced_open_tool(message: Any, registry: "ToolRegistry") -> str | None:
    """Força a ferramenta de abertura quando o pedido atual é explícito.

    O histórico pode conter respostas antigas dizendo que um app não estava
    instalado. Sem isso, o modelo responde copiando essas mensagens em vez de
    tentar de novo — mesmo depois de a instalação ter mudado.
    """
    if not isinstance(message, str) or not message.strip():
        return None
    text = _normalize_text(message)
    if "?" in text and any(marker in text for marker in QUESTION_MARKERS):
        return None
    if not any(re.search(rf"\b{re.escape(verb)}\b", text) for verb in OPEN_VERBS):
        return None
    if "open_url" in registry.tools and any(marker in text for marker in URL_MARKERS):
        return "open_url"
    if any(marker in text for marker in FILE_MARKERS):
        return None
    if "open_app" in registry.tools:
        return "open_app"
    return None


@dataclass
class AgentResult:
    reply: str
    tool_calls: list[ToolCallSummary]


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…(resultado truncado)"


def _summary_for(name: str, arguments: dict, payload: dict) -> str:
    if not payload.get("ok"):
        code = payload.get("error", {}).get("code", "erro")
        return f"falhou: {code}"
    result = payload.get("result") or {}
    if name == "get_system_info":
        return "CPU/RAM/GPU"
    if name == "get_disk_usage":
        return "disco"
    if name == "get_current_datetime":
        return "data/hora"
    if name == "list_processes":
        return f"{result.get('count', 0)} processos"
    if name == "read_file":
        return f"leu {os.path.basename(str(arguments.get('path', 'arquivo')))}"
    if name == "list_dir":
        return f"listou {result.get('count', 0)} itens"
    if name == "search_text":
        return f"buscou “{arguments.get('query', '')}”"
    if name == "open_app":
        return f"abriu {result.get('app') or arguments.get('app', 'aplicativo')}"
    if name == "open_url":
        return f"abriu {result.get('host') or 'site'}"
    return name


async def execute_tool(
    registry: ToolRegistry,
    name: str,
    arguments: Any,
    settings: Settings,
) -> tuple[ToolCallSummary, dict]:
    """Executa uma ferramenta, audita metadados e devolve um payload seguro."""
    started = time.perf_counter()
    audit_args = arguments
    if not isinstance(arguments, dict):
        audit_args = {"_raw": str(arguments)[:MAX_AUDIT_ARGS_CHARS]}
    else:
        # open_url guarda só scheme://host; open_app guarda só o nome pedido.
        audit_args = audit_arguments(name, arguments)

    payload: dict
    error_code: str | None = None
    spec = registry.get(name)
    try:
        if spec is None:
            raise ToolError("unavailable", "Ferramenta desconhecida ou desabilitada.")
        if not isinstance(arguments, dict):
            raise ToolError("invalid_args", "Os argumentos devem ser um objeto JSON.")
        result = await asyncio.to_thread(spec.handler, **arguments)
        payload = {"ok": True, "tool": name, "result": result}
    except ToolError as exc:
        error_code = exc.code
        payload = {
            "ok": False,
            "tool": name,
            "error": {"code": exc.code, "message": exc.message},
        }
    except TypeError:
        error_code = "invalid_args"
        payload = {
            "ok": False,
            "tool": name,
            "error": {
                "code": "invalid_args",
                "message": "Argumentos inválidos para esta ferramenta.",
            },
        }
    except Exception:
        logger.exception("Falha inesperada na ferramenta %s", name)
        error_code = "unavailable"
        payload = {
            "ok": False,
            "tool": name,
            "error": {
                "code": "unavailable",
                "message": "A ferramenta não conseguiu concluir a operação.",
            },
        }

    duration_ms = int((time.perf_counter() - started) * 1000)
    full_text = json.dumps(payload, ensure_ascii=False, default=str)
    try:
        args_json = json.dumps(audit_args, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        args_json = "{}"
    add_tool_call(
        tool=name,
        args_json=args_json[:MAX_AUDIT_ARGS_CHARS],
        ok=bool(payload.get("ok")),
        error_code=error_code,
        duration_ms=duration_ms,
        result_chars=len(full_text),
    )

    summary = ToolCallSummary(
        tool=name,
        summary=_summary_for(name, audit_args if isinstance(audit_args, dict) else {}, payload),
        ok=bool(payload.get("ok")),
        error_code=error_code,
        duration_ms=duration_ms,
        result_chars=len(full_text),
    )
    return summary, payload


def _assistant_message(message: Any, tool_calls: list[Any]) -> dict:
    payload: dict[str, Any] = {
        "role": "assistant",
        "content": getattr(message, "content", None) or "",
        "tool_calls": [
            {
                "id": call.id,
                "type": getattr(call, "type", "function") or "function",
                "function": {
                    "name": call.function.name,
                    "arguments": call.function.arguments,
                },
            }
            for call in tool_calls
        ],
    }
    return payload


async def run_agent(
    llm: AsyncOpenAI,
    registry: ToolRegistry,
    history: list[dict],
    settings: Settings,
) -> AgentResult:
    tools = registry.openai_tools()
    system_message = {"role": "system", "content": build_system_prompt(registry.enabled)}
    current = next(
        (item for item in reversed(history) if item.get("role") == "user"), None
    )
    forced_tool = _forced_open_tool(current.get("content") if current else None, registry)

    if forced_tool and current is not None:
        # Pedidos explícitos de abertura não precisam do histórico: mensagens
        # antigas com falhas levam o modelo a responder sem chamar a ferramenta.
        context = [current]
    else:
        context = history
    messages: list[dict[str, Any]] = [system_message]
    messages.extend({"role": item["role"], "content": item["content"]} for item in context)

    summaries: list[ToolCallSummary] = []
    rounds = 0
    calls = 0

    while True:
        can_call = (
            bool(tools)
            and rounds < settings.agent_max_tool_rounds
            and calls < settings.agent_max_tool_calls
        )
        request: dict[str, Any] = {
            "model": settings.llama_model,
            "messages": messages,
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
        }
        if tools:
            request["tools"] = tools
            # Só força na primeira rodada: nas seguintes o modelo precisa poder
            # responder com o resultado da ferramenta em vez de chamá-la de novo.
            effective_forced = forced_tool if rounds == 0 else None
            if can_call and effective_forced in registry.tools:
                request["tool_choice"] = {
                    "type": "function",
                    "function": {"name": effective_forced},
                }
            else:
                request["tool_choice"] = "auto" if can_call else "none"

        completion = await llm.chat.completions.create(**request)
        message = completion.choices[0].message
        tool_calls = list(getattr(message, "tool_calls", None) or [])

        if not can_call or not tool_calls:
            return AgentResult(reply=message.content or "", tool_calls=summaries)

        messages.append(_assistant_message(message, tool_calls))

        for call in tool_calls:
            if calls >= settings.agent_max_tool_calls:
                # Toda tool_call precisa de uma resposta para manter o histórico válido.
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": json.dumps(
                            {
                                "ok": False,
                                "tool": call.function.name,
                                "error": {
                                    "code": "unavailable",
                                    "message": (
                                        "Limite de chamadas de ferramenta atingido "
                                        "nesta requisição."
                                    ),
                                },
                            },
                            ensure_ascii=False,
                        ),
                    }
                )
                continue

            try:
                arguments = json.loads(call.function.arguments or "{}")
            except (json.JSONDecodeError, TypeError):
                arguments = None
            calls += 1
            summary, payload = await execute_tool(
                registry, call.function.name, arguments, settings
            )
            summaries.append(summary)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": _truncate(
                        json.dumps(payload, ensure_ascii=False, default=str),
                        settings.tool_result_max_chars,
                    ),
                }
            )

        rounds += 1
