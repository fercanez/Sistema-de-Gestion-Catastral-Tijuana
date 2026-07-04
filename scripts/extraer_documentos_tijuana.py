#!/usr/bin/env python3
"""Lista o descarga documentos individuales del expediente digital de Tijuana.

Uso tipico:
  py scripts/extraer_documentos_tijuana.py --clave DM008044 --html pagina_dm008044.html
  py scripts/extraer_documentos_tijuana.py --clave DM008044 --url-list urls_dm008044.txt --dry-run

El script genera:
  - archivos descargados en <salida>/<clave>/expediente_tijuana/ (si no usa --dry-run)
  - manifest_documentos.csv
  - registrar_documentos.sql compatible con catastro.expediente_documentos

Tambien acepta URLs de miniaturas:
  /archivos/DMC/DM008044/thumbnails/wd22838300_thumb.jpg?... -> /archivos/DMC/DM008044/wd22838300.pdf
"""
from __future__ import annotations

import argparse
import csv
import html
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path


PDF_URL_RE = re.compile(
    r"""(?ix)
    (?:
        href|src
    )\s*=\s*
    (?P<quote>["'])
    (?P<url>[^"']+?\.pdf(?:\?[^"']*)?)
    (?P=quote)
    |
    (?P<plain>https?://[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?)
    """
)

THUMB_URL_RE = re.compile(
    r"""(?ix)
    (?:
        href|src
    )\s*=\s*
    (?P<quote>["'])
    (?P<url>[^"']+?/thumbnails/[^"']+?_thumb\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)
    (?P=quote)
    |
    (?P<plain>https?://[^\s"'<>]+?/thumbnails/[^\s"'<>]+?_thumb\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?)
    """
)


def normalizar_clave(clave: str) -> str:
    return re.sub(r"\s+", "", str(clave or "").strip().upper())


def sql_quote(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def leer_texto(path: Path) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    return path.read_text(errors="replace")


def extraer_urls_pdf_desde_html(texto: str, base_url: str = "") -> list[str]:
    urls: list[str] = []
    vistos: set[str] = set()
    for match in list(PDF_URL_RE.finditer(texto or "")) + list(THUMB_URL_RE.finditer(texto or "")):
        raw = match.group("url") or match.group("plain") or ""
        raw = html.unescape(raw).strip()
        if not raw:
            continue
        url = urllib.parse.urljoin(base_url, raw) if base_url else raw
        if url.startswith("//"):
            url = "https:" + url
        url = normalizar_url_documento_tijuana(url)
        if not re.search(r"\.pdf(?:\?|$)", url, re.I):
            continue
        if url not in vistos:
            vistos.add(url)
            urls.append(url)
    return urls


def leer_urls_desde_lista(path: Path, base_url: str = "") -> list[str]:
    urls: list[str] = []
    vistos: set[str] = set()
    for raw in leer_texto(path).splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        url = urllib.parse.urljoin(base_url, line) if base_url else line
        url = normalizar_url_documento_tijuana(url)
        if url not in vistos:
            vistos.add(url)
            urls.append(url)
    return urls


def normalizar_url_documento_tijuana(url: str) -> str:
    """Convierte miniaturas del portal a PDF y limpia fragmentos del visor."""
    clean = str(url or "").strip()
    if not clean:
        return ""

    parsed = urllib.parse.urlparse(clean)
    path = parsed.path
    if "/thumbnails/" in path and re.search(r"_thumb\.(jpg|jpeg|png|webp)$", path, re.I):
        path = path.replace("/thumbnails/", "/")
        path = re.sub(r"_thumb\.(jpg|jpeg|png|webp)$", ".pdf", path, flags=re.I)
        parsed = parsed._replace(path=path, query="", fragment="")
        return urllib.parse.urlunparse(parsed)

    if re.search(r"\.pdf$", path, re.I):
        parsed = parsed._replace(fragment="")
        return urllib.parse.urlunparse(parsed)
    return clean


def nombre_archivo_desde_url(url: str, idx: int) -> str:
    parsed = urllib.parse.urlparse(url)
    name = os.path.basename(urllib.parse.unquote(parsed.path))
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name.lower().endswith(".pdf"):
        name = f"documento_{idx:04d}.pdf"
    return name


def descargar(url: str, destino: Path, timeout: int, user_agent: str, cookie: str = "") -> int:
    headers = {"User-Agent": user_agent}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    if not data:
        raise RuntimeError("respuesta vacia")
    destino.write_bytes(data)
    return len(data)


def escribir_manifest(path: Path, rows: list[dict]) -> None:
    fields = [
        "clave_catastral",
        "numero",
        "tipo_documento",
        "nombre_archivo",
        "ruta_archivo",
        "descripcion",
        "origen",
        "url_origen",
        "bytes",
        "fecha_descarga",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def escribir_sql(path: Path, clave: str, rows: list[dict]) -> None:
    values = []
    for row in rows:
        values.append(
            "("
            + ", ".join([
                sql_quote(row["clave_catastral"]),
                sql_quote(row["tipo_documento"]),
                sql_quote(row["nombre_archivo"]),
                sql_quote(row["ruta_archivo"]),
                sql_quote(row["descripcion"]),
                "EXTRACT(YEAR FROM CURRENT_DATE)::int",
                sql_quote(row["origen"]),
                "true",
                "'importador_tijuana'",
            ])
            + ")"
        )

    contenido = f"""-- Registra documentos descargados del expediente digital Tijuana para {clave}.
-- Ejecutar en catastro_tijuana despues de copiar los archivos al DOCUMENTOS_BASE_DIR.

INSERT INTO catastro.expedientes (clave_catastral, estatus, fecha_alta, fecha_actualizacion)
SELECT {sql_quote(clave)}, 'ACTIVO', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM catastro.expedientes
    WHERE upper(trim(clave_catastral)) = {sql_quote(clave)}
);

UPDATE catastro.expediente_documentos
SET activo = false
WHERE upper(trim(clave_catastral)) = {sql_quote(clave)}
  AND tipo_documento = 'EXPEDIENTE_TIJUANA'
  AND origen = 'TIJUANA_DIGITAL';

INSERT INTO catastro.expediente_documentos (
    clave_catastral,
    tipo_documento,
    nombre_archivo,
    ruta_archivo,
    descripcion,
    anio,
    origen,
    activo,
    usuario_carga
) VALUES
"""
    if values:
        contenido += ",\n".join(values) + ";\n"
    else:
        contenido += "-- Sin documentos descargados.\n"

    path.write_text(contenido, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clave", required=True, help="Clave catastral, ej. DM008044")
    parser.add_argument("--html", help="HTML guardado de la pantalla/listado de documentos")
    parser.add_argument("--url-list", help="TXT con una URL PDF por renglon")
    parser.add_argument("--base-url", default="https://plataforma.tijuana.gob.mx/sistemas/sig/consultas/", help="URL base para resolver links relativos")
    parser.add_argument("--salida", default="descargas/documentos_tijuana", help="Directorio local/base de salida")
    parser.add_argument("--documentos-base", default="", help="Ruta base final del servidor, ej. /opt/catastro_tijuana_documentos")
    parser.add_argument("--cookie", default="", help="Cookie HTTP si alguna URL requiere sesion")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--pausa", type=float, default=0.15)
    parser.add_argument("--dry-run", action="store_true", help="Solo listar URLs, no descargar")
    args = parser.parse_args()

    clave = normalizar_clave(args.clave)
    if not clave:
        raise SystemExit("Clave no valida")

    urls: list[str] = []
    if args.html:
        urls.extend(extraer_urls_pdf_desde_html(leer_texto(Path(args.html)), args.base_url))
    if args.url_list:
        urls.extend(leer_urls_desde_lista(Path(args.url_list), args.base_url))

    vistos: set[str] = set()
    urls = [u for u in urls if not (u in vistos or vistos.add(u))]
    urls = [u for u in urls if clave in urllib.parse.unquote(u).upper()]

    if not urls:
        print("No se encontraron URLs PDF para la clave indicada.", file=sys.stderr)
        return 2

    salida_base = Path(args.salida).resolve()
    rel_dir = Path(clave) / "expediente_tijuana"
    destino_dir = salida_base / rel_dir
    destino_dir.mkdir(parents=True, exist_ok=True)

    documentos_base = Path(args.documentos_base).as_posix().rstrip("/") if args.documentos_base else salida_base.as_posix().rstrip("/")
    user_agent = "SGC-Catastro-Tijuana/1.0 (+importador-expediente-digital)"
    rows: list[dict] = []

    print(f"Clave: {clave}")
    print(f"PDFs detectados: {len(urls)}")

    for idx, url in enumerate(urls, start=1):
        nombre_original = nombre_archivo_desde_url(url, idx)
        nombre_rel = (rel_dir / f"{idx:04d}_{nombre_original}").as_posix()
        destino = salida_base / nombre_rel
        print(f"[{idx}/{len(urls)}] {url}")

        size = 0
        if not args.dry_run:
            try:
                size = descargar(url, destino, args.timeout, user_agent, args.cookie)
                time.sleep(args.pausa)
            except Exception as exc:
                print(f"  ERROR: {exc}", file=sys.stderr)
                continue

        rows.append({
            "clave_catastral": clave,
            "numero": idx,
            "tipo_documento": "EXPEDIENTE_TIJUANA",
            "nombre_archivo": nombre_rel,
            "ruta_archivo": f"{documentos_base}/{nombre_rel}",
            "descripcion": f"Expediente digital Tijuana #{idx:03d}",
            "origen": "TIJUANA_DIGITAL",
            "url_origen": url,
            "bytes": size,
            "fecha_descarga": datetime.now().isoformat(timespec="seconds"),
        })

    escribir_manifest(destino_dir / "manifest_documentos.csv", rows)
    escribir_sql(destino_dir / "registrar_documentos.sql", clave, rows)
    print(f"Descargados/listados: {len(rows)}")
    print(f"Salida: {destino_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
