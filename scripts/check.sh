#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

if [[ -x .venv/bin/python ]]; then
  PYTHON=".venv/bin/python"
else
  PYTHON="python3"
fi

echo "== pytest =="
"$PYTHON" -m pytest -q

echo "== compileall =="
"$PYTHON" -m compileall -q app tests

echo "== frontend build =="
cd "$ROOT/frontend"
npm run build
