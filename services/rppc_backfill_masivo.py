"""Backfill masivo RPPC en backend (todo el padrón Tijuana, por lotes).

Invoca directamente routers.rppc (sin HTTP) para resolver folio_real, partida y PDF.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import APP_DIR
from database import get_conn

logger = logging.getLogger("catastro-tijuana-api")


class RppcBackfillError(Exception):
    """Error de negocio del backfill (sin depender de FastAPI)."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = int(status_code)
        self.detail = str(detail)
        super().__init__(self.detail)


def _relanzar_backfill(exc: Exception) -> None:
    if isinstance(exc, RppcBackfillError):
        raise exc
    status = getattr(exc, "status_code", None)
    if status is not None:
        detail = getattr(exc, "detail", str(exc))
        raise RppcBackfillError(int(status), str(detail)) from exc
    raise exc

RE_CLAVE_PADRON = re.compile(r"^[A-Z]{2,3}[0-9]{6}$")

ESTADOS_ERROR = (
    "RPPC_SIN_FOLIO",
    "RPPC_SIN_DOC",
    "RPPC_ERROR",
    "RPPC_PDF_SIN_FOLIO",
    "RPPC_NO_JSON",
    "RPPC_COOKIE_EXPIRADA",
    "RPPC_BAJA_CONFIANZA",
)

DEFAULT_LOG = os.getenv(
    "RPPC_BACKFILL_LOG",
    str(Path(APP_DIR) / ".runtime" / "rppc_backfill.jsonl"),
)
LOCK_FILE = Path(os.getenv("RPPC_BACKFILL_LOCK", str(Path(APP_DIR) / ".runtime" / "rppc_backfill.lock")))

_backfill_lock = threading.Lock()
_backfill_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rppc-backfill")
_backfill_state: dict[str, Any] = {
    "activo": False,
    "detener": False,
    "inicio": None,
    "fin": None,
    "limite_lote": 0,
    "nivel": "folio",
    "pausa_seg": 2.0,
    "procesadas": 0,
    "ok": 0,
    "fail": 0,
    "ultima_clave": None,
    "ultimo_resultado": None,
    "ultimo_error": None,
    "cookie_ok": None,
}


@dataclass
class BackfillLoteConfig:
    limite: int = 100
    nivel: str = "folio"  # folio | resolver | pdf
    pausa_seg: float = 2.0
    reintentar_errores: bool = False
    prefijos: list[str] = field(default_factory=list)
    manzana: str | None = None
    colonia_like: str | None = None
    solo_condominio: bool = False
    solo_unidades: bool = False
    claves: list[str] | None = None
    log_path: str | None = DEFAULT_LOG


def _modulo_rppc():
    from routers import rppc as m

    return m


def _adquirir_lock_proceso() -> None:
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    if LOCK_FILE.exists():
        try:
            otro_pid = int(LOCK_FILE.read_text(encoding="utf-8").strip().splitlines()[0])
        except (ValueError, OSError):
            otro_pid = None
        raise RuntimeError(
            f"Backfill RPPC ya en curso (lock {LOCK_FILE}, pid={otro_pid or '?'}). "
            "Espere o elimine el lock si el proceso anterior terminó mal."
        )
    LOCK_FILE.write_text(f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n", encoding="utf-8")


def _liberar_lock_proceso() -> None:
    try:
        if LOCK_FILE.exists():
            LOCK_FILE.unlink()
    except OSError:
        pass


def _normalizar_clave(raw: str) -> str:
    return re.sub(r"\s+", "", str(raw or "").strip().upper())


def _log_evento(ruta: str | None, evento: dict) -> None:
    if not ruta:
        return
    path = Path(ruta)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"ts": datetime.now(timezone.utc).isoformat(), **evento}
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def clasificar_error(detalle: str) -> str:
    d = (detalle or "").lower()
    if "cookie" in d and ("inválida" in d or "invalid" in d or "renueve" in d):
        return "RPPC_COOKIE_EXPIRADA"
    if "doc_tramite_id" in d or "documento para esa partida" in d:
        return "RPPC_SIN_DOC"
    if "confianza baja" in d:
        return "RPPC_BAJA_CONFIANZA"
    if "sin folio" in d or "ninguna trae folio" in d or "folio_real válido" in d or "sin inmuebles" in d:
        return "RPPC_SIN_FOLIO"
    if "no json" in d or "expecting value" in d:
        return "RPPC_NO_JSON"
    return "RPPC_ERROR"


def marcar_estado(clave: str, estado: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE catalogos.padron_2026
                SET folio_real_fuente = %s,
                    folio_real_fecha_actualizacion = now()
                WHERE UPPER(TRIM(clave_catastral)) = %s
                  AND folio_real IS NULL;
                """,
                (estado[:50], clave),
            )
            conn.commit()


def consultar_folio_local(clave: str) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') AS folio_real,
                    NULLIF(TRIM(COALESCE(rppc_partida, '')), '') AS rppc_partida,
                    folio_real_fuente
                FROM catalogos.padron_2026
                WHERE UPPER(TRIM(clave_catastral)) = %s
                LIMIT 1;
                """,
                (clave,),
            )
            return cur.fetchone()


def construir_where_pendientes(cfg: BackfillLoteConfig) -> tuple[str, list[Any]]:
    wheres = [
        "p.clave_catastral IS NOT NULL",
        "TRIM(p.clave_catastral) <> ''",
        "p.clave_catastral ~ '^[A-Z]{2,3}[0-9]{6}$'",
        "LEFT(p.clave_catastral, 2) NOT IN ('A8','A9')",
    ]
    params: list[Any] = []

    if not cfg.reintentar_errores:
        wheres.append("p.folio_real IS NULL")
        wheres.append(
            "COALESCE(p.folio_real_fuente, '') NOT IN ("
            + ",".join(["%s"] * len(ESTADOS_ERROR))
            + ")"
        )
        params.extend(ESTADOS_ERROR)

    if cfg.prefijos:
        wheres.append(
            "(" + " OR ".join(["UPPER(p.clave_catastral) LIKE %s" for _ in cfg.prefijos]) + ")"
        )
        params.extend([f"{p.upper()}%" for p in cfg.prefijos])

    if cfg.manzana:
        wheres.append("TRIM(COALESCE(p.manzana::text, '')) = %s")
        params.append(str(cfg.manzana).strip())

    if cfg.colonia_like:
        wheres.append("UPPER(COALESCE(p.colonia, '')) LIKE %s")
        params.append(str(cfg.colonia_like).strip().upper())

    if cfg.solo_condominio:
        wheres.append(
            """
            (
                UPPER(COALESCE(p.condominio, '')) IN ('C','S','SI','SÍ','CONDOMINIO')
                OR NULLIF(TRIM(COALESCE(p.nom_condominio, '')), '') IS NOT NULL
            )
            """
        )

    if cfg.solo_unidades:
        wheres.append("NULLIF(TRIM(COALESCE(p.numint, '')), '') IS NOT NULL")

    return " AND ".join(wheres), params


def listar_claves_pendientes(cfg: BackfillLoteConfig) -> list[str]:
    if cfg.claves:
        claves = [
            _normalizar_clave(c)
            for c in cfg.claves
            if _normalizar_clave(c) and RE_CLAVE_PADRON.match(_normalizar_clave(c))
        ]
        return claves[: cfg.limite]

    where_sql, params = construir_where_pendientes(cfg)
    params.append(cfg.limite)
    sql = f"""
        SELECT p.clave_catastral
        FROM catalogos.padron_2026 p
        WHERE {where_sql}
        ORDER BY p.clave_catastral
        LIMIT %s;
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return [_normalizar_clave(r["clave_catastral"]) for r in cur.fetchall()]


def resumen_padron_rppc() -> dict[str, Any]:
    where_base = """
        clave_catastral IS NOT NULL
        AND TRIM(clave_catastral) <> ''
        AND clave_catastral ~ '^[A-Z]{2,3}[0-9]{6}$'
        AND LEFT(clave_catastral, 2) NOT IN ('A8','A9')
    """
    estados_sql = ",".join(["%s"] * len(ESTADOS_ERROR))
    sql = f"""
        SELECT
            COUNT(*)::int AS total_elegibles,
            COUNT(*) FILTER (
                WHERE NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') IS NOT NULL
            )::int AS con_folio,
            COUNT(*) FILTER (
                WHERE folio_real IS NULL
                  AND COALESCE(folio_real_fuente, '') NOT IN ({estados_sql})
            )::int AS pendientes,
            COUNT(*) FILTER (
                WHERE folio_real IS NULL
                  AND COALESCE(folio_real_fuente, '') IN ({estados_sql})
            )::int AS marcados_error
        FROM catalogos.padron_2026
        WHERE {where_base};
    """
    params = list(ESTADOS_ERROR) * 2
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            row = cur.fetchone() or {}

    total = int(row.get("total_elegibles") or 0)
    con_folio = int(row.get("con_folio") or 0)
    pendientes = int(row.get("pendientes") or 0)
    marcados_error = int(row.get("marcados_error") or 0)
    return {
        "total_elegibles": total,
        "con_folio": con_folio,
        "pendientes": pendientes,
        "marcados_error": marcados_error,
        "porcentaje_con_folio": round((con_folio / total) * 100, 2) if total else 0.0,
        "estados_error": list(ESTADOS_ERROR),
    }


def _descargar_pdf_backfill(rppc, clave: str, data: dict[str, Any]) -> tuple[bool, str]:
    partida = data.get("partida")
    doc_id = data.get("doc_tramite_id")
    pdf_bytes = rppc._obtener_bytes_pdf_rppc_para_lectura(
        doc_tramite_id=doc_id,
        partida=partida,
        clave_catastral=clave,
    )
    if pdf_bytes and pdf_bytes.startswith(b"%PDF"):
        if doc_id:
            rppc._guardar_pdf_local(doc_id, pdf_bytes, clave)
        elif partida:
            rppc._guardar_pdf_local(f"{rppc.RPPC_HOJA_INSCRIPCION_DOC_PREFIX}{partida}", pdf_bytes, clave)
        return True, "PDF cacheado"
    return False, "No se pudo cachear PDF"


def procesar_clave_backfill(clave: str, nivel: str) -> dict[str, Any]:
    rppc = _modulo_rppc()
    clave = _normalizar_clave(clave)
    if not clave:
        raise RppcBackfillError(400, "Clave inválida")

    if not rppc._cookie_rppc_valida(rppc._cookie_rppc_actual()):
        raise RppcBackfillError(502, "Cookie RPPC inválida. Renueve .runtime/rppc_cookie.txt")

    try:
        desc = rppc.descubrir_folio_rppc(clave, persistir=True)
    except Exception as exc:
        _relanzar_backfill(exc)

    if not desc.get("ok"):
        raise RppcBackfillError(404, desc.get("error") or "RPPC no devolvió folio")

    folio = int(desc["folio_real"])
    resultado: dict[str, Any] = {
        "clave_catastral": clave,
        "folio_real": folio,
        "nivel": nivel,
        "ok": True,
        "metodo_descubrimiento": desc.get("metodo"),
        "confianza": desc.get("confianza"),
        "cve_cat": desc.get("cve_cat"),
        "total_candidatos": desc.get("total_candidatos"),
    }

    if nivel == "folio":
        return resultado

    try:
        data = rppc._resolver_documento_por_folio(folio, clave_catastral=clave)
    except Exception as exc:
        _relanzar_backfill(exc)
    resultado.update(
        {
            "partida": data.get("partida"),
            "doc_tramite_id": data.get("doc_tramite_id"),
            "tipo_documento": data.get("tipo_documento"),
            "pdf_url": data.get("pdf_url"),
        }
    )

    if nivel == "pdf":
        ok_pdf, msg_pdf = _descargar_pdf_backfill(rppc, clave, data)
        resultado["pdf_cacheado"] = ok_pdf
        resultado["pdf_msg"] = msg_pdf
        if not ok_pdf:
            resultado["ok"] = False

    return resultado


def _actualizar_estado(**kwargs) -> None:
    with _backfill_lock:
        _backfill_state.update(kwargs)


def obtener_estado_backfill() -> dict[str, Any]:
    with _backfill_lock:
        estado = dict(_backfill_state)
    estado["resumen_padron"] = resumen_padron_rppc()
    return estado


def detener_backfill() -> dict[str, Any]:
    with _backfill_lock:
        if not _backfill_state.get("activo"):
            return {"detenido": False, "mensaje": "No hay backfill activo"}
        _backfill_state["detener"] = True
    return {"detenido": True, "mensaje": "Se solicitó detener tras la clave en curso"}


def _ejecutar_lote_worker(cfg: BackfillLoteConfig) -> None:
    rppc = _modulo_rppc()
    claves = listar_claves_pendientes(cfg)
    _actualizar_estado(
        limite_lote=cfg.limite,
        nivel=cfg.nivel,
        pausa_seg=cfg.pausa_seg,
        procesadas=0,
        ok=0,
        fail=0,
        ultima_clave=None,
        ultimo_resultado=None,
        ultimo_error=None,
    )

    try:
        _adquirir_lock_proceso()
    except RuntimeError as exc:
        _actualizar_estado(activo=False, ultimo_error=str(exc), fin=datetime.now(timezone.utc).isoformat())
        return

    try:
        cookie_ok = rppc._cookie_rppc_valida(rppc._cookie_rppc_actual())
        _actualizar_estado(cookie_ok=cookie_ok)
        if not cookie_ok:
            _actualizar_estado(
                ultimo_error="Cookie RPPC inválida al iniciar lote",
                activo=False,
                fin=datetime.now(timezone.utc).isoformat(),
            )
            return

        for i, clave in enumerate(claves, start=1):
            with _backfill_lock:
                if _backfill_state.get("detener"):
                    break

            meta: dict[str, Any] = {"clave": clave, "indice": i, "total_lote": len(claves)}
            try:
                resultado = procesar_clave_backfill(clave, cfg.nivel)
                meta.update(resultado)
                meta["resultado"] = "OK"
                with _backfill_lock:
                    _backfill_state["ok"] += 1
                    _backfill_state["ultimo_resultado"] = resultado
                    _backfill_state["ultimo_error"] = None
            except RppcBackfillError as exc:
                detalle = str(exc.detail)
                estado = clasificar_error(detalle)
                meta.update(
                    {
                        "ok": False,
                        "http": exc.status_code,
                        "detalle": detalle,
                        "estado": estado,
                        "resultado": "FAIL",
                    }
                )
                row = consultar_folio_local(clave)
                if not (row or {}).get("folio_real"):
                    marcar_estado(clave, estado)
                with _backfill_lock:
                    _backfill_state["fail"] += 1
                    _backfill_state["ultimo_error"] = detalle
                    _backfill_state["ultimo_resultado"] = meta
                if estado == "RPPC_COOKIE_EXPIRADA":
                    _actualizar_estado(cookie_ok=False)
                    break
            except Exception as exc:
                detalle = str(exc)
                meta.update({"ok": False, "detalle": detalle, "estado": "RPPC_ERROR", "resultado": "FAIL"})
                marcar_estado(clave, "RPPC_ERROR")
                with _backfill_lock:
                    _backfill_state["fail"] += 1
                    _backfill_state["ultimo_error"] = detalle
                    _backfill_state["ultimo_resultado"] = meta
                logger.exception("Backfill RPPC falló clave=%s", clave)

            with _backfill_lock:
                _backfill_state["procesadas"] = i
                _backfill_state["ultima_clave"] = clave
            _log_evento(cfg.log_path, meta)

            if i < len(claves) and cfg.pausa_seg > 0:
                time.sleep(cfg.pausa_seg)
    finally:
        _liberar_lock_proceso()
        _actualizar_estado(
            activo=False,
            fin=datetime.now(timezone.utc).isoformat(),
        )


def iniciar_backfill_lote(cfg: BackfillLoteConfig) -> dict[str, Any]:
    if cfg.nivel not in ("folio", "resolver", "pdf"):
        raise RppcBackfillError(400, "nivel debe ser folio, resolver o pdf")
    if cfg.limite < 1 or cfg.limite > 5000:
        raise RppcBackfillError(400, "limite debe estar entre 1 y 5000")

    with _backfill_lock:
        if _backfill_state.get("activo"):
            raise RppcBackfillError(409, "Ya hay un backfill RPPC en curso")

        _backfill_state.update(
            {
                "activo": True,
                "detener": False,
                "inicio": datetime.now(timezone.utc).isoformat(),
                "fin": None,
            }
        )

    claves_preview = listar_claves_pendientes(cfg)
    _backfill_executor.submit(_ejecutar_lote_worker, cfg)

    return {
        "estado": "iniciado",
        "claves_en_lote": len(claves_preview),
        "primera_clave": claves_preview[0] if claves_preview else None,
        "config": {
            "limite": cfg.limite,
            "nivel": cfg.nivel,
            "pausa_seg": cfg.pausa_seg,
            "reintentar_errores": cfg.reintentar_errores,
            "filtros": {
                "prefijos": cfg.prefijos or None,
                "manzana": cfg.manzana,
                "colonia_like": cfg.colonia_like,
                "solo_condominio": cfg.solo_condominio,
                "solo_unidades": cfg.solo_unidades,
            },
        },
        "resumen_padron": resumen_padron_rppc(),
    }


def ejecutar_lote_sincrono(cfg: BackfillLoteConfig) -> dict[str, Any]:
    """Ejecuta un lote en el hilo actual (CLI / cron sin endpoint)."""
    with _backfill_lock:
        if _backfill_state.get("activo"):
            raise RuntimeError("Ya hay un backfill RPPC en curso en este proceso")

        _backfill_state.update(
            {
                "activo": True,
                "detener": False,
                "inicio": datetime.now(timezone.utc).isoformat(),
                "fin": None,
            }
        )

    _ejecutar_lote_worker(cfg)
    return obtener_estado_backfill()
