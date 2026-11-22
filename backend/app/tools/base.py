from dataclasses import dataclass
from typing import Any, Callable

TOOL_ERROR_CODES = {
    "forbidden_path",
    "forbidden_target",
    "not_found",
    "binary_file",
    "too_large",
    "timeout",
    "invalid_args",
    "unavailable",
}


class ToolError(Exception):
    """Erro esperado de uma ferramenta; a mensagem é segura para o modelo."""

    def __init__(self, code: str, message: str):
        if code not in TOOL_ERROR_CODES:
            raise ValueError(f"código de erro desconhecido: {code}")
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., dict[str, Any]]
    family: str

    def openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }
