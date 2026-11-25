from typing import Any

from pydantic import BaseModel, Field, field_validator


class ChatRequest(BaseModel):
    message: str = Field(max_length=12000)

    @field_validator("message")
    @classmethod
    def strip_and_reject_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("a mensagem não pode estar vazia")
        return value


class SpeakRequest(BaseModel):
    # Limite externo do endpoint; o limite de "resposta falável" é configurável
    # em VOICE_TTS_MAX_CHARS e aplicado no sintetizador.
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def strip_and_reject_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("o texto não pode estar vazio")
        return value


class ToolCallSummary(BaseModel):
    tool: str
    summary: str = ""
    ok: bool
    error_code: str | None = None
    duration_ms: int = 0
    result_chars: int = 0


class ChatResponse(BaseModel):
    reply: str
    model: str
    tool_calls: list[ToolCallSummary] = Field(default_factory=list)


class ToolInvokeRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
