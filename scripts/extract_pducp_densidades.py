import csv
import json
import pathlib
import re

import pdfplumber


PDF_PATH = pathlib.Path(
    r"C:\Users\USUARIO\Downloads\programa de desarrollo urbano del centro de poblacion de mexicali 2040.pdf"
)
OUT_DIR = pathlib.Path("outputs/pducp_densidades")

SECTOR_NAMES = {
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

EXPECTED_RANGES = {
    "dub": (8, 29),
    "dum": (30, 39),
    "dua": (40, 49),
    "DMB": (24, 79),
    "DMM": (80, 149),
    "DMA": (150, 250),
}

ROW_RE = re.compile(
    r"^(?P<prefix>.*?)(?P<distrito>[A-P][0-9]+)\s+"
    r"(?P<cos>(?:\"ver pacial\"|\.?\d+(?:\.\d+)?(?:\s*-\s*\.?\d+(?:\.\d+)?)?))\s+"
    r"(?P<cus>(?:\"ver pacial\"|\.?\d+(?:\.\d+)?(?:\s*-\s*\.?\d+(?:\.\d+)?)?))\s+"
    r"(?P<du>[A-Za-z]{3})\s+(?P<umin>\d{1,3})\s*-\s*(?P<umax>\d{1,3})\s+"
    r"(?P<dm>[A-Za-z]{3})\s+(?P<mmin>\d{1,3})\s*-\s*(?P<mmax>\d{1,3})$"
)


def clean_num(value: str) -> str:
    value = value.strip().replace("..", ".")
    if value.startswith("."):
        value = "0" + value
    return value


def range_parts(value: str):
    value = value.strip().strip('"').replace("pacial", "parcial")
    if "ver parcial" in value:
        return value, None, None

    parts = [clean_num(part) for part in re.split(r"\s*-\s*", value)]
    if len(parts) == 1:
        return parts[0], float(parts[0]), float(parts[0])
    return f"{parts[0]} - {parts[1]}", float(parts[0]), float(parts[1])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    with pdfplumber.open(str(PDF_PATH)) as pdf:
        # PDF pages 440-442 are 0-based pages 439-441.
        for page_index in range(439, 442):
            text = pdf.pages[page_index].extract_text(x_tolerance=1, y_tolerance=3) or ""
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                line = line.replace("2..25", "2.25")
                if line.startswith("Fuente: IMIP, 2025"):
                    break
                lines.append(line)

    rows: list[dict[str, object]] = []
    rejected: list[str] = []
    for line in lines:
        match = ROW_RE.match(line)
        if not match:
            if re.search(r"\b[A-P][0-9]+\b", line):
                rejected.append(line)
            continue

        distrito = match.group("distrito")
        sector = distrito[0]
        cos_rango, cos_min, cos_max = range_parts(match.group("cos"))
        cus_rango, cus_min, cus_max = range_parts(match.group("cus"))
        du = match.group("du")
        dm = match.group("dm")
        umin = int(match.group("umin"))
        umax = int(match.group("umax"))
        mmin = int(match.group("mmin"))
        mmax = int(match.group("mmax"))

        notes: list[str] = []
        if du in EXPECTED_RANGES and EXPECTED_RANGES[du] != (umin, umax):
            notes.append(f"Revisar rango unifamiliar {du} {umin}-{umax}")
        if dm in EXPECTED_RANGES and EXPECTED_RANGES[dm] != (mmin, mmax):
            notes.append(f"Revisar rango multifamiliar {dm} {mmin}-{mmax}")

        rows.append(
            {
                "distrito": distrito,
                "sector": sector,
                "sector_nombre": SECTOR_NAMES.get(sector, ""),
                "cos_rango": cos_rango,
                "cos_min": cos_min,
                "cos_max": cos_max,
                "cus_rango": cus_rango,
                "cus_min": cus_min,
                "cus_max": cus_max,
                "densidad_unifamiliar_codigo": du,
                "densidad_unifamiliar_min": umin,
                "densidad_unifamiliar_max": umax,
                "densidad_multifamiliar_codigo": dm,
                "densidad_multifamiliar_min": mmin,
                "densidad_multifamiliar_max": mmax,
                "fuente": "PDUCP Mexicali 2040, Cuadro 258, IMIP 2025",
                "nota": "; ".join(notes),
            }
        )

    fields = list(rows[0].keys())
    csv_path = OUT_DIR / "densidades_distrito_pducp.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    qc_path = OUT_DIR / "densidades_extraccion_qc.json"
    qc = {
        "pdf": str(PDF_PATH),
        "rows": len(rows),
        "rejected_lines": rejected,
        "csv": str(csv_path),
    }
    qc_path.write_text(json.dumps(qc, ensure_ascii=True, indent=2), encoding="utf-8")

    print(json.dumps(qc, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
