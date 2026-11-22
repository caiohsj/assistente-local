import pytest

from app.config import Settings
from app.tools import files
from app.tools.base import ToolError


def make_settings(root, **overrides):
    return Settings(tool_read_roots=str(root), tools_enabled=True, **overrides)


@pytest.fixture
def root(tmp_path):
    path = tmp_path / "root"
    path.mkdir()
    return path


def test_list_dir_is_sorted_capped_and_skips_denied(root):
    (root / "b.txt").write_text("b", encoding="utf-8")
    (root / "a.txt").write_text("a", encoding="utf-8")
    (root / "sub").mkdir()
    (root / ".env").write_text("TOKEN=x", encoding="utf-8")

    result = files.list_dir(".", settings=make_settings(root))
    assert [entry["name"] for entry in result["entries"]] == ["a.txt", "b.txt", "sub"]
    assert result["entries"][2]["type"] == "dir"
    assert result["truncated"] is False

    capped = files.list_dir(".", settings=make_settings(root, tool_max_entries=2))
    assert capped["count"] == 2
    assert capped["truncated"] is True


def test_read_file_line_range_and_truncation(root):
    (root / "texto.txt").write_text("um\ndois\ntres\nquatro\ncinco", encoding="utf-8")
    result = files.read_file(
        "texto.txt", start_line=2, max_lines=2, settings=make_settings(root)
    )
    assert result["content"] == "dois\ntres"
    assert result["start_line"] == 2
    assert result["end_line"] == 3
    assert result["total_lines"] == 5
    assert result["truncated"] is True


def test_read_file_rejects_binary_and_limits_bytes(root):
    (root / "bin.dat").write_bytes(b"abc\x00def")
    with pytest.raises(ToolError) as exc:
        files.read_file("bin.dat", settings=make_settings(root))
    assert exc.value.code == "binary_file"

    (root / "grande.txt").write_text("0123456789", encoding="utf-8")
    result = files.read_file("grande.txt", settings=make_settings(root, tool_max_file_bytes=5))
    assert result["content"] == "01234"
    assert result["truncated"] is True
    assert result["total_lines"] is None


def test_read_file_missing_and_outside(root, tmp_path):
    with pytest.raises(ToolError) as exc:
        files.read_file("nao-existe.txt", settings=make_settings(root))
    assert exc.value.code == "not_found"

    outside = tmp_path / "fora.txt"
    outside.write_text("x", encoding="utf-8")
    with pytest.raises(ToolError) as exc:
        files.read_file(str(outside), settings=make_settings(root))
    assert exc.value.code == "forbidden_path"


def test_search_text_literal_case_insensitive_and_glob(root):
    (root / "a.py").write_text("Hello World\nnada", encoding="utf-8")
    (root / "b.txt").write_text("hello", encoding="utf-8")
    (root / ".env").write_text("hello", encoding="utf-8")

    result = files.search_text("hello", glob="*.py", settings=make_settings(root))
    assert result["count"] == 1
    assert result["matches"][0]["line"] == 1
    assert result["matches"][0]["path"].endswith("a.py")

    all_text = files.search_text("HELLO", settings=make_settings(root))
    assert all_text["count"] == 2  # a.py e b.txt; .env bloqueado


def test_search_text_caps_results_and_skips_binary(root):
    for index in range(5):
        (root / f"f{index}.txt").write_text("alvo", encoding="utf-8")
    (root / "bin.dat").write_bytes(b"alvo\x00")
    result = files.search_text("alvo", settings=make_settings(root, tool_max_results=2))
    assert result["count"] == 2
    assert result["truncated"] is True


def test_search_text_deadline(root, monkeypatch):
    (root / "a.txt").write_text("alvo", encoding="utf-8")
    ticks = iter([0.0, 10.0, 10.0, 10.0, 10.0])
    monkeypatch.setattr(files.time, "monotonic", lambda: next(ticks, 20.0))
    result = files.search_text(
        "alvo", settings=make_settings(root, tool_search_timeout_seconds=0)
    )
    assert result["timed_out"] is True
