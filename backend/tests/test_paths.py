import os

import pytest

from app.tools.base import ToolError
from app.tools.paths import resolve_within_roots, validate_roots

DENY_GLOBS = [
    ".env",
    ".git/**",
    ".ssh/**",
    ".gnupg/**",
    "*.pem",
    "id_rsa*",
    "node_modules/**",
    ".venv/**",
]


@pytest.fixture
def root(tmp_path):
    path = tmp_path / "root"
    path.mkdir()
    return path


def test_relative_paths_start_at_first_root(root):
    (root / "a.txt").write_text("x", encoding="utf-8")
    assert resolve_within_roots("a.txt", [str(root)], DENY_GLOBS) == (
        root / "a.txt"
    ).resolve()
    assert resolve_within_roots(".", [str(root)], DENY_GLOBS) == root.resolve()


def test_traversal_outside_root_is_forbidden(root, tmp_path):
    (tmp_path / "outside.txt").write_text("segredo", encoding="utf-8")
    with pytest.raises(ToolError) as exc:
        resolve_within_roots("../outside.txt", [str(root)], DENY_GLOBS)
    assert exc.value.code == "forbidden_path"


def test_absolute_path_outside_root_is_forbidden(root, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("x", encoding="utf-8")
    with pytest.raises(ToolError) as exc:
        resolve_within_roots(str(outside), [str(root)], DENY_GLOBS)
    assert exc.value.code == "forbidden_path"


def test_symlink_to_outside_is_forbidden(root, tmp_path):
    outside = tmp_path / "secret.txt"
    outside.write_text("x", encoding="utf-8")
    (root / "link").symlink_to(outside)
    with pytest.raises(ToolError) as exc:
        resolve_within_roots("link", [str(root)], DENY_GLOBS)
    assert exc.value.code == "forbidden_path"


def test_deny_globs(root):
    (root / ".env").write_text("TOKEN=x", encoding="utf-8")
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("x", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "pkg.js").write_text("x", encoding="utf-8")
    (root / "cert.pem").write_text("x", encoding="utf-8")
    (root / "id_rsa").write_text("x", encoding="utf-8")
    (root / "ok.txt").write_text("x", encoding="utf-8")

    for denied in [".env", ".git/config", "node_modules/pkg.js", "cert.pem", "id_rsa"]:
        with pytest.raises(ToolError) as exc:
            resolve_within_roots(denied, [str(root)], DENY_GLOBS)
        assert exc.value.code == "forbidden_path", denied

    assert resolve_within_roots("ok.txt", [str(root)], DENY_GLOBS).name == "ok.txt"


def test_fifo_is_rejected(root):
    fifo = root / "pipe"
    os.mkfifo(fifo)
    with pytest.raises(ToolError) as exc:
        resolve_within_roots("pipe", [str(root)], DENY_GLOBS)
    assert exc.value.code == "forbidden_path"


def test_tilde_is_expanded(root, monkeypatch):
    monkeypatch.setenv("HOME", str(root))
    (root / "home.txt").write_text("x", encoding="utf-8")
    assert resolve_within_roots("~/home.txt", [str(root)], DENY_GLOBS).name == "home.txt"


def test_empty_roots_means_unavailable(root):
    with pytest.raises(ToolError) as exc:
        resolve_within_roots("a.txt", [], DENY_GLOBS)
    assert exc.value.code == "unavailable"


def test_validate_roots_rejects_invalid_root(tmp_path):
    with pytest.raises(RuntimeError):
        validate_roots([str(tmp_path / "nao-existe")])
    assert validate_roots([str(tmp_path)]) == [tmp_path.resolve()]
