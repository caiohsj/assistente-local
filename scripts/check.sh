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

echo "== frontend tests =="
cd "$ROOT/frontend"
npm test

echo "== frontend build =="
npm run build

if command -v cargo >/dev/null 2>&1; then
  echo "== rust check =="
  cargo check --manifest-path "$ROOT/frontend/src-tauri/Cargo.toml"
else
  echo "== rust check =="
  echo "cargo não encontrado; etapa Rust ignorada"
fi
