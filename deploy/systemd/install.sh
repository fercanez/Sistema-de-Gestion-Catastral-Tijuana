#!/bin/bash
# Instala timer systemd para backfill RPPC (padrón Tijuana).
# Ejecutar desde la raíz del repo: sudo ./deploy/systemd/install.sh
set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="/etc/systemd/system"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecute con sudo: sudo $0" >&2
  exit 1
fi

for f in catastro-rppc-backfill.service catastro-rppc-backfill.timer; do
  sed 's/\r$//' "${UNIT_DIR}/${f}" > "${DEST}/${f}"
  echo "Instalado ${DEST}/${f}"
done

ENV_FILE="${API_DIR}/.env.rppc-backfill"
if [[ ! -f "${ENV_FILE}" ]] && [[ -f "${UNIT_DIR}/env.rppc-backfill.example" ]]; then
  cp "${UNIT_DIR}/env.rppc-backfill.example" "${ENV_FILE}"
  echo "Creado ${ENV_FILE}"
fi

systemctl daemon-reload
systemctl enable catastro-rppc-backfill.timer
systemctl start catastro-rppc-backfill.timer

echo ""
echo "Timer activo:"
systemctl list-timers catastro-rppc-backfill.timer --no-pager
echo ""
echo "IMPORTANTE: un lote de 200 claves puede tardar HORAS."
echo "Para lanzar uno sin bloquear la terminal:"
echo "  sudo systemctl start --no-block catastro-rppc-backfill.service"
echo ""
echo "Ver progreso en otra sesión SSH:"
echo "  sudo journalctl -u catastro-rppc-backfill -f"
