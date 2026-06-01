"""Router de consulta al padron y predios (busqueda, ficha, mapa)."""
import csv
import io
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth.dependencies import obtener_usuario_actual, registrar_auditoria, requerir_roles
from database import get_conn, asegurar_tabla_predio_condominio

router = APIRouter(tags=["padron"])

# Misma lógica de nombre que copropietarios / propietarios.py (evita desfase con v_titularidad_predio).
SQL_NOMBRE_PERSONA_TITULAR = """
    CASE
        WHEN UPPER(COALESCE(per.tipo_persona, 'FISICA')) = 'MORAL' THEN
            UPPER(TRIM(COALESCE(per.razon_social, '')))
        ELSE
            UPPER(TRIM(
                COALESCE(per.apellido_paterno, '') || ' ' ||
                COALESCE(per.apellido_materno, '') || ' ' ||
                COALESCE(per.nombre, '')
            ))
    END
"""

# Una fila por predio: padron_2026 + titular principal vigente del catálogo.
SQL_FROM_PADRON_UNICO = f"""
    FROM catalogos.padron_2026 p
    LEFT JOIN LATERAL (
        SELECT
            pp.id_persona,
            per.tipo_persona,
            per.rfc,
            pp.porcentaje_propiedad,
            pp.tipo_titularidad,
            {SQL_NOMBRE_PERSONA_TITULAR} AS nombre_visible,
            {SQL_NOMBRE_PERSONA_TITULAR} AS titular_principal,
            1::int AS total_titulares,
            pp.porcentaje_propiedad AS suma_porcentaje
        FROM catastro.predio_propietario pp
        INNER JOIN catalogos.personas per ON per.id_persona = pp.id_persona
        WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
          AND pp.vigente = TRUE
          AND COALESCE(per.activo, TRUE) = TRUE
        ORDER BY
            CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 1 ELSE 2 END,
            pp.porcentaje_propiedad DESC NULLS LAST,
            pp.id_predio_propietario
        LIMIT 1
    ) tit ON TRUE
    LEFT JOIN catastro.predios g
        ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
"""

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
            SELECT COUNT(*) AS total
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

        rows = cur.fetchall()
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
    limite: int = Query(100, ge=1, le=5000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        limite = min(max(limite, 1), 5000)

        clave_like = (clave or "").strip() + "%"
        nombre_like = "%" + (nombre or "").strip() + "%"
        colonia_like = "%" + (colonia or "").strip() + "%"
        calle_like = "%" + (calle or "").strip() + "%"
        numero_txt = (numero or "").strip()

        conn = get_conn()
        cur = conn.cursor()

        where_sql = f"""
            WHERE
                (%s = '' OR UPPER(p.clave_catastral) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo)) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(p.colonia) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(p.calle) LIKE UPPER(%s))
                AND (%s = '' OR CAST(p.numof AS TEXT) = %s)
        """

        params_where = (
            (clave or "").strip(), clave_like,
            (nombre or "").strip(), nombre_like,
            (colonia or "").strip(), colonia_like,
            (calle or "").strip(), calle_like,
            numero_txt, numero_txt
        )

        # Total real SIN LIMIT para que el frontend conozca todos los predios encontrados.
        cur.execute(f"""
            SELECT COUNT(*) AS total
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

        rows = cur.fetchall()
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
                tit.id_persona,
                tit.tipo_persona,
                tit.rfc,
                tit.porcentaje_propiedad,
                tit.tipo_titularidad,
                tit.total_titulares,
                tit.suma_porcentaje,
                CASE
                    WHEN g.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json
                END AS geometry
            {SQL_FROM_PADRON_UNICO}
            WHERE UPPER(p.clave_catastral) = UPPER(%s)
            LIMIT 1;
        """, (clave,))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Predio no encontrado")

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


@router.get("/predios/{clave}/ficha")
def ficha_predio_alias(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    return ficha_padron(clave, usuario_actual)


@router.get("/predios/{clave}/geojson")
def geojson_predio(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    """Geometría del predio para mapa (Feature GeoJSON)."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                CASE
                    WHEN g.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(g.geom, 4326))::json
                END AS geometry
            FROM catalogos.padron_2026 p
            LEFT JOIN catastro.predios g
                ON UPPER(TRIM(g.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
            WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(%s))
            LIMIT 1;
        """, (clave,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Predio no encontrado")
        geometry = row.get("geometry")
        if not geometry:
            raise HTTPException(status_code=404, detail="Predio sin geometría cartográfica")
        return {"type": "Feature", "geometry": geometry, "properties": {"clave_catastral": clave.upper().strip()}}
    except HTTPException:
        raise
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
    radio: float = Query(50, ge=1, le=500),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
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
                col.nombre_colonia AS colonia,
                p.cp,
                p.sup_documental AS superficie,
                ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry
            FROM catastro.predios p
            LEFT JOIN catalogos.cat_colonias col
                ON p.colonia_id = col.id,
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

    if not (zona and sector and subsector and homoclave and seccion and descripcion and codigo):
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
    zona: str
    sector: str
    subsector: str
    homoclave_col_fracc: str
    seccion: str
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

        fila = {
            "anio": int(fila_in.get("anio") or anio_objetivo),
            "zona": str(fila_in.get("zona") or "").strip().upper(),
            "sector": str(fila_in.get("sector") or "").strip().upper(),
            "subsector": str(fila_in.get("subsector") or "").strip().upper(),
            "homoclave_col_fracc": str(fila_in.get("homoclave_col_fracc") or "").strip().upper(),
            "seccion": str(fila_in.get("seccion") or "").strip().upper(),
            "descripcion_col_fracc": str(fila_in.get("descripcion_col_fracc") or "").strip().upper(),
            "valor_m2": valor,
            "codigo_zona_homogenea": codigo,
        }

        if fila["anio"] != anio_objetivo:
            fila["anio"] = anio_objetivo

        if not all([fila["zona"], fila["sector"], fila["subsector"], fila["homoclave_col_fracc"],
                    fila["seccion"], fila["descripcion_col_fracc"], fila["codigo_zona_homogenea"]]):
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


@router.get("/tiles/predios/{z}/{x}/{y}.pbf")
def tile_predios(z: int, x: int, y: int):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            WITH
            bounds AS (
                SELECT ST_TileEnvelope(%s, %s, %s) AS geom
            ),
            mvtgeom AS (
                SELECT
                    p.id,
                    p.clave_catastral,
                    col.nombre_colonia AS colonia,
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
                LEFT JOIN catalogos.cat_colonias col
                    ON p.colonia_id = col.id,
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
