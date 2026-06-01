"""Router de expediente integral, documentos, control cartografico y dashboards."""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from auth.dependencies import obtener_usuario_actual
from database import get_conn

router = APIRouter(tags=["expediente"])


@router.get("/control-cartografico/estadisticas")
def estadisticas_control(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                estado_cartografico,
                COUNT(*) AS total
            FROM catastro.v_control_cartografico
            GROUP BY estado_cartografico
            ORDER BY estado_cartografico;
        """)

        rows = cur.fetchall()
        cur.close()
        conn.close()

        resultado = {
            "DIBUJADO": 0,
            "SIN GEOMETRIA": 0,
            "NO EXISTE EN CARTOGRAFIA": 0,
            "TOTAL": 0,
            "COBERTURA": 0
        }

        for row in rows:
            estado = row["estado_cartografico"]
            total_estado = row["total"]
            resultado[estado] = total_estado
            resultado["TOTAL"] += total_estado

        if resultado["TOTAL"] > 0:
            resultado["COBERTURA"] = round(
                (resultado.get("DIBUJADO", 0) / resultado["TOTAL"]) * 100,
                2
            )

        return resultado

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/control-cartografico/sin-geometria")
def control_sin_geometria(
    limite: int = Query(100, ge=1, le=1000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                clave_catastral,
                nombre_completo,
                delegacion,
                colonia,
                calle,
                numof,
                valor2026,
                sup_documental,
                descripcion_uso,
                predio_id,
                estado_cartografico
            FROM catastro.v_control_cartografico
            WHERE estado_cartografico = 'SIN GEOMETRIA'
            ORDER BY clave_catastral
            LIMIT %s;
        """, (limite,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "estado": "SIN GEOMETRIA",
            "total": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expediente/{clave}")
def obtener_expediente_integral(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                vei.id_expediente,
                vei.clave_catastral,
                vei.estatus_expediente,
                COALESCE(
                    NULLIF(TRIM(tit.nombre_visible), ''),
                    NULLIF(TRIM(tit.titular_principal), ''),
                    NULLIF(TRIM(vei.nombre_completo), '')
                ) AS nombre_completo,
                vei.delegacion,
                vei.colonia,
                vei.calle,
                vei.numof,
                vei.numint,
                vei.letra,
                vei.zona_homogenea,
                vei.descripcion_uso,
                vei.id_tasa,
                vei.porcentaje_tasa,
                vei.condominio,
                vei.valor2026,
                vei.sup_documental,
                vei.sup_fisica,
                vei.sup_const,
                vei.adeudo_2026,
                vei.adeudo_total,
                vei.predio_id,
                vei.estado_cartografico,
                vei.dibujado,
                vei.area_cartografica,
                vei.diferencia_area,
                vei.tiene_documentos,
                vei.tiene_cartografia,
                vei.tiene_construccion,
                vei.tiene_avaluo,
                vei.tiene_inspeccion,
                vei.tiene_rppc,
                vei.tiene_fotografia,
                vei.tiene_cedula,
                vei.tiene_historial,
                vei.observaciones,
                tit.id_persona,
                tit.tipo_persona,
                tit.rfc,
                tit.porcentaje_propiedad,
                tit.tipo_titularidad,
                tit.total_titulares,
                tit.suma_porcentaje,
                CASE
                    WHEN vei.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(vei.geom, 4326))::json
                END AS geometry
            FROM catastro.v_expediente_integral vei
            LEFT JOIN LATERAL (
                SELECT
                    pp.id_persona,
                    per.tipo_persona,
                    per.rfc,
                    pp.porcentaje_propiedad,
                    pp.tipo_titularidad,
                    CASE
                        WHEN UPPER(COALESCE(per.tipo_persona, 'FISICA')) = 'MORAL' THEN
                            UPPER(TRIM(COALESCE(per.razon_social, '')))
                        ELSE
                            UPPER(TRIM(
                                COALESCE(per.apellido_paterno, '') || ' ' ||
                                COALESCE(per.apellido_materno, '') || ' ' ||
                                COALESCE(per.nombre, '')
                            ))
                    END AS nombre_visible,
                    CASE
                        WHEN UPPER(COALESCE(per.tipo_persona, 'FISICA')) = 'MORAL' THEN
                            UPPER(TRIM(COALESCE(per.razon_social, '')))
                        ELSE
                            UPPER(TRIM(
                                COALESCE(per.apellido_paterno, '') || ' ' ||
                                COALESCE(per.apellido_materno, '') || ' ' ||
                                COALESCE(per.nombre, '')
                            ))
                    END AS titular_principal,
                    1::int AS total_titulares,
                    pp.porcentaje_propiedad AS suma_porcentaje
                FROM catastro.predio_propietario pp
                INNER JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(vei.clave_catastral))
                  AND pp.vigente = TRUE
                  AND COALESCE(per.activo, TRUE) = TRUE
                ORDER BY
                    CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 1 ELSE 2 END,
                    pp.porcentaje_propiedad DESC NULLS LAST,
                    pp.id_predio_propietario
                LIMIT 1
            ) tit ON TRUE
            WHERE UPPER(TRIM(vei.clave_catastral)) = UPPER(TRIM(%s))
            LIMIT 1;
        """, (clave,))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Expediente no encontrado")

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


@router.get("/expediente/{clave}/historial")
def historial_expediente(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                fecha_modificacion,
                usuario_modifico,
                accion,
                tipo_movimiento,
                observaciones,
                tiene_documentos,
                tiene_cartografia,
                tiene_construccion,
                tiene_avaluo,
                tiene_inspeccion,
                tiene_rppc,
                tiene_fotografia,
                tiene_cedula,
                tiene_historial
            FROM auditoria.v_expedientes_timeline
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            ORDER BY fecha_modificacion DESC
            LIMIT 50;
        """, (clave,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave_catastral": clave.upper(),
            "total": len(rows),
            "historial": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expediente/{clave}/documentos")
def documentos_expediente(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id_documento,
                clave_catastral,
                tipo_documento,
                nombre_archivo,
                ruta_archivo,
                descripcion,
                anio,
                origen,
                usuario_carga,
                fecha_carga
            FROM catastro.v_expediente_documentos
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            ORDER BY fecha_carga DESC;
        """, (clave,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave_catastral": clave.upper(),
            "total": len(rows),
            "documentos": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documentos/{clave}/{archivo}")
def abrir_documento(clave: str, archivo: str):
    # Protección contra path traversal: la ruta final, ya resuelta (sin '..',
    # symlinks, etc.), debe quedar estrictamente dentro de la carpeta base.
    base_dir = os.path.realpath("/var/www/catastro/documentos")
    ruta = os.path.realpath(os.path.join(base_dir, clave, archivo))

    if ruta != base_dir and not ruta.startswith(base_dir + os.sep):
        raise HTTPException(status_code=400, detail="Ruta de documento no válida")

    if not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    return FileResponse(ruta)


@router.get("/cambios-geometricos")
def cambios_geometricos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT json_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(json_agg(feature), '[]'::json)
            ) AS geojson
            FROM (
                SELECT json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json,
                    'properties', json_build_object(
                        'clave_catastral', c.clave_catastral,
                        'tipo_cambio', c.tipo_cambio,
                        'prioridad', c.prioridad,
                        'requiere_revision', c.requiere_revision,
                        'area_catastro', c.area_catastro,
                        'area_geonode', c.area_geonode,
                        'diferencia_area', c.diferencia_area,
                        'porcentaje_cambio', c.porcentaje_cambio,
                        'distancia_centroides', c.distancia_centroides,
                        'fecha_deteccion', c.fecha_deteccion
                    )
                ) AS feature
                FROM auditoria.cambios_geometricos_predios c
                JOIN catastro.predios p
                    ON p.clave_catastral = c.clave_catastral
                WHERE p.geom IS NOT NULL
            ) features;
        """)

        row = cur.fetchone()
        cur.close()
        conn.close()

        return row["geojson"]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard-cartografico")
def dashboard_cartografico(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE geom IS NOT NULL) AS dibujados,
                COUNT(*) FILTER (WHERE geom IS NULL) AS sin_geometria
            FROM catastro.predios;
        """)
        base = cur.fetchone()

        cur.execute("""
            SELECT
                COUNT(*) AS total_cambios,
                COUNT(*) FILTER (WHERE requiere_revision = true) AS requieren_revision,
                COUNT(*) FILTER (WHERE prioridad = 'ALTA') AS prioridad_alta,
                COUNT(*) FILTER (WHERE prioridad = 'MEDIA') AS prioridad_media,
                COUNT(*) FILTER (WHERE prioridad = 'BAJA') AS prioridad_baja
            FROM auditoria.cambios_geometricos_predios;
        """)
        cambios = cur.fetchone()

        cur.close()
        conn.close()

        total = base["total_predios"] or 0
        dibujados = base["dibujados"] or 0
        sin_geometria = base["sin_geometria"] or 0
        cobertura = round((dibujados / total) * 100, 2) if total > 0 else 0

        return {
            "total_predios": total,
            "dibujados": dibujados,
            "sin_geometria": sin_geometria,
            "cobertura": cobertura,
            "cambios_geometricos": cambios["total_cambios"] or 0,
            "requieren_revision": cambios["requieren_revision"] or 0,
            "prioridad_alta": cambios["prioridad_alta"] or 0,
            "prioridad_media": cambios["prioridad_media"] or 0,
            "prioridad_baja": cambios["prioridad_baja"] or 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard-fiscal")
def dashboard_fiscal(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        # Resumen fiscal general desde la ficha predial institucional
        cur.execute("""
            SELECT
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS con_adeudo,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) <= 0) AS sin_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(adeudo_2026), 0) AS adeudo_2026,
                COALESCE(SUM(valor2026), 0) AS valor_catastral_total,
                COALESCE(SUM(sup_documental), 0) AS superficie_documental_total,
                COALESCE(SUM(sup_fisica), 0) AS superficie_fisica_total,
                COALESCE(SUM(sup_const), 0) AS superficie_construccion_total,
                COUNT(*) FILTER (WHERE dibujado = true) AS dibujados,
                COUNT(*) FILTER (WHERE dibujado = false OR dibujado IS NULL) AS sin_geometria
            FROM catastro.v_ficha_predial;
        """)
        resumen = cur.fetchone()

        # Estado documental / expediente integral
        cur.execute("""
            SELECT
                COUNT(*) AS total_expedientes,
                COUNT(*) FILTER (WHERE tiene_documentos = true) AS con_documentos,
                COUNT(*) FILTER (WHERE tiene_documentos = false OR tiene_documentos IS NULL) AS sin_documentos,
                COUNT(*) FILTER (WHERE tiene_cartografia = true) AS con_cartografia,
                COUNT(*) FILTER (WHERE tiene_construccion = true) AS con_construccion,
                COUNT(*) FILTER (WHERE tiene_avaluo = true) AS con_avaluo,
                COUNT(*) FILTER (WHERE tiene_inspeccion = true) AS con_inspeccion,
                COUNT(*) FILTER (WHERE tiene_rppc = true) AS con_rppc,
                COUNT(*) FILTER (WHERE tiene_fotografia = true) AS con_fotografia,
                COUNT(*) FILTER (WHERE tiene_cedula = true) AS con_cedula,
                COUNT(*) FILTER (WHERE tiene_historial = true) AS con_historial
            FROM catastro.v_expediente_integral;
        """)
        expediente = cur.fetchone()

        # Top colonias por adeudo
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(colonia), ''), 'SIN COLONIA') AS colonia,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(colonia), ''), 'SIN COLONIA')
            ORDER BY COALESCE(SUM(adeudo_total), 0) DESC
            LIMIT 10;
        """)
        top_colonias = cur.fetchall()

        # Resumen por uso predial
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(descripcion_uso), ''), 'SIN USO') AS uso,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(descripcion_uso), ''), 'SIN USO')
            ORDER BY COUNT(*) DESC
            LIMIT 10;
        """)
        por_uso = cur.fetchall()

        # Resumen por zona homogénea
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(zonah), ''), 'SIN ZONA') AS zona_homogenea,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(zonah), ''), 'SIN ZONA')
            ORDER BY COALESCE(SUM(adeudo_total), 0) DESC
            LIMIT 10;
        """)
        por_zona = cur.fetchall()

        cur.close()
        conn.close()

        total_predios = resumen["total_predios"] or 0
        con_adeudo = resumen["con_adeudo"] or 0
        sin_adeudo = resumen["sin_adeudo"] or 0
        dibujados = resumen["dibujados"] or 0

        return {
            "total_predios": total_predios,
            "con_adeudo": con_adeudo,
            "sin_adeudo": sin_adeudo,
            "porcentaje_con_adeudo": round((con_adeudo / total_predios) * 100, 2) if total_predios > 0 else 0,
            "porcentaje_sin_adeudo": round((sin_adeudo / total_predios) * 100, 2) if total_predios > 0 else 0,
            "adeudo_total": float(resumen["adeudo_total"] or 0),
            "adeudo_2026": float(resumen["adeudo_2026"] or 0),
            "valor_catastral_total": float(resumen["valor_catastral_total"] or 0),
            "superficie_documental_total": float(resumen["superficie_documental_total"] or 0),
            "superficie_fisica_total": float(resumen["superficie_fisica_total"] or 0),
            "superficie_construccion_total": float(resumen["superficie_construccion_total"] or 0),
            "dibujados": dibujados,
            "sin_geometria": resumen["sin_geometria"] or 0,
            "cobertura_cartografica": round((dibujados / total_predios) * 100, 2) if total_predios > 0 else 0,
            "expediente": {
                "total_expedientes": expediente["total_expedientes"] or 0,
                "con_documentos": expediente["con_documentos"] or 0,
                "sin_documentos": expediente["sin_documentos"] or 0,
                "con_cartografia": expediente["con_cartografia"] or 0,
                "con_construccion": expediente["con_construccion"] or 0,
                "con_avaluo": expediente["con_avaluo"] or 0,
                "con_inspeccion": expediente["con_inspeccion"] or 0,
                "con_rppc": expediente["con_rppc"] or 0,
                "con_fotografia": expediente["con_fotografia"] or 0,
                "con_cedula": expediente["con_cedula"] or 0,
                "con_historial": expediente["con_historial"] or 0
            },
            "top_colonias_adeudo": top_colonias,
            "resumen_por_uso": por_uso,
            "resumen_por_zona": por_zona
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))