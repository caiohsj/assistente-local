import json
import subprocess
from types import SimpleNamespace

import pytest

from app.agent import execute_tool
from app.config import Settings
from app.db import connect
from app.tools import apps as opener
from app.tools import build_registry
from app.tools.base import ToolError


def make_settings(**overrides):
    defaults = {
        "tools_enabled": True,
        "tool_read_roots": "",
        "tool_open_url_command": "xdg-open",
        "tool_open_url_domains": "",
        "tool_open_url_max_chars": 2048,
        "tool_open_app_aliases": (
            "terminal=x-terminal-emulator|gnome-terminal|konsole|alacritty|kitty|xterm"
        ),
        "tool_open_app_deny": "",
    }
    defaults.update(overrides)
    return Settings(**defaults)


class FakeProcess:
    pid = 4242


def fake_popen(captured):
    def _popen(argv, **kwargs):
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        return FakeProcess()

    return _popen


def patch_launch(monkeypatch, which=lambda name: f"/usr/bin/{name}"):
    captured = {}
    monkeypatch.setattr(opener.shutil, "which", which)
    monkeypatch.setattr(opener.subprocess, "Popen", fake_popen(captured))
    return captured


def which_flatpak(name):
    return "/usr/bin/flatpak" if name == "flatpak" else None


def fake_flatpak_list(stdout, returncode=0):
    def run(argv, **kwargs):
        assert argv[0].endswith("flatpak")
        assert argv[1:] == ["list", "--app", "--columns=application,name"]
        assert kwargs["shell"] is False
        assert kwargs["timeout"] == opener.FLATPAK_LIST_TIMEOUT_SECONDS
        return SimpleNamespace(returncode=returncode, stdout=stdout, stderr="")

    return run


FLATPAK_APPS = (
    "com.discordapp.Discord\tDiscord\n"
    "org.telegram.desktop\tTelegram\n"
    "com.visualstudio.code\tVisual Studio Code\n"
)


def test_open_app_resolves_executable_via_path(monkeypatch):
    captured = patch_launch(monkeypatch)

    result = opener.open_app("firefox", settings=make_settings())

    assert result == {
        "app": "firefox",
        "command": "firefox",
        "pid": 4242,
        "launched": True,
    }
    assert captured["argv"] == ["/usr/bin/firefox"]
    kwargs = captured["kwargs"]
    assert kwargs["shell"] is False
    assert kwargs["start_new_session"] is True
    assert kwargs["stdin"] == subprocess.DEVNULL
    assert kwargs["stdout"] == subprocess.DEVNULL
    assert kwargs["stderr"] == subprocess.DEVNULL
    assert kwargs["close_fds"] is True


def test_open_app_alias_uses_first_installed_candidate(monkeypatch):
    calls = []

    def which(name):
        calls.append(name)
        return "/usr/bin/kitty" if name == "kitty" else None

    patch_launch(monkeypatch, which)
    settings = make_settings(
        tool_open_app_aliases="terminal=nao-existe|kitty|xterm"
    )

    result = opener.open_app("Terminal", settings=settings)

    assert result["app"] == "Terminal"
    assert result["command"] == "kitty"
    assert calls == ["nao-existe", "kitty"]


def test_open_app_alias_without_installed_candidate(monkeypatch):
    patch_launch(monkeypatch, which=lambda name: None)
    settings = make_settings(tool_open_app_aliases="terminal=kitty|xterm")

    with pytest.raises(ToolError) as exc:
        opener.open_app("terminal", settings=settings)
    assert exc.value.code == "not_found"


def test_open_app_falls_back_to_flatpak_by_display_name(monkeypatch):
    captured = patch_launch(monkeypatch, which_flatpak)
    monkeypatch.setattr(opener.subprocess, "run", fake_flatpak_list(FLATPAK_APPS))

    result = opener.open_app("telegram", settings=make_settings())

    assert result == {
        "app": "telegram",
        "command": "flatpak",
        "app_id": "org.telegram.desktop",
        "pid": 4242,
        "launched": True,
    }
    assert captured["argv"] == ["/usr/bin/flatpak", "run", "org.telegram.desktop"]
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["start_new_session"] is True


def test_open_app_falls_back_to_flatpak_by_full_id_and_component(monkeypatch):
    patch_launch(monkeypatch, which_flatpak)
    monkeypatch.setattr(opener.subprocess, "run", fake_flatpak_list(FLATPAK_APPS))

    by_id = opener.open_app(
        "com.discordapp.Discord", settings=make_settings()
    )
    assert by_id["app_id"] == "com.discordapp.Discord"

    by_component = opener.open_app("code", settings=make_settings())
    assert by_component["app_id"] == "com.visualstudio.code"


def test_open_app_flatpak_ambiguous_name(monkeypatch):
    patch_launch(monkeypatch, which_flatpak)
    monkeypatch.setattr(
        opener.subprocess,
        "run",
        fake_flatpak_list(
            "com.example.Foo\tFoo\norg.example.Foo\tFoo\n"
        ),
    )

    with pytest.raises(ToolError) as exc:
        opener.open_app("foo", settings=make_settings())
    assert exc.value.code == "invalid_args"


def test_open_app_flatpak_denylist_by_full_id(monkeypatch):
    patch_launch(monkeypatch, which_flatpak)
    monkeypatch.setattr(opener.subprocess, "run", fake_flatpak_list(FLATPAK_APPS))

    with pytest.raises(ToolError) as exc:
        opener.open_app(
            "telegram",
            settings=make_settings(
                tool_open_app_deny="org.telegram.desktop"
            ),
        )
    assert exc.value.code == "forbidden_target"


def test_open_app_flatpak_list_failure_falls_back_to_not_found(monkeypatch):
    patch_launch(monkeypatch, which_flatpak)
    monkeypatch.setattr(
        opener.subprocess,
        "run",
        fake_flatpak_list("", returncode=1),
    )
    with pytest.raises(ToolError) as exc:
        opener.open_app("telegram", settings=make_settings())
    assert exc.value.code == "not_found"

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="flatpak", timeout=2)

    monkeypatch.setattr(opener.subprocess, "run", timeout)
    with pytest.raises(ToolError) as exc:
        opener.open_app("telegram", settings=make_settings())
    assert exc.value.code == "not_found"


def test_open_app_without_flatpak_keeps_not_found(monkeypatch):
    patch_launch(monkeypatch, which=lambda name: None)
    with pytest.raises(ToolError) as exc:
        opener.open_app("telegram", settings=make_settings())
    assert exc.value.code == "not_found"


def test_open_app_flatpak_popen_failure_is_unavailable(monkeypatch):
    monkeypatch.setattr(opener.shutil, "which", which_flatpak)
    monkeypatch.setattr(opener.subprocess, "run", fake_flatpak_list(FLATPAK_APPS))

    def boom(*args, **kwargs):
        raise OSError("falha ao iniciar")

    monkeypatch.setattr(opener.subprocess, "Popen", boom)
    with pytest.raises(ToolError) as exc:
        opener.open_app("telegram", settings=make_settings())
    assert exc.value.code == "unavailable"


def test_open_app_denylist_blocks_direct_and_alias(monkeypatch):
    patch_launch(monkeypatch)

    direct = make_settings(tool_open_app_deny="firefox,rm")
    with pytest.raises(ToolError) as exc:
        opener.open_app("Firefox", settings=direct)
    assert exc.value.code == "forbidden_target"

    alias = make_settings(
        tool_open_app_aliases="nav=firefox",
        tool_open_app_deny="firefox",
    )
    with pytest.raises(ToolError) as exc:
        opener.open_app("nav", settings=alias)
    assert exc.value.code == "forbidden_target"


@pytest.mark.parametrize(
    "name",
    [
        "/usr/bin/firefox",
        "bin\\firefox",
        "fire fox",
        "fire\nfox",
        "fire\x00fox",
        "-rf",
        "..",
        "../firefox",
        "",
        "   ",
    ],
)
def test_open_app_rejects_malformed_names(name):
    with pytest.raises(ToolError) as exc:
        opener.open_app(name, settings=make_settings())
    assert exc.value.code == "invalid_args"


def test_open_url_launches_opener_detached(monkeypatch):
    captured = patch_launch(monkeypatch)
    url = "https://example.com/notas?q=1#topo"

    result = opener.open_url(url, settings=make_settings())

    assert result == {
        "url": url,
        "host": "example.com",
        "pid": 4242,
        "launched": True,
    }
    assert captured["argv"] == ["/usr/bin/xdg-open", url]
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["start_new_session"] is True


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,oi",
        "ftp://example.com",
        "http://",
        "https:///caminho",
        "https://user:pass@example.com",
        "https://user@example.com",
        "https://example.com/\x01",
        "https://exa mple.com",
        "https://example.com\\@evil.com",
        "//example.com",
        "",
        "https://example.com:99999",
    ],
)
def test_open_url_rejects_invalid_urls(url, monkeypatch):
    patch_launch(monkeypatch)
    with pytest.raises(ToolError) as exc:
        opener.open_url(url, settings=make_settings())
    assert exc.value.code == "invalid_args"


def test_open_url_respects_max_chars(monkeypatch):
    patch_launch(monkeypatch)
    with pytest.raises(ToolError) as exc:
        opener.open_url(
            "https://example.com/caminho-longo",
            settings=make_settings(tool_open_url_max_chars=10),
        )
    assert exc.value.code == "invalid_args"


def test_open_url_domain_allowlist(monkeypatch):
    patch_launch(monkeypatch)
    settings = make_settings(tool_open_url_domains="example.com,internal.local")

    for url in (
        "https://example.com",
        "https://sub.example.com/x",
        "https://EXAMPLE.com.",
        "https://internal.local:8443",
    ):
        assert opener.open_url(url, settings=settings)["launched"] is True

    for url in (
        "https://evil.com",
        "https://example.com.evil.com",
        "https://notexample.com",
    ):
        with pytest.raises(ToolError) as exc:
            opener.open_url(url, settings=settings)
        assert exc.value.code == "forbidden_target"


def test_open_url_missing_opener(monkeypatch):
    patch_launch(monkeypatch, which=lambda name: None)
    with pytest.raises(ToolError) as exc:
        opener.open_url("https://example.com", settings=make_settings())
    assert exc.value.code == "unavailable"


def test_open_url_empty_command(monkeypatch):
    patch_launch(monkeypatch)
    with pytest.raises(ToolError) as exc:
        opener.open_url(
            "https://example.com",
            settings=make_settings(tool_open_url_command="  "),
        )
    assert exc.value.code == "unavailable"


def test_popen_failure_is_unavailable(monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("falha ao iniciar")

    monkeypatch.setattr(opener.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(opener.subprocess, "Popen", boom)

    with pytest.raises(ToolError) as exc:
        opener.open_app("firefox", settings=make_settings())
    assert exc.value.code == "unavailable"

    with pytest.raises(ToolError) as exc:
        opener.open_url("https://example.com", settings=make_settings())
    assert exc.value.code == "unavailable"


def test_audit_arguments_redact_url_and_keep_app_name():
    assert opener.audit_arguments(
        "open_url", {"url": "https://example.com/notas?token=segredo#topo"}
    ) == {"url": "https://example.com"}
    assert opener.audit_arguments(
        "open_url", {"url": "http://user:pass@example.com/x"}
    ) == {"url": "http://example.com"}
    assert opener.audit_arguments("open_url", {"url": "file:///etc/passwd"}) == {
        "url": ""
    }
    assert opener.audit_arguments("open_app", {"app": "firefox"}) == {
        "app": "firefox"
    }
    assert opener.audit_arguments("open_app", {"app": "firefox", "args": "-x"}) == {
        "app": "firefox"
    }


@pytest.mark.asyncio
async def test_execute_tool_audits_only_safe_metadata(isolated_db, monkeypatch):
    settings = make_settings()
    registry = build_registry(settings)
    patch_launch(monkeypatch)

    summary, payload = await execute_tool(
        registry,
        "open_url",
        {"url": "https://example.com/x?token=segredo#frag"},
        settings,
    )
    assert payload["ok"] is True
    assert summary.summary == "abriu example.com"

    summary, payload = await execute_tool(
        registry, "open_app", {"app": "firefox"}, settings
    )
    assert payload["ok"] is True
    assert summary.summary == "abriu firefox"

    with connect() as conn:
        rows = conn.execute(
            "SELECT tool, args_json FROM tool_calls ORDER BY id"
        ).fetchall()
    assert [row["tool"] for row in rows] == ["open_url", "open_app"]
    assert json.loads(rows[0]["args_json"]) == {"url": "https://example.com"}
    assert json.loads(rows[1]["args_json"]) == {"app": "firefox"}


@pytest.mark.asyncio
async def test_execute_tool_audits_flatpak_by_requested_name(isolated_db, monkeypatch):
    settings = make_settings()
    registry = build_registry(settings)
    patch_launch(monkeypatch, which_flatpak)
    monkeypatch.setattr(opener.subprocess, "run", fake_flatpak_list(FLATPAK_APPS))

    summary, payload = await execute_tool(
        registry, "open_app", {"app": "telegram"}, settings
    )
    assert payload["ok"] is True
    assert payload["result"]["app_id"] == "org.telegram.desktop"
    assert summary.summary == "abriu telegram"

    with connect() as conn:
        row = conn.execute(
            "SELECT args_json FROM tool_calls ORDER BY id DESC LIMIT 1"
        ).fetchone()
    assert json.loads(row["args_json"]) == {"app": "telegram"}
