#!/usr/bin/env python3
import csv, json, re, sys
from pathlib import Path
import fitz

BASE = Path(r"E:\servidor catastro\servidor fcnarqnodo.hopto.org")
PDFS = {2024: BASE / "tabla 2024.pdf", 2025: BASE / "tabla 2025.pdf", 2026: BASE / "tabla 2026.pdf"}
OUT_DIR = BASE / "catalogos" / "zonas_homogeneas"
ZONA_RE = re.compile(r"^Z(\d+)$", re.I)
SECTOR_RE = re.compile(r"^[A-Z]$")
SECCION_RE = re.compile(r"^[A-Z]$")
VALOR_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)")
SKIP_PREFIXES = ("PAGINA","PERIODICO","OFICIAL","TABLA DE VALORES","ZONA ","MVR","MEXICALI","VALLE","RURAL","CIUDAD","HABITACIONAL","RUSTICO","INDUSTRIAL","PARA LA","POR LO","HOMOCLAVE","DESCRIPCION","VALOR/M2","USO","USOS","PLAZAS","CORREDORES","PARQUE","CENTRAL","OESTE","ORIENTE","NORTE","SUR")

def normalize_spaces(text):
    return re.sub(r"\s+", " ", (text or "").strip())

def clean_desc(text):
    return normalize_spaces(text).replace("$", "").strip(" -").upper()

def parse_valor(text):
    m = VALOR_RE.search(text or "")
    return float(m.group(1).replace(",", "")) if m else None

def should_skip_line(line):
    u = normalize_spaces(line).upper()
    if not u or u.startswith("--"): return True
    if "PERI" in u and "DICO" in u: return True
    return any(u.startswith(p) for p in SKIP_PREFIXES)

def build_codigo(subsector, homoclave, seccion):
    """Codigo en padron: Subsector + Homoclave + Seccion (sin Zona ni Sector)."""
    return f"{subsector}{homoclave}{seccion}".upper()

def extract_lines_from_pdf(path):
    doc = fitz.open(str(path))
    lines = []
    for page in doc:
        for raw in page.get_text("text").splitlines():
            line = normalize_spaces(raw)
            if line: lines.append(line)
    doc.close()
    return lines

def parse_pdf(path, anio):
    lines = extract_lines_from_pdf(path)
    rows, buf = [], []
    def flush_buffer():
        nonlocal buf
        if len(buf) < 6 or not ZONA_RE.match(buf[0]):
            buf = []; return
        zona, sector, subsector, homoclave, seccion = [x.upper() for x in buf[:5]]
        tail = buf[5:]
        desc_parts, valor = [], None
        for part in tail:
            v = parse_valor(part)
            if v is not None:
                valor = v
                part_wo = VALOR_RE.sub("", part).strip()
                if part_wo: desc_parts.append(part_wo)
                break
            desc_parts.append(part)
        if valor is None:
            buf = []; return
        descripcion = clean_desc(" ".join(desc_parts))
        if not descripcion:
            buf = []; return
        codigo = build_codigo(subsector, homoclave, seccion)
        rows.append({"anio": anio, "zona": zona, "sector": sector, "subsector": subsector, "homoclave_col_fracc": homoclave, "seccion": seccion, "descripcion_col_fracc": descripcion, "valor_m2": valor, "codigo_zona_homogenea": codigo, "zona_homogenea": codigo})
        buf = []
    for line in lines:
        if should_skip_line(line): continue
        if ZONA_RE.match(line):
            if buf: flush_buffer()
            buf = [line]; continue
        if not buf: continue
        if len(buf) == 1 and SECTOR_RE.match(line):
            buf.append(line); continue
        if len(buf) == 2:
            buf.append(line); continue
        if len(buf) == 3:
            buf.append(line); continue
        if len(buf) == 4 and SECCION_RE.match(line):
            buf.append(line); continue
        if len(buf) >= 5:
            buf.append(line)
            if parse_valor(line) is not None: flush_buffer()
    if buf: flush_buffer()
    return rows

def dedupe_rows(rows):
    seen, out = set(), []
    for r in rows:
        key = (r["anio"], r["zona"], r["sector"], r["subsector"], r["homoclave_col_fracc"], r["seccion"], r["descripcion_col_fracc"])
        if key in seen: continue
        seen.add(key); out.append(r)
    return out

def write_csv(path, rows):
    fields = ["anio","zona","sector","subsector","homoclave_col_fracc","seccion","descripcion_col_fracc","valor_m2","codigo_zona_homogenea","zona_homogenea"]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

def write_sql(path, rows):
    lines = ["-- Catalogo zonas homogeneas PDF 2024-2026","CREATE TABLE IF NOT EXISTS catalogos.cat_zonas_homogeneas_detalle (","    id SERIAL PRIMARY KEY,","    anio INTEGER NOT NULL,","    zona TEXT NOT NULL,","    sector TEXT NOT NULL,","    subsector TEXT NOT NULL,","    homoclave_col_fracc TEXT NOT NULL,","    seccion TEXT NOT NULL,","    descripcion_col_fracc TEXT NOT NULL,","    valor_m2 NUMERIC(12,2) NOT NULL,","    codigo_zona_homogenea TEXT NOT NULL,","    activo BOOLEAN NOT NULL DEFAULT TRUE,","    UNIQUE (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc)",");",""]
    for anio in sorted({r["anio"] for r in rows}):
        lines.append(f"DELETE FROM catalogos.cat_zonas_homogeneas_detalle WHERE anio = {anio};")
    lines.append("")
    lines.append("INSERT INTO catalogos.cat_zonas_homogeneas_detalle (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc, valor_m2, codigo_zona_homogenea) VALUES")
    values = []
    for r in rows:
        desc = r["descripcion_col_fracc"].replace("'", "''")
        values.append(f"({r['anio']}, '{r['zona']}', '{r['sector']}', '{r['subsector']}', '{r['homoclave_col_fracc']}', '{r['seccion']}', '{desc}', {r['valor_m2']:.2f}, '{r['codigo_zona_homogenea']}')")
    for i in range(0, len(values), 100):
        block = values[i:i+100]
        suffix = ",\n" if i+100 < len(values) else "\nON CONFLICT DO NOTHING;"
        lines.append(",\n".join(block) + suffix)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")

def main():
    all_rows, summary = [], {}
    for anio, pdf in PDFS.items():
        if not pdf.exists():
            print("AVISO: no existe", pdf); continue
        rows = dedupe_rows(parse_pdf(pdf, anio))
        summary[anio] = len(rows); all_rows.extend(rows)
        write_csv(OUT_DIR / f"cat_zonas_homogeneas_{anio}.csv", rows)
        print(f"{anio}: {len(rows)} registros")
    all_rows = dedupe_rows(all_rows)
    write_csv(OUT_DIR / "cat_zonas_homogeneas_todos.csv", all_rows)
    write_sql(OUT_DIR / "cat_zonas_homogeneas_import.sql", all_rows)
    (OUT_DIR / "resumen.json").write_text(json.dumps({"por_anio": summary, "total_unicos": len(all_rows)}, indent=2), encoding="utf-8")
    print("Total unico:", len(all_rows))
    for r in [x for x in all_rows if x["anio"]==2026][:5]:
        print(r["codigo_zona_homogenea"], r["descripcion_col_fracc"][:30], r["valor_m2"])

if __name__ == "__main__":
    main()
