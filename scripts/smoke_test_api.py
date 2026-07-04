#!/usr/bin/env python3
"""
Smoke test post-despliegue para la API catastral (BT-019 / BT-020).

Valida endpoints publicos, autenticacion y controles ACL por rol.

Uso:
  python scripts/smoke_test_api.py

Variables de entorno:
  SMOKE_BASE_URL     Base de la API (default: http://127.0.0.1:9001)
                     Si hay proxy con root_path, incluir prefijo:
                     http://host/api/catastro-tijuana
  SMOKE_CLAVE        Clave catastral de prueba (opcional; activa pruebas prediales)
  SMOKE_TIMEOUT      Segundos por peticion (default: 15)

Credenciales por rol (opcionales; se omiten pruebas del rol si faltan):
  SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS
  SMOKE_SUPERVISOR_USER / SMOKE_SUPERVISOR_PASS
  SMOKE_CATASTRO_USER / SMOKE_CATASTRO_PASS
  SMOKE_CARTOGRAFIA_USER / SMOKE_CARTOGRAFIA_PASS
  SMOKE_FISCALIZACION_USER / SMOKE_FISCALIZACION_PASS
  SMOKE_CONSULTA_USER / SMOKE_CONSULTA_PASS

Codigos de salida: 0 = OK, 1 = fallos, 2 = error de configuracion/conexion base.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class SmokeRunner:
    base_url: str
    timeout: float = 15.0
    clave: str = ""
    tokens: dict[str, str] = field(default_factory=dict)
    results: list[Result] = field(default_factory=list)

    def _url(self, path: str) -> str:
        base = self.base_url.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        return base + path

    def request(
        self,
        method: str,
        path: str,
        *,
        token: Optional[str] = None,
        expect: Optional[int] = None,
        check: Optional[Callable[[int, dict | bytes, dict], Optional[str]]] = None,
    ) -> tuple[int, dict | bytes, dict]:
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(self._url(path), method=method.upper(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read()
            ctype = exc.headers.get("Content-Type", "")
        except urllib.error.URLError as exc:
            raise ConnectionError(f"No se pudo conectar a {self._url(path)}: {exc}") from exc

        body: dict | bytes = raw
        if "application/json" in ctype:
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                body = raw
        return status, body, {"Content-Type": ctype}

    def record(self, name: str, ok: bool, detail: str = "") -> None:
        self.results.append(Result(name, ok, detail))
        mark = "OK" if ok else "FAIL"
        line = f"[{mark}] {name}"
        if detail:
            line += f" — {detail}"
        print(line)

    def expect_status(self, name: str, method: str, path: str, expected: int, *, token: Optional[str] = None) -> None:
        try:
            status, _, _ = self.request(method, path, token=token)
            self.record(name, status == expected, f"HTTP {status} (esperado {expected})")
        except ConnectionError as exc:
            self.record(name, False, str(exc))

    def login(self, role: str, usuario: str, password: str) -> None:
        name = f"login:{role}"
        try:
            payload = json.dumps({"usuario": usuario, "password": password}).encode("utf-8")
            req = urllib.request.Request(
                self._url("/login"),
                data=payload,
                method="POST",
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            token = data.get("access_token")
            if not token:
                self.record(name, False, "sin access_token")
                return
            self.tokens[role] = token
            rol_resp = data.get("rol", "?")
            self.record(name, True, f"rol={rol_resp}")
        except urllib.error.HTTPError as exc:
            self.record(name, False, f"HTTP {exc.code}")
        except ConnectionError as exc:
            self.record(name, False, str(exc))

    def run_anonymous(self) -> None:
        print("\n== Pruebas sin autenticacion ==")
        self.expect_status("root operando", "GET", "/", 200)
        self.expect_status("documentos bloqueados", "GET", "/documentos/000000/ejemplo.pdf", 401)
        self.expect_status("tiles bloqueados", "GET", "/tiles/predios/0/0/0.pbf", 401)
        self.expect_status("ficha bloqueada", "GET", "/padron/000000/ficha", 401)
        self.expect_status("me bloqueado", "GET", "/me", 401)

    def run_role_acl(self, role: str, token: str) -> None:
        print(f"\n== ACL rol: {role} ==")
        clave = self.clave or "000000"
        clave_q = urllib.parse.quote(clave, safe="")

        matrix: list[tuple[str, str, str, int]] = [
            ("me", "GET", "/me", 200),
            ("movimientos listar", "GET", "/movimientos?limite=1", 200 if role != "anon" else 401),
            ("catalogos calles buscar", "GET", "/catalogos/calles/mantenimiento/buscar?q=A&limite=1", 200),
        ]

        if self.clave:
            matrix.extend([
                ("ficha predial", "GET", f"/padron/{clave_q}/ficha", 200),
                ("propietarios predio", "GET", f"/predios/{clave_q}/propietarios", 200),
                ("historial expediente", "GET", f"/expediente/{clave_q}/historial", 200),
                ("documentos listado", "GET", f"/expediente/{clave_q}/documentos", 200),
            ])

        allow_fiscal = role in ("admin", "supervisor", "fiscalizacion")
        allow_carto = role in ("admin", "supervisor", "cartografia")
        allow_admin = role == "admin"
        allow_auditoria = role in ("admin", "supervisor")
        allow_escritura_cat = role in ("admin", "supervisor", "catastro")

        matrix.extend([
            ("dashboard fiscal", "GET", "/dashboard-fiscal", 200 if allow_fiscal else 403),
            ("dashboard cartografico", "GET", "/dashboard-cartografico", 200 if allow_carto else 403),
            ("control cartografico", "GET", "/control-cartografico/estadisticas", 200 if allow_carto else 403),
            ("admin auditoria", "GET", "/admin/auditoria?limite=1", 200 if allow_auditoria else 403),
            ("admin usuarios", "GET", "/admin/usuarios", 200 if allow_admin else 403),
            ("catalogos calles POST sin body", "POST", "/catalogos/calles", 403 if not allow_escritura_cat else 422),
        ])

        for name, method, path, expected in matrix:
            self.expect_status(f"{role}:{name}", method, path, expected, token=token)

        # Matriz ACL en /seguridad/permisos solo para admin
        try:
            status, body, _ = self.request("GET", "/seguridad/permisos", token=token)
            if isinstance(body, dict):
                tiene_matriz = "matriz" in body
                ok = (role == "admin" and tiene_matriz) or (role != "admin" and not tiene_matriz)
                self.record(
                    f"{role}:permisos sin filtrar matriz",
                    ok,
                    f"HTTP {status}, matriz={'si' if tiene_matriz else 'no'}",
                )
            else:
                self.record(f"{role}:permisos sin filtrar matriz", False, f"HTTP {status}")
        except ConnectionError as exc:
            self.record(f"{role}:permisos sin filtrar matriz", False, str(exc))

    def run_all(self) -> int:
        print(f"Smoke test API — {self.base_url}")
        if self.clave:
            print(f"Clave de prueba: {self.clave}")
        else:
            print("Clave de prueba: (no definida; pruebas prediales omitidas)")

        try:
            self.run_anonymous()
        except ConnectionError as exc:
            print(f"\nERROR: {exc}", file=sys.stderr)
            return 2

        roles = ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion", "consulta"]
        for role in roles:
            user = os.getenv(f"SMOKE_{role.upper()}_USER", "").strip()
            pwd = os.getenv(f"SMOKE_{role.upper()}_PASS", "")
            if not user or not pwd:
                print(f"\n== Rol {role}: omitido (sin SMOKE_{role.upper()}_USER/PASS) ==")
                continue
            self.login(role, user, pwd)
            token = self.tokens.get(role)
            if token:
                self.run_role_acl(role, token)

        failed = [r for r in self.results if not r.ok]
        passed = len(self.results) - len(failed)
        print(f"\nResumen: {passed}/{len(self.results)} OK, {len(failed)} fallos")
        return 1 if failed else 0


def main() -> None:
    base = os.getenv("SMOKE_BASE_URL", "http://127.0.0.1:9001").strip()
    clave = os.getenv("SMOKE_CLAVE", "").strip()
    timeout = float(os.getenv("SMOKE_TIMEOUT", "15"))
    runner = SmokeRunner(base_url=base, timeout=timeout, clave=clave)
    sys.exit(runner.run_all())


if __name__ == "__main__":
    main()
