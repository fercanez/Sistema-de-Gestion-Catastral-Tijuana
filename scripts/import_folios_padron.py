#!/usr/bin/env python3
"""
Importa folio real desde Excel/CSV al padrón 2026.

Uso (desde la raíz del repo):
  py -3 scripts/import_folios_padron.py "docs/clave mas folio real.xlsx"
  py -3 scripts/import_folios_padron.py ruta/al/archivo.csv --batch 10000

Requiere variables de conexión de config.py / .env del servidor.
"""
from __future__ import annotations

import argparse
import csv
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from database import get_conn, asegurar_columna_folio_real_padron  # noqa: E402
from routers.padron import _importar_lote_folios  # noqa: E402


NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _parsear_folio_cell(raw) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in ("0", "0.0", "---", "N/A"):
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s[:32]


def _normalizar_clave(raw: str) -> str:
    import re
    return re.sub(r"\s+", "", str(raw or "").strip().upper())


def leer_filas_xlsx(path: Path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                texts = [t.text or "" for t in si.findall(".//m:t", NS)]
                shared.append("".join(texts))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        header = None
        for row in sheet.findall("m:sheetData/m:row", NS):
            vals = []
            for c in row.findall("m:c", NS):
                t = c.get("t")
                v = c.find("m:v", NS)
                if v is None:
                    vals.append("")
                    continue
                vals.append(shared[int(v.text)] if t == "s" else v.text)
            if not any(str(x).strip() for x in vals):
                continue
            if header is None:
                header = [str(x).strip().upper().replace(" ", "_") for x in vals]
                continue
            data = {}
            for i, key in enumerate(header):
                data[key] = vals[i] if i < len(vals) else ""
            clave = _normalizar_clave(
                data.get("CLAVE_CATASTRAL") or data.get("CLAVECATASTRAL") or data.get("CLAVE") or ""
            )
            if not clave:
                continue
            folio = _parsear_folio_cell(
                data.get("FOLIO_REAL") or data.get("FOLIO") or data.get("FOLIO_REAL")
            )
            yield {"clave_catastral": clave, "folio_real": folio}


def leer_filas_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            norm = {str(k or "").strip().upper().replace(" ", "_"): v for k, v in row.items()}
            clave = _normalizar_clave(
                norm.get("CLAVE_CATASTRAL") or norm.get("CLAVECATASTRAL") or norm.get("CLAVE") or ""
            )
            if not clave:
                continue
            folio = _parsear_folio_cell(norm.get("FOLIO_REAL") or norm.get("FOLIO"))
            yield {"clave_catastral": clave, "folio_real": folio}


def leer_filas(path: Path):
    suf = path.suffix.lower()
    if suf in (".xlsx", ".xls"):
        yield from leer_filas_xlsx(path)
    elif suf in (".csv", ".txt"):
        yield from leer_filas_csv(path)
    else:
        raise SystemExit(f"Formato no soportado: {suf}")


def main():
    parser = argparse.ArgumentParser(description="Importar folio real al padron_2026")
    parser.add_argument("archivo", type=Path, help="Excel o CSV con CLAVE_CATASTRAL y Folio Real")
    parser.add_argument("--batch", type=int, default=10000, help="Filas por lote (default 10000)")
    args = parser.parse_args()

    if not args.archivo.is_file():
        raise SystemExit(f"No existe el archivo: {args.archivo}")

    conn = get_conn()
    cur = conn.cursor()
    asegurar_columna_folio_real_padron(cur, conn)

    batch = []
    total_proc = 0
    acum = {
        "actualizados": 0,
        "no_encontrados": 0,
        "con_folio": 0,
        "sin_folio": 0,
        "omitidos": 0,
    }

    def flush():
        nonlocal batch
        if not batch:
            return
        res = _importar_lote_folios(cur, batch)
        conn.commit()
        for k in acum:
            acum[k] += int(res.get(k) or 0)
        total = len(batch)
        batch = []
        print(
            f"  Lote OK: {total} filas · actualizados={res.get('actualizados')} · "
            f"con_folio={res.get('con_folio')} · no_encontrados={res.get('no_encontrados')}"
        )

    print(f"Leyendo {args.archivo} ...")
    for fila in leer_filas(args.archivo):
        batch.append(fila)
        total_proc += 1
        if len(batch) >= args.batch:
            flush()
        if total_proc % 50000 == 0:
            print(f"  Procesadas {total_proc:,} filas del archivo...")

    flush()
    cur.close()
    conn.close()

    print("\nResumen final:")
    print(f"  Filas leídas:     {total_proc:,}")
    print(f"  Actualizados:     {acum['actualizados']:,}")
    print(f"  Con folio:        {acum['con_folio']:,}")
    print(f"  Sin folio (0):    {acum['sin_folio']:,}")
    print(f"  No en padrón:     {acum['no_encontrados']:,}")


if __name__ == "__main__":
    main()
