import fnmatch
import stat
from pathlib import Path, PurePosixPath

from .base import ToolError


def _denied(relative: PurePosixPath, deny_globs: list[str]) -> bool:
    rel = relative.as_posix()
    parts = relative.parts
    for raw in deny_globs:
        pattern = raw.strip().replace("\\", "/")
        if not pattern:
            continue
        if pattern.endswith("/**"):
            base = pattern[:-3].rstrip("/")
            if "/" in base:
                if rel == base or rel.startswith(base + "/"):
                    return True
            elif base in parts:
                return True
        elif "/" in pattern:
            if PurePosixPath(rel).match(pattern):
                return True
        elif fnmatch.fnmatch(relative.name, pattern) or fnmatch.fnmatch(rel, pattern):
            return True
    return False


def resolve_within_roots(
    raw_path: str,
    roots: list[str],
    deny_globs: list[str],
) -> Path:
    """Resolve um caminho e garante que ele está dentro de uma raiz autorizada."""
    if not roots:
        raise ToolError("unavailable", "Nenhuma raiz de leitura foi autorizada.")
    if not isinstance(raw_path, str) or not raw_path.strip() or "\x00" in raw_path:
        raise ToolError("invalid_args", "Caminho inválido.")

    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        # Caminhos relativos partem da primeira raiz autorizada; assim "." é útil
        # e nunca depende do diretório de trabalho do processo.
        path = Path(roots[0]).expanduser() / path
    try:
        resolved = path.resolve()
    except (OSError, RuntimeError):
        raise ToolError("invalid_args", "Não foi possível resolver o caminho.") from None

    matched_root: Path | None = None
    for raw_root in roots:
        try:
            root = Path(raw_root).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if resolved == root or resolved.is_relative_to(root):
            matched_root = root
            break

    if matched_root is None:
        raise ToolError("forbidden_path", "O caminho está fora das raízes autorizadas.")

    relative = resolved.relative_to(matched_root)
    if _denied(relative, deny_globs):
        raise ToolError("forbidden_path", "O caminho corresponde a um padrão bloqueado.")

    if resolved.exists():
        try:
            mode = resolved.stat().st_mode
        except OSError:
            raise ToolError("not_found", "O caminho não pôde ser acessado.") from None
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ToolError(
                "forbidden_path",
                "Dispositivos, FIFOs e sockets não são acessíveis por ferramentas de leitura.",
            )

    return resolved


def validate_roots(roots: list[str]) -> list[Path]:
    """Valida as raízes no startup; raiz inválida derruba o processo."""
    validated: list[Path] = []
    for raw in roots:
        path = Path(raw).expanduser().resolve()
        if not path.is_dir():
            raise RuntimeError(f"TOOL_READ_ROOTS contém uma raiz inválida: {raw!r}")
        validated.append(path)
    return validated
