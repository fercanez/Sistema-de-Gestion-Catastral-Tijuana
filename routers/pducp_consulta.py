"""Consulta PDUCP Mexicali 2040: distrito, densidades y compatibilidad por predio."""
from __future__ import annotations

from typing import Any, Optional

try:
    from database import get_geonode_conn
except ImportError:
    get_geonode_conn = None


PDUCP_SECTOR_NOMBRES = {
    "A": "Santorales",
    "B": "Nacionalista-Orizaba",
    "C": "Central",
    "D": "Independencia-Alamitos",
    "E": "Cetys-Tecnologico",
    "F": "Abasolo",
    "G": "Progreso",
    "H": "Portales",
    "I": "Anahuac-Villas del Rey",
    "J": "Lagunas",
    "K": "Campestre",
    "L": "Palaco",
    "M": "Nuevo Mexicali",
    "N": "Pueblas",
    "O": "Condesa",
    "P": "Reservas Integrales de Ocupacion Condicionada",
}

COMPATIBILIDAD_ETIQUETA = {
    "C": "Compatible",
    "COND": "Condicionada",
    "NP": "No permitida",
}

MAPA_USO_PADRON_COMPAT = (
    (("HABIT", "VIVIEND", "RESIDEN", "CASA", "DEPART"), "Habitacional", "1.1.1"),
    (("COMER", "COMERC", "VENTA", "TIEND", "ABARRO"), "Comercio y servicios", None),
    (("INDUST", "BODEGA", "TALLER", "FABRIC"), "Industrial", None),
    (("SERVIC", "OFICIN", "CONSULT", "CLINIC"), "Comercio y servicios", None),
    (("EQUIP", "ESCUEL", "IGLES", "SALUD"), "Equipamiento", None),
    (("AGRIC", "AGRI", "RUSTIC", "EJID", "GANAD"), "Agrícola", None),
)


def _tabla_existe(cur, esquema: str, tabla: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = %s
          AND table_name = %s
        LIMIT 1;
        """,
        (esquema, tabla),
    )
    return cur.fetchone() is not None


def _vista_existe(cur, esquema: str, vista: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.views
        WHERE table_schema = %s
          AND table_name = %s
        LIMIT 1;
        """,
        (esquema, vista),
    )
    return cur.fetchone() is not None


def _sector_nombre(codigo: str) -> str:
    letra = str(codigo or "").strip().upper()[:1]
    return PDUCP_SECTOR_NOMBRES.get(letra, "")


def _formato_densidad(codigo: str, vmin, vmax) -> str:
    cod = str(codigo or "").strip()
    if not cod and vmin is None and vmax is None:
        return ""
    rango = ""
    if vmin is not None and vmax is not None:
        rango = f"{int(vmin)}-{int(vmax)}"
    elif vmin is not None:
        rango = str(int(vmin))
    partes = [p for p in [cod.upper() if cod else "", f"{rango} viv/ha" if rango else ""] if p]
    return " ".join(partes)


def _formato_cos_cus(cos_rango: str, cus_rango: str) -> str:
    partes = []
    if str(cos_rango or "").strip():
        partes.append(f"COS {cos_rango}")
    if str(cus_rango or "").strip():
        partes.append(f"CUS {cus_rango}")
    return " · ".join(partes)


def _inferir_grupo_compatibilidad(uso_padron: str) -> tuple[str, Optional[str]]:
    texto = str(uso_padron or "").upper()
    for tokens, grupo, codigo in MAPA_USO_PADRON_COMPAT:
        if any(tok in texto for tok in tokens):
            return grupo, codigo
    return "", None


def _consultar_distrito_geonode(clave: str) -> Optional[dict]:
    if get_geonode_conn is None:
        return None
    try:
        conn = get_geonode_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                UPPER(TRIM(p.clavecatas)) AS clave_catastral,
                substring(d.distrito from 1 for 1) AS sector_pducp,
                TRIM(d.distrito) AS distrito,
                TRIM(COALESCE(d.fuente, '')) AS fuente_distrito
            FROM public.predios_mexicali p
            JOIN public.diatritos_pdupm d
              ON ST_Covers(d.geom, ST_PointOnSurface(p.geom))
            WHERE UPPER(TRIM(p.clavecatas)) = UPPER(TRIM(%s))
            LIMIT 1;
            """,
            (clave,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        return dict(row) if row else None
    except Exception:
        return None


def _consultar_distrito_fdw(cur, clave: str) -> Optional[dict]:
    for esquema, predios, distritos in (
        ("fdw_geonode", "predios_mexicali", "diatritos_pdupm"),
        ("geonode_fdw", "predios_mexicali", "diatritos_pdupm"),
    ):
        if not (_tabla_existe(cur, esquema, predios) and _tabla_existe(cur, esquema, distritos)):
            continue
        try:
            cur.execute(
                f"""
                SELECT
                    UPPER(TRIM(p.clavecatas)) AS clave_catastral,
                    substring(d.distrito from 1 for 1) AS sector_pducp,
                    TRIM(d.distrito) AS distrito,
                    TRIM(COALESCE(d.fuente, '')) AS fuente_distrito
                FROM {esquema}.{predios} p
                JOIN {esquema}.{distritos} d
                  ON ST_Covers(d.geom, ST_PointOnSurface(p.geom))
                WHERE UPPER(TRIM(p.clavecatas)) = UPPER(TRIM(%s))
                LIMIT 1;
                """,
                (clave,),
            )
            row = cur.fetchone()
            if row:
                data = dict(row)
                data["origen_distrito"] = f"fdw:{esquema}"
                return data
        except Exception:
            continue
    return None


def _consultar_densidades(cur, distrito: str) -> Optional[dict]:
    if not distrito or not _tabla_existe(cur, "pducp", "densidades_distrito"):
        return None
    cur.execute(
        """
        SELECT
            distrito,
            sector,
            sector_nombre,
            cos_rango,
            cos_min,
            cos_max,
            cus_rango,
            cus_min,
            cus_max,
            cos,
            cus,
            densidad_unifamiliar_codigo,
            densidad_unifamiliar_min,
            densidad_unifamiliar_max,
            densidad_multifamiliar_codigo,
            densidad_multifamiliar_min,
            densidad_multifamiliar_max,
            fuente,
            nota
        FROM pducp.densidades_distrito
        WHERE UPPER(TRIM(distrito)) = UPPER(TRIM(%s))
        LIMIT 1;
        """,
        (distrito,),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def _consultar_compatibilidad_padron(cur, distrito: str, uso_padron: str) -> Optional[dict]:
    if not distrito or not _tabla_existe(cur, "pducp", "matriz_compatibilidad"):
        return None

    grupo, codigo = _inferir_grupo_compatibilidad(uso_padron)
    if not grupo:
        return None

    if codigo:
        cur.execute(
            """
            SELECT
                uso_grupo,
                codigo_actividad,
                actividad,
                compatibilidad,
                compatibilidad_desc,
                confianza_color,
                nota
            FROM pducp.matriz_compatibilidad
            WHERE UPPER(TRIM(distrito)) = UPPER(TRIM(%s))
              AND UPPER(TRIM(uso_grupo)) = UPPER(TRIM(%s))
              AND TRIM(codigo_actividad) = %s
            LIMIT 1;
            """,
            (distrito, grupo, codigo),
        )
    else:
        cur.execute(
            """
            SELECT
                uso_grupo,
                codigo_actividad,
                actividad,
                compatibilidad,
                compatibilidad_desc,
                confianza_color,
                nota
            FROM pducp.matriz_compatibilidad
            WHERE UPPER(TRIM(distrito)) = UPPER(TRIM(%s))
              AND UPPER(TRIM(uso_grupo)) = UPPER(TRIM(%s))
              AND NULLIF(TRIM(compatibilidad), '') IS NOT NULL
            ORDER BY codigo_actividad
            LIMIT 1;
            """,
            (distrito, grupo),
        )

    row = cur.fetchone()
    if not row:
        return None

    compat = dict(row)
    cod = str(compat.get("compatibilidad") or "").strip().upper()
    compat["resultado"] = COMPATIBILIDAD_ETIQUETA.get(cod, "Revisar")
    return compat


def _consultar_matriz_compatibilidad_distrito(cur, distrito: str, limite: int = 32) -> dict[str, Any]:
    """Resumen de actividades por compatibilidad para un distrito PDUCP."""
    if not distrito or not _tabla_existe(cur, "pducp", "matriz_compatibilidad"):
        return {"disponible": False, "distrito": distrito or ""}

    cur.execute(
        """
        SELECT
            TRIM(codigo_actividad) AS codigo_actividad,
            TRIM(actividad) AS actividad,
            TRIM(uso_grupo) AS uso_grupo,
            UPPER(TRIM(compatibilidad)) AS compatibilidad,
            TRIM(compatibilidad_desc) AS compatibilidad_desc
        FROM pducp.matriz_compatibilidad
        WHERE UPPER(TRIM(distrito)) = UPPER(TRIM(%s))
          AND NULLIF(TRIM(compatibilidad), '') IS NOT NULL
          AND NULLIF(TRIM(codigo_actividad), '') IS NOT NULL
        ORDER BY uso_grupo, codigo_actividad, actividad;
        """,
        (distrito,),
    )
    rows = cur.fetchall() or []
    if not rows:
        return {"disponible": False, "distrito": distrito}

    buckets: dict[str, list[dict[str, str]]] = {
        "compatible": [],
        "condicionada": [],
        "no_permitida": [],
    }
    totales = {"compatible": 0, "condicionada": 0, "no_permitida": 0}
    vistos: dict[str, set[str]] = {
        "compatible": set(),
        "condicionada": set(),
        "no_permitida": set(),
    }

    for row in rows:
        item = dict(row)
        cod = str(item.get("compatibilidad") or "").strip().upper()
        clave = str(item.get("codigo_actividad") or "").strip()
        if cod == "C":
            bucket = "compatible"
        elif cod == "COND":
            bucket = "condicionada"
        elif cod == "NP":
            bucket = "no_permitida"
        else:
            continue
        totales[bucket] += 1
        if clave in vistos[bucket]:
            continue
        vistos[bucket].add(clave)
        if len(buckets[bucket]) >= limite:
            continue
        buckets[bucket].append({
            "codigo": clave,
            "actividad": str(item.get("actividad") or "").strip(),
            "grupo": str(item.get("uso_grupo") or "").strip(),
            "compatibilidad": cod,
            "desc": str(item.get("compatibilidad_desc") or COMPATIBILIDAD_ETIQUETA.get(cod, "")).strip(),
        })

    return {
        "disponible": True,
        "distrito": distrito,
        "totales": totales,
        "compatible": buckets["compatible"],
        "condicionada": buckets["condicionada"],
        "no_permitida": buckets["no_permitida"],
    }


def consultar_pducp_predio(cur, clave: str, uso_padron: str = "") -> dict[str, Any]:
    """Resumen PDUCP para enriquecer la pestaña Carta Urbana 2040."""
    clave_norm = str(clave or "").strip().upper()
    if not clave_norm:
        return {"disponible": False, "mensaje": "Clave catastral requerida."}

    distrito_info = _consultar_distrito_fdw(cur, clave_norm)
    origen_distrito = (distrito_info or {}).get("origen_distrito", "")

    if not distrito_info:
        distrito_info = _consultar_distrito_geonode(clave_norm)
        if distrito_info:
            origen_distrito = "geonode_data"

    if not distrito_info or not distrito_info.get("distrito"):
        return {
            "disponible": False,
            "clave_catastral": clave_norm,
            "mensaje": (
                "Sin cruce espacial con distritos PDUCP. "
                "Verifique capa diatritos_pdupm o FDW en catastro_bc."
            ),
        }

    distrito = str(distrito_info["distrito"]).strip()
    sector = str(distrito_info.get("sector_pducp") or distrito[:1]).strip().upper()
    sector_nombre = _sector_nombre(sector)
    dens = _consultar_densidades(cur, distrito) or {}
    if not sector_nombre and dens.get("sector_nombre"):
        sector_nombre = str(dens["sector_nombre"]).strip()

    compat = _consultar_compatibilidad_padron(cur, distrito, uso_padron)
    matriz = _consultar_matriz_compatibilidad_distrito(cur, distrito)

    dens_uni = _formato_densidad(
        dens.get("densidad_unifamiliar_codigo"),
        dens.get("densidad_unifamiliar_min"),
        dens.get("densidad_unifamiliar_max"),
    )
    dens_multi = _formato_densidad(
        dens.get("densidad_multifamiliar_codigo"),
        dens.get("densidad_multifamiliar_min"),
        dens.get("densidad_multifamiliar_max"),
    )
    densidad_txt = " · ".join([p for p in [dens_uni, dens_multi] if p])
    cos_cus = _formato_cos_cus(dens.get("cos_rango"), dens.get("cus_rango"))

    obs_partes = []
    if compat:
        obs_partes.append(
            f"Compatibilidad preliminar uso padrón ({compat.get('actividad') or compat.get('uso_grupo')}): "
            f"{compat.get('resultado') or compat.get('compatibilidad_desc') or compat.get('compatibilidad')}."
        )
        conf = compat.get("confianza_color")
        if conf is not None and int(conf) < 80:
            obs_partes.append(f"Confianza matriz PDF: {conf}%. Revisar antes de dictamen formal.")
        if compat.get("nota"):
            obs_partes.append(str(compat["nota"]))
    if dens.get("nota"):
        obs_partes.append(str(dens["nota"]))
    obs_partes.append("Consulta preliminar derivada del PDUCP Mexicali 2040.")

    nombre_zona = f"{sector_nombre} · Distrito {distrito}" if sector_nombre else f"Distrito {distrito}"

    return {
        "disponible": True,
        "clave_catastral": clave_norm,
        "sector_pducp": sector,
        "sector_nombre": sector_nombre,
        "distrito": distrito,
        "fuente_distrito": distrito_info.get("fuente_distrito") or origen_distrito,
        "origen_distrito": origen_distrito or "geonode_data",
        "cos_rango": dens.get("cos_rango") or "",
        "cus_rango": dens.get("cus_rango") or "",
        "cos_min": dens.get("cos_min"),
        "cos_max": dens.get("cos_max"),
        "cus_min": dens.get("cus_min"),
        "cus_max": dens.get("cus_max"),
        "densidad_unifamiliar": dens_uni,
        "densidad_multifamiliar": dens_multi,
        "densidad_texto": densidad_txt,
        "cos_cus_texto": cos_cus,
        "compatibilidad_padron": compat,
        "matriz_compatibilidad": matriz,
        "instrumento": "PDUCP Mexicali 2040",
        "campos_ui": {
            "zona_clave": distrito,
            "nombre_zona": nombre_zona,
            "densidad": densidad_txt,
            "nivel_altura": cos_cus,
            "instrumento": "PDUCP Mexicali 2040",
            "observaciones": " ".join(obs_partes).strip(),
        },
    }
