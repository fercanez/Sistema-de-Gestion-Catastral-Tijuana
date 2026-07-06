#!/usr/bin/env bash
# Wrapper: corrección de encoding en nombres (IBA?EZ → IBAÑEZ)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PY="${ROOT}/venv/bin/python3"
if [[ ! -x "$PY" ]]; then
  PY=python3
fi
exec "$PY" scripts/corregir_encoding_nombres_padron.py "$@"
