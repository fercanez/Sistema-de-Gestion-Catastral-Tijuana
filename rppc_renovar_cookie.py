#!/usr/bin/env python3
"""Renueva la cookie RPPC en .runtime/rppc_cookie.txt vía login API (sin Playwright).

Uso en servidor:
  cd /opt/catastro_tijuana_api
  ./venv/bin/python3 rppc_renovar_cookie.py

Requiere en .env: SECRET_KEY, RPPC_USUARIO, RPPC_PASSWORD (cuenta enlace remoto RPPC).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
os.chdir(APP_DIR)
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from dotenv import load_dotenv

load_dotenv(APP_DIR / ".env")

from routers import rppc


def _cookie_line_desde_jar() -> str | None:
    jar = rppc._rppc_cookie_jar
    if not jar:
        return None
    partes: list[str] = []
    aspnet: str | None = None
    for cookie in jar:
        par = f"{cookie.name}={cookie.value}"
        partes.append(par)
        if cookie.name == ".AspNet.ApplicationCookie":
            aspnet = par
    if aspnet:
        return aspnet
    return "; ".join(partes) if partes else None


def main() -> int:
    if not (rppc.RPPC_USUARIO and rppc.RPPC_PASSWORD):
        print("ERROR: configure RPPC_USUARIO y RPPC_PASSWORD en .env")
        return 1

    destino = Path(rppc.RPPC_RUNTIME_COOKIE_FILE)
    destino.parent.mkdir(parents=True, exist_ok=True)

    rppc._reset_rppc_opener()
    rppc._rppc_login_ok = None
    opener = rppc._build_opener(force_new=True, skip_login=True)
    rppc._cargar_apis_rppc(opener, 3454)

    ok = rppc._intentar_login_rppc(opener)
    if not ok:
        print("ERROR: login RPPC falló.")
        for item in (rppc._rppc_login_detalle or [])[:8]:
            print(f"  - {item.get('url')} [{item.get('modo')}] http={item.get('http')} ok={item.get('ok')}")
            if item.get("preview"):
                print(f"    {str(item.get('preview'))[:200]}")
        return 1

    linea = _cookie_line_desde_jar()
    if not linea or ".AspNet.ApplicationCookie=" not in linea:
        print("ERROR: login aparentemente OK pero no hay .AspNet.ApplicationCookie en CookieJar.")
        print(f"  cookies jar: {rppc._resumen_cookies_rppc()}")
        print(f"  usuario_id={rppc._rppc_usuario_id} token={bool(rppc._rppc_auth_token)}")
        return 1

    destino.write_text(linea.strip() + "\n", encoding="utf-8")
    print(f"OK: cookie guardada en {destino}")
    print(f"  usuario_id={rppc._rppc_usuario_id}  token={bool(rppc._rppc_auth_token)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
