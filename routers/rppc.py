"""Proxy de consulta al RPPC de Baja California (folio real → PDF)."""
import html as html_lib
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth.dependencies import obtener_usuario_actual
from config import (
    RPPC_BASE_URL,
    RPPC_COOKIE,
    RPPC_DOCUMENTO_ACTION,
    RPPC_INSCRIPCIONES_ACTION,
    RPPC_LOGIN_PATH,
    RPPC_MOVIMIENTOS_ACTION,
    RPPC_PASSWORD,
    RPPC_REPORTES_PREFIX,
    RPPC_SESSION_PATH,
    RPPC_SSL_LEGACY,
    RPPC_SSL_MIN_TLS,
    RPPC_SSL_SECLEVEL,
    RPPC_TIMEOUT_GET,
    RPPC_TIMEOUT_POST,
    RPPC_USUARIO,
)
from database import get_conn, asegurar_columna_folio_real_padron

router = APIRouter(prefix="/rppc", tags=["rppc"])

RPPC_UA = "SGC-Catastro-Mexicali/1.0 (+consulta-interna)"
RPPC_RUNTIME_COOKIE_FILE = os.getenv(
    "RPPC_RUNTIME_COOKIE_FILE",
    "/opt/catastro_api/.runtime/rppc_cookie.txt",
)
RPPC_RENOVAR_COOKIE_SCRIPT = os.getenv(
    "RPPC_RENOVAR_COOKIE_SCRIPT",
    "/opt/catastro_api/rppc_renovar_cookie.py",
)
_rppc_opener: urllib.request.OpenerDirector | None = None
_rppc_login_ok: bool | None = None
_rppc_login_detalle: list[dict[str, Any]] = []
_rppc_working_reportes_prefix: str | None = None
_rppc_working_movimientos_action: str | None = None
_rppc_working_movimientos_url: str | None = None
_rppc_working_login_url: str | None = None
_rppc_working_inscripciones_url: str | None = None
_rppc_working_documento_url: str | None = None
_rppc_working_documento_method: str = "GET"
_rppc_apis_cache: list[dict[str, Any]] = []
_rppc_auth_token: str | None = None
_rppc_usuario_id: int | None = None
_rppc_cookie_jar: CookieJar | None = None
_rppc_last_help_error: str | None = None

RPPC_API_PRIORIDAD: dict[str, list[tuple[str, str]]] = {
    "movimientos": [
    ("POST", "obtenerMovimientosLote"),
    ("POST", "ObtenerMovimientosLote"),
    ("POST", "obtenerLotesMemoria"),
    ("POST", "ObtenerLoteByFolioReal"),
    ("GET", "ObtenerLoteByFolioReal"),
    ("POST", "ObtenerInscripLote"),
    ("GET", "ObtenerInscripLote"),
],
    "inscripciones": [
        ("POST", "obtenerInscripcionesPart"),
    ],
    "documento": [
        ("GET", "ObtenerDocumentoPorId"),
        ("GET", "obtienepdfinscripcion"),
    ],
    "login": [
        ("POST", "autentificarRemoto"),
        ("POST", "AutenticarUsuario"),
        ("POST", "autenticarUsuario"),
        ("POST", "Login"),
        ("POST", "ValidarUsuario"),
        ("POST", "IniciarSesion"),
    ],
}
RPPC_BASE_URL_CANDIDATES = [
    RPPC_BASE_URL,
    "https://rppcweb.ebajacalifornia.gob.mx/Rppweb/Produccion",
    "https://rppcweb.ebajacalifornia.gob.mx/rppweb/produccion",
]
RPPC_REPORTES_PREFIX_CANDIDATES = [
    "/WebAPI/Servicios/Reportes",
    "/WebAPI/Reportes",
    "/WebAPI/Servicios/reportes",
]
RPPC_MOVIMIENTOS_ACTION_CANDIDATES = [
    "obtenerMovimientosLote",
    "ObtenerMovimientosLote",
    "obtenerLotesMemoria",
    "ObtenerLoteByFolioReal",
    "ObtenerInscripLote",
]
RPPC_LOGIN_PATH_CANDIDATES = [
    "/WebAPI/Servicios/Seguridad/AutenticarUsuario",
    "/WebAPI/Servicios/Seguridad/autenticarUsuario",
    "/WebAPI/Servicios/Seguridad/Login",
    "/WebAPI/Servicios/Seguridad/ValidarUsuario",
    "/WebAPI/Seguridad/AutenticarUsuario",
]
# Rutas confirmadas en /WebAPI/Help (respaldo si falla el parseo del HTML)
RPPC_APIS_FALLBACK: list[tuple[str, str]] = [
    ("POST", "Servicios/ConsultaAvanzada/consultaInmuebles"),
    ("POST", "Servicios/ConsultaAvanzada/obtenerMovimientosLote"),
    ("POST", "Servicios/Reportes/obtenerMovimientosLote"),
    ("POST", "Servicios/Reportes/ObtenerMovimientosLote"),
    ("POST", "Servicios/Notarios/ObtenerLoteByFolioReal"),
    ("POST", "Servicios/Reportes/obtenerInscripcionesPart"),
    ("GET", "Servicios/Reportes/ObtenerDocumentoPorId"),
    ("GET", "servicios/reportes/obtienepdfinscripcion/{partida_id}"),
]

def _normalizar_clave(clave_catastral: str) -> str:
    return re.sub(r"\s+", "", str(clave_catastral or "").strip().upper())


def _clave_sgc_a_rppc(clave_catastral: str) -> str:
    """Convierte la clave interna sin guiones al formato que usa RPPC.

    Ejemplos:
    ST312031  -> ST-312-031
    SP025002  -> SP-025-002
    BDM001003 -> BDM-001-003
    """
    clave = re.sub(r"[^A-Za-z0-9]", "", str(clave_catastral or "")).upper()
    if len(clave) == 8:
        return f"{clave[:2]}-{clave[2:5]}-{clave[5:8]}"
    if len(clave) == 9:
        return f"{clave[:3]}-{clave[3:6]}-{clave[6:9]}"
    return clave_catastral.strip().upper() if clave_catastral else ""


def _normalizar_numero(valor):
    if valor is None:
        return None
    txt = str(valor).strip()
    if txt.endswith(".0"):
        txt = txt[:-2]
    return int(txt) if txt.isdigit() else None


def _mensaje_url_error(exc: urllib.error.URLError) -> str:
    reason = getattr(exc, "reason", exc)
    return str(reason) if reason is not None else str(exc)


def _join_rppc_url(base: str, path: str) -> str:
    base = (base or "").rstrip("/")
    path = (path or "").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{base}{path}"


def _reportes_action_url(
    action: str,
    *,
    base: str | None = None,
    prefix: str | None = None,
) -> str:
    base_url = (base or RPPC_BASE_URL).rstrip("/")
    reportes_prefix = (prefix or _rppc_working_reportes_prefix or RPPC_REPORTES_PREFIX).strip("/")
    action_name = (action or "").strip("/")
    return _join_rppc_url(base_url, f"/{reportes_prefix}/{action_name}")


def _crear_ssl_context_rppc() -> ssl.SSLContext:
    """Contexto TLS compatible con servidores RPPC antiguos (OpenSSL 3 / Ubuntu)."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.load_default_certs()
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED

    try:
        ctx.set_ciphers(f"DEFAULT:@SECLEVEL={RPPC_SSL_SECLEVEL}")
    except ssl.SSLError:
        pass

    if hasattr(ssl, "OP_LEGACY_SERVER_CONNECT"):
        ctx.options |= ssl.OP_LEGACY_SERVER_CONNECT

    if RPPC_SSL_MIN_TLS == "1.0" and hasattr(ssl.TLSVersion, "TLSv1"):
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    elif RPPC_SSL_MIN_TLS == "1.1" and hasattr(ssl.TLSVersion, "TLSv1_1"):
        ctx.minimum_version = ssl.TLSVersion.TLSv1_1
    else:
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2

    return ctx


def _reset_rppc_opener():
    global _rppc_opener, _rppc_login_ok, _rppc_login_detalle
    global _rppc_working_reportes_prefix, _rppc_working_movimientos_action
    global _rppc_working_movimientos_url, _rppc_working_login_url
    global _rppc_working_inscripciones_url, _rppc_working_documento_url
    global _rppc_working_documento_method, _rppc_apis_cache, _rppc_last_help_error
    global _rppc_auth_token, _rppc_cookie_jar, _rppc_usuario_id
    _rppc_opener = None
    _rppc_login_ok = None
    _rppc_login_detalle = []
    _rppc_working_reportes_prefix = None
    _rppc_working_movimientos_action = None
    _rppc_working_movimientos_url = None
    _rppc_working_login_url = None
    _rppc_working_inscripciones_url = None
    _rppc_working_documento_url = None
    _rppc_working_documento_method = "GET"
    _rppc_apis_cache = []
    _rppc_last_help_error = None
    _rppc_auth_token = None
    _rppc_usuario_id = None
    _rppc_cookie_jar = None


def _preflight_rppc_session(opener: urllib.request.OpenerDirector) -> dict[str, Any]:
    if not RPPC_SESSION_PATH:
        return {"intentado": False, "http": None, "error": None}
    url = _join_rppc_url(RPPC_BASE_URL, RPPC_SESSION_PATH)
    req = urllib.request.Request(
        url,
        headers={"Accept": "text/html,application/json,*/*", "User-Agent": RPPC_UA},
        method="GET",
    )
    try:
        with opener.open(req, timeout=RPPC_TIMEOUT_GET) as resp:
            return {"intentado": True, "http": resp.getcode(), "error": None}
    except urllib.error.HTTPError as exc:
        return {"intentado": True, "http": exc.code, "error": exc.reason}
    except urllib.error.URLError as exc:
        return {"intentado": True, "http": None, "error": _mensaje_url_error(exc)}


def _extraer_token_login(parsed: dict[str, Any]) -> str | None:
    for key in ("token", "Token", "access_token", "AccessToken", "jwt", "JWT", "SessionId", "sessionId"):
        val = parsed.get(key)
        if isinstance(val, str) and len(val) > 8:
            return val
    for contenedor in ("Datos", "datos", "Data", "data", "Resultado", "resultado"):
        datos = parsed.get(contenedor)
        if not isinstance(datos, dict):
            continue
        for key in ("token", "Token", "access_token", "AccessToken", "SessionId", "sessionId"):
            val = datos.get(key)
            if isinstance(val, str) and len(val) > 8:
                return val
    return None


def _rppc_tiene_error(parsed: dict[str, Any]) -> bool:
    if parsed.get("ClassName") and "Excepcion" in str(parsed.get("ClassName")):
        return True
    if parsed.get("IsError") is True:
        return True
    err_msg = parsed.get("ErrMessage") or parsed.get("errMessage") or parsed.get("Message")
    if err_msg and "Object reference not set" in str(err_msg):
        return True
    msg = str(parsed.get("Message") or parsed.get("message") or "").lower()
    if msg and any(palabra in msg for palabra in ("error", "incorrect", "invalid", "fallo", "denegad", "no autoriz")):
        return True
    return False


def _extraer_usuario_id_rppc(parsed: dict[str, Any]) -> int | None:
    datos = parsed.get("Datos") or parsed.get("datos")
    if isinstance(datos, dict):
        for key in ("USUARIO_ID", "Usuario_Id", "usuario_id", "IdUsuario", "idUsuario"):
            uid = _normalizar_numero(datos.get(key))
            if uid and uid > 0:
                return uid
    for key in ("USUARIO_ID", "Usuario_Id", "usuario_id", "IdUsuario", "idUsuario"):
        uid = _normalizar_numero(parsed.get(key))
        if uid and uid > 0:
            return uid
    return None


def _login_respuesta_ok(http: int, body: str, parsed: Any, *, endpoint: str = "") -> bool:
    if http >= 400:
        return False
    if not body.strip() or body.lstrip().startswith("<"):
        return False
    if not isinstance(parsed, dict):
        return False
    if _rppc_tiene_error(parsed):
        return False
    if parsed.get("success") is False or parsed.get("Success") is False:
        return False
    if parsed.get("autenticado") is False or parsed.get("Autenticado") is False:
        return False

    endpoint_lower = endpoint.lower()
    if "buscarusuarioremoto" in endpoint_lower:
        return _extraer_usuario_id_rppc(parsed) is not None

    if parsed.get("success") is True or parsed.get("Success") is True:
        if parsed.get("autenticado") is True or parsed.get("Autenticado") is True:
            return True
        if _extraer_usuario_id_rppc(parsed):
            return True
        if _extraer_token_login(parsed):
            return True
        datos = parsed.get("Datos") or parsed.get("datos")
        if isinstance(datos, dict) and datos:
            if any(datos.get(k) for k in ("Sesion", "sesion", "Token", "token", "NOMBRE", "nombre")):
                return True
        err_msg = parsed.get("ErrMessage") or parsed.get("errMessage")
        if err_msg and str(err_msg).strip():
            return False
        return "autentificar" in endpoint_lower

    if parsed.get("autenticado") is True or parsed.get("Autenticado") is True:
        return True
    if _extraer_token_login(parsed):
        return True
    if _extraer_usuario_id_rppc(parsed) and "autentificar" in endpoint_lower:
        return True
    return False


def _registrar_token_login(parsed: dict[str, Any]) -> None:
    global _rppc_auth_token, _rppc_usuario_id
    token = _extraer_token_login(parsed)
    if token:
        _rppc_auth_token = token
    uid = _extraer_usuario_id_rppc(parsed)
    if uid:
        _rppc_usuario_id = uid


def _post_json_rppc(
    opener: urllib.request.OpenerDirector,
    url: str,
    payload: dict[str, Any],
    *,
    encoding: str = "json",
) -> tuple[int, str, dict[str, Any]]:
    if encoding == "form":
        data = urllib.parse.urlencode(payload).encode("utf-8")
        content_type = "application/x-www-form-urlencoded"
    else:
        data = json.dumps(payload).encode("utf-8")
        content_type = "application/json"
    req = urllib.request.Request(
        url,
        data=data,
        headers=_headers_rppc_auth({
            "Content-Type": content_type,
            "Accept": "application/json",
            "User-Agent": RPPC_UA,
        }),
        method="POST",
    )
    with opener.open(req, timeout=RPPC_TIMEOUT_POST) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        http = resp.getcode()
    parsed: dict[str, Any] = {}
    if body.strip().startswith(("{", "[")):
        try:
            cargado = json.loads(body)
            if isinstance(cargado, dict):
                parsed = cargado
        except json.JSONDecodeError:
            parsed = {}
    return http, body, parsed


def _url_api_por_accion(accion: str) -> str | None:
    api = _buscar_api_por_fragmento(_rppc_apis_cache, accion.lower(), metodo="POST")
    if api:
        return _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
    rutas = {
        "buscarusuarioremoto": "Servicios/AdmonCatalogos/buscarUsuarioRemoto",
        "autentificarremoto": "Servicios/AdmonUsuarios/autentificarRemoto",
    }
    ruta = rutas.get(accion.lower())
    return _url_api_desde_ruta(RPPC_BASE_URL, ruta, solo_base=True) if ruta else None


def _login_enlace_remoto_rppc(opener: urllib.request.OpenerDirector) -> bool:
    """Flujo real del enlace remoto BC: buscar usuario → autentificar."""
    global _rppc_working_login_url, _rppc_usuario_id
    url_buscar = _url_api_por_accion("buscarUsuarioRemoto")
    url_auth = _url_api_por_accion("autentificarRemoto")
    if not url_buscar or not url_auth:
        return False

    payloads_buscar = [
        {"USUARIO": RPPC_USUARIO},
        {"usuario": RPPC_USUARIO},
        {"Usuario": RPPC_USUARIO},
        {"login": RPPC_USUARIO},
        {"NOMBRE_USUARIO": RPPC_USUARIO},
        {"usuarioRemoto": RPPC_USUARIO},
    ]
    usuario_id: int | None = None
    for payload in payloads_buscar:
        for encoding in ("json", "form"):
            try:
                http, body, parsed = _post_json_rppc(opener, url_buscar, payload, encoding=encoding)
                uid = _extraer_usuario_id_rppc(parsed)
                _rppc_login_detalle.append(
                    {
                        "url": url_buscar,
                        "modo": f"buscar-{encoding}",
                        "http": http,
                        "ok": uid is not None,
                        "usuario_id": uid,
                        "token": False,
                        "cookies": len(_resumen_cookies_rppc()),
                        "preview": body[:160],
                    }
                )
                if uid:
                    usuario_id = uid
                    _rppc_usuario_id = uid
                    break
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                _rppc_login_detalle.append(
                    {
                        "url": url_buscar,
                        "modo": f"buscar-{encoding}",
                        "http": exc.code,
                        "ok": False,
                        "usuario_id": None,
                        "token": False,
                        "cookies": len(_resumen_cookies_rppc()),
                        "preview": body[:160] or exc.reason,
                    }
                )
            except Exception as exc:
                _rppc_login_detalle.append(
                    {
                        "url": url_buscar,
                        "modo": f"buscar-{encoding}",
                        "http": None,
                        "ok": False,
                        "usuario_id": None,
                        "token": False,
                        "cookies": len(_resumen_cookies_rppc()),
                        "preview": str(exc)[:160],
                    }
                )
        if usuario_id:
            break

    if not usuario_id:
        return False

    payloads_auth: list[dict[str, Any]] = [
        {"USUARIO_ID": usuario_id, "PASSWORD": RPPC_PASSWORD},
        {"USUARIO_ID": usuario_id, "Password": RPPC_PASSWORD},
        {"USUARIO_ID": usuario_id, "CONTRASENA": RPPC_PASSWORD},
        {"usuarioId": usuario_id, "password": RPPC_PASSWORD},
        {"Usuario_Id": usuario_id, "Password": RPPC_PASSWORD},
        {"USUARIO": RPPC_USUARIO, "PASSWORD": RPPC_PASSWORD},
        {"usuario": RPPC_USUARIO, "password": RPPC_PASSWORD},
        {"USUARIO_ID": usuario_id, "PASSWORD": RPPC_PASSWORD, "remoto": 1},
    ]
    for payload in payloads_auth:
        for encoding in ("json", "form"):
            try:
                http, body, parsed = _post_json_rppc(opener, url_auth, payload, encoding=encoding)
                ok = _login_respuesta_ok(http, body, parsed, endpoint=url_auth)
                if ok:
                    _registrar_token_login(parsed)
                _rppc_login_detalle.append(
                    {
                        "url": url_auth,
                        "modo": f"auth-{encoding}",
                        "http": http,
                        "ok": ok,
                        "usuario_id": usuario_id,
                        "token": bool(_rppc_auth_token),
                        "cookies": len(_resumen_cookies_rppc()),
                        "preview": body[:160],
                    }
                )
                if ok:
                    _rppc_working_login_url = url_auth
                    return True
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                _rppc_login_detalle.append(
                    {
                        "url": url_auth,
                        "modo": f"auth-{encoding}",
                        "http": exc.code,
                        "ok": False,
                        "usuario_id": usuario_id,
                        "token": False,
                        "cookies": len(_resumen_cookies_rppc()),
                        "preview": body[:160] or exc.reason,
                    }
                )
            except Exception as exc:
                _rppc_login_detalle.append(
                    {
                        "url": url_auth,
                        "modo": f"auth-{encoding}",
                        "http": None,
                        "ok": False,
                        "usuario_id": usuario_id,
                        "token": False,
                        "cookies": len(_resumen_cookies_rppc()),
                        "preview": str(exc)[:160],
                    }
                )
    return False


def _cookie_rppc_actual() -> str:
    """Obtiene la cookie RPPC vigente.

    Prioridad:
    1) Cookie renovada automáticamente por Playwright en .runtime/rppc_cookie.txt.
    2) Cookie manual RPPC_COOKIE del .env como respaldo temporal.
    """
    try:
        if RPPC_RUNTIME_COOKIE_FILE:
            with open(RPPC_RUNTIME_COOKIE_FILE, "r", encoding="utf-8") as f:
                cookie = f.read().strip()
            if ".AspNet.ApplicationCookie=" in cookie:
                return cookie
    except Exception:
        pass

    return (RPPC_COOKIE or "").strip()


def _renovar_cookie_rppc_runtime() -> bool:
    """Ejecuta el renovador Playwright y deja la cookie en archivo runtime."""
    if not (RPPC_USUARIO and RPPC_PASSWORD):
        return False
    if not RPPC_RENOVAR_COOKIE_SCRIPT or not os.path.exists(RPPC_RENOVAR_COOKIE_SCRIPT):
        return False

    try:
        resultado = subprocess.run(
            [sys.executable, RPPC_RENOVAR_COOKIE_SCRIPT],
            cwd="/opt/catastro_api",
            text=True,
            capture_output=True,
            timeout=120,
        )
        if resultado.returncode != 0:
            return False
        cookie = _cookie_rppc_actual()
        return ".AspNet.ApplicationCookie=" in cookie
    except Exception:
        return False


def _headers_rppc_auth(headers: dict[str, str]) -> dict[str, str]:
    """Agrega autenticación/cookie RPPC a cualquier request saliente."""
    headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
    headers.setdefault("Referer", "https://rppcweb.ebajacalifornia.gob.mx/rppweb/produccion/")

    cookie = _cookie_rppc_actual()
    if cookie:
        headers["Cookie"] = cookie

    if _rppc_auth_token:
        headers["Authorization"] = f"Bearer {_rppc_auth_token}"
        headers["X-Auth-Token"] = _rppc_auth_token
    return headers


def _resumen_cookies_rppc() -> list[dict[str, str]]:
    if _rppc_cookie_jar is None:
        return []
    return [
        {"name": cookie.name, "domain": cookie.domain or ""}
        for cookie in _rppc_cookie_jar
    ]


def _intentar_login_rppc(opener: urllib.request.OpenerDirector) -> bool:
    global _rppc_login_detalle, _rppc_working_login_url, _rppc_auth_token, _rppc_usuario_id
    _rppc_login_detalle = []
    _rppc_auth_token = None
    _rppc_usuario_id = None

    if not (RPPC_USUARIO and RPPC_PASSWORD):
        return False

    if _login_enlace_remoto_rppc(opener):
        return True

    login_urls: list[str] = []
    for api in _buscar_apis_login(_rppc_apis_cache):
        ruta = api.get("route", "").lower()
        if "buscarusuarioremoto" in ruta:
            continue
        url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        if url not in login_urls:
            login_urls.append(url)
    if _rppc_working_login_url and _rppc_working_login_url not in login_urls:
        login_urls.append(_rppc_working_login_url)
    if RPPC_LOGIN_PATH:
        url = _join_rppc_url(RPPC_BASE_URL, RPPC_LOGIN_PATH)
        if url not in login_urls:
            login_urls.append(url)
    for login_path in RPPC_LOGIN_PATH_CANDIDATES:
        url = _join_rppc_url(RPPC_BASE_URL, login_path)
        if url not in login_urls:
            login_urls.append(url)

    intentos: list[tuple[str, dict[str, str], str]] = [
        ("json", {"Content-Type": "application/json", "Accept": "application/json"}, "json"),
        ("form", {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}, "form"),
    ]
    payloads_json = [
        {"Usuario": RPPC_USUARIO, "Password": RPPC_PASSWORD},
        {"usuario": RPPC_USUARIO, "password": RPPC_PASSWORD},
        {"USUARIO": RPPC_USUARIO, "CONTRASENA": RPPC_PASSWORD},
        {"Usuario": RPPC_USUARIO, "Password": RPPC_PASSWORD, "Remoto": True},
        {"Usuario": RPPC_USUARIO, "Password": RPPC_PASSWORD, "remoto": 1},
    ]

    for url in login_urls:
        for modo, headers_base, payload_kind in intentos:
            headers = _headers_rppc_auth({**headers_base, "User-Agent": RPPC_UA})
            for payload in payloads_json:
                try:
                    if payload_kind == "json":
                        data = json.dumps(payload).encode("utf-8")
                    else:
                        data = urllib.parse.urlencode(payload).encode("utf-8")
                    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
                    with opener.open(req, timeout=RPPC_TIMEOUT_POST) as resp:
                        body = resp.read().decode("utf-8", errors="replace")
                        http = resp.getcode()
                    parsed: Any = json.loads(body) if body.strip().startswith(("{", "[")) else {}
                    ok = _login_respuesta_ok(
                        http,
                        body,
                        parsed if isinstance(parsed, dict) else {},
                        endpoint=url,
                    )
                    if ok and isinstance(parsed, dict):
                        _registrar_token_login(parsed)
                    _rppc_login_detalle.append(
                        {
                            "url": url,
                            "modo": modo,
                            "http": http,
                            "ok": ok,
                            "usuario_id": _rppc_usuario_id,
                            "token": bool(_rppc_auth_token),
                            "cookies": len(_resumen_cookies_rppc()),
                            "preview": body[:160],
                        }
                    )
                    if ok:
                        _rppc_working_login_url = url
                        return True
                except urllib.error.HTTPError as exc:
                    body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                    _rppc_login_detalle.append(
                        {
                            "url": url,
                            "modo": modo,
                            "http": exc.code,
                            "ok": False,
                            "usuario_id": None,
                            "token": False,
                            "cookies": len(_resumen_cookies_rppc()),
                            "preview": body[:160] or exc.reason,
                        }
                    )
                except Exception as exc:
                    _rppc_login_detalle.append(
                        {
                            "url": url,
                            "modo": modo,
                            "http": None,
                            "ok": False,
                            "usuario_id": None,
                            "token": False,
                            "cookies": len(_resumen_cookies_rppc()),
                            "preview": str(exc)[:160],
                        }
                    )
    return False


def _build_opener(force_new: bool = False, skip_login: bool = False) -> urllib.request.OpenerDirector:
    global _rppc_opener, _rppc_login_ok, _rppc_cookie_jar
    if _rppc_opener is not None and not force_new:
        return _rppc_opener

    jar = CookieJar()
    _rppc_cookie_jar = jar
    ctx = _crear_ssl_context_rppc()
    _rppc_opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=ctx),
    )
    _rppc_login_ok = None

    _preflight_rppc_session(_rppc_opener)

    if not skip_login and RPPC_USUARIO and RPPC_PASSWORD:
        _rppc_login_ok = _intentar_login_rppc(_rppc_opener)

    return _rppc_opener


def _buscar_api_por_fragmento(
    apis: list[dict[str, Any]],
    fragmento: str,
    *,
    metodo: str | None = None,
) -> dict[str, Any] | None:
    frag = fragmento.lower()
    for api in apis:
        if metodo and api.get("method") != metodo:
            continue
        if frag in f"{api.get('route', '')} {api.get('api_id', '')}".lower():
            return api
    return None


def _apis_desde_fallback() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for metodo, ruta in RPPC_APIS_FALLBACK:
        items.append(
            {
                "api_id": f"{metodo}-{ruta.replace('/', '-').replace('{', '').replace('}', '')}",
                "method": metodo,
                "route": ruta,
                "url": _url_api_desde_ruta(RPPC_BASE_URL, ruta),
                "fallback": True,
            }
        )
    return items


def _cargar_apis_rppc(
    opener: urllib.request.OpenerDirector,
    folio_prueba: int = 3454,
) -> tuple[list[dict[str, Any]], str | None]:
    global _rppc_apis_cache, _rppc_last_help_error
    if _rppc_apis_cache:
        return _rppc_apis_cache, _rppc_last_help_error

    help_error: str | None = None
    try:
        help_url = _join_rppc_url(RPPC_BASE_URL, "/WebAPI/Help")
        help_http, html_text = _fetch_portal_text(opener, help_url, max_bytes=4_000_000)
        apis = _extraer_apis_desde_help(html_text, RPPC_BASE_URL)
        if apis:
            _rppc_apis_cache = apis
            _rppc_last_help_error = None
            return _rppc_apis_cache, None
        help_error = f"Help HTTP {help_http}, html={len(html_text)} bytes, 0 APIs parseadas"
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        help_error = f"Help HTTP {exc.code}: {body[:160] or exc.reason}"
    except Exception as exc:
        help_error = str(exc)

    _rppc_apis_cache = _apis_desde_fallback()
    _rppc_last_help_error = help_error
    return _rppc_apis_cache, help_error


def _asegurar_rppc_listo(folio_prueba: int = 3454) -> None:
    """Carga URLs desde /WebAPI/Help y autentica antes de consultar folios."""
    global _rppc_working_inscripciones_url, _rppc_working_documento_url
    global _rppc_working_reportes_prefix, _rppc_login_ok, _rppc_working_login_url

    opener = _build_opener(force_new=not _rppc_apis_cache, skip_login=True)
    _cargar_apis_rppc(opener, folio_prueba)

    if not _rppc_working_inscripciones_url:
        api = _buscar_api_priorizada(_rppc_apis_cache, "inscripciones")
        if api:
            _rppc_working_inscripciones_url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        else:
            _rppc_working_inscripciones_url = _reportes_action_url(RPPC_INSCRIPCIONES_ACTION)

    if not _rppc_working_documento_url:
        api = _buscar_api_priorizada(_rppc_apis_cache, "documento")
        if api:
            _rppc_working_documento_url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        else:
            _rppc_working_documento_url = _reportes_action_url(RPPC_DOCUMENTO_ACTION)

    _rppc_working_reportes_prefix = RPPC_REPORTES_PREFIX

    if RPPC_USUARIO and RPPC_PASSWORD and not _rppc_login_ok:
        _rppc_login_ok = _intentar_login_rppc(opener)


def _payloads_folio(folio_real: int) -> list[dict[str, Any]]:
    f_str = str(folio_real)
    payloads: list[dict[str, Any]] = [
    {"FOLIO_REAL": folio_real, "infoHistorica": 0},
    {"FOLIO_REAL": folio_real},
    {"folioReal": folio_real},
    {"FolioReal": folio_real},
]
    if _rppc_usuario_id:
        for base in list(payloads[:4]):
            payloads.insert(0, {**base, "USUARIO_ID": _rppc_usuario_id})
            payloads.insert(0, {**base, "usuarioId": _rppc_usuario_id})
    if RPPC_USUARIO and RPPC_PASSWORD:
        for base in list(payloads[:4]):
            payloads.append({**base, "Usuario": RPPC_USUARIO, "Password": RPPC_PASSWORD})
            payloads.append({**base, "usuario": RPPC_USUARIO, "password": RPPC_PASSWORD})
    return payloads


def _intentos_consulta_folio(folio_real: int) -> list[tuple[str, str, dict[str, Any] | None, str]]:
    intentos: list[tuple[str, str, dict[str, Any] | None, str]] = []
    vistos: set[str] = set()

    def _agregar(
        metodo: str,
        url: str,
        payload: dict[str, Any] | None = None,
        encoding: str = "json",
    ) -> None:
        clave = f"{metodo}|{url}|{encoding}|{json.dumps(payload, sort_keys=True) if payload else ''}"
        if clave in vistos:
            return
        vistos.add(clave)
        intentos.append((metodo, url, payload, encoding))

    if not _rppc_apis_cache:
        return intentos

    for metodo_pref in ("POST", "GET"):
        for metodo, accion in RPPC_API_PRIORIDAD["movimientos"]:
            if metodo != metodo_pref:
                continue
            for api in _rppc_apis_cache:
                if api.get("method") != metodo:
                    continue
                if not _termina_accion(api.get("route", ""), accion):
                    continue
                url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
                if metodo == "GET":
                    for key in ("FOLIO_REAL", "folioReal", "FolioReal", "folio_real"):
                        qs = urllib.parse.urlencode({key: folio_real})
                        _agregar("GET", f"{url}?{qs}")
                    _agregar("GET", f"{url}/{folio_real}")
                else:
                    for payload in _payloads_folio(folio_real):
                        _agregar("POST", url, payload, "json")
                        _agregar("POST", url, payload, "form")

    for frag in ("obtenerloteporfolio", "obtenerinscriplote", "obtenermovimientoslote"):
        api = _buscar_api_por_fragmento(_rppc_apis_cache, frag)
        if not api:
            continue
        url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        metodo = api.get("method") or "POST"
        if metodo == "GET":
            qs = urllib.parse.urlencode({"FOLIO_REAL": folio_real})
            _agregar("GET", f"{url}?{qs}")
            _agregar("GET", f"{url}/{folio_real}")
        else:
            for payload in _payloads_folio(folio_real):
                _agregar("POST", url, payload, "json")
                _agregar("POST", url, payload, "form")

    return intentos


def _request_rppc_raw(
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: int = RPPC_TIMEOUT_POST,
    opener: urllib.request.OpenerDirector | None = None,
) -> tuple[int, str]:
    client = opener or _build_opener()
    headers = _headers_rppc_auth({
        "Accept": "application/json, application/pdf, */*",
        "User-Agent": RPPC_UA,
    })
    if data is not None:
        headers["Content-Type"] = content_type or "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with client.open(req, timeout=timeout) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "pdf" in ctype.lower():
                return resp.getcode(), raw.decode("latin-1", errors="replace")
            return resp.getcode(), raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise HTTPException(
            status_code=502,
            detail=f"RPPC HTTP {exc.code} ({method} {url.split('/WebAPI/')[-1][:80]}): {body[:240] or exc.reason}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo contactar al RPPC: {_mensaje_url_error(exc)}",
        ) from exc


def _request_rppc(
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: int = RPPC_TIMEOUT_POST,
) -> tuple[int, str]:
    return _request_rppc_raw(method, url, data=data, content_type=content_type, timeout=timeout)


def _respuesta_rppc_exitosa(http: int, body: str) -> bool:
    if http >= 400:
        return False
    if "No HTTP resource was found" in body:
        return False
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return http < 400 and bool(body.strip())
    if not isinstance(parsed, dict):
        return False
    if _rppc_tiene_error(parsed):
        return False
    if parsed.get("success") is False or parsed.get("Success") is False:
        return False
    err_msg = parsed.get("ErrMessage") or parsed.get("errMessage")
    if err_msg and str(err_msg).strip():
        return False
    if parsed.get("success") is True or parsed.get("Success") is True:
        datos = parsed.get("Datos") or parsed.get("datos")
        if isinstance(datos, list):
            return len(datos) > 0
        if isinstance(datos, dict):
            return bool(datos)
        return False
    if parsed.get("children") and isinstance(parsed.get("children"), list):
        return len(parsed["children"]) > 0
    return False


def _api_id_a_ruta(api_id: str) -> tuple[str, str] | None:
    partes = (api_id or "").split("-", 1)
    if len(partes) != 2:
        return None
    metodo, resto = partes[0].upper(), partes[1].strip()
    if metodo not in {"GET", "POST", "PUT", "DELETE", "PATCH"} or not resto:
        return None
    return metodo, resto.replace("-", "/")


def _extraer_apis_desde_help(html_text: str, base_url: str) -> list[dict[str, Any]]:
    apis: list[dict[str, Any]] = []
    vistos: set[str] = set()

    for api_id, metodo, ruta in re.findall(
        r'Help/Api/((?:GET|POST|PUT|DELETE|PATCH)-[^"\'>\s]+)[^>]*>\s*'
        r'(GET|POST|PUT|DELETE|PATCH)\s+([^<]+)\s*<',
        html_text or "",
        re.IGNORECASE,
    ):
        ruta = html_lib.unescape(re.sub(r"\s+", " ", ruta).strip().strip("/"))
        if not ruta or api_id in vistos:
            continue
        vistos.add(api_id)
        apis.append(
            {
                "api_id": api_id,
                "method": metodo.upper(),
                "route": ruta,
                "url": _url_api_desde_ruta(base_url, ruta),
            }
        )

    for api_id in re.findall(r'Help/Api/((?:GET|POST|PUT|DELETE|PATCH)-[^"\'>\s]+)', html_text or "", re.IGNORECASE):
        if api_id in vistos:
            continue
        parsed = _api_id_a_ruta(api_id)
        if not parsed:
            continue
        metodo, ruta = parsed
        vistos.add(api_id)
        apis.append(
            {
                "api_id": api_id,
                "method": metodo,
                "route": ruta,
                "url": _url_api_desde_ruta(base_url, ruta),
            }
        )

    return apis


def _limpiar_ruta_api(ruta: str) -> str:
    return html_lib.unescape((ruta or "").strip().strip("/"))


def _url_api_desde_ruta(base_url: str, ruta: str, *, solo_base: bool = False) -> str:
    ruta = _limpiar_ruta_api(ruta)
    if solo_base:
        ruta = ruta.split("?")[0]
        if "{" in ruta:
            ruta = ruta.split("{", 1)[0].rstrip("/")
    return _join_rppc_url(base_url, f"/WebAPI/{ruta}")


def _termina_accion(ruta: str, accion: str) -> bool:
    base = _limpiar_ruta_api(ruta).split("?")[0].split("/")[-1].lower()
    return base == accion.lower()


def _buscar_api_priorizada(apis: list[dict[str, Any]], clave: str) -> dict[str, Any] | None:
    for metodo, accion in RPPC_API_PRIORIDAD.get(clave, []):
        for api in apis:
            if api.get("method") != metodo:
                continue
            if not _termina_accion(api.get("route", ""), accion):
                continue
            ruta_base = _limpiar_ruta_api(api.get("route", "")).split("?")[0]
            if "{" in ruta_base and clave in {"movimientos", "inscripciones", "login"}:
                continue
            return api
    return None


def _buscar_apis_login(apis: list[dict[str, Any]]) -> list[dict[str, Any]]:
    encontradas: list[dict[str, Any]] = []
    for api in apis:
        if api.get("method") != "POST":
            continue
        texto = f"{api.get('route', '')} {api.get('api_id', '')}".lower()
        if "buscarusuarioremoto" in texto:
            continue
        if not any(token in texto for token in ("seguridad", "enlace", "remoto", "admonusuarios")):
            continue
        if not any(token in texto for token in ("autentic", "login", "sesion", "ingresar", "validar")):
            continue
        if any(token in texto for token in ("memoria", "notario", "busqueda", "validarbusq")):
            continue
        encontradas.append(api)
    encontradas.sort(
        key=lambda item: (
            0 if "autentificarremoto" in f"{item.get('route', '')}".lower() else 1,
            f"{item.get('route', '')}".lower(),
        )
    )
    return encontradas


def _seleccionar_apis_relevantes(apis: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grupos: dict[str, list[dict[str, Any]]] = {
        "login": _buscar_apis_login(apis),
        "movimientos": [],
        "inscripciones": [],
        "documento": [],
    }
    for clave in ("movimientos", "inscripciones", "documento"):
        api = _buscar_api_priorizada(apis, clave)
        if api:
            grupos[clave] = [api]
    if not grupos["login"]:
        api_login = _buscar_api_priorizada(apis, "login")
        if api_login:
            grupos["login"] = [api_login]
    return grupos


def _aplicar_apis_descubiertas(relevantes: dict[str, list[dict[str, Any]]]) -> dict[str, str | None]:
    global _rppc_working_login_url, _rppc_working_movimientos_url
    global _rppc_working_inscripciones_url, _rppc_working_documento_url
    global _rppc_working_movimientos_action, _rppc_working_documento_method

    seleccion: dict[str, str | None] = {
        "login": None,
        "movimientos": None,
        "inscripciones": None,
        "documento": None,
    }

    if relevantes.get("login"):
        api = relevantes["login"][0]
        _rppc_working_login_url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        seleccion["login"] = _rppc_working_login_url
    if relevantes.get("movimientos"):
        api = relevantes["movimientos"][0]
        _rppc_working_movimientos_url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        _rppc_working_movimientos_action = _limpiar_ruta_api(api["route"]).split("?")[0].split("/")[-1]
        seleccion["movimientos"] = _rppc_working_movimientos_url
    if relevantes.get("inscripciones"):
        api = relevantes["inscripciones"][0]
        _rppc_working_inscripciones_url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        seleccion["inscripciones"] = _rppc_working_inscripciones_url
    if relevantes.get("documento"):
        api = relevantes["documento"][0]
        _rppc_working_documento_method = api.get("method") or "GET"
        _rppc_working_documento_url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        seleccion["documento"] = _rppc_working_documento_url

    return seleccion


def _escanear_webapi_help(
    opener: urllib.request.OpenerDirector,
    folio_prueba: int,
) -> dict[str, Any]:
    global _rppc_apis_cache
    help_url = _join_rppc_url(RPPC_BASE_URL, "/WebAPI/Help")
    resultado: dict[str, Any] = {
        "help_url": help_url,
        "help_http": None,
        "apis_total": 0,
        "apis_muestra": [],
        "relevantes": {},
        "seleccionadas": {},
        "probadas": [],
        "error": None,
    }
    try:
        help_http, html_text = _fetch_portal_text(opener, help_url, max_bytes=900_000)
        resultado["help_http"] = help_http
        apis = _extraer_apis_desde_help(html_text, RPPC_BASE_URL)
        if apis:
            _rppc_apis_cache = apis
        resultado["apis_total"] = len(apis)
        resultado["apis_muestra"] = apis[:40] if apis else _rppc_apis_cache[:40]

        relevantes = _seleccionar_apis_relevantes(apis)
        resultado["relevantes"] = {
            clave: [item.get("route") for item in items[:6]]
            for clave, items in relevantes.items()
            if items
        }
        resultado["seleccionadas"] = _aplicar_apis_descubiertas(relevantes)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        resultado["help_http"] = exc.code
        resultado["error"] = f"HTTP {exc.code}: {body[:160] or exc.reason}"
    except Exception as exc:
        resultado["error"] = str(exc)
    return resultado


_RPPC_RUTA_PATTERNS = (
    re.compile(r'["\']([^"\']*(?:WebAPI|webapi|Servicios|Reportes|Seguridad)[^"\']{0,120})["\']'),
    re.compile(r'["\'](/(?:WebAPI|webapi|rppapp/api)[^"\']{3,140})["\']'),
    re.compile(r'\b(obtener[A-Za-z]{5,50})\b'),
    re.compile(r'\b(Obtener[A-Za-z]{5,50})\b'),
    re.compile(r'\b(Autenticar[A-Za-z]{0,40})\b'),
    re.compile(
        r'(?:apiUrl|baseUrl|urlBase|URL_API|webApiBase|urlServicio)\s*[:=]\s*["\']([^"\']+)["\']',
        re.IGNORECASE,
    ),
)


def _fetch_portal_text(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    max_bytes: int = 400_000,
) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        headers={"Accept": "text/html,application/javascript,*/*", "User-Agent": RPPC_UA},
        method="GET",
    )
    with opener.open(req, timeout=RPPC_TIMEOUT_GET) as resp:
        content = resp.read(max_bytes + 1)
        if len(content) > max_bytes:
            content = content[:max_bytes]
        return resp.getcode(), content.decode("utf-8", errors="replace")


def _extraer_rutas_de_texto(text: str) -> list[str]:
    found: set[str] = set()
    for pattern in _RPPC_RUTA_PATTERNS:
        for match in pattern.finditer(text or ""):
            val = (match.group(1) if match.lastindex else match.group(0)).strip().strip("'\"")
            if len(val) < 5 or len(val) > 200:
                continue
            lower = val.lower()
            if any(token in lower for token in (".css", ".png", ".jpg", ".woff", ".svg", ".map", "node_modules")):
                continue
            found.add(val)
    return sorted(found)


def _extraer_script_srcs(html_text: str, page_url: str) -> list[str]:
    srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html_text or "", re.IGNORECASE)
    urls: list[str] = []
    for src in srcs:
        url = urllib.parse.urljoin(page_url, src)
        if url not in urls:
            urls.append(url)
    return urls


def _escanear_portal_rppc(
    opener: urllib.request.OpenerDirector,
    folio_prueba: int,
) -> dict[str, Any]:
    inicio_url = _join_rppc_url(RPPC_BASE_URL, RPPC_SESSION_PATH or "/rppapp/inicio?remoto=1")
    resultado: dict[str, Any] = {
        "inicio_url": inicio_url,
        "inicio_http": None,
        "scripts_analizados": [],
        "rutas_encontradas": [],
        "help_probe": [],
        "rutas_probadas": [],
        "error": None,
    }
    try:
        inicio_http, html_text = _fetch_portal_text(opener, inicio_url, max_bytes=350_000)
        resultado["inicio_http"] = inicio_http
        rutas = _extraer_rutas_de_texto(html_text)

        for script_url in _extraer_script_srcs(html_text, inicio_url)[:10]:
            item: dict[str, Any] = {"url": script_url}
            try:
                script_http, script_text = _fetch_portal_text(opener, script_url, max_bytes=700_000)
                item["http"] = script_http
                item["bytes"] = len(script_text)
                rutas.extend(_extraer_rutas_de_texto(script_text))
            except urllib.error.HTTPError as exc:
                item["http"] = exc.code
                item["error"] = exc.reason
            except Exception as exc:
                item["error"] = str(exc)[:120]
            resultado["scripts_analizados"].append(item)

        rutas_unicas: list[str] = []
        vistos: set[str] = set()
        for ruta in rutas:
            key = ruta.lower()
            if key in vistos:
                continue
            vistos.add(key)
            rutas_unicas.append(ruta)
        resultado["rutas_encontradas"] = rutas_unicas[:50]

        for help_path in (
            "/WebAPI/Help",
            "/WebAPI/Servicios/Help",
            "/WebAPI/Servicios/Reportes/Help",
            "/rppapp/WebAPI/Help",
        ):
            help_url = _join_rppc_url(RPPC_BASE_URL, help_path)
            try:
                help_http, help_body = _fetch_portal_text(opener, help_url, max_bytes=80_000)
                resultado["help_probe"].append(
                    {"url": help_url, "http": help_http, "preview": help_body[:160]}
                )
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                resultado["help_probe"].append(
                    {"url": help_url, "http": exc.code, "preview": body[:160] or exc.reason}
                )

        payload = {"FOLIO_REAL": folio_prueba, "infoHistorica": 0}
        urls_a_probar: list[str] = []
        for ruta in rutas_unicas:
            if ruta.startswith("http://") or ruta.startswith("https://"):
                urls_a_probar.append(ruta)
            elif ruta.startswith("/"):
                urls_a_probar.append(_join_rppc_url(RPPC_BASE_URL, ruta))
            elif any(token in ruta.lower() for token in ("obtener", "autenticar")):
                for prefix in RPPC_REPORTES_PREFIX_CANDIDATES:
                    urls_a_probar.append(_reportes_action_url(ruta, prefix=prefix))
                for login_path in RPPC_LOGIN_PATH_CANDIDATES[:3]:
                    if ruta.lower() in login_path.lower():
                        urls_a_probar.append(_join_rppc_url(RPPC_BASE_URL, login_path))

        urls_unicas: list[str] = []
        for url in urls_a_probar:
            if url not in urls_unicas:
                urls_unicas.append(url)

        for url in urls_unicas:
            lower = url.lower()
            if not any(token in lower for token in ("movimiento", "autentic", "reporte", "seguridad", "inscrip", "documento")):
                continue
            if len(resultado["rutas_probadas"]) >= 12:
                break
            if "documento" in lower and "obtener" not in lower:
                continue
            resultado["rutas_probadas"].append(_probe_post_url(opener, url, payload))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        resultado["inicio_http"] = exc.code
        resultado["error"] = f"HTTP {exc.code}: {body[:160] or exc.reason}"
    except Exception as exc:
        resultado["error"] = str(exc)
    return resultado


def _probe_post_url(
    opener: urllib.request.OpenerDirector,
    url: str,
    payload: dict,
    *,
    encoding: str = "json",
) -> dict[str, Any]:
    if encoding == "form":
        data = urllib.parse.urlencode(payload).encode("utf-8")
        content_type = "application/x-www-form-urlencoded"
    else:
        data = json.dumps(payload).encode("utf-8")
        content_type = "application/json"
    req = urllib.request.Request(
        url,
        data=data,
        headers=_headers_rppc_auth({
            "Content-Type": content_type,
            "Accept": "application/json",
            "User-Agent": RPPC_UA,
        }),
        method="POST",
    )
    try:
        with opener.open(req, timeout=RPPC_TIMEOUT_POST) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            http = resp.getcode()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        http = exc.code
    except urllib.error.URLError as exc:
        return {
            "url": url,
            "http": None,
            "ok": False,
            "preview": _mensaje_url_error(exc)[:160],
        }

    return {
        "url": url,
        "http": http,
        "ok": _respuesta_rppc_exitosa(http, body),
        "preview": body[:160],
    }


def _descubrir_url_movimientos(
    opener: urllib.request.OpenerDirector,
    folio_prueba: int,
) -> dict[str, Any] | None:
    global _rppc_working_reportes_prefix, _rppc_working_movimientos_action
    payload = {"FOLIO_REAL": folio_prueba, "infoHistorica": 0}
    bases = []
    for base in RPPC_BASE_URL_CANDIDATES:
        if base not in bases:
            bases.append(base)

    for base in bases:
        for prefix in RPPC_REPORTES_PREFIX_CANDIDATES:
            for action in RPPC_MOVIMIENTOS_ACTION_CANDIDATES:
                url = _reportes_action_url(action, base=base, prefix=prefix)
                probe = _probe_post_url(opener, url, payload)
                if probe["ok"]:
                    _rppc_working_reportes_prefix = prefix
                    _rppc_working_movimientos_action = action
                    return probe
    return None


def _parsear_datos_rppc(body: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Respuesta inválida del RPPC: {body[:180]}",
        ) from exc

    if isinstance(parsed, list):
        return parsed
    if not isinstance(parsed, dict):
        return []

    if parsed.get("success") is False or parsed.get("Success") is False:
        msg = parsed.get("Mensaje") or parsed.get("message") or parsed.get("detail") or "sin detalle"
        raise HTTPException(status_code=502, detail=f"RPPC respondió error: {msg}")

    datos = parsed.get("Datos") or parsed.get("datos")
    if isinstance(datos, list) and datos:
        return datos
    if isinstance(datos, dict) and datos:
        return [datos]
    if isinstance(parsed, dict) and (parsed.get("PARTIDA") or parsed.get("partida")):
        return [parsed]
    if isinstance(parsed, dict) and len(parsed) > 0:
        return [parsed]
    return []


def _consultar_movimientos_folio(folio_real: int, _renovado: bool = False) -> list[dict[str, Any]]:
    global _rppc_working_movimientos_url, _rppc_working_movimientos_action
    _asegurar_rppc_listo(folio_prueba=folio_real)
    errores: list[str] = []
    if _rppc_last_help_error:
        errores.append(f"Help: {_rppc_last_help_error} (usando rutas fallback)")
    # Si no hay cookie manual, sí detenemos cuando falla el login RPPC.
    # Si RPPC_COOKIE existe, permitimos continuar porque la cookie puede ser la sesión válida.
    if RPPC_USUARIO and RPPC_PASSWORD and not _rppc_login_ok and not _cookie_rppc_actual():
        detalle_login = _rppc_login_detalle[:3] if _rppc_login_detalle else []
        raise HTTPException(
            status_code=502,
            detail=(
                f"Login RPPC falló para folio {folio_real}. "
                f"Revise RPPC_USUARIO/RPPC_PASSWORD (cuenta enlace remoto RPPC, no SGC). "
                f"usuario_id={_rppc_usuario_id}. "
                f"Diagnóstico: GET /rppc/diagnostico → login_intentos. "
                f"Muestra: {detalle_login}"
            ),
        )
    intentos = _intentos_consulta_folio(folio_real)

    if not intentos:
        extra = _rppc_last_help_error or "sin detalle"
        raise HTTPException(
            status_code=502,
            detail=(
                f"No hay endpoints RPPC para folio {folio_real}. "
                f"apis_cache={len(_rppc_apis_cache)}. Help: {extra}"
            ),
        )

    for metodo, url, body_payload, encoding in intentos:
        try:
            data: bytes | None = None
            content_type: str | None = None
            if body_payload is not None:
                if encoding == "form":
                    data = urllib.parse.urlencode(body_payload).encode("utf-8")
                    content_type = "application/x-www-form-urlencoded"
                else:
                    data = json.dumps(body_payload).encode("utf-8")
                    content_type = "application/json"
            _, body = _request_rppc(metodo, url, data=data, content_type=content_type)
            datos = _parsear_datos_rppc(body)
            if datos:
                _rppc_working_movimientos_url = url.split("?")[0]
                _rppc_working_movimientos_action = url.rstrip("/").split("/")[-1].split("?")[0]
                return datos
        except HTTPException as exc:
            errores.append(str(exc.detail))

    if not _renovado and RPPC_USUARIO and RPPC_PASSWORD:
        if _renovar_cookie_rppc_runtime():
            _reset_rppc_opener()
            return _consultar_movimientos_folio(folio_real, _renovado=True)

    resumen = " | ".join(errores[:4])
    if len(errores) > 4:
        resumen += f" | (+{len(errores) - 4} intentos más)"
    raise HTTPException(
        status_code=502,
        detail=(
            f"No se pudieron obtener movimientos del folio {folio_real} "
            f"({len(intentos)} intentos, login_ok={_rppc_login_ok}, "
            f"token={bool(_rppc_auth_token)}, cookies={len(_resumen_cookies_rppc())}, "
            f"runtime_cookie={bool(_cookie_rppc_actual())}): {resumen}"
        ),
    )


def _post_rppc(endpoint: str, payload: dict) -> list[dict[str, Any]]:
    if endpoint != RPPC_INSCRIPCIONES_ACTION and payload.get("FOLIO_REAL"):
        return _consultar_movimientos_folio(int(payload["FOLIO_REAL"]))

    _asegurar_rppc_listo(folio_prueba=1)
    if endpoint == RPPC_INSCRIPCIONES_ACTION and _rppc_working_inscripciones_url:
        url = _rppc_working_inscripciones_url
    else:
        url = _reportes_action_url(endpoint or RPPC_MOVIMIENTOS_ACTION)

    _, body = _request_rppc("POST", url, data=json.dumps(payload).encode("utf-8"))
    return _parsear_datos_rppc(body)


def _consultar_inmuebles_rppc_por_clave(clave_catastral: str, _renovado: bool = False) -> list[dict[str, Any]]:
    """Consulta RPPC por clave catastral y devuelve los inmuebles encontrados."""
    clave_rppc = _clave_sgc_a_rppc(clave_catastral)
    if not clave_rppc:
        raise HTTPException(status_code=400, detail="Clave catastral inválida")

    url = _url_api_desde_ruta(
        RPPC_BASE_URL,
        "Servicios/ConsultaAvanzada/consultaInmuebles",
        solo_base=True,
    )
    payload = {
        "BUSCAR": "C",
        "CVE_CAT": clave_rppc,
        "CURT": "",
        "VIGENTE": "S",
    }

    try:
        _, body = _request_rppc(
            "POST",
            url,
            data=json.dumps(payload).encode("utf-8"),
            content_type="application/json",
        )
        return _parsear_datos_rppc(body)
    except HTTPException:
        if not _renovado and RPPC_USUARIO and RPPC_PASSWORD:
            if _renovar_cookie_rppc_runtime():
                _reset_rppc_opener()
                return _consultar_inmuebles_rppc_por_clave(clave_catastral, _renovado=True)
        raise


def _seleccionar_mejor_inmueble_rppc(inmuebles: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Selecciona el inmueble más probable cuando RPPC devuelve varias coincidencias.

    Regla conservadora:
    1) solo vigentes;
    2) preferir MEXICALI;
    3) elegir el FOLIO_REAL más alto, que normalmente corresponde al registro más reciente.
    """
    candidatos = [x for x in inmuebles if str(x.get("VIGENTE") or "").upper() in {"", "S", "SI", "SÍ"}]
    if not candidatos:
        candidatos = list(inmuebles)

    mexicali = [x for x in candidatos if "MEXICALI" in str(x.get("MUNLOC") or x.get("MUNICIPIO") or "").upper()]
    if mexicali:
        candidatos = mexicali

    candidatos_con_folio = []
    for item in candidatos:
        folio = _normalizar_numero(item.get("FOLIO_REAL"))
        if folio:
            candidatos_con_folio.append((folio, item))

    if not candidatos_con_folio:
        return None

    candidatos_con_folio.sort(key=lambda par: par[0], reverse=True)
    return candidatos_con_folio[0][1]


def _asegurar_columnas_folio_real_metadata(cur, conn) -> None:
    """Asegura columnas de auditoría para folio_real obtenido desde RPPC."""
    try:
        cur.execute(
            """
            ALTER TABLE catalogos.padron_2026
            ADD COLUMN IF NOT EXISTS folio_real_fuente text,
            ADD COLUMN IF NOT EXISTS folio_real_fecha_actualizacion timestamp;
            """
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def _guardar_folio_real_en_padron(clave_catastral: str, folio_real: int) -> None:
    clave = _normalizar_clave(clave_catastral)
    if not clave or not folio_real:
        return

    with get_conn() as conn:
        with conn.cursor() as cur:
            _asegurar_columnas_folio_real_metadata(cur, conn)
            cur.execute(
                """
                UPDATE catalogos.padron_2026
                SET folio_real = %s,
                    folio_real_fuente = 'RPPC',
                    folio_real_fecha_actualizacion = now()
                WHERE UPPER(TRIM(clave_catastral)) = %s;
                """,
                (str(folio_real), clave),
            )
            conn.commit()


def _obtener_folio_por_clave(clave_catastral: str) -> int:
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        raise HTTPException(status_code=400, detail="Clave catastral inválida")

    with get_conn() as conn:
        with conn.cursor() as cur:
            asegurar_columna_folio_real_padron(cur, conn)
            cur.execute(
                """
                SELECT NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') AS folio_real
                FROM catalogos.padron_2026
                WHERE UPPER(TRIM(clave_catastral)) = %s
                LIMIT 1;
                """,
                (clave,),
            )
            row = cur.fetchone()

    if row and row.get("folio_real"):
        folio = _normalizar_numero(row["folio_real"])
        if folio:
            return folio

    # Si el padrón no trae folio_real, buscamos en RPPC por clave con guiones.
    inmuebles = _consultar_inmuebles_rppc_por_clave(clave)
    if not inmuebles:
        raise HTTPException(
            status_code=404,
            detail=f"RPPC no encontró inmuebles para la clave {_clave_sgc_a_rppc(clave)}",
        )

    elegido = _seleccionar_mejor_inmueble_rppc(inmuebles)
    if not elegido:
        raise HTTPException(
            status_code=404,
            detail=f"RPPC encontró coincidencias para {_clave_sgc_a_rppc(clave)}, pero ninguna trae FOLIO_REAL válido",
        )

    folio = _normalizar_numero(elegido.get("FOLIO_REAL"))
    if not folio:
        raise HTTPException(status_code=404, detail="Folio real inválido devuelto por RPPC")

    _guardar_folio_real_en_padron(clave, folio)
    return folio


def _obtener_partida_por_folio(folio_real: int):
    datos = _consultar_movimientos_folio(folio_real)

    if not datos:
        raise HTTPException(status_code=404, detail="No se encontraron movimientos para ese folio real")

    datos_ordenados = sorted(
        datos,
        key=lambda x: x.get("FECHA_REGISTRO") or "",
        reverse=True,
    )

    partida = _normalizar_numero(datos_ordenados[0].get("PARTIDA"))
    if not partida:
        raise HTTPException(status_code=404, detail="No se encontró partida RPPC")

    return partida, datos_ordenados[0], datos_ordenados


def _obtener_doc_id_por_partida(partida: int):
    datos = _post_rppc(
        RPPC_INSCRIPCIONES_ACTION,
        {"PARTIDA": partida},
    )

    if not datos:
        raise HTTPException(status_code=404, detail="No se encontró documento para esa partida")

    doc_id = _normalizar_numero(datos[0].get("DOC_TRAMITE_ID"))
    if not doc_id:
        raise HTTPException(status_code=404, detail="No se encontró DOC_TRAMITE_ID")

    return doc_id, datos[0]


def _descargar_pdf_por_partida(partida: int) -> bytes | None:
    _asegurar_rppc_listo(folio_prueba=1)
    api = _buscar_api_por_fragmento(_rppc_apis_cache, "obtienepdfinscripcion", metodo="GET")
    if api:
        base = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
        url = re.sub(r"\{[^}]+\}", str(partida), base)
        if "{" in url:
            url = f"{base.rstrip('/')}/{partida}"
    else:
        url = _join_rppc_url(
            RPPC_BASE_URL,
            f"/WebAPI/servicios/reportes/obtienepdfinscripcion/{partida}",
        )

    opener = _build_opener()
    req = urllib.request.Request(
        url,
        headers=_headers_rppc_auth({
            "Accept": "application/pdf,*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Referer": "https://rppcweb.ebajacalifornia.gob.mx/rppweb/produccion/",
        }),
        method="GET",
    )
    try:
        with opener.open(req, timeout=RPPC_TIMEOUT_GET) as resp:
            content = resp.read()
            if content[:4] == b"%PDF":
                return content
    except Exception:
        return None
    return None


def _descargar_pdf(doc_id: int, partida: int | None = None, _renovado: bool = False) -> bytes:
    if partida:
        directo = _descargar_pdf_por_partida(partida)
        if directo:
            return directo

    _asegurar_rppc_listo(folio_prueba=1)
    doc_url = _rppc_working_documento_url or _reportes_action_url(RPPC_DOCUMENTO_ACTION)
    doc_url = doc_url.split("?")[0]
    qs = urllib.parse.urlencode({"DOC_TRAMITE_ID": doc_id})
    url = f"{doc_url}?{qs}"
    opener = _build_opener()
    req = urllib.request.Request(
        url,
        headers=_headers_rppc_auth({
            "Accept": "application/pdf,*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Referer": "https://rppcweb.ebajacalifornia.gob.mx/rppweb/produccion/",
        }),
        method="GET",
    )
    try:
        with opener.open(req, timeout=RPPC_TIMEOUT_GET) as resp:
            content = resp.read()
    except urllib.error.HTTPError as exc:
        if not _renovado and RPPC_USUARIO and RPPC_PASSWORD:
            if _renovar_cookie_rppc_runtime():
                _reset_rppc_opener()
                return _descargar_pdf(doc_id, partida=partida, _renovado=True)
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo descargar el PDF del RPPC: HTTP {exc.code}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo descargar el PDF del RPPC: {_mensaje_url_error(exc)}",
        ) from exc

    if not content:
        raise HTTPException(status_code=502, detail="El RPPC devolvió un PDF vacío")

    if not content.startswith(b"%PDF"):
        if not _renovado and RPPC_USUARIO and RPPC_PASSWORD:
            if _renovar_cookie_rppc_runtime():
                _reset_rppc_opener()
                return _descargar_pdf(doc_id, partida=partida, _renovado=True)
        preview = content[:180].decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"RPPC no devolvió PDF: {preview}")

    return content


def _stream_pdf(doc_id: int, filename: str, partida: int | None = None):
    content = _descargar_pdf(doc_id, partida=partida)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _resolver_documento_por_folio(folio_real: int):
    partida, movimiento, movimientos = _obtener_partida_por_folio(folio_real)
    doc_id, inscripcion = _obtener_doc_id_por_partida(partida)
    return {
        "folio_real": folio_real,
        "partida": partida,
        "doc_tramite_id": doc_id,
        "movimiento": movimiento,
        "inscripcion": inscripcion,
        "movimientos_total": len(movimientos),
        "pdf_url": f"/rppc/pdf/doc/{doc_id}",
    }


def _probar_conexion_rppc(folio_prueba: int = 3454) -> dict[str, Any]:
    global _rppc_working_movimientos_url, _rppc_login_ok
    _reset_rppc_opener()
    resultado: dict[str, Any] = {
        "rppc_base_url": RPPC_BASE_URL,
        "reportes_prefix": RPPC_REPORTES_PREFIX,
        "movimientos_action": RPPC_MOVIMIENTOS_ACTION,
        "credenciales_configuradas": bool(RPPC_USUARIO and RPPC_PASSWORD),
        "session_path": RPPC_SESSION_PATH or None,
        "login_path": RPPC_LOGIN_PATH or None,
        "login_intentado": bool(RPPC_USUARIO and RPPC_PASSWORD),
        "login_ok": None,
        "login_usuario_id": None,
        "login_token": False,
        "login_cookies": [],
        "rppc_cookie_configurada": bool(_cookie_rppc_actual()),
        "login_intentos": [],
        "session_preflight": None,
        "ssl_legacy": RPPC_SSL_LEGACY,
        "ssl_seclevel": RPPC_SSL_SECLEVEL,
        "ssl_min_tls": RPPC_SSL_MIN_TLS,
        "openssl_version": ssl.OPENSSL_VERSION,
        "post_ok": False,
        "post_http": None,
        "post_url": None,
        "post_preview": None,
        "url_descubierta": None,
        "url_candidatas": [],
        "portal_scan": None,
        "webapi_help": None,
        "siguiente_paso": None,
        "error": None,
    }
    try:
        opener = _build_opener(force_new=True, skip_login=True)
        resultado["session_preflight"] = _preflight_rppc_session(opener)
        resultado["webapi_help"] = _escanear_webapi_help(opener, folio_prueba)
        if resultado["login_intentado"]:
            resultado["login_ok"] = _intentar_login_rppc(opener)
            _rppc_login_ok = resultado["login_ok"]
            resultado["login_intentos"] = _rppc_login_detalle[:16]
            resultado["login_usuario_id"] = _rppc_usuario_id
            resultado["login_token"] = bool(_rppc_auth_token)
            resultado["login_cookies"] = _resumen_cookies_rppc()

        payload = {"folioReal": str(folio_prueba)}
        if _rppc_usuario_id:
            payload["USUARIO_ID"] = _rppc_usuario_id
        url_configurada = _rppc_working_movimientos_url or _url_api_por_accion("ObtenerLoteByFolioReal")
        if not url_configurada:
            url_configurada = _reportes_action_url(RPPC_MOVIMIENTOS_ACTION)
        probe_config = _probe_post_url(opener, url_configurada, payload)
        if not probe_config["ok"] and _rppc_working_movimientos_url and url_configurada != _rppc_working_movimientos_url:
            probe_config = _probe_post_url(opener, _rppc_working_movimientos_url, payload)
            url_configurada = _rppc_working_movimientos_url

        if not probe_config["ok"] and _rppc_apis_cache:
            for metodo, accion in RPPC_API_PRIORIDAD["movimientos"]:
                for api in _rppc_apis_cache:
                    if api.get("method") != metodo or not _termina_accion(api.get("route", ""), accion):
                        continue
                    url = _url_api_desde_ruta(RPPC_BASE_URL, api["route"], solo_base=True)
                    extra = _probe_post_url(opener, url, payload)
                    extra["tipo"] = "movimientos_scan"
                    (resultado["webapi_help"].setdefault("probadas", [])).append(extra)
                    if extra.get("ok"):
                        probe_config = extra
                        url_configurada = url
                        _rppc_working_movimientos_url = url
                        _rppc_working_movimientos_action = accion
                        break
                if probe_config.get("ok"):
                    break

        if _rppc_working_inscripciones_url:
            probe_ins = _probe_post_url(opener, _rppc_working_inscripciones_url, {"PARTIDA": 1})
            probe_ins["tipo"] = "inscripciones"
            (resultado["webapi_help"].setdefault("probadas", [])).append(probe_ins)

        resultado["portal_scan"] = _escanear_portal_rppc(opener, folio_prueba)
        resultado["post_url"] = url_configurada
        resultado["post_http"] = probe_config["http"]
        resultado["post_preview"] = probe_config["preview"]
        resultado["post_ok"] = probe_config["ok"]

        candidatas = [probe_config]
        if not probe_config["ok"]:
            bases = []
            for base in RPPC_BASE_URL_CANDIDATES:
                if base not in bases:
                    bases.append(base)
            for base in bases:
                for prefix in RPPC_REPORTES_PREFIX_CANDIDATES:
                    for action in RPPC_MOVIMIENTOS_ACTION_CANDIDATES:
                        url = _reportes_action_url(action, base=base, prefix=prefix)
                        if url == url_configurada:
                            continue
                        candidatas.append(_probe_post_url(opener, url, payload))
                        if len(candidatas) >= 18:
                            break
                    if len(candidatas) >= 18:
                        break
                if len(candidatas) >= 18:
                    break

        resultado["url_candidatas"] = candidatas

        help_ok = [
            item
            for item in (resultado.get("webapi_help") or {}).get("probadas") or []
            if item.get("ok") and item.get("tipo") in ("movimientos", "movimientos_scan")
        ]
        if help_ok:
            ganadora = help_ok[0]
            resultado["url_descubierta"] = ganadora["url"]
            resultado["post_ok"] = True
            resultado["post_http"] = ganadora["http"]
            resultado["post_preview"] = ganadora["preview"]
            resultado["post_url"] = ganadora["url"]

        for item in candidatas:
            if item.get("ok") and not resultado["post_ok"]:
                resultado["url_descubierta"] = item["url"]
                resultado["post_ok"] = True
                resultado["post_http"] = item["http"]
                resultado["post_preview"] = item["preview"]
                resultado["post_url"] = item["url"]
                break

        portal_ok = [
            item
            for item in (resultado.get("portal_scan") or {}).get("rutas_probadas") or []
            if item.get("ok")
        ]
        if portal_ok and not resultado["post_ok"]:
            ganadora = portal_ok[0]
            resultado["url_descubierta"] = ganadora["url"]
            resultado["post_ok"] = True
            resultado["post_http"] = ganadora["http"]
            resultado["post_preview"] = ganadora["preview"]
            resultado["post_url"] = ganadora["url"]

        if not resultado["post_ok"] and probe_config.get("http"):
            resultado["error"] = f"HTTP {probe_config['http']}: {probe_config['preview']}"

        if resultado["login_intentado"] and not resultado["login_ok"]:
            resultado["siguiente_paso"] = (
                "Login enlace remoto falló. buscarUsuarioRemoto debe devolver USUARIO_ID > 0; "
                "luego autentificarRemoto crea la sesión. Verifique RPPC_USUARIO/RPPC_PASSWORD "
                "(cuenta del portal RPPC remoto, distinta al usuario SGC)."
            )
        elif not resultado["post_ok"]:
            help_total = (resultado.get("webapi_help") or {}).get("apis_total") or 0
            if help_total:
                resultado["siguiente_paso"] = (
                    f"Se encontraron {help_total} APIs en /WebAPI/Help. "
                    "Revise webapi_help.relevantes y webapi_help.probadas. "
                    "Si movimientos responde 401/403, verifique RPPC_USUARIO/RPPC_PASSWORD."
                )
            else:
                resultado["siguiente_paso"] = (
                    "No se pudieron leer APIs desde /WebAPI/Help. "
                    "Capture URLs reales con F12 → Network en el portal RPPC."
                )
    except urllib.error.URLError as exc:
        resultado["error"] = _mensaje_url_error(exc)
    except Exception as exc:
        resultado["error"] = str(exc)
    return resultado

@router.post("/sesion/renovar")
def renovar_sesion_rppc(usuario_actual: dict = Depends(obtener_usuario_actual)):
    ok = _renovar_cookie_rppc_runtime()
    if ok:
        _reset_rppc_opener()
    return {
        "ok": ok,
        "runtime_cookie": bool(_cookie_rppc_actual()),
        "cookie_file": RPPC_RUNTIME_COOKIE_FILE,
    }


@router.get("/diagnostico")
def diagnostico_rppc(
    folio_prueba: int = 3454,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    return _probar_conexion_rppc(folio_prueba)


@router.get("/movimientos/folio/{folio_real}")
def movimientos_por_folio(
    folio_real: int,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    _, _, movimientos = _obtener_partida_por_folio(folio_real)
    return {
        "folio_real": folio_real,
        "total": len(movimientos),
        "movimientos": movimientos,
    }


@router.get("/resolver/folio/{folio_real}")
def resolver_por_folio(
    folio_real: int,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    return _resolver_documento_por_folio(folio_real)


@router.get("/inmuebles/clave/{clave_catastral}")
def inmuebles_por_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    clave = _normalizar_clave(clave_catastral)
    datos = _consultar_inmuebles_rppc_por_clave(clave)
    elegido = _seleccionar_mejor_inmueble_rppc(datos)
    return {
        "clave_catastral": clave,
        "clave_rppc": _clave_sgc_a_rppc(clave),
        "total": len(datos),
        "folio_elegido": _normalizar_numero(elegido.get("FOLIO_REAL")) if elegido else None,
        "inmueble_elegido": elegido,
        "inmuebles": datos,
    }


@router.get("/resolver/clave/{clave_catastral}")
def resolver_por_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    clave = _normalizar_clave(clave_catastral)
    folio_real = _obtener_folio_por_clave(clave)
    data = _resolver_documento_por_folio(folio_real)
    data["clave_catastral"] = clave
    data["clave_rppc"] = _clave_sgc_a_rppc(clave)
    return data


@router.get("/pdf/doc/{doc_tramite_id}")
def pdf_por_doc(doc_tramite_id: int):
    return _stream_pdf(doc_tramite_id, f"rppc_doc_{doc_tramite_id}.pdf")


@router.get("/pdf/folio/{folio_real}")
def pdf_por_folio(folio_real: int):
    partida, _, _ = _obtener_partida_por_folio(folio_real)
    doc_id, _ = _obtener_doc_id_por_partida(partida)
    return _stream_pdf(doc_id, f"rppc_folio_{folio_real}.pdf", partida=partida)

@router.get("/pdf/clave/{clave_catastral}")
def pdf_por_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    clave = _normalizar_clave(clave_catastral)
    folio_real = _obtener_folio_por_clave(clave)
    partida, _, _ = _obtener_partida_por_folio(folio_real)
    doc_id, _ = _obtener_doc_id_por_partida(partida)
    clave_limpia = re.sub(r"[^A-Za-z0-9_-]", "_", clave)
    return _stream_pdf(doc_id, f"rppc_{clave_limpia}.pdf", partida=partida)

@router.get("/visor/pdf/doc/{doc_tramite_id}")
def visor_pdf_por_doc(doc_tramite_id: int):
    return _stream_pdf(doc_tramite_id, f"rppc_doc_{doc_tramite_id}.pdf")