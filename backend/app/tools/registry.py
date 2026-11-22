from functools import partial
from typing import Any

from ..config import Settings
from .apps import open_app, open_url
from .base import ToolSpec
from .files import list_dir, read_file, search_text
from .paths import validate_roots
from .system import (
    get_current_datetime,
    get_disk_usage,
    get_system_info,
    list_processes,
)


class ToolRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._tools: dict[str, ToolSpec] = {}
        self.file_family_enabled = False
        self.system_family_enabled = False
        self.apps_family_enabled = False

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"ferramenta duplicada: {spec.name}")
        self._tools[spec.name] = spec

    @property
    def enabled(self) -> bool:
        return bool(self._tools)

    @property
    def tools(self) -> dict[str, ToolSpec]:
        return dict(self._tools)

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def openai_tools(self) -> list[dict[str, Any]]:
        return [spec.openai_schema() for spec in self._tools.values()]

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "files": {
                "enabled": self.file_family_enabled,
                "roots": self.settings.read_roots_list if self.file_family_enabled else [],
                "deny_globs": self.settings.deny_globs_list if self.file_family_enabled else [],
                "max_file_bytes": self.settings.tool_max_file_bytes,
                "max_entries": self.settings.tool_max_entries,
                "max_results": self.settings.tool_max_results,
            },
            "system": {
                "enabled": self.system_family_enabled,
                "gpu_query_timeout_seconds": self.settings.gpu_query_timeout_seconds,
                "process_list_default_limit": self.settings.process_list_default_limit,
                "process_list_max_limit": self.settings.process_list_max_limit,
            },
            "apps": {
                "enabled": self.apps_family_enabled,
                "aliases": (
                    self.settings.open_app_aliases_map
                    if self.apps_family_enabled
                    else {}
                ),
                "deny": (
                    self.settings.open_app_deny_list
                    if self.apps_family_enabled
                    else []
                ),
                "url_domains": (
                    self.settings.open_url_domains_list
                    if self.apps_family_enabled
                    else []
                ),
                "url_max_chars": self.settings.tool_open_url_max_chars,
                "url_command": self.settings.tool_open_url_command,
            },
            "agent": {
                "max_tool_rounds": self.settings.agent_max_tool_rounds,
                "max_tool_calls": self.settings.agent_max_tool_calls,
                "result_max_chars": self.settings.tool_result_max_chars,
            },
            "tools": [
                {
                    "name": spec.name,
                    "family": spec.family,
                    "description": spec.description,
                }
                for spec in self._tools.values()
            ],
        }


def _register_files(registry: ToolRegistry, settings: Settings) -> None:
    registry.register(
        ToolSpec(
            name="list_dir",
            family="files",
            description=(
                "Lista nomes, tipos e tamanhos do conteúdo de um diretório autorizado, "
                "sem recursão."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Caminho do diretório. Padrão: '.'.",
                    }
                },
                "additionalProperties": False,
            },
            handler=partial(list_dir, settings=settings),
        )
    )
    registry.register(
        ToolSpec(
            name="read_file",
            family="files",
            description=(
                "Lê um arquivo de texto dentro das raízes autorizadas. Retorna no máximo "
                "200 linhas por padrão e sinaliza truncamento."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Caminho do arquivo."},
                    "start_line": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Primeira linha a retornar. Padrão: 1.",
                    },
                    "max_lines": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 1000,
                        "description": "Quantidade máxima de linhas. Padrão: 200.",
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
            handler=partial(read_file, settings=settings),
        )
    )
    registry.register(
        ToolSpec(
            name="search_text",
            family="files",
            description=(
                "Busca texto literal, sem diferenciar maiúsculas de minúsculas, em arquivos "
                "de texto dentro de um caminho autorizado."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Texto literal a buscar."},
                    "path": {
                        "type": "string",
                        "description": "Arquivo ou diretório inicial. Padrão: '.'.",
                    },
                    "glob": {
                        "type": "string",
                        "description": "Filtro de nome de arquivo, como '*.py'. Padrão: '*'.",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            handler=partial(search_text, settings=settings),
        )
    )
    registry.file_family_enabled = True


def _register_system(registry: ToolRegistry, settings: Settings) -> None:
    registry.register(
        ToolSpec(
            name="get_system_info",
            family="system",
            description=(
                "Consulta uso de CPU, memória, swap, load average e GPUs NVIDIA "
                "(quando disponíveis)."
            ),
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            handler=partial(get_system_info, settings=settings),
        )
    )
    registry.register(
        ToolSpec(
            name="get_disk_usage",
            family="system",
            description="Consulta espaço total, usado, livre e percentual das montagens locais.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            handler=partial(get_disk_usage, settings=settings),
        )
    )
    registry.register(
        ToolSpec(
            name="list_processes",
            family="system",
            description=(
                "Lista processos com PID, nome, usuário, status, CPU e memória. "
                "Não retorna a linha de comando."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "sort_by": {
                        "type": "string",
                        "enum": ["cpu", "memory"],
                        "description": "Critério de ordenação. Padrão: 'cpu'.",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Quantidade de processos. Padrão: configuração do servidor.",
                    },
                },
                "additionalProperties": False,
            },
            handler=partial(list_processes, settings=settings),
        )
    )
    registry.register(
        ToolSpec(
            name="get_current_datetime",
            family="system",
            description="Retorna data e hora locais, UTC, fuso horário e offset.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            handler=partial(get_current_datetime, settings=settings),
        )
    )
    registry.system_family_enabled = True


def _register_apps(registry: ToolRegistry, settings: Settings) -> None:
    registry.register(
        ToolSpec(
            name="open_app",
            family="apps",
            description=(
                "Abre um aplicativo instalado pelo nome do executável (por exemplo, "
                "'firefox' ou 'code') ou pelo nome/ID de um app Flatpak. Aceita apenas "
                "o nome, sem caminho nem argumentos. O processo é iniciado em segundo plano."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "Nome simples do executável, sem caminho nem opções.",
                    }
                },
                "required": ["app"],
                "additionalProperties": False,
            },
            handler=partial(open_app, settings=settings),
        )
    )
    registry.register(
        ToolSpec(
            name="open_url",
            family="apps",
            description=(
                "Abre uma URL http ou https no navegador padrão. Abrir um site não lê "
                "nem resume o conteúdo da página."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL completa, começando com http:// ou https://.",
                    }
                },
                "required": ["url"],
                "additionalProperties": False,
            },
            handler=partial(open_url, settings=settings),
        )
    )
    registry.apps_family_enabled = True


def build_registry(settings: Settings) -> ToolRegistry:
    registry = ToolRegistry(settings)
    if not settings.tools_enabled:
        return registry

    roots = settings.read_roots_list
    if roots:
        # Raiz inválida com ferramentas ligadas deve falhar no startup.
        validate_roots(roots)
        _register_files(registry, settings)

    _register_system(registry, settings)
    _register_apps(registry, settings)
    return registry
