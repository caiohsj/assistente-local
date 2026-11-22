import fnmatch
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from ..config import Settings
from .base import ToolError
from .paths import resolve_within_roots

MAX_READ_LINES = 1000
MAX_SEARCH_LINE_CHARS = 500


def _resolved_relative(path: Path, roots: list[str]) -> Path | None:
    for raw_root in roots:
        root = Path(raw_root).expanduser().resolve()
        if path == root or path.is_relative_to(root):
            return path.relative_to(root)
    return None


def list_dir(path: str = ".", *, settings: Settings) -> dict:
    roots = settings.read_roots_list
    target = resolve_within_roots(path, roots, settings.deny_globs_list)
    if not target.exists():
        raise ToolError("not_found", "Diretório não encontrado.")
    if not target.is_dir():
        raise ToolError("invalid_args", "O caminho não é um diretório.")

    entries: list[dict] = []
    truncated = False
    try:
        children = sorted(target.iterdir(), key=lambda item: item.name.casefold())
    except PermissionError:
        raise ToolError("forbidden_path", "Sem permissão para listar este diretório.") from None

    for child in children:
        try:
            resolved = child.resolve()
        except (OSError, RuntimeError):
            continue
        relative = _resolved_relative(resolved, roots)
        if relative is None:
            continue
        try:
            resolve_within_roots(str(resolved), roots, settings.deny_globs_list)
        except ToolError:
            continue

        try:
            stat_result = child.stat()
        except OSError:
            continue
        if child.is_symlink():
            kind = "symlink"
        elif child.is_dir():
            kind = "dir"
        elif child.is_file():
            kind = "file"
        else:
            kind = "other"
        entries.append(
            {
                "name": child.name,
                "type": kind,
                "size_bytes": stat_result.st_size if kind == "file" else None,
                "modified_at": datetime.fromtimestamp(
                    stat_result.st_mtime, tz=timezone.utc
                ).isoformat(timespec="seconds"),
            }
        )
        if len(entries) >= settings.tool_max_entries:
            truncated = True
            break

    return {
        "path": str(target),
        "entries": entries,
        "count": len(entries),
        "truncated": truncated,
    }


def read_file(
    path: str,
    start_line: int = 1,
    max_lines: int = 200,
    *,
    settings: Settings,
) -> dict:
    roots = settings.read_roots_list
    target = resolve_within_roots(path, roots, settings.deny_globs_list)
    if not target.exists():
        raise ToolError("not_found", "Arquivo não encontrado.")
    if not target.is_file():
        raise ToolError("invalid_args", "O caminho não é um arquivo regular.")

    try:
        start_line = int(start_line)
        max_lines = int(max_lines)
    except (TypeError, ValueError):
        raise ToolError("invalid_args", "start_line e max_lines devem ser inteiros.") from None
    if start_line < 1:
        raise ToolError("invalid_args", "start_line deve ser maior ou igual a 1.")
    if max_lines < 1:
        raise ToolError("invalid_args", "max_lines deve ser maior ou igual a 1.")
    max_lines = min(max_lines, MAX_READ_LINES)

    size_bytes = target.stat().st_size
    try:
        with target.open("rb") as handle:
            data = handle.read(settings.tool_max_file_bytes + 1)
    except PermissionError:
        raise ToolError("forbidden_path", "Sem permissão para ler este arquivo.") from None

    size_limited = len(data) > settings.tool_max_file_bytes
    data = data[: settings.tool_max_file_bytes]
    if b"\x00" in data:
        raise ToolError("binary_file", "O arquivo parece ser binário.")

    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    total_lines = None if size_limited else len(lines)
    selected = lines[start_line - 1 : start_line - 1 + max_lines]
    end_line = start_line + len(selected) - 1 if selected else start_line - 1
    truncated = size_limited or (
        total_lines is not None and start_line - 1 + len(selected) < total_lines
    )

    return {
        "path": str(target),
        "content": "\n".join(selected),
        "start_line": start_line,
        "end_line": end_line,
        "total_lines": total_lines,
        "size_bytes": size_bytes,
        "truncated": truncated,
    }


def search_text(
    query: str,
    path: str = ".",
    glob: str = "*",
    *,
    settings: Settings,
) -> dict:
    if not isinstance(query, str) or not query.strip():
        raise ToolError("invalid_args", "A busca precisa de um texto não vazio.")
    query = query.strip()
    if not isinstance(glob, str) or not glob.strip():
        raise ToolError("invalid_args", "O padrão glob é inválido.")

    roots = settings.read_roots_list
    target = resolve_within_roots(path, roots, settings.deny_globs_list)
    if not target.exists():
        raise ToolError("not_found", "Caminho de busca não encontrado.")

    deadline = time.monotonic() + settings.tool_search_timeout_seconds
    needle = query.casefold()
    matches: list[dict] = []
    files_scanned = 0
    truncated = False
    timed_out = False

    def inspect_file(file_path: Path) -> None:
        nonlocal files_scanned, truncated
        try:
            resolved = file_path.resolve()
        except (OSError, RuntimeError):
            return
        relative = _resolved_relative(resolved, roots)
        if relative is None:
            return
        try:
            resolve_within_roots(str(resolved), roots, settings.deny_globs_list)
        except ToolError:
            return
        if not resolved.is_file():
            return
        try:
            if resolved.stat().st_size > settings.tool_max_file_bytes:
                return
            data = resolved.read_bytes()
        except OSError:
            return
        if b"\x00" in data:
            return
        files_scanned += 1
        for line_number, line in enumerate(
            data.decode("utf-8", errors="replace").splitlines(), start=1
        ):
            if needle in line.casefold():
                matches.append(
                    {
                        "path": str(resolved),
                        "line": line_number,
                        "text": line[:MAX_SEARCH_LINE_CHARS],
                    }
                )
                if len(matches) >= settings.tool_max_results:
                    truncated = True
                    return

    if target.is_file():
        if fnmatch.fnmatch(target.name, glob):
            inspect_file(target)
    else:
        for dirpath, dirnames, filenames in os.walk(target, followlinks=False):
            if time.monotonic() > deadline:
                timed_out = True
                break
            kept_dirs = []
            for name in sorted(dirnames):
                candidate = Path(dirpath) / name
                try:
                    resolved = candidate.resolve()
                except (OSError, RuntimeError):
                    continue
                relative = _resolved_relative(resolved, roots)
                if relative is None:
                    continue
                try:
                    resolve_within_roots(str(resolved), roots, settings.deny_globs_list)
                except ToolError:
                    continue
                kept_dirs.append(name)
            dirnames[:] = kept_dirs

            for name in sorted(filenames):
                if time.monotonic() > deadline:
                    timed_out = True
                    break
                if not fnmatch.fnmatch(name, glob):
                    continue
                inspect_file(Path(dirpath) / name)
                if truncated or files_scanned >= settings.tool_max_entries:
                    truncated = True
                    break
            if truncated or timed_out:
                break

    return {
        "query": query,
        "path": str(target),
        "glob": glob,
        "matches": matches,
        "count": len(matches),
        "files_scanned": files_scanned,
        "truncated": truncated,
        "timed_out": timed_out,
    }
