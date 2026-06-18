#!/bin/bash
# Diagnostico rapido cuando catastro-api no arranca (503 en visor).

API_DIR="${1:-/opt/catastro_api}"
PY="${API_DIR}/venv/bin/python3"

echo "=== Directorio API: ${API_DIR} ==="
cd "${API_DIR}" || exit 1

echo ""
echo "=== 1) RPPC_LOGIN_PATH en config.py ==="
grep -n "RPPC_LOGIN_PATH" config.py || echo "FALTA: agregar RPPC_LOGIN_PATH en config.py"

echo ""
echo "=== 2) Archivos criticos ==="
ls -la config.py main.py auth/sessions.py routers/pducp_consulta.py routers/rppc.py 2>/dev/null || true

echo ""
echo "=== 3) import config ==="
"${PY}" -c "import config; print('config OK'); print('RPPC_LOGIN_PATH =', repr(getattr(config, 'RPPC_LOGIN_PATH', 'NO EXISTE'))); print('SESSION_INACTIVIDAD =', getattr(config, 'SESSION_INACTIVITY_MINUTES', 'NO EXISTE'))"

echo ""
echo "=== 4) import routers (uno por uno) ==="
for mod in auth.sessions auth.routes routers.pducp_consulta routers.rppc routers.padron; do
  echo -n "  ${mod} ... "
  if "${PY}" -c "import ${mod}; print('OK')"; then
    :
  else
    echo "FALLO"
  fi
done

echo ""
echo "=== 5) import main ==="
"${PY}" -c "import main; print('main OK')"

echo ""
echo "=== 6) servicio systemd ==="
systemctl is-active catastro-api 2>/dev/null || true
systemctl status catastro-api --no-pager -l 2>/dev/null | tail -n 15 || true

echo ""
echo "=== 7) ultimos logs ==="
journalctl -u catastro-api -n 25 --no-pager 2>/dev/null || true

echo ""
echo "=== 8) curl local puerto 9000 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:9000/ || echo "sin respuesta en :9000"
