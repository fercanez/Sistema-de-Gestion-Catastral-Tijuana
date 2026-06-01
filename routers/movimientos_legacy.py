"""Endpoints legacy de aplicacion de titularidad (v27). Mantener por compatibilidad."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg2.extras import RealDictCursor

from database import get_conn, columnas_tabla
from routers.movimientos import permiso_aplicar_movimientos

router = APIRouter(tags=["movimientos-legacy"])

def extraer_json_dict(valor):
    if valor is None:
        return {}
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except Exception:
            return {}
    return {}


def aplicar_titularidad_completa(cur, movimiento_id: int, usuario: str, ip: str = None):
    cur.execute("""
        SELECT *
        FROM catastro.movimientos_padron
        WHERE id = %s;
    """, (movimiento_id,))
    mov = cur.fetchone()

    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")

    if mov["estado"] == "APLICADO":
        raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

    tipo = str(mov["tipo_movimiento"] or "").upper()
    if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
        raise HTTPException(
            status_code=400,
            detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
        )

    clave = mov["clave_catastral"]
    datos_nuevos = extraer_json_dict(mov.get("datos_nuevos"))

    nombre_nuevo = (
        datos_nuevos.get("nombre_propietario")
        or datos_nuevos.get("nombre_completo")
        or datos_nuevos.get("razon_social")
    )

    rfc_nuevo = datos_nuevos.get("rfc")
    tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
    primer_apellido = datos_nuevos.get("primer_apellido")
    segundo_apellido = datos_nuevos.get("segundo_apellido")
    nombres = datos_nuevos.get("nombres")
    razon_social = datos_nuevos.get("razon_social")

    if not clave:
        raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

    if not nombre_nuevo:
        raise HTTPException(status_code=400, detail="Movimiento sin nombre nuevo")

    # 1) Leer datos actuales del padrón
    cur.execute("""
        SELECT nombre_completo
        FROM catalogos.padron_2026
        WHERE clave_catastral = %s
        LIMIT 1;
    """, (clave,))
    padron_actual = cur.fetchone()

    if not padron_actual:
        raise HTTPException(
            status_code=404,
            detail="No se encontró la clave en catalogos.padron_2026"
        )

    nombre_anterior = padron_actual.get("nombre_completo")

    # 2) Actualizar padron_2026
    cur.execute("""
        UPDATE catalogos.padron_2026
        SET nombre_completo = %s
        WHERE clave_catastral = %s
        RETURNING clave_catastral, nombre_completo;
    """, (nombre_nuevo, clave))
    padron_actualizado = cur.fetchone()

    # 3) Buscar propietario/persona vigente relacionado al predio
    cur.execute("""
        SELECT
            pp.id AS predio_propietario_id,
            pp.id_persona,
            per.rfc AS rfc_anterior,
            per.nombre AS nombre_persona_anterior
        FROM catastro.predio_propietario pp
        LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
        WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
        ORDER BY COALESCE(pp.titular_principal, false) DESC, pp.id DESC
        LIMIT 1;
    """, (clave,))
    rel = cur.fetchone()

    persona_actualizada = None
    rfc_anterior = None

    if rel and rel.get("id_persona"):
        rfc_anterior = rel.get("rfc_anterior")

        # Actualizar datos existentes de persona.
        # Se usa COALESCE por si algunas columnas no aplican en ciertos modelos.
        cur.execute("""
            UPDATE catalogos.personas
            SET
                nombre = %s,
                rfc = NULLIF(%s, ''),
                tipo_persona = NULLIF(%s, '')
            WHERE id_persona = %s
            RETURNING id_persona, nombre, rfc, tipo_persona;
        """, (
            nombre_nuevo,
            rfc_nuevo or "",
            tipo_persona_nuevo or "",
            rel["id_persona"]
        ))
        persona_actualizada = cur.fetchone()

    else:
        # Si no existe relación, crear persona base y relación predio-propietario.
        cur.execute("""
            INSERT INTO catalogos.personas (
                nombre,
                rfc,
                tipo_persona
            )
            VALUES (%s, NULLIF(%s, ''), NULLIF(%s, ''))
            RETURNING id_persona, nombre, rfc, tipo_persona;
        """, (
            nombre_nuevo,
            rfc_nuevo or "",
            tipo_persona_nuevo or ""
        ))
        persona_actualizada = cur.fetchone()

        cur.execute("""
            INSERT INTO catastro.predio_propietario (
                clave_catastral,
                id_persona,
                porcentaje_propiedad,
                titular_principal,
                tipo_titularidad
            )
            VALUES (%s, %s, 100, TRUE, 'PROPIETARIO');
        """, (
            clave,
            persona_actualizada["id_persona"]
        ))

    # 4) Historial titularidad
    cur.execute("""
        INSERT INTO catastro.historial_titularidad (
            clave_catastral,
            movimiento_id,
            tipo_evento,
            nombre_anterior,
            nombre_nuevo,
            tipo_titularidad_nueva,
            documento_soporte,
            motivo,
            usuario_modifica
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s);
    """, (
        clave,
        movimiento_id,
        tipo,
        nombre_anterior,
        nombre_nuevo,
        tipo_persona_nuevo,
        None,
        mov.get("motivo"),
        usuario
    ))

    # 5) Auditoría
    cur.execute("""
        INSERT INTO auditoria.movimientos_padron_auditoria (
            movimiento_id,
            clave_catastral,
            accion,
            estado_anterior,
            estado_nuevo,
            detalle,
            datos,
            usuario,
            ip
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
    """, (
        movimiento_id,
        clave,
        "APLICAR_TITULARIDAD_COMPLETA",
        mov["estado"],
        "APLICADO",
        "Cambio aplicado a catalogos.padron_2026 y catalogos.personas",
        json.dumps({
            "padron_2026": {
                "nombre_anterior": nombre_anterior,
                "nombre_nuevo": nombre_nuevo
            },
            "personas": {
                "rfc_anterior": rfc_anterior,
                "rfc_nuevo": rfc_nuevo,
                "tipo_persona": tipo_persona_nuevo,
                "primer_apellido": primer_apellido,
                "segundo_apellido": segundo_apellido,
                "nombres": nombres,
                "razon_social": razon_social
            }
        }),
        usuario,
        ip
    ))

    # 6) Marcar aplicado
    cur.execute("""
        UPDATE catastro.movimientos_padron
        SET estado = 'APLICADO',
            usuario_aplica = %s,
            fecha_aplicacion = now()
        WHERE id = %s
        RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
    """, (usuario, movimiento_id))
    mov_final = cur.fetchone()

    return {
        "ok": True,
        "mensaje": "Movimiento de titularidad aplicado correctamente",
        "movimiento": mov_final,
        "actualizado": {
            "clave_catastral": clave,
            "nombre_completo": nombre_nuevo,
            "rfc": rfc_nuevo,
            "tipo_persona": tipo_persona_nuevo
        },
        "persona": persona_actualizada,
        "padron": padron_actualizado
    }


@router.post("/movimientos/{movimiento_id}/aplicar-titularidad")
def aplicar_movimiento_titularidad_completa(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            resultado = aplicar_titularidad_completa(
                cur,
                movimiento_id,
                usuario,
                request.client.host if request.client else None
            )
            conn.commit()
            return resultado




# ============================================================
# v27g - APLICACIÓN FLEXIBLE TITULARIDAD / RFC
# Permite aplicar:
# - cambio de nombre
# - solo RFC
# - tipo_persona
# - titularidad completa
# ============================================================

def extraer_json_dict_v27g(valor):
    if valor is None:
        return {}
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except Exception:
            return {}
    return {}


@router.post("/movimientos/{movimiento_id}/aplicar-titularidad-v27g")
def aplicar_movimiento_titularidad_v27g(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()

            if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
                )

            clave = mov["clave_catastral"]
            if not clave:
                raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

            datos_nuevos = extraer_json_dict_v27g(mov.get("datos_nuevos"))

            nombre_nuevo = (
                datos_nuevos.get("nombre_propietario")
                or datos_nuevos.get("nombre_completo")
                or datos_nuevos.get("razon_social")
            )

            rfc_nuevo = datos_nuevos.get("rfc")
            tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
            primer_apellido = datos_nuevos.get("primer_apellido")
            segundo_apellido = datos_nuevos.get("segundo_apellido")
            nombres = datos_nuevos.get("nombres")
            razon_social = datos_nuevos.get("razon_social")

            # Leer padrón actual
            cur.execute("""
                SELECT nombre_completo
                FROM catalogos.padron_2026
                WHERE clave_catastral = %s
                LIMIT 1;
            """, (clave,))
            padron_actual = cur.fetchone()

            if not padron_actual:
                raise HTTPException(
                    status_code=404,
                    detail="No se encontró la clave en catalogos.padron_2026"
                )

            nombre_anterior = padron_actual.get("nombre_completo")

            # Si no viene nombre nuevo, conservar el actual para permitir RFC-only
            if not nombre_nuevo:
                nombre_nuevo = nombre_anterior

            # Validar que al menos haya algo que aplicar
            if not nombre_nuevo and not rfc_nuevo and not tipo_persona_nuevo:
                raise HTTPException(
                    status_code=400,
                    detail="No se encontró nombre, RFC o tipo de persona para aplicar"
                )

            # Actualizar nombre en padrón solo si cambió o si viene explícito
            padron_actualizado = None
            if nombre_nuevo:
                cur.execute("""
                    UPDATE catalogos.padron_2026
                    SET nombre_completo = %s
                    WHERE clave_catastral = %s
                    RETURNING clave_catastral, nombre_completo;
                """, (nombre_nuevo, clave))
                padron_actualizado = cur.fetchone()

            # Buscar relación persona
            cur.execute("""
                SELECT
                    pp.id AS predio_propietario_id,
                    pp.id_persona,
                    per.rfc AS rfc_anterior,
                    per.nombre AS nombre_persona_anterior,
                    per.tipo_persona AS tipo_persona_anterior
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                ORDER BY COALESCE(pp.titular_principal, false) DESC, pp.id DESC
                LIMIT 1;
            """, (clave,))
            rel = cur.fetchone()

            persona_actualizada = None
            rfc_anterior = None
            tipo_persona_anterior = None

            if rel and rel.get("id_persona"):
                rfc_anterior = rel.get("rfc_anterior")
                tipo_persona_anterior = rel.get("tipo_persona_anterior")

                cur.execute("""
                    UPDATE catalogos.personas
                    SET
                        nombre = COALESCE(NULLIF(%s, ''), nombre),
                        rfc = COALESCE(NULLIF(%s, ''), rfc),
                        tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)
                    WHERE id_persona = %s
                    RETURNING id_persona, nombre, rfc, tipo_persona;
                """, (
                    nombre_nuevo or "",
                    rfc_nuevo or "",
                    tipo_persona_nuevo or "",
                    rel["id_persona"]
                ))
                persona_actualizada = cur.fetchone()

            else:
                cur.execute("""
                    INSERT INTO catalogos.personas (
                        nombre,
                        rfc,
                        tipo_persona
                    )
                    VALUES (%s, NULLIF(%s, ''), NULLIF(%s, ''))
                    RETURNING id_persona, nombre, rfc, tipo_persona;
                """, (
                    nombre_nuevo or "",
                    rfc_nuevo or "",
                    tipo_persona_nuevo or ""
                ))
                persona_actualizada = cur.fetchone()

                cur.execute("""
                    INSERT INTO catastro.predio_propietario (
                        clave_catastral,
                        id_persona,
                        porcentaje_propiedad,
                        titular_principal,
                        tipo_titularidad
                    )
                    VALUES (%s, %s, 100, TRUE, 'PROPIETARIO');
                """, (
                    clave,
                    persona_actualizada["id_persona"]
                ))

            # Historial
            cur.execute("""
                INSERT INTO catastro.historial_titularidad (
                    clave_catastral,
                    movimiento_id,
                    tipo_evento,
                    nombre_anterior,
                    nombre_nuevo,
                    tipo_titularidad_nueva,
                    motivo,
                    usuario_modifica
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
            """, (
                clave,
                movimiento_id,
                tipo,
                nombre_anterior,
                nombre_nuevo,
                tipo_persona_nuevo,
                mov.get("motivo"),
                usuario
            ))

            # Auditoría
            cur.execute("""
                INSERT INTO auditoria.movimientos_padron_auditoria (
                    movimiento_id,
                    clave_catastral,
                    accion,
                    estado_anterior,
                    estado_nuevo,
                    detalle,
                    datos,
                    usuario,
                    ip
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
            """, (
                movimiento_id,
                clave,
                "APLICAR_TITULARIDAD_RFC_V27G",
                mov["estado"],
                "APLICADO",
                "Cambio aplicado a catalogos.padron_2026 y catalogos.personas",
                json.dumps({
                    "padron_2026": {
                        "nombre_anterior": nombre_anterior,
                        "nombre_nuevo": nombre_nuevo
                    },
                    "personas": {
                        "rfc_anterior": rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_anterior": tipo_persona_anterior,
                        "tipo_persona_nuevo": tipo_persona_nuevo,
                        "primer_apellido": primer_apellido,
                        "segundo_apellido": segundo_apellido,
                        "nombres": nombres,
                        "razon_social": razon_social
                    }
                }),
                usuario,
                request.client.host if request.client else None
            ))

            cur.execute("""
                UPDATE catastro.movimientos_padron
                SET estado = 'APLICADO',
                    usuario_aplica = %s,
                    fecha_aplicacion = now()
                WHERE id = %s
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
            """, (usuario, movimiento_id))
            mov_final = cur.fetchone()

            conn.commit()

            return {
                "ok": True,
                "mensaje": "Movimiento de titularidad/RFC aplicado correctamente",
                "movimiento": mov_final,
                "actualizado": {
                    "clave_catastral": clave,
                    "nombre_completo": nombre_nuevo,
                    "rfc": rfc_nuevo,
                    "tipo_persona": tipo_persona_nuevo
                },
                "persona": persona_actualizada,
                "padron": padron_actualizado
            }




# ============================================================
# v27h - FIX predio_propietario sin pp.id
# Aplicación flexible titularidad/RFC sin depender de pp.id
# ============================================================

def columnas_tabla(cur, esquema: str, tabla: str):
    cur.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s
          AND table_name = %s;
    """, (esquema, tabla))
    return {r["column_name"] for r in cur.fetchall()}


def extraer_json_dict_v27h(valor):
    if valor is None:
        return {}
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except Exception:
            return {}
    return {}


@router.post("/movimientos/{movimiento_id}/aplicar-titularidad-v27h")
def aplicar_movimiento_titularidad_v27h(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()

            if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
                )

            clave = mov["clave_catastral"]
            if not clave:
                raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

            datos_nuevos = extraer_json_dict_v27h(mov.get("datos_nuevos"))

            nombre_nuevo = (
                datos_nuevos.get("nombre_propietario")
                or datos_nuevos.get("nombre_completo")
                or datos_nuevos.get("razon_social")
            )

            rfc_nuevo = datos_nuevos.get("rfc")
            tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
            primer_apellido = datos_nuevos.get("primer_apellido")
            segundo_apellido = datos_nuevos.get("segundo_apellido")
            nombres = datos_nuevos.get("nombres")
            razon_social = datos_nuevos.get("razon_social")

            # 1) Padrón actual
            cur.execute("""
                SELECT nombre_completo
                FROM catalogos.padron_2026
                WHERE clave_catastral = %s
                LIMIT 1;
            """, (clave,))
            padron_actual = cur.fetchone()

            if not padron_actual:
                raise HTTPException(
                    status_code=404,
                    detail="No se encontró la clave en catalogos.padron_2026"
                )

            nombre_anterior = padron_actual.get("nombre_completo")

            # Si solo se actualiza RFC, conservar nombre actual
            if not nombre_nuevo:
                nombre_nuevo = nombre_anterior

            if not nombre_nuevo and not rfc_nuevo and not tipo_persona_nuevo:
                raise HTTPException(
                    status_code=400,
                    detail="No se encontró nombre, RFC o tipo de persona para aplicar"
                )

            # 2) Actualizar catalogos.padron_2026
            cur.execute("""
                UPDATE catalogos.padron_2026
                SET nombre_completo = %s
                WHERE clave_catastral = %s
                RETURNING clave_catastral, nombre_completo;
            """, (nombre_nuevo, clave))
            padron_actualizado = cur.fetchone()

            cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
            cols_personas = columnas_tabla(cur, "catalogos", "personas")

            if "clave_catastral" not in cols_pp or "id_persona" not in cols_pp:
                raise HTTPException(
                    status_code=500,
                    detail="catastro.predio_propietario debe tener clave_catastral e id_persona"
                )

            if "id_persona" not in cols_personas:
                raise HTTPException(
                    status_code=500,
                    detail="catalogos.personas debe tener id_persona"
                )

            # 3) Buscar persona relacionada SIN usar pp.id
            cur.execute("""
                SELECT
                    pp.id_persona,
                    per.rfc AS rfc_anterior,
                    per.nombre AS nombre_persona_anterior,
                    per.tipo_persona AS tipo_persona_anterior
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                ORDER BY pp.id_persona DESC
                LIMIT 1;
            """, (clave,))
            rel = cur.fetchone()

            persona_actualizada = None
            rfc_anterior = None
            tipo_persona_anterior = None

            # Columnas que realmente podemos actualizar en catalogos.personas
            set_parts = []
            params = []

            if "nombre" in cols_personas:
                set_parts.append("nombre = COALESCE(NULLIF(%s, ''), nombre)")
                params.append(nombre_nuevo or "")

            if "rfc" in cols_personas:
                set_parts.append("rfc = COALESCE(NULLIF(%s, ''), rfc)")
                params.append(rfc_nuevo or "")

            if "tipo_persona" in cols_personas:
                set_parts.append("tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)")
                params.append(tipo_persona_nuevo or "")

            if rel and rel.get("id_persona"):
                rfc_anterior = rel.get("rfc_anterior")
                tipo_persona_anterior = rel.get("tipo_persona_anterior")

                if set_parts:
                    params.append(rel["id_persona"])
                    sql_update_persona = f"""
                        UPDATE catalogos.personas
                        SET {", ".join(set_parts)}
                        WHERE id_persona = %s
                        RETURNING *;
                    """
                    cur.execute(sql_update_persona, params)
                    persona_actualizada = cur.fetchone()

            else:
                # Crear persona mínima si no existe relación.
                insert_cols = []
                insert_vals = []
                insert_params = []

                if "nombre" in cols_personas:
                    insert_cols.append("nombre")
                    insert_vals.append("%s")
                    insert_params.append(nombre_nuevo or "")

                if "rfc" in cols_personas:
                    insert_cols.append("rfc")
                    insert_vals.append("NULLIF(%s, '')")
                    insert_params.append(rfc_nuevo or "")

                if "tipo_persona" in cols_personas:
                    insert_cols.append("tipo_persona")
                    insert_vals.append("NULLIF(%s, '')")
                    insert_params.append(tipo_persona_nuevo or "")

                if not insert_cols:
                    raise HTTPException(
                        status_code=500,
                        detail="catalogos.personas no tiene columnas actualizables para titularidad"
                    )

                sql_insert_persona = f"""
                    INSERT INTO catalogos.personas ({", ".join(insert_cols)})
                    VALUES ({", ".join(insert_vals)})
                    RETURNING *;
                """
                cur.execute(sql_insert_persona, insert_params)
                persona_actualizada = cur.fetchone()

                nueva_id_persona = persona_actualizada.get("id_persona")

                # Insertar relación con solo columnas existentes
                rel_cols = ["clave_catastral", "id_persona"]
                rel_vals = ["%s", "%s"]
                rel_params = [clave, nueva_id_persona]

                if "porcentaje_propiedad" in cols_pp:
                    rel_cols.append("porcentaje_propiedad")
                    rel_vals.append("%s")
                    rel_params.append(100)

                if "titular_principal" in cols_pp:
                    rel_cols.append("titular_principal")
                    rel_vals.append("%s")
                    rel_params.append(True)

                if "tipo_titularidad" in cols_pp:
                    rel_cols.append("tipo_titularidad")
                    rel_vals.append("%s")
                    rel_params.append("PROPIETARIO")

                sql_insert_rel = f"""
                    INSERT INTO catastro.predio_propietario ({", ".join(rel_cols)})
                    VALUES ({", ".join(rel_vals)});
                """
                cur.execute(sql_insert_rel, rel_params)

            # 4) Historial titularidad
            cur.execute("""
                INSERT INTO catastro.historial_titularidad (
                    clave_catastral,
                    movimiento_id,
                    tipo_evento,
                    nombre_anterior,
                    nombre_nuevo,
                    tipo_titularidad_nueva,
                    motivo,
                    usuario_modifica
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
            """, (
                clave,
                movimiento_id,
                tipo,
                nombre_anterior,
                nombre_nuevo,
                tipo_persona_nuevo,
                mov.get("motivo"),
                usuario
            ))

            # 5) Auditoría
            cur.execute("""
                INSERT INTO auditoria.movimientos_padron_auditoria (
                    movimiento_id,
                    clave_catastral,
                    accion,
                    estado_anterior,
                    estado_nuevo,
                    detalle,
                    datos,
                    usuario,
                    ip
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
            """, (
                movimiento_id,
                clave,
                "APLICAR_TITULARIDAD_RFC_V27H",
                mov["estado"],
                "APLICADO",
                "Cambio aplicado a catalogos.padron_2026 y catalogos.personas sin depender de pp.id",
                json.dumps({
                    "padron_2026": {
                        "nombre_anterior": nombre_anterior,
                        "nombre_nuevo": nombre_nuevo
                    },
                    "personas": {
                        "rfc_anterior": rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_anterior": tipo_persona_anterior,
                        "tipo_persona_nuevo": tipo_persona_nuevo,
                        "primer_apellido": primer_apellido,
                        "segundo_apellido": segundo_apellido,
                        "nombres": nombres,
                        "razon_social": razon_social
                    }
                }),
                usuario,
                request.client.host if request.client else None
            ))

            # 6) Movimiento aplicado
            cur.execute("""
                UPDATE catastro.movimientos_padron
                SET estado = 'APLICADO',
                    usuario_aplica = %s,
                    fecha_aplicacion = now()
                WHERE id = %s
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
            """, (usuario, movimiento_id))
            mov_final = cur.fetchone()

            conn.commit()

            return {
                "ok": True,
                "mensaje": "Movimiento de titularidad/RFC aplicado correctamente",
                "movimiento": mov_final,
                "actualizado": {
                    "clave_catastral": clave,
                    "nombre_completo": nombre_nuevo,
                    "rfc": rfc_nuevo,
                    "tipo_persona": tipo_persona_nuevo
                },
                "persona": persona_actualizada,
                "padron": padron_actualizado
            }




# ============================================================
# v27i - APLICACIÓN TITULARIDAD ACTUALIZANDO predio_propietario.rfc
# La ficha v_ficha_predial toma RFC desde catastro.predio_propietario.rfc
# ============================================================

@router.post("/movimientos/{movimiento_id}/aplicar-titularidad-v27i")
def aplicar_movimiento_titularidad_v27i(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()
            if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
                )

            clave = mov["clave_catastral"]
            if not clave:
                raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

            datos_nuevos = extraer_json_dict_v27h(mov.get("datos_nuevos"))

            nombre_nuevo = (
                datos_nuevos.get("nombre_propietario")
                or datos_nuevos.get("nombre_completo")
                or datos_nuevos.get("razon_social")
            )

            rfc_nuevo = datos_nuevos.get("rfc")
            tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
            primer_apellido = datos_nuevos.get("primer_apellido")
            segundo_apellido = datos_nuevos.get("segundo_apellido")
            nombres = datos_nuevos.get("nombres")
            razon_social = datos_nuevos.get("razon_social")

            cur.execute("""
                SELECT nombre_completo
                FROM catalogos.padron_2026
                WHERE clave_catastral = %s
                LIMIT 1;
            """, (clave,))
            padron_actual = cur.fetchone()

            if not padron_actual:
                raise HTTPException(
                    status_code=404,
                    detail="No se encontró la clave en catalogos.padron_2026"
                )

            nombre_anterior = padron_actual.get("nombre_completo")
            if not nombre_nuevo:
                nombre_nuevo = nombre_anterior

            cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
            cols_personas = columnas_tabla(cur, "catalogos", "personas")

            # 1) Actualizar nombre maestro del padrón
            cur.execute("""
                UPDATE catalogos.padron_2026
                SET nombre_completo = %s
                WHERE clave_catastral = %s
                RETURNING clave_catastral, nombre_completo;
            """, (nombre_nuevo, clave))
            padron_actualizado = cur.fetchone()

            # 2) Buscar relación predio_propietario
            cur.execute("""
                SELECT
                    pp.id_persona,
                    pp.rfc AS pp_rfc_anterior,
                    per.rfc AS persona_rfc_anterior,
                    per.nombre AS nombre_persona_anterior,
                    per.tipo_persona AS tipo_persona_anterior
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                ORDER BY pp.id_persona DESC
                LIMIT 1;
            """, (clave,))
            rel = cur.fetchone()

            persona_actualizada = None
            predio_propietario_actualizado = None
            pp_rfc_anterior = None
            persona_rfc_anterior = None
            tipo_persona_anterior = None

            if rel:
                pp_rfc_anterior = rel.get("pp_rfc_anterior")
                persona_rfc_anterior = rel.get("persona_rfc_anterior")
                tipo_persona_anterior = rel.get("tipo_persona_anterior")

            # 3) Actualizar catastro.predio_propietario porque de ahí lee la ficha
            pp_set = []
            pp_params = []

            if "rfc" in cols_pp:
                pp_set.append("rfc = COALESCE(NULLIF(%s, ''), rfc)")
                pp_params.append(rfc_nuevo or "")

            if "tipo_persona" in cols_pp:
                pp_set.append("tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)")
                pp_params.append(tipo_persona_nuevo or "")

            if "nombre_completo" in cols_pp:
                pp_set.append("nombre_completo = COALESCE(NULLIF(%s, ''), nombre_completo)")
                pp_params.append(nombre_nuevo or "")

            if pp_set:
                pp_params.append(clave)
                cur.execute(f"""
                    UPDATE catastro.predio_propietario
                    SET {", ".join(pp_set)}
                    WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                    RETURNING *;
                """, pp_params)
                predio_propietario_actualizado = cur.fetchone()

            # 4) Actualizar catalogos.personas si existe relación
            if rel and rel.get("id_persona"):
                persona_set = []
                persona_params = []

                if "nombre" in cols_personas:
                    persona_set.append("nombre = COALESCE(NULLIF(%s, ''), nombre)")
                    persona_params.append(nombre_nuevo or "")

                if "rfc" in cols_personas:
                    persona_set.append("rfc = COALESCE(NULLIF(%s, ''), rfc)")
                    persona_params.append(rfc_nuevo or "")

                if "tipo_persona" in cols_personas:
                    persona_set.append("tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)")
                    persona_params.append(tipo_persona_nuevo or "")

                if persona_set:
                    persona_params.append(rel["id_persona"])
                    cur.execute(f"""
                        UPDATE catalogos.personas
                        SET {", ".join(persona_set)}
                        WHERE id_persona = %s
                        RETURNING *;
                    """, persona_params)
                    persona_actualizada = cur.fetchone()

            # 5) Historial titularidad
            cur.execute("""
                INSERT INTO catastro.historial_titularidad (
                    clave_catastral,
                    movimiento_id,
                    tipo_evento,
                    nombre_anterior,
                    nombre_nuevo,
                    tipo_titularidad_nueva,
                    motivo,
                    usuario_modifica
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
            """, (
                clave,
                movimiento_id,
                tipo,
                nombre_anterior,
                nombre_nuevo,
                tipo_persona_nuevo,
                mov.get("motivo"),
                usuario
            ))

            # 6) Auditoría
            cur.execute("""
                INSERT INTO auditoria.movimientos_padron_auditoria (
                    movimiento_id,
                    clave_catastral,
                    accion,
                    estado_anterior,
                    estado_nuevo,
                    detalle,
                    datos,
                    usuario,
                    ip
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
            """, (
                movimiento_id,
                clave,
                "APLICAR_TITULARIDAD_RFC_V27I",
                mov["estado"],
                "APLICADO",
                "Cambio aplicado a padron_2026, predio_propietario.rfc y catalogos.personas",
                json.dumps({
                    "padron_2026": {
                        "nombre_anterior": nombre_anterior,
                        "nombre_nuevo": nombre_nuevo
                    },
                    "predio_propietario": {
                        "rfc_anterior": pp_rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_nuevo": tipo_persona_nuevo
                    },
                    "personas": {
                        "rfc_anterior": persona_rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_anterior": tipo_persona_anterior,
                        "tipo_persona_nuevo": tipo_persona_nuevo,
                        "primer_apellido": primer_apellido,
                        "segundo_apellido": segundo_apellido,
                        "nombres": nombres,
                        "razon_social": razon_social
                    }
                }),
                usuario,
                request.client.host if request.client else None
            ))

            # 7) Movimiento aplicado
            cur.execute("""
                UPDATE catastro.movimientos_padron
                SET estado = 'APLICADO',
                    usuario_aplica = %s,
                    fecha_aplicacion = now()
                WHERE id = %s
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
            """, (usuario, movimiento_id))
            mov_final = cur.fetchone()

            conn.commit()

            return {
                "ok": True,
                "mensaje": "Movimiento de titularidad/RFC aplicado correctamente",
                "movimiento": mov_final,
                "actualizado": {
                    "clave_catastral": clave,
                    "nombre_completo": nombre_nuevo,
                    "rfc": rfc_nuevo,
                    "tipo_persona": tipo_persona_nuevo
                },
                "padron": padron_actualizado,
                "predio_propietario": predio_propietario_actualizado,
                "persona": persona_actualizada
            }


