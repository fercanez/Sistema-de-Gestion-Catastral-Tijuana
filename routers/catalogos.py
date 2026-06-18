"""Catálogos institucionales: calles y colonias (mantenimiento y depuración)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

from auth.dependencies import requerir_permiso
from auth.permisos_operativos import requerir_alguno
from database import get_conn
from routers.propietarios import registrar_auditoria_simple_v28, upper_clean_v28

router = APIRouter(tags=["catalogos"])

_permiso_catalogos_lectura = requerir_alguno(
    "consulta",
    "ver_expediente",
    "editar_catastro",
    "solicitar_movimientos",
    "aplicar_movimientos",
)
_permiso_catalogos_escritura = requerir_permiso("editar_catastro")


class NombreCallePayload(BaseModel):
    nombre_calle: str


class NombreColoniaPayload(BaseModel):
    nombre_colonia: str


class FusionarCatalogoPayload(BaseModel):
    id_destino: int
    ids_origen: list[int]


def _condicion_busqueda_texto(campo: str, texto: str):
    if not texto:
        return "TRUE", []
    tokens = [t for t in str(texto).split() if t.strip()]
    if not tokens:
        return "TRUE", []
    partes = []
    params = []
    for token in tokens:
        partes.append(f"UPPER(TRIM({campo})) LIKE %s")
        params.append(f"%{token.upper()}%")
    return " AND ".join(partes), params


def _obtener_registro_catalogo(cur, tabla: str, id_registro: int, campo_nombre: str):
    cur.execute(f"""
        SELECT id, UPPER(TRIM({campo_nombre})) AS nombre, COALESCE(activo, TRUE) AS activo
        FROM catalogos.{tabla}
        WHERE id = %s
        LIMIT 1;
    """, (id_registro,))
    row = cur.fetchone()
    if not row or not row.get("activo"):
        return None
    return row


def _crear_o_reactivar_catalogo(cur, tabla: str, campo_nombre: str, nombre: str):
    cur.execute(f"""
        SELECT id, UPPER(TRIM({campo_nombre})) AS nombre, COALESCE(activo, TRUE) AS activo
        FROM catalogos.{tabla}
        WHERE UPPER(TRIM({campo_nombre})) = %s
        LIMIT 1;
    """, (nombre,))
    existente = cur.fetchone()
    if existente:
        if not existente.get("activo"):
            cur.execute(f"""
                UPDATE catalogos.{tabla}
                SET activo = TRUE
                WHERE id = %s
                RETURNING id, UPPER(TRIM({campo_nombre})) AS nombre;
            """, (existente["id"],))
            return cur.fetchone(), False
        return existente, False

    cur.execute(f"""
        INSERT INTO catalogos.{tabla} ({campo_nombre}, activo)
        VALUES (%s, TRUE)
        RETURNING id, UPPER(TRIM({campo_nombre})) AS nombre;
    """, (nombre,))
    return cur.fetchone(), True


def _buscar_mantenimiento_catalogo(
    cur,
    *,
    tabla: str,
    campo_nombre: str,
    campo_padron: str,
    texto: str,
    limite: int,
):
    filtro, params = _condicion_busqueda_texto(f"c.{campo_nombre}", texto)
    like_contiene = f"%{texto}%" if texto else "%"

    cur.execute(f"""
        SELECT
            c.id,
            UPPER(TRIM(c.{campo_nombre})) AS nombre,
            'catalogo'::text AS origen,
            (
                SELECT COUNT(*)::int
                FROM catalogos.padron_2026 p
                WHERE UPPER(TRIM(p.{campo_padron})) = UPPER(TRIM(c.{campo_nombre}))
            ) AS predios_padron,
            (
                SELECT COUNT(*)::int
                FROM catalogos.personas pe
                WHERE COALESCE(pe.activo, TRUE) = TRUE
                  AND UPPER(TRIM(pe.{campo_padron})) = UPPER(TRIM(c.{campo_nombre}))
            ) AS personas_catalogo
        FROM catalogos.{tabla} c
        WHERE COALESCE(c.activo, TRUE) = TRUE
          AND NULLIF(TRIM(c.{campo_nombre}), '') IS NOT NULL
          AND ({filtro})
        ORDER BY
            CASE WHEN %s <> '' AND UPPER(TRIM(c.{campo_nombre})) = %s THEN 0 ELSE 1 END,
            c.{campo_nombre}
        LIMIT %s;
    """, (*params, texto, texto, limite))
    rows = [dict(r) for r in cur.fetchall()]
    nombres_vistos = {r["nombre"] for r in rows if r.get("nombre")}

    restante = max(limite - len(rows), 0)
    if restante > 0 and texto:
        cur.execute(f"""
            SELECT DISTINCT UPPER(TRIM(p.{campo_padron})) AS nombre
            FROM catalogos.padron_2026 p
            WHERE NULLIF(TRIM(p.{campo_padron}), '') IS NOT NULL
              AND UPPER(TRIM(p.{campo_padron})) LIKE %s
            ORDER BY 1
            LIMIT %s;
        """, (like_contiene, restante * 3))
        for pr in cur.fetchall():
            nom = pr.get("nombre")
            if not nom or nom in nombres_vistos:
                continue
            nombres_vistos.add(nom)
            cur.execute(f"""
                SELECT COUNT(*)::int AS total
                FROM catalogos.padron_2026 p
                WHERE UPPER(TRIM(p.{campo_padron})) = %s;
            """, (nom,))
            predios = int((cur.fetchone() or {}).get("total") or 0)
            rows.append({
                "id": None,
                "nombre": nom,
                "origen": "padron",
                "predios_padron": predios,
                "personas_catalogo": 0,
            })
            if len(rows) >= limite:
                break

    return rows[:limite]


def _fusionar_catalogo(
    cur,
    *,
    tabla: str,
    campo_nombre: str,
    campo_padron: str,
    id_destino: int,
    ids_origen: list[int],
    usuario: str,
    ip: Optional[str],
    etiqueta: str,
):
    dest_row = _obtener_registro_catalogo(cur, tabla, id_destino, campo_nombre)
    if not dest_row:
        raise HTTPException(status_code=404, detail=f"{etiqueta} destino no encontrada o inactiva.")

    origenes = sorted({int(x) for x in ids_origen if int(x) != id_destino})
    if not origenes:
        raise HTTPException(status_code=400, detail="Indique al menos un registro origen distinto al destino.")

    nombre_destino = dest_row["nombre"]
    padron_actualizados = 0
    personas_actualizadas = 0
    desactivados = 0

    for id_origen in origenes:
        orig_row = _obtener_registro_catalogo(cur, tabla, id_origen, campo_nombre)
        if not orig_row:
            raise HTTPException(
                status_code=404,
                detail=f"{etiqueta} origen id={id_origen} no encontrada o inactiva."
            )
        nombre_origen = orig_row["nombre"]
        if nombre_origen == nombre_destino:
            continue

        cur.execute(f"""
            UPDATE catalogos.padron_2026
            SET {campo_padron} = %s
            WHERE UPPER(TRIM({campo_padron})) = %s;
        """, (nombre_destino, nombre_origen))
        padron_actualizados += cur.rowcount

        cur.execute(f"""
            UPDATE catalogos.personas
            SET {campo_padron} = %s
            WHERE COALESCE(activo, TRUE) = TRUE
              AND UPPER(TRIM({campo_padron})) = %s;
        """, (nombre_destino, nombre_origen))
        personas_actualizadas += cur.rowcount

        cur.execute(f"""
            UPDATE catalogos.{tabla}
            SET activo = FALSE
            WHERE id = %s;
        """, (id_origen,))
        desactivados += 1

        registrar_auditoria_simple_v28(
            cur,
            usuario,
            f"FUSIONAR_{etiqueta.upper()}",
            "CATALOGOS",
            f"Fusion {etiqueta} id_origen={id_origen} ({nombre_origen}) -> id_destino={id_destino} ({nombre_destino})",
            ip,
        )

    return {
        "ok": True,
        "id_destino": id_destino,
        "nombre_destino": nombre_destino,
        "registros_desactivados": desactivados,
        "padron_actualizados": padron_actualizados,
        "personas_actualizadas": personas_actualizadas,
    }


# --- CALLES ---

@router.get("/catalogos/calles/mantenimiento/buscar")
def buscar_calles_mantenimiento(
    q: str = Query("", max_length=150),
    limite: int = Query(150, ge=1, le=500),
    usuario_actual: dict = Depends(_permiso_catalogos_lectura),
):
    texto = upper_clean_v28(q) or ""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            rows = _buscar_mantenimiento_catalogo(
                cur,
                tabla="cat_calles",
                campo_nombre="nombre_calle",
                campo_padron="calle",
                texto=texto,
                limite=limite,
            )
            resultados = [
                {
                    "id": int(r["id"]) if r.get("id") is not None else None,
                    "nombre_calle": r["nombre"],
                    "origen": r["origen"],
                    "predios_padron": int(r.get("predios_padron") or 0),
                    "personas_catalogo": int(r.get("personas_catalogo") or 0),
                }
                for r in rows
            ]
            return {"total": len(resultados), "resultados": resultados}


@router.post("/catalogos/calles")
def crear_calle_mantenimiento(
    payload: NombreCallePayload,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    nombre = upper_clean_v28(payload.nombre_calle)
    if not nombre:
        raise HTTPException(status_code=400, detail="Capture el nombre de la calle.")
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            row, creada = _crear_o_reactivar_catalogo(cur, "cat_calles", "nombre_calle", nombre)
            if creada:
                registrar_auditoria_simple_v28(
                    cur,
                    usuario_actual.get("usuario"),
                    "CREAR_CALLE",
                    "CATALOGOS",
                    f"Calle creada id={row['id']} nombre={nombre}",
                    request.client.host if request.client else None,
                )
            conn.commit()
            return {
                "ok": True,
                "creada": creada,
                "calle": {
                    "id": int(row["id"]),
                    "nombre_calle": row["nombre"],
                    "origen": "catalogo",
                },
            }


@router.put("/catalogos/calles/{id_calle}")
def actualizar_calle_mantenimiento(
    id_calle: int,
    payload: NombreCallePayload,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    nombre = upper_clean_v28(payload.nombre_calle)
    if not nombre:
        raise HTTPException(status_code=400, detail="Capture el nombre de la calle.")
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            actual = _obtener_registro_catalogo(cur, "cat_calles", id_calle, "nombre_calle")
            if not actual:
                raise HTTPException(status_code=404, detail="Calle no encontrada o inactiva.")
            nombre_anterior = actual["nombre"]
            if nombre != nombre_anterior:
                cur.execute("""
                    SELECT id FROM catalogos.cat_calles
                    WHERE UPPER(TRIM(nombre_calle)) = %s
                      AND id <> %s
                      AND COALESCE(activo, TRUE) = TRUE
                    LIMIT 1;
                """, (nombre, id_calle))
                if cur.fetchone():
                    raise HTTPException(status_code=409, detail="Ya existe otra calle con ese nombre.")

            cur.execute("""
                UPDATE catalogos.cat_calles
                SET nombre_calle = %s
                WHERE id = %s
                RETURNING id, UPPER(TRIM(nombre_calle)) AS nombre_calle;
            """, (nombre, id_calle))
            row = cur.fetchone()

            cur.execute("""
                UPDATE catalogos.padron_2026
                SET calle = %s
                WHERE UPPER(TRIM(calle)) = %s;
            """, (nombre, nombre_anterior))
            padron_upd = cur.rowcount

            cur.execute("""
                UPDATE catalogos.personas
                SET calle = %s
                WHERE COALESCE(activo, TRUE) = TRUE
                  AND UPPER(TRIM(calle)) = %s;
            """, (nombre, nombre_anterior))
            personas_upd = cur.rowcount

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ACTUALIZAR_CALLE",
                "CATALOGOS",
                f"Calle id={id_calle}: {nombre_anterior} -> {nombre}; padron={padron_upd}; personas={personas_upd}",
                request.client.host if request.client else None,
            )
            conn.commit()
            return {
                "ok": True,
                "calle": {"id": int(row["id"]), "nombre_calle": row["nombre_calle"]},
                "padron_actualizados": padron_upd,
                "personas_actualizadas": personas_upd,
            }


@router.delete("/catalogos/calles/{id_calle}")
def baja_calle_mantenimiento(
    id_calle: int,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            actual = _obtener_registro_catalogo(cur, "cat_calles", id_calle, "nombre_calle")
            if not actual:
                raise HTTPException(status_code=404, detail="Calle no encontrada o ya inactiva.")
            cur.execute("""
                UPDATE catalogos.cat_calles SET activo = FALSE WHERE id = %s;
            """, (id_calle,))
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "BAJA_CALLE",
                "CATALOGOS",
                f"Calle dada de baja id={id_calle} nombre={actual['nombre']}",
                request.client.host if request.client else None,
            )
            conn.commit()
            return {"ok": True, "id": id_calle}


@router.post("/catalogos/calles/fusionar")
def fusionar_calles_mantenimiento(
    payload: FusionarCatalogoPayload,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            result = _fusionar_catalogo(
                cur,
                tabla="cat_calles",
                campo_nombre="nombre_calle",
                campo_padron="calle",
                id_destino=int(payload.id_destino),
                ids_origen=payload.ids_origen or [],
                usuario=usuario_actual.get("usuario"),
                ip=request.client.host if request.client else None,
                etiqueta="calle",
            )
            conn.commit()
            return result


# --- COLONIAS ---

@router.get("/catalogos/colonias/mantenimiento/buscar")
def buscar_colonias_mantenimiento(
    q: str = Query("", max_length=150),
    limite: int = Query(150, ge=1, le=500),
    usuario_actual: dict = Depends(_permiso_catalogos_lectura),
):
    texto = upper_clean_v28(q) or ""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            rows = _buscar_mantenimiento_catalogo(
                cur,
                tabla="cat_colonias",
                campo_nombre="nombre_colonia",
                campo_padron="colonia",
                texto=texto,
                limite=limite,
            )
            resultados = [
                {
                    "id": int(r["id"]) if r.get("id") is not None else None,
                    "nombre_colonia": r["nombre"],
                    "origen": r["origen"],
                    "predios_padron": int(r.get("predios_padron") or 0),
                    "personas_catalogo": int(r.get("personas_catalogo") or 0),
                }
                for r in rows
            ]
            return {"total": len(resultados), "resultados": resultados}


@router.post("/catalogos/colonias")
def crear_colonia_mantenimiento(
    payload: NombreColoniaPayload,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    nombre = upper_clean_v28(payload.nombre_colonia)
    if not nombre:
        raise HTTPException(status_code=400, detail="Capture el nombre de la colonia.")
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            row, creada = _crear_o_reactivar_catalogo(cur, "cat_colonias", "nombre_colonia", nombre)
            if creada:
                registrar_auditoria_simple_v28(
                    cur,
                    usuario_actual.get("usuario"),
                    "CREAR_COLONIA",
                    "CATALOGOS",
                    f"Colonia creada id={row['id']} nombre={nombre}",
                    request.client.host if request.client else None,
                )
            conn.commit()
            return {
                "ok": True,
                "creada": creada,
                "colonia": {
                    "id": int(row["id"]),
                    "nombre_colonia": row["nombre"],
                    "origen": "catalogo",
                },
            }


@router.put("/catalogos/colonias/{id_colonia}")
def actualizar_colonia_mantenimiento(
    id_colonia: int,
    payload: NombreColoniaPayload,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    nombre = upper_clean_v28(payload.nombre_colonia)
    if not nombre:
        raise HTTPException(status_code=400, detail="Capture el nombre de la colonia.")
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            actual = _obtener_registro_catalogo(cur, "cat_colonias", id_colonia, "nombre_colonia")
            if not actual:
                raise HTTPException(status_code=404, detail="Colonia no encontrada o inactiva.")
            nombre_anterior = actual["nombre"]
            if nombre != nombre_anterior:
                cur.execute("""
                    SELECT id FROM catalogos.cat_colonias
                    WHERE UPPER(TRIM(nombre_colonia)) = %s
                      AND id <> %s
                      AND COALESCE(activo, TRUE) = TRUE
                    LIMIT 1;
                """, (nombre, id_colonia))
                if cur.fetchone():
                    raise HTTPException(status_code=409, detail="Ya existe otra colonia con ese nombre.")

            cur.execute("""
                UPDATE catalogos.cat_colonias
                SET nombre_colonia = %s
                WHERE id = %s
                RETURNING id, UPPER(TRIM(nombre_colonia)) AS nombre_colonia;
            """, (nombre, id_colonia))
            row = cur.fetchone()

            cur.execute("""
                UPDATE catalogos.padron_2026
                SET colonia = %s
                WHERE UPPER(TRIM(colonia)) = %s;
            """, (nombre, nombre_anterior))
            padron_upd = cur.rowcount

            cur.execute("""
                UPDATE catalogos.personas
                SET colonia = %s
                WHERE COALESCE(activo, TRUE) = TRUE
                  AND UPPER(TRIM(colonia)) = %s;
            """, (nombre, nombre_anterior))
            personas_upd = cur.rowcount

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ACTUALIZAR_COLONIA",
                "CATALOGOS",
                f"Colonia id={id_colonia}: {nombre_anterior} -> {nombre}; padron={padron_upd}; personas={personas_upd}",
                request.client.host if request.client else None,
            )
            conn.commit()
            return {
                "ok": True,
                "colonia": {"id": int(row["id"]), "nombre_colonia": row["nombre_colonia"]},
                "padron_actualizados": padron_upd,
                "personas_actualizadas": personas_upd,
            }


@router.delete("/catalogos/colonias/{id_colonia}")
def baja_colonia_mantenimiento(
    id_colonia: int,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            actual = _obtener_registro_catalogo(cur, "cat_colonias", id_colonia, "nombre_colonia")
            if not actual:
                raise HTTPException(status_code=404, detail="Colonia no encontrada o ya inactiva.")
            cur.execute("""
                UPDATE catalogos.cat_colonias SET activo = FALSE WHERE id = %s;
            """, (id_colonia,))
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "BAJA_COLONIA",
                "CATALOGOS",
                f"Colonia dada de baja id={id_colonia} nombre={actual['nombre']}",
                request.client.host if request.client else None,
            )
            conn.commit()
            return {"ok": True, "id": id_colonia}


@router.post("/catalogos/colonias/fusionar")
def fusionar_colonias_mantenimiento(
    payload: FusionarCatalogoPayload,
    request: Request,
    usuario_actual: dict = Depends(_permiso_catalogos_escritura),
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            result = _fusionar_catalogo(
                cur,
                tabla="cat_colonias",
                campo_nombre="nombre_colonia",
                campo_padron="colonia",
                id_destino=int(payload.id_destino),
                ids_origen=payload.ids_origen or [],
                usuario=usuario_actual.get("usuario"),
                ip=request.client.host if request.client else None,
                etiqueta="colonia",
            )
            conn.commit()
            return result
