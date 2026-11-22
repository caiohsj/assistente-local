import csv
import os
import platform
import subprocess
import time
from datetime import datetime, timezone

import psutil

from ..config import Settings
from .base import ToolError

GPU_QUERY_ARGS = [
    "nvidia-smi",
    "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu",
    "--format=csv,noheader,nounits",
]

PSEUDO_FILESYSTEMS = {
    "autofs",
    "binfmt_misc",
    "cgroup",
    "cgroup2",
    "configfs",
    "debugfs",
    "devpts",
    "devtmpfs",
    "efivarfs",
    "fusectl",
    "hugetlbfs",
    "mqueue",
    "overlay",
    "proc",
    "pstore",
    "ramfs",
    "securityfs",
    "squashfs",
    "sysfs",
    "tmpfs",
    "tracefs",
}


def _round_mb(value: float) -> float:
    return round(value / (1024 * 1024), 1)


def _cpu_model() -> str:
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as handle:
            for line in handle:
                if line.lower().startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine() or "desconhecido"


def _gpu_info(settings: Settings) -> dict:
    try:
        completed = subprocess.run(
            GPU_QUERY_ARGS,
            capture_output=True,
            text=True,
            timeout=settings.gpu_query_timeout_seconds,
            check=False,
            shell=False,
        )
    except FileNotFoundError:
        return {"available": False, "reason": "nvidia-smi não encontrado", "devices": []}
    except subprocess.TimeoutExpired:
        return {"available": False, "reason": "timeout", "devices": []}
    except OSError:
        return {"available": False, "reason": "erro ao executar nvidia-smi", "devices": []}

    if completed.returncode != 0:
        return {"available": False, "reason": "nvidia-smi retornou erro", "devices": []}

    devices: list[dict] = []
    malformed = False
    for row in csv.reader(completed.stdout.splitlines()):
        if not row or all(not field.strip() for field in row):
            continue
        if len(row) != 6:
            malformed = True
            continue
        try:
            devices.append(
                {
                    "index": int(row[0].strip()),
                    "name": row[1].strip(),
                    "memory_total_mb": round(float(row[2].strip()), 1),
                    "memory_used_mb": round(float(row[3].strip()), 1),
                    "utilization_percent": round(float(row[4].strip()), 1),
                    "temperature_c": round(float(row[5].strip()), 1),
                }
            )
        except ValueError:
            malformed = True

    if not devices:
        return {
            "available": False,
            "reason": "resposta malformada" if malformed else "nenhuma GPU reportada",
            "devices": [],
        }
    result = {"available": True, "devices": devices}
    if malformed:
        result["reason"] = "algumas linhas foram ignoradas por formato inválido"
    return result


def get_system_info(*, settings: Settings) -> dict:
    per_core = psutil.cpu_percent(interval=0.2, percpu=True) or []
    usage = round(sum(per_core) / len(per_core), 1) if per_core else 0.0

    try:
        load = [round(value, 2) for value in os.getloadavg()]
    except (OSError, AttributeError):
        load = None

    memory = psutil.virtual_memory()
    swap = psutil.swap_memory()

    return {
        "cpu": {
            "model": _cpu_model(),
            "cores_logical": psutil.cpu_count(logical=True),
            "cores_physical": psutil.cpu_count(logical=False),
            "usage_percent": usage,
            "per_core_percent": [round(value, 1) for value in per_core],
            "load_average": load,
        },
        "memory": {
            "total_mb": _round_mb(memory.total),
            "used_mb": _round_mb(memory.used),
            "available_mb": _round_mb(memory.available),
            "percent": memory.percent,
        },
        "swap": {
            "total_mb": _round_mb(swap.total),
            "used_mb": _round_mb(swap.used),
            "percent": swap.percent,
        },
        "gpu": _gpu_info(settings),
    }


def get_disk_usage(*, settings: Settings) -> dict:
    mounts: list[dict] = []
    seen: set[str] = set()
    for partition in psutil.disk_partitions(all=False):
        if len(mounts) >= 20:
            break
        mountpoint = partition.mountpoint
        if not mountpoint or mountpoint in seen:
            continue
        if partition.fstype.lower() in PSEUDO_FILESYSTEMS:
            continue
        try:
            usage = psutil.disk_usage(mountpoint)
        except (PermissionError, OSError):
            continue
        seen.add(mountpoint)
        mounts.append(
            {
                "device": partition.device,
                "mountpoint": mountpoint,
                "fstype": partition.fstype,
                "total_gb": round(usage.total / (1024**3), 1),
                "used_gb": round(usage.used / (1024**3), 1),
                "free_gb": round(usage.free / (1024**3), 1),
                "percent": usage.percent,
            }
        )
    return {"mounts": mounts, "count": len(mounts)}


def list_processes(
    sort_by: str = "cpu",
    limit: int | None = None,
    *,
    settings: Settings,
) -> dict:
    if sort_by not in {"cpu", "memory"}:
        raise ToolError("invalid_args", "sort_by deve ser 'cpu' ou 'memory'.")
    if limit is None:
        limit = settings.process_list_default_limit
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        raise ToolError("invalid_args", "limit deve ser um inteiro.") from None
    limit = max(1, min(limit, settings.process_list_max_limit))

    processes = list(
        psutil.process_iter(["pid", "name", "username", "status", "memory_info"])
    )
    for process in processes:
        try:
            process.cpu_percent(None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    time.sleep(0.2)

    items: list[dict] = []
    for process in processes:
        try:
            info = process.info
            cpu_percent = process.cpu_percent(None)
            memory_info = info.get("memory_info") or process.memory_info()
            items.append(
                {
                    "pid": info.get("pid"),
                    "name": info.get("name") or "desconhecido",
                    "username": info.get("username"),
                    "status": info.get("status"),
                    "cpu_percent": round(cpu_percent, 1),
                    "memory_mb": _round_mb(memory_info.rss),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
            continue

    sort_key = "cpu_percent" if sort_by == "cpu" else "memory_mb"
    items.sort(key=lambda item: item[sort_key], reverse=True)
    selected = items[:limit]
    return {
        "sort_by": sort_by,
        "limit": limit,
        "total_processes": len(items),
        "count": len(selected),
        "processes": selected,
    }


def get_current_datetime(*, settings: Settings) -> dict:
    local = datetime.now().astimezone()
    utc = datetime.now(timezone.utc)
    offset = local.utcoffset()
    if offset is None:
        offset_label = "desconhecido"
    else:
        total_seconds = int(offset.total_seconds())
        sign = "+" if total_seconds >= 0 else "-"
        hours, remainder = divmod(abs(total_seconds), 3600)
        minutes = remainder // 60
        offset_label = f"{sign}{hours:02d}:{minutes:02d}"

    weekdays = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
                "sexta-feira", "sábado", "domingo"]
    return {
        "local_iso": local.isoformat(timespec="seconds"),
        "utc_iso": utc.isoformat(timespec="seconds"),
        "local_pt_br": local.strftime("%d/%m/%Y %H:%M:%S"),
        "date_pt_br": local.strftime("%d/%m/%Y"),
        "time_pt_br": local.strftime("%H:%M:%S"),
        "weekday_pt_br": weekdays[local.weekday()],
        "timezone": local.tzname() or "desconhecido",
        "utc_offset": offset_label,
    }
