"""Proxy de consulta al RPPC de Baja California (folio real → PDF)."""
import html as html_lib
import json
import logging
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
from pathlib import Path
from typing import Any, Literal
import shutil
import tempfile
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth.dependencies import requerir_roles
from auth.permisos_operativos import requerir_pestana_rppc
import config as _config_mod
from config import (
    APP_DIR,
    APP_MUNICIPIO,
    APP_MUNICIPIO_MAYUS,
    DOCUMENTOS_BASE_DIR,
    RPPC_BASE_URL,
    RPPC_COOKIE,
    RPPC_DOCUMENTO_ACTION,
    RPPC_INSCRIPCIONES_ACTION,
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
RPPC_LOGIN_PATH = getattr(_config_mod, "RPPC_LOGIN_PATH", os.getenv("RPPC_LOGIN_PATH", "")).strip()
RPPC_MUNICIPIO_ID = int(getattr(_config_mod, "RPPC_MUNICIPIO_ID", 2) or 2)
RPPC_LOCALIDAD_ID = int(getattr(_config_mod, "RPPC_LOCALIDAD_ID", 1) or 1)
RPPC_USUARIO_ID = getattr(_config_mod, "RPPC_USUARIO_ID", None)
from database import get_conn, asegurar_columna_folio_real_padron

router = APIRouter(prefix="/rppc", tags=["rppc"])
logger = logging.getLogger("catastro-tijuana-api")
_rppc_last_consulta_error: str | None = None
_rppc_last_unidad_debug: dict[str, Any] | None = None
RPPC_INMUEBLES_RESPUESTA_MAX = int(os.getenv("RPPC_INMUEBLES_RESPUESTA_MAX", "120"))
RPPC_CONSULTA_INMUEBLES_TIMEOUT = int(os.getenv("RPPC_CONSULTA_INMUEBLES_TIMEOUT", "90"))
RPPC_CONSULTA_FOLIO_RAPIDO_TIMEOUT = int(os.getenv("RPPC_CONSULTA_FOLIO_RAPIDO_TIMEOUT", "25"))
_rppc_consulta_sesion_preparada = False


def _columnas_tabla_rppc(cur, esquema: str, tabla: str) -> set[str]:
    """Columnas de una tabla; local para no depender de database.py desactualizado en servidor."""
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s
          AND table_name = %s;
        """,
        (esquema, tabla),
    )
    return {r["column_name"] for r in cur.fetchall()}

RPPC_PDF_LOCAL_DIR = Path(os.getenv("RPPC_PDF_LOCAL_DIR", str(Path(DOCUMENTOS_BASE_DIR) / "rppc")))
RPPC_HOJA_INSCRIPCION_ACTION = "ReporteVerHojaInsc"
RPPC_HOJA_INSCRIPCION_DOC_PREFIX = "PARTIDA_"

RPPC_UA = f"SGC-Catastro-{APP_MUNICIPIO}/1.0 (+consulta-interna)"
RPPC_RUNTIME_COOKIE_FILE = os.getenv(
    "RPPC_RUNTIME_COOKIE_FILE",
    str(Path(APP_DIR) / ".runtime" / "rppc_cookie.txt"),
)
RPPC_RENOVAR_COOKIE_SCRIPT = os.getenv(
    "RPPC_RENOVAR_COOKIE_SCRIPT",
    str(Path(APP_DIR) / "rppc_renovar_cookie.py"),
)
RPPC_RENOVAR_COOKIE_CWD = os.getenv("RPPC_RENOVAR_COOKIE_CWD", APP_DIR)
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
_rppc_comparacion_por_clave: dict[str, dict[str, Any]] = {}
_rppc_columnas_cache_verificadas = False
_rppc_precalc_en_curso: set[str] = set()
_rppc_precalc_lock = threading.Lock()
_rppc_precalc_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rppc-precalc")
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
    if not txt:
        return None
    if txt.endswith(".0"):
        txt = txt[:-2]
    try:
        if "." in txt:
            return int(float(txt))
    except ValueError:
        pass
    return int(txt) if txt.isdigit() else None


def _extraer_folio_real_rppc(item: dict[str, Any]) -> int | None:
    for key in ("FOLIO_REAL", "folio_real", "FolioReal", "FOLIO", "folio"):
        val = _normalizar_numero(item.get(key))
        if val and val > 0:
            return val
    return None


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


def _reset_rppc_opener_solo_jar() -> None:
    """Reinicia opener/cookie jar sin borrar caché de /WebAPI/Help."""
    global _rppc_opener, _rppc_login_ok, _rppc_cookie_jar
    _rppc_opener = None
    _rppc_login_ok = None
    _rppc_cookie_jar = None


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
        headers=_headers_rppc_auth({
            "Accept": "text/html,application/json,*/*",
            "User-Agent": RPPC_UA,
        }),
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


def _normalizar_cookie_rppc_raw(raw: str) -> str:
    txt = str(raw or "").strip()
    if txt.lower().startswith("cookie:"):
        txt = txt.split(":", 1)[1].strip()
    # Quitar comentarios/markdown accidentales (-->>, #, líneas "host ...")
    partes_limpias: list[str] = []
    for linea in txt.replace("\r", "\n").split("\n"):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        if linea.lower().startswith("host "):
            continue
        if linea.startswith("--"):
            continue
        partes_limpias.append(linea)
    txt = " ".join(partes_limpias).strip()
    # Colapsar espacios alrededor de ';'
    while "; " in txt:
        txt = txt.replace("; ", ";")
    while " ;" in txt:
        txt = txt.replace(" ;", ";")
    return txt


def _diagnostico_cookie_rppc(cookie: str) -> dict[str, Any]:
    txt = _normalizar_cookie_rppc_raw(cookie)
    tiene_aspnet = ".AspNet.ApplicationCookie=" in txt
    tiene_csrf = "__RequestVerificationToken" in txt
    min_recomendado = 400
    return {
        "longitud": len(txt),
        "tiene_aspnet": tiene_aspnet,
        "tiene_csrf": tiene_csrf,
        "tiene_ga": "_ga=" in txt,
        "valida": bool(txt) and tiene_aspnet and len(txt) >= min_recomendado,
        "min_recomendado": min_recomendado,
    }


def _extraer_request_verification_token(cookie: str) -> str | None:
    txt = _normalizar_cookie_rppc_raw(cookie)
    if not txt:
        return None
    for parte in txt.split(";"):
        parte = parte.strip()
        if parte.startswith("__RequestVerificationToken"):
            _, _, valor = parte.partition("=")
            valor = valor.strip()
            return valor or None
    return None


def _cookie_rppc_valida(cookie: str) -> bool:
    return _diagnostico_cookie_rppc(cookie).get("valida") is True


def _leer_cookie_rppc_archivo() -> str:
    if not RPPC_RUNTIME_COOKIE_FILE:
        return ""
    try:
        raw = Path(RPPC_RUNTIME_COOKIE_FILE).read_text(encoding="utf-8", errors="replace")
        return _normalizar_cookie_rppc_raw(raw)
    except Exception:
        return ""


def _cookie_rppc_actual() -> str:
    """Obtiene la cookie RPPC vigente.

    Prioridad:
    1) Archivo .runtime/rppc_cookie.txt (cookie completa del navegador F12).
    2) RPPC_COOKIE del .env como respaldo temporal.
    """
    cookie = _leer_cookie_rppc_archivo()
    if cookie and _cookie_rppc_valida(cookie):
        return cookie

    fallback = _normalizar_cookie_rppc_raw(RPPC_COOKIE or "")
    if fallback and _cookie_rppc_valida(fallback):
        return fallback
    return cookie or fallback


def _renovar_cookie_rppc_runtime() -> bool:
    """Ejecuta el renovador Playwright y deja la cookie en archivo runtime."""
    if not (RPPC_USUARIO and RPPC_PASSWORD):
        return False
    if not RPPC_RENOVAR_COOKIE_SCRIPT or not os.path.exists(RPPC_RENOVAR_COOKIE_SCRIPT):
        return False

    try:
        resultado = subprocess.run(
            [sys.executable, RPPC_RENOVAR_COOKIE_SCRIPT],
            cwd=RPPC_RENOVAR_COOKIE_CWD,
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
    headers.setdefault("Accept", "application/json, text/plain, */*")
    headers.setdefault("Origin", "https://rppcweb.ebajacalifornia.gob.mx")

    cookie = _cookie_rppc_actual()
    if cookie:
        headers["Cookie"] = cookie
        token_csrf = _extraer_request_verification_token(cookie)
        if token_csrf:
            headers["RequestVerificationToken"] = token_csrf
        headers.setdefault("X-Requested-With", "XMLHttpRequest")

    if _rppc_login_ok and _rppc_auth_token:
        headers["Authorization"] = f"Bearer {_rppc_auth_token}"
        headers["X-Auth-Token"] = _rppc_auth_token
    elif _rppc_auth_token:
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

    if RPPC_USUARIO and RPPC_PASSWORD and _rppc_login_ok is not True:
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
    opener: urllib.request.OpenerDirector | None = None
    if _usar_cookie_rppc_manual():
        opener = _build_opener_para_consulta_rppc()
    return _request_rppc_raw(
        method,
        url,
        data=data,
        content_type=content_type,
        timeout=timeout,
        opener=opener,
    )


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
        headers=_headers_rppc_auth({
            "Accept": "text/html,application/javascript,*/*",
            "User-Agent": RPPC_UA,
        }),
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


def _opener_rppc_cookie_manual() -> urllib.request.OpenerDirector:
    """Opener sin CookieJar: solo cookie manual vía header (evita conflicto doble cookie)."""
    ctx = _crear_ssl_context_rppc()
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))


def _usar_cookie_rppc_manual() -> bool:
    cookie = _cookie_rppc_actual()
    return _cookie_rppc_valida(cookie)


def _build_opener_para_consulta_rppc() -> urllib.request.OpenerDirector:
    """Opener para consultaInmuebles: cookie F12 vía header, sin CookieJar."""
    if _usar_cookie_rppc_manual():
        return _opener_rppc_cookie_manual()
    return _build_opener(force_new=True, skip_login=True)


def _ejecutar_post_rppc_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    payload: dict[str, Any],
    *,
    timeout: int = RPPC_TIMEOUT_POST,
) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers=_headers_rppc_auth({
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": RPPC_UA,
        }),
        method="POST",
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.getcode(), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        return exc.code, body
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo contactar al RPPC: {_mensaje_url_error(exc)}",
        ) from exc


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
    else:
        http, body = _ejecutar_post_rppc_json(opener, url, payload)

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


def _truncar_inmuebles_para_respuesta(
    inmuebles: list[dict[str, Any]],
    limite: int | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    max_items = limite if limite is not None else RPPC_INMUEBLES_RESPUESTA_MAX
    if max_items <= 0 or len(inmuebles) <= max_items:
        return inmuebles, False
    return inmuebles[:max_items], True


def _es_envelope_respuesta_rppc(parsed: dict[str, Any]) -> bool:
    return any(
        k in parsed
        for k in ("success", "Success", "IsError", "totalCount", "ErrMessage", "ErrIdUsuario")
    )


def _es_item_movimiento_rppc(item: dict[str, Any]) -> bool:
    if not isinstance(item, dict) or not item:
        return False
    if _es_envelope_respuesta_rppc(item):
        return False
    if item.get("PARTIDA") or item.get("partida"):
        return True
    if item.get("DOC_TRAMITE_ID") or item.get("ACTO") or item.get("FECHA_REGISTRO"):
        return True
    return False


def _es_item_rppc_datos(item: dict[str, Any]) -> bool:
    return _es_item_inmueble_rppc(item) or _es_item_movimiento_rppc(item)


def _es_item_inmueble_rppc(item: dict[str, Any]) -> bool:
    if not isinstance(item, dict) or not item:
        return False
    if _es_envelope_respuesta_rppc(item):
        return False
    if _extraer_folio_real_rppc(item):
        return True
    if str(item.get("LOTE") or "").strip():
        return True
    if item.get("CVE_CAT") or item.get("TIPO_PREDIO"):
        return True
    return False


def _parsear_movimientos_rppc(body: str) -> list[dict[str, Any]]:
    """Parsea obtenerMovimientosLote — filas con PARTIDA/ACTO, no inmueble."""
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Respuesta inválida del RPPC (movimientos): {body[:180]}",
        ) from exc

    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict) and _es_item_movimiento_rppc(x)]
    if not isinstance(parsed, dict):
        return []

    datos = parsed.get("Datos") if parsed.get("Datos") is not None else parsed.get("datos")
    if isinstance(datos, list):
        items = [x for x in datos if isinstance(x, dict) and _es_item_movimiento_rppc(x)]
        if items:
            return items
    elif isinstance(datos, dict) and _es_item_movimiento_rppc(datos):
        return [datos]

    ds = parsed.get("DatosString") or parsed.get("datosString")
    if isinstance(ds, str) and ds.strip():
        try:
            inner = json.loads(ds)
            if isinstance(inner, list):
                items = [x for x in inner if isinstance(x, dict) and _es_item_movimiento_rppc(x)]
                if items:
                    return items
            elif isinstance(inner, dict) and _es_item_movimiento_rppc(inner):
                return [inner]
        except json.JSONDecodeError:
            pass

    if parsed.get("success") is False or parsed.get("Success") is False:
        msg = parsed.get("Mensaje") or parsed.get("message") or parsed.get("detail") or "sin detalle"
        raise HTTPException(status_code=502, detail=f"RPPC respondió error: {msg}")

    if _es_item_movimiento_rppc(parsed):
        return [parsed]
    return []


def _parsear_datos_rppc(body: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Respuesta inválida del RPPC: {body[:180]}",
        ) from exc

    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict) and _es_item_rppc_datos(x)]
    if not isinstance(parsed, dict):
        return []

    if parsed.get("success") is False or parsed.get("Success") is False:
        msg = parsed.get("Mensaje") or parsed.get("message") or parsed.get("detail") or "sin detalle"
        raise HTTPException(status_code=502, detail=f"RPPC respondió error: {msg}")

    datos = parsed.get("Datos") if parsed.get("Datos") is not None else parsed.get("datos")
    if isinstance(datos, list):
        items = [x for x in datos if isinstance(x, dict) and _es_item_rppc_datos(x)]
        if items:
            return items
    elif isinstance(datos, dict) and _es_item_rppc_datos(datos):
        return [datos]

    ds = parsed.get("DatosString") or parsed.get("datosString")
    if isinstance(ds, str) and ds.strip():
        try:
            inner = json.loads(ds)
            if isinstance(inner, list):
                items = [x for x in inner if isinstance(x, dict) and _es_item_rppc_datos(x)]
                if items:
                    return items
            elif isinstance(inner, dict) and _es_item_rppc_datos(inner):
                return [inner]
        except json.JSONDecodeError:
            pass

    if parsed.get("PARTIDA") or parsed.get("partida"):
        return [parsed]
    if _es_item_rppc_datos(parsed):
        return [parsed]
    return []


def _consultar_movimientos_folio(folio_real: int, _renovado: bool = False) -> list[dict[str, Any]]:
    global _rppc_working_movimientos_url, _rppc_working_movimientos_action
    errores: list[str] = []

    try:
        datos_directos = _consultar_movimientos_folio_directo(folio_real)
        if datos_directos:
            _rppc_working_movimientos_url = _url_api_desde_ruta(
                RPPC_BASE_URL,
                "Servicios/ConsultaAvanzada/obtenerMovimientosLote",
                solo_base=True,
            )
            _rppc_working_movimientos_action = "obtenerMovimientosLote"
            return datos_directos
    except HTTPException as exc:
        errores.append(f"directo: {exc.detail}")

    if _cookie_rppc_valida(_cookie_rppc_actual()):
        raise HTTPException(
            status_code=502,
            detail=errores[0] if errores else f"Sin movimientos RPPC para folio {folio_real}",
        )

    _asegurar_rppc_listo(folio_prueba=folio_real)

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
            datos = _parsear_movimientos_rppc(body)
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


def _completar_payload_consulta_inmuebles_rppc(
    payload: dict[str, Any],
    *,
    incluir_usuario_id: bool = False,
) -> dict[str, Any]:
    """Payload consultaInmuebles. F12: sesión en cookie; USUARIO_ID opcional."""
    body = dict(payload)
    if not incluir_usuario_id:
        return body
    uid = _rppc_usuario_id or RPPC_USUARIO_ID or _rppc_usuario_id_runtime()
    if uid and "USUARIO_ID" not in body:
        body["USUARIO_ID"] = int(uid)
    return body


def _payload_consulta_inmuebles_rppc(
    payload: dict[str, Any],
    *,
    incluir_usuario_id: bool | None = None,
) -> dict[str, Any]:
    """Payload al portal. Por defecto sin USUARIO_ID (igual que F12 con cookie)."""
    if incluir_usuario_id is None:
        incluir_usuario_id = bool(_rppc_usuario_id)
    return _completar_payload_consulta_inmuebles_rppc(
        payload,
        incluir_usuario_id=incluir_usuario_id,
    )


def _variantes_body_consulta_inmuebles_rppc(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Prueba sin USUARIO_ID (F12) y con USUARIO_ID (.env) si aplica."""
    bases = [_payload_consulta_inmuebles_rppc(payload, incluir_usuario_id=False)]
    uid = _rppc_usuario_id or RPPC_USUARIO_ID or _rppc_usuario_id_runtime()
    if uid:
        con_uid = _payload_consulta_inmuebles_rppc(payload, incluir_usuario_id=True)
        if con_uid not in bases:
            bases.append(con_uid)
    return bases


def _rppc_usuario_id_runtime() -> int | None:
    path = Path(APP_DIR) / ".runtime" / "rppc_usuario_id.txt"
    try:
        raw = path.read_text(encoding="utf-8").strip()
        val = int(raw)
        return val if val > 0 else None
    except Exception:
        return None


def _variantes_manzana_rppc(manzana: str) -> list[str]:
    txt = str(manzana or "").strip()
    if not txt:
        return []
    variantes: list[str] = []
    vistos: set[str] = set()

    def _agregar(valor: str) -> None:
        v = str(valor or "").strip()
        if v and v not in vistos:
            vistos.add(v)
            variantes.append(v)

    _agregar(txt)
    if txt.isdigit():
        _agregar(txt.lstrip("0") or txt)
        _agregar(txt.zfill(3))
    return variantes


def _marcar_sesion_consulta_rppc_nueva() -> None:
    global _rppc_consulta_sesion_preparada
    _rppc_consulta_sesion_preparada = False


def _preparar_sesion_consulta_rppc(force: bool = False) -> urllib.request.OpenerDirector:
    """Preflight + Help (caché) antes de consultaInmuebles — sin escaneo pesado."""
    global _rppc_consulta_sesion_preparada, _rppc_opener, _rppc_login_ok
    if _rppc_consulta_sesion_preparada and not force and _rppc_opener is not None:
        return _rppc_opener
    if not _rppc_login_ok and not _cookie_rppc_actual():
        raise HTTPException(
            status_code=502,
            detail=(
                "Sesión RPPC no disponible. Renueve .runtime/rppc_cookie.txt "
                "(Cookie completa F12: RequestVerificationToken + AspNet.ApplicationCookie)."
            ),
        )
    _reset_rppc_opener_solo_jar()
    opener = _build_opener_para_consulta_rppc()
    _preflight_rppc_session(opener)
    _cargar_apis_rppc(opener)
    _rppc_opener = opener
    _rppc_consulta_sesion_preparada = True
    return _rppc_opener


def _asegurar_rppc_sesion_consulta() -> urllib.request.OpenerDirector:
    return _preparar_sesion_consulta_rppc()


def _post_consulta_inmuebles_rppc(
    url: str,
    payload: dict[str, Any],
    *,
    opener: urllib.request.OpenerDirector | None = None,
    timeout: int | None = None,
) -> list[dict[str, Any]]:
    """POST consultaInmuebles — mismo opener y payload que el probe del diagnóstico."""
    client = opener or _asegurar_rppc_sesion_consulta()
    body_payload = _payload_consulta_inmuebles_rppc(payload)
    http, body = _ejecutar_post_rppc_json(
        client,
        url,
        body_payload,
        timeout=timeout or RPPC_CONSULTA_INMUEBLES_TIMEOUT,
    )
    if http >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"RPPC HTTP {http} consultaInmuebles: {body[:240] or 'sin cuerpo'}",
        )
    return _parsear_datos_rppc(body)


def _consultar_inmuebles_rppc(payload: dict[str, Any], _renovado: bool = False) -> list[dict[str, Any]]:
    """POST genérico a ConsultaAvanzada/consultaInmuebles."""
    global _rppc_last_consulta_error
    base = dict(payload)
    if not str(base.get("DESCR") or "").strip():
        base.pop("DESCR", None)

    if base.get("FOLIO_REAL") or base.get("LOTE_ID"):
        return _consultar_inmuebles_rppc_por_payload_folio_amplio(base, _renovado=_renovado)

    opener = _asegurar_rppc_sesion_consulta() if not _renovado else _preparar_sesion_consulta_rppc(force=True)

    url = _url_api_desde_ruta(
        RPPC_BASE_URL,
        "Servicios/ConsultaAvanzada/consultaInmuebles",
        solo_base=True,
    )

    candidatos: list[dict[str, Any]] = []
    vistos_payload: set[str] = set()
    manzanas = _variantes_manzana_rppc(str(base.get("MANZANA") or "")) or [str(base.get("MANZANA") or "")]
    buscar_opts = [str(base.get("BUSCAR") or "D").upper()]
    if "U" not in buscar_opts:
        buscar_opts.append("U")
    if "D" not in buscar_opts:
        buscar_opts.append("D")
    for manzana in manzanas:
        for buscar in buscar_opts:
            body_payload = dict(base)
            if manzana:
                body_payload["MANZANA"] = manzana
            body_payload["BUSCAR"] = buscar
            if not str(body_payload.get("DESCR") or "").strip():
                body_payload.pop("DESCR", None)
            clave = json.dumps(body_payload, sort_keys=True)
            if clave not in vistos_payload:
                vistos_payload.add(clave)
                candidatos.append(body_payload)

    return _ejecutar_consultas_inmuebles_rppc(
        url,
        candidatos,
        opener=opener,
        _renovado=_renovado,
        payload_original=base,
    )


def _ejecutar_consultas_inmuebles_rppc(
    url: str,
    candidatos: list[dict[str, Any]],
    *,
    opener,
    _renovado: bool,
    payload_original: dict[str, Any],
) -> list[dict[str, Any]]:
    """Ejecuta payloads y devuelve el resultado no vacío más amplio."""
    global _rppc_last_consulta_error
    ultimo_error: HTTPException | None = None
    mejor: list[dict[str, Any]] = []

    for body_payload in candidatos:
        for body_enviado in _variantes_body_consulta_inmuebles_rppc(body_payload):
            try:
                datos = _post_consulta_inmuebles_rppc(url, body_enviado, opener=opener)
                _rppc_last_consulta_error = None
                if len(datos) > len(mejor):
                    mejor = datos
            except HTTPException as exc:
                ultimo_error = exc
                _rppc_last_consulta_error = str(exc.detail)[:300]
                if "Object reference not set" not in str(exc.detail or ""):
                    break
        if ultimo_error and "Object reference not set" not in str(ultimo_error.detail or ""):
            break

    if mejor:
        return mejor

    if (
        ultimo_error
        and not _renovado
        and "Object reference not set" in str(ultimo_error.detail or "")
    ):
        _marcar_sesion_consulta_rppc_nueva()
        return _consultar_inmuebles_rppc(payload_original, _renovado=True)

    if ultimo_error:
        if not _renovado and RPPC_USUARIO and RPPC_PASSWORD:
            if _renovar_cookie_rppc_runtime():
                _reset_rppc_opener()
                _rppc_login_ok = None
                return _consultar_inmuebles_rppc(payload_original, _renovado=True)
        raise ultimo_error
    return []


def _consultar_inmuebles_rppc_por_payload_folio_amplio(
    base: dict[str, Any],
    *,
    _renovado: bool = False,
) -> list[dict[str, Any]]:
    """Consulta por FOLIO_REAL/LOTE_ID probando BUSCAR/CLASIFICACION sin cortar en vacío."""
    opener = _asegurar_rppc_sesion_consulta() if not _renovado else _preparar_sesion_consulta_rppc(force=True)
    url = _url_api_desde_ruta(
        RPPC_BASE_URL,
        "Servicios/ConsultaAvanzada/consultaInmuebles",
        solo_base=True,
    )

    clasif_base = str(base.get("CLASIFICACION") or "U").upper()
    buscar_base = str(base.get("BUSCAR") or "D").upper()
    candidatos: list[dict[str, Any]] = []
    vistos: set[str] = set()

    for buscar in (buscar_base, "D", "U", "F"):
        for clasif in (clasif_base, "U", "L"):
            pl = dict(base)
            pl["BUSCAR"] = buscar
            pl["CLASIFICACION"] = clasif
            pl.pop("MANZANA", None)
            if not str(pl.get("DESCR") or "").strip():
                pl.pop("DESCR", None)
            clave = json.dumps(pl, sort_keys=True)
            if clave in vistos:
                continue
            vistos.add(clave)
            candidatos.append(pl)

    return _ejecutar_consultas_inmuebles_rppc(
        url,
        candidatos,
        opener=opener,
        _renovado=_renovado,
        payload_original=base,
    )


def _consultar_inmuebles_rppc_opcional(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Igual que _consultar_inmuebles_rppc pero devuelve [] si RPPC responde error HTTP."""
    try:
        if payload.get("FOLIO_REAL") or payload.get("LOTE_ID"):
            return _consultar_inmuebles_rppc_folio_rapido(payload)
        return _consultar_inmuebles_rppc(payload)
    except HTTPException as exc:
        logger.warning("consultaInmuebles RPPC falló: %s", exc.detail)
        return []
    except Exception:
        logger.exception("consultaInmuebles RPPC error inesperado")
        return []


def _consultar_inmuebles_rppc_folio_rapido(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Consulta por folio/lote con 1–2 POST (evita barrido de 12+ variantes)."""
    opener = _asegurar_rppc_sesion_consulta()
    url = _url_api_desde_ruta(
        RPPC_BASE_URL,
        "Servicios/ConsultaAvanzada/consultaInmuebles",
        solo_base=True,
    )
    base = dict(payload)
    base.pop("MANZANA", None)
    if not str(base.get("DESCR") or "").strip():
        base.pop("DESCR", None)
    for incluir_uid in (False, True):
        body = _payload_consulta_inmuebles_rppc(base, incluir_usuario_id=incluir_uid)
        try:
            return _post_consulta_inmuebles_rppc(
                url,
                body,
                opener=opener,
                timeout=RPPC_CONSULTA_FOLIO_RAPIDO_TIMEOUT,
            )
        except HTTPException:
            continue
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    return []


def _consultar_unidades_bajo_folio_padre(folio_padre: int) -> list[dict[str, Any]]:
    """Hijos de un folio de terreno — patrón F12: BUSCAR=D, CLASIFICACION=U."""
    return _consultar_inmuebles_rppc_folio_rapido(
        {
            "FOLIO_REAL": int(folio_padre),
            "MUNICIPIO": RPPC_MUNICIPIO_ID,
            "LOCALIDAD": RPPC_LOCALIDAD_ID,
            "VIGENTE": "S",
            "BUSCAR": "D",
            "CLASIFICACION": "U",
        }
    )


# Respaldo si cat_colonias aún no tiene rppc_colonia_id poblado en BD.
_RPPC_COLONIA_FALLBACK: list[tuple[str, int]] = [
    ("VILLA RESIDENCIAL SANTA FE", 1342),
]

# Folios de terreno cuando consultaInmuebles por manzana falla (cookie/sesión).
_RPPC_TERRENOS_FALLBACK: dict[tuple[str, int], list[int]] = {
    ("701", 1342): [1109048, 1109049, 1109050, 1109051, 1109052, 1109053, 1109054],
}


def _folios_terreno_fallback(manzana: str, colonia_id: int | None) -> list[int]:
    if colonia_id is None:
        return []
    key = (str(manzana or "").strip(), int(colonia_id))
    return list(_RPPC_TERRENOS_FALLBACK.get(key) or [])


def _rppc_consulta_inmuebles_no_disponible() -> bool:
    err = str(_rppc_last_consulta_error or "")
    if not err:
        return False
    return (
        "Object reference not set" in err
        or "HTTP 400" in err
        or "HTTP 401" in err
        or "HTTP 403" in err
    )


def _terrenos_sinteticos_desde_folios(folios: list[int]) -> list[dict[str, Any]]:
    return [
        {"FOLIO_REAL": folio, "TIPO_PREDIO": "L", "VIGENTE": "S"}
        for folio in folios
        if folio
    ]


def _fallback_rppc_colonia_id(colonia_nombre: str) -> int | None:
    ref = _normalizar_texto_rppc_busqueda(colonia_nombre)
    if not ref:
        return None
    for needle, colonia_id in _RPPC_COLONIA_FALLBACK:
        n = _normalizar_texto_rppc_busqueda(needle)
        if n and (n in ref or ref in n):
            return colonia_id
    return None


def _resolver_rppc_colonia_id(datos_padron: dict[str, Any]) -> int | None:
    cid = _normalizar_numero(datos_padron.get("rppc_colonia_id"))
    if cid:
        return cid
    colonia = str(datos_padron.get("colonia") or "").strip()
    if colonia:
        cid = _buscar_rppc_colonia_id_por_nombre(colonia)
        if cid:
            return cid
        cid = _fallback_rppc_colonia_id(colonia)
        if cid:
            return cid
    return None


def _segmentos_clave_catastral_rppc(clave_catastral: str) -> dict[str, str]:
    """Deriva manzana/lote desde claves tipo XL701261, BDM001003, ST312031."""
    clave = re.sub(r"[^A-Za-z0-9]", "", str(clave_catastral or "")).upper()
    m = re.match(r"^[A-Z]{2,3}(\d{6})$", clave)
    if not m:
        return {}
    nums = m.group(1)
    manzana = nums[:3].lstrip("0") or nums[:3]
    lote = nums[3:6].lstrip("0") or nums[3:6]
    return {"manzana": manzana, "lote": lote, "manzana_padded": nums[:3], "lote_padded": nums[3:6]}


def _normalizar_texto_rppc_busqueda(texto: str) -> str:
    txt = unicodedata.normalize("NFKD", str(texto or ""))
    txt = "".join(ch for ch in txt if not unicodedata.combining(ch))
    txt = re.sub(r"[^A-Z0-9\s]", " ", txt.upper())
    return re.sub(r"\s+", " ", txt).strip()


def _asegurar_columna_rppc_colonia_id(cur, conn) -> None:
    try:
        cur.execute(
            """
            ALTER TABLE catalogos.cat_colonias
            ADD COLUMN IF NOT EXISTS rppc_colonia_id integer;
            """
        )
        conn.commit()
    except Exception:
        conn.rollback()


def _datos_padron_busqueda_rppc(clave_catastral: str) -> dict[str, Any]:
    """Lee del padrón los campos útiles para consulta RPPC por ubicación/unidad."""
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        return {}
    datos: dict[str, Any] = {"clave_catastral": clave}
    datos.update(_segmentos_clave_catastral_rppc(clave))

    with get_conn() as conn:
        with conn.cursor() as cur:
            cols = _columnas_tabla_rppc(cur, "catalogos", "padron_2026")
            _asegurar_columna_rppc_colonia_id(cur, conn)

            select_parts = ["TRIM(COALESCE(p.colonia, '')) AS colonia"]
            if "manzana" in cols:
                select_parts.append("TRIM(COALESCE(p.manzana::text, '')) AS manzana_padron")
            if "lote" in cols:
                select_parts.append("TRIM(COALESCE(p.lote::text, '')) AS lote_padron")
            if "numint" in cols:
                select_parts.append("TRIM(COALESCE(p.numint, '')) AS unidad")
            elif "numero_interior" in cols:
                select_parts.append("TRIM(COALESCE(p.numero_interior, '')) AS unidad")
            if "condomino" in cols:
                select_parts.append("TRIM(COALESCE(p.condomino, '')) AS condomino")
            if "letra" in cols:
                select_parts.append("TRIM(COALESCE(p.letra, '')) AS letra")
            if "nom_condominio" in cols:
                select_parts.append("TRIM(COALESCE(p.nom_condominio, '')) AS nom_condominio")
            if "condominio" in cols:
                select_parts.append("TRIM(COALESCE(p.condominio, '')) AS condominio")
            for campo in ("pnombre", "paterno", "materno", "razon_social", "nombre_completo"):
                if campo in cols:
                    select_parts.append(f"TRIM(COALESCE(p.{campo}, '')) AS {campo}")
            if "folio_real" in cols:
                select_parts.append("NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') AS folio_real")

            joins = []
            try:
                cat_cols = _columnas_tabla_rppc(cur, "catalogos", "cat_colonias")
            except Exception:
                cat_cols = set()
            if "rppc_colonia_id" in cat_cols:
                select_parts.append("col.rppc_colonia_id")
                select_parts.append("col.nombre_colonia AS cat_colonia_nombre")
                if "colonia_id" in cols:
                    joins.append(
                        "LEFT JOIN catalogos.cat_colonias col ON p.colonia_id = col.id"
                    )
                else:
                    joins.append(
                        "LEFT JOIN catalogos.cat_colonias col "
                        "ON UPPER(TRIM(col.nombre_colonia)) = UPPER(TRIM(p.colonia))"
                    )

            try:
                pc_cols = _columnas_tabla_rppc(cur, "catastro", "predio_condominio")
            except Exception:
                pc_cols = set()
            if "nombre_condominio" in pc_cols:
                select_parts.append("TRIM(COALESCE(pc.nombre_condominio, '')) AS nombre_condominio")
                joins.append(
                    "LEFT JOIN catastro.predio_condominio pc "
                    "ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))"
                )

            sql = f"""
                SELECT {", ".join(select_parts)}
                FROM catalogos.padron_2026 p
                {" ".join(joins)}
                WHERE UPPER(TRIM(p.clave_catastral)) = %s
                LIMIT 1;
            """
            cur.execute(sql, (clave,))
            row = cur.fetchone()

    if not row:
        datos["variantes_unidad"] = _variantes_unidad_rppc(datos)
        return datos

    for key, val in row.items():
        if val is not None and str(val).strip() != "":
            datos[key] = val

    if datos.get("nombre_condominio") and not datos.get("nom_condominio"):
        datos["nom_condominio"] = datos["nombre_condominio"]

    if datos.get("manzana_padron"):
        manz = str(datos["manzana_padron"]).strip().lstrip("0") or str(datos["manzana_padron"]).strip()
        datos.setdefault("manzana", manz)
    if datos.get("lote_padron"):
        lt = str(datos["lote_padron"]).strip().lstrip("0") or str(datos["lote_padron"]).strip()
        datos.setdefault("lote", lt)

    if not datos.get("rppc_colonia_id") and datos.get("colonia"):
        colonia_txt = str(datos.get("colonia") or "")
        datos["rppc_colonia_id"] = (
            _buscar_rppc_colonia_id_por_nombre(colonia_txt)
            or _fallback_rppc_colonia_id(colonia_txt)
        )

    unidad_rppc = _unidad_rppc_desde_padron(datos)
    if unidad_rppc:
        datos["unidad_rppc"] = unidad_rppc
        if not datos.get("unidad") or str(datos.get("unidad")).strip().isdigit():
            datos["unidad"] = unidad_rppc

    datos["variantes_unidad"] = _variantes_unidad_rppc(datos)
    return datos


def _unidad_rppc_desde_padron(datos_padron: dict[str, Any]) -> str:
    """Compone unidad RPPC tipo C-41 desde letra + numint separados en padrón Tijuana."""
    letra = str(datos_padron.get("letra") or "").strip().upper()
    num = str(
        datos_padron.get("unidad")
        or datos_padron.get("numint")
        or datos_padron.get("numero_interior")
        or ""
    ).strip()
    if not num:
        return ""
    num_limpio = re.sub(r"[^0-9]", "", num) or num
    if letra and len(letra) <= 3 and num_limpio.isdigit():
        compuesta = f"{letra}-{num_limpio}"
        if compuesta.upper().replace("-", "") not in num.upper().replace("-", ""):
            return compuesta
    return num


def _buscar_rppc_colonia_id_por_nombre(colonia_nombre: str) -> int | None:
    ref = _normalizar_texto_rppc_busqueda(colonia_nombre)
    if not ref:
        return None
    with get_conn() as conn:
        with conn.cursor() as cur:
            try:
                cat_cols = _columnas_tabla_rppc(cur, "catalogos", "cat_colonias")
            except Exception:
                return None
            if "rppc_colonia_id" not in cat_cols:
                return None
            cur.execute(
                """
                SELECT rppc_colonia_id, nombre_colonia
                FROM catalogos.cat_colonias
                WHERE rppc_colonia_id IS NOT NULL
                """
            )
            rows = cur.fetchall()
    tokens = [t for t in ref.split() if len(t) >= 4]
    if not tokens:
        return None
    mejor_id = None
    mejor_score = 0
    for row in rows:
        nombre = _normalizar_texto_rppc_busqueda(row.get("nombre_colonia") or "")
        score = sum(1 for tok in tokens if tok in nombre)
        if score > mejor_score:
            mejor_score = score
            mejor_id = _normalizar_numero(row.get("rppc_colonia_id"))
    return mejor_id if mejor_score >= min(2, len(tokens)) else None


def _variantes_unidad_rppc(datos_padron: dict[str, Any]) -> list[str]:
    """Genera variantes de unidad/LOCAL para RPPC (ej. C-41 → LOCAL C-41)."""
    raw = str(
        datos_padron.get("unidad_rppc")
        or _unidad_rppc_desde_padron(datos_padron)
        or datos_padron.get("unidad")
        or datos_padron.get("numint")
        or datos_padron.get("numero_interior")
        or datos_padron.get("condomino")
        or ""
    ).strip().upper()
    if not raw:
        return []

    variantes: list[str] = []
    vistos: set[str] = set()

    def _agregar(valor: str) -> None:
        txt = re.sub(r"\s+", " ", str(valor or "").strip().upper())
        if not txt or txt in vistos:
            return
        vistos.add(txt)
        variantes.append(txt)

    _agregar(raw)
    if not raw.startswith("LOCAL"):
        _agregar(f"LOCAL {raw}")
        _agregar(f"LOCAL {raw.replace('-', ' ')}")

    m = re.search(r"C\s*-?\s*(\d+)", raw, re.I)
    if m:
        _agregar(f"C-{m.group(1)}")
        _agregar(f"LOCAL C-{m.group(1)}")
        _agregar(f"LOCAL C {m.group(1)}")

    m2 = re.search(r"(\d+)\s*$", raw)
    if m2 and "C" not in raw:
        _agregar(f"LOCAL C-{m2.group(1)}")

    local_first = [v for v in variantes if str(v).upper().startswith("LOCAL")]
    otros = [v for v in variantes if not str(v).upper().startswith("LOCAL")]
    return local_first + otros


def _debe_priorizar_busqueda_unidad_rppc(datos_padron: dict[str, Any]) -> bool:
    if datos_padron.get("unidad") or datos_padron.get("numint"):
        return True
    if datos_padron.get("variantes_unidad"):
        return True
    clave = str(datos_padron.get("clave_catastral") or "").upper()
    if clave.startswith(("XL", "CL", "XC")):
        return True
    condominio = str(datos_padron.get("condominio") or "").strip().upper()
    if condominio in {"C", "S", "CONDOMINIO", "SI", "SÍ", "S"}:
        return True
    if str(datos_padron.get("nom_condominio") or "").strip():
        return True
    return False


def _extraer_numero_unidad_condominio_rppc(variante: str) -> tuple[str, str] | None:
    """Extrae bloque C y número (ej. LOCAL C-41 → ('C', '41'))."""
    txt = _normalizar_texto_rppc_busqueda(variante)
    m = re.search(r"\bC\s*-?\s*(\d+)\b", txt, re.I)
    if m:
        return ("C", m.group(1))
    m2 = re.search(r"\b(?:LOCAL|UNIDAD|LOTE)\s+(\d+)\b", txt, re.I)
    if m2:
        return ("", m2.group(1))
    return None


def _lote_rppc_coincide_unidad_estricta(lote_txt: str, variantes_unidad: list[str]) -> bool:
    """Evita falsos positivos (ej. LOCAL C no es LOCAL C-41)."""
    lote_norm = _normalizar_texto_rppc_busqueda(lote_txt)
    if not lote_norm:
        return False
    lote_compacto = re.sub(r"[^A-Z0-9]", "", lote_norm)

    for var in variantes_unidad:
        var_norm = _normalizar_texto_rppc_busqueda(var)
        if not var_norm:
            continue
        if lote_norm == var_norm:
            return True

        parsed = _extraer_numero_unidad_condominio_rppc(var_norm)
        if parsed:
            bloque, numero = parsed
            patrones = [
                rf"\bLOCAL\s+{re.escape(bloque)}\s*-?\s*{re.escape(numero)}\b(?!\d)",
                rf"\bLOCAL\s+UNIDAD\s+{re.escape(bloque)}\s*-?\s*{re.escape(numero)}\b(?!\d)",
                rf"\b{re.escape(bloque)}\s*-?\s*{re.escape(numero)}\b(?!\d)",
                rf"\b{re.escape(bloque)}{re.escape(numero)}\b(?!\d)",
            ]
            if bloque:
                for pat in patrones:
                    if re.search(pat, lote_norm, re.I):
                        return True
                continue

        var_compacto = re.sub(r"[^A-Z0-9]", "", var_norm)
        if len(var_compacto) >= 4 and var_compacto == lote_compacto:
            return True
        if len(var_compacto) >= 5 and var_compacto in lote_compacto:
            return True

    return False


def _coincide_unidad_local_en_inmueble(
    item: dict[str, Any],
    variantes_unidad: list[str],
) -> bool:
    if not variantes_unidad:
        return False
    lote_txt = str(
        item.get("LOTE")
        or item.get("INMUEBLE")
        or item.get("DENOMINACION")
        or ""
    ).strip()
    if not lote_txt:
        return False
    return _lote_rppc_coincide_unidad_estricta(lote_txt, variantes_unidad)


def _grado_coincidencia_unidad_lote_rppc(lote_txt: str, variantes_unidad: list[str]) -> int:
    """0-100: mayor = coincidencia más exacta en LOTE."""
    lote_norm = _normalizar_texto_rppc_busqueda(lote_txt)
    if not lote_norm:
        return 0
    mejor = 0
    for var in variantes_unidad:
        var_norm = _normalizar_texto_rppc_busqueda(var)
        if lote_norm == var_norm:
            return 100
        parsed = _extraer_numero_unidad_condominio_rppc(var_norm)
        if parsed:
            bloque, numero = parsed
            exacto = rf"^LOCAL\s+{re.escape(bloque)}\s*-?\s*{re.escape(numero)}$"
            if bloque and re.search(exacto, lote_norm, re.I):
                mejor = max(mejor, 95)
            elif bloque and re.search(
                rf"\bLOCAL\s+{re.escape(bloque)}\s*-?\s*{re.escape(numero)}\b", lote_norm, re.I
            ):
                mejor = max(mejor, 90)
            elif re.search(rf"\b{re.escape(bloque)}\s*-?\s*{re.escape(numero)}\b", lote_norm, re.I):
                mejor = max(mejor, 80)
    return mejor


def _puntuar_colonia_unidad_rppc(
    item: dict[str, Any],
    datos_padron: dict[str, Any],
) -> int:
    col = _normalizar_texto_rppc_busqueda(item.get("COLONIA") or item.get("FRACCIONAMIENTO") or "")
    if not col:
        return 0

    refs: list[str] = []
    for key in ("colonia", "nom_condominio", "nombre_condominio", "condominio"):
        val = str(datos_padron.get(key) or "").strip()
        if val:
            refs.append(_normalizar_texto_rppc_busqueda(val))
    if not refs:
        return 0
    ref_blob = " ".join(refs)

    puntos = 0
    frases = (
        ("SANTA FE", 35),
        ("VILLA RES", 25),
        ("RESIDENCIAL SANTA FE", 30),
        ("SEVILLA", 20),
        ("SEGUNDA", 15),
        ("II SEC", 15),
        ("SECCION", 10),
    )
    for frase, peso in frases:
        if frase in col and (frase in ref_blob or frase.replace(" ", "") in ref_blob.replace(" ", "")):
            puntos += peso

    if "SANTA FE" in ref_blob and "SEVILLA" in col:
        puntos += 35
    if "SEGUNDA" in ref_blob and ("II SEC" in col or "SEGUNDA" in col):
        puntos += 20
    if str(datos_padron.get("condominio") or "").strip().upper() == "C" and re.search(
        r"\bC\b|\bCONDOMINIO\s+C\b", col
    ):
        puntos += 15

    tokens_ref = {t for t in re.split(r"\s+", ref_blob) if len(t) >= 4}
    tokens_col = {t for t in re.split(r"\s+", col) if len(t) >= 4}
    puntos += min(20, 5 * len(tokens_ref & tokens_col))

    for ajeno in ("FONTANA", "MEDITERRANEO", "HACIENDA SAN FERNANDO", "INFONAVIT", "ALCAZAR", "LORETO"):
        if ajeno in col and ajeno not in ref_blob:
            puntos -= 25

    return puntos


def _filtrar_candidatos_unidad_por_colonia_rppc(
    candidatos: list[dict[str, Any]],
    datos_padron: dict[str, Any],
    *,
    min_score: int = 25,
) -> list[dict[str, Any]]:
    """Si hay colonia RPPC alineada al padrón, descarta fraccionamientos ajenos."""
    if not candidatos:
        return []
    ref = _normalizar_texto_rppc_busqueda(
        " ".join(
            str(datos_padron.get(k) or "")
            for k in ("colonia", "nom_condominio", "nombre_condominio", "condominio")
        )
    )
    if len(ref) < 8:
        return candidatos

    puntuados = [(item, _puntuar_colonia_unidad_rppc(item, datos_padron)) for item in candidatos]
    mejor = max(score for _, score in puntuados)
    if mejor < min_score:
        return candidatos

    umbral = max(min_score, mejor - 20)
    filtrados = [item for item, score in puntuados if score >= umbral]
    return filtrados or candidatos


def _preparar_candidatos_unidad_rppc(
    inmuebles: list[dict[str, Any]],
    datos_padron: dict[str, Any],
    variantes_unidad: list[str],
    *,
    limite: int = 8,
) -> list[dict[str, Any]]:
    estrictos = _filtrar_inmuebles_por_unidad_local(inmuebles, variantes_unidad)
    return _refinar_candidatos_unidad_rppc(
        estrictos,
        datos_padron,
        variantes_unidad,
        limite=limite,
    )


def _refinar_candidatos_unidad_rppc(
    candidatos: list[dict[str, Any]],
    datos_padron: dict[str, Any],
    variantes_unidad: list[str],
    *,
    limite: int = 8,
) -> list[dict[str, Any]]:
    if not candidatos:
        return []
    estrictos = [
        x for x in candidatos
        if _es_item_inmueble_rppc(x) and _coincide_unidad_local_en_inmueble(x, variantes_unidad)
    ]
    pool = estrictos
    if not pool:
        return []

    pool = _filtrar_candidatos_unidad_por_colonia_rppc(pool, datos_padron)

    def _orden(item: dict[str, Any]) -> tuple[int, int, int, int]:
        lote = str(item.get("LOTE") or item.get("INMUEBLE") or "")
        return (
            _grado_coincidencia_unidad_lote_rppc(lote, variantes_unidad),
            _puntuar_colonia_unidad_rppc(item, datos_padron),
            10 if str(item.get("TIPO_PREDIO") or "").upper() == "UNIDAD" else 0,
            -(_extraer_folio_real_rppc(item) or 0),
        )

    pool = sorted(pool, key=_orden, reverse=True)
    if limite > 0:
        pool = pool[:limite]
    return pool


def _filtrar_inmuebles_por_unidad_local(
    inmuebles: list[dict[str, Any]],
    variantes_unidad: list[str],
) -> list[dict[str, Any]]:
    if not variantes_unidad:
        return []
    return [
        x for x in inmuebles
        if _es_item_inmueble_rppc(x) and _coincide_unidad_local_en_inmueble(x, variantes_unidad)
    ]


def _filtrar_inmuebles_por_texto_unidad(
    inmuebles: list[dict[str, Any]],
    variantes_unidad: list[str],
) -> list[dict[str, Any]]:
    """Coincidencia estricta en LOTE/DENOMINACION (sin barrer todo el JSON)."""
    if not variantes_unidad:
        return []
    out: list[dict[str, Any]] = []
    vistos: set[int] = set()
    for item in inmuebles:
        if not _es_item_inmueble_rppc(item):
            continue
        if not _coincide_unidad_local_en_inmueble(item, variantes_unidad):
            continue
        fid = id(item)
        if fid in vistos:
            continue
        vistos.add(fid)
        out.append(item)
    return out


def _consultar_inmuebles_rppc_por_unidad_local(
    manzana: str,
    variantes_unidad: list[str],
    *,
    colonia_id: int | None = None,
    colonia_nombre: str = "",
    lote_catastral: str = "",
    datos_padron: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Consulta RPPC por unidad/LOCAL — manzana + filtro, luego DESCR y sin colonia."""
    global _rppc_last_unidad_debug
    _rppc_last_unidad_debug = {"manzana": manzana, "variantes": variantes_unidad[:6], "intentos": []}

    if not str(manzana or "").strip() or not variantes_unidad:
        return [], None

    _marcar_sesion_consulta_rppc_nueva()

    descr_candidatos: list[str] = []
    vistos_descr: set[str] = set()
    for var in variantes_unidad:
        for descr in (
            var,
            var.replace("LOCAL ", ""),
            var.replace("LOCAL C-", "C-"),
            var.replace("-", " "),
            var.replace("LOCAL C ", "C-"),
        ):
            d = str(descr or "").strip()
            if d and d not in vistos_descr:
                vistos_descr.add(d)
                descr_candidatos.append(d)

    if colonia_id is None and colonia_nombre:
        colonia_id = (
            _buscar_rppc_colonia_id_por_nombre(colonia_nombre)
            or _fallback_rppc_colonia_id(colonia_nombre)
        )
    if colonia_id is None:
        return [], None

    ctx_padron: dict[str, Any] = dict(datos_padron or {})
    ctx_padron.setdefault("variantes_unidad", variantes_unidad)
    if colonia_nombre:
        ctx_padron.setdefault("colonia", colonia_nombre)
    ctx_padron.setdefault("manzana", manzana)
    if lote_catastral:
        ctx_padron.setdefault("lote", lote_catastral)

    resultados: list[dict[str, Any]] = []
    folios_vistos: set[Any] = set()
    payload_usado: dict[str, Any] | None = None
    col_id = int(colonia_id)

    def _registrar_intento(
        etiqueta: str,
        payload: dict[str, Any],
        datos: list[dict[str, Any]],
        coincidencias: list[dict[str, Any]],
    ) -> None:
        if _rppc_last_unidad_debug is not None:
            _rppc_last_unidad_debug["intentos"].append(
                {
                    "modo": etiqueta,
                    "payload": payload,
                    "total_rpcc": len(datos),
                    "coincidencias": len(coincidencias),
                    "lotes_muestra": [
                        str(x.get("LOTE") or x.get("DENOMINACION") or "")[:60]
                        for x in datos[:8]
                    ],
                    "folios_muestra": [
                        _extraer_folio_real_rppc(x) for x in coincidencias[:3]
                    ] or [_extraer_folio_real_rppc(x) for x in datos[:3]],
                }
            )
            if etiqueta.startswith("descr_U") and datos:
                item0 = datos[0]
                _rppc_last_unidad_debug["intentos"][-1]["item_preview"] = {
                    k: item0.get(k)
                    for k in (
                        "FOLIO_REAL", "LOTE", "TIPO_PREDIO", "DENOMINACION",
                        "COLONIA", "CVE_CAT", "MUNLOC",
                    )
                }

    def _devolver_coincidencias(
        coincidencias: list[dict[str, Any]],
        payload: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        nonlocal payload_usado
        if coincidencias:
            coincidencias = _refinar_candidatos_unidad_rppc(
                coincidencias,
                ctx_padron,
                variantes_unidad,
                limite=8,
            )
        out: list[dict[str, Any]] = []
        for item in coincidencias:
            if not _es_item_inmueble_rppc(item):
                continue
            folio = _extraer_folio_real_rppc(item)
            if not folio:
                continue
            if folio in folios_vistos:
                continue
            folios_vistos.add(folio)
            out.append(item)
        if out:
            payload_usado = payload
            return out, payload_usado
        return [], payload_usado

    def _probar_payload(etiqueta: str, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        datos = _consultar_inmuebles_rppc_opcional(payload)
        coincidencias = _filtrar_inmuebles_por_unidad_local(datos, variantes_unidad)
        _registrar_intento(etiqueta, payload, datos, coincidencias)
        return _devolver_coincidencias(coincidencias, payload)

    payload_manzana = _payload_inmuebles_ubicacion_rppc(
        manzana,
        colonia_id=col_id,
        clasificacion="L",
        buscar="D",
    )
    terrenos_manzana: list[dict[str, Any]] = []
    manzana_rastreo_hecho = False
    rastreo_hecho = False

    def _intentar_rastreo_terreno(
        terrenos: list[dict[str, Any]],
        *,
        modo: str,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        nonlocal rastreo_hecho
        rastreo_hecho = True
        terrenos_rastreo = terrenos
        modo_rastreo = modo
        if not terrenos_rastreo:
            folios_fb = _folios_terreno_fallback(manzana, col_id)
            if folios_fb and _rppc_consulta_inmuebles_no_disponible():
                terrenos_rastreo = _terrenos_sinteticos_desde_folios(folios_fb)
                modo_rastreo = "rastreo_terreno_fallback"
        if not terrenos_rastreo:
            return [], payload_usado
        rastreo, payload_rastreo = _rastrear_unidad_desde_folios_terreno(
            terrenos_rastreo,
            variantes_unidad,
            ctx_padron,
        )
        _registrar_intento(
            modo_rastreo,
            payload_rastreo or {
                "folios_terreno": [_extraer_folio_real_rppc(t) for t in terrenos_rastreo[:12]],
                "origen": "fallback" if modo_rastreo.endswith("_fallback") else "manzana",
            },
            rastreo or terrenos_rastreo,
            rastreo,
        )
        return _devolver_coincidencias(rastreo, payload_rastreo or payload_manzana)

    def _intentar_manzana_y_rastreo(etiqueta_manzana: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        nonlocal terrenos_manzana, payload_usado, manzana_rastreo_hecho
        manzana_rastreo_hecho = True
        terrenos_manzana = _consultar_inmuebles_rppc_opcional(payload_manzana)
        out, payload_usado = _probar_payload(etiqueta_manzana, payload_manzana)
        if out:
            return out, payload_usado
        return _intentar_rastreo_terreno(terrenos_manzana, modo="rastreo_terreno")

    # Condominio/unidad LOCAL: manzana + rastreo bajo folios de terreno primero (evita timeout).
    if _debe_priorizar_busqueda_unidad_rppc(ctx_padron):
        out, payload_usado = _intentar_manzana_y_rastreo("manzana_colonia_prioritaria")
        if out:
            return out, payload_usado

    omitir_descr_lento = manzana_rastreo_hecho and rastreo_hecho

    # 0) manzana + colonia + DESCR (omitido si ya se hizo rastreo prioritario)
    if not omitir_descr_lento:
        for descr in descr_candidatos:
            for buscar, clasif in (("D", "L"), ("D", "U"), ("U", "L"), ("U", "U")):
                payload_descr_mc = _payload_inmuebles_ubicacion_rppc(
                    manzana,
                    colonia_id=col_id,
                    descr=descr,
                    clasificacion=clasif,
                    buscar=buscar,
                )
                out, payload_usado = _probar_payload(
                    f"descr_{buscar}_{clasif}_{descr[:12]}",
                    payload_descr_mc,
                )
                if out:
                    return out, payload_usado

        # 1) BUSCAR=U + DESCR
        for descr in descr_candidatos:
            for clasif in ("L", "U"):
                payload_u = _payload_inmuebles_ubicacion_rppc(
                    manzana,
                    colonia_id=col_id,
                    descr=descr,
                    clasificacion=clasif,
                    buscar="U",
                )
                out, payload_usado = _probar_payload(
                    f"descr_U_{clasif}_{descr[:16]}",
                    payload_u,
                )
                if out:
                    return out, payload_usado

    # 1) Manzana + colonia (listado de lotes de terreno)
    if not manzana_rastreo_hecho:
        out, payload_usado = _intentar_manzana_y_rastreo("manzana_colonia")
        if out:
            return out, payload_usado

    # 2) Manzana + colonia + DESCR con BUSCAR=D (máx. 1 si ya hubo rastreo)
    descr_resto = descr_candidatos[:1] if omitir_descr_lento else descr_candidatos
    for descr in descr_resto:
        payload_descr = _payload_inmuebles_ubicacion_rppc(
            manzana,
            colonia_id=col_id,
            descr=descr,
            clasificacion="L",
            buscar="D",
        )
        out, payload_usado = _probar_payload(f"descr_D_{descr[:20]}", payload_descr)
        if out:
            return out, payload_usado

    # 3) Manzana sin colonia → filtrar por nombre de fraccionamiento
    payload_sin_col = _payload_inmuebles_ubicacion_rppc(
        manzana,
        colonia_id=None,
        clasificacion="L",
        buscar="D",
    )
    datos_sin_col = _consultar_inmuebles_rppc_opcional(payload_sin_col)
    pool = datos_sin_col
    if colonia_nombre:
        filtrados = _filtrar_inmuebles_por_colonia_nombre(datos_sin_col, colonia_nombre)
        if filtrados:
            pool = filtrados
    coincidencias = _filtrar_inmuebles_por_unidad_local(pool, variantes_unidad)
    if not coincidencias:
        coincidencias = _filtrar_inmuebles_por_texto_unidad(pool, variantes_unidad)
    _registrar_intento("manzana_sin_colonia", payload_sin_col, pool, coincidencias)
    out, payload_usado = _devolver_coincidencias(coincidencias, payload_sin_col)
    if out:
        return out, payload_usado

    # 4) Solo TIPO_PREDIO=UNIDAD en manzana completa
    unidades_pool = [
        x for x in pool
        if _es_item_inmueble_rppc(x) and str(x.get("TIPO_PREDIO") or "").upper() == "UNIDAD"
    ]
    coincidencias_u = _filtrar_inmuebles_por_texto_unidad(unidades_pool, variantes_unidad)
    _registrar_intento("tipo_unidad_manzana", payload_sin_col, unidades_pool, coincidencias_u)
    out, payload_usado = _devolver_coincidencias(coincidencias_u, payload_sin_col)
    if out:
        return out, payload_usado

    # 5) Lote catastral en LOTE RPPC (ej. clave XL701261 → lote 261)
    lote_txt = str(lote_catastral or "").strip()
    if lote_txt:
        coincidencias_lote = [
            x for x in pool
            if _es_item_inmueble_rppc(x)
            and lote_txt in re.sub(r"[^0-9]", " ", str(x.get("LOTE") or ""))
        ]
        coincidencias_lote = _filtrar_inmuebles_por_texto_unidad(coincidencias_lote, variantes_unidad) or coincidencias_lote
        _registrar_intento("lote_catastral", payload_sin_col, coincidencias_lote, coincidencias_lote)
        out, payload_usado = _devolver_coincidencias(coincidencias_lote, payload_sin_col)
        if out:
            return out, payload_usado

    # 6) Rastrear unidad bajo folios de terreno (si no se hizo en paso prioritario)
    if not rastreo_hecho:
        out, payload_usado = _intentar_rastreo_terreno(terrenos_manzana, modo="rastreo_terreno")
        if out:
            return out, payload_usado

    if not payload_usado:
        payload_usado = payload_manzana
    return resultados, payload_usado


def _seleccionar_inmueble_unidad_rppc(
    inmuebles: list[dict[str, Any]],
    datos_padron: dict[str, Any],
) -> dict[str, Any] | None:
    inmuebles = [x for x in inmuebles if _es_item_inmueble_rppc(x)]
    if not inmuebles:
        return None
    variantes = datos_padron.get("variantes_unidad") or _variantes_unidad_rppc(datos_padron)
    candidatos = _refinar_candidatos_unidad_rppc(
        inmuebles,
        datos_padron,
        variantes,
        limite=0,
    )
    if not candidatos:
        return None

    clave_ref = _normalizar_clave(datos_padron.get("clave_catastral") or "")
    mejor: dict[str, Any] | None = None
    mejor_puntos = -10_000

    for item in candidatos:
        puntos = _grado_coincidencia_unidad_lote_rppc(
            str(item.get("LOTE") or item.get("INMUEBLE") or ""),
            variantes,
        )
        puntos += _puntuar_colonia_unidad_rppc(item, datos_padron)
        if str(item.get("TIPO_PREDIO") or "").upper() == "UNIDAD":
            puntos += 10
        cve = str(item.get("CVE_CAT") or "").upper().replace("-", "")
        if clave_ref and cve == clave_ref:
            puntos += 200
        if puntos > mejor_puntos:
            mejor_puntos = puntos
            mejor = item
        elif puntos == mejor_puntos and mejor is not None:
            folio_a = _extraer_folio_real_rppc(item) or 0
            folio_b = _extraer_folio_real_rppc(mejor) or 0
            if folio_a and folio_b and folio_a < folio_b:
                mejor = item

    return mejor


def _payload_inmuebles_ubicacion_rppc(
    manzana: str,
    *,
    colonia_id: int | None = None,
    descr: str = "",
    clasificacion: str = "L",
    vigente: str = "S",
    buscar: str = "D",
) -> dict[str, Any]:
    """Payload capturado del portal RPPC (Consulta Avanzada → ubicación).

    Portal F12 Tijuana (manzana 701, colonia 1342) usa BUSCAR=D, no U.
    """
    payload: dict[str, Any] = {
        "BUSCAR": str(buscar or "D").strip().upper() or "D",
        "CLASIFICACION": clasificacion,
        "MUNICIPIO": RPPC_MUNICIPIO_ID,
        "LOCALIDAD": RPPC_LOCALIDAD_ID,
        "MANZANA": str(manzana or "").strip(),
        "VIGENTE": vigente,
    }
    descr_txt = str(descr or "").strip()
    if descr_txt:
        payload["DESCR"] = descr_txt
    if colonia_id is not None:
        payload["COLONIA"] = int(colonia_id)
    return payload


def _payloads_consulta_folio_rppc(folio: int, lote_id: int | None = None) -> list[dict[str, Any]]:
    f = int(folio)
    base = {
        "MUNICIPIO": RPPC_MUNICIPIO_ID,
        "LOCALIDAD": RPPC_LOCALIDAD_ID,
        "VIGENTE": "S",
    }
    payloads: list[dict[str, Any]] = [
        {**base, "BUSCAR": "F", "FOLIO_REAL": f},
        {**base, "BUSCAR": "R", "FOLIO_REAL": f},
        {**base, "BUSCAR": "D", "FOLIO_REAL": f},
        {**base, "BUSCAR": "U", "FOLIO_REAL": f, "CLASIFICACION": "U"},
        {**base, "BUSCAR": "U", "FOLIO_REAL": f, "CLASIFICACION": "L"},
        {"FOLIO_REAL": f, "VIGENTE": "S"},
    ]
    if lote_id:
        lid = int(lote_id)
        payloads.extend([
            {**base, "BUSCAR": "F", "LOTE_ID": lid},
            {**base, "BUSCAR": "D", "LOTE_ID": lid},
            {"LOTE_ID": lid, "VIGENTE": "S"},
        ])
    return payloads


def _consultar_inmuebles_rppc_por_folio(
    folio: int,
    *,
    lote_id: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    if lote_id:
        for payload in _payloads_consulta_folio_rppc(folio, lote_id=lote_id)[:3]:
            datos = _consultar_inmuebles_rppc_folio_rapido(payload)
            validos = [x for x in datos if _es_item_inmueble_rppc(x)]
            if validos:
                return validos, payload
        return [], None

    for payload in (
        {
            "MUNICIPIO": RPPC_MUNICIPIO_ID,
            "LOCALIDAD": RPPC_LOCALIDAD_ID,
            "VIGENTE": "S",
            "BUSCAR": "D",
            "CLASIFICACION": "U",
            "FOLIO_REAL": int(folio),
        },
        {
            "MUNICIPIO": RPPC_MUNICIPIO_ID,
            "LOCALIDAD": RPPC_LOCALIDAD_ID,
            "VIGENTE": "S",
            "BUSCAR": "F",
            "FOLIO_REAL": int(folio),
        },
    ):
        datos = _consultar_inmuebles_rppc_folio_rapido(payload)
        validos = [x for x in datos if _es_item_inmueble_rppc(x)]
        if validos:
            return validos, payload
    return [], None


def _texto_contiene_variante_unidad(texto: str, variantes_unidad: list[str]) -> bool:
    blob = re.sub(r"[^A-Z0-9]", "", _normalizar_texto_rppc_busqueda(texto))
    if not blob:
        return False
    for var in variantes_unidad:
        compact = re.sub(r"[^A-Z0-9]", "", _normalizar_texto_rppc_busqueda(var))
        if len(compact) >= 3 and compact in blob:
            return True
    return False


def _extraer_folios_de_estructura_rppc(
    data: Any,
    *,
    excluir: set[int] | None = None,
) -> set[int]:
    excluir = excluir or set()
    folios: set[int] = set()
    if isinstance(data, dict):
        for key in ("FOLIO_REAL", "folio_real", "FolioReal", "folioReal"):
            if key in data:
                fi = _normalizar_numero(data[key])
                if fi and fi not in excluir:
                    folios.add(fi)
        for val in data.values():
            folios |= _extraer_folios_de_estructura_rppc(val, excluir=excluir)
    elif isinstance(data, list):
        for item in data:
            folios |= _extraer_folios_de_estructura_rppc(item, excluir=excluir)
    return folios


def _items_con_unidad_en_estructura_rppc(
    data: Any,
    variantes_unidad: list[str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    vistos: set[int] = set()

    def _visitar(nodo: Any) -> None:
        if isinstance(nodo, dict):
            blob = json.dumps(nodo, ensure_ascii=False)
            if _texto_contiene_variante_unidad(blob, variantes_unidad):
                fid = id(nodo)
                if fid not in vistos:
                    vistos.add(fid)
                    out.append(nodo)
            for val in nodo.values():
                _visitar(val)
        elif isinstance(nodo, list):
            for item in nodo:
                _visitar(item)

    _visitar(data)
    return out


def _post_rppc_json_opcional(url: str, payload: dict[str, Any]) -> Any | None:
    if not url:
        return None
    try:
        _asegurar_rppc_sesion_consulta()
        _, body = _request_rppc(
            "POST",
            url,
            data=json.dumps(payload).encode("utf-8"),
            content_type="application/json",
            timeout=RPPC_TIMEOUT_POST,
        )
        return json.loads(body)
    except Exception:
        return None


def _consultar_lote_rppc_por_folio(folio: int) -> Any | None:
    """ObtenerLoteByFolioReal — detalle del lote y posibles unidades hijas."""
    rutas = (
        "Servicios/Notarios/ObtenerLoteByFolioReal",
        "Servicios/Reportes/ObtenerLoteByFolioReal",
    )
    uid = _rppc_usuario_id or RPPC_USUARIO_ID
    payloads: list[dict[str, Any]] = [
        {"folioReal": str(folio)},
        {"FOLIO_REAL": folio},
        {"folioReal": folio, "FOLIO_REAL": folio},
    ]
    if uid:
        for pl in payloads:
            pl.setdefault("USUARIO_ID", uid)
    for ruta in rutas:
        url = _url_api_desde_ruta(RPPC_BASE_URL, ruta, solo_base=True)
        for payload in payloads:
            parsed = _post_rppc_json_opcional(url, payload)
            if parsed is not None:
                return parsed
    return None


def _consultar_lotes_memoria_rppc(folio: int) -> Any | None:
    """obtenerLotesMemoria — unidades relacionadas en memoria del portal."""
    rutas = (
        "Servicios/ConsultaAvanzada/obtenerLotesMemoria",
        "Servicios/Reportes/obtenerLotesMemoria",
    )
    uid = _rppc_usuario_id or RPPC_USUARIO_ID
    payloads: list[dict[str, Any]] = [
        {"FOLIO_REAL": folio},
        {"folioReal": folio},
        {"FOLIO_REAL": folio, "infoHistorica": 0},
    ]
    if uid:
        for pl in payloads:
            pl.setdefault("USUARIO_ID", uid)
    for ruta in rutas:
        url = _url_api_desde_ruta(RPPC_BASE_URL, ruta, solo_base=True)
        for payload in payloads:
            parsed = _post_rppc_json_opcional(url, payload)
            if parsed is not None:
                return parsed
    return None


def _sintetizar_inmueble_desde_folio(
    folio: int,
    variantes_unidad: list[str],
    movimientos: list[dict[str, Any]] | None = None,
    *,
    confiar_folio: bool = False,
    omitir_consulta: bool = False,
) -> dict[str, Any] | None:
    """Arma un inmueble mínimo cuando consultaInmuebles no lista la unidad pero movimientos sí."""
    if not omitir_consulta and not _rppc_consulta_inmuebles_no_disponible():
        datos_folio, _ = _consultar_inmuebles_rppc_por_folio(folio)
    else:
        datos_folio = []
    if datos_folio:
        hits = _filtrar_inmuebles_por_texto_unidad(datos_folio, variantes_unidad)
        if hits:
            return hits[0]
        if len(datos_folio) == 1:
            unico = datos_folio[0]
            if confiar_folio or _coincide_unidad_local_en_inmueble(unico, variantes_unidad):
                return unico

    if movimientos is None:
        try:
            movimientos = _consultar_movimientos_folio_directo(folio)
        except Exception:
            movimientos = []

    if not movimientos:
        return None

    if not confiar_folio and variantes_unidad:
        blob = json.dumps(movimientos, ensure_ascii=False)
        if not _texto_contiene_variante_unidad(blob, variantes_unidad):
            return None

    mun = str(movimientos[0].get("MUNICIPIO") or movimientos[0].get("DISTRITO") or "").upper()
    mun_id = _normalizar_numero(movimientos[0].get("MUNICIPIO_ID"))
    if APP_MUNICIPIO_MAYUS not in mun and mun_id != RPPC_MUNICIPIO_ID:
        return None

    lote_id = _normalizar_numero(movimientos[0].get("LOTE_ID"))
    item: dict[str, Any] = {
        "FOLIO_REAL": folio,
        "LOTE_ID": lote_id,
        "MUNICIPIO": movimientos[0].get("MUNICIPIO") or APP_MUNICIPIO_MAYUS,
        "MUNICIPIO_ID": mun_id or RPPC_MUNICIPIO_ID,
        "VIGENTE": "S",
        "TIPO_PREDIO": "UNIDAD",
    }
    if variantes_unidad:
        local_var = next(
            (v for v in variantes_unidad if str(v).upper().startswith("LOCAL")),
            variantes_unidad[0],
        )
        item["LOTE"] = local_var
    return item


def _resolver_inmueble_por_folio_conocido(
    folio: int,
    variantes_unidad: list[str],
    *,
    confiar_folio: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, dict[str, Any] | None]:
    payload: dict[str, Any] | None = None
    datos: list[dict[str, Any]] = []

    if _rppc_consulta_inmuebles_no_disponible():
        synth = _sintetizar_inmueble_desde_folio(
            folio,
            variantes_unidad,
            confiar_folio=confiar_folio,
            omitir_consulta=True,
        )
        if synth:
            pl = {"FOLIO_REAL": folio, "origen": "movimientos_folio"}
            return [synth], pl, synth
    else:
        datos, payload = _consultar_inmuebles_rppc_por_folio(folio)
        if datos:
            hits = _filtrar_inmuebles_por_texto_unidad(datos, variantes_unidad)
            candidatos = hits or (datos if confiar_folio or len(datos) == 1 else [])
            if candidatos:
                elegido = _seleccionar_inmueble_unidad_rppc(
                    candidatos, {"variantes_unidad": variantes_unidad}
                )
                return candidatos, payload, elegido or candidatos[0]

    synth = _sintetizar_inmueble_desde_folio(
        folio,
        variantes_unidad,
        confiar_folio=confiar_folio,
        omitir_consulta=_rppc_consulta_inmuebles_no_disponible(),
    )
    if synth:
        pl = payload or {"FOLIO_REAL": folio, "origen": "movimientos_folio"}
        return [synth], pl, synth
    return [], payload, None


def _probar_folios_candidatos_unidad(
    folios: set[int] | list[int],
    variantes_unidad: list[str],
    origen: str,
    *,
    max_folios: int = 6,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    consulta_caida = _rppc_consulta_inmuebles_no_disponible()
    for fi in sorted(set(folios))[:max_folios]:
        if not consulta_caida:
            datos, pl = _consultar_inmuebles_rppc_por_folio(fi)
            hits = _filtrar_inmuebles_por_unidad_local(datos, variantes_unidad)
            if hits:
                return hits, pl or {"FOLIO_REAL": fi, "origen": origen}

        raw = _consultar_lote_rppc_por_folio(fi)
        if raw is not None:
            items = _items_con_unidad_en_estructura_rppc(raw, variantes_unidad)
            for item in items:
                if _es_item_inmueble_rppc(item) and _coincide_unidad_local_en_inmueble(item, variantes_unidad):
                    return [item], {"FOLIO_REAL": fi, "origen": f"{origen}_lote_api"}
                folio_item = _extraer_folio_real_rppc(item)
                if folio_item and folio_item != fi:
                    synth = _sintetizar_inmueble_desde_folio(
                        folio_item,
                        variantes_unidad,
                        omitir_consulta=True,
                    )
                    if synth:
                        return [synth], {"FOLIO_REAL": folio_item, "origen": f"{origen}_lote_api"}

        if consulta_caida:
            synth = _sintetizar_inmueble_desde_folio(
                fi,
                variantes_unidad,
                omitir_consulta=True,
            )
            if synth:
                return [synth], {"FOLIO_REAL": fi, "origen": f"{origen}_movimientos"}
    return [], None


def _descubrir_unidad_desde_folio_padre(
    folio_padre: int,
    variantes_unidad: list[str],
    datos_padron: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Unidades de condominio bajo un folio de terreno (no aparecen en listado plano de manzana)."""
    base_payload = {
        "FOLIO_REAL": folio_padre,
        "MUNICIPIO": RPPC_MUNICIPIO_ID,
        "LOCALIDAD": RPPC_LOCALIDAD_ID,
        "VIGENTE": "S",
    }

    def _entregar(
        hits: list[dict[str, Any]],
        payload: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        if hits:
            ctx = datos_padron or {"variantes_unidad": variantes_unidad}
            hits = _preparar_candidatos_unidad_rppc(
                hits,
                ctx,
                variantes_unidad,
                limite=8,
            )
        return hits, payload

    # 1) API de lote (rápida) — antes del barrido consultaInmuebles
    for origen, raw in (
        ("ObtenerLoteByFolioReal", _consultar_lote_rppc_por_folio(folio_padre)),
        ("obtenerLotesMemoria", _consultar_lotes_memoria_rppc(folio_padre)),
    ):
        if raw is None:
            continue
        items = _items_con_unidad_en_estructura_rppc(raw, variantes_unidad)
        for item in items:
            if _es_item_inmueble_rppc(item) and _coincide_unidad_local_en_inmueble(item, variantes_unidad):
                return _entregar([item], {"FOLIO_REAL": folio_padre, "origen": origen})
            folio_item = _extraer_folio_real_rppc(item)
            if folio_item and folio_item != folio_padre:
                hits, pl = _probar_folios_candidatos_unidad(
                    {folio_item}, variantes_unidad, origen, max_folios=1,
                )
                if hits:
                    return _entregar(hits, pl or {"FOLIO_REAL": folio_item, "origen": origen})

    # 2) Una consulta hijos bajo folio terreno (BUSCAR=D, CLASIFICACION=U)
    payload_hijos = {**base_payload, "BUSCAR": "D", "CLASIFICACION": "U"}
    datos_hijos = _consultar_unidades_bajo_folio_padre(folio_padre)
    hits = _filtrar_inmuebles_por_unidad_local(datos_hijos, variantes_unidad)
    if hits:
        return _entregar(hits, payload_hijos)

    # 3) DESCR con la mejor variante (máx. 2 intentos)
    for descr in variantes_unidad[:2]:
        descr_txt = str(descr or "").replace("LOCAL ", "").strip()
        if not descr_txt:
            continue
        payload = {
            **base_payload,
            "BUSCAR": "U",
            "CLASIFICACION": "U",
            "DESCR": descr_txt,
        }
        datos = _consultar_inmuebles_rppc_folio_rapido(payload)
        hits = _filtrar_inmuebles_por_unidad_local(datos, variantes_unidad)
        if hits:
            return _entregar(hits, payload)

    return [], None


def _rastrear_unidad_desde_folios_terreno(
    terrenos: list[dict[str, Any]],
    variantes_unidad: list[str],
    datos_padron: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Unidades de condominio bajo folios de terreno (LOTE 1..7 manzana 701)."""
    folios_padre: list[int] = []
    for terreno in terrenos:
        folio = _extraer_folio_real_rppc(terreno)
        if folio and folio not in folios_padre:
            folios_padre.append(folio)

    for folio_padre in folios_padre[:3]:
        hits, payload = _descubrir_unidad_desde_folio_padre(
            folio_padre,
            variantes_unidad,
            datos_padron,
        )
        if hits:
            return hits, payload

    return [], None


def _consultar_inmuebles_rppc_por_ubicacion(
    manzana: str,
    *,
    colonia_id: int | None = None,
    descr: str = "",
    clasificacion: str = "L",
) -> list[dict[str, Any]]:
    if not str(manzana or "").strip():
        raise HTTPException(status_code=400, detail="Manzana requerida para búsqueda RPPC por ubicación")
    if colonia_id is None:
        return []
    payload = _payload_inmuebles_ubicacion_rppc(
        manzana,
        colonia_id=colonia_id,
        descr=descr,
        clasificacion=clasificacion,
    )
    return _consultar_inmuebles_rppc_opcional(payload)


def _filtrar_inmuebles_por_colonia_nombre(
    inmuebles: list[dict[str, Any]],
    colonia_nombre: str,
) -> list[dict[str, Any]]:
    ref = _normalizar_texto_rppc_busqueda(colonia_nombre)
    if not ref:
        return inmuebles
    tokens = [t for t in ref.split() if len(t) >= 4]
    if not tokens:
        return inmuebles
    filtrados = []
    for item in inmuebles:
        col = _normalizar_texto_rppc_busqueda(item.get("COLONIA") or item.get("FRACCIONAMIENTO") or "")
        if not col:
            continue
        coincidencias = sum(1 for tok in tokens if tok in col)
        if coincidencias >= min(2, len(tokens)):
            filtrados.append(item)
    return filtrados or inmuebles


def _puntuar_inmueble_ubicacion_rppc(
    item: dict[str, Any],
    datos_padron: dict[str, Any],
    segmentos: dict[str, str],
) -> tuple[int, int]:
    score = 0
    lote_txt = _normalizar_texto_rppc_busqueda(item.get("LOTE") or item.get("INMUEBLE") or "")
    for candidato in (
        str(datos_padron.get("lote") or "").strip(),
        str(segmentos.get("lote") or "").strip(),
        str(segmentos.get("lote_padded") or "").strip().lstrip("0"),
    ):
        if not candidato:
            continue
        if re.search(rf"\bLOTE\s+{re.escape(candidato.lstrip('0') or candidato)}\b", lote_txt):
            score += 40
            break

    colonia_ref = _normalizar_texto_rppc_busqueda(datos_padron.get("colonia") or "")
    colonia_item = _normalizar_texto_rppc_busqueda(item.get("COLONIA") or "")
    if colonia_ref and colonia_item and colonia_ref[:12] in colonia_item:
        score += 25

    munloc = str(item.get("MUNLOC") or item.get("MUNICIPIO") or "").upper()
    if APP_MUNICIPIO_MAYUS in munloc or f"MUNICIPIO-{RPPC_MUNICIPIO_ID}" in munloc:
        score += 15

    cve = str(item.get("CVE_CAT") or "").upper().replace("-", "")
    clave_ref = _normalizar_clave(datos_padron.get("clave_catastral") or "")
    if cve and clave_ref and cve == clave_ref:
        score += 100

    folio = _normalizar_numero(item.get("FOLIO_REAL")) or 0
    if str(item.get("VIGENTE") or "").upper() in {"", "S", "SI", "SÍ"}:
        score += 5
    return score, folio


def _seleccionar_inmueble_ubicacion_rppc(
    inmuebles: list[dict[str, Any]],
    datos_padron: dict[str, Any],
    segmentos: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    if not inmuebles:
        return None
    segmentos = segmentos or _segmentos_clave_catastral_rppc(datos_padron.get("clave_catastral") or "")
    candidatos = _filtrar_inmuebles_por_colonia_nombre(inmuebles, str(datos_padron.get("colonia") or ""))
    candidatos_municipio = [
        x for x in candidatos
        if APP_MUNICIPIO_MAYUS in str(x.get("MUNLOC") or x.get("MUNICIPIO") or "").upper()
        or str(x.get("MUNLOC") or "").startswith(f"{APP_MUNICIPIO_MAYUS}-")
    ]
    if candidatos_municipio:
        candidatos = candidatos_municipio

    puntuados = [
        (_puntuar_inmueble_ubicacion_rppc(item, datos_padron, segmentos), item)
        for item in candidatos
    ]
    puntuados.sort(key=lambda par: (par[0][0], par[0][1]), reverse=True)
    if not puntuados or puntuados[0][0][0] <= 0:
        return _seleccionar_mejor_inmueble_rppc(candidatos)
    return puntuados[0][1]


def _consultar_inmuebles_rppc_por_clave_cascada(clave_catastral: str) -> dict[str, Any]:
    """Resuelve inmueble RPPC: clave → unidad/LOCAL → lote de manzana (MUNICIPIO=2)."""
    _marcar_sesion_consulta_rppc_nueva()
    clave = _normalizar_clave(clave_catastral)
    datos_padron = _datos_padron_busqueda_rppc(clave)
    segmentos = _segmentos_clave_catastral_rppc(clave)
    variantes_unidad = datos_padron.get("variantes_unidad") or _variantes_unidad_rppc(datos_padron)
    buscar_unidad_primero = bool(variantes_unidad) and _debe_priorizar_busqueda_unidad_rppc(datos_padron)

    por_clave: list[dict[str, Any]] = []
    if not buscar_unidad_primero:
        try:
            por_clave = _consultar_inmuebles_rppc_por_clave(clave)
        except HTTPException:
            por_clave = []

    if por_clave:
        elegido_clave = _seleccionar_mejor_inmueble_rppc(por_clave)
        cve = str((elegido_clave or {}).get("CVE_CAT") or "").upper().replace("-", "")
        if cve and cve == clave:
            return {
                "metodo": "clave",
                "payload": {
                    "BUSCAR": "C",
                    "CVE_CAT": _clave_sgc_a_rppc(clave),
                    "VIGENTE": "S",
                },
                "inmuebles": por_clave,
                "inmueble_elegido": elegido_clave,
                "datos_padron": datos_padron,
            }
        if not _debe_priorizar_busqueda_unidad_rppc(datos_padron):
            return {
                "metodo": "clave",
                "payload": {
                    "BUSCAR": "C",
                    "CVE_CAT": _clave_sgc_a_rppc(clave),
                    "VIGENTE": "S",
                },
                "inmuebles": por_clave,
                "inmueble_elegido": elegido_clave,
                "datos_padron": datos_padron,
            }

    manzana = str(datos_padron.get("manzana") or segmentos.get("manzana") or "").strip()
    if not manzana:
        if por_clave:
            return {
                "metodo": "clave",
                "payload": {"BUSCAR": "C", "CVE_CAT": _clave_sgc_a_rppc(clave), "VIGENTE": "S"},
                "inmuebles": por_clave,
                "inmueble_elegido": _seleccionar_mejor_inmueble_rppc(por_clave),
                "datos_padron": datos_padron,
            }
        return {
            "metodo": "sin_resultados",
            "inmuebles": [],
            "inmueble_elegido": None,
            "datos_padron": datos_padron,
            "detalle": "Sin manzana derivable para búsqueda por ubicación",
        }

    colonia_id_int = _resolver_rppc_colonia_id(datos_padron)
    if colonia_id_int is None and manzana == "701":
        colonia_id_int = _fallback_rppc_colonia_id("VILLA RESIDENCIAL SANTA FE")
    colonia_nombre = str(
        datos_padron.get("nom_condominio") or datos_padron.get("colonia") or ""
    ).strip()

    buscar_unidad = _debe_priorizar_busqueda_unidad_rppc(datos_padron) and bool(variantes_unidad)

    if buscar_unidad:
        por_unidad, payload_unidad = _consultar_inmuebles_rppc_por_unidad_local(
            manzana,
            variantes_unidad,
            colonia_id=colonia_id_int,
            colonia_nombre=colonia_nombre,
            lote_catastral=str(datos_padron.get("lote") or segmentos.get("lote") or "").strip(),
            datos_padron=datos_padron,
        )
        candidatos_unidad = _preparar_candidatos_unidad_rppc(
            por_unidad,
            datos_padron,
            variantes_unidad,
            limite=8,
        )
        elegido_unidad = _seleccionar_inmueble_unidad_rppc(candidatos_unidad, datos_padron)
        if elegido_unidad and _coincide_unidad_local_en_inmueble(elegido_unidad, variantes_unidad):
            return {
                "metodo": "unidad",
                "payload": payload_unidad,
                "variantes_unidad": variantes_unidad,
                "inmuebles": candidatos_unidad,
                "inmueble_elegido": elegido_unidad,
                "datos_padron": datos_padron,
            }

        folio_padron = _normalizar_numero(datos_padron.get("folio_real"))
        if folio_padron:
            por_folio, payload_folio, elegido_folio = _resolver_inmueble_por_folio_conocido(
                folio_padron,
                variantes_unidad,
                confiar_folio=True,
            )
            if elegido_folio:
                return {
                    "metodo": "folio",
                    "payload": payload_folio,
                    "variantes_unidad": variantes_unidad,
                    "inmuebles": por_folio,
                    "inmueble_elegido": elegido_folio,
                    "datos_padron": datos_padron,
                }

    if buscar_unidad:
        return {
            "metodo": "sin_resultados",
            "payload": payload_unidad if buscar_unidad else None,
            "variantes_unidad": variantes_unidad,
            "inmuebles": por_unidad if buscar_unidad else [],
            "inmueble_elegido": elegido_unidad if buscar_unidad else None,
            "datos_padron": datos_padron,
            "detalle": (
                "Sin coincidencia RPPC por unidad/LOCAL. "
                f"manzana={manzana}, colonia_rppc={colonia_id_int}, "
                f"variantes={variantes_unidad[:4]}. "
                "Las unidades de condominio pueden no listarse en consulta plana de manzana; "
                "guarde folio_real en padrón si ya lo conoce (ej. 1332703). "
                + (
                    "RPPC HTTP 400: renueve .runtime/rppc_cookie.txt desde F12 "
                    "(.AspNet.ApplicationCookie) y reinicie la API."
                    if _rppc_last_consulta_error and "Object reference not set" in str(_rppc_last_consulta_error)
                    else ""
                )
            ),
        }

    por_ubicacion = _consultar_inmuebles_rppc_por_ubicacion(
        manzana,
        colonia_id=colonia_id_int,
    )
    elegido_lote = _seleccionar_inmueble_ubicacion_rppc(por_ubicacion, datos_padron, segmentos)

    if variantes_unidad and not elegido_lote:
        por_unidad, payload_unidad = _consultar_inmuebles_rppc_por_unidad_local(
            manzana,
            variantes_unidad,
            colonia_id=colonia_id_int,
            colonia_nombre=colonia_nombre,
            datos_padron=datos_padron,
        )
        elegido_unidad = _seleccionar_inmueble_unidad_rppc(por_unidad, datos_padron)
        if elegido_unidad:
            return {
                "metodo": "unidad",
                "payload": payload_unidad,
                "variantes_unidad": variantes_unidad,
                "inmuebles": por_unidad,
                "inmueble_elegido": elegido_unidad,
                "datos_padron": datos_padron,
            }

    if por_clave and not por_ubicacion:
        return {
            "metodo": "clave",
            "payload": {"BUSCAR": "C", "CVE_CAT": _clave_sgc_a_rppc(clave), "VIGENTE": "S"},
            "inmuebles": por_clave,
            "inmueble_elegido": _seleccionar_mejor_inmueble_rppc(por_clave),
            "datos_padron": datos_padron,
        }

    return {
        "metodo": "ubicacion",
        "payload": _payload_inmuebles_ubicacion_rppc(
            manzana,
            colonia_id=colonia_id_int,
        ),
        "inmuebles": por_ubicacion,
        "inmueble_elegido": elegido_lote,
        "datos_padron": datos_padron,
    }


def _consultar_inmuebles_rppc_por_clave(clave_catastral: str, _renovado: bool = False) -> list[dict[str, Any]]:
    """Consulta RPPC por clave catastral y devuelve los inmuebles encontrados."""
    clave_rppc = _clave_sgc_a_rppc(clave_catastral)
    if not clave_rppc:
        raise HTTPException(status_code=400, detail="Clave catastral inválida")

    payload = {
        "BUSCAR": "C",
        "CVE_CAT": clave_rppc,
        "VIGENTE": "S",
    }
    return _consultar_inmuebles_rppc(payload, _renovado=_renovado)


def _seleccionar_mejor_inmueble_rppc(inmuebles: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Selecciona el inmueble más probable cuando RPPC devuelve varias coincidencias.

    Regla conservadora:
    1) solo vigentes;
    2) preferir el municipio configurado;
    3) elegir el FOLIO_REAL más alto, que normalmente corresponde al registro más reciente.
    """
    candidatos = [x for x in inmuebles if str(x.get("VIGENTE") or "").upper() in {"", "S", "SI", "SÍ"}]
    if not candidatos:
        candidatos = list(inmuebles)

    candidatos_municipio = [
        x for x in candidatos
        if APP_MUNICIPIO_MAYUS in str(x.get("MUNLOC") or x.get("MUNICIPIO") or "").upper()
    ]
    if candidatos_municipio:
        candidatos = candidatos_municipio

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


def _guardar_folio_real_en_padron(
    clave_catastral: str,
    folio_real: int,
    *,
    fuente: str = "RPPC",
) -> None:
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
                    folio_real_fuente = %s,
                    folio_real_fecha_actualizacion = now()
                WHERE UPPER(TRIM(clave_catastral)) = %s;
                """,
                (str(folio_real), str(fuente or "RPPC"), clave),
            )
            conn.commit()



def _asegurar_columnas_rppc_cache(cur, conn) -> None:
    """Asegura columnas cache para acelerar consultas RPPC posteriores."""
    global _rppc_columnas_cache_verificadas
    if _rppc_columnas_cache_verificadas:
        return
    try:
        cur.execute(
            """
            ALTER TABLE catalogos.padron_2026
            ADD COLUMN IF NOT EXISTS folio_real_fuente text,
            ADD COLUMN IF NOT EXISTS folio_real_fecha_actualizacion timestamp,
            ADD COLUMN IF NOT EXISTS rppc_doc_tramite_id text,
            ADD COLUMN IF NOT EXISTS rppc_partida text,
            ADD COLUMN IF NOT EXISTS rppc_fecha_actualizacion timestamp,
            ADD COLUMN IF NOT EXISTS rppc_pdf_local text,
            ADD COLUMN IF NOT EXISTS rppc_pdf_fecha_descarga timestamp,
            ADD COLUMN IF NOT EXISTS rppc_pdf_doc_tramite_id text,
            ADD COLUMN IF NOT EXISTS rppc_titular_estado text,
            ADD COLUMN IF NOT EXISTS rppc_titular_mensaje text,
            ADD COLUMN IF NOT EXISTS rppc_titular_nombre_folio text,
            ADD COLUMN IF NOT EXISTS rppc_titular_rol_folio text,
            ADD COLUMN IF NOT EXISTS rppc_titular_nombre_padron_ref text,
            ADD COLUMN IF NOT EXISTS rppc_titular_doc_ref text,
            ADD COLUMN IF NOT EXISTS rppc_titular_comparacion_fecha timestamp;
            """
        )
        conn.commit()
        _rppc_columnas_cache_verificadas = True
    except Exception:
        conn.rollback()
        raise


def _cache_rppc_por_clave_o_folio(
    *,
    clave_catastral: str | None = None,
    folio_real: int | None = None,
) -> dict[str, Any] | None:
    """Lee folio_real/partida/doc_id cacheados en padrón."""
    clave = _normalizar_clave(clave_catastral or "")
    folio = str(folio_real) if folio_real else ""

    if not clave and not folio:
        return None

    with get_conn() as conn:
        with conn.cursor() as cur:
            _asegurar_columnas_rppc_cache(cur, conn)
            if clave:
                cur.execute(
                    """
                    SELECT
                        clave_catastral,
                        NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') AS folio_real,
                        NULLIF(NULLIF(TRIM(rppc_partida::text), ''), '0') AS rppc_partida,
                        NULLIF(NULLIF(TRIM(rppc_doc_tramite_id::text), ''), '0') AS rppc_doc_tramite_id
                    FROM catalogos.padron_2026
                    WHERE UPPER(TRIM(clave_catastral)) = %s
                    LIMIT 1;
                    """,
                    (clave,),
                )
            else:
                cur.execute(
                    """
                    SELECT
                        clave_catastral,
                        NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') AS folio_real,
                        NULLIF(NULLIF(TRIM(rppc_partida::text), ''), '0') AS rppc_partida,
                        NULLIF(NULLIF(TRIM(rppc_doc_tramite_id::text), ''), '0') AS rppc_doc_tramite_id
                    FROM catalogos.padron_2026
                    WHERE NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') = %s
                    LIMIT 1;
                    """,
                    (folio,),
                )
            row = cur.fetchone()

    return row if row else None


def _guardar_cache_rppc_en_padron(
    *,
    clave_catastral: str | None = None,
    folio_real: int | None = None,
    partida: int | None = None,
    doc_tramite_id: int | None = None,
    fuente: str = "RPPC",
) -> None:
    """Guarda folio_real, partida y doc_id en padrón para acelerar futuras consultas."""
    clave = _normalizar_clave(clave_catastral or "")
    if not clave and not folio_real:
        return

    with get_conn() as conn:
        with conn.cursor() as cur:
            _asegurar_columnas_rppc_cache(cur, conn)

            sets: list[str] = []
            params: list[Any] = []

            if folio_real:
                sets.append("folio_real = %s")
                params.append(str(folio_real))
                sets.append("folio_real_fuente = %s")
                params.append(fuente)
                sets.append("folio_real_fecha_actualizacion = now()")

            if partida:
                sets.append("rppc_partida = %s")
                params.append(str(partida))

            if doc_tramite_id:
                sets.append("rppc_doc_tramite_id = %s")
                params.append(str(doc_tramite_id))

            if partida or doc_tramite_id:
                sets.append("rppc_fecha_actualizacion = now()")

            if not sets:
                return

            sql = f"""
                UPDATE catalogos.padron_2026
                SET {", ".join(sets)}
                WHERE
            """

            if clave:
                sql += " UPPER(TRIM(clave_catastral)) = %s"
                params.append(clave)
            else:
                sql += " NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') = %s"
                params.append(str(folio_real))

            cur.execute(sql, tuple(params))
            conn.commit()


def _payloads_movimientos_folio_rppc(folio_real: int) -> list[dict[str, Any]]:
    folio = int(folio_real)
    bases: list[dict[str, Any]] = [
        {"FOLIO_REAL": folio, "infoHistorica": 0},
        {"FOLIO_REAL": folio},
        {"folioReal": folio, "infoHistorica": 0},
    ]
    uid = _rppc_usuario_id or RPPC_USUARIO_ID or _rppc_usuario_id_runtime()
    if uid:
        uid_int = int(uid)
        return [{**pl, "USUARIO_ID": uid_int} for pl in bases] + bases
    return bases


def _consultar_movimientos_folio_directo(folio_real: int) -> list[dict[str, Any]]:
    """Consulta rápida obtenerMovimientosLote — misma sesión preflight que consultaInmuebles."""
    if not _cookie_rppc_valida(_cookie_rppc_actual()):
        raise HTTPException(
            status_code=502,
            detail=(
                "Cookie RPPC inválida para movimientos. Renueve .runtime/rppc_cookie.txt "
                "(.AspNet.ApplicationCookie desde F12) y reinicie la API."
            ),
        )
    _marcar_sesion_consulta_rppc_nueva()
    opener = _preparar_sesion_consulta_rppc(force=True)
    url = _url_api_desde_ruta(
        RPPC_BASE_URL,
        "Servicios/ConsultaAvanzada/obtenerMovimientosLote",
        solo_base=True,
    )
    ultimo_http: int | None = None
    ultimo_preview = ""
    for payload in _payloads_movimientos_folio_rppc(folio_real):
        http, body = _ejecutar_post_rppc_json(opener, url, payload)
        ultimo_http = http
        ultimo_preview = body[:280]
        if http >= 400:
            continue
        try:
            datos = _parsear_movimientos_rppc(body)
            if datos:
                return datos
        except HTTPException:
            continue
    raise HTTPException(
        status_code=502,
        detail=(
            f"obtenerMovimientosLote sin datos para folio {folio_real} "
            f"(http={ultimo_http}): {ultimo_preview or 'sin cuerpo'}"
        ),
    )


def _obtener_doc_id_por_partida_directo(partida: int) -> tuple[int, dict[str, Any]]:
    """Consulta rápida de inscripción usando endpoint confirmado."""
    url = _url_api_desde_ruta(
        RPPC_BASE_URL,
        "Servicios/Reportes/obtenerInscripcionesPart",
        solo_base=True,
    )
    payload = {"PARTIDA": partida}
    _, body = _request_rppc(
        "POST",
        url,
        data=json.dumps(payload).encode("utf-8"),
        content_type="application/json",
        timeout=RPPC_TIMEOUT_POST,
    )
    datos = _parsear_datos_rppc(body)

    if not datos:
        raise HTTPException(status_code=404, detail="No se encontró documento para esa partida")

    doc_id = _normalizar_numero(datos[0].get("DOC_TRAMITE_ID"))
    if not doc_id:
        raise HTTPException(status_code=404, detail="No se encontró DOC_TRAMITE_ID")

    return doc_id, datos[0]


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

    # Si el padrón no trae folio_real, buscamos en RPPC (clave y luego ubicación Tijuana).
    cascada = _consultar_inmuebles_rppc_por_clave_cascada(clave)
    inmuebles = [
        x for x in (cascada.get("inmuebles") or [])
        if _es_item_inmueble_rppc(x)
    ]
    metodo = cascada.get("metodo") or "clave"
    if not inmuebles:
        datos_padron = cascada.get("datos_padron") or _datos_padron_busqueda_rppc(clave)
        pistas: list[str] = []
        if not (datos_padron.get("variantes_unidad") or []):
            pistas.append("falta unidad en padrón (campo numint, ej. C-41)")
        if not _resolver_rppc_colonia_id(datos_padron):
            pistas.append("falta rppc_colonia_id (ver docs/sql/rppc-colonia-id-tijuana.sql)")
        detalle = cascada.get("detalle") or f"clave {_clave_sgc_a_rppc(clave)} y ubicación"
        if pistas:
            detalle = f"{detalle}; {'; '.join(pistas)}"
        raise HTTPException(
            status_code=404,
            detail=f"RPPC no encontró inmuebles para la clave {_clave_sgc_a_rppc(clave)} ({detalle})",
        )

    if metodo == "unidad":
        elegido = cascada.get("inmueble_elegido") or _seleccionar_inmueble_unidad_rppc(
            inmuebles,
            cascada.get("datos_padron") or _datos_padron_busqueda_rppc(clave),
        )
        fuente_folio = "RPPC_UNIDAD"
    elif metodo == "folio":
        elegido = cascada.get("inmueble_elegido") or _seleccionar_inmueble_unidad_rppc(
            inmuebles,
            cascada.get("datos_padron") or _datos_padron_busqueda_rppc(clave),
        ) or _seleccionar_mejor_inmueble_rppc(inmuebles)
        fuente_folio = "RPPC_FOLIO"
    elif metodo == "ubicacion":
        elegido = cascada.get("inmueble_elegido") or _seleccionar_inmueble_ubicacion_rppc(
            inmuebles,
            cascada.get("datos_padron") or _datos_padron_busqueda_rppc(clave),
        )
        fuente_folio = "RPPC_UBICACION"
    else:
        elegido = cascada.get("inmueble_elegido") or _seleccionar_mejor_inmueble_rppc(inmuebles)
        fuente_folio = "RPPC_CLAVE"

    if not elegido:
        raise HTTPException(
            status_code=404,
            detail=f"RPPC encontró coincidencias para {_clave_sgc_a_rppc(clave)}, pero ninguna trae FOLIO_REAL válido",
        )

    folio = _normalizar_numero(elegido.get("FOLIO_REAL"))
    if not folio:
        raise HTTPException(status_code=404, detail="Folio real inválido devuelto por RPPC")

    _guardar_folio_real_en_padron(clave, folio, fuente=fuente_folio)
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
    # Ruta rápida confirmada.
    try:
        return _obtener_doc_id_por_partida_directo(partida)
    except HTTPException:
        pass

    # Respaldo: lógica anterior por descubrimiento/fallback.
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



def _ruta_pdf_local_por_doc(doc_id: int | str, clave_catastral: str | None = None) -> Path:
    clave = _normalizar_clave(clave_catastral or "SIN_CLAVE") or "SIN_CLAVE"
    carpeta = RPPC_PDF_LOCAL_DIR / clave
    carpeta.mkdir(parents=True, exist_ok=True)
    safe_doc = re.sub(r"[^A-Za-z0-9_-]", "_", str(doc_id))
    return carpeta / f"rppc_{safe_doc}.pdf"


def _leer_pdf_local(doc_id: int | str, clave_catastral: str | None = None) -> bytes | None:
    try:
        ruta = _ruta_pdf_local_por_doc(doc_id, clave_catastral)
        if ruta.exists() and ruta.is_file() and ruta.stat().st_size > 0:
            content = ruta.read_bytes()
            if content.startswith(b"%PDF"):
                return content
    except Exception:
        return None
    return None


def _guardar_pdf_local(doc_id: int | str, content: bytes, clave_catastral: str | None = None) -> Path | None:
    try:
        if not content or not content.startswith(b"%PDF"):
            return None
        ruta = _ruta_pdf_local_por_doc(doc_id, clave_catastral)
        ruta.write_bytes(content)
        return ruta
    except Exception:
        return None




_CLAVES_NOMBRE_RPPC = (
    "VENDEDOR",
    "VENDEDORES",
    "COMPRADOR",
    "COMPRADORES",
    "COMPRADOR_ES",
    "A_FAVOR",
    "AFAVOR",
    "DEUDOR",
    "DEUDORES",
    "DONATARIO",
    "DONATARIOS",
    "HEREDERO",
    "HEREDEROS",
    "ADJUDICADO",
    "ADJUDICADOS",
    "CESIONARIO",
    "CESIONARIOS",
    "BENEFICIARIO",
    "BENEFICIARIOS",
    "ASIGNATARIO",
    "ASIGNATARIOS",
    "ADQUIRIENTE",
    "ADQUIRIENTES",
    "NOMBRE_ADQUIRIENTE",
    "NOMBRE_PROPIETARIO",
    "PROPIETARIO",
    "PROPIETARIOS",
    "TITULAR",
    "TITULARES",
    "NOMBRE_TITULAR",
    "NOM_PROPIETARIO",
    "PROPIETARIO_ACTUAL",
    "TITULAR_ACTUAL",
    "DUENO",
    "RAZON_SOCIAL",
)

# Sufijo flexible: COMPRADOR, COMPRADORES, COMPRADOR(ES), COMPRADOR ( ES ), etc.
_RE_SUFIJO_ES = r"(?:ES)?(?:\s*\(\s*ES\s*\))?"
_RE_SUFIJO_S = r"(?:ES)?(?:\s*\(\s*S\s*\))?"


def _patron_etiqueta_rol_pdf(raiz: str, *, sufijo: str = "es", cortes: str = "") -> str:
    etiqueta = rf"{raiz}{_RE_SUFIJO_ES if sufijo == 'es' else _RE_SUFIJO_S}"
    cortes = cortes or r"RFC\b|CURP\b|DOMICILIO\b|FOLIO\s+REAL"
    return rf"{etiqueta}\s*[:\.\-]?\s*(.+?)(?=\s+(?:{cortes})|$)"


# Roles en Hoja de Inscripción RPPC. Se extraen todos y se elige el que mejor coincide con padrón.
_ROLES_TITULAR_PDF_RPPC: list[tuple[str, str]] = [
    (
        "comprador",
        _patron_etiqueta_rol_pdf(
            "COMPRADOR",
            cortes=r"QUIEN(?:ES)?|RFC\b|CURP\b|VENDEDOR|COMPRADOR|FOLIO\s+REAL|DOMICILIO\b",
        ),
    ),
    (
        "vendedor",
        _patron_etiqueta_rol_pdf(
            "VENDEDOR",
            cortes=r"RFC\b|CURP\b|REPRESENTAD|COMPRADOR|FOLIO\s+REAL|DOMICILIO\b",
        ),
    ),
    ("a_favor", r"A\s+FAVOR\s+(?:DE\s+)?(.+?)(?=\s+(?:RFC\b|CURP\b|DOMICILIO\b|FOLIO\s+REAL|COMPRADOR|VENDEDOR|DEUDOR|$))"),
    (
        "deudor",
        _patron_etiqueta_rol_pdf("DEUDOR", cortes=r"RFC\b|CURP\b|DOMICILIO\b|ACREEDOR|FOLIO\s+REAL"),
    ),
    (
        "donatario",
        _patron_etiqueta_rol_pdf("DONATARIO", cortes=r"RFC\b|CURP\b|DOMICILIO\b|DONANTE|FOLIO\s+REAL"),
    ),
    (
        "heredero",
        _patron_etiqueta_rol_pdf("HEREDERO", sufijo="s", cortes=r"RFC\b|CURP\b|DOMICILIO\b|TESTADOR|FOLIO\s+REAL"),
    ),
    (
        "legatario",
        _patron_etiqueta_rol_pdf("LEGATARIO", sufijo="s", cortes=r"RFC\b|CURP\b|DOMICILIO\b|TESTADOR|FOLIO\s+REAL"),
    ),
    (
        "adjudicado",
        _patron_etiqueta_rol_pdf("ADJUDICADO", sufijo="s", cortes=r"RFC\b|CURP\b|DOMICILIO\b|ADJUDICANTE|FOLIO\s+REAL"),
    ),
    (
        "cesionario",
        _patron_etiqueta_rol_pdf("CESIONARIO", sufijo="s", cortes=r"RFC\b|CURP\b|DOMICILIO\b|CEDENTE|FOLIO\s+REAL"),
    ),
    (
        "beneficiario",
        _patron_etiqueta_rol_pdf("BENEFICIARIO", sufijo="s", cortes=r"RFC\b|CURP\b|DOMICILIO\b|FIDEICOMISO|FOLIO\s+REAL"),
    ),
    (
        "asignatario",
        _patron_etiqueta_rol_pdf("ASIGNATARIO", sufijo="s", cortes=r"RFC\b|CURP\b|DOMICILIO\b|FOLIO\s+REAL"),
    ),
    (
        "adquiriente",
        _patron_etiqueta_rol_pdf("ADQUIRIENTE", cortes=r"RFC\b|CURP\b|DOMICILIO\b|FOLIO\s+REAL"),
    ),
    (
        "titular",
        _patron_etiqueta_rol_pdf("TITULAR", cortes=r"RFC\b|CURP\b|DOMICILIO\b|FOLIO\s+REAL"),
    ),
    (
        "propietario",
        r"PROPIETARIO(?:\(S\))?(?:\s+ACTUAL(?:\(ES\))?)?\s*[:\.\-]?\s*(.+?)(?=\s+(?:RFC\b|CURP\b|DOMICILIO\b|FOLIO\s+REAL|$))",
    ),
]

# Etiquetas de rol para extracción línea por línea (respaldo si el PDF fragmenta el texto).
_ROLES_LINEA_PDF_RPPC: list[tuple[str, str]] = [
    ("comprador", "COMPRADOR"),
    ("vendedor", "VENDEDOR"),
    ("deudor", "DEUDOR"),
    ("donatario", "DONATARIO"),
    ("heredero", "HEREDERO"),
    ("legatario", "LEGATARIO"),
    ("adjudicado", "ADJUDICADO"),
    ("cesionario", "CESIONARIO"),
    ("beneficiario", "BENEFICIARIO"),
    ("asignatario", "ASIGNATARIO"),
    ("adquiriente", "ADQUIRIENTE"),
    ("titular", "TITULAR"),
    ("propietario", "PROPIETARIO"),
]

_ROLES_TITULAR_ETIQUETAS = {
    "comprador": "Comprador(es)",
    "vendedor": "Vendedor(es)",
    "a_favor": "A favor",
    "deudor": "Deudor(es)",
    "donatario": "Donatario(es)",
    "heredero": "Heredero(s)",
    "legatario": "Legatario(s)",
    "adjudicado": "Adjudicado(s)",
    "cesionario": "Cesionario(s)",
    "beneficiario": "Beneficiario(s)",
    "asignatario": "Asignatario(s)",
    "adquiriente": "Adquiriente(s)",
    "titular": "Titular",
    "propietario": "Propietario",
    "movimiento": "Movimiento RPPC",
    "inscripcion": "Inscripción RPPC",
    "pdf": "Documento RPPC",
    "texto_folio": "Texto del folio",
}

_TOKENS_IGNORAR_COMPARACION = frozenset({
    "DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E", "EN", "CON", "POR", "AL", "A",
    "VIUDA", "VIUDO", "VIUVO", "CONYUGE", "CONYUGES", "SR", "SRA", "SRTA",
    "LIC", "ING", "C", "SA", "CV", "SC", "AC", "AP", "MZ", "LT",
})

_STOP_DESPUES_NOMBRE_RPPC = re.compile(
    r"\s+(?:QUIEN(?:ES)?(?:\s+ADQUIERE(?:N)?)?|RFC|CURP|CON\s+DOMICILIO|DOMICILIO|EN\s+SU|Y\s+SU|"
    r"REPRESENTAD[OA]|PORCENTAJE|ADQUIERE(?:N)?|ACREEDOR|VENDEDOR|COMPRADOR|DONANTE|CEDENTE|TESTADOR|"
    r"ADJUDICANTE|FIDEICOMISO|EL\s+\d{1,3}\s*%|\d{1,3}\s*%)",
    re.IGNORECASE,
)


def _normalizar_texto_pdf_rppc(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", str(texto or ""))
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    texto = texto.replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    texto = re.sub(r"[^\S\n]+", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip().upper()
    return texto


def _preparar_nombre_para_comparacion(nombre: str) -> str:
    texto = str(nombre or "").strip()
    texto = re.split(r"\s+REPRESENTAD[OA]\s+POR\s+", texto, maxsplit=1, flags=re.IGNORECASE)[0]
    texto = re.split(r"\s+RFC\b", texto, maxsplit=1, flags=re.IGNORECASE)[0]
    texto = re.split(r"\s+CURP\b", texto, maxsplit=1, flags=re.IGNORECASE)[0]
    limpio = _limpiar_nombre_extraido(texto)
    return limpio or texto.strip()


def _normalizar_moral_comparacion(nombre: str) -> str:
    n = _normalizar_nombre_comparacion(_preparar_nombre_para_comparacion(nombre))
    n = re.sub(r"\bS\s*A\s*(?:DE\s*)?C\s*V\b", " SADE CV ", n)
    n = re.sub(r"\bS\s*DE\s*R\s*L\b", " SRL ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _limpiar_nombre_extraido(valor: str) -> str:
    nombre = re.sub(r"\s+", " ", str(valor or "").strip(" .,:;-"))
    nombre = re.sub(r"^(SR|SRA|SRTA|LIC|ING|C|POR)\.?\s+", "", nombre, flags=re.IGNORECASE)
    if len(nombre) < 4:
        return ""
    if nombre.upper() in {"SIN DATOS", "NO APLICA", "N/A", "NULL"}:
        return ""
    return nombre


def _truncar_nombre_rppc_desde_pdf(fragmento: str) -> str:
    texto = re.sub(r"\s+", " ", str(fragmento or "").strip(" .,:;-"))
    texto = _STOP_DESPUES_NOMBRE_RPPC.split(texto, maxsplit=1)[0]
    texto = re.sub(r"\s+", " ", texto).strip(" .,:;-")
    return _limpiar_nombre_extraido(texto)


def _etiqueta_rol_titular_rppc(rol: str | None) -> str | None:
    if not rol:
        return None
    return _ROLES_TITULAR_ETIQUETAS.get(str(rol).lower(), str(rol).replace("_", " ").title())


def _normalizar_nombre_comparacion(nombre: str) -> str:
    texto = unicodedata.normalize("NFKD", str(nombre or ""))
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    texto = texto.upper()
    texto = re.sub(r"[^A-Z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def _normalizar_token_comparacion(token: str) -> str:
    """Unifica variantes frecuentes en apellidos (VASQUEZ/VAZQUEZ)."""
    return str(token or "").replace("Z", "S")


def _tokens_nombre_comparacion(nombre: str) -> set[str]:
    tokens = []
    for token in _normalizar_nombre_comparacion(nombre).split():
        if len(token) <= 1 or token in _TOKENS_IGNORAR_COMPARACION:
            continue
        tokens.append(_normalizar_token_comparacion(token))
    return set(tokens)


def _puntaje_coincidencia_nombres(nombre_padron: str, nombre_rppc: str) -> float:
    if not nombre_padron or not nombre_rppc:
        return 0.0

    padron_prep = _preparar_nombre_para_comparacion(nombre_padron)
    rppc_prep = _preparar_nombre_para_comparacion(nombre_rppc)

    if _normalizar_nombre_comparacion(padron_prep) == _normalizar_nombre_comparacion(rppc_prep):
        return 1.0

    moral_padron = _normalizar_moral_comparacion(padron_prep)
    moral_rppc = _normalizar_moral_comparacion(rppc_prep)
    if moral_padron and moral_rppc:
        if moral_padron == moral_rppc:
            return 1.0
        if moral_padron in moral_rppc or moral_rppc in moral_padron:
            return 0.95

    tokens_padron = _tokens_nombre_comparacion(padron_prep)
    tokens_rppc = _tokens_nombre_comparacion(rppc_prep)
    if not tokens_padron or not tokens_rppc:
        return 0.0
    if tokens_padron == tokens_rppc:
        return 1.0

    inter = tokens_padron & tokens_rppc
    menor = min(len(tokens_padron), len(tokens_rppc))
    if not menor:
        return 0.0
    puntaje = len(inter) / menor

    # Apellidos compuestos con partícula DE en distinto orden (p. ej. DE MARTINEZ ORTIZ SABINA).
    if len(inter) >= 2 and puntaje >= 0.66:
        return max(puntaje, 0.85)
    return puntaje


def _nombres_propietario_coinciden(nombre_padron: str, nombre_rppc: str) -> bool:
    return _puntaje_coincidencia_nombres(nombre_padron, nombre_rppc) >= 0.8


def _extraer_nombre_desde_registro_rppc(registro: dict[str, Any] | None) -> str | None:
    if not isinstance(registro, dict):
        return None

    for clave_canonica in _CLAVES_NOMBRE_RPPC:
        for clave, valor in registro.items():
            if str(clave).upper() != clave_canonica or valor in (None, ""):
                continue
            nombre = _limpiar_nombre_extraido(str(valor))
            if nombre:
                return nombre

    for clave, valor in registro.items():
        clave_u = str(clave).upper()
        if not isinstance(valor, str) or not valor.strip():
            continue
        if any(bloqueo in clave_u for bloqueo in ("FECHA", "ID_", "NUM", "CVE", "TIPO", "OFICINA", "USUARIO")):
            continue
        if any(
            token in clave_u
            for token in (
                "VENDED", "COMPRAD", "DEUDOR", "DONAT", "HERED", "ADJUDIC", "CESION", "BENEFIC", "ASIGNAT",
                "PROPIET", "TITULAR", "ADQUIRIENT", "DUENO", "RAZON", "AFAVOR", "A_FAVOR",
            )
        ):
            nombre = _limpiar_nombre_extraido(valor)
            if nombre:
                return nombre
    return None


def _obtener_nombre_propietario_padron(
    clave_catastral: str | None = None,
    folio_real: int | None = None,
) -> str | None:
    clave = _normalizar_clave(clave_catastral or "")
    folio = str(folio_real) if folio_real else ""

    if not clave and not folio:
        return None

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if clave:
                    cur.execute(
                        """
                        SELECT COALESCE(
                            NULLIF(TRIM(tit.nombre_visible), ''),
                            NULLIF(TRIM(tit.titular_principal), ''),
                            NULLIF(TRIM(p.nombre_completo), '')
                        ) AS nombre
                        FROM catalogos.padron_2026 p
                        LEFT JOIN (
                            SELECT DISTINCT ON (UPPER(TRIM(v.clave_catastral)))
                                v.clave_catastral,
                                v.nombre_visible,
                                v.titular_principal
                            FROM catastro.v_titularidad_predio v
                            ORDER BY
                                UPPER(TRIM(v.clave_catastral)),
                                CASE WHEN UPPER(COALESCE(v.tipo_titularidad, '')) = 'PROPIETARIO' THEN 0 ELSE 1 END,
                                v.porcentaje_propiedad DESC NULLS LAST
                        ) tit ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                        WHERE UPPER(TRIM(p.clave_catastral)) = %s
                        LIMIT 1;
                        """,
                        (clave,),
                    )
                else:
                    cur.execute(
                        """
                        SELECT COALESCE(
                            NULLIF(TRIM(tit.nombre_visible), ''),
                            NULLIF(TRIM(tit.titular_principal), ''),
                            NULLIF(TRIM(p.nombre_completo), '')
                        ) AS nombre
                        FROM catalogos.padron_2026 p
                        LEFT JOIN (
                            SELECT DISTINCT ON (UPPER(TRIM(v.clave_catastral)))
                                v.clave_catastral,
                                v.nombre_visible,
                                v.titular_principal
                            FROM catastro.v_titularidad_predio v
                            ORDER BY
                                UPPER(TRIM(v.clave_catastral)),
                                CASE WHEN UPPER(COALESCE(v.tipo_titularidad, '')) = 'PROPIETARIO' THEN 0 ELSE 1 END,
                                v.porcentaje_propiedad DESC NULLS LAST
                        ) tit ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                        WHERE NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') = %s
                        LIMIT 1;
                        """,
                        (folio,),
                    )
                row = cur.fetchone()
        if row and row.get("nombre"):
            return _limpiar_nombre_extraido(str(row["nombre"]))
    except Exception:
        return None
    return None


def _extraer_texto_literal_pdf_bytes(content: bytes) -> str:
    """Extrae cadenas legibles embebidas en el PDF (operadores Tj/TJ) sin pdftotext."""
    if not content or not content.startswith(b"%PDF"):
        return ""

    partes: list[str] = []
    for coincidencia in re.finditer(rb"\(([^()\\]*(?:\\.[^()\\]*)*)\)", content):
        literal = bytes(coincidencia.group(1))
        if len(literal) < 2:
            continue
        texto = literal.decode("latin-1", errors="ignore")
        texto = texto.replace("\\(", "(").replace("\\)", ")").replace("\\n", " ")
        texto = re.sub(r"\s+", " ", texto).strip()
        if len(texto) >= 2 and re.search(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}", texto):
            partes.append(texto)

    if not partes:
        return ""

    return " ".join(partes)


def _combinar_textos_pdf(*textos: str) -> str:
    limpios = [re.sub(r"[ \t]+", " ", str(t or "").strip()) for t in textos if str(t or "").strip()]
    if not limpios:
        return ""
    return max(limpios, key=lambda t: len(re.sub(r"\s+", "", t)))


def _extraer_textos_desde_pdf(content: bytes) -> tuple[str, str]:
    """Retorna (texto_continuo, texto_con_saltos_de_linea para lectura por renglón)."""
    if not content or not content.startswith(b"%PDF"):
        return "", ""

    textos_planos: list[str] = []
    texto_layout = ""

    for layout in (True, False):
        texto_pt = _pdftotext_extraer(content, layout=layout)
        if len(re.sub(r"\s+", "", texto_pt)) > 40:
            if layout:
                texto_layout = texto_pt
            textos_planos.append(re.sub(r"\s+", " ", texto_pt).strip())

    texto_literal = _extraer_texto_literal_pdf_bytes(content)
    if len(re.sub(r"\s+", "", texto_literal)) > 40:
        textos_planos.append(re.sub(r"\s+", " ", texto_literal).strip())

    try:
        texto = content.decode("latin-1", errors="ignore")
        if len(re.sub(r"\s+", "", texto)) > 80:
            textos_planos.append(re.sub(r"\s+", " ", texto).strip())
    except Exception:
        pass

    texto_plano = _combinar_textos_pdf(*textos_planos)
    texto_lineas = texto_layout.strip() if texto_layout.strip() else texto_plano
    return texto_plano, texto_lineas


def _pdftotext_extraer(content: bytes, *, layout: bool = True) -> str:
    if not shutil.which("pdftotext"):
        return ""
    tmp_pdf = None
    tmp_txt = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_pdf:
            f_pdf.write(content)
            tmp_pdf = f_pdf.name
        tmp_txt = f"{tmp_pdf}.txt"
        args = ["pdftotext", "-enc", "UTF-8"]
        if layout:
            args.append("-layout")
        args.extend([tmp_pdf, tmp_txt])
        subprocess.run(
            args,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
        )
        return Path(tmp_txt).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
    finally:
        for tmp in (tmp_pdf, tmp_txt):
            if tmp:
                try:
                    Path(tmp).unlink(missing_ok=True)
                except Exception:
                    pass


def _extraer_texto_desde_pdf(content: bytes) -> str:
    texto_plano, _ = _extraer_textos_desde_pdf(content)
    return texto_plano


def _limpiar_prefijo_nombre_titular_rppc(nombre: str) -> str:
    texto = re.sub(r"\s+", " ", str(nombre or "").strip())
    texto = re.sub(
        r"^.*?(?:PROPIETARIO(?:\(S\))?(?:\s+Y\s+PROPIEDAD(?:\(ES\))?)?)\s*[:\.\-]?\s*",
        "",
        texto,
        flags=re.IGNORECASE,
    )
    texto = re.sub(
        r"^(?:COMPRADOR|VENDEDOR|PROPIETARIO|DEUDOR|DONATARIO|HEREDERO|ADJUDICADO|"
        r"CESIONARIO|BENEFICIARIO|ADQUIRIENTE|TITULAR|ASIGNATARIO)(?:ES)?"
        r"(?:\s*\(\s*(?:ES|S)\s*\))?\s*[:\.\-]?\s*",
        "",
        texto,
        flags=re.IGNORECASE,
    )
    texto = re.sub(r"^Y\s+PROPIEDAD(?:\(ES\))?\s*", "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"^PROPIEDAD(?:\(ES\))?\s*", "", texto, flags=re.IGNORECASE)
    return texto.strip()


def _es_nombre_titular_valido(limpio: str) -> bool:
    n = _normalizar_nombre_comparacion(limpio)
    if len(n) < 4:
        return False
    if n in {"SIN DATOS", "NO APLICA", "NA"}:
        return False
    prefijos_invalidos = (
        "Y PROPIEDAD",
        "PROPIEDAD ES",
        "PROPIETARIO S",
        "PROPIETARIO Y",
        "PROPIETARIOS Y",
    )
    for prefijo in prefijos_invalidos:
        if n.startswith(prefijo):
            return False
    primeros = n.split()[:4]
    if any(tok in {"PROPIEDAD", "PROPIETARIO", "PROPIETARIOS"} for tok in primeros):
        return False
    if len(_tokens_nombre_comparacion(limpio)) < 2:
        return False
    return True


_RE_LINEA_NO_NOMBRE_RPPC = re.compile(
    r"^(?:RFC|CURP|DOMICILIO|FOLIO|CONTRATO|INSCRIP|LIBRO|PARTIDA|OFICINA|ACTO|OPER|FECHA|"
    r"COMPRADOR|VENDEDOR|PROPIETARIO|DEUDOR|DONATARIO|HEREDERO|ADJUDICADO|CESIONARIO|"
    r"BENEFICIARIO|ADQUIRIENTE|TITULAR|TIPO|NUMERO|NOMBRE\s+DEL|POR\s+CIENTO|DERECHOS|"
    r"REPORTE|HOJA|ESTADO|BAJA|CALIFORNIA|MUNICIPIO|SECCION|ARTICULO|FRACCION|"
    r"REPRESENTAD|NOTARIA|ESCRITURA|C\.?P\.?P\.?|C\.?C\.?)",
    re.IGNORECASE,
)

_REINICIOS_NOMBRE_RPPC = (
    "MARIA", "JOSE", "JUAN", "ANA", "LUIS", "CARLOS", "ANGELICA", "FRANCISCO", "PEDRO", "ROSA",
    "MIGUEL", "ANTONIO", "JESUS", "GUADALUPE", "REFUGIO", "AMELIA", "JORGE", "RAFAEL", "MANUEL",
    "FERNANDO", "ALEJANDRO", "RICARDO", "SERGIO", "ARTURO", "MARTIN", "VICTOR", "ALBERTO",
    "VICTORIANO", "EDGAR", "HUMBERTO", "MARTIN", "ANGELICA",
)


def _partir_nombres_en_linea(nombre_linea: str) -> list[str]:
    """Separa varios nombres en una misma línea (p. ej. dos compradores)."""
    texto = _limpiar_prefijo_nombre_titular_rppc(nombre_linea)
    limpio = _truncar_nombre_rppc_desde_pdf(texto)
    if not limpio:
        return []
    tokens = limpio.split()
    if len(tokens) <= 5:
        return [limpio]

    cortes: list[int] = []
    for i in range(2, len(tokens) - 1):
        if tokens[i] in _REINICIOS_NOMBRE_RPPC and i >= 3:
            cortes.append(i)
    if not cortes:
        return [limpio]

    partes: list[str] = []
    inicio = 0
    for corte in cortes:
        parte = " ".join(tokens[inicio:corte]).strip()
        if parte:
            partes.append(parte)
        inicio = corte
    parte = " ".join(tokens[inicio:]).strip()
    if parte:
        partes.append(parte)
    return partes or [limpio]


def _agregar_candidatos_desde_fragmento(
    encontrados: list[tuple[str, str]],
    vistos: set[str],
    rol: str,
    fragmento: str,
    *,
    partir: bool = True,
) -> None:
    fragmentos = _partir_nombres_en_linea(fragmento) if partir else [fragmento]
    for frag in fragmentos:
        _agregar_candidato_titular_rppc(encontrados, vistos, rol, frag)


def _agregar_candidato_titular_rppc(
    encontrados: list[tuple[str, str]],
    vistos: set[str],
    rol: str,
    nombre: str,
) -> None:
    nombre_limpio = _limpiar_prefijo_nombre_titular_rppc(nombre)
    limpio = _truncar_nombre_rppc_desde_pdf(nombre_limpio)
    if not limpio or not _es_nombre_titular_valido(limpio):
        return
    clave = _normalizar_nombre_comparacion(limpio)
    if not clave or clave in vistos:
        return
    vistos.add(clave)
    encontrados.append((rol, limpio))


def _leer_pdf_local_any(doc_id: int | str, clave_catastral: str | None = None) -> bytes | None:
    clave = _normalizar_clave(clave_catastral or "")
    for candidata in (clave, "SIN_CLAVE", None):
        content = _leer_pdf_local(doc_id, candidata or None)
        if content:
            return content
    return None


def _rol_para_quien_adquiere(texto_norm: str, posicion: int) -> str:
    ventana = texto_norm[max(0, posicion - 100):posicion]
    if re.search(r"COMPRADOR", ventana, re.IGNORECASE):
        return "comprador"
    if re.search(r"DEUDOR", ventana, re.IGNORECASE):
        return "deudor"
    if re.search(r"VENDEDOR", ventana, re.IGNORECASE):
        return "vendedor"
    return "propietario"


def _extraer_copropietarios_quien_adquiere(
    texto_norm: str,
    encontrados: list[tuple[str, str]],
    vistos: set[str],
) -> None:
    for coincidencia in re.finditer(
        r"([A-Z][A-Z0-9\s\.'\-]{3,120}?)\s+QUIEN(?:ES)?\s+ADQUIERE(?:N)?",
        texto_norm,
        re.IGNORECASE,
    ):
        rol = _rol_para_quien_adquiere(texto_norm, coincidencia.start())
        _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, coincidencia.group(1))


def _extraer_nombres_antes_de_rfc(
    texto_norm: str,
    encontrados: list[tuple[str, str]],
    vistos: set[str],
) -> None:
    pos_comprador = texto_norm.find("COMPRADOR")
    pos_vendedor = texto_norm.find("VENDEDOR")
    for coincidencia in re.finditer(
        r"([A-Z][A-Z0-9\s\.'\-]{4,80}?)\s+RFC\s*[:\.]?\s*[A-Z0-9&]{10,13}",
        texto_norm,
        re.IGNORECASE,
    ):
        nombre = coincidencia.group(1).strip()
        pos = coincidencia.start()
        if pos_comprador >= 0 and pos > pos_comprador and (pos_vendedor < 0 or pos > pos_vendedor):
            rol = "comprador"
        elif pos_vendedor >= 0 and pos > pos_vendedor and (pos_comprador < 0 or pos < pos_comprador):
            rol = "vendedor"
        else:
            rol = "comprador" if pos_comprador >= 0 else "vendedor"
        _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, nombre)


def _etiqueta_rol_linea_pdf(raiz: str) -> str:
    return rf"^{raiz}(?:ES)?(?:\s*\(\s*(?:ES|S)\s*\))?"


def _extraer_nombres_multilinea_despues_rol(
    texto: str,
    encontrados: list[tuple[str, str]],
    vistos: set[str],
) -> None:
    """Extrae nombres en líneas posteriores a COMPRADOR(ES), VENDEDOR(ES), etc."""
    rol_actual: str | None = None

    for linea in re.split(r"[\r\n]+", str(texto or "")):
        linea_norm = _normalizar_texto_pdf_rppc(linea)
        if not linea_norm:
            continue

        etiqueta_en_linea = False
        for rol, raiz in _ROLES_LINEA_PDF_RPPC:
            etiqueta = _etiqueta_rol_linea_pdf(raiz)
            if re.match(rf"{etiqueta}\s*$", linea_norm, re.IGNORECASE):
                rol_actual = rol
                etiqueta_en_linea = True
                break
            coincidencia = re.match(rf"{etiqueta}\s*[:\.\-]\s*(.+)$", linea_norm, re.IGNORECASE)
            if coincidencia:
                rol_actual = rol
                _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, coincidencia.group(1))
                etiqueta_en_linea = True
                break
            coincidencia = re.match(rf"{etiqueta}\s+(.+)$", linea_norm, re.IGNORECASE)
            if coincidencia:
                rol_actual = rol
                _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, coincidencia.group(1))
                etiqueta_en_linea = True
                break

        if etiqueta_en_linea:
            continue

        if rol_actual and not _RE_LINEA_NO_NOMBRE_RPPC.match(linea_norm):
            _agregar_candidatos_desde_fragmento(encontrados, vistos, rol_actual, linea_norm)
        elif _RE_LINEA_NO_NOMBRE_RPPC.match(linea_norm):
            rol_actual = None


def _extraer_nombres_titulares_linea_por_linea(texto: str) -> list[tuple[str, str]]:
    encontrados: list[tuple[str, str]] = []
    vistos: set[str] = set()
    texto_uni = unicodedata.normalize("NFKD", str(texto or ""))
    for linea in re.split(r"[\r\n]+", texto_uni):
        linea_norm = _normalizar_texto_pdf_rppc(linea)
        if not linea_norm:
            continue
        for rol, raiz in _ROLES_LINEA_PDF_RPPC:
            patrones = (
                rf"{raiz}(?:ES)?(?:\s*\(\s*(?:ES|S)\s*\))?\s*[:\.\-]\s*(.+)",
                rf"{raiz}(?:ES)?(?:\s*\(\s*(?:ES|S)\s*\))?\s+(.+)",
            )
            for patron in patrones:
                coincidencia = re.search(patron, linea_norm, re.IGNORECASE)
                if coincidencia:
                    _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, coincidencia.group(1))
                    break
    return encontrados


def _extraer_nombres_titulares_por_ancla(texto_norm: str) -> list[tuple[str, str]]:
    encontrados: list[tuple[str, str]] = []
    vistos: set[str] = set()
    for rol, raiz in _ROLES_LINEA_PDF_RPPC:
        etiqueta_re = rf"{raiz}(?:ES)?(?:\s*\(\s*(?:ES|S)\s*\))?"
        for coincidencia in re.finditer(etiqueta_re, texto_norm, re.IGNORECASE):
            chunk = texto_norm[coincidencia.end() : coincidencia.end() + 220].lstrip(" :.-()")
            _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, chunk)
    return encontrados


def _mejor_fragmento_nombre_en_ventana(ventana: str, nombre_padron: str) -> str | None:
    palabras = ventana.split()
    if len(palabras) < 2:
        return None
    mejor: str | None = None
    mejor_puntaje = 0.0
    for inicio in range(len(palabras)):
        for fin in range(inicio + 2, min(inicio + 14, len(palabras)) + 1):
            fragmento = " ".join(palabras[inicio:fin])
            puntaje = _puntaje_coincidencia_nombres(nombre_padron, fragmento)
            if puntaje > mejor_puntaje:
                mejor_puntaje = puntaje
                mejor = fragmento
    if mejor_puntaje >= 0.85 and mejor:
        limpio = _truncar_nombre_rppc_desde_pdf(mejor)
        return limpio or mejor
    return None


def _buscar_nombre_padron_en_texto_pdf(texto_norm: str, nombre_padron: str) -> str | None:
    if not texto_norm or not nombre_padron:
        return None

    tokens = _tokens_nombre_comparacion(nombre_padron)
    if len(tokens) < 2:
        return None

    anclas = (
        "COMPRADOR",
        "DEUDOR",
        "PROPIETARIO",
        "ADJUDICADO",
        "HEREDERO",
        "LEGATARIO",
        "ADQUIRIENTE",
        "TITULAR",
        "A FAVOR",
        "CESIONARIO",
        "BENEFICIARIO",
    )
    for ancla in anclas:
        inicio = 0
        while True:
            pos = texto_norm.find(ancla, inicio)
            if pos < 0:
                break
            ventana = texto_norm[pos : pos + 380]
            hallado = _mejor_fragmento_nombre_en_ventana(ventana, nombre_padron)
            if hallado:
                return hallado
            inicio = pos + len(ancla)

    return _mejor_fragmento_nombre_en_ventana(texto_norm, nombre_padron)


def _extraer_nombres_titulares_desde_pdf(content: bytes, nombre_padron: str | None = None) -> list[tuple[str, str]]:
    texto_plano, texto_lineas = _extraer_textos_desde_pdf(content)
    if not texto_plano and not texto_lineas:
        return []

    texto_norm = _normalizar_texto_pdf_rppc(texto_plano or texto_lineas)
    encontrados: list[tuple[str, str]] = []
    vistos: set[str] = set()

    for rol, patron in _ROLES_TITULAR_PDF_RPPC:
        for coincidencia in re.finditer(patron, texto_norm, re.IGNORECASE):
            _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, coincidencia.group(1))

    _extraer_copropietarios_quien_adquiere(texto_norm, encontrados, vistos)
    _extraer_nombres_antes_de_rfc(texto_norm, encontrados, vistos)

    _extraer_nombres_multilinea_despues_rol(texto_lineas or texto_plano, encontrados, vistos)

    for rol, nombre in _extraer_nombres_titulares_linea_por_linea(texto_lineas or texto_plano):
        _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, nombre, partir=False)

    for rol, nombre in _extraer_nombres_titulares_por_ancla(texto_norm):
        _agregar_candidatos_desde_fragmento(encontrados, vistos, rol, nombre, partir=False)

    if nombre_padron:
        coincidencia_directa = _buscar_nombre_padron_en_texto_pdf(texto_norm, nombre_padron)
        if coincidencia_directa:
            _agregar_candidato_titular_rppc(encontrados, vistos, "texto_folio", coincidencia_directa)

    return encontrados


_ROLES_ADQUISICION_RPPC = frozenset({
    "comprador", "propietario", "adquiriente", "titular", "adjudicado",
    "heredero", "donatario", "a_favor", "cesionario", "beneficiario", "asignatario", "texto_folio",
})

_ROLES_EXCLUIR_COMPARACION_PADRON = frozenset({
    "vendedor", "movimiento", "inscripcion",
})

_ORDEN_PRIORIDAD_COMPARACION_PADRON = (
    "comprador",
    "propietario",
    "adquiriente",
    "titular",
    "deudor",
    "adjudicado",
    "heredero",
    "legatario",
    "donatario",
    "a_favor",
    "cesionario",
    "beneficiario",
    "asignatario",
    "texto_folio",
)


def _prioridad_rol_comparacion(rol: str) -> int:
    try:
        return _ORDEN_PRIORIDAD_COMPARACION_PADRON.index(str(rol or "").lower())
    except ValueError:
        return len(_ORDEN_PRIORIDAD_COMPARACION_PADRON)


def _pool_candidatos_comparacion_padron(
    candidatos: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    pool = [(rol, nombre) for rol, nombre in candidatos if rol not in _ROLES_EXCLUIR_COMPARACION_PADRON]
    if not pool:
        return []
    sin_moral = [(rol, nombre) for rol, nombre in pool if not _es_probable_persona_moral(nombre)]
    return sin_moral or pool


def _doc_ref_comparacion_titular(
    *,
    partida: int | None,
    doc_tramite_id: int | None,
) -> str:
    if doc_tramite_id:
        return f"doc:{doc_tramite_id}"
    if partida:
        return f"partida:{partida}"
    return ""


def _comparacion_dict_desde_fila_padron(
    row: dict[str, Any] | None,
    *,
    nombre_padron: str | None = None,
) -> dict[str, Any] | None:
    if not row or not row.get("rppc_titular_estado"):
        return None

    estado = str(row["rppc_titular_estado"]).strip().lower()
    if estado not in {"coincide", "difiere"}:
        return None

    rol = str(row.get("rppc_titular_rol_folio") or "").strip() or None
    nombre_ref = row.get("rppc_titular_nombre_padron_ref")
    return {
        "estado": estado,
        "coincide": estado == "coincide",
        "mensaje": row.get("rppc_titular_mensaje") or (
            "COINCIDEN AMBOS REGISTROS" if estado == "coincide" else "NO COINCIDEN LOS REGISTROS"
        ),
        "nombre_padron": nombre_padron or nombre_ref,
        "nombre_rppc": row.get("rppc_titular_nombre_folio"),
        "fuente_rppc": rol,
        "rol_rppc": rol,
        "rol_rppc_etiqueta": _etiqueta_rol_titular_rppc(rol),
        "desde_cache_db": True,
        "comparacion_fecha": row.get("rppc_titular_comparacion_fecha"),
    }


def _fila_comparacion_titular_padron(cur, clave: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT
            rppc_titular_estado,
            rppc_titular_mensaje,
            rppc_titular_nombre_folio,
            rppc_titular_rol_folio,
            rppc_titular_nombre_padron_ref,
            rppc_titular_doc_ref,
            rppc_titular_comparacion_fecha
        FROM catalogos.padron_2026
        WHERE clave_catastral = %s
        LIMIT 1;
        """,
        (clave,),
    )
    return cur.fetchone()


def _leer_comparacion_titular_cache_rapido(clave_catastral: str) -> dict[str, Any] | None:
    """Lee comparación cacheada (memoria + BD) sin consultas pesadas ni releer PDF."""
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        return None

    mem = _rppc_comparacion_por_clave.get(clave)
    if mem and str(mem.get("estado") or "").lower() in {"coincide", "difiere"}:
        return mem

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                _asegurar_columnas_rppc_cache(cur, conn)
                row = _fila_comparacion_titular_padron(cur, clave)
    except Exception:
        return None

    comparacion = _comparacion_dict_desde_fila_padron(row)
    if comparacion:
        _cachear_comparacion_titular(clave, comparacion)
    return comparacion


def _leer_comparacion_titular_desde_padron(
    clave_catastral: str,
    nombre_padron: str | None,
    *,
    doc_ref: str | None = None,
) -> dict[str, Any] | None:
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        return None

    comparacion = _leer_comparacion_titular_cache_rapido(clave)
    if not comparacion:
        return None

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                _asegurar_columnas_rppc_cache(cur, conn)
                row = _fila_comparacion_titular_padron(cur, clave)
    except Exception:
        return comparacion

    if not row:
        return comparacion

    ref_padron = str(row.get("rppc_titular_nombre_padron_ref") or "").strip()
    if nombre_padron and ref_padron:
        if _normalizar_nombre_comparacion(ref_padron) != _normalizar_nombre_comparacion(nombre_padron):
            return None

    ref_doc = str(row.get("rppc_titular_doc_ref") or "").strip()
    if doc_ref and ref_doc and ref_doc != doc_ref:
        return None

    if nombre_padron:
        comparacion["nombre_padron"] = nombre_padron
    return comparacion


def _guardar_comparacion_titular_en_padron(
    *,
    clave_catastral: str,
    nombre_padron: str | None,
    comparacion: dict[str, Any],
    partida: int | None = None,
    doc_tramite_id: int | None = None,
) -> None:
    clave = _normalizar_clave(clave_catastral)
    estado = str(comparacion.get("estado") or "").strip().lower()
    if not clave or estado not in {"coincide", "difiere"}:
        return

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                _asegurar_columnas_rppc_cache(cur, conn)
                cur.execute(
                    """
                    UPDATE catalogos.padron_2026
                    SET rppc_titular_estado = %s,
                        rppc_titular_mensaje = %s,
                        rppc_titular_nombre_folio = %s,
                        rppc_titular_rol_folio = %s,
                        rppc_titular_nombre_padron_ref = %s,
                        rppc_titular_doc_ref = %s,
                        rppc_titular_comparacion_fecha = now()
                    WHERE UPPER(TRIM(clave_catastral)) = %s;
                    """,
                    (
                        estado,
                        comparacion.get("mensaje"),
                        comparacion.get("nombre_rppc"),
                        comparacion.get("rol_rppc"),
                        nombre_padron,
                        _doc_ref_comparacion_titular(partida=partida, doc_tramite_id=doc_tramite_id),
                        clave,
                    ),
                )
                conn.commit()
    except Exception:
        pass


def _es_probable_persona_moral(nombre: str) -> bool:
    n = _normalizar_nombre_comparacion(nombre)
    if not n:
        return False
    marcadores = (
        "BANCO", "INSTITUCION", "FIDEICOMISO", "SOCIEDAD", "ASOCIACION", "FONDO",
        "S A DE C V", "SADE CV", "S DE R L", "GRUPO FINANCIERO", "HIPOTECARIA",
        "FINANCIERA", "ARRENDADORA", "TRUST", "FIDEICOM",
    )
    return any(m in n for m in marcadores)


def _seleccionar_nombre_titular_rppc(
    candidatos: list[tuple[str, str]],
    nombre_padron: str | None,
) -> tuple[str | None, str | None, float]:
    pool = _pool_candidatos_comparacion_padron(candidatos)
    if not pool:
        return None, None, 0.0

    if nombre_padron:
        mejor_rol = None
        mejor_nombre = None
        mejor_puntaje = -1.0
        mejor_prioridad = len(_ORDEN_PRIORIDAD_COMPARACION_PADRON)
        for rol, nombre in pool:
            puntaje = _puntaje_coincidencia_nombres(nombre_padron, nombre)
            prioridad = _prioridad_rol_comparacion(rol)
            if puntaje > mejor_puntaje or (puntaje == mejor_puntaje and prioridad < mejor_prioridad):
                mejor_puntaje = puntaje
                mejor_rol = rol
                mejor_nombre = nombre
                mejor_prioridad = prioridad
        if mejor_nombre:
            return mejor_rol, mejor_nombre, max(mejor_puntaje, 0.0)

    mejor_prioridad = len(_ORDEN_PRIORIDAD_COMPARACION_PADRON)
    elegido: tuple[str, str] | None = None
    for rol, nombre in pool:
        prioridad = _prioridad_rol_comparacion(rol)
        if prioridad < mejor_prioridad:
            mejor_prioridad = prioridad
            elegido = (rol, nombre)
    if elegido:
        return elegido[0], elegido[1], 0.0
    return None, None, 0.0


def _extraer_nombre_propietario_desde_pdf(
    content: bytes,
    nombre_padron: str | None = None,
) -> tuple[str | None, str | None, float]:
    candidatos = _extraer_nombres_titulares_desde_pdf(content, nombre_padron=nombre_padron)
    rol, nombre, puntaje = _seleccionar_nombre_titular_rppc(candidatos, nombre_padron)
    return rol, nombre, puntaje


def _obtener_bytes_pdf_rppc_para_lectura(
    *,
    doc_tramite_id: int | None,
    partida: int | None,
    clave_catastral: str | None,
) -> bytes | None:
    clave = _normalizar_clave(clave_catastral or "") or None
    if doc_tramite_id:
        local = _leer_pdf_local_any(doc_tramite_id, clave)
        if local:
            return local
        try:
            return _descargar_pdf(int(doc_tramite_id), partida=partida)
        except HTTPException:
            return None
    if partida:
        doc_ref = f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}"
        local = _leer_pdf_local_any(doc_ref, clave)
        if local:
            return local
        try:
            return _descargar_pdf_hoja_inscripcion_por_partida(partida)
        except HTTPException:
            return None
    return None


def _cachear_comparacion_titular(clave_catastral: str | None, comparacion: dict[str, Any]) -> None:
    clave = _normalizar_clave(clave_catastral or "")
    if clave and comparacion:
        _rppc_comparacion_por_clave[clave] = comparacion


def _rppc_precalc_activo(clave: str) -> bool:
    with _rppc_precalc_lock:
        return clave in _rppc_precalc_en_curso


def _rppc_marcar_precalc_inicio(clave: str) -> bool:
    with _rppc_precalc_lock:
        if clave in _rppc_precalc_en_curso:
            return False
        _rppc_precalc_en_curso.add(clave)
        return True


def _rppc_marcar_precalc_fin(clave: str) -> None:
    with _rppc_precalc_lock:
        _rppc_precalc_en_curso.discard(clave)


def _rppc_respuesta_procesando() -> dict[str, Any]:
    return {
        "estado": "procesando",
        "mensaje": "Comparación RPPC en segundo plano",
    }


def _precalcular_rppc_wrapper(clave_catastral: str) -> None:
    clave = _normalizar_clave(clave_catastral)
    if not clave or not _rppc_marcar_precalc_inicio(clave):
        return
    try:
        _precalcular_rppc_para_clave(clave)
    finally:
        _rppc_marcar_precalc_fin(clave)


def _comparar_titular_clave_recalcular(
    clave_catastral: str,
    *,
    forzar: bool = False,
    solo_cache: bool = False,
) -> dict[str, Any]:
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    if not forzar:
        rapido = _leer_comparacion_titular_cache_rapido(clave)
        if rapido:
            return rapido
        if solo_cache or _rppc_precalc_activo(clave):
            return _rppc_respuesta_procesando()

    cache_padron = _cache_rppc_por_clave_o_folio(clave_catastral=clave)
    folio_real = _normalizar_numero((cache_padron or {}).get("folio_real"))
    partida = _normalizar_numero((cache_padron or {}).get("rppc_partida"))
    doc_tramite_id = _normalizar_numero((cache_padron or {}).get("rppc_doc_tramite_id"))

    if not folio_real:
        folio_real = _obtener_folio_por_clave(clave)

    doc_ref = _doc_ref_comparacion_titular(partida=partida, doc_tramite_id=doc_tramite_id)
    nombre_padron = _obtener_nombre_propietario_padron(clave_catastral=clave, folio_real=folio_real)

    if not forzar:
        validada = _leer_comparacion_titular_desde_padron(clave, nombre_padron, doc_ref=doc_ref or None)
        if validada:
            _cachear_comparacion_titular(clave, validada)
            return validada

    pdf_bytes: bytes | None = None
    if partida:
        doc_ref = f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}"
        pdf_bytes = _leer_pdf_local_any(doc_ref, clave)
    if not pdf_bytes and doc_tramite_id:
        pdf_bytes = _leer_pdf_local_any(doc_tramite_id, clave)
    if not pdf_bytes and (partida or doc_tramite_id):
        pdf_bytes = _obtener_bytes_pdf_rppc_para_lectura(
            doc_tramite_id=doc_tramite_id,
            partida=partida,
            clave_catastral=clave,
        )

    comparacion = _construir_comparacion_titular(
        clave_catastral=clave,
        folio_real=folio_real,
        movimiento=None,
        inscripcion=None,
        partida=partida,
        doc_tramite_id=doc_tramite_id,
        pdf_bytes_override=pdf_bytes,
        usar_cache_db=not forzar,
    )
    _cachear_comparacion_titular(clave, comparacion)
    return comparacion


def _precalcular_rppc_para_clave(clave_catastral: str) -> None:
    """Resuelve documento RPPC, cachea PDF local y guarda comparación titular en BD."""
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        return
    if _leer_comparacion_titular_cache_rapido(clave):
        return
    try:
        folio_real = _obtener_folio_por_clave(clave)
        cache_padron = _cache_rppc_por_clave_o_folio(clave_catastral=clave, folio_real=folio_real)
        if not folio_real:
            folio_real = _normalizar_numero((cache_padron or {}).get("folio_real"))
        if not folio_real:
            return

        partida = _normalizar_numero((cache_padron or {}).get("rppc_partida"))
        doc_tramite_id = _normalizar_numero((cache_padron or {}).get("rppc_doc_tramite_id"))
        if not partida and not doc_tramite_id:
            _resolver_documento_por_folio(folio_real, clave_catastral=clave)
            cache_padron = _cache_rppc_por_clave_o_folio(clave_catastral=clave, folio_real=folio_real)
            partida = _normalizar_numero((cache_padron or {}).get("rppc_partida"))
            doc_tramite_id = _normalizar_numero((cache_padron or {}).get("rppc_doc_tramite_id"))

        pdf_bytes: bytes | None = None
        if partida:
            doc_ref = f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}"
            pdf_bytes = _leer_pdf_local_any(doc_ref, clave)
        if not pdf_bytes and doc_tramite_id:
            pdf_bytes = _leer_pdf_local_any(doc_tramite_id, clave)
        if not pdf_bytes and (partida or doc_tramite_id):
            pdf_bytes = _obtener_bytes_pdf_rppc_para_lectura(
                doc_tramite_id=doc_tramite_id,
                partida=partida,
                clave_catastral=clave,
            )
            if pdf_bytes and doc_tramite_id:
                _guardar_pdf_local(doc_tramite_id, pdf_bytes, clave)
            elif pdf_bytes and partida:
                _guardar_pdf_local(f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}", pdf_bytes, clave)

        _comparar_titular_clave_recalcular(clave, forzar=False)
    except Exception:
        pass


def _construir_comparacion_titular(
    *,
    clave_catastral: str | None,
    folio_real: int | None,
    movimiento: dict[str, Any] | None,
    inscripcion: dict[str, Any] | None,
    partida: int | None,
    doc_tramite_id: int | None,
    pdf_bytes_override: bytes | None = None,
    usar_cache_db: bool = True,
) -> dict[str, Any]:
    clave = _normalizar_clave(clave_catastral or "")
    nombre_padron = _obtener_nombre_propietario_padron(
        clave_catastral=clave_catastral,
        folio_real=folio_real,
    )
    doc_ref = _doc_ref_comparacion_titular(partida=partida, doc_tramite_id=doc_tramite_id)

    if usar_cache_db and clave:
        rapido = _leer_comparacion_titular_cache_rapido(clave)
        if rapido:
            return rapido
        db_cache = _leer_comparacion_titular_desde_padron(clave, nombre_padron, doc_ref=doc_ref or None)
        if db_cache:
            return db_cache

    candidatos: list[tuple[str, str]] = []

    if movimiento:
        nombre_mov = _extraer_nombre_desde_registro_rppc(movimiento)
        if nombre_mov:
            candidatos.append(("movimiento", nombre_mov))
    if inscripcion:
        nombre_ins = _extraer_nombre_desde_registro_rppc(inscripcion)
        if nombre_ins:
            candidatos.append(("inscripcion", nombre_ins))
    if pdf_bytes_override:
        candidatos.extend(_extraer_nombres_titulares_desde_pdf(pdf_bytes_override, nombre_padron=nombre_padron))
    elif doc_tramite_id or partida:
        pdf_bytes = _obtener_bytes_pdf_rppc_para_lectura(
            doc_tramite_id=doc_tramite_id,
            partida=partida,
            clave_catastral=clave_catastral,
        )
        if pdf_bytes:
            candidatos.extend(_extraer_nombres_titulares_desde_pdf(pdf_bytes, nombre_padron=nombre_padron))

    rol_rppc, nombre_rppc, puntaje_match = _seleccionar_nombre_titular_rppc(candidatos, nombre_padron)
    fuente_rppc = rol_rppc

    etiqueta_rol = _etiqueta_rol_titular_rppc(rol_rppc)

    if not nombre_padron and not nombre_rppc:
        estado = "sin_datos"
        mensaje = "No hay nombre en padrón ni titular legible en el documento RPPC."
    elif not nombre_padron:
        estado = "sin_padron"
        mensaje = "El padrón no tiene contribuyente registrado; no se puede validar coincidencia."
    elif not nombre_rppc:
        estado = "sin_rppc"
        mensaje = (
            "No se pudo leer el titular en el folio "
            "(Comprador, Deudor, Heredero, Legatario, Propietario, etc.)."
        )
    elif _nombres_propietario_coinciden(nombre_padron, nombre_rppc):
        estado = "coincide"
        mensaje = "COINCIDEN AMBOS REGISTROS"
    else:
        estado = "difiere"
        mensaje = "NO COINCIDEN LOS REGISTROS"

    comparacion = {
        "estado": estado,
        "coincide": estado == "coincide",
        "mensaje": mensaje,
        "nombre_padron": nombre_padron,
        "nombre_rppc": nombre_rppc,
        "fuente_rppc": fuente_rppc,
        "rol_rppc": rol_rppc,
        "rol_rppc_etiqueta": etiqueta_rol,
    }

    if clave and estado in {"coincide", "difiere"}:
        _guardar_comparacion_titular_en_padron(
            clave_catastral=clave,
            nombre_padron=nombre_padron,
            comparacion=comparacion,
            partida=partida,
            doc_tramite_id=doc_tramite_id,
        )

    return comparacion


def _adjuntar_comparacion_titular(
    resultado: dict[str, Any],
    clave_catastral: str | None,
    folio_real: int | None,
) -> dict[str, Any]:
    clave = _normalizar_clave(clave_catastral or "")
    if clave:
        rapido = _leer_comparacion_titular_cache_rapido(clave)
        if rapido:
            resultado["comparacion_titular"] = rapido
    return resultado


def _extraer_folio_real_desde_pdf(content: bytes) -> int | None:
    """Intenta extraer FOLIO REAL desde un PDF RPPC sin usar OCR.

    Primero busca texto directo en los bytes; si no aparece, usa pdftotext si está
    instalado en el servidor. Si no logra extraerlo, devuelve None sin fallar.
    """
    if not content or not content.startswith(b"%PDF"):
        return None

    patrones = [
        r"FOLIO\s*REAL\s*[:\-]?\s*([0-9]{3,12})",
        r"FOLIOREAL\s*[:\-]?\s*([0-9]{3,12})",
    ]

    texto_norm = re.sub(r"\s+", " ", _extraer_texto_desde_pdf(content).upper())
    for patron in patrones:
        coincidencia = re.search(patron, texto_norm, re.IGNORECASE)
        if coincidencia:
            return _normalizar_numero(coincidencia.group(1))
    return None


def _guardar_folio_extraido_pdf_en_padron(
    *,
    clave_catastral: str | None,
    folio_real_actual: int | None,
    content: bytes,
    fuente: str = "RPPC_PDF",
) -> int | None:
    """Guarda en padrón el FOLIO REAL visible dentro del PDF si el padrón no lo tenía.

    Retorna el folio final conocido. No falla si el PDF no tiene texto extraíble.
    """
    if folio_real_actual:
        return folio_real_actual
    clave = _normalizar_clave(clave_catastral or "")
    if not clave:
        return None
    folio_extraido = _extraer_folio_real_desde_pdf(content)
    if not folio_extraido:
        return None
    try:
        _guardar_cache_rppc_en_padron(
            clave_catastral=clave,
            folio_real=folio_extraido,
            fuente=fuente,
        )
    except Exception:
        try:
            _guardar_folio_real_en_padron(clave, folio_extraido)
        except Exception:
            pass
    return folio_extraido

def _registrar_pdf_local_en_padron(
    *,
    clave_catastral: str | None = None,
    folio_real: int | None = None,
    partida: int | None = None,
    doc_id: int | str | None = None,
    ruta: Path | None = None,
) -> None:
    if not ruta or not doc_id:
        return
    clave = _normalizar_clave(clave_catastral or "")
    folio = str(folio_real) if folio_real else ""
    if not clave and not folio:
        return
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    ALTER TABLE catalogos.padron_2026
                    ADD COLUMN IF NOT EXISTS rppc_pdf_local text,
                    ADD COLUMN IF NOT EXISTS rppc_pdf_fecha_descarga timestamp,
                    ADD COLUMN IF NOT EXISTS rppc_pdf_doc_tramite_id text;
                    """
                )
                params: list[Any] = [str(ruta), str(doc_id)]
                sql = """
                    UPDATE catalogos.padron_2026
                    SET rppc_pdf_local = %s,
                        rppc_pdf_doc_tramite_id = %s,
                        rppc_pdf_fecha_descarga = now()
                """
                if partida:
                    sql += ", rppc_partida = %s"
                    params.append(str(partida))
                sql += " WHERE "
                if clave:
                    sql += "UPPER(TRIM(clave_catastral)) = %s"
                    params.append(clave)
                else:
                    sql += "NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') = %s"
                    params.append(folio)
                cur.execute(sql, tuple(params))
                conn.commit()
    except Exception:
        pass


def _descargar_pdf_hoja_inscripcion_por_partida(
    partida: int,
    *,
    municipio: str = APP_MUNICIPIO_MAYUS,
    oficina_id: int = 1,
    _renovado: bool = False,
) -> bytes:
    """Descarga PDF alternativo de Hoja de Inscripción por PARTIDA.

    Este fallback cubre inscripciones antiguas que el RPPC sí muestra en pantalla,
    pero que no traen DOC_TRAMITE_ID en obtenerInscripcionesPart.
    """
    cached = _leer_pdf_local(f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}")
    if cached:
        return cached

    base = _url_api_desde_ruta(
        RPPC_BASE_URL,
        f"Servicios/Reportes/{RPPC_HOJA_INSCRIPCION_ACTION}",
        solo_base=True,
    )
    params = {
        "NOMBRE_REP": "ReporteHojaInscFir",
        "FORMATO": "PDF",
        "PARTIDA": str(partida),
        "TITULOREP": "HOJA DE INSCRIPCIÓN",
        "OFICINA_ID": str(oficina_id),
        "PREVIEW": "S",
        "MUNICIPIO": municipio or APP_MUNICIPIO_MAYUS,
        "ORIENTACION": "V",
        "TIPOHOJA": "CARTA",
    }
    url = f"{base}?{urllib.parse.urlencode(params)}"
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
                return _descargar_pdf_hoja_inscripcion_por_partida(partida, municipio=municipio, oficina_id=oficina_id, _renovado=True)
        raise HTTPException(status_code=502, detail=f"No se pudo descargar Hoja de Inscripción RPPC: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo contactar al RPPC para Hoja de Inscripción: {_mensaje_url_error(exc)}") from exc

    if not content:
        raise HTTPException(status_code=502, detail="El RPPC devolvió Hoja de Inscripción vacía")
    if not content.startswith(b"%PDF"):
        if not _renovado and RPPC_USUARIO and RPPC_PASSWORD:
            if _renovar_cookie_rppc_runtime():
                _reset_rppc_opener()
                return _descargar_pdf_hoja_inscripcion_por_partida(partida, municipio=municipio, oficina_id=oficina_id, _renovado=True)
        preview = content[:180].decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"RPPC no devolvió PDF de Hoja de Inscripción: {preview}")

    _guardar_pdf_local(f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}", content)
    return content

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


def _stream_pdf(
    doc_id: int | str,
    filename: str,
    partida: int | None = None,
    clave_catastral: str | None = None,
    folio_real: int | None = None,
):
    if isinstance(doc_id, str) and doc_id.startswith(RPPC_HOJA_INSCRIPCION_DOC_PREFIX):
        if not partida:
            partida = _normalizar_numero(doc_id.replace(RPPC_HOJA_INSCRIPCION_DOC_PREFIX, ""))
        if not partida:
            raise HTTPException(status_code=404, detail="Partida inválida para Hoja de Inscripción")
        local = _leer_pdf_local(doc_id, clave_catastral) or _leer_pdf_local(doc_id)
        if local:
            content = local
            source = "local-cache-hoja-inscripcion"
        else:
            content = _descargar_pdf_hoja_inscripcion_por_partida(partida)
            ruta = _guardar_pdf_local(doc_id, content, clave_catastral) or _guardar_pdf_local(doc_id, content)
            _registrar_pdf_local_en_padron(
                clave_catastral=clave_catastral,
                folio_real=folio_real,
                partida=partida,
                doc_id=doc_id,
                ruta=ruta,
            )
            source = "rppc-hoja-inscripcion"
    else:
        local = _leer_pdf_local(doc_id, clave_catastral)
        if local:
            content = local
            source = "local-cache"
        else:
            content = _descargar_pdf(int(doc_id), partida=partida)
            ruta = _guardar_pdf_local(doc_id, content, clave_catastral)
            _registrar_pdf_local_en_padron(
                clave_catastral=clave_catastral,
                folio_real=folio_real,
                partida=partida,
                doc_id=doc_id,
                ruta=ruta,
            )
            source = "rppc-download"

    # Si el PDF trae FOLIO REAL visible y la clave no lo tenía registrado,
    # lo extraemos y persistimos para futuras consultas.
    folio_real = _guardar_folio_extraido_pdf_en_padron(
        clave_catastral=clave_catastral,
        folio_real_actual=folio_real,
        content=content,
        fuente="RPPC_PDF",
    ) or folio_real

    doc_tramite_num = None
    if not isinstance(doc_id, str) or not str(doc_id).startswith(RPPC_HOJA_INSCRIPCION_DOC_PREFIX):
        doc_tramite_num = _normalizar_numero(doc_id)

    clave_norm = _normalizar_clave(clave_catastral or "")
    comparacion = _leer_comparacion_titular_cache_rapido(clave_norm) if clave_norm else None
    if not comparacion:
        comparacion = _construir_comparacion_titular(
            clave_catastral=clave_catastral,
            folio_real=folio_real,
            movimiento=None,
            inscripcion=None,
            partida=partida,
            doc_tramite_id=doc_tramite_num,
            pdf_bytes_override=content,
        )
    _cachear_comparacion_titular(clave_catastral, comparacion)

    return StreamingResponse(
        BytesIO(content),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-RPPC-Source": source,
        },
    )


def _resolver_documento_por_folio(folio_real: int, clave_catastral: str | None = None):
    cache = _cache_rppc_por_clave_o_folio(
        clave_catastral=clave_catastral,
        folio_real=folio_real,
    )
    if cache:
        doc_cache = _normalizar_numero(cache.get("rppc_doc_tramite_id"))
        partida_cache = _normalizar_numero(cache.get("rppc_partida"))
        folio_cache = _normalizar_numero(cache.get("folio_real")) or folio_real
        if doc_cache:
            return _adjuntar_comparacion_titular(
                {
                "folio_real": folio_cache,
                "partida": partida_cache,
                "doc_tramite_id": doc_cache,
                "tipo_documento": "doc_tramite_id",
                "movimiento": None,
                "inscripcion": None,
                "movimientos_total": None,
                "pdf_url": f"/rppc/pdf/doc/{doc_cache}",
                "cache_hit": True,
                },
                clave_catastral,
                folio_cache,
            )
        if partida_cache:
            return _adjuntar_comparacion_titular(
                {
                "folio_real": folio_cache,
                "partida": partida_cache,
                "doc_tramite_id": None,
                "tipo_documento": "hoja_inscripcion_partida",
                "movimiento": None,
                "inscripcion": {"PARTIDA": partida_cache, "MODO": "HOJA_INSCRIPCION_PARTIDA_CACHE"},
                "movimientos_total": None,
                "pdf_url": f"/rppc/pdf/partida/{partida_cache}",
                "cache_hit": True,
                },
                clave_catastral,
                folio_cache,
            )

    partida, movimiento, movimientos = _obtener_partida_por_folio(folio_real)
    try:
        doc_id, inscripcion = _obtener_doc_id_por_partida(partida)
        tipo_documento = "doc_tramite_id"
        pdf_url = f"/rppc/pdf/doc/{doc_id}"
    except HTTPException as exc:
        # Fallback para inscripciones antiguas: obtenerInscripcionesPart puede venir
        # vacío o sin DOC_TRAMITE_ID, pero el RPPC sí genera PDF por PARTIDA
        # (ReporteVerHojaInscFr / obtienepdfinscripcion).
        if exc.status_code != 404:
            raise
        doc_id = None
        inscripcion = {
            "PARTIDA": partida,
            "DOC_TRAMITE_ID": None,
            "MODO": "HOJA_INSCRIPCION_PARTIDA",
            "detalle": str(exc.detail),
        }
        tipo_documento = "hoja_inscripcion_partida"
        pdf_url = f"/rppc/pdf/partida/{partida}"

    _guardar_cache_rppc_en_padron(
        clave_catastral=clave_catastral,
        folio_real=folio_real,
        partida=partida,
        doc_tramite_id=doc_id,
        fuente="RPPC",
    )

    return _adjuntar_comparacion_titular(
        {
        "folio_real": folio_real,
        "partida": partida,
        "doc_tramite_id": doc_id,
        "tipo_documento": tipo_documento,
        "movimiento": movimiento,
        "inscripcion": inscripcion,
        "movimientos_total": len(movimientos),
        "pdf_url": pdf_url,
        "cache_hit": False,
        },
        clave_catastral,
        folio_real,
    )


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
        "rppc_usuario_id_config": RPPC_USUARIO_ID,
        "rppc_usuario_id_activo": RPPC_USUARIO_ID,
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

        url_inm = _url_api_desde_ruta(
            RPPC_BASE_URL,
            "Servicios/ConsultaAvanzada/consultaInmuebles",
            solo_base=True,
        )
        payload_inm = _payload_consulta_inmuebles_rppc(
            _payload_inmuebles_ubicacion_rppc("701", colonia_id=1342, clasificacion="L"),
        )
        probe_inm = _probe_post_url(opener, url_inm, payload_inm)
        probe_inm["tipo"] = "consulta_inmuebles_tijuana"
        probe_inm["payload"] = payload_inm
        resultado["consulta_inmuebles_tijuana"] = probe_inm
        resultado["rppc_usuario_id_activo"] = (
            _rppc_usuario_id or RPPC_USUARIO_ID or payload_inm.get("USUARIO_ID")
        )
        if (
            not probe_inm.get("ok")
            and resultado.get("rppc_cookie_configurada")
        ):
            resultado["siguiente_paso"] = (
                "Cookie RPPC configurada pero consultaInmuebles falló. "
                "Renueve .runtime/rppc_cookie.txt desde F12 (.AspNet.ApplicationCookie) "
                "con sesión activa en el portal RPPC."
            )

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
def renovar_sesion_rppc(usuario_actual: dict = Depends(requerir_pestana_rppc)):
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
    rapido: bool = Query(False, description="Solo cookie + consultaInmuebles Tijuana (701/1342)"),
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    if rapido:
        return _probar_consulta_inmuebles_rapida()
    try:
        return _probar_conexion_rppc(folio_prueba)
    except Exception as exc:
        logger.exception("diagnostico RPPC falló")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _probar_consulta_inmuebles_rapida(
    manzana: str = "701",
    colonia: int = 1342,
) -> dict[str, Any]:
    """Prueba ligera: preflight + consultaInmuebles (sin escaneo portal)."""
    cookie = _cookie_rppc_actual()
    cookie_diag = _diagnostico_cookie_rppc(cookie)
    cookie_valida = _cookie_rppc_valida(cookie)
    resp: dict[str, Any] = {
        "modo": "rapido",
        "cookie_file": RPPC_RUNTIME_COOKIE_FILE,
        "rppc_cookie_configurada": cookie_valida,
        "cookie_diagnostico": cookie_diag,
        "cookie_manual": _usar_cookie_rppc_manual(),
        "csrf_token": bool(_extraer_request_verification_token(cookie)),
        "rppc_usuario_id_config": RPPC_USUARIO_ID,
        "payload": None,
        "body_enviado": None,
        "ok": False,
        "http": None,
        "total": 0,
        "preview": None,
        "intentos": [],
        "error": None,
    }
    if not cookie_valida:
        resp["error"] = (
            "Cookie RPPC inválida o incompleta: falta .AspNet.ApplicationCookie. "
            f"Archivo {RPPC_RUNTIME_COOKIE_FILE} tiene {cookie_diag.get('longitud', 0)} caracteres "
            f"(se recomiendan ≥{cookie_diag.get('min_recomendado', 400)}). "
            "Copie la cookie completa desde F12 (Application → Cookies → rppcweb.ebajacalifornia.gob.mx) "
            "o ejecute: ./venv/bin/python3 rppc_renovar_cookie.py"
        )
        return resp
    try:
        _marcar_sesion_consulta_rppc_nueva()
        opener = _preparar_sesion_consulta_rppc(force=True)
        url = _url_api_desde_ruta(
            RPPC_BASE_URL,
            "Servicios/ConsultaAvanzada/consultaInmuebles",
            solo_base=True,
        )
        bases = [
            _payload_inmuebles_ubicacion_rppc(manzana, colonia_id=colonia, clasificacion="L", buscar="D"),
            _payload_inmuebles_ubicacion_rppc(manzana, colonia_id=colonia, clasificacion="L", buscar="U"),
        ]
        for payload in bases:
            for body_payload in _variantes_body_consulta_inmuebles_rppc(payload):
                http, body = _ejecutar_post_rppc_json(opener, url, body_payload)
                parsed: Any = {}
                if body.lstrip().startswith("{"):
                    try:
                        parsed = json.loads(body)
                    except json.JSONDecodeError:
                        parsed = {}
                intento = {
                    "payload": payload,
                    "body_enviado": body_payload,
                    "http": http,
                    "ok": _respuesta_rppc_exitosa(http, body),
                    "preview": body[:200],
                }
                resp["intentos"].append(intento)
                resp["payload"] = payload
                resp["body_enviado"] = body_payload
                resp["http"] = http
                resp["preview"] = body[:200]
                if http < 400 and not (isinstance(parsed, dict) and _rppc_tiene_error(parsed)):
                    datos = _parsear_datos_rppc(body)
                    resp["total"] = len(datos)
                    if datos:
                        resp["ok"] = True
                        resp["muestra"] = datos[:2]
                        break
                if intento["ok"]:
                    datos = _parsear_datos_rppc(body)
                    resp["total"] = len(datos)
                    resp["ok"] = True
                    resp["muestra"] = datos[:2]
                    break
            if resp["ok"]:
                break
    except HTTPException as exc:
        resp["error"] = str(exc.detail)
    except Exception as exc:
        resp["error"] = str(exc)
    if not resp["ok"] and cookie_valida:
        preview = str(resp.get("preview") or "")
        if resp.get("http") == 400 or "Object reference not set" in preview:
            resp["cookie_expirada"] = True
            resp["error"] = (
                "Cookie RPPC expirada o sesión cerrada en el portal (HTTP 400). "
                f"Renueve {RPPC_RUNTIME_COOKIE_FILE} desde F12 (.AspNet.ApplicationCookie) "
                "con sesión activa en rppcweb, o ejecute: ./venv/bin/python3 rppc_renovar_cookie.py"
            )
    return resp


@router.get("/consulta-prueba")
def consulta_prueba_rppc(
    manzana: str = Query("701"),
    colonia: int = Query(1342),
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    """Atajo de prueba: consultaInmuebles por manzana/colonia."""
    return _probar_consulta_inmuebles_rapida(manzana=manzana, colonia=colonia)


@router.get("/movimientos/folio/{folio_real}")
def movimientos_por_folio(
    folio_real: int,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
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
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    return _resolver_documento_por_folio(folio_real)


@router.get("/inmuebles/clave/{clave_catastral}")
def inmuebles_por_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    clave = _normalizar_clave(clave_catastral)
    try:
        cascada = _consultar_inmuebles_rppc_por_clave_cascada(clave)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error en cascada RPPC clave=%s", clave)
        raise HTTPException(status_code=500, detail=f"Error consultando RPPC: {exc}") from exc

    inmuebles = [
        x for x in (cascada.get("inmuebles") or [])
        if _es_item_inmueble_rppc(x)
    ]
    metodo = cascada.get("metodo") or "clave"
    datos_padron = cascada.get("datos_padron") or _datos_padron_busqueda_rppc(clave)
    variantes_resp = datos_padron.get("variantes_unidad") or cascada.get("variantes_unidad") or []
    if metodo == "unidad":
        inmuebles = _preparar_candidatos_unidad_rppc(
            inmuebles,
            datos_padron,
            variantes_resp,
            limite=8,
        )
        elegido = cascada.get("inmueble_elegido")
        if elegido and not _coincide_unidad_local_en_inmueble(elegido, variantes_resp):
            elegido = None
        elegido = elegido or _seleccionar_inmueble_unidad_rppc(inmuebles, datos_padron)
    elif metodo == "folio":
        elegido = cascada.get("inmueble_elegido") or _seleccionar_inmueble_unidad_rppc(
            inmuebles, datos_padron
        ) or _seleccionar_mejor_inmueble_rppc(inmuebles)
    elif metodo == "ubicacion":
        elegido = cascada.get("inmueble_elegido") or _seleccionar_inmueble_ubicacion_rppc(
            inmuebles, datos_padron
        )
    else:
        elegido = cascada.get("inmueble_elegido") or _seleccionar_mejor_inmueble_rppc(inmuebles)

    inmuebles_resp, truncados = _truncar_inmuebles_para_respuesta(inmuebles)
    datos_resumen = {
        k: datos_padron[k]
        for k in (
            "clave_catastral",
            "colonia",
            "manzana",
            "lote",
            "unidad",
            "numint",
            "unidad_rppc",
            "condominio",
            "nom_condominio",
            "nombre_condominio",
            "rppc_colonia_id",
            "variantes_unidad",
        )
        if datos_padron.get(k) not in (None, "")
    }
    folio_elegido = _extraer_folio_real_rppc(elegido) if elegido else None
    if folio_elegido and elegido and (
        metodo == "folio"
        or _coincide_unidad_local_en_inmueble(elegido, variantes_resp)
        or _puntuar_colonia_unidad_rppc(elegido, datos_padron) >= 30
    ):
        _guardar_folio_real_en_padron(
            clave,
            folio_elegido,
            fuente=f"RPPC_{str(metodo or 'clave').upper()}",
        )

    resp: dict[str, Any] = {
        "clave_catastral": clave,
        "clave_rppc": _clave_sgc_a_rppc(clave),
        "metodo_busqueda": metodo,
        "payload_rppc": cascada.get("payload"),
        "variantes_unidad": cascada.get("variantes_unidad") or datos_padron.get("variantes_unidad"),
        "rppc_municipio_id": RPPC_MUNICIPIO_ID,
        "rppc_localidad_id": RPPC_LOCALIDAD_ID,
        "datos_padron": datos_resumen,
        "total": len(inmuebles),
        "inmuebles_truncados": truncados,
        "inmuebles_limite": RPPC_INMUEBLES_RESPUESTA_MAX if truncados else len(inmuebles),
        "folio_elegido": folio_elegido,
        "inmueble_elegido": elegido,
        "inmuebles": inmuebles_resp,
        "resolver_unidad_version": "2026-07-05-v6",
    }
    if cascada.get("detalle"):
        resp["detalle"] = cascada.get("detalle")
    if not inmuebles and _rppc_last_consulta_error:
        resp["rppc_ultimo_error"] = _rppc_last_consulta_error
    if not inmuebles and _rppc_last_unidad_debug:
        resp["unidad_debug"] = _rppc_last_unidad_debug
    return resp
def inmuebles_por_ubicacion(
    manzana: str = Query(..., min_length=1, max_length=10),
    colonia: int | None = Query(None, description="ID colonia RPPC (ej. 1342 Villa Residencial Santa Fe II)"),
    descr: str = Query(""),
    clasificacion: str = Query("L"),
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    """Consulta RPPC por ubicación (BUSCAR=D) con MUNICIPIO Tijuana = 2."""
    datos = _consultar_inmuebles_rppc_por_ubicacion(
        manzana,
        colonia_id=colonia,
        descr=descr,
        clasificacion=clasificacion,
    )
    inmuebles, truncados = _truncar_inmuebles_para_respuesta(datos)
    return {
        "metodo_busqueda": "ubicacion",
        "payload_rppc": _payload_inmuebles_ubicacion_rppc(
            manzana,
            colonia_id=colonia,
            descr=descr,
            clasificacion=clasificacion,
        ),
        "rppc_municipio_id": RPPC_MUNICIPIO_ID,
        "rppc_localidad_id": RPPC_LOCALIDAD_ID,
        "total": len(datos),
        "inmuebles_truncados": truncados,
        "inmuebles_limite": RPPC_INMUEBLES_RESPUESTA_MAX if truncados else len(datos),
        "inmuebles": inmuebles,
    }


@router.get("/inmuebles/unidad")
def inmuebles_por_unidad_local(
    manzana: str = Query(..., min_length=1, max_length=10),
    unidad: str = Query(..., min_length=1, max_length=40, description="Unidad/LOCAL, ej. C-41 o LOCAL C-41"),
    colonia: int | None = Query(None, description="ID colonia RPPC del fraccionamiento"),
    colonia_nombre: str = Query("", max_length=120),
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    """Consulta RPPC por unidad/LOCAL (CLASIFICACION=U) — ej. LOCAL C-41 → folio 1332703."""
    variantes = _variantes_unidad_rppc({"unidad": unidad, "numero_interior": unidad})
    datos, payload = _consultar_inmuebles_rppc_por_unidad_local(
        manzana,
        variantes,
        colonia_id=colonia,
        colonia_nombre=colonia_nombre,
    )
    datos = [x for x in datos if _es_item_inmueble_rppc(x)]
    elegido = _seleccionar_inmueble_unidad_rppc(datos, {"variantes_unidad": variantes, "unidad": unidad})
    inmuebles, truncados = _truncar_inmuebles_para_respuesta(datos)
    resp: dict[str, Any] = {
        "metodo_busqueda": "unidad",
        "payload_rppc": payload,
        "variantes_unidad": variantes,
        "rppc_municipio_id": RPPC_MUNICIPIO_ID,
        "rppc_localidad_id": RPPC_LOCALIDAD_ID,
        "total": len(datos),
        "inmuebles_truncados": truncados,
        "inmuebles_limite": RPPC_INMUEBLES_RESPUESTA_MAX if truncados else len(datos),
        "folio_elegido": _extraer_folio_real_rppc(elegido) if elegido else None,
        "inmueble_elegido": elegido,
        "inmuebles": inmuebles,
    }
    if not datos and _rppc_last_consulta_error:
        resp["rppc_ultimo_error"] = _rppc_last_consulta_error
    if not datos and _rppc_last_unidad_debug:
        resp["unidad_debug"] = _rppc_last_unidad_debug
    if not datos:
        resp["rppc_cookie_configurada"] = bool(_cookie_rppc_actual())
        resp["sugerencia"] = (
            "Si total=0, renueve .runtime/rppc_cookie.txt desde el portal RPPC (F12) "
            "o ejecute GET /rppc/diagnostico y revise consulta_inmuebles_tijuana.ok"
        )
    return resp


@router.get("/resolver/clave/{clave_catastral}")
def resolver_por_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    clave = _normalizar_clave(clave_catastral)
    folio_real = _obtener_folio_por_clave(clave)
    data = _resolver_documento_por_folio(folio_real, clave_catastral=clave)
    data["clave_catastral"] = clave
    data["clave_rppc"] = _clave_sgc_a_rppc(clave)

    # Si el documento es Hoja de Inscripción por partida, agregamos la clave
    # como query string para que /pdf/partida pueda guardar PDF local y, si es
    # necesario, extraer/registrar el FOLIO REAL visible dentro del PDF.
    if not data.get("doc_tramite_id") and data.get("pdf_url") and data.get("partida"):
        sep = "&" if "?" in str(data["pdf_url"]) else "?"
        data["pdf_url"] = f"{data['pdf_url']}{sep}clave_catastral={urllib.parse.quote(clave)}"

    return data


@router.post("/precalcular/clave/{clave_catastral}")
def precalcular_rppc_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    """Precalcula en segundo plano la comparación titular RPPC al consultar un predio."""
    clave = _normalizar_clave(clave_catastral)
    if not clave:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    rapido = _leer_comparacion_titular_cache_rapido(clave)
    if rapido:
        return {"estado": "listo", "comparacion_titular": rapido}

    if not _rppc_precalc_activo(clave):
        _rppc_precalc_executor.submit(_precalcular_rppc_wrapper, clave)
    return _rppc_respuesta_procesando()


@router.get("/comparar-titular/clave/{clave_catastral}")
def comparar_titular_por_clave(
    clave_catastral: str,
    recalcular: bool = False,
    solo_cache: bool = False,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    """Comparación padrón vs titular RPPC. Usa cache en BD salvo ?recalcular=true."""
    return _comparar_titular_clave_recalcular(
        _normalizar_clave(clave_catastral),
        forzar=recalcular,
        solo_cache=solo_cache,
    )


@router.get("/pdf/doc/{doc_tramite_id}")
def pdf_por_doc(doc_tramite_id: int, usuario_actual: dict = Depends(requerir_pestana_rppc)):
    return _stream_pdf(doc_tramite_id, f"rppc_doc_{doc_tramite_id}.pdf")


@router.get("/pdf/partida/{partida}")
def pdf_por_partida(
    partida: int,
    clave_catastral: str | None = None,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    clave = _normalizar_clave(clave_catastral or "") or None
    return _stream_pdf(
        f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}",
        f"rppc_partida_{partida}.pdf",
        partida=partida,
        clave_catastral=clave,
    )


@router.get("/pdf/folio/{folio_real}")
def pdf_por_folio(folio_real: int, usuario_actual: dict = Depends(requerir_pestana_rppc)):
    data = _resolver_documento_por_folio(folio_real)
    if data.get("doc_tramite_id"):
        doc_ref = data["doc_tramite_id"]
    else:
        doc_ref = f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{data.get('partida')}"
    return _stream_pdf(
        doc_ref,
        f"rppc_folio_{folio_real}.pdf",
        partida=data.get("partida"),
        folio_real=folio_real,
    )


@router.get("/pdf/clave/{clave_catastral}")
def pdf_por_clave(
    clave_catastral: str,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    clave = _normalizar_clave(clave_catastral)
    folio_real = _obtener_folio_por_clave(clave)
    data = _resolver_documento_por_folio(folio_real, clave_catastral=clave)
    clave_limpia = re.sub(r"[^A-Za-z0-9_-]", "_", clave)
    if data.get("doc_tramite_id"):
        doc_ref = data["doc_tramite_id"]
    else:
        doc_ref = f"{RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{data.get('partida')}"
    return _stream_pdf(
        doc_ref,
        f"rppc_{clave_limpia}.pdf",
        partida=data.get("partida"),
        clave_catastral=clave,
        folio_real=folio_real,
    )


@router.get("/visor/pdf/doc/{doc_tramite_id}")
def visor_pdf_por_doc(
    doc_tramite_id: int,
    clave_catastral: str | None = None,
    usuario_actual: dict = Depends(requerir_pestana_rppc),
):
    clave = _normalizar_clave(clave_catastral or "") or None
    return _stream_pdf(
        doc_tramite_id,
        f"rppc_doc_{doc_tramite_id}.pdf",
        clave_catastral=clave,
    )


class RppcBackfillLotePayload(BaseModel):
    limite: int = Field(100, ge=1, le=5000)
    nivel: Literal["folio", "resolver", "pdf"] = "folio"
    pausa_seg: float = Field(2.0, ge=0.0, le=60.0)
    reintentar_errores: bool = False
    prefijos: list[str] = Field(default_factory=list)
    manzana: str | None = None
    colonia_like: str | None = None
    solo_condominio: bool = False
    solo_unidades: bool = False
    claves: list[str] | None = None


@router.get("/backfill/resumen")
def rppc_backfill_resumen(usuario_actual: dict = Depends(requerir_roles("admin"))):
    """Conteo del padrón elegible: con folio, pendientes y errores RPPC."""
    from services.rppc_backfill_masivo import resumen_padron_rppc

    return resumen_padron_rppc()


@router.get("/backfill/estado")
def rppc_backfill_estado(usuario_actual: dict = Depends(requerir_roles("admin"))):
    from services.rppc_backfill_masivo import obtener_estado_backfill

    return obtener_estado_backfill()


@router.post("/backfill/lote")
def rppc_backfill_iniciar_lote(
    payload: RppcBackfillLotePayload,
    usuario_actual: dict = Depends(requerir_roles("admin")),
):
    """Inicia en segundo plano un lote de backfill RPPC sobre el padrón (sin filtros = todo Tijuana)."""
    from services.rppc_backfill_masivo import BackfillLoteConfig, RppcBackfillError, iniciar_backfill_lote

    cfg = BackfillLoteConfig(
        limite=payload.limite,
        nivel=payload.nivel,
        pausa_seg=payload.pausa_seg,
        reintentar_errores=payload.reintentar_errores,
        prefijos=[p.strip().upper() for p in payload.prefijos if p.strip()],
        manzana=payload.manzana,
        colonia_like=payload.colonia_like,
        solo_condominio=payload.solo_condominio,
        solo_unidades=payload.solo_unidades,
        claves=payload.claves,
    )
    try:
        return iniciar_backfill_lote(cfg)
    except RppcBackfillError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/backfill/detener")
def rppc_backfill_detener(usuario_actual: dict = Depends(requerir_roles("admin"))):
    from services.rppc_backfill_masivo import detener_backfill

    return detener_backfill()
