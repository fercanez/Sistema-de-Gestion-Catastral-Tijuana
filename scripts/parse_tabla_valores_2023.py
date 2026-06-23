#!/usr/bin/env python3
"""Extrae catálogo de zonas homogéneas 2023 desde PDF (formato Periódico Oficial BC)."""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF_2023 = ROOT / "tabla de valores 2023.pdf"
REF_CSV = ROOT / "catalogos" / "zonas_homogeneas" / "cat_zonas_homogeneas_2026_padron.csv"
OUT_DIR = ROOT / "catalogos" / "zonas_homogeneas"
ANIO = 2023

VALOR_LINE = re.compile(r"^[\d,]+\.\d{2}$")
TIPO_LINE = re.compile(r"^\d+$")
MXH_SEC = re.compile(r"^(MXH[A-Z0-9]{2,6})\s+([A-Z])$", re.I)
HOMO_LINE = re.compile(r"^[A-Z0-9]{2,5}$", re.I)
MCC_CODE = re.compile(r"^MCC\d{3}$", re.I)
MVA_CODE = re.compile(r"^MV[A-Z0-9]{3,6}$", re.I)
MCU_CODE = re.compile(r"^MCU\d{3}$", re.I)
SEC_LINE = re.compile(r"^[A-Z]$")


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def load_ref_catalog(path: Path) -> dict[str, dict]:
    by_codigo: dict[str, dict] = {}
    if not path.exists():
        return by_codigo
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            cod = str(row.get("codigo_zona_homogenea") or "").strip().upper()
            if cod and cod not in by_codigo:
                by_codigo[cod] = row
    return by_codigo


def infer_parts_from_codigo(codigo: str) -> dict:
    codigo = codigo.upper()
    if codigo.startswith("MXHA") and len(codigo) >= 6:
        return {
            "subsector": "MXHA",
            "homoclave_col_fracc": codigo[4:-1],
            "seccion": codigo[-1],
            "zona": "",
            "sector": "",
        }
    if codigo.startswith("MXH") and len(codigo) >= 7:
        return {
            "subsector": "MXH",
            "homoclave_col_fracc": codigo[3:-1],
            "seccion": codigo[-1],
            "zona": "",
            "sector": "",
        }
    if len(codigo) >= 2 and codigo[-1].isalpha():
        return {
            "subsector": codigo[:-1][:4],
            "homoclave_col_fracc": codigo[1:-1],
            "seccion": codigo[-1],
            "zona": "",
            "sector": "",
        }
    return {
        "subsector": "",
        "homoclave_col_fracc": "",
        "seccion": "",
        "zona": "",
        "sector": "",
    }


def build_row(codigo: str, descripcion: str, valor: float, ref: dict[str, dict]) -> dict:
    codigo = codigo.upper()
    descripcion = normalize_spaces(descripcion).upper()
    base = ref.get(codigo, {})
    parts = infer_parts_from_codigo(codigo) if not base else {}

    subsector = str(base.get("subsector") or parts.get("subsector") or "").upper()
    homoclave = str(base.get("homoclave_col_fracc") or parts.get("homoclave_col_fracc") or "").upper()
    seccion = str(base.get("seccion") or parts.get("seccion") or codigo[-1:]).upper()
    zona = str(base.get("zona") or "").upper()
    sector = str(base.get("sector") or "").upper()

    if not subsector and codigo.startswith("MXHA"):
        subsector = "MXHA"
        homoclave = homoclave or codigo[4:-1]
    elif not subsector and codigo.startswith("MXH"):
        subsector = "MXH"
        homoclave = homoclave or codigo[3:-1]

    return {
        "anio": ANIO,
        "zona": zona,
        "sector": sector,
        "subsector": subsector,
        "homoclave_col_fracc": homoclave,
        "seccion": seccion,
        "descripcion_col_fracc": descripcion,
        "valor_m2": round(valor, 2),
        "codigo_zona_homogenea": codigo,
        "zona_homogenea": codigo,
    }


def extract_lines(pdf_path: Path) -> list[str]:
    doc = fitz.open(str(pdf_path))
    lines: list[str] = []
    for page in doc:
        for raw in page.get_text("text").splitlines():
            line = normalize_spaces(raw)
            if line:
                lines.append(line)
    doc.close()
    return lines


def is_new_record_start(lines: list[str], i: int) -> bool:
    if i >= len(lines):
        return False
    line = lines[i]
    if MCU_CODE.match(line) or MCC_CODE.match(line) or MVA_CODE.match(line):
        return True
    if MXH_SEC.match(line):
        return True
    if TIPO_LINE.match(line) and i + 1 < len(lines) and MXH_SEC.match(lines[i + 1]):
        return True
    return False


def parse_records(lines: list[str]) -> list[dict]:
    rows: list[dict] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]

        if MCU_CODE.match(line) and i + 2 < n and VALOR_LINE.match(lines[i + 2]):
            codigo = line.upper() + lines[i + 1]
            rows.append(
                {
                    "codigo": codigo,
                    "descripcion": f"ZONA {lines[i + 1]}",
                    "valor": float(lines[i + 2].replace(",", "")),
                }
            )
            i += 3
            continue

        if MVA_CODE.match(line) and i + 3 < n and SEC_LINE.match(lines[i + 1]) and VALOR_LINE.match(lines[i + 3]):
            codigo = line.upper() + lines[i + 1].upper()
            rows.append(
                {
                    "codigo": codigo,
                    "descripcion": lines[i + 2],
                    "valor": float(lines[i + 3].replace(",", "")),
                }
            )
            i += 4
            continue

        if MCC_CODE.match(line) and i + 1 < n and SEC_LINE.match(lines[i + 1]):
            code = line.upper()
            sec = lines[i + 1].upper()
            i += 2
            desc_parts: list[str] = []
            while i < n and not VALOR_LINE.match(lines[i]):
                if is_new_record_start(lines, i):
                    break
                desc_parts.append(lines[i])
                i += 1
            if i < n and VALOR_LINE.match(lines[i]):
                rows.append(
                    {
                        "codigo": code + sec,
                        "descripcion": " ".join(desc_parts),
                        "valor": float(lines[i].replace(",", "")),
                    }
                )
                i += 1
            continue

        if TIPO_LINE.match(line) and i + 1 < n and MXH_SEC.match(lines[i + 1]):
            i += 1
            line = lines[i]

        m = MXH_SEC.match(line)
        if m and i + 2 < n and HOMO_LINE.match(lines[i + 1]):
            combined, sec = m.group(1).upper(), m.group(2).upper()
            i += 2
            desc_parts = []
            while i < n and not VALOR_LINE.match(lines[i]):
                if is_new_record_start(lines, i):
                    break
                desc_parts.append(lines[i])
                i += 1
            if i < n and VALOR_LINE.match(lines[i]):
                rows.append(
                    {
                        "codigo": combined + sec,
                        "descripcion": " ".join(desc_parts),
                        "valor": float(lines[i].replace(",", "")),
                    }
                )
                i += 1
                continue

        i += 1

    return rows


def dedupe_parsed(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        cod = r["codigo"].upper()
        if cod in seen:
            continue
        seen.add(cod)
        out.append(r)
    return out


def write_csv(path: Path, rows: list[dict]) -> None:
    fields = [
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
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def write_sql(path: Path, rows: list[dict]) -> None:
    lines = [
        f"-- Catálogo zonas homogéneas ejercicio {ANIO}",
        f"DELETE FROM catalogos.cat_zonas_homogeneas_detalle WHERE anio = {ANIO};",
        "",
        "INSERT INTO catalogos.cat_zonas_homogeneas_detalle (",
        "    anio, zona, sector, subsector, homoclave_col_fracc, seccion,",
        "    descripcion_col_fracc, valor_m2, codigo_zona_homogenea",
        ") VALUES",
    ]
    values = []
    for r in rows:
        desc = str(r["descripcion_col_fracc"]).replace("'", "''")
        values.append(
            f"({ANIO}, '{r['zona']}', '{r['sector']}', '{r['subsector']}', "
            f"'{r['homoclave_col_fracc']}', '{r['seccion']}', '{desc}', "
            f"{r['valor_m2']:.2f}, '{r['codigo_zona_homogenea']}')"
        )
    for idx in range(0, len(values), 100):
        block = values[idx : idx + 100]
        suffix = ",\n" if idx + 100 < len(values) else "\nON CONFLICT DO NOTHING;"
        lines.append(",\n".join(block) + suffix)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    pdf = PDF_2023
    if len(sys.argv) > 1:
        pdf = Path(sys.argv[1])
    if not pdf.exists():
        print(f"No existe PDF: {pdf}")
        return 1

    ref = load_ref_catalog(REF_CSV)
    lines = extract_lines(pdf)
    parsed = dedupe_parsed(parse_records(lines))

    catalog_rows: list[dict] = []
    sin_ref: list[str] = []
    for item in parsed:
        row = build_row(item["codigo"], item["descripcion"], item["valor"], ref)
        catalog_rows.append(row)
        if item["codigo"] not in ref:
            sin_ref.append(item["codigo"])

    catalog_rows.sort(key=lambda r: r["codigo_zona_homogenea"])
    out_csv = OUT_DIR / f"cat_zonas_homogeneas_{ANIO}.csv"
    out_sql = OUT_DIR / f"cat_zonas_homogeneas_{ANIO}_import.sql"
    out_resumen = OUT_DIR / f"resumen_{ANIO}.json"

    write_csv(out_csv, catalog_rows)
    write_sql(out_sql, catalog_rows)
    out_resumen.write_text(
        json.dumps(
            {
                "anio": ANIO,
                "pdf": str(pdf),
                "total_registros": len(catalog_rows),
                "con_referencia_2026": len(catalog_rows) - len(sin_ref),
                "sin_referencia_2026": len(sin_ref),
                "codigos_sin_referencia": sorted(sin_ref),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    ref_2024 = sum(1 for r in catalog_rows if r["codigo_zona_homogenea"] in ref)
    print(f"Registros extraídos: {len(catalog_rows)}")
    print(f"Con zona/sector en catálogo 2026: {ref_2024}")
    print(f"Sin referencia (zona/sector inferidos): {len(sin_ref)}")
    print(f"CSV: {out_csv}")
    print(f"SQL: {out_sql}")
    for r in catalog_rows[:5]:
        print(r["codigo_zona_homogenea"], r["valor_m2"], r["zona"], r["sector"], r["descripcion_col_fracc"][:35])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
