import shutil
import subprocess
from typing import Any
from urllib.parse import urlsplit

from ..config import Settings
from .base import ToolError

ALLOWED_URL_SCHEMES = frozenset({"http", "https"})
MAX_APP_NAME_CHARS = 128
FLATPAK_LIST_TIMEOUT_SECONDS = 2.0
FLATPAK_GENERIC_COMPONENTS = {"app", "client", "desktop", "electron", "launcher"}


def _invalid(message: str) -> ToolError:
    return ToolError("invalid_args", message)


def _validate_app_name(app: str) -> str:
    """Aceita apenas um nome simples de executável, nunca um caminho ou comando."""
    if not isinstance(app, str):
        raise _invalid("O nome do aplicativo deve ser texto.")
    if not app or len(app) > MAX_APP_NAME_CHARS:
        raise _invalid("Nome de aplicativo inválido.")
    if app != app.strip() or any(char.isspace() for char in app):
        raise _invalid("O nome do aplicativo não pode conter espaços.")
    if "/" in app or "\\" in app or ".." in app:
        raise _invalid("Informe apenas o nome do executável, sem caminho.")
    if app.startswith("-"):
        raise _invalid("O nome do aplicativo não pode começar com '-'.")
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in app):
        raise _invalid("O nome do aplicativo contém caracteres inválidos.")
    if app in {".", ".."}:
        raise _invalid("Nome de aplicativo inválido.")
    return app


def _deny_set(settings: Settings) -> set[str]:
    return {name.casefold() for name in settings.open_app_deny_list}


def _ensure_not_denied(name: str, denied: set[str]) -> None:
    if name.casefold() in denied:
        raise ToolError(
            "forbidden_target",
            f"O aplicativo '{name}' está bloqueado pela configuração.",
        )


def _resolve_command(app: str, settings: Settings) -> tuple[str, str]:
    """Resolve alias ou nome direto e devolve (nome do comando, caminho executável)."""
    denied = _deny_set(settings)
    candidates = settings.open_app_aliases_map.get(app.casefold(), [app])
    blocked = False
    for candidate in candidates:
        try:
            candidate = _validate_app_name(candidate)
        except ToolError:
            continue
        if candidate.casefold() in denied:
            blocked = True
            continue
        executable = shutil.which(candidate)
        if executable:
            return candidate, executable

    if blocked:
        raise ToolError(
            "forbidden_target",
            "Todos os candidatos deste aplicativo estão bloqueados pela configuração.",
        )
    raise ToolError(
        "not_found",
        f"O aplicativo '{app}' não foi encontrado no PATH.",
    )


def _flatpak_entries(executable: str) -> list[tuple[str, str]]:
    """Lista apps Flatpak instalados como (application-id, nome de exibição)."""
    try:
        completed = subprocess.run(
            [executable, "list", "--app", "--columns=application,name"],
            capture_output=True,
            text=True,
            timeout=FLATPAK_LIST_TIMEOUT_SECONDS,
            check=False,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return []
    if completed.returncode != 0:
        return []

    entries: list[tuple[str, str]] = []
    for line in (completed.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        app_id = parts[0].strip()
        name = parts[1].strip() or app_id
        if app_id:
            entries.append((app_id, name))
    return entries


def _resolve_flatpak(app: str, settings: Settings) -> tuple[str, str, str] | None:
    """Resolve um app Flatpak instalado por ID completo, nome ou último componente."""
    executable = shutil.which("flatpak")
    if not executable:
        return None

    entries = _flatpak_entries(executable)
    if not entries:
        return None

    needle = app.casefold()
    exact_id = [entry for entry in entries if entry[0].casefold() == needle]
    exact_name = [entry for entry in entries if entry[1].casefold() == needle]
    component = [
        entry
        for entry in entries
        if entry[0].rsplit(".", 1)[-1].casefold() == needle
        and entry[0].rsplit(".", 1)[-1].casefold() not in FLATPAK_GENERIC_COMPONENTS
    ]

    matches: list[tuple[str, str]] = []
    seen: set[str] = set()
    for entry in exact_id or exact_name or component:
        if entry[0] not in seen:
            seen.add(entry[0])
            matches.append(entry)

    if not matches:
        return None
    if len(matches) > 1:
        raise ToolError(
            "invalid_args",
            f"Mais de um aplicativo Flatpak corresponde a '{app}'; use o ID completo.",
        )

    app_id, name = matches[0]
    denied = _deny_set(settings)
    if app_id.casefold() in denied or name.casefold() in denied:
        raise ToolError(
            "forbidden_target",
            f"O aplicativo '{name}' está bloqueado pela configuração.",
        )
    return executable, app_id, name


def _launch(argv: list[str], failure_message: str) -> int:
    try:
        process = subprocess.Popen(
            argv,
            shell=False,
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except (OSError, ValueError):
        raise ToolError("unavailable", failure_message) from None
    return process.pid


def open_app(app: str, *, settings: Settings) -> dict:
    app = _validate_app_name(app)
    _ensure_not_denied(app, _deny_set(settings))

    try:
        command, executable = _resolve_command(app, settings)
    except ToolError as exc:
        if exc.code != "not_found":
            raise
        flatpak = _resolve_flatpak(app, settings)
        if flatpak is None:
            raise
        flatpak_executable, app_id, _ = flatpak
        pid = _launch(
            [flatpak_executable, "run", app_id],
            "Não foi possível iniciar o aplicativo.",
        )
        return {
            "app": app,
            "command": "flatpak",
            "app_id": app_id,
            "pid": pid,
            "launched": True,
        }

    pid = _launch([executable], "Não foi possível iniciar o aplicativo.")
    return {"app": app, "command": command, "pid": pid, "launched": True}


def _validate_url(raw: str, settings: Settings) -> tuple[str, str]:
    if not isinstance(raw, str) or not raw:
        raise _invalid("URL inválida.")
    limit = max(1, settings.tool_open_url_max_chars)
    if len(raw) > limit:
        raise _invalid(f"A URL excede o limite de {limit} caracteres.")
    if any(ord(char) <= 0x20 or ord(char) == 0x7F for char in raw):
        raise _invalid("A URL contém espaços ou caracteres de controle.")
    if "\\" in raw:
        raise _invalid("A URL contém caracteres inválidos.")

    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise _invalid("URL malformada.") from None

    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_URL_SCHEMES:
        raise _invalid("Apenas URLs http e https são permitidas.")
    if not parts.netloc or not parts.hostname:
        raise _invalid("A URL precisa de um host.")
    if parts.username is not None or parts.password is not None:
        raise _invalid("URLs com credenciais não são permitidas.")
    if port is not None and not (0 < port < 65536):
        raise _invalid("Porta inválida.")

    host = parts.hostname.rstrip(".").lower()
    if not host:
        raise _invalid("A URL precisa de um host.")

    domains = settings.open_url_domains_list
    if domains and not any(
        host == domain or host.endswith("." + domain) for domain in domains
    ):
        raise ToolError(
            "forbidden_target",
            f"O domínio '{host}' não está na lista de domínios autorizados.",
        )
    return raw, host


def open_url(url: str, *, settings: Settings) -> dict:
    url, host = _validate_url(url, settings)

    command = settings.tool_open_url_command.strip()
    if not command:
        raise ToolError("unavailable", "Nenhum abridor de URLs foi configurado.")
    executable = shutil.which(command)
    if not executable:
        raise ToolError(
            "unavailable",
            f"O abridor de URLs '{command}' não foi encontrado.",
        )

    pid = _launch([executable, url], "Não foi possível abrir o site.")
    return {"url": url, "host": host, "pid": pid, "launched": True}


def redact_url(raw: str) -> str:
    """Reduz uma URL a scheme://host para a auditoria, sem query nem fragmento."""
    if not isinstance(raw, str):
        return ""
    try:
        parts = urlsplit(raw)
        host = (parts.hostname or "").rstrip(".").lower()
    except ValueError:
        return ""
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_URL_SCHEMES or not host:
        return ""
    display_host = f"[{host}]" if ":" in host else host
    return f"{scheme}://{display_host}"


def audit_arguments(name: str, arguments: Any) -> Any:
    """Argumentos mínimos persistidos na auditoria."""
    if not isinstance(arguments, dict):
        return arguments
    if name == "open_app":
        app = arguments.get("app")
        return {"app": app} if isinstance(app, str) else {}
    if name == "open_url":
        url = arguments.get("url")
        return {"url": redact_url(url)} if isinstance(url, str) else {}
    return arguments
