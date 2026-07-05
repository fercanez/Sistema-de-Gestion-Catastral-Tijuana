"""Router de consulta al padron y predios (busqueda, ficha, mapa)."""
import csv
import io
import json
import re
import urllib.parse
import urllib.request
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from psycopg2.extras import execute_values

from auth.dependencies import obtener_usuario_actual, registrar_auditoria, requerir_permiso, requerir_roles
from auth.permisos_operativos import requerir_pestana_zona_homogenea
from config import GEONODE_PREDIOS_TABLE
from database import get_conn, asegurar_tabla_predio_condominio, asegurar_columna_folio_real_padron
try:
    from routers.pducp_consulta import consultar_pducp_predio
except ImportError:
    def consultar_pducp_predio(*args, **kwargs):
        return {"disponible": False, "mensaje": "Módulo PDUCP no instalado en el servidor."}

try:
    from database import get_geonode_conn
except ImportError:
    get_geonode_conn = None

router = APIRouter(tags=["padron"])


def _tabla_sql_segura(nombre: str) -> str:
    partes = str(nombre or "").strip().split(".")
    if len(partes) not in (1, 2) or not all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", p) for p in partes):
        raise RuntimeError(f"Nombre de tabla cartográfica no válido: {nombre}")
    return ".".join(partes)


PREDIOS_GEO_TABLE_SQL = _tabla_sql_segura(GEONODE_PREDIOS_TABLE)
PREDIOS_GEO_CLAVE_CANDIDATAS = (
    "cve_cat_or",
    "clavecatas",
    "clave_catastral",
    "clavecat",
    "clave_cata",
    "clave",
    "cve_cat",
    "cvecat",
    "cvecatas",
    "cuenta_predial",
    "cuenta",
)
PREDIOS_GEO_GEOM_CANDIDATAS = ("geom", "the_geom", "wkb_geometry")
_PREDIOS_GEO_RESOLUCION_CACHE: dict[str, tuple[str, list[str]] | bool] = {}
_PREDIOS_GEO_SRID_CACHE: dict[str, int] = {}


def _identificador_sql(nombre: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(nombre or "")):
        raise RuntimeError(f"Identificador SQL no válido: {nombre}")
    return '"' + nombre.replace('"', '""') + '"'


def _partes_tabla_predios_geo() -> tuple[str, str]:
    partes = GEONODE_PREDIOS_TABLE.strip().split(".")
    if len(partes) == 1:
        return "public", partes[0]
    return partes[0], partes[1]


def _columnas_tabla_predios_geo(cur) -> set[str]:
    esquema, tabla = _partes_tabla_predios_geo()
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


_CATASTRO_PREDIOS_COLS_CACHE: set[str] | None = None


def _columnas_catastro_predios(cur) -> set[str]:
    """Columnas de catastro.predios (cache por proceso)."""
    global _CATASTRO_PREDIOS_COLS_CACHE
    if _CATASTRO_PREDIOS_COLS_CACHE is not None:
        return _CATASTRO_PREDIOS_COLS_CACHE
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'catastro'
          AND table_name = 'predios';
        """
    )
    _CATASTRO_PREDIOS_COLS_CACHE = {r["column_name"] for r in cur.fetchall()}
    return _CATASTRO_PREDIOS_COLS_CACHE


def _join_cat_colonias_predios_sql(cur, alias_predio: str = "p", alias_col: str = "col") -> str:
    """JOIN a cat_colonias solo si catastro.predios trae colonia_id (Mexicali). Tijuana no."""
    if "colonia_id" in _columnas_catastro_predios(cur):
        return (
            f"LEFT JOIN catalogos.cat_colonias {alias_col} "
            f"ON {alias_predio}.colonia_id = {alias_col}.id"
        )
    return ""


def _expr_colonia_padron_o_catalogo(
    cur,
    *,
    alias_pad: str = "pad",
    alias_col: str = "col",
) -> str:
    """Colonia legible: padrón Tijuana (texto) o cat_colonias vía colonia_id."""
    if "colonia_id" in _columnas_catastro_predios(cur):
        return (
            f"COALESCE(NULLIF(TRIM({alias_pad}.colonia), ''), {alias_col}.nombre_colonia)"
        )
    return f"NULLIF(TRIM({alias_pad}.colonia), '')"


def _expr_colonia_solo_cartografia(cur, *, alias_predio: str = "p", alias_col: str = "col") -> str:
    """Colonia cuando solo existe fila en catastro.predios (sin padrón)."""
    if "colonia_id" in _columnas_catastro_predios(cur):
        return f"{alias_col}.nombre_colonia"
    return "NULL::TEXT"


def _elegir_columna_geometria(cols: set[str]) -> str | None:
    por_lower = {c.lower(): c for c in cols}
    for cand in PREDIOS_GEO_GEOM_CANDIDATAS:
        if cand in por_lower:
            return por_lower[cand]
    return None


def _elegir_columnas_clave(cols: set[str]) -> list[str]:
    por_lower = {c.lower(): c for c in cols}
    elegidas: list[str] = []
    for cand in PREDIOS_GEO_CLAVE_CANDIDATAS:
        col = por_lower.get(cand)
        if col and col not in elegidas:
            elegidas.append(col)
    for col in cols:
        low = col.lower()
        if col in elegidas:
            continue
        if "catas" in low or ("clave" in low and ("cat" in low or "cve" in low)) or low in {"clave", "cuenta", "cuenta_predial"}:
            elegidas.append(col)
    return elegidas[:8]


def _abrir_conexiones_predios_geo():
    if get_geonode_conn is not None:
        yield get_geonode_conn
    yield get_conn


def _resolver_columnas_predios_geo(cur, abrir_conn):
    cache_key = getattr(abrir_conn, "__name__", str(abrir_conn))
    resolucion = _PREDIOS_GEO_RESOLUCION_CACHE.get(cache_key)
    if resolucion is False:
        return None, []
    if resolucion:
        return resolucion

    columnas = _columnas_tabla_predios_geo(cur)
    geom_col = _elegir_columna_geometria(columnas)
    clave_cols = _elegir_columnas_clave(columnas)
    if not geom_col or not clave_cols:
        _PREDIOS_GEO_RESOLUCION_CACHE[cache_key] = False
        return None, []

    _PREDIOS_GEO_RESOLUCION_CACHE[cache_key] = (geom_col, clave_cols)
    return geom_col, clave_cols


def _buscar_geometria_predio_por_clave(clave: str):
    clave_norm = str(clave or "").strip().upper()
    if not clave_norm:
        return None

    for abrir_conn in _abrir_conexiones_predios_geo():
        conn = None
        cur = None
        try:
            conn = abrir_conn()
            cur = conn.cursor()
            geom_col, clave_cols = _resolver_columnas_predios_geo(cur, abrir_conn)
            if not geom_col or not clave_cols:
                continue

            geom_sql = _identificador_sql(geom_col)
            condiciones = []
            params = []
            for col in clave_cols:
                col_sql = _identificador_sql(col)
                condiciones.append(
                    f"""(
                        UPPER(TRIM(g.{col_sql}::text)) = UPPER(TRIM(%s))
                        OR REGEXP_REPLACE(UPPER(TRIM(g.{col_sql}::text)), '[^A-Z0-9]', '', 'g')
                           = REGEXP_REPLACE(UPPER(TRIM(%s)), '[^A-Z0-9]', '', 'g')
                    )"""
                )
                params.extend([clave_norm, clave_norm])

            cur.execute(
                f"""
                SELECT ST_AsGeoJSON(ST_Transform(g.{geom_sql}, 4326))::json AS geometry
                FROM {PREDIOS_GEO_TABLE_SQL} g
                WHERE g.{geom_sql} IS NOT NULL
                  AND ({" OR ".join(condiciones)})
                LIMIT 1;
                """,
                params,
            )
            row = cur.fetchone()
            if row and row.get("geometry"):
                return row["geometry"]
        except Exception:
            continue
        finally:
            try:
                if cur:
                    cur.close()
            except Exception:
                pass
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
    return None


def _buscar_predio_geo_por_punto(lon: float, lat: float):
    for abrir_conn in _abrir_conexiones_predios_geo():
        conn = None
        cur = None
        try:
            conn = abrir_conn()
            cur = conn.cursor()
            geom_col, clave_cols = _resolver_columnas_predios_geo(cur, abrir_conn)
            if not geom_col or not clave_cols:
                continue

            cache_key = getattr(abrir_conn, "__name__", str(abrir_conn))
            geom_sql = _identificador_sql(geom_col)
            clave_expr = "COALESCE(" + ", ".join(
                f"NULLIF(TRIM(g.{_identificador_sql(col)}::text), '')" for col in clave_cols
            ) + ")"

            srid = _PREDIOS_GEO_SRID_CACHE.get(cache_key)
            if not srid:
                cur.execute(
                    f"""
                    SELECT COALESCE(NULLIF(ST_SRID(g.{geom_sql}), 0), 4326) AS srid
                    FROM {PREDIOS_GEO_TABLE_SQL} g
                    WHERE g.{geom_sql} IS NOT NULL
                    LIMIT 1;
                    """
                )
                row_srid = cur.fetchone()
                srid = int(row_srid.get("srid") or 4326) if row_srid else 4326
                _PREDIOS_GEO_SRID_CACHE[cache_key] = srid

            if srid == 4326:
                punto_sql = "ST_SetSRID(ST_Point(%s, %s), 4326)"
                geom_4326_sql = f"g.{geom_sql}"
                tol = 0.00003
            else:
                punto_sql = f"ST_Transform(ST_SetSRID(ST_Point(%s, %s), 4326), {srid})"
                geom_4326_sql = f"ST_Transform(g.{geom_sql}, 4326)"
                tol = 2.0

            cur.execute(
                f"""
                WITH punto AS (
                    SELECT {punto_sql} AS geom
                )
                SELECT
                    {clave_expr} AS clave_catastral,
                    ST_AsGeoJSON({geom_4326_sql})::json AS geometry
                FROM {PREDIOS_GEO_TABLE_SQL} g
                CROSS JOIN punto pt
                WHERE g.{geom_sql} IS NOT NULL
                  AND {clave_expr} IS NOT NULL
                  AND g.{geom_sql} && ST_Expand(pt.geom, %s)
                  AND (
                    ST_Intersects(g.{geom_sql}, pt.geom)
                    OR ST_DWithin(g.{geom_sql}, pt.geom, %s)
                  )
                ORDER BY
                    CASE WHEN ST_Intersects(g.{geom_sql}, pt.geom) THEN 0 ELSE 1 END,
                    ST_Area(g.{geom_sql}) ASC,
                    ST_Distance(g.{geom_sql}, pt.geom) ASC
                LIMIT 1;
                """,
                (lon, lat, tol, tol),
            )
            row = cur.fetchone()
            if row and row.get("clave_catastral") and row.get("geometry"):
                return row
        except Exception:
            continue
        finally:
            try:
                if cur:
                    cur.close()
            except Exception:
                pass
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
    return None


class GeometriaPredioActualizar(BaseModel):
    geometry: dict
    motivo: str | None = None
    procedimiento: str | None = None
    crear_si_ausente: bool = False

# Una fila por predio: padron_2026 + titular principal vigente del catálogo.
#
# IMPORTANTE: se usa la vista catastro.v_titularidad_predio (vista normal, en vivo:
# refleja cambios del catálogo al instante). NO usar un LATERAL correlacionado aquí,
# porque al filtrar/contar sobre los ~441k predios se evalúa por fila y la búsqueda
# por nombre/colonia se vuelve lentísima o expira (timeout) -> el frontend recibe 0.
SQL_SUBQUERY_TITULAR_PRINCIPAL = """
    SELECT DISTINCT ON (UPPER(TRIM(v.clave_catastral)))
        v.clave_catastral,
        v.nombre_visible,
        v.titular_principal,
        v.tipo_titularidad,
        v.porcentaje_propiedad,
        v.id_persona,
        v.tipo_persona,
        v.rfc,
        v.total_titulares,
        v.suma_porcentaje
    FROM catastro.v_titularidad_predio v
    ORDER BY
        UPPER(TRIM(v.clave_catastral)),
        CASE WHEN UPPER(COALESCE(v.tipo_titularidad, '')) = 'PROPIETARIO' THEN 0 ELSE 1 END,
        v.porcentaje_propiedad DESC NULLS LAST
"""

SQL_FROM_PADRON_UNICO = f"""
    FROM catalogos.padron_2026 p
    LEFT JOIN ({SQL_SUBQUERY_TITULAR_PRINCIPAL}) tit
        ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
    LEFT JOIN catastro.predios g
        ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
"""


def _dedupe_filas_padron(rows):
    """Una fila por clave catastral (evita duplicados por copropietarios en la vista)."""
    vistos = {}
    for row in rows or []:
        clave = str(row.get("clave_catastral") or "").strip().upper()
        if not clave:
            continue
        if clave not in vistos:
            vistos[clave] = row
    return list(vistos.values())

SQL_SELECT_PADRON_UNICO = """
    SELECT
        g.id AS predio_id,
        p.clave_catastral,
        COALESCE(
            NULLIF(TRIM(tit.nombre_visible), ''),
            NULLIF(TRIM(tit.titular_principal), ''),
            NULLIF(TRIM(p.nombre_completo), '')
        ) AS nombre_completo,
        p.delegacion,
        p.colonia,
        p.calle,
        p.numof,
        p.zonah AS zona_homogenea,
        p.valor2026,
        p.sup_documental,
        p.id_tasa,
        p.porcentaje_tasa,
        p.condominio,
        p.descripcion_uso,
        NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') AS folio_real,
        CASE WHEN g.id IS NOT NULL AND g.geom IS NOT NULL THEN TRUE ELSE FALSE END AS dibujado
"""


@router.get("/padron/buscar")
def buscar_padron(
    clave: str = Query(..., min_length=1),
    limite: int = Query(100, ge=1, le=5000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        limite = min(max(limite, 1), 5000)
        conn = get_conn()
        cur = conn.cursor()

        cur.execute(f"""
            SELECT COUNT(DISTINCT UPPER(TRIM(p.clave_catastral))) AS total
            {SQL_FROM_PADRON_UNICO}
            WHERE UPPER(p.clave_catastral) LIKE UPPER(%s);
        """, (clave + "%",))
        total_row = cur.fetchone()
        total = total_row["total"] if total_row else 0

        cur.execute(f"""
            {SQL_SELECT_PADRON_UNICO}
            {SQL_FROM_PADRON_UNICO}
            WHERE UPPER(p.clave_catastral) LIKE UPPER(%s)
            ORDER BY p.clave_catastral
            LIMIT %s;
        """, (clave + "%", limite))

        rows = _dedupe_filas_padron(cur.fetchall())
        cur.close()
        conn.close()

        return {
            "clave": clave,
            "total": total,
            "limite": limite,
            "cargados": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/busqueda-avanzada")
def busqueda_avanzada(
    clave: str = Query("", max_length=50),
    nombre: str = Query("", max_length=150),
    colonia: str = Query("", max_length=150),
    calle: str = Query("", max_length=150),
    numero: str = Query("", max_length=50),
    folio_real: str = Query("", max_length=32),
    limite: int = Query(100, ge=1, le=5000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        limite = min(max(limite, 1), 5000)

        clave_stripped = (clave or "").strip()
        colonia_stripped = (colonia or "").strip()
        calle_stripped = (calle or "").strip()
        numero_txt = (numero or "").strip()
        folio_stripped = re.sub(r"\s+", "", str(folio_real or "").strip())
        if folio_stripped.endswith(".0") and folio_stripped[:-2].isdigit():
            folio_stripped = folio_stripped[:-2]

        # Búsqueda por nombre tolerante: cada palabra debe aparecer (en cualquier
        # orden) dentro del titular/razón social. Evita fallos por orden de
        # apellidos, espacios dobles o palabras intermedias.
        nombre_expr = "UPPER(COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo))"
        nombre_tokens = [t for t in (nombre or "").strip().split() if t]
        if nombre_tokens:
            nombre_cond = "(" + " AND ".join([f"{nombre_expr} LIKE UPPER(%s)" for _ in nombre_tokens]) + ")"
            nombre_params = [f"%{t}%" for t in nombre_tokens]
        else:
            nombre_cond = "TRUE"
            nombre_params = []

        conn = get_conn()
        cur = conn.cursor()
        asegurar_columna_folio_real_padron(cur, conn)

        # Atajo: solo folio real (numérico exacto).
        solo_folio = (
            folio_stripped
            and not clave_stripped
            and not nombre_tokens
            and not colonia_stripped
            and not calle_stripped
            and not numero_txt
        )
        if solo_folio:
            cur.execute(f"""
                {SQL_SELECT_PADRON_UNICO}
                {SQL_FROM_PADRON_UNICO}
                WHERE NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') = %s
                ORDER BY p.clave_catastral
                LIMIT %s;
            """, (folio_stripped, limite))
            rows = _dedupe_filas_padron(cur.fetchall())
            cur.execute(f"""
                SELECT COUNT(DISTINCT UPPER(TRIM(p.clave_catastral))) AS total
                {SQL_FROM_PADRON_UNICO}
                WHERE NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') = %s;
            """, (folio_stripped,))
            total_row = cur.fetchone()
            total = total_row["total"] if total_row else 0
            cur.close()
            conn.close()
            return {
                "total": total,
                "limite": limite,
                "cargados": len(rows),
                "resultados": rows,
            }

        # Atajo: solo clave (sin nombre/colonia/calle/número/folio) → igualdad exacta,
        # sin COUNT(*) sobre ~441k filas (evita 10–20 s de espera).
        solo_clave = (
            clave_stripped
            and not nombre_tokens
            and not colonia_stripped
            and not calle_stripped
            and not numero_txt
            and not folio_stripped
        )
        if solo_clave:
            clave_norm = clave_stripped.upper()

            # Clave completa: igualdad exacta (rápida).
            if len(clave_norm) >= 8:
                cur.execute(f"""
                    {SQL_SELECT_PADRON_UNICO}
                    {SQL_FROM_PADRON_UNICO}
                    WHERE UPPER(TRIM(p.clave_catastral)) = %s
                    LIMIT 1;
                """, (clave_norm,))
                row = cur.fetchone()
                cur.close()
                conn.close()
                return {
                    "total": 1 if row else 0,
                    "limite": limite,
                    "cargados": 1 if row else 0,
                    "resultados": [row] if row else [],
                }

            # Prefijo de clave / manzana / sector (ej. ST311 → ST311xxx).
            clave_like = clave_norm + "%"
            where_prefijo = "WHERE UPPER(p.clave_catastral) LIKE %s"

            cur.execute(f"""
                SELECT COUNT(DISTINCT UPPER(TRIM(p.clave_catastral))) AS total
                {SQL_FROM_PADRON_UNICO}
                {where_prefijo};
            """, (clave_like,))
            total_row = cur.fetchone()
            total = total_row["total"] if total_row else 0

            cur.execute(f"""
                {SQL_SELECT_PADRON_UNICO}
                {SQL_FROM_PADRON_UNICO}
                {where_prefijo}
                ORDER BY p.clave_catastral
                LIMIT %s;
            """, (clave_like, limite))

            rows = _dedupe_filas_padron(cur.fetchall())
            cur.close()
            conn.close()

            return {
                "total": total,
                "limite": limite,
                "cargados": len(rows),
                "resultados": rows,
            }

        clave_like = clave_stripped + "%"
        colonia_like = "%" + colonia_stripped + "%"
        calle_like = "%" + calle_stripped + "%"

        where_sql = f"""
            WHERE
                (%s = '' OR UPPER(p.clave_catastral) LIKE UPPER(%s))
                AND {nombre_cond}
                AND (%s = '' OR UPPER(p.colonia) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(p.calle) LIKE UPPER(%s))
                AND (%s = '' OR CAST(p.numof AS TEXT) = %s)
                AND (%s = '' OR NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') = %s)
        """

        params_where = (
            clave_stripped, clave_like,
            *nombre_params,
            colonia_stripped, colonia_like,
            calle_stripped, calle_like,
            numero_txt, numero_txt,
            folio_stripped, folio_stripped
        )

        # Total real SIN LIMIT para que el frontend conozca todos los predios encontrados.
        cur.execute(f"""
            SELECT COUNT(DISTINCT UPPER(TRIM(p.clave_catastral))) AS total
            {SQL_FROM_PADRON_UNICO}
            {where_sql};
        """, params_where)
        total_row = cur.fetchone()
        total = total_row["total"] if total_row else 0

        cur.execute(f"""
            {SQL_SELECT_PADRON_UNICO}
            {SQL_FROM_PADRON_UNICO}
            {where_sql}
            ORDER BY p.clave_catastral
            LIMIT %s;
        """, params_where + (limite,))

        rows = _dedupe_filas_padron(cur.fetchall())
        cur.close()
        conn.close()

        return {
            "total": total,
            "limite": limite,
            "cargados": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/{clave}/ficha")
def ficha_padron(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()
        asegurar_columna_folio_real_padron(cur, conn)

        cur.execute(f"""
            SELECT
                g.id AS predio_id,
                p.clave_catastral,
                COALESCE(
                    NULLIF(TRIM(tit.nombre_visible), ''),
                    NULLIF(TRIM(tit.titular_principal), ''),
                    NULLIF(TRIM(p.nombre_completo), '')
                ) AS nombre_completo,
                p.delegacion,
                p.colonia,
                p.calle,
                p.zonah AS zona_homogenea,
                NULL::INTEGER AS anio_zona,
                p.descripcion_uso,
                p.id_tasa,
                p.porcentaje_tasa,
                NULL::TEXT AS cp,
                p.numof,
                p.numint,
                p.letra,
                p.sup_documental,
                p.sup_fisica,
                p.sup_const,
                p.valor2026,
                NULL::TEXT AS estatus,
                TRUE AS vigente,
                CASE WHEN g.id IS NOT NULL AND g.geom IS NOT NULL THEN TRUE ELSE FALSE END AS dibujado,
                p.condominio,
                p.adeudo_2026,
                p.adeudo_total,
                NULLIF(NULLIF(TRIM(p.folio_real::text), ''), '0') AS folio_real,
                tit.id_persona,
                tit.tipo_persona,
                tit.rfc,
                tit.porcentaje_propiedad,
                tit.tipo_titularidad,
                tit.total_titulares,
                tit.suma_porcentaje,
                EXISTS (
                    SELECT 1
                    FROM catastro.v_expediente_integral e
                    WHERE UPPER(TRIM(e.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                ) AS tiene_expediente,
                FALSE AS solo_cartografia,
                CASE
                    WHEN g.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json
                END AS geometry
            {SQL_FROM_PADRON_UNICO}
            WHERE UPPER(p.clave_catastral) = UPPER(%s)
            LIMIT 1;
        """, (clave,))

        row = cur.fetchone()

        if not row:
            join_col = _join_cat_colonias_predios_sql(cur, "p", "col")
            expr_col = _expr_colonia_solo_cartografia(cur, alias_predio="p", alias_col="col")
            cur.execute(f"""
                SELECT
                    p.id AS predio_id,
                    p.clave_catastral,
                    NULL::TEXT AS nombre_completo,
                    NULL::TEXT AS delegacion,
                    {expr_col} AS colonia,
                    NULL::TEXT AS calle,
                    NULL::TEXT AS zona_homogenea,
                    NULL::INTEGER AS anio_zona,
                    NULL::TEXT AS descripcion_uso,
                    NULL::TEXT AS id_tasa,
                    NULL::NUMERIC AS porcentaje_tasa,
                    p.cp,
                    NULL::TEXT AS numof,
                    NULL::TEXT AS numint,
                    NULL::TEXT AS letra,
                    p.sup_documental,
                    NULL::NUMERIC AS sup_fisica,
                    NULL::NUMERIC AS sup_const,
                    NULL::NUMERIC AS valor2026,
                    p.estatus,
                    TRUE AS vigente,
                    TRUE AS dibujado,
                    NULL::TEXT AS condominio,
                    NULL::NUMERIC AS adeudo_2026,
                    NULL::NUMERIC AS adeudo_total,
                    NULL::TEXT AS folio_real,
                    NULL::INTEGER AS id_persona,
                    NULL::TEXT AS tipo_persona,
                    NULL::TEXT AS rfc,
                    NULL::NUMERIC AS porcentaje_propiedad,
                    NULL::TEXT AS tipo_titularidad,
                    NULL::INTEGER AS total_titulares,
                    NULL::NUMERIC AS suma_porcentaje,
                    FALSE AS tiene_expediente,
                    TRUE AS solo_cartografia,
                    CASE
                        WHEN p.geom IS NULL THEN NULL
                        ELSE ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json
                    END AS geometry
                FROM catastro.predios p
                {join_col}
                WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(%s))
                LIMIT 1;
            """, (clave,))
            row = cur.fetchone()

        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Predio no encontrado")

        geometry = row.pop("geometry")
        if not geometry:
            geometry = _buscar_geometria_predio_por_clave(clave)
            if geometry:
                row["dibujado"] = True

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": row
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predios/{clave}/ficha")
def ficha_predio_alias(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    return ficha_padron(clave, usuario_actual)


@router.get("/predios/{clave}/geojson")
def geojson_predio(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    """Geometría del predio para mapa (Feature GeoJSON)."""
    try:
        geometry = _buscar_geometria_predio_por_clave(clave)
        if not geometry:
            raise HTTPException(status_code=404, detail="Predio sin geometría cartográfica")
        return {"type": "Feature", "geometry": geometry, "properties": {"clave_catastral": clave.upper().strip()}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/predios/{clave}/geometria")
def actualizar_geometria_predio(
    clave: str,
    datos: GeometriaPredioActualizar,
    request: Request,
    usuario_actual: dict = Depends(requerir_permiso("editar_cartografia")),
):
    """Persiste la geometría editada del predio en catastro.predios (EPSG:32611)."""
    clave_norm = clave.upper().strip()
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral inválida")
    geom = datos.geometry
    if not isinstance(geom, dict) or not geom.get("type"):
        raise HTTPException(status_code=400, detail="Geometría GeoJSON inválida")
    tipo = str(geom.get("type") or "").lower()
    if tipo not in ("polygon", "multipolygon"):
        raise HTTPException(status_code=400, detail="Solo se admiten polígonos")

    try:
        geom_json = json.dumps(geom)
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE catastro.predios
            SET geom = ST_Transform(
                ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(%s)), 4326),
                32611
            )
            WHERE UPPER(TRIM(clave_catastral)) = %s
            RETURNING
                id,
                ROUND(ST_Area(geom)::numeric, 2)::float AS area_m2,
                ROUND(ST_Perimeter(geom)::numeric, 2)::float AS perimetro_m;
            """,
            (geom_json, clave_norm),
        )
        row = cur.fetchone()
        accion_auditoria = "ACTUALIZAR_GEOMETRIA_PREDIO"
        if not row:
            if not datos.crear_si_ausente:
                cur.close()
                conn.close()
                raise HTTPException(status_code=404, detail="Predio no encontrado en cartografía")
            cur.execute(
                """
                INSERT INTO catastro.predios (clave_catastral, geom)
                VALUES (
                    %s,
                    ST_Transform(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(%s)), 4326), 32611)
                )
                RETURNING
                    id,
                    ROUND(ST_Area(geom)::numeric, 2)::float AS area_m2,
                    ROUND(ST_Perimeter(geom)::numeric, 2)::float AS perimetro_m;
                """,
                (clave_norm, geom_json),
            )
            row = cur.fetchone()
            accion_auditoria = "CREAR_GEOMETRIA_PREDIO"

        conn.commit()
        ip = request.client.host if request.client else ""
        proc_txt = (datos.procedimiento or "").strip()
        motivo_txt = (datos.motivo or "").strip() or "Edición cartográfica"
        detalle = f"Clave {clave_norm} · {motivo_txt}"
        if proc_txt:
            detalle += f" · {proc_txt}"
        registrar_auditoria(
            usuario_actual.get("usuario") or "",
            accion_auditoria,
            "CARTOGRAFIA",
            detalle,
            ip,
        )
        cur.close()
        conn.close()
        return {
            "success": True,
            "clave_catastral": clave_norm,
            "area_m2": row.get("area_m2"),
            "perimetro_m": row.get("perimetro_m"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predios/{clave}/construcciones")
def construcciones_predio(
    clave: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Construcciones cartográficas del predio (capa construccionesmxli en geonode_data)."""
    if get_geonode_conn is None:
        raise HTTPException(
            status_code=503,
            detail="Conexion geonode no configurada en el servidor (database.get_geonode_conn).",
        )
    clave_norm = clave.upper().strip()
    try:
        conn = get_geonode_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                fid,
                clavecatas,
                claveconst,
                claveorig,
                niveles,
                suphor,
                colonia,
                perimetro,
                tipo
            FROM construccionesmxli
            WHERE UPPER(TRIM(clavecatas)) = %s
               OR UPPER(TRIM(claveorig)) = %s
            ORDER BY claveconst NULLS LAST, fid;
        """, (clave_norm, clave_norm))
        rows = cur.fetchall()
        cur.close()
        conn.close()

        construcciones = []
        for r in rows:
            construcciones.append({
                "fid": r.get("fid"),
                "clavecatas": r.get("clavecatas"),
                "claveconst": r.get("claveconst"),
                "claveorig": r.get("claveorig"),
                "niveles": r.get("niveles"),
                "suphor": float(r["suphor"]) if r.get("suphor") is not None else None,
                "colonia": r.get("colonia"),
                "perimetro": float(r["perimetro"]) if r.get("perimetro") is not None else None,
                "tipo": r.get("tipo"),
            })

        return {
            "clave_catastral": clave_norm,
            "total": len(construcciones),
            "construcciones": construcciones,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predios/buscar")
def buscar_predios(
    clave: str = Query(..., min_length=1),
    limite: int = Query(100, ge=1, le=5000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    return buscar_padron(clave=clave, limite=limite, usuario_actual=usuario_actual)


@router.get("/predios/intersecta")
def predio_por_coordenada(
    lon: float = Query(...),
    lat: float = Query(...),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        row_geo = _buscar_predio_geo_por_punto(lon, lat)
        if row_geo:
            clave = str(row_geo.get("clave_catastral") or "").strip().upper()
            return {
                "type": "Feature",
                "geometry": row_geo.get("geometry"),
                "properties": {
                    "clave_catastral": clave,
                    "dibujado": True,
                    "solo_cartografia": True,
                },
            }

        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            WITH punto AS (
                SELECT ST_Transform(
                    ST_SetSRID(ST_Point(%s, %s), 4326),
                    32611
                ) AS geom
            )
            SELECT
                p.id,
                p.clave_catastral,
                p.estatus,
                p.sup_documental AS superficie,
                ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry
            FROM catastro.predios p, punto pt
            WHERE p.geom IS NOT NULL
              AND (
                    ST_Intersects(p.geom, pt.geom)
                    OR ST_DWithin(p.geom, pt.geom, 2)
              )
            ORDER BY
                CASE WHEN ST_Intersects(p.geom, pt.geom) THEN 0 ELSE 1 END,
                ST_Area(p.geom) ASC,
                ST_Distance(p.geom, pt.geom) ASC
            LIMIT 1;
        """, (lon, lat))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="No se encontró predio")

        geometry = row.pop("geometry")

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": row
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predios/cercanos")
def predios_cercanos(
    lon: float = Query(...),
    lat: float = Query(...),
    radio: float = Query(50, ge=1, le=1000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        conn = get_conn()
        cur = conn.cursor()
        join_col = _join_cat_colonias_predios_sql(cur, "p", "col")
        expr_col = _expr_colonia_padron_o_catalogo(cur, alias_pad="pad", alias_col="col")

        cur.execute(f"""
            WITH punto AS (
                SELECT ST_Transform(
                    ST_SetSRID(ST_Point(%s, %s), 4326),
                    32611
                ) AS geom
            )
            SELECT
                p.id,
                p.clave_catastral,
                p.estatus,
                {expr_col} AS colonia,
                p.cp,
                TRIM(COALESCE(pad.numof, '')) AS numof,
                TRIM(COALESCE(pad.calle, '')) AS calle,
                TRIM(COALESCE(pad.numint, '')) AS numint,
                TRIM(COALESCE(pad.letra, '')) AS letra,
                COALESCE(pad.adeudo_total, 0) AS adeudo_total,
                COALESCE(pad.adeudo_2026, 0) AS adeudo_2026,
                ROUND(ST_Distance(ST_PointOnSurface(p.geom), pt.geom)::numeric, 1)::float AS distancia_m,
                p.sup_documental AS superficie,
                ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry
            FROM catastro.predios p
            LEFT JOIN catalogos.padron_2026 pad
                ON UPPER(TRIM(pad.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
            {join_col},
                punto pt
            WHERE p.geom IS NOT NULL
              AND ST_DWithin(p.geom, pt.geom, %s)
            ORDER BY ST_Distance(p.geom, pt.geom)
            LIMIT 100;
        """, (lon, lat, radio))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        features = []
        for row in rows:
            geometry = row.pop("geometry")
            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": row
            })

        return {
            "type": "FeatureCollection",
            "total": len(features),
            "features": features
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/{clave}/numeros-oficiales-cercanos")
def numeros_oficiales_cercanos(
    clave: str,
    limite_misma_calle: int = Query(25, ge=1, le=80),
    limite_otras_calles: int = Query(10, ge=0, le=50),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Predios con numero oficial: prioriza misma calle y reparte el resto en calles vecinas."""
    return _numeros_oficiales_cercanos_payload(clave, limite_misma_calle, limite_otras_calles)


@router.get("/predios/{clave}/numeros-oficiales-cercanos")
def numeros_oficiales_cercanos_predio(
    clave: str,
    limite_misma_calle: int = Query(25, ge=1, le=80),
    limite_otras_calles: int = Query(10, ge=0, le=50),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Alias del endpoint de numeros oficiales cercanos."""
    return _numeros_oficiales_cercanos_payload(clave, limite_misma_calle, limite_otras_calles)


CARTA_URBANA_2040_WMS_URL = "https://fcnarqnodo.hopto.org/geoserver/geonode/wms"
CARTA_URBANA_2040_WMS_LAYER = "usos_prop_au40"
CARTA_URBANA_2040_TABLAS = ["usos_prop_au40"]
CARTA_URBANA_2040_WMS_LAYERS = [
    "usos_prop_au40",
    "geonode:usos_prop_au40",
]
CARTA_URBANA_SECTORES_TABLAS = ["sectores"]
CARTA_URBANA_SECTORES_WMS_LAYERS = [
    "sectores",
    "geonode:sectores",
]

USO_PERMISO_EXACTOS = (
    "usoprop_40", "usoprop40", "uso_prop_40", "usoprop", "uso_suelo", "g_uso",
    "nom_uso", "tipo_uso", "desc_uso", "descripcion_uso", "usos_prop", "prop_au40",
    "destino", "clasific", "leyenda", "simbolo", "label", "clase_uso",
)
USO_PERMISO_SUBSTR = (
    "usoprop_40", "usoprop40", "usoprop", "desc_uso", "descripcion_uso", "nom_uso",
    "tipo_uso", "uso_suelo", "g_uso", "usos_prop", "prop_au40", "clasific", "leyenda",
    "simbolo", "destino",
)
USO_PERMISO_EXCLUIR = frozenset({
    "uso_id", "id_uso", "cod_uso", "clave_uso", "tipo_uso_id", "gid", "fid",
})
USO_TEXTO_RE = re.compile(
    r"(?i)(habitacional|comercio|industrial|equipamiento|mixto|conservaci|"
    r"área verde|area verde|infraestructura|almacenamiento|reserva|existente|propuesto|agr[ií]cola)"
)


def _valor_prop_carta_valido(val) -> bool:
    if val is None:
        return False
    s = str(val).strip()
    return s not in ("", "NULL", "null", "None", "0", "-")


def _tomar_prop_carta(props: dict, *candidatos: str, exacto: bool = False, excluir=None) -> str:
    if not props:
        return ""
    claves = {str(k).lower(): k for k in props.keys()}
    excluir = excluir or frozenset()
    for cand in candidatos:
        cand_l = cand.lower()
        if exacto:
            orig = claves.get(cand_l)
            if orig and _valor_prop_carta_valido(props.get(orig)):
                return str(props[orig]).strip()
            continue
        for kl, orig in claves.items():
            if kl in excluir:
                continue
            if cand_l in kl and _valor_prop_carta_valido(props.get(orig)):
                return str(props[orig]).strip()
    return ""


def _inferir_uso_permitido(props: Optional[dict]) -> str:
    if not props:
        return ""
    uso = _tomar_prop_carta(props, *USO_PERMISO_EXACTOS, exacto=True)
    if uso:
        return uso
    uso = _tomar_prop_carta(
        props, *USO_PERMISO_SUBSTR, excluir=USO_PERMISO_EXCLUIR
    )
    if uso:
        return uso
    usos: List[str] = []
    vistos = set()
    for k, val in props.items():
        if re.match(r"^(gid|fid|geom|the_geom|shape_|objectid|area|perim)", str(k), re.I):
            continue
        if not _valor_prop_carta_valido(val):
            continue
        s = str(val).strip()
        if len(s) > 140 or not USO_TEXTO_RE.search(s):
            continue
        key = s.lower()
        if key not in vistos:
            vistos.add(key)
            usos.append(s)
    return " · ".join(usos[:4])


def _combinar_usos_permitidos(*valores: str) -> str:
    usos: List[str] = []
    vistos = set()
    for val in valores:
        for parte in str(val or "").split("·"):
            u = parte.strip()
            if not u:
                continue
            key = u.lower()
            if key not in vistos:
                vistos.add(key)
                usos.append(u)
    return " · ".join(usos[:5])


def _normalizar_atributos_carta_urbana(props: Optional[dict]) -> dict:
    if not props:
        return {}
    claves = {str(k).lower(): k for k in props.keys()}

    def tomar(*candidatos: str) -> str:
        for cand in candidatos:
            cand_l = cand.lower()
            for kl, orig in claves.items():
                if cand_l in kl:
                    val = props.get(orig)
                    if _valor_prop_carta_valido(val):
                        return str(val).strip()
        return ""

    attrs = {
        "zona": tomar("zona", "zonific", "clave_zona", "c_zona", "simbolo", "simbol", "clave", "codigo", "cod_uso"),
        "uso_permitido": _inferir_uso_permitido(props),
        "densidad": tomar("densidad", "hab_ha", "viviendas", "vivienda", "dens"),
        "nivel": tomar("nivel", "altura", "plantas", "n_max", "niveles"),
        "instrumento": tomar("instrumento", "programa", "pdu", "plan", "carta", "au40"),
        "observaciones": tomar("observ", "nota", "coment"),
        "nombre_zona": tomar("nombre", "nom_zona", "desc_zona", "etiqueta", "desc", "descripcion"),
    }
    if not attrs["observaciones"]:
        obs = tomar("leyenda")
        if obs and not USO_TEXTO_RE.search(obs):
            attrs["observaciones"] = obs
    return attrs


def _extraer_codigo_sector(props: Optional[dict]) -> str:
    if not props:
        return ""
    claves = {str(k).lower(): k for k in props.keys()}

    def tomar(*candidatos: str) -> str:
        for cand in candidatos:
            cand_l = cand.lower()
            for kl, orig in claves.items():
                if cand_l == kl or cand_l in kl:
                    val = props.get(orig)
                    if val is not None and str(val).strip() not in ("", "NULL", "null"):
                        return str(val).strip()
        return ""

    return tomar(
        "sector", "sectores", "letra", "clave_sector", "simbolo", "simbol",
        "codigo", "cod_sector", "id_sector", "nom_sector"
    )


def _consultar_sector_geonode(cur, ewkt_predio: str) -> Optional[dict]:
    for tabla in CARTA_URBANA_SECTORES_TABLAS:
        if not re.fullmatch(r"[a-z0-9_]+", tabla or "", re.I):
            continue
        try:
            cur.execute(
                f"""
                SELECT t.*
                FROM public.{tabla} t
                WHERE t.geom IS NOT NULL
                  AND ST_Intersects(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                  )
                ORDER BY ST_Area(
                    ST_Intersection(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                    )
                ) DESC NULLS LAST
                LIMIT 1;
                """,
                (ewkt_predio, ewkt_predio),
            )
            row = cur.fetchone()
            if not row:
                continue
            props = dict(row)
            props.pop("geom", None)
            codigo = _extraer_codigo_sector(props)
            if not codigo:
                continue
            return {
                "origen": "geonode",
                "tabla": tabla,
                "codigo": codigo,
                "nombre": props.get("nombre") or props.get("nom_sector") or "",
                "properties": props,
            }
        except Exception:
            continue
    return None


def _consultar_sector_wms(lon: float, lat: float) -> Optional[dict]:
    result = _consultar_carta_urbana_wms(float(lon), float(lat), CARTA_URBANA_SECTORES_WMS_LAYERS)
    if not result:
        return None
    props = result.get("properties") or {}
    codigo = _extraer_codigo_sector(props)
    if not codigo:
        return None
    return {
        "origen": result.get("origen") or "wms",
        "layer": result.get("layer") or CARTA_URBANA_SECTORES_WMS_LAYERS[0],
        "codigo": codigo,
        "nombre": props.get("nombre") or props.get("nom_sector") or "",
        "properties": props,
    }


def _listar_tablas_carta_urbana_geonode(cur) -> List[str]:
    tablas: List[str] = []
    for nombre in CARTA_URBANA_2040_TABLAS:
        cur.execute("""
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = %s
            LIMIT 1;
        """, (nombre,))
        if cur.fetchone():
            tablas.append(nombre)

    cur.execute("""
        SELECT c.table_name
        FROM information_schema.columns c
        INNER JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'geom'
          AND t.table_type = 'BASE TABLE'
          AND (
              c.table_name ILIKE '%%usos_prop%%'
              OR c.table_name ILIKE '%%au40%%'
              OR c.table_name ILIKE '%%carta%%urbana%%'
              OR c.table_name ILIKE '%%2040%%'
              OR c.table_name ILIKE '%%usos%%suelo%%'
              OR c.table_name ILIKE '%%zonific%%'
              OR c.table_name ILIKE '%%plan%%urbano%%'
          )
        GROUP BY c.table_name
        ORDER BY
            CASE
                WHEN c.table_name = 'usos_prop_au40' THEN 0
                WHEN c.table_name ILIKE '%%au40%%' THEN 1
                WHEN c.table_name ILIKE '%%2040%%' THEN 2
                ELSE 3
            END,
            c.table_name;
    """)
    for row in cur.fetchall():
        nombre = row["table_name"]
        if nombre not in tablas:
            tablas.append(nombre)
    return tablas


def _consultar_carta_urbana_geonode(cur, ewkt_predio: str, tablas: List[str]) -> Optional[dict]:
    for tabla in tablas:
        if not re.fullmatch(r"[a-z0-9_]+", tabla or "", re.I):
            continue
        try:
            cur.execute(
                f"""
                SELECT
                    t.*,
                    ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geometry,
                    ST_Area(
                        ST_Intersection(
                            t.geom,
                            ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                        )
                    ) AS inter_area
                FROM public.{tabla} t
                WHERE t.geom IS NOT NULL
                  AND ST_Intersects(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                  )
                ORDER BY inter_area DESC NULLS LAST
                LIMIT 8;
                """,
                (ewkt_predio, ewkt_predio),
            )
            rows = cur.fetchall() or []
            if not rows:
                continue
            usos: List[str] = []
            best_props = None
            geometry = None
            for row in rows:
                props = dict(row)
                props.pop("inter_area", None)
                row_geom = props.pop("geometry", None)
                props.pop("geom", None)
                if best_props is None:
                    best_props = props
                    geometry = row_geom
                uso = _inferir_uso_permitido(props)
                if uso:
                    for parte in uso.split("·"):
                        u = parte.strip()
                        if u and u not in usos:
                            usos.append(u)
            if not best_props:
                continue
            attrs = _normalizar_atributos_carta_urbana(best_props)
            if usos:
                attrs["uso_permitido"] = _combinar_usos_permitidos(
                    attrs.get("uso_permitido") or "",
                    " · ".join(usos),
                )
            return {
                "origen": "geonode",
                "tabla": tabla,
                "properties": best_props,
                "geometry": geometry,
                "atributos": attrs,
            }
        except Exception:
            continue
    return None


def _consultar_carta_urbana_wms(lon: float, lat: float, layers: List[str]) -> Optional[dict]:
    delta = 0.00045
    bbox = f"{lon - delta},{lat - delta},{lon + delta},{lat + delta}"
    for layer in layers:
        params = {
            "SERVICE": "WMS",
            "VERSION": "1.1.1",
            "REQUEST": "GetFeatureInfo",
            "LAYERS": layer,
            "QUERY_LAYERS": layer,
            "STYLES": "",
            "BBOX": bbox,
            "WIDTH": "101",
            "HEIGHT": "101",
            "X": "50",
            "Y": "50",
            "SRS": "EPSG:4326",
            "INFO_FORMAT": "application/json",
            "FEATURE_COUNT": "10",
        }
        url = CARTA_URBANA_2040_WMS_URL + "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=18) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
            features = data.get("features") or []
            if not features:
                continue
            usos: List[str] = []
            best_props = None
            best_geom = None
            for feat in features:
                props = feat.get("properties") or {}
                if best_props is None:
                    best_props = props
                    best_geom = feat.get("geometry")
                uso = _inferir_uso_permitido(props)
                if uso:
                    for parte in uso.split("·"):
                        u = parte.strip()
                        if u and u not in usos:
                            usos.append(u)
            props = best_props or {}
            attrs = _normalizar_atributos_carta_urbana(props)
            if usos:
                attrs["uso_permitido"] = _combinar_usos_permitidos(
                    attrs.get("uso_permitido") or "",
                    " · ".join(usos),
                )
            return {
                "origen": "wms",
                "layer": layer,
                "properties": props,
                "geometry": best_geom,
                "atributos": attrs,
            }
        except Exception:
            continue
    return None


def _enriquecer_carta_urbana_con_pducp(
    payload: dict,
    pducp: Optional[dict],
) -> dict:
    """Completa atributos vacíos de carta urbana con datos normativos PDUCP."""
    if not pducp or not pducp.get("disponible"):
        return payload

    ui = pducp.get("campos_ui") or {}
    carta = payload.get("carta_urbana")
    if carta is not None:
        attrs = carta.setdefault("atributos", {})
        for campo, clave_ui in (
            ("zona", "zona_clave"),
            ("nombre_zona", "nombre_zona"),
            ("densidad", "densidad"),
            ("nivel", "nivel_altura"),
            ("instrumento", "instrumento"),
            ("observaciones", "observaciones"),
            ("uso_permitido", "uso_permitido"),
        ):
            if not str(attrs.get(campo) or "").strip() and ui.get(clave_ui):
                attrs[campo] = ui[clave_ui]

    sector = payload.get("sector") or {}
    if not str(sector.get("codigo") or "").strip() and pducp.get("sector_pducp"):
        payload["sector"] = {
            "codigo": pducp.get("sector_pducp"),
            "nombre": pducp.get("sector_nombre") or "",
            "origen": "pducp",
            "layer": "diatritos_pdupm",
            "distrito": pducp.get("distrito") or "",
            "properties": sector.get("properties") or {},
        }

    payload["pducp"] = pducp
    return payload


def _carta_urbana_2040_payload(clave: str) -> dict:
    clave_norm = clave.upper().strip()
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral requerida")

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            UPPER(TRIM(p.clave_catastral)) AS clave_catastral,
            TRIM(COALESCE(p.descripcion_uso, '')) AS uso_padron,
            TRIM(COALESCE(p.colonia, '')) AS colonia,
            TRIM(COALESCE(p.delegacion, '')) AS delegacion,
            ST_AsEWKT(ST_Transform(g.geom, 32611)) AS ewkt_32611,
            ST_X(ST_Transform(ST_PointOnSurface(g.geom), 4326))::float AS lon,
            ST_Y(ST_Transform(ST_PointOnSurface(g.geom), 4326))::float AS lat,
            ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json AS geometry
        FROM catalogos.padron_2026 p
        INNER JOIN catastro.predios g
            ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
        WHERE UPPER(TRIM(p.clave_catastral)) = %s
          AND g.geom IS NOT NULL
        LIMIT 1;
    """, (clave_norm,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Predio no encontrado o sin geometría cartográfica")

    lon = row.get("lon")
    lat = row.get("lat")
    ewkt = row.get("ewkt_32611")
    carta = None
    tablas_detectadas: List[str] = []

    if get_geonode_conn is not None and ewkt:
        try:
            gconn = get_geonode_conn()
            gcur = gconn.cursor()
            tablas_detectadas = _listar_tablas_carta_urbana_geonode(gcur)
            if tablas_detectadas:
                carta = _consultar_carta_urbana_geonode(gcur, ewkt, tablas_detectadas)
            gcur.close()
            gconn.close()
        except Exception:
            carta = None

    if carta is None and lon is not None and lat is not None:
        carta = _consultar_carta_urbana_wms(float(lon), float(lat), CARTA_URBANA_2040_WMS_LAYERS)

    sector = None
    if get_geonode_conn is not None and ewkt:
        try:
            gconn = get_geonode_conn()
            gcur = gconn.cursor()
            sector = _consultar_sector_geonode(gcur, ewkt)
            gcur.close()
            gconn.close()
        except Exception:
            sector = None
    if sector is None and lon is not None and lat is not None:
        sector = _consultar_sector_wms(float(lon), float(lat))

    wms_layer = (carta or {}).get("layer") or CARTA_URBANA_2040_WMS_LAYER
    mensaje = ""
    if not carta:
        if tablas_detectadas:
            mensaje = (
                "No se intersectó el predio con usos_prop_au40. "
                "Verifique geometría del predio o simbología de la capa."
            )
        else:
            mensaje = (
                "Capa usos_prop_au40 no detectada en GeoNode. "
                "Publique geonode:usos_prop_au40 en el servidor WMS."
            )

    pducp = {"disponible": False, "mensaje": "Consulta PDUCP no disponible."}
    try:
        conn_pducp = get_conn()
        cur_pducp = conn_pducp.cursor()
        pducp = consultar_pducp_predio(
            cur_pducp,
            clave_norm,
            row.get("uso_padron") or "",
        )
        cur_pducp.close()
        conn_pducp.close()
    except Exception:
        pducp = {
            "disponible": False,
            "clave_catastral": clave_norm,
            "mensaje": "No se pudo consultar datos PDUCP en catastro_bc.",
        }

    payload = {
        "clave_catastral": clave_norm,
        "uso_padron": row.get("uso_padron") or "",
        "colonia": row.get("colonia") or "",
        "delegacion": row.get("delegacion") or "",
        "centroide": {"lon": lon, "lat": lat},
        "geometry": row.get("geometry"),
        "carta_urbana": carta,
        "sector": sector,
        "wms_url": CARTA_URBANA_2040_WMS_URL,
        "wms_layer": wms_layer,
        "wms_layers_intentadas": CARTA_URBANA_2040_WMS_LAYERS,
        "tablas_geonode_detectadas": tablas_detectadas,
        "mensaje": mensaje,
        "pducp": pducp,
    }
    return _enriquecer_carta_urbana_con_pducp(payload, pducp)


@router.get("/padron/{clave}/carta-urbana-2040")
def carta_urbana_2040_padron(
    clave: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Consulta carta urbana 2040 intersectando el predio (GeoNode + WMS)."""
    return _carta_urbana_2040_payload(clave)


@router.get("/predios/{clave}/carta-urbana-2040")
def carta_urbana_2040_predio(
    clave: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Alias de consulta carta urbana 2040."""
    return _carta_urbana_2040_payload(clave)


COLONIA_FRACCIONAMIENTO_WMS_URL = CARTA_URBANA_2040_WMS_URL
COLONIA_FRACCIONAMIENTO_WMS_LAYER = "colonias"
COLONIA_FRACCIONAMIENTO_TABLAS = ["colonias"]
COLONIA_FRACCIONAMIENTO_WMS_LAYERS = [
    "colonias",
    "geonode:colonias",
]


def _normalizar_atributos_colonia(props: Optional[dict]) -> dict:
    if not props:
        return {}
    claves = {str(k).lower(): k for k in props.keys()}

    def tomar(*candidatos: str) -> str:
        for cand in candidatos:
            cand_l = cand.lower()
            for kl, orig in claves.items():
                if cand_l in kl:
                    val = props.get(orig)
                    if val is not None and str(val).strip() not in ("", "NULL", "null"):
                        return str(val).strip()
        return ""

    return {
        "nombre": tomar(
            "nombre", "nombre_colonia", "colonia", "nom_colonia", "desc_colonia",
            "descripcion", "desc", "etiqueta", "label"
        ),
        "tipo": tomar("tipo", "clasific", "categoria", "clase", "g_tipo"),
        "fraccionamiento": tomar("fraccion", "fraccionamiento", "frac", "subdivision"),
        "delegacion": tomar("delegacion", "municipio", "deleg", "nom_deleg"),
        "observaciones": tomar("observ", "nota", "coment", "leyenda"),
        "codigo": tomar("codigo", "clave", "id_colonia", "cve_colonia", "gid", "fid"),
    }


def _consultar_colonia_geonode(cur, ewkt_predio: str, tablas: List[str]) -> Optional[dict]:
    for tabla in tablas:
        if not re.fullmatch(r"[a-z0-9_]+", tabla or "", re.I):
            continue
        try:
            cur.execute(
                f"""
                SELECT
                    t.*,
                    ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geometry
                FROM public.{tabla} t
                WHERE t.geom IS NOT NULL
                  AND ST_Intersects(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                  )
                ORDER BY ST_Area(
                    ST_Intersection(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                    )
                ) DESC NULLS LAST
                LIMIT 1;
                """,
                (ewkt_predio, ewkt_predio),
            )
            row = cur.fetchone()
            if not row:
                continue
            props = dict(row)
            geometry = props.pop("geometry", None)
            props.pop("geom", None)
            return {
                "origen": "geonode",
                "tabla": tabla,
                "properties": props,
                "geometry": geometry,
                "atributos": _normalizar_atributos_colonia(props),
            }
        except Exception:
            continue
    return None


def _colonia_fraccionamiento_payload(clave: str) -> dict:
    clave_norm = clave.upper().strip()
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral requerida")

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            UPPER(TRIM(p.clave_catastral)) AS clave_catastral,
            TRIM(COALESCE(p.descripcion_uso, '')) AS uso_padron,
            TRIM(COALESCE(p.colonia, '')) AS colonia,
            TRIM(COALESCE(p.delegacion, '')) AS delegacion,
            TRIM(COALESCE(p.calle, '')) AS calle,
            TRIM(COALESCE(p.numof, '')) AS numof,
            ST_AsEWKT(ST_Transform(g.geom, 32611)) AS ewkt_32611,
            ST_X(ST_Transform(ST_PointOnSurface(g.geom), 4326))::float AS lon,
            ST_Y(ST_Transform(ST_PointOnSurface(g.geom), 4326))::float AS lat,
            ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json AS geometry
        FROM catalogos.padron_2026 p
        INNER JOIN catastro.predios g
            ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
        WHERE UPPER(TRIM(p.clave_catastral)) = %s
          AND g.geom IS NOT NULL
        LIMIT 1;
    """, (clave_norm,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Predio no encontrado o sin geometría cartográfica")

    lon = row.get("lon")
    lat = row.get("lat")
    ewkt = row.get("ewkt_32611")
    colonia_carto = None

    if get_geonode_conn is not None and ewkt:
        try:
            gconn = get_geonode_conn()
            gcur = gconn.cursor()
            colonia_carto = _consultar_colonia_geonode(
                gcur, ewkt, COLONIA_FRACCIONAMIENTO_TABLAS
            )
            gcur.close()
            gconn.close()
        except Exception:
            colonia_carto = None

    if colonia_carto is None and lon is not None and lat is not None:
        colonia_carto = _consultar_carta_urbana_wms(
            float(lon), float(lat), COLONIA_FRACCIONAMIENTO_WMS_LAYERS
        )
        if colonia_carto:
            props = colonia_carto.get("properties") or {}
            colonia_carto["atributos"] = _normalizar_atributos_colonia(props)

    wms_layer = (colonia_carto or {}).get("layer") or COLONIA_FRACCIONAMIENTO_WMS_LAYER
    mensaje = ""
    if not colonia_carto:
        mensaje = (
            "No se intersectó el predio con la capa de colonias. "
            "Verifique geometría del predio o la simbología geonode:colonias."
        )

    return {
        "clave_catastral": clave_norm,
        "uso_padron": row.get("uso_padron") or "",
        "colonia": row.get("colonia") or "",
        "delegacion": row.get("delegacion") or "",
        "calle": row.get("calle") or "",
        "numof": row.get("numof") or "",
        "centroide": {"lon": lon, "lat": lat},
        "geometry": row.get("geometry"),
        "colonia_carto": colonia_carto,
        "wms_url": COLONIA_FRACCIONAMIENTO_WMS_URL,
        "wms_layer": wms_layer,
        "wms_layers_intentadas": COLONIA_FRACCIONAMIENTO_WMS_LAYERS,
        "mensaje": mensaje,
    }


@router.get("/padron/{clave}/colonia-fraccionamiento")
def colonia_fraccionamiento_padron(
    clave: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Consulta colonia/fraccionamiento intersectando el predio (GeoNode + WMS)."""
    return _colonia_fraccionamiento_payload(clave)


@router.get("/predios/{clave}/colonia-fraccionamiento")
def colonia_fraccionamiento_predio(
    clave: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Alias de consulta colonia/fraccionamiento."""
    return _colonia_fraccionamiento_payload(clave)


ZONA_HOMOGENEA_WMS_URL = CARTA_URBANA_2040_WMS_URL
ZONA_HOMOGENEA_WMS_LAYER = "geonode:zonahom2026_tij"
ZONA_HOMOGENEA_WMS_LAYERS = [
    "geonode:zonahom2026_tij",
    "zonahom2026_tij",
]
ZONA_HOMOGENEA_TABLAS = ["zonahom2026_tij"]


def _normalizar_atributos_zona_homogenea(props: Optional[dict]) -> dict:
    if not props:
        return {}
    claves = {str(k).lower(): k for k in props.keys()}

    def tomar(*candidatos: str) -> str:
        for cand in candidatos:
            cand_l = cand.lower()
            for kl, orig in claves.items():
                if cand_l in kl:
                    val = props.get(orig)
                    if val is not None and str(val).strip() not in ("", "NULL", "null"):
                        return str(val).strip()
        return ""

    return {
        "codigo": tomar(
            "zonah", "codigo_zona", "codigo", "clave", "homogenea",
            "codigo_zona_homogenea", "secsub"
        ),
        "descripcion": tomar(
            "descripcion", "nombre", "desc", "colonia", "descripcion_col_fracc"
        ),
        "zona": tomar("zona", "nom_zona"),
        "sector": tomar("sector", "nom_sector"),
        "subsector": tomar("subsector", "nom_subsector"),
        "homoclave": tomar("homoclave", "homoclave_col_fracc", "fraccion"),
        "seccion": tomar("seccion", "sec"),
        "valor_m2": tomar("valor_m2", "valorm2", "valor", "valorley"),
        "anio": tomar("anio", "year", "ejercicio"),
        "observaciones": tomar("observ", "nota", "coment", "leyenda"),
    }


def _consultar_zona_homogenea_geonode(cur, ewkt_predio: str, tablas: List[str]) -> Optional[dict]:
    for tabla in tablas:
        if not re.fullmatch(r"[a-z0-9_]+", tabla or "", re.I):
            continue
        try:
            cur.execute(
                f"""
                SELECT
                    t.*,
                    ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geometry
                FROM public.{tabla} t
                WHERE t.geom IS NOT NULL
                  AND ST_Intersects(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                  )
                ORDER BY ST_Area(
                    ST_Intersection(
                        t.geom,
                        ST_Transform(ST_GeomFromEWKT(%s), ST_SRID(t.geom))
                    )
                ) DESC NULLS LAST
                LIMIT 1;
                """,
                (ewkt_predio, ewkt_predio),
            )
            row = cur.fetchone()
            if not row:
                continue
            props = dict(row)
            geometry = props.pop("geometry", None)
            props.pop("geom", None)
            return {
                "origen": "geonode",
                "tabla": tabla,
                "properties": props,
                "geometry": geometry,
                "atributos": _normalizar_atributos_zona_homogenea(props),
            }
        except Exception:
            continue
    return None


ZONA_HOMOGENEA_WFS_URL = ZONA_HOMOGENEA_WMS_URL.replace("/wms", "/wfs")
ZONA_HOMOGENEA_CODIGO_COLS = [
    "zonahom2026",
    "zonahom",
    "zona_hom",
    "zonah",
    "codigo",
    "codigo_zona",
    "clave",
    "homogenea",
    "secsub",
    "codigo_zona_homogenea",
    "zona_homogenea",
]


def _normalizar_codigo_zona_homogenea(codigo: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(codigo or "").strip().upper())


def _columnas_codigo_zona_homogenea(cur, tabla: str) -> List[str]:
    if not re.fullmatch(r"[a-z0-9_]+", tabla or "", re.I):
        return []
    try:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
              AND data_type IN (
                'character varying', 'text', 'character', 'citext'
              )
            ORDER BY ordinal_position;
            """,
            (tabla,),
        )
        existentes = {
            str(r.get("column_name") if isinstance(r, dict) else r[0]).lower()
            for r in (cur.fetchall() or [])
        }
    except Exception:
        existentes = set()
    cols = [c for c in ZONA_HOMOGENEA_CODIGO_COLS if c in existentes]
    for c in sorted(existentes):
        if c not in cols and any(
            token in c for token in ("zonah", "codigo", "clave", "homogenea", "secsub")
        ):
            cols.append(c)
    return cols


def _fila_zona_homogenea_a_carto(row: dict, tabla: str, origen: str) -> dict:
    props = dict(row)
    geometry = props.pop("geometry", None)
    props.pop("geom", None)
    return {
        "origen": origen,
        "tabla": tabla,
        "properties": props,
        "geometry": geometry,
        "atributos": _normalizar_atributos_zona_homogenea(props),
    }


def _consultar_zona_homogenea_por_codigo_geonode(cur, codigo: str) -> Optional[dict]:
    cod_norm = _normalizar_codigo_zona_homogenea(codigo)
    if not cod_norm:
        return None
    for tabla in ZONA_HOMOGENEA_TABLAS:
        if not re.fullmatch(r"[a-z0-9_]+", tabla or "", re.I):
            continue
        columnas = _columnas_codigo_zona_homogenea(cur, tabla)
        if not columnas:
            columnas = ZONA_HOMOGENEA_CODIGO_COLS
        for col in columnas:
            if not re.fullmatch(r"[a-z0-9_]+", col or "", re.I):
                continue
            try:
                cur.execute(
                    f"""
                    SELECT
                        t.*,
                        ST_AsGeoJSON(ST_Transform(t.geom, 4326))::json AS geometry
                    FROM public.{tabla} t
                    WHERE t.geom IS NOT NULL
                      AND (
                        UPPER(REGEXP_REPLACE(COALESCE(t.{col}::text, ''), '[^A-Z0-9]', '', 'g')) = %s
                        OR UPPER(REGEXP_REPLACE(COALESCE(t.{col}::text, ''), '[^A-Z0-9]', '', 'g')) LIKE %s
                      )
                    ORDER BY
                        CASE
                            WHEN UPPER(REGEXP_REPLACE(COALESCE(t.{col}::text, ''), '[^A-Z0-9]', '', 'g')) = %s THEN 0
                            ELSE 1
                        END,
                        ST_Area(t.geom) DESC NULLS LAST
                    LIMIT 1;
                    """,
                    (cod_norm, f"%{cod_norm}", cod_norm),
                )
                row = cur.fetchone()
                if row:
                    return _fila_zona_homogenea_a_carto(dict(row), tabla, "geonode")
            except Exception:
                continue
    return None


def _consultar_zona_homogenea_wfs_por_codigo(codigo: str) -> Optional[dict]:
    cod_norm = _normalizar_codigo_zona_homogenea(codigo)
    if not cod_norm:
        return None
    type_names = ["geonode:zonahom2026_tij", "zonahom2026_tij"]
    for type_name in type_names:
        for col in ZONA_HOMOGENEA_CODIGO_COLS:
            cql = f"{col}='{cod_norm}'"
            params = {
                "service": "WFS",
                "version": "1.1.0",
                "request": "GetFeature",
                "typeName": type_name,
                "outputFormat": "application/json",
                "srsName": "EPSG:4326",
                "CQL_FILTER": cql,
                "maxFeatures": "1",
            }
            url = ZONA_HOMOGENEA_WFS_URL + "?" + urllib.parse.urlencode(params)
            try:
                with urllib.request.urlopen(url, timeout=18) as resp:
                    data = json.loads(resp.read().decode("utf-8", errors="replace"))
                features = data.get("features") or []
                if not features:
                    continue
                feat = features[0]
                props = feat.get("properties") or {}
                return {
                    "origen": "wfs",
                    "tabla": type_name,
                    "properties": props,
                    "geometry": feat.get("geometry"),
                    "atributos": _normalizar_atributos_zona_homogenea(props),
                }
            except Exception:
                continue
    return None


def _geometria_zona_homogenea_por_codigo(codigo: str) -> dict:
    cod_norm = _normalizar_codigo_zona_homogenea(codigo)
    if not cod_norm:
        raise HTTPException(status_code=400, detail="Código de zona homogénea requerido")

    zona_carto = None
    if get_geonode_conn is not None:
        try:
            gconn = get_geonode_conn()
            gcur = gconn.cursor()
            zona_carto = _consultar_zona_homogenea_por_codigo_geonode(gcur, cod_norm)
            gcur.close()
            gconn.close()
        except Exception:
            zona_carto = None

    if zona_carto is None:
        zona_carto = _consultar_zona_homogenea_wfs_por_codigo(cod_norm)

    if not zona_carto or not zona_carto.get("geometry"):
        raise HTTPException(
            status_code=404,
            detail="No se encontró geometría cartográfica para la zona homogénea indicada.",
        )

    geometry = zona_carto.get("geometry")
    lon = lat = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                ST_X(ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)))::float AS lon,
                ST_Y(ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)))::float AS lat;
            """,
            (json.dumps(geometry), json.dumps(geometry)),
        )
        centro = cur.fetchone() or {}
        lon = centro.get("lon")
        lat = centro.get("lat")
        cur.close()
        conn.close()
    except Exception:
        lon = lat = None

    return {
        "codigo": cod_norm,
        "geometry": geometry,
        "centroide": {"lon": lon, "lat": lat},
        "zona_carto": zona_carto,
        "origen": zona_carto.get("origen"),
    }


@router.get("/padron/analisis/zonas-homogeneas/{codigo}/geometria")
def geometria_zona_homogenea_analisis(
    codigo: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Geometría cartográfica de una zona homogénea por SECSUB / codigo."""
    return _geometria_zona_homogenea_por_codigo(codigo)


def _evolucion_zona_por_codigo(cur, codigo: str) -> Optional[dict]:
    cod_norm = re.sub(r"[^A-Z0-9]", "", str(codigo or "").strip().upper())
    if not cod_norm:
        return None
    anios = _obtener_anios_zh_catalogo(cur)
    union_sql, union_params = _filas_zh_para_analisis(cur, anios)
    if not union_sql:
        return None
    anio_ref = _anio_referencia(anios)
    agg_valores = _sql_agg_valores_por_anio(anios)
    sql = f"""
        WITH filas AS ({union_sql}),
        agg AS (
            SELECT
                clave_zonah,
                MAX(codigo_zona_homogenea) FILTER (WHERE anio = {anio_ref}) AS codigo_zona_homogenea,
                MAX(codigo_zona_homogenea) AS codigo_referencia,
                MAX(zona) FILTER (WHERE anio = {anio_ref}) AS zona,
                MAX(sector) FILTER (WHERE anio = {anio_ref}) AS sector,
                MAX(subsector) FILTER (WHERE anio = {anio_ref}) AS subsector,
                MAX(homoclave_col_fracc) FILTER (WHERE anio = {anio_ref}) AS homoclave_col_fracc,
                MAX(seccion) FILTER (WHERE anio = {anio_ref}) AS seccion,
                MAX(descripcion_col_fracc) FILTER (WHERE anio = {anio_ref}) AS descripcion_col_fracc,
                {agg_valores},
                BOOL_OR(es_adicional) AS es_adicional,
                MAX(tipo_zona) FILTER (WHERE es_adicional) AS tipo_zona
            FROM filas
            GROUP BY clave_zonah
        )
        SELECT * FROM agg
        WHERE clave_zonah = %s
           OR codigo_zona_homogenea = %s
           OR codigo_referencia = %s
        LIMIT 1;
    """
    params = list(union_params) + [cod_norm, cod_norm, cod_norm]
    cur.execute(sql, params)
    row = cur.fetchone()
    if not row:
        sql_ilike = f"""
        WITH filas AS ({union_sql}),
        agg AS (
            SELECT
                clave_zonah,
                MAX(codigo_zona_homogenea) FILTER (WHERE anio = {anio_ref}) AS codigo_zona_homogenea,
                MAX(codigo_zona_homogenea) AS codigo_referencia,
                MAX(zona) FILTER (WHERE anio = {anio_ref}) AS zona,
                MAX(sector) FILTER (WHERE anio = {anio_ref}) AS sector,
                MAX(subsector) FILTER (WHERE anio = {anio_ref}) AS subsector,
                MAX(homoclave_col_fracc) FILTER (WHERE anio = {anio_ref}) AS homoclave_col_fracc,
                MAX(seccion) FILTER (WHERE anio = {anio_ref}) AS seccion,
                MAX(descripcion_col_fracc) FILTER (WHERE anio = {anio_ref}) AS descripcion_col_fracc,
                {agg_valores},
                BOOL_OR(es_adicional) AS es_adicional,
                MAX(tipo_zona) FILTER (WHERE es_adicional) AS tipo_zona
            FROM filas
            GROUP BY clave_zonah
        )
        SELECT * FROM agg
        WHERE UPPER(TRIM(COALESCE(codigo_zona_homogenea, ''))) = %s
           OR UPPER(TRIM(COALESCE(clave_zonah, ''))) = %s
           OR UPPER(TRIM(COALESCE(codigo_referencia, ''))) = %s
        LIMIT 1;
        """
        cur.execute(sql_ilike, list(union_params) + [cod_norm, cod_norm, cod_norm])
        row = cur.fetchone()
    if not row:
        return None
    return _construir_item_evolucion(dict(row), anios)


def _zona_homogenea_payload(clave: str) -> dict:
    clave_norm = clave.upper().strip()
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral requerida")

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            UPPER(TRIM(p.clave_catastral)) AS clave_catastral,
            TRIM(COALESCE(p.descripcion_uso, '')) AS uso_padron,
            TRIM(COALESCE(p.colonia, '')) AS colonia,
            TRIM(COALESCE(p.delegacion, '')) AS delegacion,
            TRIM(COALESCE(p.calle, '')) AS calle,
            TRIM(COALESCE(p.numof, '')) AS numof,
            UPPER(TRIM(COALESCE(p.zonah, ''))) AS zonah,
            TRIM(COALESCE(p.id_tasa::text, '')) AS id_tasa,
            p.porcentaje_tasa,
            p.valor2026,
            ST_AsEWKT(ST_Transform(g.geom, 32611)) AS ewkt_32611,
            ST_X(ST_Transform(ST_PointOnSurface(g.geom), 4326))::float AS lon,
            ST_Y(ST_Transform(ST_PointOnSurface(g.geom), 4326))::float AS lat,
            ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json AS geometry
        FROM catalogos.padron_2026 p
        INNER JOIN catastro.predios g
            ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
        WHERE UPPER(TRIM(p.clave_catastral)) = %s
          AND g.geom IS NOT NULL
        LIMIT 1;
    """, (clave_norm,))
    row = cur.fetchone()

    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Predio no encontrado o sin geometría cartográfica")

    lon = row.get("lon")
    lat = row.get("lat")
    ewkt = row.get("ewkt_32611")
    zonah = row.get("zonah") or ""
    zona_carto = None

    if get_geonode_conn is not None and ewkt:
        try:
            gconn = get_geonode_conn()
            gcur = gconn.cursor()
            zona_carto = _consultar_zona_homogenea_geonode(
                gcur, ewkt, ZONA_HOMOGENEA_TABLAS
            )
            gcur.close()
            gconn.close()
        except Exception:
            zona_carto = None

    if zona_carto is None and lon is not None and lat is not None:
        zona_carto = _consultar_carta_urbana_wms(
            float(lon), float(lat), ZONA_HOMOGENEA_WMS_LAYERS
        )
        if zona_carto:
            props = zona_carto.get("properties") or {}
            zona_carto["atributos"] = _normalizar_atributos_zona_homogenea(props)

    catalogo = _evolucion_zona_por_codigo(cur, zonah)
    if not catalogo and zona_carto:
        attrs = (zona_carto.get("atributos") or {})
        cod_carto = attrs.get("codigo") or ""
        if cod_carto:
            catalogo = _evolucion_zona_por_codigo(cur, cod_carto)

    anios = _obtener_anios_zh_catalogo(cur)
    cur.close()
    conn.close()

    wms_layer = (zona_carto or {}).get("layer") or ZONA_HOMOGENEA_WMS_LAYER
    mensaje = ""
    if not zona_carto:
        mensaje = (
            "No se intersectó el predio con la capa de zonas homogéneas. "
            "Verifique geometría del predio o la simbología geonode:zonahom2026_tij."
        )

    return {
        "clave_catastral": clave_norm,
        "uso_padron": row.get("uso_padron") or "",
        "colonia": row.get("colonia") or "",
        "delegacion": row.get("delegacion") or "",
        "calle": row.get("calle") or "",
        "numof": row.get("numof") or "",
        "zonah": zonah,
        "id_tasa": row.get("id_tasa") or "",
        "porcentaje_tasa": row.get("porcentaje_tasa"),
        "valor2026": row.get("valor2026"),
        "centroide": {"lon": lon, "lat": lat},
        "geometry": row.get("geometry"),
        "zona_carto": zona_carto,
        "catalogo": catalogo,
        "anios": anios,
        "wms_url": ZONA_HOMOGENEA_WMS_URL,
        "wms_layer": wms_layer,
        "wms_layers_intentadas": ZONA_HOMOGENEA_WMS_LAYERS,
        "mensaje": mensaje,
    }


@router.get("/padron/{clave}/zona-homogenea")
def zona_homogenea_padron(
    clave: str,
    usuario_actual: dict = Depends(requerir_pestana_zona_homogenea),
):
    """Consulta zona homogénea intersectando el predio (GeoNode + catálogo evolución)."""
    return _zona_homogenea_payload(clave)


@router.get("/predios/{clave}/zona-homogenea")
def zona_homogenea_predio(
    clave: str,
    usuario_actual: dict = Depends(requerir_pestana_zona_homogenea),
):
    """Alias de consulta zona homogénea."""
    return _zona_homogenea_payload(clave)


def _numeros_oficiales_cercanos_payload(clave: str, limite_misma_calle: int, limite_otras_calles: int):
    clave_norm = clave.upper().strip()
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral requerida")

    try:
        limite_misma_calle = min(max(limite_misma_calle, 1), 80)
        limite_otras_calles = min(max(limite_otras_calles, 0), 50)
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            WITH ref AS (
                SELECT
                    UPPER(TRIM(p.clave_catastral)) AS clave_catastral,
                    g.geom,
                    ST_PointOnSurface(g.geom) AS centro,
                    UPPER(TRIM(COALESCE(p.calle, ''))) AS calle_norm,
                    TRIM(COALESCE(p.numof, '')) AS numof,
                    TRIM(COALESCE(p.numint, '')) AS numint,
                    TRIM(COALESCE(p.letra, '')) AS letra,
                    ''::text AS cp,
                    TRIM(COALESCE(p.calle, '')) AS calle,
                    TRIM(COALESCE(p.colonia, '')) AS colonia,
                    ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json AS geometry
                FROM catalogos.padron_2026 p
                INNER JOIN catastro.predios g
                    ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                WHERE UPPER(TRIM(p.clave_catastral)) = %s
                  AND g.geom IS NOT NULL
                LIMIT 1
            ),
            candidatos AS (
                SELECT
                    UPPER(TRIM(p.clave_catastral)) AS clave_catastral,
                    TRIM(COALESCE(p.numof, '')) AS numof,
                    TRIM(COALESCE(p.numint, '')) AS numint,
                    TRIM(COALESCE(p.letra, '')) AS letra,
                    ''::text AS cp,
                    TRIM(COALESCE(p.calle, '')) AS calle,
                    TRIM(COALESCE(p.colonia, '')) AS colonia,
                    ROUND(ST_Distance(ST_PointOnSurface(g.geom), ref.centro)::numeric, 1)::float AS distancia_m,
                    (
                        ref.calle_norm <> ''
                        AND UPPER(TRIM(COALESCE(p.calle, ''))) = ref.calle_norm
                    ) AS misma_calle,
                    ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json AS geometry
                FROM catalogos.padron_2026 p
                INNER JOIN catastro.predios g
                    ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                CROSS JOIN ref
                WHERE g.geom IS NOT NULL
                  AND UPPER(TRIM(p.clave_catastral)) <> ref.clave_catastral
                  AND NULLIF(TRIM(COALESCE(p.numof, '')), '') IS NOT NULL
            ),
            misma_calle AS (
                SELECT *
                FROM candidatos
                WHERE misma_calle
                ORDER BY distancia_m
                LIMIT %s
            ),
            otras_calles AS (
                SELECT c.*
                FROM candidatos c
                WHERE NOT c.misma_calle
                  AND NOT EXISTS (
                      SELECT 1 FROM misma_calle m
                      WHERE m.clave_catastral = c.clave_catastral
                  )
                ORDER BY c.distancia_m
                LIMIT %s
            ),
            cercanos AS (
                SELECT * FROM misma_calle
                UNION ALL
                SELECT * FROM otras_calles
            )
            SELECT
                'consultado'::text AS tipo,
                ref.clave_catastral,
                ref.numof,
                ref.numint,
                ref.letra,
                ref.cp,
                ref.calle,
                ref.colonia,
                0::float AS distancia_m,
                TRUE AS misma_calle,
                ref.geometry
            FROM ref
            UNION ALL
            SELECT
                'cercano'::text AS tipo,
                c.clave_catastral,
                c.numof,
                c.numint,
                c.letra,
                c.cp,
                c.calle,
                c.colonia,
                c.distancia_m,
                c.misma_calle,
                c.geometry
            FROM cercanos c;
        """, (clave_norm, limite_misma_calle, limite_otras_calles))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        if not rows:
            raise HTTPException(status_code=404, detail="Predio no encontrado")

        consultado = None
        cercanos = []
        features = []

        for row in rows:
            item = {
                "clave_catastral": row.get("clave_catastral"),
                "numof": row.get("numof") or "",
                "numint": row.get("numint") or "",
                "letra": row.get("letra") or "",
                "cp": row.get("cp") or "",
                "calle": row.get("calle") or "",
                "colonia": row.get("colonia") or "",
                "distancia_m": float(row.get("distancia_m") or 0),
                "misma_calle": bool(row.get("misma_calle")),
                "geometry": row.get("geometry"),
            }
            geometry = item.pop("geometry")
            props = dict(item)
            props["es_consultado"] = row.get("tipo") == "consultado"
            if row.get("tipo") == "consultado":
                consultado = item
            else:
                cercanos.append(item)
            if geometry:
                features.append({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": props,
                })

        if consultado is None:
            raise HTTPException(status_code=404, detail="Predio sin geometría cartográfica")

        total_misma = sum(1 for c in cercanos if c.get("misma_calle"))
        total_otras = len(cercanos) - total_misma

        return {
            "clave_catastral": clave_norm,
            "limite_misma_calle": limite_misma_calle,
            "limite_otras_calles": limite_otras_calles,
            "total_misma_calle": total_misma,
            "total_otras_calles": total_otras,
            "total": len(cercanos),
            "consultado": consultado,
            "cercanos": cercanos,
            "type": "FeatureCollection",
            "features": features,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/catalogo/usos-tasa")
def listar_usos_tasa(usuario_actual: dict = Depends(obtener_usuario_actual)):
    """Catalogo de usos de suelo con tasa predial (catalogos.cat_tasas)."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, id_tasa, porcentaje_tasa, descripcion_uso
            FROM catalogos.cat_tasas
            WHERE activo = TRUE
              AND descripcion_uso IS NOT NULL
              AND TRIM(descripcion_uso) <> ''
            ORDER BY descripcion_uso;
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/catalogo/zonas-homogeneas")
def listar_zonas_homogeneas(
    anio: int = Query(2026, ge=2000, le=2100),
    q: str = Query("", max_length=120),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Catalogo de zonas homogeneas (Subsector+Homoclave+Seccion) por anio fiscal."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'catalogos'
                  AND table_name = 'cat_zonas_homogeneas_detalle'
            ) AS ok;
        """)
        tiene_detalle = bool((cur.fetchone() or {}).get("ok"))
        filtro = f"%{(q or '').strip()}%"

        if tiene_detalle:
            sql = """
                SELECT
                    id, anio, zona, sector, subsector, homoclave_col_fracc, seccion,
                    descripcion_col_fracc, valor_m2, codigo_zona_homogenea
                FROM catalogos.cat_zonas_homogeneas_detalle
                WHERE activo = TRUE AND anio = %s
            """
            params = [anio]
            if q and q.strip():
                sql += """
                  AND (
                    codigo_zona_homogenea ILIKE %s
                    OR descripcion_col_fracc ILIKE %s
                    OR subsector ILIKE %s
                    OR homoclave_col_fracc ILIKE %s
                  )
                """
                params.extend([filtro, filtro, filtro, filtro])
            sql += " ORDER BY codigo_zona_homogenea, descripcion_col_fracc;"
            cur.execute(sql, params)
        else:
            sql = """
                SELECT
                    id, anio,
                    NULL::TEXT AS zona,
                    NULL::TEXT AS sector,
                    NULL::TEXT AS subsector,
                    NULL::TEXT AS homoclave_col_fracc,
                    NULL::TEXT AS seccion,
                    zona_homogenea AS descripcion_col_fracc,
                    NULL::NUMERIC AS valor_m2,
                    zona_homogenea AS codigo_zona_homogenea
                FROM catalogos.cat_zonas_homogeneas
                WHERE activo = TRUE AND anio = %s
            """
            params = [anio]
            if q and q.strip():
                sql += " AND zona_homogenea ILIKE %s"
                params.append(filtro)
            sql += " ORDER BY zona_homogenea;"
            cur.execute(sql, params)

        rows = list(cur.fetchall())
        for row in rows:
            row["es_adicional"] = False
            row["tipo_zona"] = "OFICIAL"

        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'catalogos'
                  AND table_name = 'cat_zonas_homogeneas_adicionales'
            ) AS ok;
        """)
        if (cur.fetchone() or {}).get("ok"):
            sql_ad = """
                SELECT
                    id, anio,
                    NULL::TEXT AS zona,
                    NULL::TEXT AS sector,
                    subsector,
                    homoclave_col_fracc,
                    seccion,
                    descripcion_col_fracc,
                    valor_m2,
                    codigo_zona_homogenea,
                    tipo_zona
                FROM catalogos.cat_zonas_homogeneas_adicionales
                WHERE activo = TRUE AND anio = %s
            """
            params_ad = [anio]
            if q and q.strip():
                sql_ad += """
                  AND (
                    codigo_zona_homogenea ILIKE %s
                    OR descripcion_col_fracc ILIKE %s
                    OR subsector ILIKE %s
                    OR homoclave_col_fracc ILIKE %s
                  )
                """
                params_ad.extend([filtro, filtro, filtro, filtro])
            sql_ad += " ORDER BY codigo_zona_homogenea, descripcion_col_fracc;"
            cur.execute(sql_ad, params_ad)
            for row in cur.fetchall():
                row["es_adicional"] = True
                rows.append(row)

        cur.close()
        conn.close()
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


ANIOS_ZH_EVOLUCION = (2024, 2025, 2026)
ANIOS_ZH_RANGO = (2020, 2035)


def _obtener_anios_zh_catalogo(cur) -> list:
    """Anios con datos en catalogo oficial o adicional."""
    anios = set(ANIOS_ZH_EVOLUCION)
    if _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_detalle"):
        cur.execute("""
            SELECT DISTINCT anio
            FROM catalogos.cat_zonas_homogeneas_detalle
            WHERE activo = TRUE AND anio BETWEEN %s AND %s
            ORDER BY anio;
        """, ANIOS_ZH_RANGO)
        anios.update(int(r["anio"]) for r in cur.fetchall())
    if _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_adicionales"):
        cur.execute("""
            SELECT DISTINCT anio
            FROM catalogos.cat_zonas_homogeneas_adicionales
            WHERE activo = TRUE AND anio BETWEEN %s AND %s
            ORDER BY anio;
        """, ANIOS_ZH_RANGO)
        anios.update(int(r["anio"]) for r in cur.fetchall())
    return sorted(anios)


def _anio_referencia(anios: list) -> int:
    return int(max(anios)) if anios else 2026


def _sql_agg_valores_por_anio(anios: list) -> str:
    partes = []
    for an in anios:
        partes.append(f"MAX(valor_m2) FILTER (WHERE anio = {int(an)}) AS valor_{int(an)}")
    return ", ".join(partes)


def _construir_item_evolucion(row: dict, anios: list) -> dict:
    evolucion = []
    valores_anio = {}
    for an in anios:
        val = row.get(f"valor_{an}")
        fval = float(val) if val is not None else None
        valores_anio[an] = fval
        evolucion.append({"anio": an, "valor_m2": fval, "presente": fval is not None})

    presentes = [valores_anio[an] for an in anios if valores_anio[an] is not None]
    base = presentes[0] if presentes else None
    ultimo = presentes[-1] if presentes else None
    variacion_abs = None
    variacion_pct = None
    if base is not None and ultimo is not None:
        variacion_abs = float(ultimo) - float(base)
        if float(base) != 0:
            variacion_pct = round((float(ultimo) - float(base)) / float(base) * 100, 2)

    codigo_show = row.get("codigo_zona_homogenea") or row.get("clave_zonah")
    item = {
        "clave_zonah": row.get("clave_zonah"),
        "codigo_zona_homogenea": codigo_show,
        "zona": row.get("zona"),
        "sector": row.get("sector"),
        "subsector": row.get("subsector"),
        "homoclave_col_fracc": row.get("homoclave_col_fracc"),
        "seccion": row.get("seccion"),
        "descripcion_col_fracc": row.get("descripcion_col_fracc"),
        "evolucion": evolucion,
        "valores_por_anio": valores_anio,
        "variacion_abs": variacion_abs,
        "variacion_pct": variacion_pct,
        "variacion_desde": anios[0] if anios else None,
        "variacion_hasta": anios[-1] if anios else None,
        "es_adicional": bool(row.get("es_adicional")),
        "tipo_zona": row.get("tipo_zona") or "OFICIAL",
        "posicion": int(row.get("posicion") or 0),
    }
    for an, val in valores_anio.items():
        item[f"valor_{an}"] = val
    return item


def _validar_anio_operacion(anio: int, anios_catalogo: list) -> None:
    if anio < ANIOS_ZH_RANGO[0] or anio > ANIOS_ZH_RANGO[1]:
        raise HTTPException(status_code=400, detail=f"Anio fuera de rango permitido ({ANIOS_ZH_RANGO[0]}-{ANIOS_ZH_RANGO[1]})")


def _normalizar_clave_import(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").strip().upper())


def _parsear_fila_import(raw: dict, anio_default: int) -> Optional[dict]:
    """Normaliza encabezados CSV/Excel a fila de importacion."""
    if not raw:
        return None
    norm = {}
    for k, v in raw.items():
        key = re.sub(r"[^a-z0-9]", "", str(k or "").strip().lower())
        norm[key] = v

    def pick(*keys):
        for k in keys:
            if k in norm and str(norm[k]).strip() != "":
                return str(norm[k]).strip()
        return ""

    zona = pick("zona").upper()
    sector = pick("sector").upper()
    subsector = pick("subsector").upper()
    homoclave = pick("homoclavecolfrac", "homoclave", "homoclavecol").upper()
    seccion = pick("seccion").upper()
    descripcion = pick("descripcioncolfrac", "descripcion", "nombre", "descripcioncol").upper()
    codigo = _normalizar_clave_import(pick("codigozonahomogenea", "codigozona", "zonah", "codigo", "zonahomogenea"))
    if not codigo and subsector and homoclave and seccion:
        codigo = _codigo_zonah_desde_partes(subsector, homoclave, seccion)
    if codigo and not subsector:
        subsector = codigo

    valor_txt = pick("valorm2", "valor", "valorley", "valor_m2")
    if not valor_txt:
        return None
    try:
        valor_m2 = float(str(valor_txt).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None

    anio_txt = pick("anio", "ano", "year")
    try:
        anio = int(float(anio_txt)) if anio_txt else int(anio_default)
    except ValueError:
        anio = int(anio_default)

    if not (subsector and descripcion and codigo):
        return None

    return {
        "anio": anio,
        "zona": zona,
        "sector": sector,
        "subsector": subsector,
        "homoclave_col_fracc": homoclave,
        "seccion": seccion,
        "descripcion_col_fracc": descripcion,
        "valor_m2": valor_m2,
        "codigo_zona_homogenea": codigo,
    }


def _insertar_fila_zh_oficial(cur, fila: dict):
    cur.execute("""
        INSERT INTO catalogos.cat_zonas_homogeneas_detalle (
            anio, zona, sector, subsector, homoclave_col_fracc, seccion,
            descripcion_col_fracc, valor_m2, codigo_zona_homogenea, activo
        )
        VALUES (%(anio)s, %(zona)s, %(sector)s, %(subsector)s, %(homoclave_col_fracc)s,
                %(seccion)s, %(descripcion_col_fracc)s, %(valor_m2)s, %(codigo_zona_homogenea)s, TRUE)
        ON CONFLICT (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc)
        DO UPDATE SET
            valor_m2 = EXCLUDED.valor_m2,
            codigo_zona_homogenea = EXCLUDED.codigo_zona_homogenea,
            activo = TRUE
        RETURNING id, anio, codigo_zona_homogenea, valor_m2;
    """, fila)
    return cur.fetchone()


def _tabla_catalogo_existe(cur, nombre: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'catalogos' AND table_name = %s
        ) AS ok;
    """, (nombre,))
    return bool((cur.fetchone() or {}).get("ok"))


def _filas_zh_para_analisis(cur, anios):
    partes = []
    params = []
    if _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_detalle"):
        partes.append("""
            SELECT
                UPPER(TRIM(COALESCE(subsector, ''))) ||
                UPPER(TRIM(COALESCE(homoclave_col_fracc, ''))) ||
                UPPER(TRIM(COALESCE(seccion, ''))) AS clave_zonah,
                UPPER(TRIM(codigo_zona_homogenea)) AS codigo_zona_homogenea,
                zona, sector, subsector, homoclave_col_fracc, seccion,
                descripcion_col_fracc, anio, valor_m2,
                FALSE AS es_adicional, 'OFICIAL'::TEXT AS tipo_zona
            FROM catalogos.cat_zonas_homogeneas_detalle
            WHERE activo = TRUE AND anio = ANY(%s)
        """)
        params.append(list(anios))
    if _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_adicionales"):
        partes.append("""
            SELECT
                UPPER(TRIM(COALESCE(subsector, ''))) ||
                UPPER(TRIM(COALESCE(homoclave_col_fracc, ''))) ||
                UPPER(TRIM(COALESCE(seccion, ''))) AS clave_zonah,
                UPPER(TRIM(codigo_zona_homogenea)) AS codigo_zona_homogenea,
                NULL::TEXT AS zona, NULL::TEXT AS sector,
                subsector, homoclave_col_fracc, seccion,
                descripcion_col_fracc, anio, valor_m2,
                TRUE AS es_adicional, COALESCE(tipo_zona, 'ADICIONAL') AS tipo_zona
            FROM catalogos.cat_zonas_homogeneas_adicionales
            WHERE activo = TRUE AND anio = ANY(%s)
        """)
        params.append(list(anios))
    if not partes:
        return None, []
    return " UNION ALL ".join(partes), params


@router.get("/padron/analisis/zonas-homogeneas/filtros")
def filtros_analisis_zonas_homogeneas(
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Valores distintos para filtros del modulo de evolucion por anio."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        anios = _obtener_anios_zh_catalogo(cur)
        union_sql, union_params = _filas_zh_para_analisis(cur, anios)
        if not union_sql:
            cur.close()
            conn.close()
            return {"anios": anios, "zonas": [], "sectores": [], "subsectores": [], "total_claves": 0}

        cur.execute(f"""
            WITH filas AS ({union_sql})
            SELECT
                ARRAY(SELECT DISTINCT zona FROM filas WHERE zona IS NOT NULL AND TRIM(zona) <> '' ORDER BY zona) AS zonas,
                ARRAY(SELECT DISTINCT sector FROM filas WHERE sector IS NOT NULL AND TRIM(sector) <> '' ORDER BY sector) AS sectores,
                ARRAY(SELECT DISTINCT subsector FROM filas WHERE subsector IS NOT NULL AND TRIM(subsector) <> '' ORDER BY subsector) AS subsectores,
                COUNT(DISTINCT clave_zonah) AS total_claves
            FROM filas;
        """, union_params)
        row = cur.fetchone() or {}
        cur.close()
        conn.close()
        return {
            "anios": anios,
            "zonas": list(row.get("zonas") or []),
            "sectores": list(row.get("sectores") or []),
            "subsectores": list(row.get("subsectores") or []),
            "total_claves": int(row.get("total_claves") or 0),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/analisis/zonas-homogeneas/plantilla.csv")
def plantilla_importacion_zonas_homogeneas(
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Plantilla CSV para importar zonas homogeneas de un ejercicio."""
    header = "anio,zona,sector,subsector,homoclave_col_fracc,seccion,descripcion_col_fracc,valor_m2,codigo_zona_homogenea,zona_homogenea"
    ejemplo = "2027,Z1,A,MXH,BFS,A,EJEMPLO COLONIA FRACCIONAMIENTO,850.00,MXHBFSA,MXHBFSA"
    contenido = header + "\n" + ejemplo + "\n"
    return Response(
        content=contenido,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="plantilla_zonas_homogeneas_2027.csv"'},
    )


@router.get("/padron/analisis/zonas-homogeneas/evolucion")
def evolucion_zonas_homogeneas(
    zona: str = Query("", max_length=20),
    sector: str = Query("", max_length=20),
    subsector: str = Query("", max_length=20),
    codigo: str = Query("", max_length=40),
    anio: int = Query(0, ge=0, le=2100),
    q: str = Query("", max_length=120),
    limite: int = Query(200, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    indice: int = Query(0, ge=0),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Evolucion de valor/m2 por zona homogenea por ejercicios disponibles."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        anios = _obtener_anios_zh_catalogo(cur)
        anio_ref = _anio_referencia(anios)
        union_sql, union_params = _filas_zh_para_analisis(cur, anios)
        if not union_sql:
            cur.close()
            conn.close()
            return {"total": 0, "indice": 0, "resultados": [], "anios": anios}

        filtros = []
        params = list(union_params)
        if zona.strip():
            filtros.append("COALESCE(zona, '') ILIKE %s")
            params.append(zona.strip())
        if sector.strip():
            filtros.append("COALESCE(sector, '') ILIKE %s")
            params.append(sector.strip())
        if subsector.strip():
            filtros.append("COALESCE(subsector, '') ILIKE %s")
            params.append(subsector.strip())
        if codigo.strip():
            cod = f"%{codigo.strip()}%"
            filtros.append("(clave_zonah ILIKE %s OR codigo_zona_homogenea ILIKE %s)")
            params.extend([cod, cod])
        if q.strip():
            qq = f"%{q.strip()}%"
            filtros.append("""
                (
                    clave_zonah ILIKE %s
                    OR codigo_zona_homogenea ILIKE %s
                    OR descripcion_col_fracc ILIKE %s
                    OR subsector ILIKE %s
                    OR homoclave_col_fracc ILIKE %s
                )
            """)
            params.extend([qq, qq, qq, qq, qq])
        if anio and anio in anios:
            col = f"valor_{anio}"
            filtros.append(f"{col} IS NOT NULL")

        where_filtros = (" AND " + " AND ".join(filtros)) if filtros else ""
        agg_valores = _sql_agg_valores_por_anio(anios)

        sql = f"""
            WITH filas AS ({union_sql}),
            agg AS (
                SELECT
                    clave_zonah,
                    MAX(codigo_zona_homogenea) FILTER (WHERE anio = {anio_ref}) AS codigo_zona_homogenea,
                    MAX(codigo_zona_homogenea) AS codigo_referencia,
                    MAX(zona) FILTER (WHERE anio = {anio_ref}) AS zona,
                    MAX(sector) FILTER (WHERE anio = {anio_ref}) AS sector,
                    MAX(subsector) FILTER (WHERE anio = {anio_ref}) AS subsector,
                    MAX(homoclave_col_fracc) FILTER (WHERE anio = {anio_ref}) AS homoclave_col_fracc,
                    MAX(seccion) FILTER (WHERE anio = {anio_ref}) AS seccion,
                    MAX(descripcion_col_fracc) FILTER (WHERE anio = {anio_ref}) AS descripcion_col_fracc,
                    {agg_valores},
                    BOOL_OR(es_adicional) AS es_adicional,
                    MAX(tipo_zona) FILTER (WHERE es_adicional) AS tipo_zona
                FROM filas
                GROUP BY clave_zonah
            ),
            filtrado AS (
                SELECT * FROM agg WHERE clave_zonah <> '' {where_filtros}
            ),
            numerado AS (
                SELECT
                    COUNT(*) OVER() AS total,
                    ROW_NUMBER() OVER(ORDER BY clave_zonah) - 1 AS posicion,
                    f.*
                FROM filtrado f
            )
            SELECT * FROM numerado
            ORDER BY clave_zonah
            LIMIT %s OFFSET %s;
        """
        params.extend([limite, offset])
        cur.execute(sql, params)
        rows = cur.fetchall()

        total = int(rows[0]["total"]) if rows else 0
        resultados = [_construir_item_evolucion(row, anios) for row in rows]

        idx_resp = min(max(indice, 0), max(total - 1, 0))
        registro_final = None
        for r in resultados:
            if r.get("posicion") == idx_resp:
                registro_final = r
                break
        if not registro_final and resultados:
            registro_final = resultados[0]

        cur.close()
        conn.close()

        return {
            "total": total,
            "indice": idx_resp,
            "offset": offset,
            "limite": limite,
            "anios": anios,
            "resultados": resultados,
            "registro": registro_final or (resultados[0] if resultados else None),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ValorZonaAnio(BaseModel):
    anio: int
    valor_m2: Optional[float] = None


class AjusteZonaHomogeneaPayload(BaseModel):
    clave_zonah: str = Field(..., min_length=2, max_length=40)
    motivo: str = Field(..., min_length=3, max_length=500)
    descripcion_col_fracc: Optional[str] = None
    zona: Optional[str] = None
    sector: Optional[str] = None
    subsector: Optional[str] = None
    homoclave_col_fracc: Optional[str] = None
    seccion: Optional[str] = None
    valores: List[ValorZonaAnio]


def _clave_zonah_sql() -> str:
    return """
        UPPER(TRIM(COALESCE(subsector, ''))) ||
        UPPER(TRIM(COALESCE(homoclave_col_fracc, ''))) ||
        UPPER(TRIM(COALESCE(seccion, '')))
    """


def _codigo_zonah_desde_partes(subsector, homoclave, seccion) -> str:
    return f"{(subsector or '').strip()}{(homoclave or '').strip()}{(seccion or '').strip()}".upper()


def _obtener_fila_zh_oficial(cur, clave_zonah: str, anio: int):
    cur.execute(f"""
        SELECT *
        FROM catalogos.cat_zonas_homogeneas_detalle
        WHERE activo = TRUE AND anio = %s
          AND {_clave_zonah_sql()} = UPPER(TRIM(%s))
        LIMIT 1;
    """, (anio, clave_zonah))
    return cur.fetchone()


def _obtener_plantilla_zh_oficial(cur, clave_zonah: str, anio_objetivo: int):
    cur.execute(f"""
        SELECT *
        FROM catalogos.cat_zonas_homogeneas_detalle
        WHERE activo = TRUE
          AND {_clave_zonah_sql()} = UPPER(TRIM(%s))
        ORDER BY ABS(anio - %s), anio DESC
        LIMIT 1;
    """, (clave_zonah, anio_objetivo))
    return cur.fetchone()


def _obtener_fila_zh_adicional(cur, clave_zonah: str, anio: int):
    if not _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_adicionales"):
        return None
    cur.execute(f"""
        SELECT *
        FROM catalogos.cat_zonas_homogeneas_adicionales
        WHERE activo = TRUE AND anio = %s
          AND {_clave_zonah_sql()} = UPPER(TRIM(%s))
        LIMIT 1;
    """, (anio, clave_zonah))
    return cur.fetchone()


def _ajustar_valor_zh_oficial(cur, clave_zonah: str, anio: int, valor_m2: float, meta: dict):
    fila = _obtener_fila_zh_oficial(cur, clave_zonah, anio)
    if fila:
        sub = (meta.get("subsector") or fila.get("subsector") or "").strip().upper()
        hom = (meta.get("homoclave_col_fracc") or fila.get("homoclave_col_fracc") or "").strip().upper()
        sec = (meta.get("seccion") or fila.get("seccion") or "").strip().upper()
        zona = (meta.get("zona") or fila.get("zona") or "").strip().upper()
        sector = (meta.get("sector") or fila.get("sector") or "").strip().upper()
        desc = (meta.get("descripcion_col_fracc") or fila.get("descripcion_col_fracc") or "").strip().upper()
        codigo = _codigo_zonah_desde_partes(sub, hom, sec)
        cur.execute("""
            UPDATE catalogos.cat_zonas_homogeneas_detalle
            SET valor_m2 = %s,
                zona = %s,
                sector = %s,
                subsector = %s,
                homoclave_col_fracc = %s,
                seccion = %s,
                descripcion_col_fracc = %s,
                codigo_zona_homogenea = %s
            WHERE id = %s
            RETURNING id, anio, zona, sector, subsector, homoclave_col_fracc, seccion,
                      descripcion_col_fracc, valor_m2, codigo_zona_homogenea;
        """, (valor_m2, zona, sector, sub, hom, sec, desc, codigo, fila["id"]))
        return cur.fetchone()

    plantilla = _obtener_plantilla_zh_oficial(cur, clave_zonah, anio)
    if not plantilla and meta.get("subsector") and meta.get("homoclave_col_fracc") and meta.get("seccion"):
        plantilla = {
            "zona": meta.get("zona") or "",
            "sector": meta.get("sector") or "",
            "subsector": meta.get("subsector"),
            "homoclave_col_fracc": meta.get("homoclave_col_fracc"),
            "seccion": meta.get("seccion"),
            "descripcion_col_fracc": meta.get("descripcion_col_fracc") or clave_zonah,
        }
    if not plantilla:
        return None

    sub = (meta.get("subsector") or plantilla.get("subsector") or "").strip().upper()
    hom = (meta.get("homoclave_col_fracc") or plantilla.get("homoclave_col_fracc") or "").strip().upper()
    sec = (meta.get("seccion") or plantilla.get("seccion") or "").strip().upper()
    zona = (meta.get("zona") or plantilla.get("zona") or "").strip().upper()
    sector = (meta.get("sector") or plantilla.get("sector") or "").strip().upper()
    desc = (meta.get("descripcion_col_fracc") or plantilla.get("descripcion_col_fracc") or "").strip().upper()
    codigo = _codigo_zonah_desde_partes(sub, hom, sec)
    cur.execute("""
        INSERT INTO catalogos.cat_zonas_homogeneas_detalle (
            anio, zona, sector, subsector, homoclave_col_fracc, seccion,
            descripcion_col_fracc, valor_m2, codigo_zona_homogenea, activo
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        RETURNING id, anio, zona, sector, subsector, homoclave_col_fracc, seccion,
                  descripcion_col_fracc, valor_m2, codigo_zona_homogenea;
    """, (anio, zona, sector, sub, hom, sec, desc, valor_m2, codigo))
    return cur.fetchone()


def _ajustar_valor_zh_adicional(cur, clave_zonah: str, anio: int, valor_m2: float, meta: dict):
    if not _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_adicionales"):
        return None
    fila = _obtener_fila_zh_adicional(cur, clave_zonah, anio)
    if fila:
        sub = (meta.get("subsector") or fila.get("subsector") or "").strip().upper() or None
        hom = (meta.get("homoclave_col_fracc") or fila.get("homoclave_col_fracc") or "").strip().upper() or None
        sec = (meta.get("seccion") or fila.get("seccion") or "").strip().upper() or None
        desc = (meta.get("descripcion_col_fracc") or fila.get("descripcion_col_fracc") or "").strip().upper()
        codigo = _codigo_zonah_desde_partes(sub, hom, sec)
        cur.execute("""
            UPDATE catalogos.cat_zonas_homogeneas_adicionales
            SET valor_m2 = %s,
                subsector = %s,
                homoclave_col_fracc = %s,
                seccion = %s,
                descripcion_col_fracc = %s,
                codigo_zona_homogenea = %s
            WHERE id = %s
            RETURNING id, anio, subsector, homoclave_col_fracc, seccion,
                      descripcion_col_fracc, valor_m2, codigo_zona_homogenea, tipo_zona;
        """, (valor_m2, sub, hom, sec, desc, codigo, fila["id"]))
        return cur.fetchone()
    return None


@router.patch("/padron/analisis/zonas-homogeneas")
def ajustar_zona_homogenea(
    payload: AjusteZonaHomogeneaPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Corrige valor/m2, descripcion o clasificacion de una zona homogenea por ejercicio."""
    clave = payload.clave_zonah.strip().upper()
    if not clave:
        raise HTTPException(status_code=400, detail="Falta clave de zona homogenea")

    if not payload.valores:
        raise HTTPException(status_code=400, detail="Indique al menos un valor por anio")

    meta = {
        "zona": (payload.zona or "").strip().upper() or None,
        "sector": (payload.sector or "").strip().upper() or None,
        "subsector": (payload.subsector or "").strip().upper() or None,
        "homoclave_col_fracc": (payload.homoclave_col_fracc or "").strip().upper() or None,
        "seccion": (payload.seccion or "").strip().upper() or None,
        "descripcion_col_fracc": (payload.descripcion_col_fracc or "").strip().upper() or None,
    }

    try:
        conn = get_conn()
        cur = conn.cursor()
        if not _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_detalle"):
            cur.close()
            conn.close()
            raise HTTPException(status_code=500, detail="Catalogo de zonas homogeneas no disponible")

        actualizados = []
        for item in payload.valores:
            anio = int(item.anio)
            _validar_anio_operacion(anio, [])
            if item.valor_m2 is None:
                continue
            try:
                valor = float(item.valor_m2)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Valor invalido para {anio}")
            if valor < 0:
                raise HTTPException(status_code=400, detail=f"Valor negativo no permitido ({anio})")

            fila_ad = _obtener_fila_zh_adicional(cur, clave, anio)
            if fila_ad:
                row = _ajustar_valor_zh_adicional(cur, clave, anio, valor, meta)
            else:
                row = _ajustar_valor_zh_oficial(cur, clave, anio, valor, meta)
            if not row:
                raise HTTPException(
                    status_code=404,
                    detail=f"No se encontro la zona {clave} para actualizar/crear en {anio}",
                )
            actualizados.append(dict(row))

        if not actualizados:
            raise HTTPException(status_code=400, detail="No hubo valores para actualizar")

        conn.commit()
        usuario = usuario_actual.get("usuario") or "sistema"
        registrar_auditoria(
            usuario,
            "AJUSTE_ZONA_HOMOGENEA",
            "catalogos.cat_zonas_homogeneas_detalle",
            f"clave={clave}; anios={[r.get('anio') for r in actualizados]}; motivo={payload.motivo.strip()[:240]}",
        )
        cur.close()
        conn.close()
        return {"ok": True, "clave_zonah": clave, "actualizados": actualizados}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class NuevaZonaHomogeneaPayload(BaseModel):
    zona: str = Field(..., min_length=1, max_length=20)
    sector: str = Field(..., min_length=1, max_length=20)
    subsector: str = Field(..., min_length=1, max_length=20)
    homoclave_col_fracc: str = Field(..., min_length=1, max_length=20)
    seccion: str = Field(..., min_length=1, max_length=10)
    descripcion_col_fracc: str = Field(..., min_length=2, max_length=200)
    motivo: str = Field(..., min_length=3, max_length=500)
    tipo_registro: str = Field("OFICIAL", max_length=20)
    fundamento_legal: Optional[str] = None
    valores: List[ValorZonaAnio]


def _existe_zona_zh(cur, clave_zonah: str) -> bool:
    cur.execute(f"""
        SELECT 1 FROM catalogos.cat_zonas_homogeneas_detalle
        WHERE activo = TRUE AND {_clave_zonah_sql()} = UPPER(TRIM(%s))
        LIMIT 1;
    """, (clave_zonah,))
    if cur.fetchone():
        return True
    if _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_adicionales"):
        cur.execute(f"""
            SELECT 1 FROM catalogos.cat_zonas_homogeneas_adicionales
            WHERE activo = TRUE AND {_clave_zonah_sql()} = UPPER(TRIM(%s))
            LIMIT 1;
        """, (clave_zonah,))
        return bool(cur.fetchone())
    return False


def _insertar_zh_adicional(cur, anio: int, meta: dict, valor_m2: float, tipo_zona: str, fundamento: str, usuario: str):
    sub = meta["subsector"]
    hom = meta["homoclave_col_fracc"]
    sec = meta["seccion"]
    desc = meta["descripcion_col_fracc"]
    codigo = _codigo_zonah_desde_partes(sub, hom, sec)
    cur.execute("""
        INSERT INTO catalogos.cat_zonas_homogeneas_adicionales (
            anio, subsector, homoclave_col_fracc, seccion,
            codigo_zona_homogenea, descripcion_col_fracc, valor_m2,
            tipo_zona, fundamento_legal, usuario_registro, activo
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        RETURNING id, anio, codigo_zona_homogenea, valor_m2, tipo_zona;
    """, (anio, sub, hom, sec, codigo, desc, valor_m2, tipo_zona, fundamento, usuario))
    return cur.fetchone()


@router.post("/padron/analisis/zonas-homogeneas")
def crear_zona_homogenea(
    payload: NuevaZonaHomogeneaPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Registra una nueva zona homogenea en el catalogo fiscal o adicional."""
    meta = {
        "zona": payload.zona.strip().upper(),
        "sector": payload.sector.strip().upper(),
        "subsector": payload.subsector.strip().upper(),
        "homoclave_col_fracc": payload.homoclave_col_fracc.strip().upper(),
        "seccion": payload.seccion.strip().upper(),
        "descripcion_col_fracc": payload.descripcion_col_fracc.strip().upper(),
    }
    clave = _codigo_zonah_desde_partes(meta["subsector"], meta["homoclave_col_fracc"], meta["seccion"])
    if not clave:
        raise HTTPException(status_code=400, detail="No se pudo formar el codigo de zona homogenea")

    if not payload.valores:
        raise HTTPException(status_code=400, detail="Indique al menos un valor por anio")

    tipo = (payload.tipo_registro or "OFICIAL").strip().upper()
    if tipo not in {"OFICIAL", "ADICIONAL", "TEMPORAL"}:
        tipo = "OFICIAL"
    fundamento = (payload.fundamento_legal or payload.motivo or "").strip().upper()
    usuario = usuario_actual.get("usuario") or "sistema"

    try:
        conn = get_conn()
        cur = conn.cursor()
        if _existe_zona_zh(cur, clave):
            cur.close()
            conn.close()
            raise HTTPException(status_code=409, detail=f"La zona {clave} ya existe en el catalogo")

        creados = []
        for item in payload.valores:
            anio = int(item.anio)
            _validar_anio_operacion(anio, [])
            if item.valor_m2 is None:
                continue
            valor = float(item.valor_m2)
            if valor < 0:
                raise HTTPException(status_code=400, detail=f"Valor negativo no permitido ({anio})")

            if tipo in {"ADICIONAL", "TEMPORAL"}:
                if not _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_adicionales"):
                    raise HTTPException(status_code=500, detail="Tabla de zonas adicionales no disponible")
                row = _insertar_zh_adicional(cur, anio, meta, valor, tipo, fundamento, usuario)
            else:
                row = _ajustar_valor_zh_oficial(cur, clave, anio, valor, meta)
            if not row:
                raise HTTPException(status_code=500, detail=f"No se pudo crear la zona para {anio}")
            creados.append(dict(row))

        if not creados:
            raise HTTPException(status_code=400, detail="No hubo valores para registrar")

        conn.commit()
        registrar_auditoria(
            usuario,
            "CREAR_ZONA_HOMOGENEA",
            "catalogos.cat_zonas_homogeneas_detalle",
            f"clave={clave}; tipo={tipo}; anios={[r.get('anio') for r in creados]}; motivo={payload.motivo.strip()[:240]}",
        )
        cur.close()
        conn.close()
        return {"ok": True, "clave_zonah": clave, "creados": creados}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ImportZonaHomogeneaFila(BaseModel):
    anio: Optional[int] = None
    zona: str = ""
    sector: str = ""
    subsector: str = ""
    homoclave_col_fracc: str = ""
    seccion: str = ""
    descripcion_col_fracc: str
    valor_m2: float
    codigo_zona_homogenea: Optional[str] = None


class ImportZonasHomogeneasPayload(BaseModel):
    anio: int = Field(..., ge=ANIOS_ZH_RANGO[0], le=ANIOS_ZH_RANGO[1])
    reemplazar: bool = False
    filas: List[ImportZonaHomogeneaFila]


def _importar_filas_zonas(cur, anio_objetivo: int, filas: list, reemplazar: bool, usuario: str):
    if not _tabla_catalogo_existe(cur, "cat_zonas_homogeneas_detalle"):
        raise HTTPException(status_code=500, detail="Catalogo de zonas homogeneas no disponible")

    _validar_anio_operacion(anio_objetivo, [])

    if reemplazar:
        cur.execute("""
            DELETE FROM catalogos.cat_zonas_homogeneas_detalle
            WHERE anio = %s;
        """, (anio_objetivo,))

    insertados = 0
    actualizados = 0
    omitidos = 0
    errores = []

    for idx, raw in enumerate(filas, start=1):
        if isinstance(raw, dict):
            fila_in = dict(raw)
        else:
            fila_in = raw.dict() if hasattr(raw, "dict") else dict(raw)

        codigo = _normalizar_clave_import(fila_in.get("codigo_zona_homogenea") or "")
        if not codigo:
            codigo = _codigo_zonah_desde_partes(
                fila_in.get("subsector"), fila_in.get("homoclave_col_fracc"), fila_in.get("seccion"))

        try:
            valor = float(fila_in.get("valor_m2"))
        except (TypeError, ValueError):
            omitidos += 1
            errores.append(f"Fila {idx}: valor_m2 invalido")
            continue

        subsector_in = str(fila_in.get("subsector") or "").strip().upper()
        if codigo and not subsector_in:
            subsector_in = codigo

        fila = {
            "anio": int(fila_in.get("anio") or anio_objetivo),
            "zona": str(fila_in.get("zona") or "").strip().upper(),
            "sector": str(fila_in.get("sector") or "").strip().upper(),
            "subsector": subsector_in,
            "homoclave_col_fracc": str(fila_in.get("homoclave_col_fracc") or "").strip().upper(),
            "seccion": str(fila_in.get("seccion") or "").strip().upper(),
            "descripcion_col_fracc": str(fila_in.get("descripcion_col_fracc") or "").strip().upper(),
            "valor_m2": valor,
            "codigo_zona_homogenea": codigo,
        }

        if fila["anio"] != anio_objetivo:
            fila["anio"] = anio_objetivo

        if not all([fila["subsector"], fila["descripcion_col_fracc"], fila["codigo_zona_homogenea"]]):
            omitidos += 1
            errores.append(f"Fila {idx}: faltan campos obligatorios")
            continue

        prev = _obtener_fila_zh_oficial(cur, codigo, anio_objetivo)
        row = _insertar_fila_zh_oficial(cur, fila)
        if not row:
            omitidos += 1
            errores.append(f"Fila {idx}: no se pudo insertar {codigo}")
            continue
        if prev:
            actualizados += 1
        else:
            insertados += 1

    return {
        "anio": anio_objetivo,
        "insertados": insertados,
        "actualizados": actualizados,
        "omitidos": omitidos,
        "procesados": insertados + actualizados,
        "errores": errores[:50],
    }


@router.post("/padron/analisis/zonas-homogeneas/importar")
def importar_zonas_homogeneas_json(
    payload: ImportZonasHomogeneasPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Importa zonas homogeneas desde JSON (CSV/Excel parseado en frontend)."""
    if not payload.filas:
        raise HTTPException(status_code=400, detail="No hay filas para importar")
    if len(payload.filas) > 15000:
        raise HTTPException(status_code=400, detail="Maximo 15,000 filas por importacion")

    usuario = usuario_actual.get("usuario") or "sistema"
    try:
        conn = get_conn()
        cur = conn.cursor()
        resumen = _importar_filas_zonas(cur, payload.anio, payload.filas, payload.reemplazar, usuario)
        conn.commit()
        registrar_auditoria(
            usuario,
            "IMPORTAR_ZONAS_HOMOGENEAS",
            "catalogos.cat_zonas_homogeneas_detalle",
            f"anio={payload.anio}; procesados={resumen.get('procesados')}; reemplazar={payload.reemplazar}",
        )
        cur.close()
        conn.close()
        return {"ok": True, **resumen}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/padron/analisis/zonas-homogeneas/importar-archivo")
async def importar_zonas_homogeneas_archivo(
    archivo: UploadFile = File(...),
    anio: int = Form(2027),
    reemplazar: bool = Form(False),
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Importa CSV de zonas homogeneas para un ejercicio fiscal."""
    nombre = (archivo.filename or "").lower()
    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="Archivo vacio")

    filas_raw = []
    if nombre.endswith(".csv") or nombre.endswith(".txt"):
        texto = contenido.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(texto))
        filas_raw = list(reader)
    else:
        raise HTTPException(
            status_code=400,
            detail="Formato no soportado en servidor. Use CSV o importe Excel desde el modulo (se parsea en navegador).",
        )

    filas = []
    for raw in filas_raw:
        fila = _parsear_fila_import(raw, anio)
        if fila:
            filas.append(fila)

    if not filas:
        raise HTTPException(status_code=400, detail="No se encontraron filas validas en el archivo")

    payload = ImportZonasHomogeneasPayload(anio=anio, reemplazar=reemplazar, filas=filas)
    return importar_zonas_homogeneas_json(payload, usuario_actual)


class ImportAdeudoFila(BaseModel):
    clave_catastral: str
    adeudo: Optional[float] = None
    pago: Optional[str] = None


class ImportAdeudosPayload(BaseModel):
    ejercicio: int = Field(default=2026, ge=2020, le=2035)
    filas: List[ImportAdeudoFila]


def _normalizar_clave_adeudo(clave: str) -> str:
    return re.sub(r"\s+", "", str(clave or "").strip().upper())


def _es_pago_si(valor) -> bool:
    t = str(valor or "").strip().upper()
    if not t:
        return False
    return t in ("SI", "SÍ", "S", "1", "TRUE", "PAGADO", "PAGO", "YES", "Y")


def _parsear_monto_adeudo(raw) -> float:
    if raw is None or str(raw).strip() == "":
        return 0.0
    s = str(raw).strip().replace("$", "").replace(",", "").replace(" ", "")
    return max(0.0, float(s))


def _importar_lote_adeudos(cur, filas: list):
    valores = []
    omitidos = 0
    errores = []

    for i, raw in enumerate(filas):
        if isinstance(raw, dict):
            clave = _normalizar_clave_adeudo(raw.get("clave_catastral") or "")
            pago = raw.get("pago")
            adeudo_raw = raw.get("adeudo")
        else:
            clave = _normalizar_clave_adeudo(getattr(raw, "clave_catastral", "") or "")
            pago = getattr(raw, "pago", None)
            adeudo_raw = getattr(raw, "adeudo", None)

        if not clave:
            omitidos += 1
            continue
        try:
            monto = _parsear_monto_adeudo(adeudo_raw)
        except (ValueError, TypeError):
            errores.append(f"Fila {i + 1}: adeudo invalido ({clave})")
            continue

        if _es_pago_si(pago):
            adeudo_2026 = 0.0
            adeudo_total = 0.0
        else:
            adeudo_2026 = monto
            adeudo_total = monto

        valores.append((clave, adeudo_2026, adeudo_total))

    if not valores:
        return {
            "actualizados": 0,
            "no_encontrados": 0,
            "no_encontrados_muestra": [],
            "omitidos": omitidos,
            "errores": errores,
            "procesados": len(filas),
            "unicos": 0,
        }

    cur.execute("""
        CREATE TEMP TABLE tmp_adeudos_import (
            clave_catastral VARCHAR(30) PRIMARY KEY,
            adeudo_2026 NUMERIC,
            adeudo_total NUMERIC
        ) ON COMMIT DROP;
    """)

    execute_values(
        cur,
        """
        INSERT INTO tmp_adeudos_import (clave_catastral, adeudo_2026, adeudo_total)
        VALUES %s
        ON CONFLICT (clave_catastral) DO UPDATE
            SET adeudo_2026 = EXCLUDED.adeudo_2026,
                adeudo_total = EXCLUDED.adeudo_total
        """,
        valores,
        page_size=2000,
    )

    cur.execute("""
        UPDATE catalogos.padron_2026 p
        SET adeudo_2026 = t.adeudo_2026,
            adeudo_total = t.adeudo_total
        FROM tmp_adeudos_import t
        WHERE UPPER(TRIM(p.clave_catastral)) = t.clave_catastral
    """)
    actualizados = cur.rowcount

    cur.execute("""
        SELECT t.clave_catastral
        FROM tmp_adeudos_import t
        LEFT JOIN catalogos.padron_2026 p
            ON UPPER(TRIM(p.clave_catastral)) = t.clave_catastral
        WHERE p.clave_catastral IS NULL
        LIMIT 50
    """)
    no_enc_muestra = [r["clave_catastral"] for r in cur.fetchall()]

    cur.execute("""
        SELECT COUNT(*) AS total
        FROM tmp_adeudos_import t
        LEFT JOIN catalogos.padron_2026 p
            ON UPPER(TRIM(p.clave_catastral)) = t.clave_catastral
        WHERE p.clave_catastral IS NULL
    """)
    no_encontrados = int(cur.fetchone()["total"])

    return {
        "actualizados": actualizados,
        "no_encontrados": no_encontrados,
        "no_encontrados_muestra": no_enc_muestra,
        "omitidos": omitidos,
        "errores": errores,
        "procesados": len(filas),
        "unicos": len(valores),
    }


@router.post("/padron/mantenimiento/adeudos/importar")
def importar_adeudos_padron(
    payload: ImportAdeudosPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Importa adeudos fiscales al padrón (adeudo_2026 / adeudo_total) por clave catastral."""
    if not payload.filas:
        raise HTTPException(status_code=400, detail="No hay filas para importar")
    if len(payload.filas) > 15000:
        raise HTTPException(status_code=400, detail="Maximo 15,000 filas por lote")

    usuario = usuario_actual.get("usuario") or "sistema"
    try:
        conn = get_conn()
        cur = conn.cursor()
        resumen = _importar_lote_adeudos(cur, payload.filas)
        conn.commit()
        registrar_auditoria(
            usuario,
            "IMPORTAR_ADEUDOS_PADRON",
            "catalogos.padron_2026",
            (
                f"ejercicio={payload.ejercicio}; procesados={resumen.get('procesados')}; "
                f"actualizados={resumen.get('actualizados')}; no_encontrados={resumen.get('no_encontrados')}"
            ),
        )
        cur.close()
        conn.close()
        return {"ok": True, "ejercicio": payload.ejercicio, **resumen}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/mantenimiento/adeudos/plantilla.csv")
def plantilla_import_adeudos(
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Plantilla CSV para importación de adeudos (columnas del reporte fiscal)."""
    contenido = "CLAVECATASTRAL,ADEUDO,PAGO\nA1004003,106830,NO\nB2001001,0,SI\n"
    return Response(
        content=contenido,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="plantilla_adeudos_2026.csv"'},
    )


class ImportFolioFila(BaseModel):
    clave_catastral: str
    folio_real: Optional[str] = None


class ImportFoliosPayload(BaseModel):
    filas: List[ImportFolioFila]


def _normalizar_clave_folio(clave: str) -> str:
    return re.sub(r"\s+", "", str(clave or "").strip().upper())


def _parsear_folio_real(raw) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in ("0", "0.0", "000000", "---", "N/A", "NA", "S/N"):
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s[:32]


def _importar_lote_folios(cur, filas: list):
    valores = []
    omitidos = 0
    errores = []

    for i, raw in enumerate(filas):
        if isinstance(raw, dict):
            clave = _normalizar_clave_folio(raw.get("clave_catastral") or "")
            folio_raw = raw.get("folio_real")
        else:
            clave = _normalizar_clave_folio(getattr(raw, "clave_catastral", "") or "")
            folio_raw = getattr(raw, "folio_real", None)

        if not clave:
            omitidos += 1
            continue

        folio = _parsear_folio_real(folio_raw)
        valores.append((clave, folio))

    if not valores:
        return {
            "actualizados": 0,
            "no_encontrados": 0,
            "no_encontrados_muestra": [],
            "con_folio": 0,
            "sin_folio": 0,
            "omitidos": omitidos,
            "errores": errores,
            "procesados": len(filas),
            "unicos": 0,
        }

    cur.execute("""
        CREATE TEMP TABLE tmp_folios_import (
            clave_catastral VARCHAR(30) PRIMARY KEY,
            folio_real VARCHAR(32)
        ) ON COMMIT DROP;
    """)

    execute_values(
        cur,
        """
        INSERT INTO tmp_folios_import (clave_catastral, folio_real)
        VALUES %s
        ON CONFLICT (clave_catastral) DO UPDATE
            SET folio_real = EXCLUDED.folio_real
        """,
        valores,
        page_size=2000,
    )

    cur.execute("""
        UPDATE catalogos.padron_2026 p
        SET folio_real = t.folio_real
        FROM tmp_folios_import t
        WHERE UPPER(TRIM(p.clave_catastral)) = t.clave_catastral
    """)
    actualizados = cur.rowcount

    cur.execute("""
        SELECT COUNT(*)::int AS total
        FROM tmp_folios_import t
        WHERE t.folio_real IS NOT NULL
    """)
    con_folio = int(cur.fetchone()["total"])

    cur.execute("""
        SELECT COUNT(*)::int AS total
        FROM tmp_folios_import t
        WHERE t.folio_real IS NULL
    """)
    sin_folio = int(cur.fetchone()["total"])

    cur.execute("""
        SELECT t.clave_catastral
        FROM tmp_folios_import t
        LEFT JOIN catalogos.padron_2026 p
            ON UPPER(TRIM(p.clave_catastral)) = t.clave_catastral
        WHERE p.clave_catastral IS NULL
        LIMIT 50
    """)
    no_enc_muestra = [r["clave_catastral"] for r in cur.fetchall()]

    cur.execute("""
        SELECT COUNT(*) AS total
        FROM tmp_folios_import t
        LEFT JOIN catalogos.padron_2026 p
            ON UPPER(TRIM(p.clave_catastral)) = t.clave_catastral
        WHERE p.clave_catastral IS NULL
    """)
    no_encontrados = int(cur.fetchone()["total"])

    return {
        "actualizados": actualizados,
        "no_encontrados": no_encontrados,
        "no_encontrados_muestra": no_enc_muestra,
        "con_folio": con_folio,
        "sin_folio": sin_folio,
        "omitidos": omitidos,
        "errores": errores,
        "procesados": len(filas),
        "unicos": len(valores),
    }


@router.post("/padron/mantenimiento/folios/importar")
def importar_folios_padron(
    payload: ImportFoliosPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Importa folio real del expediente al padrón 2026 por clave catastral."""
    if not payload.filas:
        raise HTTPException(status_code=400, detail="No hay filas para importar")
    if len(payload.filas) > 20000:
        raise HTTPException(status_code=400, detail="Maximo 20,000 filas por lote")

    conn = get_conn()
    cur = conn.cursor()
    usuario = usuario_actual.get("usuario") or "sistema"
    try:
        asegurar_columna_folio_real_padron(cur, conn)
        resumen = _importar_lote_folios(cur, payload.filas)
        conn.commit()
        registrar_auditoria(
            usuario,
            "IMPORTAR_FOLIOS_PADRON",
            "catalogos.padron_2026",
            (
                f"procesados={resumen.get('procesados')}; "
                f"actualizados={resumen.get('actualizados')}; "
                f"con_folio={resumen.get('con_folio')}; "
                f"no_encontrados={resumen.get('no_encontrados')}"
            ),
        )
        return {"ok": True, **resumen}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@router.get("/padron/mantenimiento/folios/plantilla.csv")
def plantilla_import_folios(
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Plantilla CSV para importación de folio real por clave."""
    contenido = "CLAVE_CATASTRAL,FOLIO_REAL\nA1003001,194026\nA1004003,0\n"
    return Response(
        content=contenido,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="plantilla_folios_reales.csv"'},
    )


@router.get("/tiles/predios/{z}/{x}/{y}.pbf")
def tile_predios(z: int, x: int, y: int):
    try:
        conn = get_conn()
        cur = conn.cursor()
        join_col = _join_cat_colonias_predios_sql(cur, "p", "col")
        expr_col = _expr_colonia_padron_o_catalogo(cur, alias_pad="pad", alias_col="col")

        cur.execute(f"""
            WITH
            bounds AS (
                SELECT ST_TileEnvelope(%s, %s, %s) AS geom
            ),
            mvtgeom AS (
                SELECT
                    p.id,
                    p.clave_catastral,
                    {expr_col} AS colonia,
                    p.cp,
                    p.sup_documental AS superficie,
                    ST_AsMVTGeom(
                        ST_Transform(p.geom, 3857),
                        bounds.geom,
                        4096,
                        64,
                        true
                    ) AS geom
                FROM catastro.predios p
                LEFT JOIN catalogos.padron_2026 pad
                    ON UPPER(TRIM(pad.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                {join_col},
                    bounds
                WHERE p.geom IS NOT NULL
                  AND ST_Transform(p.geom, 3857) && bounds.geom
            )
            SELECT ST_AsMVT(
                mvtgeom,
                'predios',
                4096,
                'geom'
            ) AS tile
            FROM mvtgeom;
        """, (z, x, y))

        row = cur.fetchone()
        cur.close()
        conn.close()

        tile = row["tile"] if row and row["tile"] else b""

        return Response(
            content=bytes(tile),
            media_type="application/vnd.mapbox-vector-tile"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Análisis tipo de tenencia (campo padron.condominio: C, P, G, S, R, E) ---

CODIGOS_TENENCIA_PADRON = ("C", "P", "G", "S", "R", "E")
CODIGOS_TENENCIA_NO_CONDOMINIO = ("P", "G", "S", "R", "E")

TIPOS_CONDOMINIO_PADRON = {
    "C": {
        "codigo": "C",
        "nombre": "Condominio",
        "descripcion": "Predio en régimen de condominio (unidad o conjunto sujeto a la ley de condominio).",
    },
    "P": {
        "codigo": "P",
        "nombre": "Privado",
        "descripcion": "Propiedad privada individual.",
    },
    "G": {
        "codigo": "G",
        "nombre": "Gobierno / Pública",
        "descripcion": "Propiedad de gobierno o del sector público.",
    },
    "S": {
        "codigo": "S",
        "nombre": "Social",
        "descripcion": "Propiedad del sector social (vivienda social, ISSSTECALI, etc.).",
    },
    "R": {
        "codigo": "R",
        "nombre": "Rústica",
        "descripcion": "Propiedad de carácter rústico o uso no urbano.",
    },
    "E": {
        "codigo": "E",
        "nombre": "Ejidal",
        "descripcion": "Propiedad en régimen ejidal o comunal.",
    },
    "N": {
        "codigo": "N",
        "nombre": "Normal",
        "descripcion": "Valor histórico del padrón (reclasificar a P u otro tipo vigente).",
    },
    "NULL": {
        "codigo": "",
        "nombre": "Sin dato",
        "descripcion": "Campo vacío en padrón; debe asignarse un tipo de tenencia.",
    },
    "OTRO": {
        "codigo": "?",
        "nombre": "Otro valor",
        "descripcion": "Texto distinto a los códigos institucionales (revisar captura).",
    },
}

SQL_CODIGOS_TENENCIA_IN = "', '".join(CODIGOS_TENENCIA_PADRON + ("N",))

SQL_TIPO_CONDOMINIO = f"""
    CASE
        WHEN NULLIF(TRIM(p.condominio), '') IS NULL THEN 'NULL'
        WHEN UPPER(TRIM(p.condominio)) IN ('{SQL_CODIGOS_TENENCIA_IN}') THEN UPPER(TRIM(p.condominio))
        ELSE 'OTRO'
    END
"""

SQL_ORDEN_TENENCIA = f"""
    CASE {{expr}}
        WHEN 'C' THEN 1 WHEN 'P' THEN 2 WHEN 'G' THEN 3 WHEN 'S' THEN 4
        WHEN 'R' THEN 5 WHEN 'E' THEN 6 WHEN 'N' THEN 7 WHEN 'NULL' THEN 8 ELSE 9
    END
"""


def sql_orden_tenencia(expr_sql: str) -> str:
    return SQL_ORDEN_TENENCIA.format(expr=expr_sql)


def es_regimen_condominio_c(tipo: str) -> bool:
    return (tipo or "").strip().upper() == "C"


def normalizar_codigo_tenencia(valor: str) -> Optional[str]:
    txt = (valor or "").strip().upper()
    alias = {
        "PRIVADO": "P",
        "CONDOMINIO": "C",
        "GOBIERNO": "G",
        "PUBLICA": "G",
        "PUBLICO": "G",
        "SOCIAL": "S",
        "RUSTICA": "R",
        "RÚSTICA": "R",
        "EJIDAL": "E",
        "EJIDO": "E",
        "NORMAL": "N",
    }
    if txt in alias:
        txt = alias[txt]
    if txt in CODIGOS_TENENCIA_PADRON or txt == "N":
        return txt
    return None

SQL_VALOR_CONDOMINIO = "UPPER(TRIM(COALESCE(p.condominio, '')))"


def _etiqueta_tipo_condominio(tipo_key: str, valor_raw: str = "") -> dict:
    key = (tipo_key or "NULL").upper()
    if key == "OTRO" and valor_raw:
        return {
            "tipo": "OTRO",
            "tipo_codigo": valor_raw,
            "tipo_nombre": f"Otro ({valor_raw})",
            "tipo_descripcion": TIPOS_CONDOMINIO_PADRON["OTRO"]["descripcion"],
            "valor_padron": valor_raw,
        }
    meta = TIPOS_CONDOMINIO_PADRON.get(key, TIPOS_CONDOMINIO_PADRON["OTRO"])
    return {
        "tipo": key,
        "tipo_codigo": meta["codigo"] or None,
        "tipo_nombre": meta["nombre"],
        "tipo_descripcion": meta["descripcion"],
        "valor_padron": valor_raw or meta["codigo"] or None,
    }


def _condicion_filtro_tipo_condominio(tipo: str):
    """Devuelve (sql_fragment, params) para filtrar por tipo de condominio."""
    t = (tipo or "").strip().upper()
    if not t or t in ("TODOS", "ALL", "*"):
        return "TRUE", []
    if t in ("NULL", "VACIO", "SIN_DATO", "SIN-DATO"):
        return "NULLIF(TRIM(p.condominio), '') IS NULL", []
    if t == "OTRO":
        return f"NULLIF(TRIM(p.condominio), '') IS NOT NULL AND {SQL_TIPO_CONDOMINIO} = 'OTRO'", []
    codigo = normalizar_codigo_tenencia(t)
    if codigo:
        return "UPPER(TRIM(p.condominio)) = %s", [codigo]
    return "UPPER(TRIM(p.condominio)) = UPPER(TRIM(%s))", [tipo.strip()]


def _params_filtro_condominio(q: str, colonia: str, clave: str, condominio: str, clave_prefijo: str = ""):
    q_txt = (q or "").strip()
    colonia_txt = (colonia or "").strip()
    clave_txt = (clave or clave_prefijo or "").strip().upper()
    condominio_txt = (condominio or "").strip()
    return {
        "q_txt": q_txt,
        "q_like": f"%{q_txt}%",
        "colonia_txt": colonia_txt,
        "colonia_like": f"%{colonia_txt}%",
        "clave_txt": clave_txt,
        "clave_like": f"{clave_txt}%",
        "condominio_txt": condominio_txt,
        "condominio_like": f"%{condominio_txt}%",
    }


def _where_busqueda_condominio(
    tipo: str, colonia: str, q: str, valor_condominio: str = "", clave_prefijo: str = ""
):
    tipo_sql, tipo_params = _condicion_filtro_tipo_condominio(tipo)
    fp = _params_filtro_condominio(q, colonia, "", valor_condominio, clave_prefijo)
    if fp["clave_txt"]:
        filtro_clave = "UPPER(p.clave_catastral) LIKE UPPER(%s)"
        filtro_clave_params = [fp["clave_like"]]
        filtro_texto = """
            (%s = '' OR UPPER(TRIM(p.colonia)) LIKE UPPER(%s)
             OR UPPER(TRIM(p.calle)) LIKE UPPER(%s))
        """
        filtro_texto_params = [fp["q_txt"], fp["q_like"], fp["q_like"]]
    else:
        filtro_clave = "(%s = '' OR TRUE)"
        filtro_clave_params = [fp["clave_txt"]]
        filtro_texto = """
            (
                %s = ''
                OR UPPER(p.clave_catastral) LIKE UPPER(%s)
                OR UPPER(TRIM(p.colonia)) LIKE UPPER(%s)
                OR UPPER(TRIM(p.calle)) LIKE UPPER(%s)
            )
        """
        filtro_texto_params = [fp["q_txt"], fp["q_like"], fp["q_like"], fp["q_like"]]

    where = f"""
        ({tipo_sql})
        AND ({filtro_clave})
        AND (%s = '' OR UPPER(TRIM(p.colonia)) LIKE UPPER(%s))
        AND {filtro_texto}
    """
    params = (
        *tipo_params,
        *filtro_clave_params,
        fp["colonia_txt"], fp["colonia_like"],
        *filtro_texto_params,
    )
    return where, params


def _where_unidades_condominio(
    tipo: str, colonia: str, clave: str, q: str, valor_condominio: str, clave_prefijo: str = ""
):
    tipo_sql, tipo_params = _condicion_filtro_tipo_condominio(tipo if tipo else "")
    fp = _params_filtro_condominio(q, colonia, clave or clave_prefijo, valor_condominio, clave_prefijo)

    if valor_condominio:
        val = valor_condominio.strip().upper()
        codigo_ten = normalizar_codigo_tenencia(val)
        if codigo_ten:
            cond_val = "UPPER(TRIM(p.condominio)) = %s"
            val_params = [codigo_ten]
        elif val == "NULL":
            cond_val = "NULLIF(TRIM(p.condominio), '') IS NULL"
            val_params = []
        elif val == "OTRO":
            cond_val = f"NULLIF(TRIM(p.condominio), '') IS NOT NULL AND {SQL_TIPO_CONDOMINIO} = 'OTRO'"
            val_params = []
        else:
            cond_val = "UPPER(TRIM(p.condominio)) = UPPER(TRIM(%s))"
            val_params = [valor_condominio.strip()]
    else:
        cond_val = "(%s = '' OR UPPER(TRIM(p.condominio)) LIKE UPPER(%s))"
        val_params = [fp["condominio_txt"], fp["condominio_like"]]

    if fp["clave_txt"]:
        filtro_clave = "UPPER(p.clave_catastral) LIKE UPPER(%s)"
        filtro_clave_params = [fp["clave_like"]]
        filtro_texto = """
            (
                %s = ''
                OR UPPER(TRIM(p.colonia)) LIKE UPPER(%s)
                OR UPPER(TRIM(p.calle)) LIKE UPPER(%s)
                OR UPPER(COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo)) LIKE UPPER(%s)
            )
        """
        filtro_texto_params = [fp["q_txt"], fp["q_like"], fp["q_like"], fp["q_like"]]
    else:
        filtro_clave = "(%s = '' OR TRUE)"
        filtro_clave_params = [fp["clave_txt"]]
        filtro_texto = """
            (
                %s = ''
                OR UPPER(p.clave_catastral) LIKE UPPER(%s)
                OR UPPER(COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo)) LIKE UPPER(%s)
                OR UPPER(TRIM(p.colonia)) LIKE UPPER(%s)
                OR UPPER(TRIM(p.calle)) LIKE UPPER(%s)
            )
        """
        filtro_texto_params = [fp["q_txt"], fp["q_like"], fp["q_like"], fp["q_like"], fp["q_like"]]

    where = f"""
        ({tipo_sql})
        AND {cond_val}
        AND ({filtro_clave})
        AND (%s = '' OR UPPER(TRIM(p.colonia)) LIKE UPPER(%s))
        AND {filtro_texto}
    """
    params = (
        *tipo_params,
        *val_params,
        *filtro_clave_params,
        fp["colonia_txt"], fp["colonia_like"],
        *filtro_texto_params,
    )
    return where, params


@router.get("/padron/condominios/tipos")
def tipos_condominio_padron(
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Catálogo institucional de tipos y conteo real en padrón."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"""
            SELECT
                {SQL_TIPO_CONDOMINIO} AS tipo,
                {SQL_VALOR_CONDOMINIO} AS valor_padron,
                COUNT(*)::int AS unidades
            FROM catalogos.padron_2026 p
            GROUP BY 1, 2
            ORDER BY 1, 3 DESC, 2;
        """)
        filas = cur.fetchall()
        cur.close()
        conn.close()

        agrupado = {}
        otros = []
        for row in filas:
            tipo_key = row.get("tipo") or "NULL"
            valor = row.get("valor_padron") or ""
            unidades = int(row.get("unidades") or 0)
            if tipo_key == "OTRO":
                otros.append({"valor_padron": valor, "unidades": unidades})
                continue
            if tipo_key not in agrupado:
                info = _etiqueta_tipo_condominio(tipo_key, valor if tipo_key not in ("NULL",) else "")
                agrupado[tipo_key] = {
                    **info,
                    "unidades": 0,
                    "valores_padron": [],
                }
            agrupado[tipo_key]["unidades"] += unidades
            if valor and valor not in agrupado[tipo_key]["valores_padron"]:
                agrupado[tipo_key]["valores_padron"].append(valor)

        if otros:
            agrupado["OTRO"] = {
                **_etiqueta_tipo_condominio("OTRO"),
                "unidades": sum(x["unidades"] for x in otros),
                "valores_padron": [x["valor_padron"] for x in otros[:50]],
                "otros_detalle": otros[:50],
            }

        orden = ["C", "P", "G", "S", "R", "E", "N", "NULL", "OTRO"]
        tipos = [agrupado[k] for k in orden if k in agrupado]
        return {
            "tipos_institucionales": [TIPOS_CONDOMINIO_PADRON[k] for k in CODIGOS_TENENCIA_PADRON],
            "tipos_en_padron": tipos,
            "nota": "Tipo de tenencia en padron.condominio: C Condominio · P Privado · G Gobierno/Pública · S Social · R Rústica · E Ejidal.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/condominios/resumen")
def resumen_condominios_padron(
    tipo: str = Query("", max_length=20),
    clave_prefijo: str = Query("", max_length=20),
    colonia: str = Query("", max_length=150),
    q: str = Query("", max_length=150),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Totales del padrón filtrados por tipo de tenencia."""
    try:
        pref = (clave_prefijo or "").strip().upper()
        where, params = _where_busqueda_condominio(tipo, colonia, q, "", pref)
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"""
            SELECT
                COUNT(*)::int AS total_unidades,
                COUNT(DISTINCT {SQL_TIPO_CONDOMINIO})::int AS total_tipos,
                COALESCE(SUM(p.valor2026), 0)::float AS valor_total_2026,
                COALESCE(SUM(p.adeudo_2026), 0)::float AS adeudo_2026,
                COALESCE(SUM(p.adeudo_total), 0)::float AS adeudo_total
            FROM catalogos.padron_2026 p
            WHERE {where};
        """, params)
        row = cur.fetchone() or {}

        cur.execute(f"""
            SELECT
                {SQL_TIPO_CONDOMINIO} AS tipo,
                COUNT(*)::int AS unidades,
                COALESCE(SUM(p.valor2026), 0)::float AS valor_total
            FROM catalogos.padron_2026 p
            GROUP BY 1
            ORDER BY {sql_orden_tenencia(SQL_TIPO_CONDOMINIO)};
        """)
        por_tipo = []
        for r in cur.fetchall():
            info = _etiqueta_tipo_condominio(r.get("tipo") or "NULL")
            por_tipo.append({
                **info,
                "unidades": int(r.get("unidades") or 0),
                "valor_total": float(r.get("valor_total") or 0),
            })

        cur.close()
        conn.close()
        filtro = (tipo or "").strip().upper() or "TODOS"
        return {
            "criterio": "campo padron.condominio (tipo de tenencia)",
            "filtro_tipo": filtro,
            "clave_prefijo": pref or None,
            **dict(row),
            "total_condominios": row.get("total_tipos"),
            "por_tipo": por_tipo,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/condominios/catalogo")
def catalogo_condominios_padron(
    tipo: str = Query("", max_length=20),
    q: str = Query("", max_length=150),
    colonia: str = Query("", max_length=150),
    clave: str = Query("", max_length=50),
    clave_prefijo: str = Query("", max_length=20),
    limite: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Agrupa predios por tipo de tenencia."""
    try:
        limite = min(max(limite, 1), 1000)
        pref = (clave_prefijo or clave or "").strip().upper()
        where, params_base = _where_busqueda_condominio(tipo, colonia, q, "", pref)
        conn = get_conn()
        cur = conn.cursor()

        cur.execute(f"""
            SELECT COUNT(*)::int AS total
            FROM (
                SELECT {SQL_TIPO_CONDOMINIO} AS tipo, {SQL_VALOR_CONDOMINIO} AS valor_padron
                FROM catalogos.padron_2026 p
                WHERE {where}
                GROUP BY 1, 2
            ) t;
        """, params_base)
        total = int((cur.fetchone() or {}).get("total") or 0)

        cur.execute(f"""
            SELECT
                {SQL_TIPO_CONDOMINIO} AS tipo,
                {SQL_VALOR_CONDOMINIO} AS valor_padron,
                COUNT(*)::int AS unidades,
                COUNT(DISTINCT NULLIF(TRIM(p.colonia), ''))::int AS colonias,
                COALESCE(SUM(p.valor2026), 0)::float AS valor_total,
                COALESCE(SUM(p.adeudo_total), 0)::float AS adeudo_total
            FROM catalogos.padron_2026 p
            WHERE {where}
            GROUP BY 1, 2
            ORDER BY
                {sql_orden_tenencia(SQL_TIPO_CONDOMINIO)},
                unidades DESC,
                valor_padron
            LIMIT %s OFFSET %s;
        """, params_base + (limite, offset))

        resultados = []
        for row in cur.fetchall():
            info = _etiqueta_tipo_condominio(row.get("tipo") or "NULL", row.get("valor_padron") or "")
            resultados.append({
                **info,
                "condominio": row.get("valor_padron") or info.get("tipo_codigo") or info.get("tipo"),
                "unidades": int(row.get("unidades") or 0),
                "colonias": int(row.get("colonias") or 0),
                "valor_total": float(row.get("valor_total") or 0),
                "adeudo_total": float(row.get("adeudo_total") or 0),
            })

        cur.close()
        conn.close()
        return {
            "total": total,
            "limite": limite,
            "offset": offset,
            "filtro_tipo": (tipo or "").strip().upper() or "TODOS",
            "clave_prefijo": pref or None,
            "resultados": resultados,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/condominios/unidades")
def unidades_condominio_padron(
    tipo: str = Query("", max_length=20),
    condominio: str = Query("", max_length=150),
    q: str = Query("", max_length=150),
    colonia: str = Query("", max_length=150),
    clave: str = Query("", max_length=50),
    clave_prefijo: str = Query("", max_length=20),
    limite: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    """Unidades del padrón filtradas por tipo de tenencia."""
    try:
        limite = min(max(limite, 1), 5000)
        pref = (clave_prefijo or clave or "").strip().upper()
        valor = condominio or tipo
        where_sql, params_where = _where_unidades_condominio(
            tipo, colonia, pref, q, valor, pref
        )
        conn = get_conn()
        cur = conn.cursor()
        asegurar_tabla_predio_condominio(cur, conn)

        cur.execute(f"""
            SELECT COUNT(*)::int AS total
            {SQL_FROM_PADRON_UNICO}
            WHERE {where_sql};
        """, params_where)
        total = int((cur.fetchone() or {}).get("total") or 0)

        cur.execute(f"""
            SELECT
                p.clave_catastral,
                {SQL_TIPO_CONDOMINIO} AS tipo_condominio,
                {SQL_VALOR_CONDOMINIO} AS condominio,
                COALESCE(
                    NULLIF(TRIM(tit.nombre_visible), ''),
                    NULLIF(TRIM(tit.titular_principal), ''),
                    NULLIF(TRIM(p.nombre_completo), '')
                ) AS nombre_completo,
                p.colonia,
                p.calle,
                p.numof,
                p.numint,
                p.letra,
                p.zonah AS zona_homogenea,
                p.valor2026,
                p.adeudo_2026,
                p.adeudo_total,
                p.sup_documental,
                p.sup_const,
                p.descripcion_uso,
                pc.modalidad,
                pc.nombre_condominio,
                CASE WHEN g.id IS NOT NULL AND g.geom IS NOT NULL THEN TRUE ELSE FALSE END AS dibujado
            {SQL_FROM_PADRON_UNICO}
            LEFT JOIN catastro.predio_condominio pc
                ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
            WHERE {where_sql}
            ORDER BY p.colonia, p.calle, p.numof, p.numint, p.clave_catastral
            LIMIT %s OFFSET %s;
        """, params_where + (limite, offset))

        resultados = []
        for row in cur.fetchall():
            item = dict(row)
            info = _etiqueta_tipo_condominio(item.get("tipo_condominio") or "NULL", item.get("condominio") or "")
            item.update({
                "tipo": info["tipo"],
                "tipo_nombre": info["tipo_nombre"],
                "tipo_descripcion": info["tipo_descripcion"],
            })
            resultados.append(item)

        cur.close()
        conn.close()
        return {
            "total": total,
            "limite": limite,
            "offset": offset,
            "tipo": (tipo or "").strip().upper() or None,
            "condominio": (condominio or "").strip().upper() or None,
            "clave_prefijo": pref or None,
            "resultados": resultados,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TenenciaPadronPayload(BaseModel):
    tenencia: str
    confirmar: bool = True


class TenenciaMasivaPadronPayload(BaseModel):
    claves: list[str] = Field(default_factory=list)
    tenencia: str
    confirmar: bool = True


class TenenciaPrefijoPadronPayload(BaseModel):
    prefijo: str
    tenencia: str
    tipo_actual: str = ""
    confirmar: bool = True


def _aplicar_tenencia_predio(cur, clave: str, tenencia: str, usuario: str = "sistema") -> dict:
    clave_norm = (clave or "").strip().upper()
    codigo = normalizar_codigo_tenencia(tenencia)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Indique la clave catastral.")
    if not codigo or codigo not in CODIGOS_TENENCIA_PADRON:
        raise HTTPException(
            status_code=400,
            detail="Tipo de tenencia inválido. Use C, P, G, S, R o E.",
        )

    cur.execute("""
        SELECT clave_catastral, UPPER(TRIM(COALESCE(condominio, ''))) AS condominio
        FROM catalogos.padron_2026
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        LIMIT 1;
    """, (clave_norm,))
    prev = cur.fetchone()
    if not prev:
        raise HTTPException(status_code=404, detail="Predio no encontrado en padrón.")

    cur.execute("""
        UPDATE catalogos.padron_2026
        SET condominio = %s
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        RETURNING clave_catastral, condominio;
    """, (codigo, clave_norm))
    row = cur.fetchone()

    if codigo != "C":
        cur.execute("""
            DELETE FROM catastro.predio_condominio
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
        """, (clave_norm,))

    registrar_auditoria(
        usuario,
        "ACTUALIZAR_TENENCIA_PADRON",
        clave_norm,
        f"tenencia={codigo}; anterior={prev.get('condominio') or 'NULL'}",
    )
    info = _etiqueta_tipo_condominio(codigo, codigo)
    return {
        "clave_catastral": row.get("clave_catastral"),
        "tenencia": codigo,
        **info,
    }


@router.put("/padron/tenencia/masiva")
def actualizar_tenencia_masiva(
    payload: TenenciaMasivaPadronPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Asignación masiva de tipo de tenencia."""
    if not payload.confirmar:
        raise HTTPException(status_code=400, detail="Debe enviar confirmar=true.")
    claves = []
    vistos = set()
    for raw in payload.claves or []:
        cl = (raw or "").strip().upper()
        if cl and cl not in vistos:
            vistos.add(cl)
            claves.append(cl)
    if not claves:
        raise HTTPException(status_code=400, detail="Indique al menos una clave catastral.")
    codigo = normalizar_codigo_tenencia(payload.tenencia)
    if not codigo or codigo not in CODIGOS_TENENCIA_PADRON:
        raise HTTPException(status_code=400, detail="Tipo de tenencia inválido. Use C, P, G, S, R o E.")

    try:
        conn = get_conn()
        cur = conn.cursor()
        asegurar_tabla_predio_condominio(cur, conn)
        usuario = usuario_actual.get("usuario") or "sistema"
        actualizadas = 0
        omitidas = []
        for cl in claves:
            try:
                _aplicar_tenencia_predio(cur, cl, codigo, usuario)
                actualizadas += 1
            except HTTPException as exc:
                if exc.status_code == 404:
                    omitidas.append(cl)
                else:
                    raise
        registrar_auditoria(
            usuario,
            "TENENCIA_MASIVA_PADRON",
            "catalogos.padron_2026",
            f"tenencia={codigo}; actualizadas={actualizadas}; omitidas={len(omitidas)}",
        )
        conn.commit()
        cur.close()
        conn.close()
        info = _etiqueta_tipo_condominio(codigo, codigo)
        return {
            "ok": True,
            "actualizadas": actualizadas,
            "omitidas": omitidas,
            "tenencia": codigo,
            "tipo_nombre": info.get("tipo_nombre"),
            "mensaje": f"Se asignó tenencia {info.get('tipo_nombre')} ({codigo}) a {actualizadas} predio(s).",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/tenencia/por-prefijo/resumen")
def resumen_tenencia_por_prefijo(
    prefijo: str = Query(..., min_length=1, max_length=20),
    tipo_actual: str = Query("", max_length=5),
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Vista previa: predios cuya clave empieza con el prefijo indicado."""
    pref = (prefijo or "").strip().upper()
    if not pref:
        raise HTTPException(status_code=400, detail="Indique el prefijo de clave (ej. RU).")
    try:
        conn = get_conn()
        cur = conn.cursor()
        where = ["UPPER(p.clave_catastral) LIKE %s"]
        params = [f"{pref}%"]
        if tipo_actual:
            cod = normalizar_codigo_tenencia(tipo_actual)
            if cod:
                where.append("UPPER(TRIM(p.condominio)) = %s")
                params.append(cod)
        where_sql = " AND ".join(where)

        cur.execute(f"""
            SELECT COUNT(*)::int AS total FROM catalogos.padron_2026 p WHERE {where_sql};
        """, params)
        total = int((cur.fetchone() or {}).get("total") or 0)

        cur.execute(f"""
            SELECT UPPER(TRIM(COALESCE(p.condominio, ''))) AS tenencia, COUNT(*)::int AS n
            FROM catalogos.padron_2026 p WHERE {where_sql}
            GROUP BY 1 ORDER BY 2 DESC;
        """, params)
        por_tenencia = [{"tenencia": r.get("tenencia") or "NULL", "total": r.get("n")} for r in cur.fetchall()]

        cur.execute(f"""
            SELECT p.clave_catastral, p.condominio, p.colonia, p.calle
            FROM catalogos.padron_2026 p WHERE {where_sql}
            ORDER BY p.clave_catastral LIMIT 15;
        """, params)
        muestra = [dict(r) for r in cur.fetchall()]
        cur.close()
        conn.close()
        return {
            "prefijo": pref,
            "total": total,
            "por_tenencia": por_tenencia,
            "muestra": muestra,
            "tipo_actual_filtro": tipo_actual or None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/padron/tenencia/por-prefijo")
def aplicar_tenencia_por_prefijo(
    payload: TenenciaPrefijoPadronPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Asigna tenencia a todas las claves que empiezan con el prefijo."""
    if not payload.confirmar:
        raise HTTPException(status_code=400, detail="Debe enviar confirmar=true.")
    pref = (payload.prefijo or "").strip().upper()
    if not pref:
        raise HTTPException(status_code=400, detail="Indique el prefijo de clave (ej. RU).")
    codigo = normalizar_codigo_tenencia(payload.tenencia)
    if not codigo or codigo not in CODIGOS_TENENCIA_PADRON:
        raise HTTPException(status_code=400, detail="Tipo de tenencia inválido. Use C, P, G, S, R o E.")

    where = ["UPPER(p.clave_catastral) LIKE %s"]
    params = [f"{pref}%"]
    if payload.tipo_actual:
        cod_f = normalizar_codigo_tenencia(payload.tipo_actual)
        if cod_f:
            where.append("UPPER(TRIM(p.condominio)) = %s")
            params.append(cod_f)
    where_sql = " AND ".join(where)

    try:
        conn = get_conn()
        cur = conn.cursor()
        asegurar_tabla_predio_condominio(cur, conn)
        usuario = usuario_actual.get("usuario") or "sistema"

        cur.execute(f"SELECT COUNT(*)::int AS total FROM catalogos.padron_2026 p WHERE {where_sql};", params)
        pendientes = int((cur.fetchone() or {}).get("total") or 0)
        if pendientes <= 0:
            cur.close()
            conn.close()
            return {"ok": True, "actualizadas": 0, "mensaje": "No hay predios con ese prefijo de clave."}

        cur.execute(f"""
            UPDATE catalogos.padron_2026 p SET condominio = %s WHERE {where_sql};
        """, [codigo, *params])
        actualizadas = cur.rowcount or pendientes

        if codigo != "C":
            cur.execute(f"""
                DELETE FROM catastro.predio_condominio pc
                WHERE EXISTS (
                    SELECT 1 FROM catalogos.padron_2026 p
                    WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(pc.clave_catastral))
                      AND {where_sql}
                );
            """, params)

        registrar_auditoria(
            usuario,
            "TENENCIA_PREFIJO_PADRON",
            pref,
            f"tenencia={codigo}; actualizadas={actualizadas}; tipo_actual={payload.tipo_actual or 'TODOS'}",
        )
        conn.commit()
        cur.close()
        conn.close()
        info = _etiqueta_tipo_condominio(codigo, codigo)
        return {
            "ok": True,
            "actualizadas": actualizadas,
            "prefijo": pref,
            "tenencia": codigo,
            "tipo_nombre": info.get("tipo_nombre"),
            "mensaje": f"Se asignó {info.get('tipo_nombre')} ({codigo}) a {actualizadas} clave(s) que empiezan con {pref}.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Actualización masiva de régimen en padrón (NULL/N → P, etc.) ---

SQL_PADRON_SIN_DATO = "NULLIF(TRIM(p.condominio), '') IS NULL"

SQL_EXCLUIR_CONDOMINIO_CATASTRO = """
    NOT EXISTS (
        SELECT 1
        FROM catastro.predio_condominio pc
        WHERE UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
          AND (
              UPPER(TRIM(COALESCE(pc.regimen_catastro, ''))) = 'C'
              OR UPPER(TRIM(COALESCE(pc.modalidad, ''))) IN ('VERTICAL', 'HORIZONTAL')
          )
    )
"""

ORIGENES_REGIMEN_PADRON_SQL = {
    "NULL": SQL_PADRON_SIN_DATO,
    "SIN_DATO": SQL_PADRON_SIN_DATO,
    "VACIO": SQL_PADRON_SIN_DATO,
    "N": "UPPER(TRIM(p.condominio)) = 'N'",
    "NORMAL": "UPPER(TRIM(p.condominio)) = 'N'",
    "P": "UPPER(TRIM(p.condominio)) = 'P'",
    "PRIVADO": "UPPER(TRIM(p.condominio)) = 'P'",
    "C": "UPPER(TRIM(p.condominio)) = 'C'",
    "CONDOMINIO": "UPPER(TRIM(p.condominio)) = 'C'",
}

DESTINOS_REGIMEN_PADRON = set(CODIGOS_TENENCIA_PADRON) | {"N"}


class SinDatoAPrivadoPayload(BaseModel):
    confirmar: bool = False
    excluir_condominio_catastro: bool = True


class RegimenMasivoPadronPayload(BaseModel):
    origenes: list[str] = Field(default_factory=lambda: ["NULL"])
    destino: str = "P"
    confirmar: bool = False
    excluir_condominio_catastro: bool = True


def _normalizar_origenes_regimen(origenes: list) -> list:
    resultado = []
    vistos = set()
    for raw in origenes or []:
        key = (raw or "").strip().upper()
        if not key or key not in ORIGENES_REGIMEN_PADRON_SQL:
            continue
        if key not in vistos:
            vistos.add(key)
            resultado.append(key)
    return resultado


def _where_regimen_masivo_padron(origenes: list, excluir_catastro: bool = True) -> str:
    keys = _normalizar_origenes_regimen(origenes)
    if not keys:
        raise HTTPException(status_code=400, detail="Indique al menos un origen válido: NULL, N, P o C.")
    partes = [f"({ORIGENES_REGIMEN_PADRON_SQL[k]})" for k in keys]
    where = [f"({' OR '.join(partes)})"]
    if excluir_catastro:
        where.append(SQL_EXCLUIR_CONDOMINIO_CATASTRO)
    return " AND ".join(where)


def _etiqueta_origenes_regimen(origenes: list) -> str:
    mapa = {"NULL": "Sin dato", "SIN_DATO": "Sin dato", "VACIO": "Sin dato", "N": "Normal", "NORMAL": "Normal", "P": "Privado", "PRIVADO": "Privado", "C": "Condominio", "CONDOMINIO": "Condominio"}
    keys = _normalizar_origenes_regimen(origenes)
    return ", ".join(dict.fromkeys(mapa.get(k, k) for k in keys))


def _resumen_regimen_masivo_padron(cur, origenes: list, excluir_catastro: bool = True) -> dict:
    keys = _normalizar_origenes_regimen(origenes)
    where_sql = _where_regimen_masivo_padron(keys, excluir_catastro)
    totales_origen = {}
    for key in keys:
        sql_origen = ORIGENES_REGIMEN_PADRON_SQL[key]
        cur.execute(f"SELECT COUNT(*)::int AS total FROM catalogos.padron_2026 p WHERE {sql_origen};")
        totales_origen[key] = int((cur.fetchone() or {}).get("total") or 0)

    cur.execute(f"SELECT COUNT(*)::int AS total FROM catalogos.padron_2026 p WHERE {where_sql};")
    actualizables = int((cur.fetchone() or {}).get("total") or 0)

    cur.execute(f"""
        SELECT COUNT(*)::int AS total FROM catalogos.padron_2026 p
        WHERE ({' OR '.join(f'({ORIGENES_REGIMEN_PADRON_SQL[k]})' for k in keys)})
          AND NOT ({SQL_EXCLUIR_CONDOMINIO_CATASTRO});
    """)
    excluidos_catastro = int((cur.fetchone() or {}).get("total") or 0)

    cur.execute(f"""
        SELECT p.clave_catastral, UPPER(TRIM(COALESCE(p.condominio, ''))) AS valor_padron
        FROM catalogos.padron_2026 p WHERE {where_sql}
        ORDER BY p.clave_catastral LIMIT 15;
    """)
    muestra = [{"clave_catastral": r.get("clave_catastral"), "condominio": r.get("valor_padron") or "NULL"} for r in cur.fetchall()]
    return {
        "origenes": keys,
        "origenes_etiqueta": _etiqueta_origenes_regimen(keys),
        "totales_por_origen": totales_origen,
        "actualizables": actualizables,
        "excluidos_catastro_condominio": excluidos_catastro,
        "excluir_condominio_catastro": excluir_catastro,
        "muestra": muestra,
    }


def _where_sin_dato_a_privado(excluir_catastro: bool = True) -> tuple:
    return _where_regimen_masivo_padron(["NULL"], excluir_catastro), []


@router.get("/padron/condominios/regimen-masivo/resumen")
def resumen_regimen_masivo_padron(
    origenes: str = Query("NULL", max_length=80),
    destino: str = Query("P", max_length=5),
    excluir_condominio_catastro: bool = Query(True),
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Vista previa: marcar predios del padrón (Sin dato, Normal, etc.) hacia P, N o C."""
    dest = (destino or "P").strip().upper()
    if dest not in DESTINOS_REGIMEN_PADRON:
        raise HTTPException(status_code=400, detail="Destino inválido. Use C, P o N.")
    lista_origenes = [x.strip() for x in (origenes or "NULL").split(",") if x.strip()]
    try:
        conn = get_conn()
        cur = conn.cursor()
        asegurar_tabla_predio_condominio(cur, conn)
        data = _resumen_regimen_masivo_padron(cur, lista_origenes, excluir_condominio_catastro)
        cur.close()
        conn.close()
        return {
            **data,
            "destino": dest,
            "nota": (
                f"Actualiza padron.condominio de [{data['origenes_etiqueta']}] a {dest}. "
                "Excluye predios ya clasificados como condominio en catastro (vertical/horizontal o régimen C). "
                "Luego puede filtrarlos como Privado y reclasificar los que sean condominio vertical/horizontal."
            ),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/padron/condominios/regimen-masivo")
def aplicar_regimen_masivo_padron(
    payload: RegimenMasivoPadronPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Actualización masiva del campo padron.condominio."""
    if not payload.confirmar:
        raise HTTPException(status_code=400, detail="Debe enviar confirmar=true para ejecutar.")
    dest = (payload.destino or "P").strip().upper()
    if dest not in DESTINOS_REGIMEN_PADRON:
        raise HTTPException(status_code=400, detail="Destino inválido. Use C, P o N.")
    try:
        conn = get_conn()
        cur = conn.cursor()
        asegurar_tabla_predio_condominio(cur, conn)
        where_sql = _where_regimen_masivo_padron(payload.origenes, payload.excluir_condominio_catastro)
        origenes_etiq = _etiqueta_origenes_regimen(payload.origenes)

        cur.execute(f"SELECT COUNT(*)::int AS total FROM catalogos.padron_2026 p WHERE {where_sql};")
        pendientes = int((cur.fetchone() or {}).get("total") or 0)
        if pendientes <= 0:
            cur.close()
            conn.close()
            return {"ok": True, "actualizados": 0, "mensaje": "No hay predios pendientes para actualizar."}

        cur.execute(f"UPDATE catalogos.padron_2026 p SET condominio = %s WHERE {where_sql};", (dest,))
        actualizados = cur.rowcount or pendientes

        usuario = usuario_actual.get("usuario") or "sistema"
        registrar_auditoria(
            usuario,
            "REGIMEN_MASIVO_PADRON",
            "catalogos.padron_2026",
            f"origenes={origenes_etiq}; destino={dest}; actualizados={actualizados}; excluir_catastro={payload.excluir_condominio_catastro}",
        )
        conn.commit()
        cur.close()
        conn.close()
        return {
            "ok": True,
            "actualizados": actualizados,
            "destino": dest,
            "origenes_etiqueta": origenes_etiq,
            "mensaje": f"Se marcaron {actualizados} predio(s) como {dest} en el padrón (desde {origenes_etiq}).",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/padron/condominios/sin-dato-a-privado/resumen")
def resumen_sin_dato_a_privado(
    excluir_condominio_catastro: bool = Query(True),
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Compatibilidad: vista previa Sin dato → Privado (P)."""
    data = resumen_regimen_masivo_padron("NULL", "P", excluir_condominio_catastro, usuario_actual)
    data["total_sin_dato"] = (data.get("totales_por_origen") or {}).get("NULL", data.get("actualizables", 0))
    data["muestra_claves"] = [m.get("clave_catastral") for m in (data.get("muestra") or [])]
    return data


@router.post("/padron/condominios/sin-dato-a-privado")
def aplicar_sin_dato_a_privado(
    payload: SinDatoAPrivadoPayload,
    usuario_actual: dict = Depends(requerir_roles("admin", "supervisor", "catastro")),
):
    """Compatibilidad: Sin dato → Privado (P)."""
    return aplicar_regimen_masivo_padron(
        RegimenMasivoPadronPayload(
            origenes=["NULL"],
            destino="P",
            confirmar=payload.confirmar,
            excluir_condominio_catastro=payload.excluir_condominio_catastro,
        ),
        usuario_actual,
    )
