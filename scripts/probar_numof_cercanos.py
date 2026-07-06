#!/usr/bin/env python3
"""Prueba GET /padron/{clave}/numeros-oficiales-cercanos con login JWT."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main() -> int:
    base = os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:9001").rstrip("/")
    clave = (os.getenv("SMOKE_CLAVE") or "XL701261").strip().upper()
    usuario = os.getenv("SMOKE_ADMIN_USER", os.getenv("CATASTRO_USER", "")).strip()
    password = os.getenv("SMOKE_ADMIN_PASS", os.getenv("CATASTRO_PASS", ""))

    if len(sys.argv) > 1:
        clave = sys.argv[1].strip().upper()
    if len(sys.argv) > 2:
        usuario = sys.argv[2].strip()
    if len(sys.argv) > 3:
        password = sys.argv[3]

    if not usuario or not password:
        print(
            "Defina credenciales:\n"
            "  export SMOKE_ADMIN_USER=admin\n"
            "  export SMOKE_ADMIN_PASS='su_clave'\n"
            "  ./venv/bin/python3 scripts/probar_numof_cercanos.py XL701261",
            file=sys.stderr,
        )
        return 2

    login_body = json.dumps({"usuario": usuario, "password": password}).encode("utf-8")
    login_req = urllib.request.Request(
        f"{base}/login",
        data=login_body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(login_req, timeout=30) as resp:
            login_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        print(f"Login falló HTTP {exc.code}: {err}", file=sys.stderr)
        return 1

    token = login_data.get("access_token")
    if not token:
        print("Login sin access_token", file=sys.stderr)
        return 1

    qs = urllib.parse.urlencode({
        "limite_misma_calle": 25,
        "limite_otras_calles": 10,
    })
    url = f"{base}/padron/{urllib.parse.quote(clave)}/numeros-oficiales-cercanos?{qs}"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}\n{err}", file=sys.stderr)
        return 1

    if "detail" in data and "total" not in data:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 1

    print(f"clave={data.get('clave_catastral')} origen={data.get('origen')}")
    print(f"total={data.get('total')} misma_calle={data.get('total_misma_calle')} otras={data.get('total_otras_calles')}")
    cercanos = data.get("cercanos") or []
    for i, c in enumerate(cercanos[:10], 1):
        num = "-".join(
            x for x in [c.get("numof"), c.get("numint"), c.get("letra")] if str(x or "").strip()
        )
        col = "C" if c.get("es_colindante") else ("F" if c.get("es_enfrente") else " ")
        print(f"  {i}. [{col}] {c.get('clave_catastral')}  {num}  {c.get('calle')}  {c.get('distancia_m')}m")
    if len(cercanos) > 10:
        print(f"  ... y {len(cercanos) - 10} más")
    return 0 if (data.get("total") or 0) > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
