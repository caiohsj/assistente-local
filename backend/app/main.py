import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI

from .agent import execute_tool, run_agent
from .config import settings
from .db import add_message, database_ok, init_db, recent_messages
from .llm import close_llm, get_llm
from .schemas import ChatRequest, ChatResponse, ToolInvokeRequest
from .tools import ToolRegistry, build_registry

logger = logging.getLogger(__name__)

MODEL_ERROR_REPLY = (
    "Não foi possível consultar o modelo local. "
    "A pergunta foi registrada; tente novamente em instantes."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.registry = build_registry(settings)
    yield
    await close_llm()


app = FastAPI(title="Assistente Local API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_registry(request: Request) -> ToolRegistry:
    registry = getattr(request.app.state, "registry", None)
    if registry is None:
        registry = build_registry(settings)
        request.app.state.registry = registry
    return registry


@app.get("/health")
async def health(
    llm: AsyncOpenAI = Depends(get_llm),
    registry: ToolRegistry = Depends(get_registry),
):
    database = "ok" if database_ok() else "error"

    model_available = False
    model_match = "none"
    reported: list[str] = []
    model_error = None
    try:
        models = await asyncio.wait_for(llm.models.list(), timeout=3.0)
        reported = [model.id for model in models.data]
        aliases = {
            alias
            for model in models.data
            for alias in (getattr(model, "aliases", None) or [])
        }
        if settings.llama_model in set(reported) | aliases:
            model_available = True
            model_match = "alias"
        elif len(models.data) == 1:
            # llama-server com um único modelo aceita o alias configurado mesmo
            # quando /v1/models reporta apenas o nome do arquivo.
            model_available = True
            model_match = "single_model"
    except Exception as exc:  # detalhe fica no log, resposta é genérica
        logger.warning("Falha ao consultar o modelo local: %s", exc)
        model_error = "modelo local indisponível"

    return {
        "backend": "ok",
        "llama_server": "reachable" if model_error is None else "unavailable",
        "database": database,
        "configured_model": settings.llama_model,
        "model_available": model_available,
        "model_match": model_match,
        "models_reported_by_server": reported,
        "model_error": model_error,
        "tools": {
            "enabled": registry.enabled,
            "files": registry.file_family_enabled,
            "system": registry.system_family_enabled,
            "apps": registry.apps_family_enabled,
            "roots": len(settings.read_roots_list) if registry.file_family_enabled else 0,
            "count": len(registry.tools),
        },
    }


@app.get("/history")
def history(limit: int = Query(default=100, ge=1, le=500)):
    return {"messages": recent_messages(limit, include_errors=True)}


@app.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    llm: AsyncOpenAI = Depends(get_llm),
    registry: ToolRegistry = Depends(get_registry),
):
    add_message("user", payload.message)
    history = recent_messages(settings.max_history_messages, include_errors=False)
    try:
        result = await run_agent(llm, registry, history, settings)
    except Exception:
        logger.exception("Falha ao consultar o modelo local")
        add_message("assistant", MODEL_ERROR_REPLY, error=1)
        raise HTTPException(
            status_code=503,
            detail="Falha ao consultar o modelo local.",
        ) from None

    reply = result.reply.strip() or "Não consegui gerar uma resposta."
    add_message("assistant", reply)
    return ChatResponse(
        reply=reply,
        model=settings.llama_model,
        tool_calls=result.tool_calls,
    )


@app.get("/tools")
def tools(registry: ToolRegistry = Depends(get_registry)):
    return registry.describe()


@app.post("/tools/{name}")
async def invoke_tool(
    name: str,
    payload: ToolInvokeRequest,
    registry: ToolRegistry = Depends(get_registry),
):
    if not registry.enabled:
        raise HTTPException(status_code=403, detail="Ferramentas desabilitadas.")
    if registry.get(name) is None:
        raise HTTPException(status_code=404, detail="Ferramenta não encontrada.")

    summary, result = await execute_tool(registry, name, payload.args, settings)
    return JSONResponse(
        status_code=200 if result.get("ok") else 400,
        content={
            "ok": bool(result.get("ok")),
            "tool": name,
            "result": result.get("result"),
            "error": result.get("error"),
            "duration_ms": summary.duration_ms,
            "result_chars": summary.result_chars,
        },
    )
