import subprocess
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.tools import system
from app.tools.base import ToolError


def make_settings(**overrides):
    return Settings(tools_enabled=True, tool_read_roots="", **overrides)


def test_gpu_absent(monkeypatch):
    def fake_run(*args, **kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(system.subprocess, "run", fake_run)
    result = system._gpu_info(make_settings())
    assert result["available"] is False
    assert "não encontrado" in result["reason"]


def test_gpu_timeout_and_error(monkeypatch):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="nvidia-smi", timeout=2)

    monkeypatch.setattr(system.subprocess, "run", timeout)
    assert system._gpu_info(make_settings())["reason"] == "timeout"

    monkeypatch.setattr(
        system.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout="", stderr="erro"),
    )
    assert system._gpu_info(make_settings())["available"] is False


def test_gpu_parses_multiple_devices_with_fixed_argv(monkeypatch):
    captured = {}

    def fake_run(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return SimpleNamespace(
            returncode=0,
            stdout=(
                "0, NVIDIA RTX 3050, 6144, 1024, 15, 45\n"
                "1, NVIDIA RTX 4090, 24576, 2048, 30, 55\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(system.subprocess, "run", fake_run)
    result = system._gpu_info(make_settings())
    assert result["available"] is True
    assert len(result["devices"]) == 2
    assert result["devices"][0]["memory_total_mb"] == 6144.0
    assert captured["args"][0][0] == "nvidia-smi"
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["timeout"] == 2.0


def test_gpu_malformed_csv(monkeypatch):
    monkeypatch.setattr(
        system.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout="0, GPU\n", stderr=""
        ),
    )
    result = system._gpu_info(make_settings())
    assert result["available"] is False
    assert "malformada" in result["reason"]


def test_get_system_info(monkeypatch):
    monkeypatch.setattr(system, "_cpu_model", lambda: "CPU de teste")
    monkeypatch.setattr(system.psutil, "cpu_percent", lambda interval, percpu: [10.0, 30.0])
    monkeypatch.setattr(
        system.psutil, "cpu_count", lambda logical=True: 4 if logical else 2
    )
    monkeypatch.setattr(
        system.psutil,
        "virtual_memory",
        lambda: SimpleNamespace(total=8 * 1024**3, used=2 * 1024**3,
                                available=6 * 1024**3, percent=25.0),
    )
    monkeypatch.setattr(
        system.psutil,
        "swap_memory",
        lambda: SimpleNamespace(total=1024**3, used=0, percent=0.0),
    )
    monkeypatch.setattr(system.os, "getloadavg", lambda: (1.0, 2.0, 3.0))
    monkeypatch.setattr(
        system, "_gpu_info", lambda settings: {"available": False, "devices": []}
    )

    result = system.get_system_info(settings=make_settings())
    assert result["cpu"]["model"] == "CPU de teste"
    assert result["cpu"]["usage_percent"] == 20.0
    assert result["cpu"]["per_core_percent"] == [10.0, 30.0]
    assert result["memory"]["total_mb"] == 8192.0
    assert result["gpu"]["available"] is False


def test_disk_usage_filters_pseudo_and_permission_errors(monkeypatch):
    partitions = [
        SimpleNamespace(device="/dev/sda1", mountpoint="/", fstype="ext4"),
        SimpleNamespace(device="tmpfs", mountpoint="/tmp", fstype="tmpfs"),
        SimpleNamespace(device="/dev/sdb1", mountpoint="/data", fstype="ext4"),
    ]
    monkeypatch.setattr(system.psutil, "disk_partitions", lambda all=False: partitions)

    def fake_usage(mountpoint):
        if mountpoint == "/data":
            raise PermissionError
        return SimpleNamespace(
            total=100 * 1024**3, used=40 * 1024**3, free=60 * 1024**3, percent=40.0
        )

    monkeypatch.setattr(system.psutil, "disk_usage", fake_usage)
    result = system.get_disk_usage(settings=make_settings())
    assert result["count"] == 1
    assert result["mounts"][0]["mountpoint"] == "/"
    assert result["mounts"][0]["total_gb"] == 100.0


class FakeProcess:
    def __init__(self, pid, name, cpu, rss, username="u", status="running"):
        self.info = {
            "pid": pid,
            "name": name,
            "username": username,
            "status": status,
            "memory_info": SimpleNamespace(rss=rss),
        }
        self._cpu = cpu

    def cpu_percent(self, interval=None):
        return self._cpu


def test_list_processes_sorts_and_has_no_cmdline(monkeypatch):
    processes = [
        FakeProcess(1, "baixo", 1.0, 10 * 1024**2),
        FakeProcess(2, "alto", 50.0, 100 * 1024**2),
        FakeProcess(3, "medio", 20.0, 50 * 1024**2),
    ]
    captured = {}

    def fake_iter(attrs):
        captured["attrs"] = attrs
        return processes

    monkeypatch.setattr(system.psutil, "process_iter", fake_iter)
    monkeypatch.setattr(system.time, "sleep", lambda seconds: None)

    result = system.list_processes("cpu", 2, settings=make_settings())
    assert [item["name"] for item in result["processes"]] == ["alto", "medio"]
    assert result["processes"][0]["memory_mb"] == 100.0
    assert "cmdline" not in captured["attrs"]
    assert all("cmdline" not in item for item in result["processes"])

    by_memory = system.list_processes("memory", 1, settings=make_settings())
    assert by_memory["processes"][0]["name"] == "alto"

    clamped = system.list_processes("cpu", 999, settings=make_settings())
    assert clamped["limit"] == 50
    assert clamped["count"] == 3

    defaulted = system.list_processes(
        "cpu", settings=make_settings(process_list_default_limit=2)
    )
    assert defaulted["limit"] == 2
    assert defaulted["count"] == 2


def test_list_processes_invalid_args(monkeypatch):
    monkeypatch.setattr(system.psutil, "process_iter", lambda attrs: [])
    with pytest.raises(ToolError) as exc:
        system.list_processes("nome", 1, settings=make_settings())
    assert exc.value.code == "invalid_args"

    with pytest.raises(ToolError):
        system.list_processes("cpu", "muitos", settings=make_settings())


def test_current_datetime_shape():
    result = system.get_current_datetime(settings=make_settings())
    assert result["local_pt_br"].count("/") == 2
    assert result["utc_iso"].endswith("+00:00")
    assert result["timezone"]
    assert result["utc_offset"][0] in "+-"
    assert result["weekday_pt_br"]
