#!/bin/bash
# Instala timer systemd para backfill RPPC (padrón Tijuana).
# Uso: sudo ./scripts/install_rppc_backfill_timer.sh
set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="${API_DIR}/deploy/systemd"
DEST="/etc/systemd/system"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecute con sudo: sudo $0" >&2
  exit 1
fi

for f in catastro-rppc-backfill.service catastro-rppc-backfill.timer; do
  if [[ ! -f "${UNIT_DIR}/${f}" ]]; then
    echo "Falta ${UNIT_DIR}/${f}" >&2
    exit 1
  fi
  sed 's/\r$//' "${UNIT_DIR}/${f}" > "${DEST}/${f}"
  echo "Instalado ${DEST}/${f}"
done

ENV_FILE="${API_DIR}/.env.rppc-backfill"
if [[ ! -f "${ENV_FILE}" ]] && [[ -f "${UNIT_DIR}/env.rppc-backfill.example" ]]; then
  cp "${UNIT_DIR}/env.rppc-backfill.example" "${ENV_FILE}"
  echo "Creado ${ENV_FILE} (edite limite/nivel si lo necesita)"
fi

systemctl daemon-reload
systemctl enable catastro-rppc-backfill.timer
systemctl start catastro-rppc-backfill.timer

echo ""
echo "Timer activo. Próxima ejecución:"
systemctl list-timers catastro-rppc-backfill.timer --no-pager
echo ""
echo "Comandos útiles:"
echo "  sudo systemctl start --no-block catastro-rppc-backfill.service   # un lote ahora (no bloquea)"
echo "  sudo journalctl -u catastro-rppc-backfill -f          # ver log"
echo "  ./venv/bin/python3 scripts/rppc_backfill_masivo_tijuana.py --resumen"
