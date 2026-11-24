#!/usr/bin/env python3
"""Smoke test real do backend (somente stdlib).

Uso:
    python3 scripts/smoke.py
    python3 scripts/smoke.py --base http://127.0.0.1:8765
    python3 scripts/smoke.py --skip-chat
"""

import argparse
import json
import sys
import urllib.error
import urllib.request


def request(base: str, path: str, payload: dict | None = None, timeout: float = 30.0):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test do Mestre")
    parser.add_argument("--base", default="http://127.0.0.1:8765")
    parser.add_argument("--skip-chat", action="store_true")
    parser.add_argument("--timeout", type=float, default=200.0)
    args = parser.parse_args()
    base = args.base.rstrip("/")

    failures = []
    warnings = []

    try:
        status, health = request(base, "/health", timeout=10)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"FALHA: backend inacessível em {base}: {exc}")
        return 1

    print(f"health HTTP {status}")
    print(json.dumps(health, ensure_ascii=False, indent=2))
    if health.get("backend") != "ok":
        failures.append("backend não reportou ok")
    if health.get("database") != "ok":
        failures.append("banco de dados indisponível")
    if not health.get("model_available"):
        warnings.append("modelo local não disponível")

    try:
        _, tools = request(base, "/tools", timeout=10)
        print(f"tools: {tools.get('tools', [])}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        warnings.append(f"/tools indisponível: {exc}")

    if not args.skip_chat:
        if not health.get("model_available"):
            failures.append("chat solicitado, mas o modelo não está disponível")
        else:
            try:
                status, chat = request(
                    base,
                    "/chat",
                    {"message": "Responda apenas com a palavra ok."},
                    timeout=args.timeout,
                )
                print(f"chat HTTP {status}")
                print(json.dumps(chat, ensure_ascii=False, indent=2))
                if not chat.get("reply"):
                    failures.append("resposta do chat vazia")
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                failures.append(f"chat HTTP {exc.code}: {detail}")
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                failures.append(f"chat falhou: {exc}")

    for warning in warnings:
        print(f"AVISO: {warning}")
    for failure in failures:
        print(f"FALHA: {failure}")
    if failures:
        return 1
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
