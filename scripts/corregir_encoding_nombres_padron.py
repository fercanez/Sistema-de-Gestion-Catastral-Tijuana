#!/usr/bin/env python3
"""
Detecta y corrige caracteres corruptos en nombres del padrón (ej. IBA?EZ → IBAÑEZ).

Uso en servidor (venv de la API):

  ./venv/bin/python3 scripts/corregir_encoding_nombres_padron.py
  ./venv/bin/python3 scripts/corregir_encoding_nombres_padron.py --ejemplos 30
  ./venv/bin/python3 scripts/corregir_encoding_nombres_padron.py --desde-staging --aplicar
  ./venv/bin/python3 scripts/corregir_encoding_nombres_padron.py --solo-personas --ejemplos 30
  ./venv/bin/python3 scripts/corregir_encoding_nombres_padron.py --solo-personas --aplicar --limite 10000
  ./venv/bin/python3 scripts/corregir_encoding_nombres_padron.py --aplicar --sync-padron

Por defecto solo detecta (no modifica). Use --aplicar para escribir cambios.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from database import columnas_tabla, get_conn  # noqa: E402

# Columnas de texto típicas en padrón / personas (se filtran a las que existan).
COLUMNAS_PADRON_PRIORITARIAS = (
    "pnombre",
    "paterno",
    "materno",
    "nombre_completo",
    "razon_social",
    "colonia",
    "calle",
    "nom_condominio",
    "delegacion",
    "descripcion_uso",
)
COLUMNAS_PERSONAS_NOMBRE = (
    "nombre",
    "apellido_paterno",
    "apellido_materno",
    "razon_social",
)
COLUMNAS_PERSONAS_PRIORITARIAS = COLUMNAS_PERSONAS_NOMBRE + (
    "nombre_completo",
    "domicilio",
)

PATRONES_SOSPECHOSOS = (
    ("interrogacion", re.compile(r"\?")),
    ("replacement_char", re.compile(r"\ufffd", re.IGNORECASE)),
    ("mojibake_a", re.compile(r"Ã.")),
    ("n_tilde_ascii", re.compile(r"N~|n~")),
)

MAPEO_MOJIBAKE_DIRECTO = {
    "Ã±": "ñ",
    "Ã\x91": "Ñ",
    "Ã\x81": "Á",
    "Ã\x89": "É",
    "Ã\x8d": "Í",
    "Ã\x93": "Ó",
    "Ã\x9a": "Ú",
    "Ã¼": "ü",
    "Ã\x9c": "Ü",
    "Ã¡": "á",
    "Ã©": "é",
    "Ã­": "í",
    "Ã³": "ó",
    "Ãº": "ú",
}


def _es_texto(valor: Any) -> bool:
    return isinstance(valor, str) and valor.strip() != ""


def texto_tiene_problema(texto: str) -> bool:
    if not _es_texto(texto):
        return False
    for _, rx in PATRONES_SOSPECHOSOS:
        if rx.search(texto):
            return True
    return False


def fix_mojibake(texto: str) -> str:
    if not _es_texto(texto) or "Ã" not in texto:
        return texto
    out = texto
    for malo, bueno in MAPEO_MOJIBAKE_DIRECTO.items():
        out = out.replace(malo, bueno)
    if "Ã" not in out:
        return out
    for encoding in ("cp1252", "latin1"):
        try:
            candidato = out.encode(encoding).decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            continue
        if candidato.count("Ã") < out.count("Ã") and "\ufffd" not in candidato:
            return candidato
    return out


def fix_interrogacion_en_palabra(texto: str) -> str:
    """? o U+FFFD entre letras → Ñ (caso IBA?EZ, MU?OZ)."""
    if not _es_texto(texto):
        return texto
    out = texto
    out = re.sub(
        r"(?<=[A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\?(?=[A-Za-zÁÉÍÓÚÜáéíóúüÑñ])",
        "Ñ",
        out,
    )
    out = re.sub(
        r"(?<=[A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\ufffd(?=[A-Za-zÁÉÍÓÚÜáéíóúüÑñ])",
        "Ñ",
        out,
        flags=re.IGNORECASE,
    )
    out = out.replace("N~", "Ñ").replace("n~", "ñ")
    return out


def corregir_texto(texto: str) -> str:
    if not _es_texto(texto):
        return texto
    out = fix_mojibake(texto)
    out = fix_interrogacion_en_palabra(out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def _condiciones_texto_corrupto(columnas: list[str], alias: str = "") -> list[str]:
    """Condiciones SQL sin % (evita conflicto con placeholders de psycopg2)."""
    pref = f'{alias}.' if alias else ""
    condiciones: list[str] = []
    for col in columnas:
        c = f'{pref}"{col}"'
        condiciones.append(f"POSITION('?' IN {c}) > 0")
        condiciones.append(f"POSITION('Ã' IN {c}) > 0")
        condiciones.append(f"POSITION(U&'\\FFFD' IN {c}) > 0")
    return condiciones


def columnas_disponibles(cur, esquema: str, tabla: str, preferidas: tuple[str, ...]) -> list[str]:
    cols = columnas_tabla(cur, esquema, tabla)
    return [c for c in preferidas if c in cols]


def contar_sospechosos(cur, esquema: str, tabla: str, columnas: list[str]) -> dict[str, int]:
    if not columnas:
        return {}
    partes = _condiciones_texto_corrupto(columnas)
    sql = f"""
        SELECT COUNT(*) AS total
        FROM {esquema}.{tabla}
        WHERE {" OR ".join(partes)};
    """
    cur.execute(sql)
    row = cur.fetchone() or {}
    return {"filas_con_problema": int(row.get("total") or 0)}


def contar_personas_por_columna(cur) -> dict[str, int]:
    """Desglose de ? por columna en catalogos.personas."""
    cols = columnas_disponibles(cur, "catalogos", "personas", COLUMNAS_PERSONAS_NOMBRE)
    resultado: dict[str, int] = {}
    for col in cols:
        cur.execute(
            f"""
            SELECT COUNT(*) AS total
            FROM catalogos.personas
            WHERE POSITION('?' IN "{col}") > 0
               OR POSITION('Ã' IN "{col}") > 0;
            """
        )
        resultado[col] = int((cur.fetchone() or {}).get("total") or 0)
    return resultado


def sincronizar_padron_desde_personas(
    cur,
    *,
    ids_persona: list[int] | None = None,
    limite: int | None = None,
    dry_run: bool = True,
    todos: bool = False,
) -> dict[str, int]:
    """Propaga nombre/apellidos corregidos de personas → padron_2026.nombre_completo."""
    from routers.propietarios import sincronizar_padron_nombre_persona_v28

    pp_cols = columnas_tabla(cur, "catastro", "predio_propietario")
    if "id_persona" not in pp_cols or "clave_catastral" not in pp_cols:
        return {"personas": 0, "filas_padron": 0}

    vigente_sql = "AND pp.vigente = TRUE" if "vigente" in pp_cols else ""

    if ids_persona:
        sql = f"""
            SELECT DISTINCT pp.id_persona
            FROM catastro.predio_propietario pp
            WHERE pp.id_persona = ANY(%s)
              {vigente_sql}
              AND NULLIF(TRIM(pp.clave_catastral), '') IS NOT NULL;
        """
        cur.execute(sql, (ids_persona,))
    elif todos:
        sql = f"""
            SELECT DISTINCT pp.id_persona
            FROM catastro.predio_propietario pp
            WHERE NULLIF(TRIM(pp.clave_catastral), '') IS NOT NULL
              {vigente_sql}
            ORDER BY pp.id_persona
        """
        if limite:
            sql += f" LIMIT {int(limite)}"
        cur.execute(sql)
    else:
        sql = f"""
            SELECT DISTINCT pp.id_persona
            FROM catastro.predio_propietario pp
            INNER JOIN catalogos.personas p ON p.id_persona = pp.id_persona
            WHERE NULLIF(TRIM(pp.clave_catastral), '') IS NOT NULL
              {vigente_sql}
              AND (
                  POSITION('?' IN COALESCE(p.nombre, '')) > 0
                  OR POSITION('?' IN COALESCE(p.apellido_paterno, '')) > 0
                  OR POSITION('?' IN COALESCE(p.apellido_materno, '')) > 0
                  OR POSITION('?' IN COALESCE(p.razon_social, '')) > 0
                  OR POSITION('Ã' IN COALESCE(p.nombre, '')) > 0
                  OR POSITION('Ã' IN COALESCE(p.apellido_paterno, '')) > 0
                  OR POSITION('Ã' IN COALESCE(p.apellido_materno, '')) > 0
              )
            ORDER BY pp.id_persona
        """
        if limite:
            sql += f" LIMIT {int(limite)}"
        cur.execute(sql)

    ids = [int(r["id_persona"]) for r in (cur.fetchall() or []) if r.get("id_persona")]
    filas_padron = 0
    for id_persona in ids:
        if dry_run:
            cur.execute(
                f"""
                SELECT COUNT(DISTINCT UPPER(TRIM(pp.clave_catastral))) AS n
                FROM catastro.predio_propietario pp
                WHERE pp.id_persona = %s
                  {vigente_sql}
                  AND NULLIF(TRIM(pp.clave_catastral), '') IS NOT NULL;
                """,
                (id_persona,),
            )
            filas_padron += int((cur.fetchone() or {}).get("n") or 0)
        else:
            filas_padron += int(sincronizar_padron_nombre_persona_v28(cur, id_persona) or 0)

    return {"personas": len(ids), "filas_padron": filas_padron}


def ejemplos_sospechosos(
    cur,
    esquema: str,
    tabla: str,
    columnas: list[str],
    limite: int = 20,
) -> list[dict[str, Any]]:
    if not columnas:
        return []
    pk = "clave_catastral" if "clave_catastral" in columnas_tabla(cur, esquema, tabla) else "id"
    if pk not in columnas_tabla(cur, esquema, tabla):
        pk = columnas[0]

    selects = ", ".join(f'"{c}"' for c in columnas)
    condiciones = _condiciones_texto_corrupto(columnas)
    sql = f"""
        SELECT "{pk}" AS pk, {selects}
        FROM {esquema}.{tabla}
        WHERE {" OR ".join(condiciones)}
        LIMIT {int(limite)};
    """
    cur.execute(sql)
    return list(cur.fetchall() or [])


def aplicar_correccion_tabla(
    cur,
    esquema: str,
    tabla: str,
    columnas: list[str],
    *,
    limite: int | None = None,
    dry_run: bool = True,
) -> dict[str, int]:
    if not columnas:
        return {"filas_evaluadas": 0, "filas_actualizadas": 0, "celdas_corregidas": 0}

    pk_cols = columnas_tabla(cur, esquema, tabla)
    if "clave_catastral" in pk_cols:
        pk = "clave_catastral"
    elif "id" in pk_cols:
        pk = "id"
    elif "id_persona" in pk_cols:
        pk = "id_persona"
    else:
        raise RuntimeError(f"No se encontró PK para {esquema}.{tabla}")

    condiciones = _condiciones_texto_corrupto(columnas)

    sql_select = f"""
        SELECT "{pk}" AS pk, {", ".join(f'"{c}"' for c in columnas)}
        FROM {esquema}.{tabla}
        WHERE {" OR ".join(condiciones)}
    """
    if limite:
        sql_select += f" LIMIT {int(limite)}"

    cur.execute(sql_select)
    filas = list(cur.fetchall() or [])

    filas_actualizadas = 0
    celdas_corregidas = 0

    for row in filas:
        pk_val = row["pk"]
        sets: list[str] = []
        params: list[Any] = []
        cambios = 0
        for col in columnas:
            original = row.get(col)
            if not _es_texto(original):
                continue
            corregido = corregir_texto(original)
            if corregido != original:
                sets.append(f'"{col}" = %s')
                params.append(corregido)
                cambios += 1
        if not sets:
            continue
        celdas_corregidas += cambios
        if dry_run:
            filas_actualizadas += 1
            continue
        sql_up = f"""
            UPDATE {esquema}.{tabla}
            SET {", ".join(sets)}
            WHERE "{pk}" = %s;
        """
        cur.execute(sql_up, (*params, pk_val))
        filas_actualizadas += 1

    return {
        "filas_evaluadas": len(filas),
        "filas_actualizadas": filas_actualizadas,
        "celdas_corregidas": celdas_corregidas,
    }


def sincronizar_desde_staging(
    cur,
    *,
    limite: int | None = None,
    dry_run: bool = True,
) -> dict[str, int]:
    """Copia columnas limpias desde staging.padron_tijuana cuando el padrón tiene ?."""
    staging_cols = columnas_tabla(cur, "staging", "padron_tijuana")
    padron_cols = columnas_tabla(cur, "catalogos", "padron_2026")
    if not staging_cols:
        return {"filas_actualizadas": 0, "origen": "sin_staging"}

    mapeo = [c for c in COLUMNAS_PADRON_PRIORITARIAS if c in staging_cols and c in padron_cols]
    if not mapeo:
        return {"filas_actualizadas": 0, "origen": "sin_columnas_comunes"}

    sets = []
    condiciones_mejora = []
    for col in mapeo:
        sets.append(f'p."{col}" = s."{col}"')
        condiciones_mejora.append(
            f"(POSITION('?' IN p.\"{col}\") > 0 "
            f"AND s.\"{col}\" IS NOT NULL "
            f"AND POSITION('?' IN s.\"{col}\") = 0)"
        )

    sql_count = f"""
        SELECT COUNT(*) AS total
        FROM catalogos.padron_2026 p
        INNER JOIN staging.padron_tijuana s
            ON UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(s.clave_catastral))
        WHERE {" OR ".join(condiciones_mejora)};
    """
    cur.execute(sql_count)
    total = int((cur.fetchone() or {}).get("total") or 0)
    if dry_run or total == 0:
        return {"filas_actualizadas": total, "origen": "staging"}

    if limite:
        sql_up = f"""
            WITH candidatos AS (
                SELECT p.clave_catastral
                FROM catalogos.padron_2026 p
                INNER JOIN staging.padron_tijuana s
                    ON UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(s.clave_catastral))
                WHERE {" OR ".join(condiciones_mejora)}
                LIMIT {int(limite)}
            )
            UPDATE catalogos.padron_2026 p
            SET {", ".join(sets)}
            FROM staging.padron_tijuana s
            INNER JOIN candidatos c ON c.clave_catastral = p.clave_catastral
            WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(s.clave_catastral))
              AND ({" OR ".join(condiciones_mejora)});
        """
    else:
        sql_up = f"""
            UPDATE catalogos.padron_2026 p
            SET {", ".join(sets)}
            FROM staging.padron_tijuana s
            WHERE UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(s.clave_catastral))
              AND ({" OR ".join(condiciones_mejora)});
        """
    cur.execute(sql_up)
    return {"filas_actualizadas": cur.rowcount, "origen": "staging"}


def reconstruir_nombre_completo(cur, *, dry_run: bool = True) -> int:
    """Recompone nombre_completo si hay pnombre/paterno/materno y el completo sigue corrupto."""
    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    needed = {"pnombre", "paterno", "materno", "nombre_completo"}
    if not needed.issubset(cols):
        return 0

    sql = """
        SELECT clave_catastral, pnombre, paterno, materno, nombre_completo
        FROM catalogos.padron_2026
        WHERE POSITION('?' IN nombre_completo) > 0
           OR POSITION('Ã' IN nombre_completo) > 0
        LIMIT 50000;
    """
    cur.execute(sql)
    filas = list(cur.fetchall() or [])
    actualizadas = 0
    for row in filas:
        partes = [
            str(row.get("paterno") or "").strip(),
            str(row.get("materno") or "").strip(),
            str(row.get("pnombre") or "").strip(),
        ]
        partes = [p for p in partes if p]
        if not partes:
            continue
        nuevo = " ".join(partes)
        if nuevo == (row.get("nombre_completo") or ""):
            continue
        if texto_tiene_problema(nuevo):
            continue
        actualizadas += 1
        if not dry_run:
            cur.execute(
                """
                UPDATE catalogos.padron_2026
                SET nombre_completo = %s
                WHERE clave_catastral = %s;
                """,
                (nuevo, row["clave_catastral"]),
            )
    return actualizadas


def procesar_tabla(cur, esquema, tabla, preferidas, *, limite, dry_run, mostrar_ejemplos):
    cols = columnas_disponibles(cur, esquema, tabla, preferidas)
    if not cols:
        print(f"[omitido] {esquema}.{tabla}: sin columnas de nombre")
        return None

    resumen = contar_sospechosos(cur, esquema, tabla, cols)
    print(f"{esquema}.{tabla}: ~{resumen.get('filas_con_problema', 0)} filas con ? / Ã / U+FFFD")
    print(f"  columnas: {', '.join(cols)}")

    if tabla == "personas" and esquema == "catalogos":
        detalle = contar_personas_por_columna(cur)
        if detalle:
            partes = [f"{k}={v}" for k, v in detalle.items() if v]
            if partes:
                print(f"  desglose personas: {', '.join(partes)}")

    if mostrar_ejemplos > 0:
        ejemplos = ejemplos_sospechosos(cur, esquema, tabla, cols, mostrar_ejemplos)
        for i, row in enumerate(ejemplos[:mostrar_ejemplos], 1):
            pk = row.get("pk")
            for col in cols:
                val = row.get(col)
                if not texto_tiene_problema(str(val or "")):
                    continue
                corr = corregir_texto(str(val))
                print(f"  {i}. [{pk}] {col}: {val!r} → {corr!r}")

    stats = aplicar_correccion_tabla(cur, esquema, tabla, cols, limite=limite, dry_run=dry_run)
    print(
        f"  corrección heurística: evaluadas={stats['filas_evaluadas']} "
        f"actualizadas={stats['filas_actualizadas']} celdas={stats['celdas_corregidas']}"
    )
    print()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Corregir encoding en nombres del padrón Tijuana")
    parser.add_argument("--aplicar", action="store_true", help="Escribir cambios (default: solo detectar)")
    parser.add_argument("--desde-staging", action="store_true", help="Priorizar datos limpios de staging.padron_tijuana")
    parser.add_argument("--solo-personas", action="store_true", help="Solo catalogos.personas (nombre/apellidos/razón social)")
    parser.add_argument("--sync-padron", action="store_true", help="Tras corregir personas, actualizar padron_2026.nombre_completo")
    parser.add_argument("--limite", type=int, default=0, help="Máximo de filas a actualizar por tabla (0 = sin límite)")
    parser.add_argument("--ejemplos", type=int, default=15, help="Cuántos ejemplos mostrar")
    args = parser.parse_args()

    dry_run = not args.aplicar
    limite = args.limite if args.limite > 0 else None
    sync_padron = args.sync_padron or args.aplicar

    print("Modo:", "DETECCIÓN" if dry_run else "APLICAR CAMBIOS")
    print()

    with get_conn() as conn:
        with conn.cursor() as cur:
            if args.desde_staging and not args.solo_personas:
                res_st = sincronizar_desde_staging(cur, limite=limite, dry_run=dry_run)
                print(f"Staging → padron_2026: {res_st.get('filas_actualizadas', 0)} filas mejorables")
                if not dry_run and res_st.get("filas_actualizadas"):
                    conn.commit()

            # 1) Catálogo de personas (fuente de verdad para titulares)
            procesar_tabla(
                cur, "catalogos", "personas", COLUMNAS_PERSONAS_PRIORITARIAS,
                limite=limite, dry_run=dry_run, mostrar_ejemplos=args.ejemplos,
            )

            if sync_padron:
                res_sync = sincronizar_padron_desde_personas(
                    cur,
                    limite=limite,
                    dry_run=dry_run,
                    todos=args.aplicar,
                )
                print(
                    f"Personas → padron_2026.nombre_completo: "
                    f"{res_sync.get('personas', 0)} personas, "
                    f"{res_sync.get('filas_padron', 0)} filas padrón"
                )
                print()

            # 2) Padrón fiscal (colonia/calle/nombre_completo residual)
            if not args.solo_personas:
                procesar_tabla(
                    cur, "catalogos", "padron_2026", COLUMNAS_PADRON_PRIORITARIAS,
                    limite=limite, dry_run=dry_run, mostrar_ejemplos=args.ejemplos,
                )

                if "nombre_completo" in columnas_tabla(cur, "catalogos", "padron_2026"):
                    n_rebuild = reconstruir_nombre_completo(cur, dry_run=dry_run)
                    if n_rebuild:
                        print(f"nombre_completo reconstruido desde paterno/materno/pnombre: {n_rebuild}")

            if not dry_run:
                conn.commit()
                print("Cambios confirmados (COMMIT).")
            else:
                conn.rollback()
                print("Sin cambios en BD. Use --aplicar para guardar.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
