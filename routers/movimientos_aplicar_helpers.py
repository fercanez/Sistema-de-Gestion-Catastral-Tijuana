"""Helpers para aplicar movimientos al padron."""
import json
from typing import Any, Optional

from fastapi import HTTPException

from database import columnas_tabla

CAMPO_A_PADRON = {
    "superficie_documental": "sup_documental",
    "sup_documental": "sup_documental",
    "superficie_fisica": "sup_fisica",
    "sup_fisica": "sup_fisica",
    "superficie_construccion": "sup_const",
    "sup_const": "sup_const",
    "construccion": "sup_const",
    "uso_suelo": "descripcion_uso",
    "descripcion_uso": "descripcion_uso",
    "zona_homogenea": "zonah",
    "zonah": "zonah",
    "numero_oficial": "numof",
    "numof": "numof",
    "nombre_propietario": "nombre_completo",
    "nombre_completo": "nombre_completo",
    "propietario": "nombre_completo",
    "delegacion": "delegacion",
    "colonia": "colonia",
    "calle": "calle",
    "numint": "numint",
    "letra": "letra",
    "condominio": "condominio",
    "valor2026": "valor2026",
    "id_tasa": "id_tasa",
    "porcentaje_tasa": "porcentaje_tasa",
}


def _json_dict(val) -> dict:
    if isinstance(val, dict):
        return val
    if isinstance(val, str) and val.strip():
        try:
            return json.loads(val)
        except Exception:
            return {}
    return {}


def resolver_columna_padron(campo: str) -> Optional[str]:
    c = (campo or "").strip().lower()
    return CAMPO_A_PADRON.get(c, c if c else None)


def valor_detalle(detalles: list, *campos_busqueda: str):
    busqueda = {(c or "").strip().lower() for c in campos_busqueda if c}
    for d in detalles or []:
        campo = str(d.get("campo") or "").strip().lower()
        if campo in busqueda:
            val = d.get("valor_nuevo")
            if val is not None and str(val).strip() != "":
                return val
    return None


def valor_desde_movimiento(mov: dict, detalles: list, *campos: str):
    val = valor_detalle(detalles, *campos)
    if val is not None and str(val).strip() != "":
        return val
    datos = _json_dict(mov.get("datos_nuevos"))
    for c in campos:
        if c in datos and datos[c] is not None and str(datos[c]).strip() != "":
            return datos[c]
    return None


def obtener_fila_padron(cur, clave: str):
    cur.execute("""
        SELECT *
        FROM catalogos.padron_2026
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        LIMIT 1;
    """, (clave,))
    return cur.fetchone()


def registrar_auditoria_aplicar(cur, movimiento_id, clave, accion, estado_anterior,
                                detalle, datos, usuario, ip):
    cur.execute("""
        INSERT INTO auditoria.movimientos_padron_auditoria (
            movimiento_id, clave_catastral, accion,
            estado_anterior, estado_nuevo, detalle, datos, usuario, ip
        )
        VALUES (%s,%s,%s,%s,'APLICADO',%s,%s::jsonb,%s,%s);
    """, (
        movimiento_id, clave, accion, estado_anterior,
        detalle, json.dumps(datos or {}), usuario, ip,
    ))


def aplicar_campos_padron(cur, clave: str, campos_valores: dict[str, Any]) -> dict:
    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    sets, params = [], []
    for campo, valor in campos_valores.items():
        col = resolver_columna_padron(campo)
        if not col or col not in cols or valor is None or str(valor).strip() == "":
            continue
        sets.append(f"{col} = %s")
        params.append(valor)
    if not sets:
        raise HTTPException(status_code=400, detail="No hay campos validos para aplicar al padron")
    params.append(clave)
    cur.execute(f"""
        UPDATE catalogos.padron_2026 SET {", ".join(sets)}
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        RETURNING clave_catastral, nombre_completo, sup_documental, sup_fisica,
                  sup_const, descripcion_uso, zonah, numof;
    """, params)
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No se encontro la clave en catalogos.padron_2026")
    return row


def aplicar_campos_desde_detalles(cur, clave: str, detalles: list, mov: dict) -> dict:
    campos = {}
    for d in detalles or []:
        if d.get("campo") and d.get("valor_nuevo") is not None and str(d.get("valor_nuevo")).strip():
            campos[str(d["campo"])] = d["valor_nuevo"]
    datos = _json_dict(mov.get("datos_nuevos"))
    skip = {"claves_resultantes", "claves_origen", "clave_destino", "motivo_bloqueo"}
    for k, v in datos.items():
        if k not in campos and k not in skip and v is not None and str(v).strip():
            campos[k] = v
    return aplicar_campos_padron(cur, clave, campos)


def actualizar_estatus_predio(cur, clave: str, estatus: str) -> bool:
    cols = columnas_tabla(cur, "catastro", "predios")
    if "estatus" not in cols:
        return False
    cur.execute("""
        UPDATE catastro.predios SET estatus = %s
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
    """, (estatus, clave))
    return True


def propagar_clave_en_tablas(cur, clave_anterior: str, clave_nueva: str):
    clave_anterior = (clave_anterior or "").strip().upper()
    clave_nueva = (clave_nueva or "").strip().upper()
    if not clave_anterior or not clave_nueva or clave_anterior == clave_nueva:
        raise HTTPException(status_code=400, detail="Claves anterior y nueva invalidas")
    if obtener_fila_padron(cur, clave_nueva):
        raise HTTPException(status_code=400, detail="La clave nueva ya existe en el padron")
    anterior = obtener_fila_padron(cur, clave_anterior)
    if not anterior:
        raise HTTPException(status_code=404, detail="No se encontro la clave anterior")

    cols_padron = columnas_tabla(cur, "catalogos", "padron_2026")
    sets, params = ["clave_catastral = %s"], [clave_nueva]
    if "clave_catastral_norm" in cols_padron:
        sets.append("clave_catastral_norm = %s")
        params.append(clave_nueva)
    params.append(clave_anterior)
    cur.execute(f"""
        UPDATE catalogos.padron_2026 SET {", ".join(sets)}
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
    """, params)

    for esquema, tabla in [
        ("catastro", "predios"), ("catastro", "predio_propietario"),
        ("catastro", "expedientes"), ("catastro", "expediente_documentos"),
    ]:
        cols = columnas_tabla(cur, esquema, tabla)
        if "clave_catastral" not in cols:
            continue
        extra, extra_p = "", []
        if "clave_catastral_norm" in cols:
            extra = ", clave_catastral_norm = %s"
            extra_p = [clave_nueva]
        cur.execute(f"""
            UPDATE {esquema}.{tabla} SET clave_catastral = %s{extra}
            WHERE UPPER(TRIM(clave_catastral::text)) = UPPER(TRIM(%s));
        """, [clave_nueva, *extra_p, clave_anterior])
    return anterior, clave_nueva


def aplicar_alta_clave(cur, mov: dict, detalles: list) -> dict:
    clave = (mov.get("clave_catastral_nueva") or mov.get("clave_catastral")
             or valor_desde_movimiento(mov, detalles, "clave_catastral", "clave_catastral_nueva"))
    clave = (clave or "").strip().upper()
    if not clave:
        raise HTTPException(status_code=400, detail="Falta la clave catastral para el alta")
    if obtener_fila_padron(cur, clave):
        raise HTTPException(status_code=400, detail="La clave ya existe en el padron")

    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    valores = {}
    for d in detalles or []:
        col = resolver_columna_padron(d.get("campo"))
        if col and col in cols:
            valores[col] = d.get("valor_nuevo")
    for k, v in _json_dict(mov.get("datos_nuevos")).items():
        col = resolver_columna_padron(k)
        if col and col in cols and col not in valores and v is not None and str(v).strip():
            valores[col] = v
    if not str(valores.get("nombre_completo") or "").strip():
        raise HTTPException(status_code=400, detail="El alta requiere nombre del titular")
    valores["clave_catastral"] = clave
    if "clave_catastral_norm" in cols:
        valores["clave_catastral_norm"] = clave
    ic = [c for c in valores if c in cols]
    cur.execute(f"""
        INSERT INTO catalogos.padron_2026 ({", ".join(ic)})
        VALUES ({", ".join(["%s"] * len(ic))})
        RETURNING clave_catastral, nombre_completo;
    """, [valores[c] for c in ic])
    return cur.fetchone()


def aplicar_baja_clave(cur, clave: str):
    row = obtener_fila_padron(cur, clave)
    if not row:
        raise HTTPException(status_code=404, detail="No se encontro la clave en el padron")
    if actualizar_estatus_predio(cur, clave, "BAJA"):
        return row, "estatus_predio=BAJA"
    cur.execute("""
        DELETE FROM catalogos.padron_2026
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
        RETURNING clave_catastral;
    """, (clave,))
    if not cur.fetchone():
        raise HTTPException(status_code=500, detail="No se pudo dar de baja la clave")
    return row, "delete_padron"


def aplicar_titularidad_desde_relaciones(cur, clave: str) -> Optional[str]:
    cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
    if "vigente" not in cols_pp:
        return None
    order = "CASE WHEN COALESCE(pp.titular_principal, FALSE) THEN 0 WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 1 ELSE 2 END"
    cur.execute(f"""
        SELECT COALESCE(pp.nombre_completo, per.nombre) AS nombre
        FROM catastro.predio_propietario pp
        LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
        WHERE UPPER(TRIM(pp.clave_catastral::text)) = UPPER(TRIM(%s)) AND pp.vigente = TRUE
        ORDER BY {order}, pp.porcentaje_propiedad DESC NULLS LAST LIMIT 1;
    """, (clave,))
    tit = cur.fetchone()
    if not tit or not tit.get("nombre"):
        return None
    cur.execute("""
        UPDATE catalogos.padron_2026 SET nombre_completo = %s
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
    """, (tit["nombre"], clave))
    return tit["nombre"]


def parse_lista_claves(texto: str) -> list[str]:
    if not texto:
        return []
    return [p.strip().upper() for p in str(texto).replace(";", ",").split(",") if p.strip()]


def registrar_relaciones_prediales(cur, movimiento_id, tipo_relacion, clave_origen,
                                   claves_destino, usuario, detalles):
    cols = columnas_tabla(cur, "catastro", "relaciones_prediales")
    if not cols:
        return 0
    count = 0
    sup_origen = valor_desde_movimiento({"datos_nuevos": {}}, detalles, "superficie_origen", "sup_documental")
    for dest in claves_destino:
        ic = ["movimiento_id", "tipo_relacion", "clave_origen", "clave_destino", "vigente"]
        iv = [movimiento_id, tipo_relacion, clave_origen, dest, True]
        ph = ["%s"] * 5
        if "superficie_origen" in cols and sup_origen:
            ic.append("superficie_origen"); iv.append(sup_origen); ph.append("%s")
        if "usuario_registro" in cols:
            ic.append("usuario_registro"); iv.append(usuario); ph.append("%s")
        if "fecha_registro" in cols:
            ic.append("fecha_registro"); ph.append("now()")
        cur.execute(f"""
            INSERT INTO catastro.relaciones_prediales ({", ".join(ic)})
            VALUES ({", ".join(ph)});
        """, iv)
        count += 1
    return count
