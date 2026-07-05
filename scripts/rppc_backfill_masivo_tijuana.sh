#!/bin/bash
# Wrapper: usa el venv de la API (mismas dependencias que uvicorn).
set -euo pipefail
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="${API_DIR}/venv/bin/python3"
SCRIPT="${API_DIR}/scripts/rppc_backfill_masivo_tijuana.py"

if [[ ! -x "${PY}" ]]; then
  echo "No existe ${PY}. Cree el venv de la API primero." >&2
  exit 2
fi

exec "${PY}" "${SCRIPT}" "$@"
