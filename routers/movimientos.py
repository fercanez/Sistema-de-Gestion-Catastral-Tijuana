"""Router de movimientos catastrales (CRUD + aplicacion al padron)."""
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

from auth.acl import normalizar_rol, usuario_tiene_permiso
from auth.dependencies import obtener_usuario_actual
from auth.permisos_operativos import exigir_permiso_usuario, validar_permiso_tipo_movimiento
from database import get_conn, columnas_tabla, asegurar_tabla_predio_condominio
from routers.movimientos_aplicar_helpers import aplicar_propietarios_desde_movimiento
from routers.padron import CODIGOS_TENENCIA_PADRON, _aplicar_tenencia_predio, normalizar_codigo_tenencia

router = APIRouter(tags=["movimientos"])

APLICAR_PADRON_VERSION = "20260530_v57e"

CAMPO_A_PADRON = {
    "superficie_documental": "sup_documental", "sup_documental": "sup_documental",
    "superficie_fisica": "sup_fisica", "sup_fisica": "sup_fisica",
    "superficie_construccion": "sup_const", "sup_const": "sup_const", "construccion": "sup_const",
    "uso_suelo": "descripcion_uso", "descripcion_uso": "descripcion_uso",
    "zona_homogenea": "zonah", "zonah": "zonah",
    "numero_oficial": "numof", "numof": "numof",
    "nombre_propietario": "nombre_completo", "nombre_completo": "nombre_completo", "propietario": "nombre_completo",
    "delegacion": "delegacion", "colonia": "colonia", "calle": "calle", "numint": "numint",
    "letra": "letra", "condominio": "condominio", "valor2026": "valor2026",
    "id_tasa": "id_tasa", "porcentaje_tasa": "porcentaje_tasa",
}

COLS_NUMERICAS_PADRON = {
    "sup_documental", "sup_fisica", "sup_const", "valor2026",
    "adeudo_2026", "adeudo_total", "id_tasa", "porcentaje_tasa",
}


def _json_default_safe(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return str(obj)


def _json_dumps_safe(data) -> str:
    return json.dumps(data or {}, default=_json_default_safe)


def _fila_a_dict(fila) -> dict:
    if not fila:
        return {}
    raw = fila if isinstance(fila, dict) else dict(fila)
    return {k: _json_default_safe(v) if isinstance(v, (Decimal, datetime, date)) else v for k, v in raw.items()}


def _respuesta_json(data: dict) -> JSONResponse:
    return JSONResponse(content=json.loads(_json_dumps_safe(data)))


def _ok_aplicar(mensaje: str, mov_final, actualizado=None) -> JSONResponse:
    body = {"ok": True, "mensaje": mensaje, "movimiento": _fila_a_dict(mov_final)}
    if actualizado is not None:
        body["actualizado"] = _fila_a_dict(actualizado)
    return _respuesta_json(body)


def _coerce_valor_padron(col: str, valor):
    if col in COLS_NUMERICAS_PADRON:
        txt = str(valor).strip().replace(",", "")
        if not txt:
            return None
        try:
            return float(txt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Valor numerico invalido para {col}: {valor}")
    return str(valor).strip() if valor is not None else None


def _json_dict(val) -> dict:
    if isinstance(val, dict):
        return val
    if isinstance(val, str) and val.strip():
        try:
            return json.loads(val)
        except Exception:
            return {}
    return {}


def _resolver_columna_padron(campo: str) -> Optional[str]:
    c = (campo or "").strip().lower()
    return CAMPO_A_PADRON.get(c, c if c else None)


def valor_detalle(detalles, campo_busqueda: str):
    campo_busqueda = (campo_busqueda or "").strip().lower()
    for d in detalles:
        if str(d.get("campo") or "").strip().lower() == campo_busqueda:
            return d.get("valor_nuevo")
    return None


def _valor_desde_movimiento(mov: dict, detalles: list, *campos: str):
    for c in campos:
        val = valor_detalle(detalles, c)
        if val is not None and str(val).strip() != "":
            return val
    datos = _json_dict(mov.get("datos_nuevos"))
    for c in campos:
        if c in datos and datos[c] is not None and str(datos[c]).strip() != "":
            return datos[c]
    return None


REGIMEN_PADRON_VALIDOS = set(CODIGOS_TENENCIA_PADRON)
MODALIDADES_CONDOMINIO_ALTA = {"VERTICAL", "HORIZONTAL"}


def _normalizar_regimen_padron_alta(valor) -> Optional[str]:
    codigo = normalizar_codigo_tenencia(str(valor or "").strip())
    return codigo if codigo in REGIMEN_PADRON_VALIDOS else None


def _extraer_clasificacion_condominio_alta(mov: dict, detalles: list) -> dict:
    datos = _json_dict(mov.get("datos_nuevos"))
    regimen = _normalizar_regimen_padron_alta(
        _valor_desde_movimiento(mov, detalles, "condominio", "regimen_padron")
        or datos.get("condominio")
    )
    modalidad = (
        _valor_desde_movimiento(mov, detalles, "modalidad_condominio", "modalidad")
        or datos.get("modalidad_condominio")
        or ""
    )
    modalidad = str(modalidad).strip().upper() or None
    if modalidad and modalidad not in MODALIDADES_CONDOMINIO_ALTA:
        raise HTTPException(
            status_code=400,
            detail="Modalidad de condominio invalida. Use VERTICAL o HORIZONTAL.",
        )
    nombre = (
        _valor_desde_movimiento(mov, detalles, "nombre_condominio")
        or datos.get("nombre_condominio")
        or ""
    )
    nombre = str(nombre).strip().upper() or None
    return {"regimen": regimen, "modalidad": modalidad, "nombre_condominio": nombre}


def _validar_clasificacion_condominio_alta(clasif: dict):
    regimen = clasif.get("regimen")
    if regimen not in REGIMEN_PADRON_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail="El alta de clave requiere tipo de tenencia: C, P, G, S, R o E.",
        )
    if regimen == "C" and clasif.get("modalidad") not in MODALIDADES_CONDOMINIO_ALTA:
        raise HTTPException(
            status_code=400,
            detail="Alta en regimen Condominio (C) requiere modalidad VERTICAL u HORIZONTAL.",
        )


def _registrar_condominio_alta_catastro(cur, clave: str, clasif: dict, usuario: Optional[str]):
    if clasif.get("regimen") != "C":
        return
    asegurar_tabla_predio_condominio(cur, cur.connection)
    cur.execute("""
        INSERT INTO catastro.predio_condominio (
            clave_catastral, modalidad, nombre_condominio, regimen_catastro,
            observaciones, usuario_actualizacion, fecha_actualizacion
        ) VALUES (%s, %s, %s, 'C', %s, %s, now())
        ON CONFLICT (clave_catastral) DO UPDATE SET
            modalidad = EXCLUDED.modalidad,
            nombre_condominio = EXCLUDED.nombre_condominio,
            regimen_catastro = 'C',
            observaciones = EXCLUDED.observaciones,
            usuario_actualizacion = EXCLUDED.usuario_actualizacion,
            fecha_actualizacion = now();
    """, (
        clave.strip().upper(),
        clasif.get("modalidad"),
        clasif.get("nombre_condominio"),
        "Alta de clave",
        usuario or "sistema",
    ))


def _obtener_fila_padron(cur, clave: str):
    cur.execute("""
        SELECT * FROM catalogos.padron_2026
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s)) LIMIT 1;
    """, (clave,))
    return cur.fetchone()


def _resolver_id_catalogo_nombre(cur, tabla: str, campo: str, nombre: str):
    nombre_norm = str(nombre or "").strip().upper()
    if not nombre_norm:
        return None
    cur.execute(
        f"""
        SELECT id FROM catalogos.{tabla}
        WHERE UPPER(TRIM({campo})) = %s
          AND COALESCE(activo, TRUE) = TRUE
        LIMIT 1;
        """,
        (nombre_norm,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return int(row["id"] if isinstance(row, dict) else row[0])


def _sincronizar_campos_a_predios(cur, clave: str, updates: dict):
    """Propaga al predio cartografico los campos que existan en catastro.predios."""
    if not updates:
        return
    cols_pred = columnas_tabla(cur, "catastro", "predios")
    sync = dict(updates)
    if "colonia" in sync and "colonia_id" in cols_pred:
        colonia_id = _resolver_id_catalogo_nombre(cur, "cat_colonias", "nombre_colonia", sync["colonia"])
        if colonia_id is not None:
            sync["colonia_id"] = colonia_id
    if "calle" in sync and "calle_id" in cols_pred:
        calle_id = _resolver_id_catalogo_nombre(cur, "cat_calles", "nombre_calle", sync["calle"])
        if calle_id is not None:
            sync["calle_id"] = calle_id
    sets, params = [], []
    for col, val in sync.items():
        if col not in cols_pred:
            continue
        sets.append(f"{col} = %s")
        if col in ("colonia_id", "calle_id"):
            params.append(int(val))
        else:
            params.append(_coerce_valor_padron(col, val))
    if not sets:
        return
    params.append(clave)
    cur.execute(f"""
        UPDATE catastro.predios SET {", ".join(sets)}
        WHERE UPPER(TRIM(clave_catastral::text)) = UPPER(TRIM(%s));
    """, params)


def _aplicar_campos_padron(cur, clave: str, updates: dict):
    if not updates:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar en el padron")
    anterior = _obtener_fila_padron(cur, clave)
    if not anterior:
        raise HTTPException(status_code=404, detail="No se encontro la clave en padron_2026")
    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    sets, params, aplicados = [], [], {}
    for col, val in updates.items():
        if col not in cols:
            continue
        sets.append(f"{col} = %s")
        coerced = _coerce_valor_padron(col, val)
        params.append(coerced)
        aplicados[col] = coerced
    if not sets:
        raise HTTPException(
            status_code=400,
            detail=f"Ningun campo valido para actualizar. Campos recibidos: {', '.join(sorted(updates.keys()))}",
        )
    params.append(clave)
    cur.execute(f"""
        UPDATE catalogos.padron_2026 SET {", ".join(sets)}
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        RETURNING *;
    """, params)
    actualizado = cur.fetchone()
    if not actualizado:
        raise HTTPException(status_code=500, detail="No se pudo actualizar el padron (0 filas)")
    _sincronizar_campos_a_predios(cur, clave, aplicados)
    return actualizado


def _aplicar_campos_desde_detalles(cur, clave: str, detalles: list, mov: dict):
    updates = {}
    for d in detalles or []:
        col = _resolver_columna_padron(str(d.get("campo") or ""))
        val = d.get("valor_nuevo")
        if col and val is not None and str(val).strip() != "":
            updates[col] = val
    if not updates:
        datos = _json_dict(mov.get("datos_nuevos"))
        for k, v in datos.items():
            col = _resolver_columna_padron(k)
            if col and v is not None and str(v).strip() != "":
                updates[col] = v
    return _aplicar_campos_padron(cur, clave, updates)


def _es_verdadero(val) -> bool:
    return str(val or "").strip().upper() in {"1", "TRUE", "SI", "S", "YES"}


def _registrar_zona_homogenea_adicional(cur, mov: dict, detalles: list, clave: str, movimiento_id: int, usuario: str):
    """Registra en catalogo adicional/temporal cuando el movimiento lo indica."""
    cols = columnas_tabla(cur, "catalogos", "cat_zonas_homogeneas_adicionales")
    if not cols:
        return None

    flag = _valor_desde_movimiento(mov, detalles, "es_zona_adicional")
    if not _es_verdadero(flag):
        return None

    codigo = str(_valor_desde_movimiento(mov, detalles, "zonah", "zona_homogenea") or "").strip().upper()
    if not codigo:
        return None

    descripcion = str(_valor_desde_movimiento(mov, detalles, "descripcion_zona") or codigo).strip().upper()
    valor_txt = _valor_desde_movimiento(mov, detalles, "valor_m2_zona")
    try:
        valor_m2 = float(str(valor_txt).replace(",", "")) if valor_txt is not None else 0.0
    except ValueError:
        valor_m2 = 0.0

    anio_txt = _valor_desde_movimiento(mov, detalles, "anio_zona")
    try:
        anio = int(anio_txt) if anio_txt is not None else 2026
    except ValueError:
        anio = 2026

    tipo_zona = str(_valor_desde_movimiento(mov, detalles, "tipo_zona") or "ADICIONAL").strip().upper()
    if tipo_zona not in {"ADICIONAL", "TEMPORAL"}:
        tipo_zona = "ADICIONAL"

    fundamento = str(_valor_desde_movimiento(mov, detalles, "fundamento_legal") or mov.get("motivo") or "").strip().upper()
    subsector = str(_valor_desde_movimiento(mov, detalles, "subsector_zona") or "").strip().upper() or None
    homoclave = str(_valor_desde_movimiento(mov, detalles, "homoclave_zona") or "").strip().upper() or None
    seccion = str(_valor_desde_movimiento(mov, detalles, "seccion_zona") or "").strip().upper() or None

    cur.execute("""
        INSERT INTO catalogos.cat_zonas_homogeneas_adicionales (
            anio, subsector, homoclave_col_fracc, seccion,
            codigo_zona_homogenea, descripcion_col_fracc, valor_m2,
            tipo_zona, fundamento_legal, clave_catastral_origen,
            movimiento_id, usuario_registro, activo
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        RETURNING id, codigo_zona_homogenea, tipo_zona;
    """, (
        anio, subsector, homoclave, seccion,
        codigo, descripcion, valor_m2,
        tipo_zona, fundamento, clave,
        movimiento_id, usuario,
    ))
    return cur.fetchone()


def _actualizar_estatus_predio(cur, clave: str, estatus: str) -> bool:
    cols = columnas_tabla(cur, "catastro", "predios")
    if "estatus" not in cols:
        return False
    cur.execute("""
        UPDATE catastro.predios SET estatus = %s
        WHERE UPPER(TRIM(clave_catastral::text)) = UPPER(TRIM(%s));
    """, (estatus, clave))
    return True


def _propagar_clave_en_tablas(cur, clave_ant: str, clave_nueva: str):
    if not clave_nueva:
        raise HTTPException(status_code=400, detail="Falta clave catastral nueva")
    anterior = _obtener_fila_padron(cur, clave_ant)
    if not anterior:
        raise HTTPException(status_code=404, detail="Clave anterior no encontrada en padron")
    cur.execute("""
        UPDATE catalogos.padron_2026 SET clave_catastral = %s
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        RETURNING clave_catastral;
    """, (clave_nueva, clave_ant))
    for schema, tabla in [
        ("catastro", "predios"),
        ("catastro", "predio_propietario"),
        ("catastro", "predios_copropietarios"),
    ]:
        cols = columnas_tabla(cur, schema, tabla)
        if "clave_catastral" in cols:
            cur.execute(f"""
                UPDATE {schema}.{tabla} SET clave_catastral = %s
                WHERE UPPER(TRIM(clave_catastral::text)) = UPPER(TRIM(%s));
            """, (clave_nueva, clave_ant))
    return anterior, clave_nueva


def _aplicar_baja_clave(cur, clave: str):
    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    anterior = _obtener_fila_padron(cur, clave)
    if not anterior:
        raise HTTPException(status_code=404, detail="Clave no encontrada")
    if "activo" in cols:
        cur.execute("""
            UPDATE catalogos.padron_2026 SET activo = FALSE
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s)) RETURNING clave_catastral;
        """, (clave,))
        return cur.fetchone(), "activo=FALSE"
    _actualizar_estatus_predio(cur, clave, "BAJA")
    return anterior, "estatus=BAJA"


def _aplicar_alta_clave(cur, mov: dict, detalles: list, usuario: Optional[str] = None):
    clave = mov.get("clave_catastral_nueva") or mov.get("clave_catastral") or _valor_desde_movimiento(
        mov, detalles, "clave_catastral", "clave_nueva")
    if not clave:
        raise HTTPException(status_code=400, detail="Falta clave para alta")
    clave = str(clave).strip().upper()

    clasif = _extraer_clasificacion_condominio_alta(mov, detalles)
    _validar_clasificacion_condominio_alta(clasif)

    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    datos = _json_dict(mov.get("datos_nuevos"))
    skip_keys = {"modalidad_condominio", "nombre_condominio", "regimen_padron"}
    row = {"clave_catastral": clave, "condominio": clasif["regimen"]}
    for k, v in datos.items():
        if k in skip_keys:
            continue
        col = _resolver_columna_padron(k)
        if col and col in cols and v is not None and str(v).strip() != "":
            row[col] = _coerce_valor_padron(col, v) if col in COLS_NUMERICAS_PADRON else str(v).strip()
    for d in detalles or []:
        col = _resolver_columna_padron(str(d.get("campo") or ""))
        val = d.get("valor_nuevo")
        if col and col in cols and val is not None and str(val).strip() != "":
            row[col] = _coerce_valor_padron(col, val) if col in COLS_NUMERICAS_PADRON else str(val).strip()
    if not str(row.get("nombre_completo") or "").strip():
        raise HTTPException(status_code=400, detail="El alta requiere nombre del titular")
    row["condominio"] = clasif["regimen"]

    if _obtener_fila_padron(cur, clave):
        sets = [f"{c} = %s" for c in row if c != "clave_catastral"]
        params = [row[c] for c in row if c != "clave_catastral"] + [clave]
        cur.execute(f"""
            UPDATE catalogos.padron_2026 SET {", ".join(sets)}
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s)) RETURNING *;
        """, params)
        result = cur.fetchone()
    else:
        campos = list(row.keys())
        cur.execute(f"""
            INSERT INTO catalogos.padron_2026 ({", ".join(campos)})
            VALUES ({", ".join(["%s"] * len(campos))}) RETURNING *;
        """, [row[c] for c in campos])
        result = cur.fetchone()

    _registrar_condominio_alta_catastro(cur, clave, clasif, usuario)
    return result


def _parse_lista_claves(texto: str) -> List[str]:
    if not texto:
        return []
    return [p.strip() for p in str(texto).replace(";", ",").split(",") if p.strip()]


def _registrar_relaciones_prediales(cur, movimiento_id: int, tipo: str, origen: str, destinos: List[str],
                                    usuario: str, detalles: list):
    n = 0
    for dest in destinos:
        cur.execute("""
            INSERT INTO catastro.relaciones_prediales (
                movimiento_id, tipo_relacion, clave_origen, clave_destino, usuario_registro, vigente
            ) VALUES (%s,%s,%s,%s,%s,TRUE);
        """, (movimiento_id, tipo, origen, dest, usuario))
        n += 1
    return n


def _registrar_auditoria_aplicar(cur, movimiento_id: int, clave: str, accion: str, estado_ant: str,
                                 detalle: str, datos: dict, usuario: str, ip: Optional[str]):
    cur.execute("""
        INSERT INTO auditoria.movimientos_padron_auditoria (
            movimiento_id, clave_catastral, accion, estado_anterior, estado_nuevo,
            detalle, datos, usuario, ip
        ) VALUES (%s,%s,%s,%s,'APLICADO',%s,%s::jsonb,%s,%s);
    """, (movimiento_id, clave, accion, estado_ant, detalle, _json_dumps_safe(datos), usuario, ip))


def _aplicar_titularidad_desde_relaciones(cur, clave: str):
    cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
    if "vigente" not in cols_pp:
        return None
    order_parts = []
    if "titular_principal" in cols_pp:
        order_parts.append("CASE WHEN COALESCE(pp.titular_principal, FALSE) THEN 0 ELSE 1 END")
    order_parts.extend([
        "CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 0 ELSE 1 END",
        "pp.porcentaje_propiedad DESC NULLS LAST",
        "pp.id_predio_propietario",
    ])
    order = ", ".join(order_parts)
    cur.execute(f"""
        SELECT TRIM(CONCAT_WS(' ',
            NULLIF(TRIM(per.apellido_paterno), ''),
            NULLIF(TRIM(per.apellido_materno), ''),
            NULLIF(TRIM(COALESCE(per.nombre, per.razon_social)), '')
        )) AS nombre_completo
        FROM catastro.predio_propietario pp
        LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
        WHERE UPPER(TRIM(pp.clave_catastral::text)) = UPPER(TRIM(%s))
          AND pp.vigente = TRUE
        ORDER BY {order}
        LIMIT 1;
    """, (clave,))
    row = cur.fetchone()
    nombre = (row.get("nombre_completo") or "").strip() if row else ""
    return nombre or None


class MovimientoPadronCreate(BaseModel):
    clave_catastral: Optional[str] = None
    clave_catastral_anterior: Optional[str] = None
    clave_catastral_nueva: Optional[str] = None
    tipo_movimiento: str
    motivo: Optional[str] = None
    observaciones: Optional[str] = None
    datos_anteriores: Optional[Dict[str, Any]] = None
    datos_nuevos: Optional[Dict[str, Any]] = None
    detalles: Optional[List[Dict[str, Any]]] = None


class MovimientoEstadoUpdate(BaseModel):
    estado: str
    observaciones: Optional[str] = None


class AplicarMovimientoBody(BaseModel):
    observaciones: Optional[str] = None


def permiso_movimientos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    if not any(
        usuario_tiene_permiso(usuario_actual, p)
        for p in (
            "solicitar_movimientos",
            "aplicar_movimientos",
            "consulta",
            "ver_expediente",
            "editar_catastro",
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sin permiso para consultar movimientos catastrales",
        )
    return usuario_actual


def permiso_solicitar_movimientos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    exigir_permiso_usuario(usuario_actual, "solicitar_movimientos")
    return usuario_actual


def permiso_aplicar_movimientos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    exigir_permiso_usuario(usuario_actual, "aplicar_movimientos")
    return usuario_actual


@router.get("/movimientos/aplicar-version")
def version_aplicar_movimientos():
    return {"version": APLICAR_PADRON_VERSION}


@router.get("/movimientos/tipos")
def listar_tipos_movimiento(usuario_actual: dict = Depends(permiso_movimientos)):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT clave, nombre, descripcion, requiere_autorizacion
                FROM catalogos.cat_tipos_movimiento_padron
                WHERE activo = TRUE
                ORDER BY nombre;
            """)
            return cur.fetchall()


@router.get("/movimientos")
def listar_movimientos(
    clave: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    limite: int = Query(100, ge=1, le=500),
    usuario_actual: dict = Depends(permiso_movimientos),
):
    sql = """
        SELECT *
        FROM catastro.v_movimientos_padron
        WHERE 1=1
    """
    params = []
    if clave:
        sql += " AND clave_catastral ILIKE %s"
        params.append(f"%{clave}%")
    if estado:
        sql += " AND estado = %s"
        params.append(estado)
    sql += " ORDER BY fecha_solicitud DESC LIMIT %s"
    params.append(limite)
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            return enriquecer_movimientos_lista(cur, rows)


@router.get("/movimientos/{movimiento_id}")
def obtener_movimiento(movimiento_id: int, usuario_actual: dict = Depends(permiso_movimientos)):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM catastro.v_movimientos_padron WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()
            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")
            cur.execute("""
                SELECT * FROM catastro.movimientos_padron_detalle
                WHERE movimiento_id = %s ORDER BY id;
            """, (movimiento_id,))
            detalles = cur.fetchall()
            cur.execute("""
                SELECT * FROM auditoria.movimientos_padron_auditoria
                WHERE movimiento_id = %s ORDER BY fecha DESC;
            """, (movimiento_id,))
            auditoria = cur.fetchall()
            mov["detalles"] = detalles
            mov["auditoria"] = auditoria
            return enriquecer_movimiento_respuesta(cur, mov)


@router.post("/movimientos")
def crear_movimiento(
    payload: MovimientoPadronCreate,
    request: Request,
    usuario_actual: dict = Depends(permiso_solicitar_movimientos),
):
    tipo = (payload.tipo_movimiento or "").strip().upper()
    validar_permiso_tipo_movimiento(usuario_actual, tipo)
    estado_inicial = "BORRADOR"
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO catastro.movimientos_padron (
                    clave_catastral, clave_catastral_anterior, clave_catastral_nueva,
                    tipo_movimiento, estado, motivo, observaciones,
                    datos_anteriores, datos_nuevos, usuario_solicita, ip_origen
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s)
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado, fecha_solicitud;
            """, (
                payload.clave_catastral,
                payload.clave_catastral_anterior,
                payload.clave_catastral_nueva,
                tipo,
                estado_inicial,
                payload.motivo,
                payload.observaciones,
                json.dumps(payload.datos_anteriores or {}),
                json.dumps(payload.datos_nuevos or {}),
                usuario_actual.get("usuario"),
                request.client.host if request.client else None,
            ))
            mov = cur.fetchone()
            for det in payload.detalles or []:
                cur.execute("""
                    INSERT INTO catastro.movimientos_padron_detalle (
                        movimiento_id, grupo, campo, etiqueta,
                        valor_anterior, valor_nuevo, tipo_dato, requiere_validacion
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
                """, (
                    mov["id"],
                    det.get("grupo"),
                    det.get("campo"),
                    det.get("etiqueta"),
                    det.get("valor_anterior"),
                    det.get("valor_nuevo"),
                    det.get("tipo_dato"),
                    bool(det.get("requiere_validacion", False)),
                ))
            conn.commit()
            return {"ok": True, "mensaje": "Movimiento creado correctamente", "movimiento": mov}


@router.put("/movimientos/{movimiento_id}/estado")
def actualizar_estado_movimiento(
    movimiento_id: int,
    payload: MovimientoEstadoUpdate,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos),
):
    estado = (payload.estado or "").strip().upper()
    estados_validos = ["BORRADOR", "EN_REVISION", "OBSERVADO", "AUTORIZADO", "RECHAZADO", "APLICADO", "CANCELADO"]
    if estado not in estados_validos:
        raise HTTPException(status_code=400, detail="Estado no valido")
    campos = ["estado = %s", "observaciones = COALESCE(%s, observaciones)"]
    params = [estado, payload.observaciones]
    usuario = usuario_actual.get("usuario")
    if estado == "EN_REVISION":
        campos += ["usuario_revisa = %s", "fecha_revision = now()"]
        params.append(usuario)
    elif estado == "AUTORIZADO":
        campos += ["usuario_autoriza = %s", "fecha_autorizacion = now()"]
        params.append(usuario)
    elif estado == "APLICADO":
        campos += ["usuario_aplica = %s", "fecha_aplicacion = now()"]
        params.append(usuario)
    elif estado == "CANCELADO":
        campos += ["usuario_cancela = %s", "fecha_cancelacion = now()"]
        params.append(usuario)
    params.append(movimiento_id)
    sql = f"""
        UPDATE catastro.movimientos_padron SET {", ".join(campos)}
        WHERE id = %s
        RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")
            conn.commit()
            return {"ok": True, "mensaje": "Estado actualizado correctamente", "movimiento": row}


@router.get("/movimientos/historial/{clave}")
def historial_movimientos_clave(clave: str, usuario_actual: dict = Depends(permiso_movimientos)):
    clave_norm = clave.strip().upper()
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM catastro.v_movimientos_padron
                WHERE UPPER(TRIM(clave_catastral)) = %s
                   OR UPPER(TRIM(COALESCE(clave_catastral_anterior, ''))) = %s
                   OR UPPER(TRIM(COALESCE(clave_catastral_nueva, ''))) = %s
                ORDER BY fecha_solicitud DESC;
            """, (clave_norm, clave_norm, clave_norm))
            rows = cur.fetchall()
            return enriquecer_movimientos_lista(cur, rows)


@router.get("/movimientos/historial/{clave}/numero-oficial")
def historial_numero_oficial_clave(clave: str, usuario_actual: dict = Depends(permiso_movimientos)):
    """Historial de asignaciones/cambios de numero oficial con valores anterior y nuevo."""
    clave_norm = clave.strip().upper()
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    m.id,
                    m.folio,
                    m.fecha_solicitud,
                    m.fecha_aplicacion,
                    m.estado,
                    m.tipo_movimiento,
                    m.motivo,
                    d.valor_anterior,
                    d.valor_nuevo,
                    d.etiqueta
                FROM catastro.v_movimientos_padron m
                LEFT JOIN catastro.movimientos_padron_detalle d
                  ON d.movimiento_id = m.id
                 AND LOWER(TRIM(d.campo)) IN ('numof', 'numero_oficial')
                WHERE (
                    UPPER(TRIM(m.clave_catastral)) = %s
                    OR UPPER(TRIM(COALESCE(m.clave_catastral_anterior, ''))) = %s
                )
                AND UPPER(TRIM(m.tipo_movimiento)) IN (
                    'NUMERO_OFICIAL', 'ASIGNACION_NUMERO_OFICIAL', 'CAMBIO_NUMERO_OFICIAL'
                )
                ORDER BY COALESCE(m.fecha_aplicacion, m.fecha_solicitud) DESC
                LIMIT 30;
            """, (clave_norm, clave_norm))
            rows = cur.fetchall()
            return {"clave_catastral": clave_norm, "historial": rows}


@router.get("/movimientos/copropietarios/{clave}")
def listar_copropietarios(clave: str, usuario_actual: dict = Depends(permiso_movimientos)):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM catastro.predios_copropietarios
                WHERE clave_catastral = %s
                ORDER BY titular_principal DESC, nombre_completo;
            """, (clave,))
            return cur.fetchall()


def obtener_movimiento_base(cur, movimiento_id: int):
    cur.execute("SELECT * FROM catastro.movimientos_padron WHERE id = %s;", (movimiento_id,))
    mov = cur.fetchone()
    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    return mov


def obtener_detalles_movimiento(cur, movimiento_id: int):
    cur.execute("""
        SELECT * FROM catastro.movimientos_padron_detalle
        WHERE movimiento_id = %s ORDER BY id;
    """, (movimiento_id,))
    return cur.fetchall()


CAMPOS_TRAZA_MOVIMIENTO = (
    "usuario_solicita",
    "usuario_revisa",
    "usuario_autoriza",
    "usuario_aplica",
    "usuario_cancela",
    "fecha_solicitud",
    "fecha_revision",
    "fecha_autorizacion",
    "fecha_aplicacion",
    "fecha_cancelacion",
)

MAPA_USUARIO_NOMBRE_MOV = (
    ("usuario_solicita", "nombre_solicita"),
    ("usuario_revisa", "nombre_revisa"),
    ("usuario_autoriza", "nombre_autoriza"),
    ("usuario_aplica", "nombre_aplica"),
    ("usuario_cancela", "nombre_cancela"),
)


def _fusionar_trazabilidad_movimiento(cur, mov: dict) -> dict:
    if not mov or mov.get("id") is None:
        return mov
    cur.execute(
        """
        SELECT
            usuario_solicita, usuario_revisa, usuario_autoriza, usuario_aplica, usuario_cancela,
            fecha_solicitud, fecha_revision, fecha_autorizacion, fecha_aplicacion, fecha_cancelacion
        FROM catastro.movimientos_padron
        WHERE id = %s;
        """,
        (mov["id"],),
    )
    base = cur.fetchone() or {}
    for campo in CAMPOS_TRAZA_MOVIMIENTO:
        valor = base.get(campo)
        if valor is not None and valor != "":
            mov[campo] = valor
    return mov


def _enriquecer_nombres_usuarios(cur, registro: dict, campos=MAPA_USUARIO_NOMBRE_MOV) -> dict:
    if not registro:
        return registro
    logins = sorted({
        str(registro.get(col_u) or "").strip()
        for col_u, _ in campos
        if str(registro.get(col_u) or "").strip()
    })
    if not logins:
        return registro
    cur.execute(
        """
        SELECT usuario, nombre_completo
        FROM seguridad.usuarios
        WHERE usuario = ANY(%s);
        """,
        (logins,),
    )
    mapa = {
        r["usuario"]: (r.get("nombre_completo") or r["usuario"])
        for r in (cur.fetchall() or [])
    }
    for col_u, col_n in campos:
        login = str(registro.get(col_u) or "").strip()
        if login:
            registro[col_n] = mapa.get(login, login)
    return registro


def enriquecer_movimiento_respuesta(cur, mov: dict) -> dict:
    mov = _fusionar_trazabilidad_movimiento(cur, dict(mov or {}))
    mov = _enriquecer_nombres_usuarios(cur, mov)
    auditoria = mov.get("auditoria") or []
    if auditoria:
        mov["auditoria"] = [
            _enriquecer_nombres_usuarios(cur, dict(item), [("usuario", "nombre_usuario")])
            for item in auditoria
        ]
    return mov


def enriquecer_movimientos_lista(cur, rows: list) -> list:
    if not rows:
        return rows

    ids = [int(r["id"]) for r in rows if r.get("id") is not None]
    trazas = {}
    if ids:
        cur.execute(
            """
            SELECT
                id,
                usuario_solicita, usuario_revisa, usuario_autoriza, usuario_aplica, usuario_cancela,
                fecha_solicitud, fecha_revision, fecha_autorizacion, fecha_aplicacion, fecha_cancelacion
            FROM catastro.movimientos_padron
            WHERE id = ANY(%s);
            """,
            (ids,),
        )
        for row in cur.fetchall() or []:
            trazas[int(row["id"])] = row

    logins = set()
    enriquecidos = []
    for mov in rows:
        item = dict(mov or {})
        base = trazas.get(int(item.get("id") or 0), {})
        for campo in CAMPOS_TRAZA_MOVIMIENTO:
            valor = base.get(campo)
            if valor is not None and valor != "":
                item[campo] = valor
        for col_u, _ in MAPA_USUARIO_NOMBRE_MOV:
            login = str(item.get(col_u) or "").strip()
            if login:
                logins.add(login)
        enriquecidos.append(item)

    mapa = {}
    if logins:
        cur.execute(
            """
            SELECT usuario, nombre_completo
            FROM seguridad.usuarios
            WHERE usuario = ANY(%s);
            """,
            (sorted(logins),),
        )
        mapa = {
            r["usuario"]: (r.get("nombre_completo") or r["usuario"])
            for r in (cur.fetchall() or [])
        }

    for item in enriquecidos:
        for col_u, col_n in MAPA_USUARIO_NOMBRE_MOV:
            login = str(item.get(col_u) or "").strip()
            if login:
                item[col_n] = mapa.get(login, login)
    return enriquecidos


def actualizar_estado_aplicado(cur, movimiento_id: int, usuario: str):
    cur.execute("""
        UPDATE catastro.movimientos_padron
        SET estado = 'APLICADO', usuario_aplica = %s, fecha_aplicacion = now()
        WHERE id = %s
        RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
    """, (usuario, movimiento_id))
    return cur.fetchone()


@router.post("/movimientos/{movimiento_id}/aplicar")
def aplicar_movimiento_padron(
    movimiento_id: int,
    request: Request,
    payload: Optional[AplicarMovimientoBody] = Body(default=None),
    usuario_actual: dict = Depends(permiso_aplicar_movimientos),
):
    usuario = usuario_actual.get("usuario")
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                mov = obtener_movimiento_base(cur, movimiento_id)
                if mov["estado"] == "APLICADO":
                    raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

                tipo = str(mov["tipo_movimiento"] or "").upper()
                clave = mov["clave_catastral"]
                detalles = obtener_detalles_movimiento(cur, movimiento_id)
                if not clave and tipo != "ALTA_CLAVE":
                    raise HTTPException(status_code=400, detail="El movimiento no tiene clave catastral")

                ip = request.client.host if request.client else None
                estado_ant = mov["estado"]

                if tipo in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                    datos_nuevos_aplica = _json_dict(mov.get("datos_nuevos"))
                    datos_anteriores_aplica = _json_dict(mov.get("datos_anteriores"))
                    res_propietarios = {}

                    if tipo == "CAMBIO_TITULARIDAD":
                        lista_prop = datos_nuevos_aplica.get("propietarios")
                        if isinstance(lista_prop, list) and lista_prop:
                            res_propietarios = aplicar_propietarios_desde_movimiento(cur, clave, lista_prop)

                        tenencia_nueva = datos_nuevos_aplica.get("tenencia")
                        if tenencia_nueva:
                            asegurar_tabla_predio_condominio(cur, conn)
                            _aplicar_tenencia_predio(
                                cur,
                                clave,
                                normalizar_codigo_tenencia(str(tenencia_nueva)),
                                usuario,
                            )

                    nuevo_nombre = (
                        valor_detalle(detalles, "nombre_propietario")
                        or valor_detalle(detalles, "nombre_completo")
                        or valor_detalle(detalles, "propietario")
                    )
                    if not nuevo_nombre:
                        nuevo_nombre = (
                            datos_nuevos_aplica.get("nombre_propietario")
                            or datos_nuevos_aplica.get("nombre_completo")
                            or datos_nuevos_aplica.get("propietario")
                            or res_propietarios.get("nombre_principal")
                        )
                    if tipo == "CAMBIO_TITULARIDAD" and not nuevo_nombre and clave:
                        nuevo_nombre = _aplicar_titularidad_desde_relaciones(cur, clave)
                    if not nuevo_nombre:
                        raise HTTPException(status_code=400, detail="No se encontro titular para aplicar.")

                    clave_norm = str(clave or "").strip().upper()
                    anterior = _obtener_fila_padron(cur, clave_norm)
                    nombre_anterior_padron = anterior.get("nombre_completo") if anterior else None
                    padron_actualizado = False
                    actualizado = None

                    if anterior:
                        cur.execute("""
                            UPDATE catalogos.padron_2026 SET nombre_completo = %s
                            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                            RETURNING clave_catastral, nombre_completo;
                        """, (nuevo_nombre, clave_norm))
                        actualizado = cur.fetchone()
                        padron_actualizado = bool(actualizado)
                    else:
                        actualizado = {
                            "clave_catastral": clave_norm,
                            "nombre_completo": nuevo_nombre,
                            "padron_actualizado": False,
                        }

                    rfc_nuevo = valor_detalle(detalles, "rfc")
                    tipo_persona_nuevo = valor_detalle(detalles, "tipo_persona")
                    if not rfc_nuevo:
                        rfc_nuevo = datos_nuevos_aplica.get("rfc")
                    if not tipo_persona_nuevo:
                        tipo_persona_nuevo = datos_nuevos_aplica.get("tipo_persona")

                    cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
                    cols_per = columnas_tabla(cur, "catalogos", "personas")
                    order_pp = "CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 0 ELSE 1 END, pp.porcentaje_propiedad DESC NULLS LAST, pp.id_persona DESC"
                    if "vigente" in cols_pp:
                        cur.execute(f"""
                            SELECT pp.id_persona FROM catastro.predio_propietario pp
                            WHERE UPPER(TRIM(pp.clave_catastral::text)) = UPPER(TRIM(%s)) AND pp.vigente = TRUE
                            ORDER BY {order_pp} LIMIT 1;
                        """, (clave_norm,))
                    else:
                        cur.execute(f"""
                            SELECT pp.id_persona FROM catastro.predio_propietario pp
                            WHERE UPPER(TRIM(pp.clave_catastral::text)) = UPPER(TRIM(%s))
                            ORDER BY {order_pp} LIMIT 1;
                        """, (clave_norm,))
                    rel = cur.fetchone()
                    if rel and rel.get("id_persona"):
                        pp_set, pp_params = [], []
                        if rfc_nuevo and "rfc" in cols_pp:
                            pp_set.append("rfc = %s")
                            pp_params.append(rfc_nuevo)
                        if tipo_persona_nuevo and "tipo_persona" in cols_pp:
                            pp_set.append("tipo_persona = %s")
                            pp_params.append(tipo_persona_nuevo)
                        if (
                            tipo != "CAMBIO_TITULARIDAD"
                            and nuevo_nombre
                            and "nombre_completo" in cols_pp
                        ):
                            pp_set.append("nombre_completo = %s")
                            pp_params.append(nuevo_nombre)
                        if pp_set:
                            pp_params.extend([rel["id_persona"], clave_norm])
                            cur.execute(
                                f"UPDATE catastro.predio_propietario SET {', '.join(pp_set)} "
                                f"WHERE id_persona = %s AND UPPER(TRIM(clave_catastral::text)) = UPPER(TRIM(%s));",
                                pp_params,
                            )
                        per_set, per_params = [], []
                        if (
                            tipo != "CAMBIO_TITULARIDAD"
                            and nuevo_nombre
                            and "nombre" in cols_per
                        ):
                            per_set.append("nombre = %s")
                            per_params.append(nuevo_nombre)
                        if rfc_nuevo and "rfc" in cols_per:
                            per_set.append("rfc = %s")
                            per_params.append(rfc_nuevo)
                        if tipo_persona_nuevo and "tipo_persona" in cols_per:
                            per_set.append("tipo_persona = %s")
                            per_params.append(tipo_persona_nuevo)
                        if per_set:
                            per_params.append(rel["id_persona"])
                            cur.execute(
                                f"UPDATE catalogos.personas SET {', '.join(per_set)} WHERE id_persona = %s;",
                                per_params,
                            )

                    cur.execute("""
                        INSERT INTO catastro.historial_titularidad (
                            clave_catastral, movimiento_id, tipo_evento,
                            nombre_anterior, nombre_nuevo, motivo, usuario_modifica
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s);
                    """, (clave_norm, movimiento_id, tipo, nombre_anterior_padron, nuevo_nombre, mov.get("motivo"), usuario))

                    accion_aud = "APLICAR_CAMBIO_TITULARIDAD" if tipo == "CAMBIO_TITULARIDAD" else "APLICAR_CAMBIO_NOMBRE"
                    detalle_aud = (
                        "Titularidad/copropietarios aplicados al predio"
                        + (" y padrón" if padron_actualizado else " (solo catastro; sin fila en padrón)")
                        if tipo == "CAMBIO_TITULARIDAD"
                        else "Cambio aplicado a padron_2026.nombre_completo"
                    )
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave_norm, accion_aud, estado_ant,
                        detalle_aud,
                        {
                            "valor_anterior": nombre_anterior_padron,
                            "valor_nuevo": nuevo_nombre,
                            "padron_actualizado": padron_actualizado,
                            "propietarios": res_propietarios,
                            "tenencia_anterior": datos_anteriores_aplica.get("tenencia"),
                            "tenencia_nueva": datos_nuevos_aplica.get("tenencia"),
                        },
                        usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    if tipo == "CAMBIO_TITULARIDAD":
                        msg_ok = (
                            "Cambio de titularidad aplicado al predio y padrón"
                            if padron_actualizado
                            else "Cambio de titularidad aplicado al predio (catálogo catastro; clave sin fila en padrón)"
                        )
                    else:
                        msg_ok = "Cambio de nombre aplicado al padron"
                    return _ok_aplicar(msg_ok, mov_final, actualizado)

                if tipo in [
                    "CAMBIO_SUPERFICIE", "CAMBIO_CONSTRUCCION", "CAMBIO_USO_SUELO",
                    "CAMBIO_ZONA_HOMOGENEA", "NUMERO_OFICIAL",
                    "ASIGNACION_NUMERO_OFICIAL", "CAMBIO_NUMERO_OFICIAL",
                    "CORRECCION_DOMICILIO",
                ]:
                    actualizado = _aplicar_campos_desde_detalles(cur, clave, detalles, mov)
                    zona_adic = None
                    if tipo == "CAMBIO_ZONA_HOMOGENEA":
                        zona_adic = _registrar_zona_homogenea_adicional(
                            cur, mov, detalles, clave, movimiento_id, usuario)
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave, f"APLICAR_{tipo}", estado_ant,
                        f"Cambio aplicado ({tipo})",
                        {"actualizado": _fila_a_dict(actualizado), "zona_adicional": _fila_a_dict(zona_adic) if zona_adic else None},
                        usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar(f"Movimiento {tipo} aplicado al padron", mov_final, actualizado)

                if tipo == "CAMBIO_CLAVE":
                    clave_nueva = mov.get("clave_catastral_nueva") or _valor_desde_movimiento(
                        mov, detalles, "clave_catastral_nueva", "clave_nueva")
                    anterior, clave_nueva = _propagar_clave_en_tablas(cur, clave, clave_nueva)
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave_nueva, "APLICAR_CAMBIO_CLAVE", estado_ant,
                        "Clave actualizada", {"clave_anterior": clave, "clave_nueva": clave_nueva},
                        usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Cambio de clave aplicado", mov_final)

                if tipo == "BLOQUEO":
                    if not _actualizar_estatus_predio(cur, clave, "BLOQUEADO"):
                        raise HTTPException(status_code=400, detail="No existe columna estatus en predios")
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave, "APLICAR_BLOQUEO", estado_ant,
                        "Predio bloqueado", {"estatus": "BLOQUEADO"}, usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Bloqueo aplicado", mov_final)

                if tipo == "DESBLOQUEO":
                    if not _actualizar_estatus_predio(cur, clave, "ACTIVO"):
                        raise HTTPException(status_code=400, detail="No existe columna estatus en predios")
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave, "APLICAR_DESBLOQUEO", estado_ant,
                        "Predio desbloqueado", {"estatus": "ACTIVO"}, usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Desbloqueo aplicado", mov_final)

                if tipo == "BAJA_CLAVE":
                    row, modo = _aplicar_baja_clave(cur, clave)
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave, "APLICAR_BAJA_CLAVE", estado_ant,
                        f"Baja ({modo})", {"clave": clave}, usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Baja aplicada", mov_final)

                if tipo == "ALTA_CLAVE":
                    actualizado = _aplicar_alta_clave(cur, mov, detalles, usuario)
                    clave_alta = actualizado.get("clave_catastral")
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave_alta, "APLICAR_ALTA_CLAVE", estado_ant,
                        "Alta de clave", {"actualizado": _fila_a_dict(actualizado)}, usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Alta aplicada", mov_final, actualizado)

                if tipo == "SUBDIVISION":
                    claves_res = _parse_lista_claves(
                        _valor_desde_movimiento(mov, detalles, "claves_resultantes", "claves_destino") or "")
                    if not claves_res:
                        raise HTTPException(status_code=400, detail="Faltan claves resultantes")
                    n = _registrar_relaciones_prediales(
                        cur, movimiento_id, "SUBDIVISION", clave, claves_res, usuario, detalles)
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave, "APLICAR_SUBDIVISION", estado_ant,
                        f"Subdivisión ({n})", {"claves": claves_res}, usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Subdivisión aplicada", mov_final)

                if tipo == "FUSION":
                    clave_dest = mov.get("clave_catastral_nueva") or _valor_desde_movimiento(
                        mov, detalles, "clave_destino", "clave_catastral_nueva")
                    claves_orig = _parse_lista_claves(
                        _valor_desde_movimiento(mov, detalles, "claves_origen", "claves_a_fusionar") or "")
                    if not clave_dest:
                        raise HTTPException(status_code=400, detail="Falta clave destino")
                    if not claves_orig and clave:
                        claves_orig = [clave]
                    n = sum(
                        _registrar_relaciones_prediales(
                            cur, movimiento_id, "FUSION", co, [clave_dest], usuario, detalles)
                        for co in claves_orig
                    )
                    _registrar_auditoria_aplicar(
                        cur, movimiento_id, clave_dest, "APLICAR_FUSION", estado_ant, f"Fusion ({n})",
                        {"claves_origen": claves_orig, "clave_destino": clave_dest}, usuario, ip,
                    )
                    mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                    conn.commit()
                    return _ok_aplicar("Fusion aplicada", mov_final)

                raise HTTPException(status_code=400, detail=f"Tipo {tipo} sin regla de aplicacion.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error al aplicar movimiento ({type(e).__name__}): {e}",
        )
