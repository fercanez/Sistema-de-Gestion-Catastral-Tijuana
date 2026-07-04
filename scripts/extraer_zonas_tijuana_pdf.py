#!/usr/bin/env python3
"""Extrae valores de zonas homogeneas de Tijuana 2024-2026 desde PDFs."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "catalogos" / "zonas_homogeneas_tijuana"
PDFS = {
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

CODE_RE = re.compile(r"^(\d{3,5})\s+(.+)$")
VALUE_RE = re.compile(r"^\d{1,3}(?:,\d{3})*\.\d{2}$|^\d+\.\d{2}$")
NOISE_RE = re.compile(
    r"^(P[aá]gina|P E R|--|\d{1,3}$|ZONA$|HOM\.?$|REFERENCIA$|VALOR|PESOS|M2|"
    r"TABLA DE VALORES|ZONA URBANA|TERRENOS|PREDIOS|CORREDORES|BAJA CALIFORNIA|"
    r"LA SECTORIZACI|DE POBLACI|ASENTAMIENTOS|IDENTIFICADAS|DESCRIPTIVA|EN ATENCI|"
    r"DE LOS INMUEBLES|INFRAESTRUCTURA|SU CALIDAD|CONSTRUCCIONES|LAS CUALES)"
)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def is_noise(line: str) -> bool:
    if not line:
        return True
    if line in {"2024", "2025", "2026"}:
        return True
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


def parse_pdf(anio: int, pdf_path: Path) -> list[dict]:
    lines = extract_lines(pdf_path)
    rows: list[dict] = []
    seen: set[str] = set()
    i = 0

    while i < len(lines):
        m = CODE_RE.match(lines[i])
        if not m:
            i += 1
            continue

        codigo = m.group(1)
        desc_parts = [m.group(2)]
        i += 1

        while i < len(lines) and not VALUE_RE.match(lines[i]):
            if CODE_RE.match(lines[i]):
                break
            if not is_noise(lines[i]):
                desc_parts.append(lines[i])
            i += 1

        if i >= len(lines) or not VALUE_RE.match(lines[i]):
            continue

        valor = float(lines[i].replace(",", ""))
        descripcion = norm(" ".join(desc_parts)).upper()
        i += 1

        if not descripcion or codigo in seen:
            continue
        seen.add(codigo)

        rows.append({
            "anio": anio,
            "zona": f"Z{codigo[0]}",
            "sector": codigo[0],
            "subsector": codigo,
            "homoclave_col_fracc": "",
            "seccion": "",
            "descripcion_col_fracc": descripcion,
            "valor_m2": f"{valor:.2f}",
            "codigo_zona_homogenea": codigo,
            "zona_homogenea": codigo,
        })

    return rows


def sql_quote(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def write_sql(path: Path, rows: list[dict]) -> None:
    values = []
    for row in rows:
        values.append(
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

    path.write_text(
        """-- Catalogo oficial zonas homogeneas Tijuana 2024-2026
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

DELETE FROM catalogos.cat_zonas_homogeneas_detalle
WHERE anio IN (2024, 2025, 2026);

INSERT INTO catalogos.cat_zonas_homogeneas_detalle (
    anio, zona, sector, subsector, homoclave_col_fracc, seccion,
    descripcion_col_fracc, valor_m2, codigo_zona_homogenea
) VALUES
"""
        + ",\n".join(values)
        + """
ON CONFLICT (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc)
DO UPDATE SET
    valor_m2 = EXCLUDED.valor_m2,
    codigo_zona_homogenea = EXCLUDED.codigo_zona_homogenea,
    activo = TRUE;

CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (codigo_zona_homogenea);

CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_anio_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (anio, codigo_zona_homogenea);
""",
        encoding="utf-8",
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    rows_by_year: dict[int, list[dict]] = {}

    for anio, pdf_path in PDFS.items():
        if not pdf_path.exists():
            raise FileNotFoundError(pdf_path)
        rows = parse_pdf(anio, pdf_path)
        if not rows:
            raise RuntimeError(f"No se extrajeron filas para {anio}")
        write_csv(OUT_DIR / f"cat_zonas_homogeneas_tijuana_{anio}.csv", rows)
        rows_by_year[anio] = rows
        all_rows.extend(rows)
        print(f"{anio}: {len(rows)} filas")

    write_csv(OUT_DIR / "cat_zonas_homogeneas_tijuana_todos.csv", all_rows)
    write_sql(OUT_DIR / "cat_zonas_homogeneas_tijuana_import.sql", all_rows)
    universo = sorted({row["codigo_zona_homogenea"] for rows in rows_by_year.values() for row in rows})
    resumen = {
        str(anio): {
            "filas": len(rows),
            "codigo_min": min((int(row["codigo_zona_homogenea"]) for row in rows), default=None),
            "codigo_max": max((int(row["codigo_zona_homogenea"]) for row in rows), default=None),
            "faltantes_vs_union": [cod for cod in universo if cod not in {r["codigo_zona_homogenea"] for r in rows}],
        }
        for anio, rows in rows_by_year.items()
    }
    (OUT_DIR / "resumen_extraccion.json").write_text(
        json.dumps(resumen, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"total: {len(all_rows)} filas")


if __name__ == "__main__":
    main()
