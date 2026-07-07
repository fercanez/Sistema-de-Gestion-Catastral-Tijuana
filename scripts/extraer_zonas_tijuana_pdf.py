#!/usr/bin/env python3
"""Extrae valores de zonas homogeneas de Tijuana desde PDFs oficiales.

Soporta:
- Codigos numericos (1001, 4047, 6225) con descripcion en la misma linea.
- Codigos alfanumericos (3AB, 6GY, 4CW) de ZONA NORTE, ZONA RIO, etc.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "catalogos" / "zonas_homogeneas_tijuana"
PDFS = {
    # 2023: agregar cuando exista el PDF oficial de TIJUANA (el archivo actual en repo es Mexicali).
    2024: ROOT / "tabla de valor tij 2024.pdf",
    2025: ROOT / "tabla valor tij 2025.pdf",
    2026: ROOT / "tabla de valor tij 2026.pdf",
}

FIELDS = [
    "anio",
    "zona",
    "sector",
    "subsector",
    "homoclave_col_fracc",
    "seccion",
    "descripcion_col_fracc",
    "valor_m2",
    "codigo_zona_homogenea",
    "zona_homogenea",
]

NUM_CODE_RE = re.compile(r"^(\d{3,5})\s+(.+)$")
ALNUM_CODE_FULL_RE = re.compile(r"^([0-9][A-Z]{2})\s+(.+)$", re.I)
ALNUM_CODE_ONLY_RE = re.compile(r"^([0-9][A-Z]{2})$", re.I)
VALUE_RE = re.compile(r"^\d{1,3}(?:,\d{3})*\.\d{2}$|^\d+\.\d{2}$")
SECTION_RE = re.compile(r"^(TERRENOS\s+)?ZONA\b", re.I)
NOISE_RE = re.compile(
    r"^(P[aá]gina|P E R|--|\d{1,3}$|ZONA$|HOM\.?$|REFERENCIA$|VALOR|PESOS|M2|"
    r"TABLA DE VALORES|ZONA URBANA|TERRENOS|BAJA CALIFORNIA|LA SECTORIZACI|"
    r"DE POBLACI|ASENTAMIENTOS|IDENTIFICADAS|DESCRIPTIVA|EN ATENCI|"
    r"DE LOS INMUEBLES|INFRAESTRUCTURA|SU CALIDAD|CONSTRUCCIONES|LAS CUALES|"
    r"No\.?$|MZA\.?$|POR TRAMO DE CALLE|OFICIAL|DICIEMBRE|ENERO|FEBRERO|"
    r"MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|"
    r"PERI[oó]DICO|UNITARIOS|CORREDORES|HOMOG)"
    ,
    re.I,
)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def is_noise(line: str) -> bool:
    if not line:
        return True
    if line in {"2023", "2024", "2025", "2026"}:
        return True
    if VALUE_RE.match(line):
        return False
    if SECTION_RE.match(line):
        return False
    return bool(NOISE_RE.match(line))


def extract_lines(pdf_path: Path) -> list[str]:
    doc = fitz.open(str(pdf_path))
    lines: list[str] = []
    for page in doc:
        for raw in page.get_text("text").splitlines():
            line = norm(raw)
            if line:
                lines.append(line)
    doc.close()
    return lines


def try_start_code(line: str) -> tuple[str, str, list[str]] | None:
    m = NUM_CODE_RE.match(line)
    if m:
        return "num", m.group(1), [m.group(2)]
    m = ALNUM_CODE_FULL_RE.match(line)
    if m:
        return "alnum", m.group(1).upper(), [m.group(2)]
    m = ALNUM_CODE_ONLY_RE.match(line)
    if m:
        return "alnum", m.group(1).upper(), []
    return None


def row_from_code(kind: str, codigo: str, descripcion: str, valor: float, anio: int) -> dict:
    sector = codigo[0]
    zona = f"Z{sector}"
    subsector = codigo
    return {
        "anio": anio,
        "zona": zona,
        "sector": sector,
        "subsector": subsector,
        "homoclave_col_fracc": "",
        "seccion": "",
        "descripcion_col_fracc": descripcion,
        "valor_m2": f"{valor:.2f}",
        "codigo_zona_homogenea": codigo,
        "zona_homogenea": codigo,
    }


def parse_pdf(anio: int, pdf_path: Path) -> list[dict]:
    lines = extract_lines(pdf_path)
    rows: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    i = 0

    while i < len(lines):
        start = try_start_code(lines[i])
        if not start:
            i += 1
            continue

        kind, codigo, desc_parts = start
        i += 1

        while i < len(lines) and not VALUE_RE.match(lines[i]):
            if try_start_code(lines[i]):
                break
            if not is_noise(lines[i]):
                desc_parts.append(lines[i])
            i += 1

        if i >= len(lines) or not VALUE_RE.match(lines[i]):
            continue

        valor = float(lines[i].replace(",", ""))
        i += 1

        descripcion = norm(" ".join(desc_parts)).upper()
        if not descripcion:
            descripcion = codigo

        key = (codigo, descripcion, f"{valor:.2f}")
        if key in seen:
            continue
        seen.add(key)

        rows.append(row_from_code(kind, codigo, descripcion, valor, anio))

    return rows


def sql_quote(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def deduplicate_rows_for_db(rows: list[dict]) -> list[dict]:
    """Una fila por clave UNIQUE de cat_zonas_homogeneas_detalle (mayor valor_m2)."""
    key_fields = [
        "anio",
        "zona",
        "sector",
        "subsector",
        "homoclave_col_fracc",
        "seccion",
        "descripcion_col_fracc",
    ]
    best: dict[tuple, dict] = {}
    for row in rows:
        key = tuple(row[f] for f in key_fields)
        prev = best.get(key)
        if prev is None or float(row["valor_m2"]) > float(prev["valor_m2"]):
            best[key] = row
    return list(best.values())


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def row_sql_value(row: dict) -> str:
    return (
        "("
        + ", ".join([
            str(int(row["anio"])),
            sql_quote(row["zona"]),
            sql_quote(row["sector"]),
            sql_quote(row["subsector"]),
            sql_quote(row["homoclave_col_fracc"]),
            sql_quote(row["seccion"]),
            sql_quote(row["descripcion_col_fracc"]),
            str(row["valor_m2"]),
            sql_quote(row["codigo_zona_homogenea"]),
        ])
        + ")"
    )


INSERT_HEADER = """
INSERT INTO catalogos.cat_zonas_homogeneas_detalle (
    anio, zona, sector, subsector, homoclave_col_fracc, seccion,
    descripcion_col_fracc, valor_m2, codigo_zona_homogenea
) VALUES
"""

INSERT_FOOTER = """
ON CONFLICT (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc)
DO UPDATE SET
    valor_m2 = EXCLUDED.valor_m2,
    codigo_zona_homogenea = EXCLUDED.codigo_zona_homogenea,
    activo = TRUE;
"""

SCHEMA_SQL = """
CREATE SCHEMA IF NOT EXISTS catalogos;

CREATE TABLE IF NOT EXISTS catalogos.cat_zonas_homogeneas_detalle (
    id SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL,
    zona TEXT NOT NULL,
    sector TEXT NOT NULL,
    subsector TEXT NOT NULL,
    homoclave_col_fracc TEXT NOT NULL,
    seccion TEXT NOT NULL,
    descripcion_col_fracc TEXT NOT NULL,
    valor_m2 NUMERIC(12,2) NOT NULL,
    codigo_zona_homogenea TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc)
);
"""

INDEX_SQL = """
CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (codigo_zona_homogenea);

CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_anio_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (anio, codigo_zona_homogenea);
"""


def build_insert_chunks(rows: list[dict], chunk_size: int = 350) -> str:
    values = [row_sql_value(row) for row in rows]
    parts: list[str] = []
    for i in range(0, len(values), chunk_size):
        block = values[i : i + chunk_size]
        parts.append(INSERT_HEADER.strip() + "\n" + ",\n".join(block) + INSERT_FOOTER)
    return "\n\n".join(parts)


def write_sql(path: Path, rows: list[dict], anios: list[int]) -> None:
    rows = deduplicate_rows_for_db(rows)
    anios_sql = ", ".join(str(a) for a in sorted(set(anios)))
    body = build_insert_chunks(rows)
    path.write_text(
        f"""-- Catalogo oficial zonas homogeneas Tijuana ({anios_sql})
-- Ejecutar TODO el archivo (Execute SQL Script), sin seleccionar solo una parte.
{SCHEMA_SQL}

DELETE FROM catalogos.cat_zonas_homogeneas_detalle
WHERE anio IN ({anios_sql});

{body}

{INDEX_SQL}
""",
        encoding="utf-8",
    )


def write_sql_por_anio(out_dir: Path, rows_by_year: dict[int, list[dict]], anios: list[int]) -> None:
    """Archivos pequenos por ejercicio para DBeaver."""
    anios_sql = ", ".join(str(a) for a in sorted(set(anios)))
    prep = out_dir / "00_preparar_zonas_homogeneas_tijuana.sql"
    prep.write_text(
        f"""-- Paso 1 de 4: ejecutar primero en DBeaver (Execute SQL Script)
{SCHEMA_SQL}

DELETE FROM catalogos.cat_zonas_homogeneas_detalle
WHERE anio IN ({anios_sql});

{INDEX_SQL}
""",
        encoding="utf-8",
    )
    orden = 1
    for anio in sorted(rows_by_year.keys()):
        chunk_rows = deduplicate_rows_for_db(rows_by_year[anio])
        archivo = out_dir / f"{orden:02d}_insertar_zonas_tijuana_{anio}.sql"
        archivo.write_text(
            f"""-- Paso {orden + 1} de 4: importar ejercicio {anio}
-- Ejecutar TODO este archivo (Execute SQL Script)
{build_insert_chunks(chunk_rows)}
""",
            encoding="utf-8",
        )
        orden += 1


def codigo_sort_key(codigo: str) -> tuple:
    if codigo.isdigit():
        return (0, int(codigo))
    return (1, codigo)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    rows_by_year: dict[int, list[dict]] = {}
    anios_procesados: list[int] = []

    for anio, pdf_path in sorted(PDFS.items()):
        if not pdf_path.exists():
            print(f"{anio}: OMITIDO (no existe {pdf_path.name})")
            continue
        rows = deduplicate_rows_for_db(parse_pdf(anio, pdf_path))
        if not rows:
            raise RuntimeError(f"No se extrajeron filas para {anio}")
        write_csv(OUT_DIR / f"cat_zonas_homogeneas_tijuana_{anio}.csv", rows)
        rows_by_year[anio] = rows
        all_rows.extend(rows)
        anios_procesados.append(anio)

        numericos = sum(1 for r in rows if r["codigo_zona_homogenea"].isdigit())
        alfanum = len(rows) - numericos
        print(
            f"{anio}: {len(rows)} filas "
            f"(numericas={numericos}, alfanumericas={alfanum})"
        )

    if not all_rows:
        raise RuntimeError("No se procesó ningún PDF de Tijuana.")

    write_csv(OUT_DIR / "cat_zonas_homogeneas_tijuana_todos.csv", deduplicate_rows_for_db(all_rows))
    write_sql(OUT_DIR / "cat_zonas_homogeneas_tijuana_import.sql", all_rows, anios_procesados)
    write_sql_por_anio(OUT_DIR, rows_by_year, anios_procesados)

    universo = sorted({row["codigo_zona_homogenea"] for row in all_rows}, key=codigo_sort_key)
    resumen = {
        "anios_procesados": anios_procesados,
        "total_filas": len(all_rows),
        "codigos_unicos": len(universo),
        "muestra_6GY": {
            str(anio): [
                {
                    "descripcion": r["descripcion_col_fracc"],
                    "valor_m2": r["valor_m2"],
                }
                for r in rows_by_year.get(anio, [])
                if r["codigo_zona_homogenea"] == "6GY"
            ]
            for anio in anios_procesados
        },
        "por_anio": {
            str(anio): {
                "filas": len(rows),
                "numericas": sum(1 for r in rows if r["codigo_zona_homogenea"].isdigit()),
                "alfanumericas": sum(1 for r in rows if not r["codigo_zona_homogenea"].isdigit()),
                "codigos_unicos": len({r["codigo_zona_homogenea"] for r in rows}),
                "faltantes_vs_union": [
                    cod for cod in universo
                    if cod not in {r["codigo_zona_homogenea"] for r in rows}
                ],
            }
            for anio, rows in rows_by_year.items()
        },
    }
    (OUT_DIR / "resumen_extraccion.json").write_text(
        json.dumps(resumen, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"total: {len(all_rows)} filas, {len(universo)} codigos unicos")


if __name__ == "__main__":
    main()
