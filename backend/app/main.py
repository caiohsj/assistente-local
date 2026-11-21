from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

from .config import settings
from .db import init_db, add_message, recent_messages
from .schemas import ChatRequest, ChatResponse

client = AsyncOpenAI(
    base_url=settings.llama_base_url,
    api_key=settings.llama_api_key,
    timeout=180.0,
)

SYSTEM_PROMPT = """Você é um assistente pessoal local, executado no computador do usuário.
Responda em português brasileiro, de forma clara e objetiva.
Não afirme que executou ações, consultou arquivos ou acessou serviços se isso não ocorreu.
Nesta versão você só conversa; não possui autorização para executar comandos no sistema.
Quando uma solicitação exigir uma ferramenta ainda não implementada, explique isso honestamente.
Preserve privacidade: não solicite senhas, tokens ou dados desnecessários.
"""

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="Assistente Local API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    try:
        models = await client.models.list()
        return {
            "backend": "ok",
            "llama_server": "reachable",
            "configured_model": settings.llama_model,
            "models_reported_by_server": [m.id for m in models.data],
        }
    except Exception as exc:
        return {
            "backend": "ok",
            "llama_server": "unavailable",
            "configured_model": settings.llama_model,
            "error": str(exc),
        }

@app.get("/history")
def history():
    return {"messages": recent_messages(100)}

@app.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    add_message("user", payload.message)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(recent_messages(settings.max_history_messages))
    try:
        result = await client.chat.completions.create(
            model=settings.llama_model,
            messages=messages,
            temperature=0.6,
            max_tokens=900,
        )
        reply = result.choices[0].message.content or ""
        add_message("assistant", reply)
        return ChatResponse(reply=reply, model=settings.llama_model)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao consultar o modelo local: {exc}"
        ) from exc
