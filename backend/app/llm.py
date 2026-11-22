from openai import AsyncOpenAI

from .config import settings

_client: AsyncOpenAI | None = None


def build_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=settings.llama_base_url,
        api_key=settings.llama_api_key,
        timeout=settings.llm_timeout_seconds,
    )


def get_llm() -> AsyncOpenAI:
    """Dependência do FastAPI; permite substituição em testes."""
    global _client
    if _client is None:
        _client = build_client()
    return _client


async def close_llm() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
