"""Router de catalogo de propietarios y copropietarios (v28)."""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

from database import get_conn, columnas_tabla, asegurar_tabla_predio_condominio
from routers.movimientos import permiso_movimientos, permiso_aplicar_movimientos
from routers.padron import (
    SQL_TIPO_CONDOMINIO,
    _etiqueta_tipo_condominio,
    TenenciaPadronPayload,
    _aplicar_tenencia_predio,
)

router = APIRouter(tags=["propietarios"])

class PropietarioPersonaPayload(BaseModel):
    tipo_persona: str = "FISICA"
    nombre: Optional[str] = None
    apellido_paterno: Optional[str] = None
    apellido_materno: Optional[str] = None
    razon_social: Optional[str] = None
    rfc: Optional[str] = None
    curp: Optional[str] = None
    activo: Optional[bool] = True
    calle: Optional[str] = None
    colonia: Optional[str] = None
    numof: Optional[str] = None
    cp: Optional[str] = None
    delegacion: Optional[str] = None


class PredioPropietarioPayload(BaseModel):
    id_persona: int
    porcentaje_propiedad: float
    tipo_titularidad: Optional[str] = "PROPIETARIO"


class PredioPropietarioUpdatePayload(BaseModel):
    porcentaje_propiedad: float
    tipo_titularidad: Optional[str] = "PROPIETARIO"


class PredioPropietariosReemplazoPayload(BaseModel):
    propietarios: list[PredioPropietarioPayload]


class FusionarPropietariosPayload(BaseModel):
    id_persona_destino: int
    id_personas_origen: list[int]


class SincronizarPadronMasivoPayload(BaseModel):
    confirmar: bool = False
    texto_padron: str = ""
    limite: int = 5000


class PredioCondominioPayload(BaseModel):
    modalidad: Optional[str] = None
    nombre_condominio: Optional[str] = None
    observaciones: Optional[str] = None
    propagar_grupo: bool = True


class CondominioClasificacionBuscarPayload(BaseModel):
    claves_texto: Optional[str] = None
    claves: Optional[list[str]] = None
    nombre_condominio: Optional[str] = None
    colonia: Optional[str] = None
    calle: Optional[str] = None
    numof: Optional[str] = None
    clave_prefijo: Optional[str] = None
    q: Optional[str] = None
    solo_regimen_c: bool = True
    limite: int = 500
    offset: int = 0


class CondominioClasificacionMasivaPayload(BaseModel):
    claves: list[str]
    modalidad: Optional[str] = None
    nombre_condominio: Optional[str] = None
    observaciones: Optional[str] = None


MODALIDADES_CONDOMINIO = {
    "VERTICAL": {
        "codigo": "VERTICAL",
        "nombre": "Vertical",
        "descripcion": "Unidades en pisos sobre un mismo terreno (edificio, torre).",
    },
    "HORIZONTAL": {
        "codigo": "HORIZONTAL",
        "nombre": "Horizontal",
        "descripcion": "Unidades contiguas en un mismo predio o manzana (townhouses, filas).",
    },
}


class CalleCatalogoPayload(BaseModel):
    nombre_calle: str


def upper_clean_v28(valor):
    if valor is None:
        return None
    txt = str(valor).strip().upper()
    return txt if txt else None


def normalizar_nombre_fusion_v28(nombre) -> str:
    """Normaliza variantes (B.C., comas, espacios) para comparar titulares equivalentes."""
    txt = upper_clean_v28(nombre) or ""
    if not txt:
        return ""
    txt = re.sub(r"[,.;]", " ", txt)
    txt = re.sub(r"\bB\s*C\b", "BAJA CALIFORNIA", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


COLS_DOMICILIO_PERSONA = ("calle", "colonia", "numof", "cp", "delegacion")


def asegurar_columnas_domicilio_persona(cur, conn) -> set:
    """Agrega columnas de domicilio al catálogo si aún no existen."""
    cols = columnas_tabla(cur, "catalogos", "personas")
    if all(c in cols for c in COLS_DOMICILIO_PERSONA):
        return cols
    ddl = {
        "calle": "VARCHAR(200)",
        "colonia": "VARCHAR(150)",
        "numof": "VARCHAR(30)",
        "cp": "VARCHAR(10)",
        "delegacion": "VARCHAR(100)",
    }
    for col, tipo in ddl.items():
        if col not in cols:
            cur.execute(f"ALTER TABLE catalogos.personas ADD COLUMN IF NOT EXISTS {col} {tipo};")
    conn.commit()
    return columnas_tabla(cur, "catalogos", "personas")


def domicilio_persona_desde_payload(payload: PropietarioPersonaPayload) -> dict:
    return {
        "calle": upper_clean_v28(payload.calle),
        "colonia": upper_clean_v28(payload.colonia),
        "numof": upper_clean_v28(payload.numof),
        "cp": upper_clean_v28(payload.cp),
        "delegacion": upper_clean_v28(payload.delegacion),
    }


def nombre_persona_sql_v28(alias="p"):
    return f"""
        CASE
            WHEN UPPER(COALESCE({alias}.tipo_persona, 'FISICA')) = 'MORAL' THEN
                UPPER(TRIM(COALESCE({alias}.razon_social, '')))
            ELSE
                UPPER(TRIM(
                    COALESCE({alias}.apellido_paterno, '') || ' ' ||
                    COALESCE({alias}.apellido_materno, '') || ' ' ||
                    COALESCE({alias}.nombre, '')
                ))
        END
    """


def condiciones_busqueda_persona_v28(alias="p", texto=""):
    tokens = [t for t in str(texto or "").split() if t]
    if not tokens:
        return "TRUE", []

    partes = []
    params = []
    for token in tokens:
        like = f"%{token}%"
        partes.append(f"""(
            {nombre_persona_sql_v28(alias)} ILIKE %s
            OR COALESCE({alias}.apellido_paterno, '') ILIKE %s
            OR COALESCE({alias}.apellido_materno, '') ILIKE %s
            OR COALESCE({alias}.nombre, '') ILIKE %s
            OR COALESCE({alias}.razon_social, '') ILIKE %s
            OR COALESCE({alias}.rfc, '') ILIKE %s
            OR COALESCE({alias}.curp, '') ILIKE %s
        )""")
        params.extend([like] * 7)

    return " AND ".join(partes), params


def condiciones_busqueda_texto_col(col_expr, texto=""):
    tokens = [t for t in str(texto or "").split() if t]
    if not tokens:
        return "TRUE", []

    partes = []
    params = []
    for token in tokens:
        partes.append(f"{col_expr} ILIKE %s")
        params.append(f"%{token}%")

    return " AND ".join(partes), params


def parse_nombre_padron_v28(nombre_completo):
    partes = [p for p in str(nombre_completo or "").split() if p]
    if len(partes) >= 3:
        return {
            "apellido_paterno": partes[0],
            "apellido_materno": partes[1],
            "nombre": " ".join(partes[2:]),
        }
    if len(partes) == 2:
        return {"apellido_paterno": partes[0], "apellido_materno": None, "nombre": partes[1]}
    if len(partes) == 1:
        return {"apellido_paterno": partes[0], "apellido_materno": None, "nombre": None}
    return {"apellido_paterno": None, "apellido_materno": None, "nombre": None}


def condiciones_busqueda_padron_v28(paterno="", materno="", nombre="", razon_social="", q=""):
    ap = upper_clean_v28(paterno) or ""
    am = upper_clean_v28(materno) or ""
    nm = upper_clean_v28(nombre) or ""
    rs = upper_clean_v28(razon_social) or ""
    texto = upper_clean_v28(q) or ""
    nc = "UPPER(TRIM(p.nombre_completo))"
    ap_col = f"split_part({nc}, ' ', 1)"
    am_col = f"split_part({nc}, ' ', 2)"

    partes = []
    params = []

    if rs:
        partes.append(f"{nc} ILIKE %s")
        params.append(f"%{rs}%")
    if ap:
        partes.append(f"{ap_col} ILIKE %s")
        params.append(f"%{ap}%")
    if am:
        partes.append(f"{am_col} ILIKE %s")
        params.append(f"%{am}%")
    if nm:
        partes.append(f"{nc} ILIKE %s")
        params.append(f"%{nm}%")

    if texto and not (ap or am or nm or rs):
        filtro, filtro_params = condiciones_busqueda_texto_col(nc, texto)
        partes.append(f"({filtro})")
        params.extend(filtro_params)

    if not partes:
        return "FALSE", []

    return " AND ".join(partes), params


def condiciones_busqueda_persona_estructurada_v28(alias="p", paterno="", materno="", nombre="", razon_social="", q=""):
    ap = upper_clean_v28(paterno) or ""
    am = upper_clean_v28(materno) or ""
    nm = upper_clean_v28(nombre) or ""
    rs = upper_clean_v28(razon_social) or ""
    texto = upper_clean_v28(q) or ""

    partes = []
    params = []

    if rs:
        partes.append(f"COALESCE({alias}.razon_social, '') ILIKE %s")
        params.append(f"%{rs}%")
    if ap:
        partes.append(f"COALESCE({alias}.apellido_paterno, '') ILIKE %s")
        params.append(f"%{ap}%")
    if am:
        partes.append(f"COALESCE({alias}.apellido_materno, '') ILIKE %s")
        params.append(f"%{am}%")
    if nm:
        partes.append(f"COALESCE({alias}.nombre, '') ILIKE %s")
        params.append(f"%{nm}%")

    if texto and not (ap or am or nm or rs):
        filtro, filtro_params = condiciones_busqueda_persona_v28(alias, texto)
        partes.append(f"({filtro})")
        params.extend(filtro_params)

    if not partes:
        return "FALSE", []

    return " AND ".join(partes), params


def es_nombre_moral_v28(nombre_completo):
    txt = f" {upper_clean_v28(nombre_completo) or ''} "
    claves = [
        " MUNICIPIO ", " GOBIERNO ", " SECRETARIA ", " FEDERACION ", " EJIDO ",
        " INSTITUTO ", " ASOCIACION ", " S.A. ", " SA DE CV ", " S DE RL ",
        " SC ", " AC ", " IAP ", " UNIVERSIDAD ", " CAMARA ", " COMITE ",
        " EMPRESA ", " PRODUCTOS ", " AGRICOLA ", " S,A ", " S.A DE C.V "
    ]
    if any(k in txt for k in claves):
        return True
    return bool(re.search(r"\bS\.?\s*A\.?\s*DE\s*C\.?\s*V\.?\b", txt))


def obtener_titular_padron_v28(cur, clave: str):
    cur.execute("""
        SELECT COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo) AS titular_padron
        FROM catalogos.padron_2026 p
        LEFT JOIN catastro.v_titularidad_predio tit
            ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
        WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(%s))
        LIMIT 1;
    """, (clave,))
    row = cur.fetchone()
    if not row:
        return None
    return upper_clean_v28(row.get("titular_padron"))


def titular_padron_sincronizado_v28(rows, titular_padron: str):
    titular = upper_clean_v28(titular_padron) or ""
    if not titular:
        return True
    if not rows:
        return False
    for row in rows:
        nombre = upper_clean_v28(row.get("nombre_completo"))
        if not nombre:
            continue
        if nombre == titular or titular in nombre or nombre in titular:
            return True
    return False


def normalizar_nombre_condominio(valor: Optional[str]) -> Optional[str]:
    if valor is None:
        return None
    txt = str(valor).strip()
    if not txt:
        return None
    return txt.upper()


def parse_lista_claves_condominio_v28(texto: Optional[str] = None, claves: Optional[list] = None) -> list:
    resultado = []
    vistos = set()
    if claves:
        for c in claves:
            cl = upper_clean_v28(c)
            if cl and cl not in vistos:
                vistos.add(cl)
                resultado.append(cl)
    raw = (texto or "").strip()
    if raw:
        for parte in re.split(r"[\s,;|\n\r\t]+", raw):
            cl = upper_clean_v28(parte)
            if cl and cl not in vistos:
                vistos.add(cl)
                resultado.append(cl)
    return resultado


def inferir_regimen_catastro_v28(modalidad: Optional[str]) -> Optional[str]:
    """Vertical u horizontal implica régimen en condominio (C) en catastro."""
    key = upper_clean_v28(modalidad) or ""
    if key in MODALIDADES_CONDOMINIO:
        return "C"
    return None


def sincronizar_padron_condominio_v28(cur, claves: list, modalidad: Optional[str] = None) -> int:
    """Marca padron.condominio = C cuando hay clasificación vertical/horizontal."""
    key = upper_clean_v28(modalidad) or ""
    if key not in MODALIDADES_CONDOMINIO:
        return 0
    claves_norm = []
    vistos = set()
    for raw in claves or []:
        cl = upper_clean_v28(raw)
        if cl and cl not in vistos:
            vistos.add(cl)
            claves_norm.append(cl)
    if not claves_norm:
        return 0
    cur.execute("""
        UPDATE catalogos.padron_2026
        SET condominio = 'C'
        WHERE UPPER(TRIM(clave_catastral)) = ANY(%s);
    """, (claves_norm,))
    return cur.rowcount or 0


def sincronizar_padron_nombre_persona_v28(cur, id_persona: int, nombre: str = "") -> int:
    """Propaga el nombre del catálogo al padrón fiscal en predios ligados."""
    nombre_norm = upper_clean_v28(nombre)
    if not nombre_norm:
        cur.execute(f"""
            SELECT {nombre_persona_sql_v28('p')} AS nombre_completo
            FROM catalogos.personas p
            WHERE p.id_persona = %s;
        """, (int(id_persona),))
        row = cur.fetchone() or {}
        nombre_norm = upper_clean_v28(row.get("nombre_completo"))
    if not nombre_norm:
        return 0

    cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
    if "vigente" in cols_pp:
        cur.execute("""
            SELECT DISTINCT UPPER(TRIM(clave_catastral)) AS clave
            FROM catastro.predio_propietario
            WHERE id_persona = %s
              AND vigente = TRUE
              AND NULLIF(TRIM(clave_catastral), '') IS NOT NULL;
        """, (int(id_persona),))
    else:
        cur.execute("""
            SELECT DISTINCT UPPER(TRIM(clave_catastral)) AS clave
            FROM catastro.predio_propietario
            WHERE id_persona = %s
              AND NULLIF(TRIM(clave_catastral), '') IS NOT NULL;
        """, (int(id_persona),))

    claves = [r.get("clave") for r in cur.fetchall() if r.get("clave")]
    if not claves:
        return 0

    cur.execute("""
        UPDATE catalogos.padron_2026
        SET nombre_completo = %s
        WHERE UPPER(TRIM(clave_catastral)) = ANY(%s);
    """, (nombre_norm, claves))
    return cur.rowcount or 0


def sincronizar_padron_titular_predio_v28(cur, clave: str) -> int:
    """Actualiza padron.nombre_completo con el titular principal vigente del predio."""
    cur.execute(f"""
        SELECT {nombre_persona_sql_v28('p')} AS nombre_completo
        FROM catastro.predio_propietario pp
        JOIN catalogos.personas p ON p.id_persona = pp.id_persona
        WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
          AND pp.vigente = TRUE
          AND COALESCE(p.activo, TRUE) = TRUE
        ORDER BY pp.porcentaje_propiedad DESC NULLS LAST, pp.id_predio_propietario
        LIMIT 1;
    """, (clave,))
    row = cur.fetchone() or {}
    nombre = upper_clean_v28(row.get("nombre_completo"))
    if not nombre:
        return 0
    return sincronizar_padron_nombre_claves_v28(cur, [clave], nombre)


def sincronizar_padron_nombre_claves_v28(cur, claves: list, nombre: str) -> int:
    """Actualiza nombre_completo en padrón para las claves indicadas."""
    nombre_norm = upper_clean_v28(nombre)
    if not nombre_norm:
        return 0
    claves_norm = []
    vistos = set()
    for raw in claves or []:
        cl = upper_clean_v28(raw)
        if cl and cl not in vistos:
            vistos.add(cl)
            claves_norm.append(cl)
    if not claves_norm:
        return 0
    cur.execute("""
        UPDATE catalogos.padron_2026
        SET nombre_completo = %s
        WHERE UPPER(TRIM(clave_catastral)) = ANY(%s);
    """, (nombre_norm, claves_norm))
    return cur.rowcount or 0


def _sql_cte_titular_principal_catalogo(extra_where: str = "") -> str:
    """CTE: titular principal vigente por clave (misma lógica que copropietarios)."""
    return f"""
        titular AS (
            SELECT DISTINCT ON (UPPER(TRIM(pp.clave_catastral)))
                UPPER(TRIM(pp.clave_catastral)) AS clave,
                pp.clave_catastral,
                pp.id_persona,
                {nombre_persona_sql_v28('per')} AS nombre_catalogo
            FROM catastro.predio_propietario pp
            INNER JOIN catalogos.personas per ON per.id_persona = pp.id_persona
            WHERE pp.vigente = TRUE
              AND COALESCE(per.activo, TRUE) = TRUE
              {extra_where}
            ORDER BY
                UPPER(TRIM(pp.clave_catastral)),
                CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 1 ELSE 2 END,
                pp.porcentaje_propiedad DESC NULLS LAST,
                pp.id_predio_propietario
        )
    """


def upsert_predio_condominio_v28(
    cur,
    clave: str,
    usuario: Optional[str] = None,
    *,
    modalidad: Optional[str] = None,
    nombre_condominio: Optional[str] = None,
    observaciones: Optional[str] = None,
    set_modalidad: bool = False,
    set_nombre: bool = False,
    set_observaciones: bool = False,
) -> bool:
    clave_norm = upper_clean_v28(clave) or ""
    if not clave_norm:
        return False

    cur.execute("""
        SELECT modalidad, nombre_condominio, regimen_catastro, observaciones
        FROM catastro.predio_condominio
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
    """, (clave_norm,))
    prev = cur.fetchone() or {}

    modalidad_final = upper_clean_v28(prev.get("modalidad"))
    nombre_final = normalizar_nombre_condominio(prev.get("nombre_condominio"))
    regimen_final = upper_clean_v28(prev.get("regimen_catastro"))
    obs_final = (prev.get("observaciones") or "").strip() or None

    if set_modalidad:
        if modalidad is None or not str(modalidad).strip():
            modalidad_final = None
            regimen_final = None
        else:
            modalidad_final = normalizar_modalidad_condominio(modalidad)
            regimen_final = inferir_regimen_catastro_v28(modalidad_final)
    elif modalidad_final:
        regimen_final = inferir_regimen_catastro_v28(modalidad_final)
    if set_nombre:
        nombre_final = normalizar_nombre_condominio(nombre_condominio)
    if set_observaciones:
        obs_final = (observaciones or "").strip() or None

    if not modalidad_final and not nombre_final and not regimen_final and not obs_final:
        cur.execute("""
            DELETE FROM catastro.predio_condominio
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
        """, (clave_norm,))
        return True

    cur.execute("""
        INSERT INTO catastro.predio_condominio (
            clave_catastral, modalidad, nombre_condominio, regimen_catastro, observaciones,
            usuario_actualizacion, fecha_actualizacion
        ) VALUES (%s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (clave_catastral) DO UPDATE SET
            modalidad = EXCLUDED.modalidad,
            nombre_condominio = EXCLUDED.nombre_condominio,
            regimen_catastro = EXCLUDED.regimen_catastro,
            observaciones = EXCLUDED.observaciones,
            usuario_actualizacion = EXCLUDED.usuario_actualizacion,
            fecha_actualizacion = now();
    """, (clave_norm, modalidad_final, nombre_final, regimen_final, obs_final, usuario))
    return True


def normalizar_modalidad_condominio(valor: Optional[str]) -> Optional[str]:
    txt = upper_clean_v28(valor) or ""
    if not txt or txt in ("SIN_CLASIFICAR", "SIN CLASIFICAR", "NULL", "NONE", ""):
        return None
    if txt not in MODALIDADES_CONDOMINIO:
        raise HTTPException(status_code=400, detail="Modalidad inválida. Use VERTICAL, HORIZONTAL o deje vacío.")
    return txt


def etiqueta_modalidad_condominio(modalidad: Optional[str]) -> Optional[dict]:
    key = upper_clean_v28(modalidad)
    if not key or key not in MODALIDADES_CONDOMINIO:
        return None
    return MODALIDADES_CONDOMINIO[key]


def sugerir_modalidad_condominio(tipo_regimen: str, unidades_relacionadas: int) -> Optional[str]:
    if unidades_relacionadas >= 1:
        return "HORIZONTAL"
    if (tipo_regimen or "").upper() == "C":
        return None
    return None


def obtener_info_condominio_predio_v28(cur, clave: str) -> dict:
    cur.execute(f"""
        SELECT
            p.clave_catastral,
            UPPER(TRIM(COALESCE(p.condominio, ''))) AS valor_padron,
            {SQL_TIPO_CONDOMINIO} AS tipo_regimen,
            TRIM(COALESCE(p.calle, '')) AS calle,
            TRIM(COALESCE(p.numof, '')) AS numof,
            TRIM(COALESCE(p.colonia, '')) AS colonia,
            TRIM(COALESCE(p.delegacion, '')) AS delegacion
        FROM catalogos.padron_2026 p
        WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(%s))
        LIMIT 1;
    """, (clave,))
    padron = cur.fetchone()
    if not padron:
        return {
            "en_padron": False,
            "clave_catastral": upper_clean_v28(clave),
            "regimen": None,
            "modalidad": None,
            "modalidad_etiqueta": None,
            "nombre_condominio": None,
            "observaciones": None,
            "unidades_relacionadas": [],
            "total_unidades_relacionadas": 0,
            "sugerencia_modalidad": None,
            "grupo_domicilio": None,
        }

    tipo_key = padron.get("tipo_regimen") or "NULL"
    valor_raw = padron.get("valor_padron") or ""
    regimen_padron = _etiqueta_tipo_condominio(tipo_key, valor_raw if tipo_key == "OTRO" else valor_raw)
    calle = upper_clean_v28(padron.get("calle")) or ""
    numof = upper_clean_v28(padron.get("numof")) or ""
    colonia = upper_clean_v28(padron.get("colonia")) or ""
    grupo_domicilio = " · ".join(x for x in [calle, numof, colonia] if x) or None

    unidades_relacionadas = []
    if calle and colonia:
        cur.execute("""
            SELECT
                p.clave_catastral,
                TRIM(COALESCE(p.numof, '')) AS numof,
                UPPER(TRIM(COALESCE(p.condominio, ''))) AS tipo_padron,
                COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo) AS titular_padron,
                pc.modalidad,
                pc.nombre_condominio
            FROM catalogos.padron_2026 p
            LEFT JOIN catastro.v_titularidad_predio tit
                ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
            LEFT JOIN catastro.predio_condominio pc
                ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
            WHERE UPPER(TRIM(p.calle)) = %s
              AND UPPER(TRIM(COALESCE(p.numof, ''))) = %s
              AND UPPER(TRIM(p.colonia)) = %s
              AND UPPER(TRIM(p.clave_catastral)) <> UPPER(TRIM(%s))
            ORDER BY p.clave_catastral;
        """, (calle, numof, colonia, clave))
        unidades_relacionadas = [
            {
                "clave_catastral": r.get("clave_catastral"),
                "numof": r.get("numof") or "",
                "tipo_padron": upper_clean_v28(r.get("tipo_padron")),
                "titular_padron": upper_clean_v28(r.get("titular_padron")),
                "modalidad": upper_clean_v28(r.get("modalidad")),
                "nombre_condominio": normalizar_nombre_condominio(r.get("nombre_condominio")),
            }
            for r in (cur.fetchall() or [])
        ]

    cur.execute("""
        SELECT modalidad, nombre_condominio, regimen_catastro, observaciones, usuario_actualizacion, fecha_actualizacion
        FROM catastro.predio_condominio
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
    """, (clave,))
    clasif = cur.fetchone() or {}
    modalidad = upper_clean_v28(clasif.get("modalidad"))
    nombre_condominio = normalizar_nombre_condominio(clasif.get("nombre_condominio"))
    regimen_catastro = upper_clean_v28(clasif.get("regimen_catastro")) or inferir_regimen_catastro_v28(modalidad)
    sugerencia = sugerir_modalidad_condominio(tipo_key, len(unidades_relacionadas))

    en_regimen_condominio = tipo_key == "C" or regimen_catastro == "C"
    regimen_efectivo_key = "C" if en_regimen_condominio and (tipo_key == "C" or regimen_catastro == "C") else tipo_key
    regimen_efectivo = _etiqueta_tipo_condominio(
        regimen_efectivo_key,
        "C" if regimen_efectivo_key == "C" else valor_raw,
    )

    return {
        "en_padron": True,
        "clave_catastral": upper_clean_v28(clave),
        "regimen_padron": regimen_padron,
        "regimen": regimen_efectivo,
        "regimen_catastro": regimen_catastro,
        "regimen_catastro_etiqueta": _etiqueta_tipo_condominio(regimen_catastro, "C") if regimen_catastro else None,
        "en_regimen_condominio": en_regimen_condominio,
        "condominio_por_catastro": regimen_catastro == "C" and tipo_key != "C",
        "clasificacion_catastro_disponible": True,
        "domicilio_padron": {
            "calle": calle or None,
            "numof": numof or None,
            "colonia": colonia or None,
            "delegacion": upper_clean_v28(padron.get("delegacion")) or None,
        },
        "grupo_domicilio": grupo_domicilio,
        "modalidad": modalidad,
        "modalidad_etiqueta": etiqueta_modalidad_condominio(modalidad),
        "nombre_condominio": nombre_condominio,
        "observaciones": clasif.get("observaciones"),
        "usuario_actualizacion": clasif.get("usuario_actualizacion"),
        "fecha_actualizacion": clasif.get("fecha_actualizacion").isoformat() if clasif.get("fecha_actualizacion") else None,
        "sugerencia_modalidad": sugerencia,
        "sugerencia_modalidad_etiqueta": etiqueta_modalidad_condominio(sugerencia),
        "unidades_relacionadas": unidades_relacionadas,
        "total_unidades_relacionadas": len(unidades_relacionadas),
        "modalidades_institucionales": list(MODALIDADES_CONDOMINIO.values()),
    }


def resolver_persona_por_nombre_padron_v28(cur, nombre_completo: str):
    nombre = upper_clean_v28(nombre_completo)
    if not nombre:
        return None
    # Las columnas de catalogos.personas son varchar(120). Si el nombre del padrón
    # excede ese tamaño, el INSERT falla con StringDataRightTruncation; por eso se
    # recorta de forma segura (cada campo) antes de buscar/insertar.
    MAX_PERSONA = 120
    nombre = nombre[:MAX_PERSONA]

    cur.execute(f"""
        SELECT p.id_persona
        FROM catalogos.personas p
        WHERE COALESCE(p.activo, TRUE) = TRUE
          AND {nombre_persona_sql_v28('p')} = %s
        ORDER BY p.id_persona
        LIMIT 1;
    """, (nombre,))
    row = cur.fetchone()
    if row:
        return int(row["id_persona"])

    es_moral = es_nombre_moral_v28(nombre)
    if es_moral:
        cur.execute("""
            INSERT INTO catalogos.personas (
                tipo_persona, razon_social, activo, fecha_creacion
            ) VALUES ('MORAL', %s, TRUE, now())
            RETURNING id_persona;
        """, (nombre[:MAX_PERSONA],))
    else:
        parsed = parse_nombre_padron_v28(nombre)
        cur.execute("""
            INSERT INTO catalogos.personas (
                tipo_persona, nombre, apellido_paterno, apellido_materno, activo, fecha_creacion
            ) VALUES ('FISICA', %s, %s, %s, TRUE, now())
            RETURNING id_persona;
        """, (
            (parsed["nombre"] or "")[:MAX_PERSONA],
            (parsed["apellido_paterno"] or "")[:MAX_PERSONA],
            (parsed["apellido_materno"] or "")[:MAX_PERSONA],
        ))

    created = cur.fetchone()
    return int(created["id_persona"]) if created else None


def fila_propietario_padron_v28(nombre_completo, es_moral=None):
    if es_moral is None:
        es_moral = es_nombre_moral_v28(nombre_completo)
    if es_moral:
        return {
            "id_persona": None,
            "tipo_persona": "MORAL",
            "nombre": None,
            "apellido_paterno": None,
            "apellido_materno": None,
            "razon_social": nombre_completo,
            "rfc": None,
            "curp": None,
            "activo": True,
            "nombre_completo": nombre_completo,
            "origen": "padron",
        }
    parsed = parse_nombre_padron_v28(nombre_completo)
    return {
        "id_persona": None,
        "tipo_persona": "FISICA",
        "nombre": parsed["nombre"],
        "apellido_paterno": parsed["apellido_paterno"],
        "apellido_materno": parsed["apellido_materno"],
        "razon_social": None,
        "rfc": None,
        "curp": None,
        "activo": True,
        "nombre_completo": nombre_completo,
        "origen": "padron",
    }


def validar_porcentaje_v28(valor):
    try:
        numero = float(valor)
    except Exception:
        raise HTTPException(status_code=400, detail="Porcentaje inválido")
    if numero < 0 or numero > 100:
        raise HTTPException(status_code=400, detail="El porcentaje debe estar entre 0 y 100")
    return round(numero, 6)


def suma_propiedad_vigente_v28(cur, clave: str, excluir_id_persona: Optional[int] = None):
    params = [clave]
    filtro_extra = ""
    if excluir_id_persona is not None:
        filtro_extra = " AND id_persona <> %s"
        params.append(excluir_id_persona)

    cur.execute(f"""
        SELECT COALESCE(SUM(porcentaje_propiedad), 0) AS suma
        FROM catastro.predio_propietario
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
          AND vigente = TRUE
          {filtro_extra};
    """, tuple(params))
    row = cur.fetchone()
    return float(row["suma"] or 0)


def registrar_auditoria_simple_v28(cur, usuario: str, accion: str, modulo: str, detalle: str, ip: Optional[str] = None):
    try:
        cur.execute("""
            INSERT INTO seguridad.auditoria_sistema
            (usuario, accion, modulo, detalle, ip)
            VALUES (%s,%s,%s,%s,%s);
        """, (usuario, accion, modulo, detalle, ip))
    except Exception:
        # La auditoría no debe impedir la operación principal.
        pass


@router.get("/propietarios/buscar")
def buscar_propietarios_catalogo(
    q: str = Query("", max_length=150),
    paterno: str = Query("", max_length=80),
    materno: str = Query("", max_length=80),
    nombre: str = Query("", max_length=80),
    razon_social: str = Query("", max_length=150),
    limite: int = Query(200, ge=1, le=500),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    rs = upper_clean_v28(razon_social) or ""
    filtro_catalogo, params_catalogo = condiciones_busqueda_persona_estructurada_v28(
        "p", paterno, materno, nombre, razon_social, q
    )
    filtro_padron, params_padron = condiciones_busqueda_padron_v28(
        paterno, materno, nombre, razon_social, q
    )

    if filtro_catalogo == "FALSE" and filtro_padron == "FALSE":
        return {"total": 0, "total_padron": 0, "truncado": False, "propietarios": []}

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            rows = []
            nombres_vistos = set()

            if filtro_catalogo != "FALSE":
                cur.execute(f"""
                    SELECT
                        p.id_persona,
                        UPPER(COALESCE(p.tipo_persona, 'FISICA')) AS tipo_persona,
                        p.nombre,
                        p.apellido_paterno,
                        p.apellido_materno,
                        p.razon_social,
                        p.rfc,
                        p.curp,
                        p.activo,
                        {nombre_persona_sql_v28('p')} AS nombre_completo,
                        'catalogo'::text AS origen
                    FROM catalogos.personas p
                    WHERE COALESCE(p.activo, TRUE) = TRUE
                      AND ({filtro_catalogo})
                    ORDER BY nombre_completo
                    LIMIT %s;
                """, (*params_catalogo, limite))
                for row in cur.fetchall():
                    nombre_row = upper_clean_v28(row.get("nombre_completo"))
                    if nombre_row:
                        nombres_vistos.add(nombre_row)
                    rows.append(row)

            total_padron = 0
            if filtro_padron != "FALSE":
                cur.execute(f"""
                    SELECT COUNT(DISTINCT UPPER(TRIM(p.nombre_completo))) AS total
                    FROM catalogos.padron_2026 p
                    WHERE NULLIF(TRIM(p.nombre_completo), '') IS NOT NULL
                      AND ({filtro_padron});
                """, tuple(params_padron))
                total_padron = int((cur.fetchone() or {}).get("total") or 0)

                restante = max(limite - len(rows), 0)
                if restante > 0:
                    cur.execute(f"""
                        SELECT DISTINCT UPPER(TRIM(p.nombre_completo)) AS nombre_completo
                        FROM catalogos.padron_2026 p
                        WHERE NULLIF(TRIM(p.nombre_completo), '') IS NOT NULL
                          AND ({filtro_padron})
                        ORDER BY 1
                        LIMIT %s;
                    """, (*params_padron, restante * 3))
                    for pr in cur.fetchall():
                        nombre_row = upper_clean_v28(pr.get("nombre_completo"))
                        if not nombre_row or nombre_row in nombres_vistos:
                            continue
                        nombres_vistos.add(nombre_row)
                        rows.append(fila_propietario_padron_v28(nombre_row, es_moral=(bool(rs) or None)))
                        if len(rows) >= limite:
                            break

            padron_en_resultados = sum(1 for r in rows if r.get("origen") == "padron")
            truncado = len(rows) >= limite or total_padron > padron_en_resultados

            return {
                "total": len(rows),
                "total_padron": total_padron,
                "truncado": truncado,
                "propietarios": rows[:limite]
            }


@router.get("/propietarios/catalogo/apellidos")
def buscar_apellidos_catalogo(
    q: str = Query("", max_length=80),
    tipo: str = Query("paterno"),
    limite: int = Query(25, ge=1, le=100),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    texto = upper_clean_v28(q) or ""
    like = f"{texto}%"
    columna = "apellido_materno" if upper_clean_v28(tipo) == "MATERNO" else "apellido_paterno"
    split_idx = 2 if columna == "apellido_materno" else 1
    col_padron = f"split_part(UPPER(TRIM(p.nombre_completo)), ' ', {split_idx})"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT DISTINCT valor
                FROM (
                    SELECT UPPER(TRIM({columna})) AS valor
                    FROM catalogos.personas
                    WHERE COALESCE(activo, TRUE) = TRUE
                      AND NULLIF(TRIM({columna}), '') IS NOT NULL
                      AND (%s = '' OR UPPER(TRIM({columna})) LIKE %s)
                    UNION
                    SELECT {col_padron} AS valor
                    FROM catalogos.padron_2026 p
                    WHERE NULLIF(TRIM(p.nombre_completo), '') IS NOT NULL
                      AND NULLIF({col_padron}, '') IS NOT NULL
                      AND (%s = '' OR {col_padron} LIKE %s)
                ) t
                WHERE NULLIF(TRIM(valor), '') IS NOT NULL
                ORDER BY valor
                LIMIT %s;
            """, (texto, like, texto, like, limite))
            valores = [r["valor"] for r in cur.fetchall() if r.get("valor")]
            return {"total": len(valores), "tipo": columna, "valores": valores}


@router.get("/propietarios/catalogo/nombres")
def buscar_nombres_catalogo(
    q: str = Query("", max_length=80),
    limite: int = Query(30, ge=1, le=100),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    texto = upper_clean_v28(q) or ""
    like = f"{texto}%"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT DISTINCT valor
                FROM (
                    SELECT UPPER(TRIM(nombre)) AS valor
                    FROM catalogos.personas
                    WHERE COALESCE(activo, TRUE) = TRUE
                      AND NULLIF(TRIM(nombre), '') IS NOT NULL
                      AND (%s = '' OR UPPER(TRIM(nombre)) LIKE %s)
                    UNION
                    SELECT UPPER(TRIM(token)) AS valor
                    FROM catalogos.personas p,
                    LATERAL regexp_split_to_table(COALESCE(p.nombre, ''), '\\s+') AS token
                    WHERE COALESCE(p.activo, TRUE) = TRUE
                      AND NULLIF(TRIM(token), '') IS NOT NULL
                      AND (%s = '' OR UPPER(TRIM(token)) LIKE %s)
                ) t
                WHERE NULLIF(TRIM(valor), '') IS NOT NULL
                ORDER BY valor
                LIMIT %s;
            """, (texto, like, texto, like, limite))
            valores = [r["valor"] for r in cur.fetchall() if r.get("valor")]
            return {"total": len(valores), "valores": valores}


@router.get("/propietarios/catalogo/razones-sociales")
def buscar_razones_sociales_catalogo(
    q: str = Query("", max_length=120),
    limite: int = Query(25, ge=1, le=100),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    texto = upper_clean_v28(q) or ""
    like = f"{texto}%"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT DISTINCT UPPER(TRIM(razon_social)) AS valor
                FROM catalogos.personas
                WHERE COALESCE(activo, TRUE) = TRUE
                  AND NULLIF(TRIM(razon_social), '') IS NOT NULL
                  AND (%s = '' OR UPPER(TRIM(razon_social)) LIKE %s)
                ORDER BY valor
                LIMIT %s;
            """, (texto, like, limite))
            valores = [r["valor"] for r in cur.fetchall() if r.get("valor")]
            return {"total": len(valores), "valores": valores}


@router.get("/propietarios/catalogo/calles")
def buscar_calles_catalogo(
    q: str = Query("", max_length=150),
    limite: int = Query(30, ge=1, le=100),
    exacta: bool = Query(False),
    incluir_padron: bool = Query(True),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    """Busca calles en cat_calles; opcionalmente sugiere calles del padrón fiscal."""
    texto = upper_clean_v28(q) or ""
    like = f"{texto}%" if texto else "%"
    like_contiene = f"%{texto}%" if texto else "%"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, UPPER(TRIM(nombre_calle)) AS nombre_calle
                FROM catalogos.cat_calles
                WHERE COALESCE(activo, TRUE) = TRUE
                  AND NULLIF(TRIM(nombre_calle), '') IS NOT NULL
                  AND (%s = '' OR UPPER(TRIM(nombre_calle)) LIKE %s)
                ORDER BY
                    CASE WHEN %s <> '' AND UPPER(TRIM(nombre_calle)) = %s THEN 0 ELSE 1 END,
                    nombre_calle
                LIMIT %s;
            """, (texto, like_contiene if texto else like, texto, texto, limite))
            calles = [
                {"id": int(r["id"]), "nombre_calle": r["nombre_calle"], "origen": "catalogo"}
                for r in cur.fetchall()
                if r.get("nombre_calle")
            ]
            nombres_vistos = {c["nombre_calle"] for c in calles}
            hay_exacta = bool(texto and any(c["nombre_calle"] == texto for c in calles))

            if exacta:
                return {"total": len(calles), "calles": calles, "exacta": hay_exacta}

            restante = max(limite - len(calles), 0)
            if incluir_padron and restante > 0 and texto:
                cur.execute("""
                    SELECT DISTINCT UPPER(TRIM(calle)) AS nombre_calle
                    FROM catalogos.padron_2026
                    WHERE NULLIF(TRIM(calle), '') IS NOT NULL
                      AND UPPER(TRIM(calle)) LIKE %s
                    ORDER BY 1
                    LIMIT %s;
                """, (like_contiene, restante))
                for r in cur.fetchall():
                    nom = r.get("nombre_calle")
                    if not nom or nom in nombres_vistos:
                        continue
                    nombres_vistos.add(nom)
                    calles.append({"id": None, "nombre_calle": nom, "origen": "padron"})

            return {"total": len(calles), "calles": calles, "exacta": hay_exacta}


@router.post("/propietarios/catalogo/calles")
def crear_calle_catalogo(
    payload: CalleCatalogoPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    """Alta de calle en catalogos.cat_calles."""
    nombre = upper_clean_v28(payload.nombre_calle)
    if not nombre:
        raise HTTPException(status_code=400, detail="Capture el nombre de la calle.")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, UPPER(TRIM(nombre_calle)) AS nombre_calle, COALESCE(activo, TRUE) AS activo
                FROM catalogos.cat_calles
                WHERE UPPER(TRIM(nombre_calle)) = %s
                LIMIT 1;
            """, (nombre,))
            existente = cur.fetchone()
            if existente:
                if not existente.get("activo"):
                    cur.execute("""
                        UPDATE catalogos.cat_calles
                        SET activo = TRUE
                        WHERE id = %s
                        RETURNING id, UPPER(TRIM(nombre_calle)) AS nombre_calle;
                    """, (existente["id"],))
                    row = cur.fetchone()
                else:
                    row = existente
                conn.commit()
                return {
                    "ok": True,
                    "creada": False,
                    "calle": {
                        "id": int(row["id"]),
                        "nombre_calle": row["nombre_calle"],
                        "origen": "catalogo",
                    },
                }

            cur.execute("""
                INSERT INTO catalogos.cat_calles (nombre_calle, activo)
                VALUES (%s, TRUE)
                RETURNING id, UPPER(TRIM(nombre_calle)) AS nombre_calle;
            """, (nombre,))
            row = cur.fetchone()
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "CREAR_CALLE",
                "CATALOGOS",
                f"Calle creada id={row['id']} nombre={nombre}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "creada": True,
                "calle": {
                    "id": int(row["id"]),
                    "nombre_calle": row["nombre_calle"],
                    "origen": "catalogo",
                },
            }


@router.get("/propietarios/mantenimiento/buscar")
def buscar_propietarios_mantenimiento(
    q: str = Query("", max_length=150),
    limite: int = Query(150, ge=1, le=500),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    """Búsqueda para mantenimiento de propietarios con domicilio fiscal del padrón."""
    texto = upper_clean_v28(q) or ""
    if not texto:
        return {"total": 0, "truncado": False, "resultados": []}

    filtro_catalogo, params_catalogo = condiciones_busqueda_persona_v28("p", texto)
    filtro_padron, params_padron = condiciones_busqueda_padron_v28(q=texto)

    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
                filtro_vigente = "COALESCE(pp.vigente, TRUE) = TRUE" if "vigente" in cols_pp else "TRUE"
                asegurar_columnas_domicilio_persona(cur, conn)
                rows = []
                nombres_vistos = set()
                nombres_norm_catalogo = set()

                if filtro_catalogo != "FALSE":
                    cur.execute(f"""
                        SELECT
                            p.id_persona,
                            UPPER(COALESCE(p.tipo_persona, 'FISICA')) AS tipo_persona,
                            p.nombre,
                            p.apellido_paterno,
                            p.apellido_materno,
                            p.razon_social,
                            p.rfc,
                            p.curp,
                            p.activo,
                            {nombre_persona_sql_v28('p')} AS nombre_completo,
                            dom.clave_catastral,
                            COALESCE(NULLIF(TRIM(p.colonia), ''), dom.colonia) AS colonia,
                            COALESCE(NULLIF(TRIM(p.calle), ''), dom.calle) AS calle,
                            cc.id AS id_calle,
                            COALESCE(NULLIF(TRIM(p.numof), ''), dom.numof) AS numof,
                            COALESCE(NULLIF(TRIM(p.delegacion), ''), dom.delegacion) AS delegacion,
                            COALESCE(NULLIF(TRIM(p.cp), ''), dom.cp) AS cp,
                            'catalogo'::text AS origen
                        FROM catalogos.personas p
                        LEFT JOIN LATERAL (
                            SELECT
                                pad.clave_catastral,
                                pad.colonia,
                                pad.calle,
                                pad.numof,
                                pad.delegacion,
                                NULL::text AS cp
                            FROM catastro.predio_propietario pp
                            INNER JOIN catalogos.padron_2026 pad
                                ON UPPER(TRIM(pad.clave_catastral)) = UPPER(TRIM(pp.clave_catastral))
                            WHERE pp.id_persona = p.id_persona
                              AND {filtro_vigente}
                            ORDER BY
                                CASE WHEN UPPER(COALESCE(pp.tipo_titularidad, '')) = 'PROPIETARIO' THEN 0 ELSE 1 END,
                                pp.porcentaje_propiedad DESC NULLS LAST,
                                pad.clave_catastral
                            LIMIT 1
                        ) dom ON TRUE
                        LEFT JOIN catalogos.cat_calles cc
                          ON COALESCE(cc.activo, TRUE) = TRUE
                         AND UPPER(TRIM(cc.nombre_calle)) = UPPER(TRIM(
                            COALESCE(NULLIF(TRIM(p.calle), ''), dom.calle, '')
                         ))
                        WHERE COALESCE(p.activo, TRUE) = TRUE
                          AND ({filtro_catalogo})
                        ORDER BY {nombre_persona_sql_v28('p')}
                        LIMIT %s;
                    """, (*params_catalogo, limite))
                    for row in cur.fetchall():
                        nombre_row = upper_clean_v28(row.get("nombre_completo"))
                        if nombre_row:
                            nombres_vistos.add(nombre_row)
                            norm = normalizar_nombre_fusion_v28(nombre_row)
                            if norm:
                                nombres_norm_catalogo.add(norm)
                        rows.append(row)

                    # Variantes dadas de baja por fusión: no repetirlas en padrón.
                    cur.execute(f"""
                        SELECT DISTINCT {nombre_persona_sql_v28('p')} AS nombre_completo
                        FROM catalogos.personas p
                        WHERE COALESCE(p.activo, TRUE) = FALSE
                          AND ({filtro_catalogo});
                    """, tuple(params_catalogo))
                    for row in cur.fetchall():
                        norm = normalizar_nombre_fusion_v28(row.get("nombre_completo"))
                        if norm:
                            nombres_norm_catalogo.add(norm)

                padron_ocultos = 0
                total_padron = 0
                if filtro_padron != "FALSE":
                    cur.execute(f"""
                        SELECT COUNT(DISTINCT UPPER(TRIM(p.nombre_completo))) AS total
                        FROM catalogos.padron_2026 p
                        WHERE NULLIF(TRIM(p.nombre_completo), '') IS NOT NULL
                          AND ({filtro_padron});
                    """, tuple(params_padron))
                    total_padron = int((cur.fetchone() or {}).get("total") or 0)

                    restante = max(limite - len(rows), 0)
                    if restante > 0:
                        cur.execute(f"""
                            SELECT DISTINCT ON (UPPER(TRIM(p.nombre_completo)))
                                UPPER(TRIM(p.nombre_completo)) AS nombre_completo,
                                p.clave_catastral,
                                p.colonia,
                                p.calle,
                                p.numof,
                                p.delegacion
                            FROM catalogos.padron_2026 p
                            WHERE NULLIF(TRIM(p.nombre_completo), '') IS NOT NULL
                              AND ({filtro_padron})
                            ORDER BY UPPER(TRIM(p.nombre_completo)), p.clave_catastral
                            LIMIT %s;
                        """, (*params_padron, restante * 2))
                        for pr in cur.fetchall():
                            nombre_row = upper_clean_v28(pr.get("nombre_completo"))
                            if not nombre_row:
                                continue
                            norm = normalizar_nombre_fusion_v28(nombre_row)
                            if norm and norm in nombres_norm_catalogo:
                                padron_ocultos += 1
                                continue
                            if nombre_row in nombres_vistos:
                                continue
                            nombres_vistos.add(nombre_row)
                            if norm:
                                nombres_norm_catalogo.add(norm)
                            parsed = parse_nombre_padron_v28(nombre_row)
                            es_moral = es_nombre_moral_v28(nombre_row)
                            rows.append({
                                "id_persona": None,
                                "tipo_persona": "MORAL" if es_moral else "FISICA",
                                "nombre": parsed.get("nombre"),
                                "apellido_paterno": parsed.get("apellido_paterno"),
                                "apellido_materno": parsed.get("apellido_materno"),
                                "razon_social": nombre_row if es_moral else None,
                                "rfc": None,
                                "curp": None,
                                "activo": True,
                                "nombre_completo": nombre_row,
                                "clave_catastral": pr.get("clave_catastral"),
                                "colonia": pr.get("colonia"),
                                "calle": pr.get("calle"),
                                "numof": pr.get("numof"),
                                "delegacion": pr.get("delegacion"),
                                "cp": None,
                                "origen": "padron",
                            })
                            if len(rows) >= limite:
                                break

                padron_en_resultados = sum(1 for r in rows if r.get("origen") == "padron")
                truncado = len(rows) >= limite or total_padron > padron_en_resultados

                return {
                    "total": len(rows),
                    "total_padron": total_padron,
                    "padron_ocultos_por_catalogo": padron_ocultos,
                    "truncado": truncado,
                    "resultados": rows[:limite],
                }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en búsqueda de mantenimiento: {e}")


@router.post("/propietarios/fusionar")
def fusionar_propietarios_catalogo(
    payload: FusionarPropietariosPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    destino = int(payload.id_persona_destino)
    origenes = sorted({
        int(x) for x in (payload.id_personas_origen or [])
        if int(x) != destino
    })
    if not origenes:
        raise HTTPException(status_code=400, detail="Indique al menos un propietario origen distinto al destino.")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id_persona FROM catalogos.personas
                WHERE id_persona = %s AND COALESCE(activo, TRUE) = TRUE;
            """, (destino,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Propietario destino no encontrado o inactivo.")

            cur.execute("""
                SELECT id_persona FROM catalogos.personas
                WHERE id_persona = ANY(%s) AND COALESCE(activo, TRUE) = TRUE;
            """, (origenes,))
            activos = {int(r["id_persona"]) for r in cur.fetchall()}
            faltantes = [x for x in origenes if x not in activos]
            if faltantes:
                raise HTTPException(
                    status_code=404,
                    detail=f"Propietarios origen no encontrados o inactivos: {faltantes}"
                )

            cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
            tiene_vigente = "vigente" in cols_pp
            rel_movidas = 0
            rel_unidas = 0
            rel_cerradas = 0
            claves_afectadas = set()

            cur.execute(f"""
                SELECT id_persona, {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catalogos.personas p
                WHERE id_persona = ANY(%s);
            """, (origenes,))
            nombres_origen = []
            for row_orig in cur.fetchall():
                nom = upper_clean_v28(row_orig.get("nombre_completo"))
                if nom:
                    nombres_origen.append(nom)

            for id_origen in origenes:
                if tiene_vigente:
                    cur.execute("""
                        SELECT id_predio_propietario, clave_catastral, porcentaje_propiedad, tipo_titularidad
                        FROM catastro.predio_propietario
                        WHERE id_persona = %s AND vigente = TRUE;
                    """, (id_origen,))
                else:
                    cur.execute("""
                        SELECT id_predio_propietario, clave_catastral, porcentaje_propiedad, tipo_titularidad
                        FROM catastro.predio_propietario
                        WHERE id_persona = %s;
                    """, (id_origen,))

                for rel in cur.fetchall():
                    clave = str(rel.get("clave_catastral") or "").strip().upper()
                    if not clave:
                        continue
                    claves_afectadas.add(clave)

                    if tiene_vigente:
                        cur.execute("""
                            SELECT id_predio_propietario, porcentaje_propiedad
                            FROM catastro.predio_propietario
                            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                              AND id_persona = %s
                              AND vigente = TRUE
                            LIMIT 1;
                        """, (clave, destino))
                    else:
                        cur.execute("""
                            SELECT id_predio_propietario, porcentaje_propiedad
                            FROM catastro.predio_propietario
                            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                              AND id_persona = %s
                            LIMIT 1;
                        """, (clave, destino))

                    dest_rel = cur.fetchone()
                    if dest_rel:
                        pct_orig = float(rel.get("porcentaje_propiedad") or 0)
                        pct_dest = float(dest_rel.get("porcentaje_propiedad") or 0)
                        pct_nuevo = round(min(pct_dest + pct_orig, 100.0), 6)
                        cur.execute("""
                            UPDATE catastro.predio_propietario
                            SET porcentaje_propiedad = %s
                            WHERE id_predio_propietario = %s;
                        """, (pct_nuevo, dest_rel["id_predio_propietario"]))
                        if tiene_vigente:
                            cur.execute("""
                                UPDATE catastro.predio_propietario
                                SET vigente = FALSE, fecha_fin = CURRENT_DATE
                                WHERE id_predio_propietario = %s;
                            """, (rel["id_predio_propietario"],))
                        else:
                            cur.execute("""
                                DELETE FROM catastro.predio_propietario
                                WHERE id_predio_propietario = %s;
                            """, (rel["id_predio_propietario"],))
                        rel_unidas += 1
                    else:
                        cur.execute("""
                            UPDATE catastro.predio_propietario
                            SET id_persona = %s
                            WHERE id_predio_propietario = %s;
                        """, (destino, rel["id_predio_propietario"]))
                        rel_movidas += 1

                cur.execute("""
                    UPDATE catalogos.personas
                    SET activo = FALSE
                    WHERE id_persona = %s;
                """, (id_origen,))
                rel_cerradas += 1

            cur.execute(f"""
                SELECT {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catalogos.personas p
                WHERE p.id_persona = %s;
            """, (destino,))
            dest_row = cur.fetchone()
            nombre_dest = upper_clean_v28(dest_row.get("nombre_completo") if dest_row else "")
            padron_por_clave = 0
            padron_por_nombre = 0
            if nombre_dest:
                padron_por_clave = sincronizar_padron_nombre_claves_v28(
                    cur, list(claves_afectadas), nombre_dest
                )
                if nombres_origen:
                    cur.execute("""
                        UPDATE catalogos.padron_2026
                        SET nombre_completo = %s
                        WHERE UPPER(TRIM(COALESCE(nombre_completo, ''))) = ANY(%s)
                          AND UPPER(TRIM(COALESCE(nombre_completo, ''))) <> %s;
                    """, (nombre_dest, nombres_origen, nombre_dest))
                    padron_por_nombre = cur.rowcount or 0

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "FUSIONAR_PROPIETARIOS",
                "PROPIETARIOS",
                f"Destino={destino} origenes={origenes} movidas={rel_movidas} unidas={rel_unidas}",
                request.client.host if request.client else None
            )
            conn.commit()

            return {
                "ok": True,
                "id_persona_destino": destino,
                "nombre_destino": dest_row.get("nombre_completo") if dest_row else None,
                "origenes_fusionados": origenes,
                "relaciones_movidas": rel_movidas,
                "relaciones_unidas": rel_unidas,
                "personas_desactivadas": rel_cerradas,
                "padron_actualizados_clave": padron_por_clave,
                "padron_actualizados_nombre": padron_por_nombre,
                "padron_actualizados": padron_por_clave + padron_por_nombre,
            }


@router.get("/propietarios/{id_persona}")
def obtener_propietario_catalogo(
    id_persona: int,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT
                    p.*,
                    {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catalogos.personas p
                WHERE p.id_persona = %s;
            """, (id_persona,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Propietario no encontrado")
            return row


@router.post("/propietarios")
def crear_propietario_catalogo(
    payload: PropietarioPersonaPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    tipo = upper_clean_v28(payload.tipo_persona) or "FISICA"
    if tipo not in ["FISICA", "MORAL"]:
        raise HTTPException(status_code=400, detail="tipo_persona debe ser FISICA o MORAL")

    nombre = upper_clean_v28(payload.nombre)
    ap_pat = upper_clean_v28(payload.apellido_paterno)
    ap_mat = upper_clean_v28(payload.apellido_materno)
    razon = upper_clean_v28(payload.razon_social)
    rfc = upper_clean_v28(payload.rfc)
    curp = upper_clean_v28(payload.curp)

    if tipo == "MORAL" and not razon:
        raise HTTPException(status_code=400, detail="Razón social obligatoria para persona moral")
    if tipo == "FISICA" and not (nombre or ap_pat or ap_mat):
        raise HTTPException(status_code=400, detail="Debe capturar apellido o nombre para persona física")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cols_tabla = asegurar_columnas_domicilio_persona(cur, conn)
            dom = domicilio_persona_desde_payload(payload)
            insert_cols = [
                "tipo_persona", "nombre", "apellido_paterno", "apellido_materno",
                "razon_social", "rfc", "curp", "activo", "fecha_creacion",
            ]
            insert_vals = ["%s", "%s", "%s", "%s", "%s", "%s", "%s", "%s", "now()"]
            insert_params = [
                tipo, nombre, ap_pat, ap_mat, razon, rfc, curp,
                bool(payload.activo if payload.activo is not None else True),
            ]
            for col in COLS_DOMICILIO_PERSONA:
                if col in cols_tabla:
                    insert_cols.append(col)
                    insert_vals.append("%s")
                    insert_params.append(dom[col])

            cur.execute(f"""
                INSERT INTO catalogos.personas ({", ".join(insert_cols)})
                VALUES ({", ".join(insert_vals)})
                RETURNING *;
            """, tuple(insert_params))
            row = cur.fetchone()
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "CREAR_PROPIETARIO",
                "PROPIETARIOS",
                f"Propietario creado id_persona={row['id_persona']}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {"ok": True, "propietario": row}


@router.put("/propietarios/{id_persona}")
def actualizar_propietario_catalogo(
    id_persona: int,
    payload: PropietarioPersonaPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    tipo = upper_clean_v28(payload.tipo_persona) or "FISICA"
    if tipo not in ["FISICA", "MORAL"]:
        raise HTTPException(status_code=400, detail="tipo_persona debe ser FISICA o MORAL")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cols_tabla = asegurar_columnas_domicilio_persona(cur, conn)
            dom = domicilio_persona_desde_payload(payload)
            set_parts = [
                "tipo_persona = %s",
                "nombre = %s",
                "apellido_paterno = %s",
                "apellido_materno = %s",
                "razon_social = %s",
                "rfc = %s",
                "curp = %s",
                "activo = %s",
            ]
            params = [
                tipo,
                upper_clean_v28(payload.nombre),
                upper_clean_v28(payload.apellido_paterno),
                upper_clean_v28(payload.apellido_materno),
                upper_clean_v28(payload.razon_social),
                upper_clean_v28(payload.rfc),
                upper_clean_v28(payload.curp),
                bool(payload.activo if payload.activo is not None else True),
            ]
            for col in COLS_DOMICILIO_PERSONA:
                if col in cols_tabla:
                    set_parts.append(f"{col} = %s")
                    params.append(dom[col])
            params.append(id_persona)

            cur.execute(f"""
                UPDATE catalogos.personas
                SET {", ".join(set_parts)}
                WHERE id_persona = %s
                RETURNING *;
            """, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Propietario no encontrado")
            padron_sync = sincronizar_padron_nombre_persona_v28(cur, id_persona)
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ACTUALIZAR_PROPIETARIO",
                "PROPIETARIOS",
                f"Propietario actualizado id_persona={id_persona} padron_sync={padron_sync}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {"ok": True, "propietario": row, "padron_actualizados": padron_sync}


@router.delete("/propietarios/{id_persona}")
def eliminar_propietario_catalogo(
    id_persona: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    """Baja lógica del propietario en catálogo y cierra relaciones vigentes con predios."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id_persona FROM catalogos.personas
                WHERE id_persona = %s AND COALESCE(activo, TRUE) = TRUE;
            """, (id_persona,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Propietario no encontrado o ya inactivo.")

            cols_pp = columnas_tabla(cur, "catastro", "predio_propietario")
            rel_cerradas = 0
            if "vigente" in cols_pp:
                cur.execute("""
                    UPDATE catastro.predio_propietario
                    SET vigente = FALSE, fecha_fin = CURRENT_DATE
                    WHERE id_persona = %s AND vigente = TRUE;
                """, (id_persona,))
                rel_cerradas = cur.rowcount or 0

            cur.execute("""
                UPDATE catalogos.personas
                SET activo = FALSE
                WHERE id_persona = %s
                RETURNING id_persona;
            """, (id_persona,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No se pudo dar de baja el propietario.")

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ELIMINAR_PROPIETARIO",
                "PROPIETARIOS",
                f"Propietario dado de baja id_persona={id_persona} relaciones_cerradas={rel_cerradas}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "id_persona": id_persona,
                "relaciones_cerradas": rel_cerradas,
                "mensaje": "Propietario dado de baja del catálogo.",
            }


@router.get("/predios/{clave}/propietarios")
def listar_propietarios_predio_v28(
    clave: str,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            cur.execute(f"""
                SELECT
                    pp.id_predio_propietario,
                    pp.id_predio,
                    pp.clave_catastral,
                    pp.id_persona,
                    pp.porcentaje_propiedad,
                    pp.tipo_titularidad,
                    pp.vigente,
                    pp.fecha_inicio,
                    pp.fecha_fin,
                    p.tipo_persona,
                    p.nombre,
                    p.apellido_paterno,
                    p.apellido_materno,
                    p.razon_social,
                    p.rfc,
                    p.curp,
                    {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas p
                    ON p.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                  AND pp.vigente = TRUE
                ORDER BY
                    CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 1 ELSE 2 END,
                    pp.porcentaje_propiedad DESC,
                    nombre_completo;
            """, (clave,))
            rows = cur.fetchall()
            total_porcentaje = sum(float(r.get("porcentaje_propiedad") or 0) for r in rows)
            titular_padron = obtener_titular_padron_v28(cur, clave)
            sincronizado = titular_padron_sincronizado_v28(rows, titular_padron)
            condominio = obtener_info_condominio_predio_v28(cur, clave)
            return {
                "clave_catastral": clave.upper(),
                "total": len(rows),
                "suma_porcentaje": round(total_porcentaje, 6),
                "valido": abs(total_porcentaje - 100) < 0.000001,
                "titular_padron": titular_padron,
                "padron_sincronizado": sincronizado,
                "condominio": condominio,
                "propietarios": rows
            }


@router.post("/predios/{clave}/propietarios/refrescar-nombre-padron")
def refrescar_nombre_padron_desde_catalogo_v28(
    clave: str,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    """Copia el titular vigente del catálogo al campo padron.nombre_completo."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            padron_sync = sincronizar_padron_titular_predio_v28(cur, clave)
            nombre = None
            if padron_sync:
                cur.execute("""
                    SELECT nombre_completo FROM catalogos.padron_2026
                    WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                    LIMIT 1;
                """, (clave,))
                row_pad = cur.fetchone()
                nombre = row_pad.get("nombre_completo") if row_pad else None
            else:
                cur.execute(f"""
                    SELECT {nombre_persona_sql_v28('p')} AS nombre_completo
                    FROM catastro.predio_propietario pp
                    JOIN catalogos.personas p ON p.id_persona = pp.id_persona
                    WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                      AND pp.vigente = TRUE
                    ORDER BY pp.porcentaje_propiedad DESC NULLS LAST
                    LIMIT 1;
                """, (clave,))
                row = cur.fetchone()
                nombre = row.get("nombre_completo") if row else None

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "REFRESCAR_NOMBRE_PADRON",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} padron_sync={padron_sync} nombre={nombre or ''}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "clave_catastral": clave.upper(),
                "nombre_completo": nombre,
                "padron_actualizados": padron_sync,
                "mensaje": "Nombre del padrón sincronizado con el catálogo." if padron_sync else "Sin titular vigente para sincronizar.",
            }


@router.get("/propietarios/padron/desfase")
def resumen_desfase_padron_catalogo(
    texto_padron: str = Query("", max_length=80),
    limite: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    usuario_actual: dict = Depends(permiso_movimientos),
):
    """Predios cuyo nombre en padrón difiere del titular vigente en catálogo."""
    filtro = ""
    params_extra = []
    txt = upper_clean_v28(texto_padron) or ""
    if txt:
        filtro = "AND UPPER(TRIM(COALESCE(pad.nombre_completo, ''))) LIKE %s"
        params_extra.append(f"%{txt}%")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cte = _sql_cte_titular_principal_catalogo()
            cur.execute(f"""
                WITH {cte}
                SELECT COUNT(*)::int AS total
                FROM catalogos.padron_2026 pad
                INNER JOIN titular t ON UPPER(TRIM(pad.clave_catastral)) = t.clave
                WHERE NULLIF(TRIM(t.nombre_catalogo), '') IS NOT NULL
                  AND UPPER(TRIM(COALESCE(pad.nombre_completo, ''))) <> UPPER(TRIM(t.nombre_catalogo))
                  {filtro.replace('pad.', 'pad.')};
            """, params_extra)
            total = int((cur.fetchone() or {}).get("total") or 0)

            cur.execute(f"""
                WITH {cte}
                SELECT
                    pad.clave_catastral,
                    pad.nombre_completo AS padron_nombre,
                    t.nombre_catalogo AS catalogo_nombre,
                    t.id_persona
                FROM catalogos.padron_2026 pad
                INNER JOIN titular t ON UPPER(TRIM(pad.clave_catastral)) = t.clave
                WHERE NULLIF(TRIM(t.nombre_catalogo), '') IS NOT NULL
                  AND UPPER(TRIM(COALESCE(pad.nombre_completo, ''))) <> UPPER(TRIM(t.nombre_catalogo))
                  {filtro}
                ORDER BY pad.clave_catastral
                LIMIT %s OFFSET %s;
            """, params_extra + [limite, offset])
            muestra = [dict(r) for r in cur.fetchall()]

            return {
                "total_desfase": total,
                "limite": limite,
                "offset": offset,
                "filtro_texto_padron": txt or None,
                "muestra": muestra,
                "mensaje": (
                    "Hay predios donde el padrón fiscal no coincide con el titular del catálogo. "
                    "Use POST /propietarios/padron/sincronizar-masivo con confirmar=true para corregirlos."
                ),
            }


@router.post("/propietarios/padron/sincronizar-masivo")
def sincronizar_padron_catalogo_masivo_v28(
    payload: SincronizarPadronMasivoPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos),
):
    """Copia el titular del catálogo al padrón en todos los predios con desfase."""
    if not payload.confirmar:
        raise HTTPException(status_code=400, detail="Debe enviar confirmar=true.")

    filtro = ""
    params_extra = []
    txt = upper_clean_v28(payload.texto_padron) or ""
    if txt:
        filtro = "AND UPPER(TRIM(COALESCE(pad.nombre_completo, ''))) LIKE %s"
        params_extra.append(f"%{txt}%")

    limite = min(max(int(payload.limite or 5000), 1), 50000)

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cte = _sql_cte_titular_principal_catalogo()
            cur.execute(f"""
                WITH {cte}
                UPDATE catalogos.padron_2026 pad
                SET nombre_completo = t.nombre_catalogo
                FROM titular t
                WHERE UPPER(TRIM(pad.clave_catastral)) = t.clave
                  AND NULLIF(TRIM(t.nombre_catalogo), '') IS NOT NULL
                  AND UPPER(TRIM(COALESCE(pad.nombre_completo, ''))) <> UPPER(TRIM(t.nombre_catalogo))
                  {filtro}
                RETURNING pad.clave_catastral, t.nombre_catalogo AS nombre_nuevo;
            """, params_extra)
            filas = cur.fetchall()
            actualizados = len(filas)

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "SYNC_PADRON_CATALOGO_MASIVO",
                "PROPIETARIOS",
                f"actualizados={actualizados} filtro={txt or 'TODOS'}",
                request.client.host if request.client else None,
            )
            conn.commit()

            return {
                "ok": True,
                "actualizados": actualizados,
                "filtro_texto_padron": txt or None,
                "limite_aplicado": limite,
                "muestra": [dict(r) for r in filas[:30]],
                "mensaje": f"Se sincronizaron {actualizados} predio(s) del padrón con el titular del catálogo.",
            }


@router.get("/predios/{clave}/condominio")
def obtener_condominio_predio_v28(
    clave: str,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            return obtener_info_condominio_predio_v28(cur, clave)


@router.put("/predios/{clave}/tenencia")
def actualizar_tenencia_predio_v28(
    clave: str,
    payload: TenenciaPadronPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos),
):
    """Asigna o cambia el tipo de tenencia (campo padron.condominio)."""
    if not payload.confirmar:
        raise HTTPException(status_code=400, detail="Debe enviar confirmar=true.")
    clave_norm = upper_clean_v28(clave) or ""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            usuario = usuario_actual.get("usuario") or "sistema"
            data = _aplicar_tenencia_predio(cur, clave_norm, payload.tenencia, usuario)
            registrar_auditoria_simple_v28(
                cur,
                usuario,
                "ACTUALIZAR_TENENCIA_PREDIO",
                "COPROPIETARIOS",
                f"Clave {clave_norm} tenencia={data.get('tenencia')}",
                request.client.host if request.client else None,
            )
            conn.commit()
            return {
                "ok": True,
                "mensaje": f"Tenencia actualizada a {data.get('tipo_nombre') or data.get('tenencia')} ({data.get('tenencia')}).",
                "condominio": obtener_info_condominio_predio_v28(cur, clave_norm),
                **data,
            }


@router.put("/predios/{clave}/condominio")
def guardar_condominio_predio_v28(
    clave: str,
    payload: PredioCondominioPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    clave_norm = upper_clean_v28(clave) or ""

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            cur.execute("""
                SELECT clave_catastral
                FROM catalogos.padron_2026
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                LIMIT 1;
            """, (clave_norm,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Predio no encontrado en padrón.")

            upsert_predio_condominio_v28(
                cur,
                clave_norm,
                usuario_actual.get("usuario"),
                modalidad=payload.modalidad,
                nombre_condominio=payload.nombre_condominio,
                observaciones=payload.observaciones,
                set_modalidad=True,
                set_nombre=True,
                set_observaciones=True,
            )

            info = obtener_info_condominio_predio_v28(cur, clave_norm)
            propagadas_grupo = 0
            if payload.propagar_grupo and info.get("unidades_relacionadas"):
                modalidad_grupo = info.get("modalidad")
                nombre_grupo = info.get("nombre_condominio")
                if modalidad_grupo or nombre_grupo:
                    for unidad in info.get("unidades_relacionadas") or []:
                        clave_rel = upper_clean_v28(unidad.get("clave_catastral"))
                        if not clave_rel:
                            continue
                        upsert_predio_condominio_v28(
                            cur,
                            clave_rel,
                            usuario_actual.get("usuario"),
                            modalidad=modalidad_grupo,
                            nombre_condominio=nombre_grupo,
                            observaciones=payload.observaciones,
                            set_modalidad=True,
                            set_nombre=True,
                            set_observaciones=bool(payload.observaciones is not None),
                        )
                        propagadas_grupo += 1

            claves_padron = [clave_norm]
            if propagadas_grupo:
                claves_padron.extend(
                    upper_clean_v28(u.get("clave_catastral"))
                    for u in (info.get("unidades_relacionadas") or [])
                    if upper_clean_v28(u.get("clave_catastral"))
                )
            sincronizar_padron_condominio_v28(cur, claves_padron, info.get("modalidad"))

            info = obtener_info_condominio_predio_v28(cur, clave_norm)
            detalle_audit = f"Clave {clave_norm} modalidad={info.get('modalidad') or 'SIN_CLASIFICAR'} regimen_catastro={info.get('regimen_catastro') or '—'} nombre={info.get('nombre_condominio') or '—'}"
            if propagadas_grupo:
                detalle_audit += f" propagadas_grupo={propagadas_grupo}"
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "CLASIFICAR_CONDOMINIO_PREDIO",
                "COPROPIETARIOS",
                detalle_audit,
                request.client.host if request.client else None
            )
            conn.commit()
            mensaje = "Clasificación de condominio guardada."
            if propagadas_grupo:
                mensaje += f" Se aplicó también a {propagadas_grupo} unidad(es) relacionada(s) del mismo domicilio."
            return {
                "ok": True,
                "mensaje": mensaje,
                "propagadas_grupo": propagadas_grupo,
                "condominio": info,
            }


def _fila_predio_clasificacion_condominio(row: dict) -> dict:
    tipo_key = row.get("tipo_regimen") or "NULL"
    valor_raw = row.get("valor_padron") or ""
    regimen = _etiqueta_tipo_condominio(tipo_key, valor_raw if tipo_key == "OTRO" else valor_raw)
    modalidad = upper_clean_v28(row.get("modalidad"))
    return {
        "clave_catastral": row.get("clave_catastral"),
        "regimen": regimen,
        "en_regimen_condominio": tipo_key == "C",
        "nombre_completo": upper_clean_v28(row.get("nombre_completo")),
        "colonia": upper_clean_v28(row.get("colonia")),
        "calle": upper_clean_v28(row.get("calle")),
        "numof": upper_clean_v28(row.get("numof")),
        "numint": upper_clean_v28(row.get("numint")),
        "modalidad": modalidad,
        "modalidad_etiqueta": etiqueta_modalidad_condominio(modalidad),
        "nombre_condominio": normalizar_nombre_condominio(row.get("nombre_condominio")),
        "valor2026": float(row.get("valor2026") or 0),
        "adeudo_total": float(row.get("adeudo_total") or 0),
    }


@router.get("/condominios/nombres")
def listar_nombres_condominio_v28(
    q: str = Query("", max_length=150),
    limite: int = Query(50, ge=1, le=200),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            q_norm = (q or "").strip().upper()
            if q_norm:
                cur.execute("""
                    SELECT
                        UPPER(TRIM(nombre_condominio)) AS nombre_condominio,
                        COUNT(*)::int AS unidades
                    FROM catastro.predio_condominio
                    WHERE NULLIF(TRIM(nombre_condominio), '') IS NOT NULL
                      AND UPPER(TRIM(nombre_condominio)) LIKE %s
                    GROUP BY 1
                    ORDER BY unidades DESC, nombre_condominio
                    LIMIT %s;
                """, (f"%{q_norm}%", limite))
            else:
                cur.execute("""
                    SELECT
                        UPPER(TRIM(nombre_condominio)) AS nombre_condominio,
                        COUNT(*)::int AS unidades
                    FROM catastro.predio_condominio
                    WHERE NULLIF(TRIM(nombre_condominio), '') IS NOT NULL
                    GROUP BY 1
                    ORDER BY unidades DESC, nombre_condominio
                    LIMIT %s;
                """, (limite,))
            rows = cur.fetchall()
            return {"total": len(rows), "nombres": rows}


@router.post("/condominios/clasificacion/buscar")
def buscar_clasificacion_condominio_v28(
    payload: CondominioClasificacionBuscarPayload,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    claves = parse_lista_claves_condominio_v28(payload.claves_texto, payload.claves)
    limite = min(max(payload.limite or 500, 1), 5000)
    offset = max(payload.offset or 0, 0)

    where = ["TRUE"]
    params = []

    if payload.solo_regimen_c and not claves:
        where.append("UPPER(TRIM(p.condominio)) = 'C'")

    # Si hay claves explícitas, buscar SOLO esas claves (ignorar prefijo, texto libre, etc.)
    if claves:
        where.append("UPPER(TRIM(p.clave_catastral)) = ANY(%s)")
        params.append(claves)
    else:
        prefijo = upper_clean_v28(payload.clave_prefijo)
        if prefijo:
            where.append("UPPER(p.clave_catastral) LIKE %s")
            params.append(f"{prefijo}%")

        nombre_cond = normalizar_nombre_condominio(payload.nombre_condominio)
        if nombre_cond:
            where.append("UPPER(TRIM(pc.nombre_condominio)) LIKE %s")
            params.append(f"%{nombre_cond}%")

        colonia = upper_clean_v28(payload.colonia)
        if colonia:
            where.append("UPPER(TRIM(p.colonia)) LIKE %s")
            params.append(f"%{colonia}%")

        calle = upper_clean_v28(payload.calle)
        if calle:
            where.append("UPPER(TRIM(p.calle)) LIKE %s")
            params.append(f"%{calle}%")

        numof = upper_clean_v28(payload.numof)
        if numof:
            where.append("UPPER(TRIM(COALESCE(p.numof, ''))) = %s")
            params.append(numof)

        qtxt = upper_clean_v28(payload.q)
        if qtxt:
            q_like = f"%{qtxt}%"
            where.append("""
                (
                    UPPER(p.clave_catastral) LIKE %s
                    OR UPPER(TRIM(p.colonia)) LIKE %s
                    OR UPPER(TRIM(p.calle)) LIKE %s
                    OR UPPER(COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo)) LIKE %s
                    OR UPPER(TRIM(COALESCE(pc.nombre_condominio, ''))) LIKE %s
                )
            """)
            params.extend([q_like, q_like, q_like, q_like, q_like])

    where_sql = " AND ".join(where)
    modo_busqueda = "CLAVES_EXACTAS" if claves else "FILTROS"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            cur.execute(f"""
                SELECT COUNT(*)::int AS total
                FROM catalogos.padron_2026 p
                LEFT JOIN catastro.v_titularidad_predio tit
                    ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                LEFT JOIN catastro.predio_condominio pc
                    ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                WHERE {where_sql};
            """, params)
            total = int((cur.fetchone() or {}).get("total") or 0)

            cur.execute(f"""
                SELECT
                    p.clave_catastral,
                    UPPER(TRIM(COALESCE(p.condominio, ''))) AS valor_padron,
                    {SQL_TIPO_CONDOMINIO} AS tipo_regimen,
                    COALESCE(tit.nombre_visible, tit.titular_principal, p.nombre_completo) AS nombre_completo,
                    p.colonia,
                    p.calle,
                    p.numof,
                    p.numint,
                    p.valor2026,
                    p.adeudo_total,
                    pc.modalidad,
                    pc.nombre_condominio
                FROM catalogos.padron_2026 p
                LEFT JOIN catastro.v_titularidad_predio tit
                    ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                LEFT JOIN catastro.predio_condominio pc
                    ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
                WHERE {where_sql}
                ORDER BY pc.nombre_condominio NULLS LAST, p.colonia, p.calle, p.numof, p.clave_catastral
                LIMIT %s OFFSET %s;
            """, params + [limite, offset])
            resultados = [_fila_predio_clasificacion_condominio(dict(r)) for r in cur.fetchall()]

            return {
                "total": total,
                "limite": limite,
                "offset": offset,
                "modo_busqueda": modo_busqueda,
                "criterios": {
                    "claves": claves,
                    "nombre_condominio": normalizar_nombre_condominio(payload.nombre_condominio) if not claves else None,
                    "colonia": upper_clean_v28(payload.colonia) if not claves else None,
                    "calle": upper_clean_v28(payload.calle) if not claves else None,
                    "numof": upper_clean_v28(payload.numof) if not claves else None,
                    "clave_prefijo": upper_clean_v28(payload.clave_prefijo) if not claves else None,
                    "q": upper_clean_v28(payload.q) if not claves else None,
                    "solo_regimen_c": payload.solo_regimen_c,
                },
                "resultados": resultados,
            }


@router.put("/condominios/clasificacion/masiva")
def clasificacion_masiva_condominio_v28(
    payload: CondominioClasificacionMasivaPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    claves = parse_lista_claves_condominio_v28(claves=payload.claves)
    if not claves:
        raise HTTPException(status_code=400, detail="Indique al menos una clave catastral.")

    modalidad_flag = payload.modalidad is not None and payload.modalidad not in ("__NO_CAMBIAR__", "NO_CAMBIAR")
    nombre_flag = bool((payload.nombre_condominio or "").strip())
    obs_flag = payload.observaciones is not None
    if not modalidad_flag and not nombre_flag and not obs_flag:
        raise HTTPException(
            status_code=400,
            detail="Indique modalidad, nombre de condominio u observaciones para aplicar."
        )

    modalidad = None
    if modalidad_flag:
        if str(payload.modalidad).strip():
            modalidad = normalizar_modalidad_condominio(payload.modalidad)
        else:
            modalidad = None
    nombre_cond = normalizar_nombre_condominio(payload.nombre_condominio) if nombre_flag else None
    observaciones = (payload.observaciones or "").strip() or None if obs_flag else None

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            asegurar_tabla_predio_condominio(cur, conn)
            cur.execute("""
                SELECT UPPER(TRIM(clave_catastral)) AS clave_catastral
                FROM catalogos.padron_2026
                WHERE UPPER(TRIM(clave_catastral)) = ANY(%s);
            """, (claves,))
            validas = {r["clave_catastral"] for r in cur.fetchall()}
            omitidas = [c for c in claves if c not in validas]
            actualizadas = 0

            for clave in claves:
                if clave not in validas:
                    continue
                upsert_predio_condominio_v28(
                    cur,
                    clave,
                    usuario_actual.get("usuario"),
                    modalidad=modalidad,
                    nombre_condominio=nombre_cond,
                    observaciones=observaciones,
                    set_modalidad=modalidad_flag,
                    set_nombre=nombre_flag,
                    set_observaciones=obs_flag,
                )
                actualizadas += 1

            if modalidad_flag and modalidad in MODALIDADES_CONDOMINIO:
                sincronizar_padron_condominio_v28(cur, [c for c in claves if c in validas], modalidad)

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "CLASIFICAR_CONDOMINIO_MASIVO",
                "COPROPIETARIOS",
                f"Claves={actualizadas} modalidad={'SI' if modalidad_flag else 'NO'} nombre={'SI' if nombre_flag else 'NO'}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "mensaje": f"Clasificación aplicada a {actualizadas} predio(s).",
                "actualizadas": actualizadas,
                "omitidas": omitidas,
                "total_solicitadas": len(claves),
            }


@router.post("/predios/{clave}/propietarios")
def agregar_propietario_predio_v28(
    clave: str,
    payload: PredioPropietarioPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    porcentaje = validar_porcentaje_v28(payload.porcentaje_propiedad)
    tipo_titularidad = upper_clean_v28(payload.tipo_titularidad) or "PROPIETARIO"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id_persona FROM catalogos.personas WHERE id_persona = %s AND COALESCE(activo, TRUE)=TRUE;", (payload.id_persona,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="La persona no existe o está inactiva")

            suma_actual = suma_propiedad_vigente_v28(cur, clave, excluir_id_persona=payload.id_persona)
            suma_nueva = round(suma_actual + porcentaje, 6)
            if suma_nueva > 100.000001:
                raise HTTPException(
                    status_code=400,
                    detail=f"La suma de copropiedad no puede exceder 100%. Suma resultante: {suma_nueva}"
                )

            # Evita duplicar una persona vigente para la misma clave; si ya existe la actualiza.
            cur.execute("""
                SELECT id_predio_propietario
                FROM catastro.predio_propietario
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND id_persona = %s
                  AND vigente = TRUE
                LIMIT 1;
            """, (clave, payload.id_persona))
            existente = cur.fetchone()

            if existente:
                cur.execute("""
                    UPDATE catastro.predio_propietario
                    SET porcentaje_propiedad = %s,
                        tipo_titularidad = %s
                    WHERE id_predio_propietario = %s
                    RETURNING *;
                """, (porcentaje, tipo_titularidad, existente["id_predio_propietario"]))
            else:
                cur.execute("""
                    INSERT INTO catastro.predio_propietario (
                        clave_catastral,
                        id_persona,
                        porcentaje_propiedad,
                        tipo_titularidad,
                        vigente,
                        fecha_inicio
                    )
                    VALUES (%s,%s,%s,%s,TRUE,CURRENT_DATE)
                    RETURNING *;
                """, (clave.upper(), payload.id_persona, porcentaje, tipo_titularidad))

            row = cur.fetchone()
            padron_sync = 0
            if abs(suma_nueva - 100) < 0.000001 or porcentaje >= 99.999999:
                padron_sync = sincronizar_padron_titular_predio_v28(cur, clave)
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "AGREGAR_COPROPIETARIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} id_persona={payload.id_persona} porcentaje={porcentaje} padron_sync={padron_sync}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "mensaje": "Propietario agregado/actualizado en el predio",
                "relacion": row,
                "suma_porcentaje": suma_nueva,
                "valido": abs(suma_nueva - 100) < 0.000001,
                "padron_actualizados": padron_sync,
            }


@router.put("/predios/{clave}/propietarios/{id_persona}")
def actualizar_propietario_predio_v28(
    clave: str,
    id_persona: int,
    payload: PredioPropietarioUpdatePayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    porcentaje = validar_porcentaje_v28(payload.porcentaje_propiedad)
    tipo_titularidad = upper_clean_v28(payload.tipo_titularidad) or "PROPIETARIO"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            suma_actual = suma_propiedad_vigente_v28(cur, clave, excluir_id_persona=id_persona)
            suma_nueva = round(suma_actual + porcentaje, 6)
            if suma_nueva > 100.000001:
                raise HTTPException(
                    status_code=400,
                    detail=f"La suma de copropiedad no puede exceder 100%. Suma resultante: {suma_nueva}"
                )

            cur.execute("""
                UPDATE catastro.predio_propietario
                SET porcentaje_propiedad = %s,
                    tipo_titularidad = %s
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND id_persona = %s
                  AND vigente = TRUE
                RETURNING *;
            """, (porcentaje, tipo_titularidad, clave, id_persona))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Relación propietario-predio no encontrada")

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ACTUALIZAR_COPROPIETARIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} id_persona={id_persona} porcentaje={porcentaje}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "relacion": row,
                "suma_porcentaje": suma_nueva,
                "valido": abs(suma_nueva - 100) < 0.000001
            }


@router.delete("/predios/{clave}/propietarios/{id_persona}")
def quitar_propietario_predio_v28(
    clave: str,
    id_persona: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE catastro.predio_propietario
                SET vigente = FALSE,
                    fecha_fin = CURRENT_DATE
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND id_persona = %s
                  AND vigente = TRUE
                RETURNING *;
            """, (clave, id_persona))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Relación propietario-predio no encontrada")

            suma = suma_propiedad_vigente_v28(cur, clave)
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "QUITAR_COPROPIETARIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} id_persona={id_persona}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "relacion": row,
                "suma_porcentaje": suma,
                "valido": abs(suma - 100) < 0.000001
            }


@router.post("/predios/{clave}/propietarios/sincronizar-padron")
def sincronizar_titular_padron_v28(
    clave: str,
    reemplazar: bool = Query(False),
    request: Request = None,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            titular_padron = obtener_titular_padron_v28(cur, clave)
            if not titular_padron:
                raise HTTPException(status_code=404, detail="El predio no tiene titular registrado en el padrón.")

            id_persona = resolver_persona_por_nombre_padron_v28(cur, titular_padron)
            if not id_persona:
                raise HTTPException(status_code=500, detail="No se pudo crear ni localizar la persona del padrón.")

            cur.execute(f"""
                SELECT
                    pp.id_persona,
                    {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas p ON p.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                  AND pp.vigente = TRUE;
            """, (clave,))
            vigentes = cur.fetchall()

            if vigentes and not reemplazar:
                if any(int(v.get("id_persona") or 0) == id_persona for v in vigentes):
                    conn.commit()
                    return {
                        "ok": True,
                        "mensaje": "El titular del padrón ya está registrado en este predio.",
                        "id_persona": id_persona,
                        "titular_padron": titular_padron,
                        "accion": "sin_cambios"
                    }
                if titular_padron_sincronizado_v28(vigentes, titular_padron):
                    conn.commit()
                    return {
                        "ok": True,
                        "mensaje": "El titular del padrón ya está registrado en este predio.",
                        "id_persona": id_persona,
                        "titular_padron": titular_padron,
                        "accion": "sin_cambios"
                    }
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"El predio ya tiene titulares registrados y difieren del padrón ({titular_padron}). "
                        "Use reemplazar=true para aplicar el titular del padrón al 100%."
                    )
                )

            if reemplazar and vigentes:
                cur.execute("""
                    UPDATE catastro.predio_propietario
                    SET vigente = FALSE, fecha_fin = CURRENT_DATE
                    WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                      AND vigente = TRUE;
                """, (clave,))

            cur.execute("""
                INSERT INTO catastro.predio_propietario (
                    clave_catastral, id_persona, porcentaje_propiedad,
                    tipo_titularidad, vigente, fecha_inicio
                ) VALUES (%s, %s, %s, 'PROPIETARIO', TRUE, CURRENT_DATE)
                RETURNING *;
            """, (clave.upper(), id_persona, 100))
            relacion = cur.fetchone()
            padron_sync = sincronizar_padron_titular_predio_v28(cur, clave)

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "SINCRONIZAR_TITULAR_PADRON",
                "PROPIETARIOS",
                f"Titular del padrón aplicado a {clave.upper()}: {titular_padron} padron_sync={padron_sync}",
                request.client.host if request and request.client else None
            )
            conn.commit()

            return {
                "ok": True,
                "mensaje": "Titular del padrón aplicado correctamente.",
                "id_persona": id_persona,
                "titular_padron": titular_padron,
                "accion": "reemplazado" if reemplazar else "agregado",
                "relacion": relacion,
                "padron_actualizados": padron_sync,
            }


_SQL_PENDIENTES_TITULAR_PADRON = """
    FROM catalogos.padron_2026 p
    WHERE NULLIF(TRIM(p.nombre_completo), '') IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM catastro.predio_propietario pp
          WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
            AND pp.vigente = TRUE
      )
"""


@router.post("/predios/propietarios/sincronizar-padron-masivo")
def sincronizar_titular_padron_masivo_v28(
    confirmar: bool = Query(False),
    limite: int = Query(1500, ge=1, le=20000),
    request: Request = None,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    """Aplica el titular del padrón a los predios que tienen nombre en el padrón fiscal
    pero AÚN no tienen propietario vigente en el catálogo.

    - confirmar=false  -> vista previa (cuántos predios en total y una muestra).
    - confirmar=true   -> procesa UN lote (hasta `limite`) y los crea al 100% como PROPIETARIO.

    El frontend llama repetidamente con confirmar=true hasta que `hay_mas` sea false.
    Lotes chicos para que cada petición HTTP termine antes del timeout del proxy.
    Es idempotente: solo toca predios SIN titular vigente."""
    try:
      with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if not confirmar:
                # Índice funcional que acelera el NOT EXISTS (evita seq scan por fila al crecer
                # predio_propietario). Idempotente: si ya existe, no hace nada.
                try:
                    cur.execute("""
                        CREATE INDEX IF NOT EXISTS idx_pp_clave_upper_vigente
                        ON catastro.predio_propietario (UPPER(TRIM(clave_catastral)))
                        WHERE vigente = TRUE;
                    """)
                    conn.commit()
                except Exception:
                    conn.rollback()

                # El COUNT total solo se calcula en la vista previa (una vez), no en cada lote.
                cur.execute(f"SELECT COUNT(*)::int AS total {_SQL_PENDIENTES_TITULAR_PADRON};")
                total_pendientes = int((cur.fetchone() or {}).get("total") or 0)

                if total_pendientes <= 0:
                    return {
                        "ok": True, "preview": True, "pendientes": 0, "aplicados": 0,
                        "mensaje": "No hay predios pendientes: todos los predios con titular en el padrón ya tienen propietario en el catálogo."
                    }

                cur.execute(f"""
                    SELECT UPPER(TRIM(p.clave_catastral)) AS clave_catastral,
                           UPPER(TRIM(p.nombre_completo)) AS titular_padron
                    {_SQL_PENDIENTES_TITULAR_PADRON}
                    ORDER BY p.clave_catastral
                    LIMIT 12;
                """)
                muestra = [dict(r) for r in cur.fetchall()]
                return {
                    "ok": True,
                    "preview": True,
                    "pendientes": total_pendientes,
                    "limite": limite,
                    "muestra": muestra,
                    "mensaje": f"{total_pendientes} predio(s) tienen titular en el padrón sin propietario en el catálogo."
                }

            # --- Aplicación de UN lote (rápido, sin COUNT global) ---
            cur.execute(f"""
                SELECT UPPER(TRIM(p.clave_catastral)) AS clave,
                       UPPER(TRIM(p.nombre_completo)) AS nombre
                {_SQL_PENDIENTES_TITULAR_PADRON}
                ORDER BY p.clave_catastral
                LIMIT %s;
            """, (limite,))
            lote = cur.fetchall()
            lote_size = len(lote)

            if lote_size == 0:
                return {
                    "ok": True, "preview": False, "aplicados": 0,
                    "lote": 0, "hay_mas": False,
                    "mensaje": "No quedan predios pendientes."
                }

            # Agrupar por nombre para crear/localizar la persona UNA sola vez.
            claves_por_nombre = {}
            for r in lote:
                nombre = (r.get("nombre") or "").strip()
                clave = (r.get("clave") or "").strip()
                if nombre and clave:
                    claves_por_nombre.setdefault(nombre, []).append(clave)

            aplicados = 0
            personas = 0
            sin_resolver = 0
            for nombre, claves in claves_por_nombre.items():
                # SAVEPOINT por titular: si un nombre falla (p. ej. choca con una
                # restricción única por un registro no vigente previo), se revierte
                # SOLO ese nombre y el lote sigue avanzando, en vez de abortar todo.
                try:
                    cur.execute("SAVEPOINT sp_titular;")
                    id_persona = resolver_persona_por_nombre_padron_v28(cur, nombre)
                    if not id_persona:
                        sin_resolver += len(claves)
                        cur.execute("RELEASE SAVEPOINT sp_titular;")
                        continue
                    personas += 1
                    cur.execute("""
                        INSERT INTO catastro.predio_propietario (
                            clave_catastral, id_persona, porcentaje_propiedad,
                            tipo_titularidad, vigente, fecha_inicio
                        )
                        SELECT UNNEST(%s::text[]), %s, 100, 'PROPIETARIO', TRUE, CURRENT_DATE
                        ON CONFLICT DO NOTHING;
                    """, (claves, id_persona))
                    aplicados += cur.rowcount or 0
                    cur.execute("RELEASE SAVEPOINT sp_titular;")
                except Exception:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_titular;")
                    sin_resolver += len(claves)

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "SINCRONIZAR_TITULAR_PADRON_MASIVO",
                "PROPIETARIOS",
                f"Lote titular padrón: lote={lote_size} aplicados={aplicados} personas={personas} sin_resolver={sin_resolver}",
                request.client.host if request and request.client else None
            )
            conn.commit()

            # Si el lote se llenó (== limite) es muy probable que haya más pendientes.
            hay_mas = lote_size >= limite
            return {
                "ok": True,
                "preview": False,
                "aplicados": aplicados,
                "personas": personas,
                "sin_resolver": sin_resolver,
                "lote": lote_size,
                "hay_mas": hay_mas,
                "mensaje": f"Lote aplicado: {aplicados} predio(s)."
            }
    except HTTPException:
        raise
    except Exception as e:
        # Devuelve el detalle real del error para diagnosticar desde el navegador.
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.post("/predios/{clave}/propietarios/reemplazar")
def reemplazar_propietarios_predio_v28(
    clave: str,
    payload: PredioPropietariosReemplazoPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    propietarios = payload.propietarios or []
    if not propietarios:
        raise HTTPException(status_code=400, detail="Debe incluir al menos un propietario")

    ids = [p.id_persona for p in propietarios]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="No puede repetir el mismo propietario")

    suma = round(sum(validar_porcentaje_v28(p.porcentaje_propiedad) for p in propietarios), 6)
    if abs(suma - 100) > 0.000001:
        raise HTTPException(
            status_code=400,
            detail=f"La suma de copropiedad debe ser exactamente 100%. Suma actual: {suma}"
        )

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id_persona FROM catalogos.personas WHERE id_persona = ANY(%s) AND COALESCE(activo, TRUE)=TRUE;", (ids,))
            existentes = {r["id_persona"] for r in cur.fetchall()}
            faltantes = [i for i in ids if i not in existentes]
            if faltantes:
                raise HTTPException(status_code=404, detail=f"Personas no encontradas o inactivas: {faltantes}")

            cur.execute("""
                UPDATE catastro.predio_propietario
                SET vigente = FALSE,
                    fecha_fin = CURRENT_DATE
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND vigente = TRUE;
            """, (clave,))

            insertados = []
            for p in propietarios:
                cur.execute("""
                    INSERT INTO catastro.predio_propietario (
                        clave_catastral,
                        id_persona,
                        porcentaje_propiedad,
                        tipo_titularidad,
                        vigente,
                        fecha_inicio
                    )
                    VALUES (%s,%s,%s,%s,TRUE,CURRENT_DATE)
                    RETURNING *;
                """, (
                    clave.upper(),
                    p.id_persona,
                    validar_porcentaje_v28(p.porcentaje_propiedad),
                    upper_clean_v28(p.tipo_titularidad) or "PROPIETARIO"
                ))
                insertados.append(cur.fetchone())

            padron_sync = sincronizar_padron_titular_predio_v28(cur, clave)

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "REEMPLAZAR_TITULARIDAD_PREDIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} titulares={len(insertados)} suma={suma} padron_sync={padron_sync}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "mensaje": "Titularidad reemplazada correctamente",
                "clave_catastral": clave.upper(),
                "suma_porcentaje": suma,
                "valido": True,
                "propietarios": insertados,
                "padron_actualizados": padron_sync,
            }