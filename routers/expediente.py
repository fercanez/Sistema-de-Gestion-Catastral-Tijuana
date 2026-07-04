"""Router de expediente integral, documentos, control cartografico y dashboards."""
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from html import unescape
from html.parser import HTMLParser

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response

from auth.dependencies import obtener_usuario_actual, requerir_permiso, registrar_auditoria
from auth.permisos_operativos import (
    exigir_permiso_documento_ruta,
    requerir_pestana_archivo,
    requerir_pestana_control_urbano,
)
from config import APP_MUNICIPIO, DOCUMENTOS_BASE_DIR
from database import get_conn, filas_a_lista, asegurar_columna_folio_real_padron

router = APIRouter(tags=["expediente"])

FOTOS_SLOTS = {
    "fachada": "FOTO_FACHADA",
    "aerea": "FOTO_AEREA",
    "inspeccion_1": "FOTO_INSPECCION_1",
    "inspeccion_2": "FOTO_INSPECCION_2",
}
FOTOS_TIPOS = set(FOTOS_SLOTS.values())
FOTOS_EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FOTO_BYTES = 8 * 1024 * 1024

CONTROL_URBANO_SLOTS = {
    "licencia_construccion": "LICENCIA_CONSTRUCCION",
    "uso_suelo_autorizado": "USO_SUELO_AUTORIZADO",
}
CONTROL_URBANO_LABELS = {
    "licencia_construccion": "Licencia de construcción",
    "uso_suelo_autorizado": "Uso de suelo autorizado",
}
CONTROL_URBANO_TIPOS = set(CONTROL_URBANO_SLOTS.values())
DOC_URBANO_EXTENSIONES = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
MAX_DOC_URBANO_BYTES = 15 * 1024 * 1024
ARCHIVO_DIGITAL_EXTERNO_BASE = os.getenv(
    "ARCHIVO_DIGITAL_EXTERNO_URL",
    "",
)
ARCHIVO_EXTERNO_TIMEOUT = int(os.getenv("ARCHIVO_EXTERNO_TIMEOUT", "120"))
TIJUANA_ARCHIVO_DIGITAL_LISTA_URL = os.getenv(
    "TIJUANA_ARCHIVO_DIGITAL_LISTA_URL",
    "https://plataforma.tijuana.gob.mx/sistemas/sig/consultas/consulta-x-clave-catastral-thumbails-separados.php",
)
TIJUANA_ARCHIVO_DIGITAL_REFERER = os.getenv(
    "TIJUANA_ARCHIVO_DIGITAL_REFERER",
    "https://plataforma.tijuana.gob.mx/plataforma/indexProductividad.php?mod=73&sis=74",
)
TIJUANA_ARCHIVO_DIGITAL_TIMEOUT = int(os.getenv("TIJUANA_ARCHIVO_DIGITAL_TIMEOUT", "45"))
TIJUANA_ADEUDOS_URL = os.getenv(
    "TIJUANA_ADEUDOS_URL",
    "https://plataforma.tijuana.gob.mx/sistemas/sig/adeudos.php",
)
TIJUANA_ARCHIVO_DIGITAL_PARAMS = {
    "libre": "true",
    "testeado": "true",
    "p155": "1",
    "p237": "1",
    "p238": "1",
    "p158": "1",
    "p11121": "1",
    "debug": "0",
}
TIJUANA_ARCHIVO_THUMB_RE = re.compile(
    r"""(?ix)
    (?:
        href|src
    )\s*=\s*
    (?P<quote>["'])
    (?P<url>[^"']+?/archivos/DMC/[^"']+?/thumbnails/[^"']+?_thumb\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)
    (?P=quote)
    |
    (?P<plain>https?://[^\s"'<>]+?/archivos/DMC/[^\s"'<>]+?/thumbnails/[^\s"'<>]+?_thumb\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?)
    """
)


def _normalizar_clave_expediente(clave: str) -> str:
    return re.sub(r"\s+", "", str(clave or "").strip().upper())


def _normalizar_archivo_tijuana(nombre: str) -> str:
    nombre_norm = os.path.basename(urllib.parse.unquote(str(nombre or "").strip()))
    if not re.fullmatch(r"wd[A-Za-z0-9_-]+\.pdf", nombre_norm, re.I):
        raise HTTPException(status_code=400, detail="Nombre de documento remoto no válido")
    return nombre_norm


def _url_lista_archivo_tijuana(clave_norm: str) -> str:
    params = {"clave": clave_norm, **TIJUANA_ARCHIVO_DIGITAL_PARAMS}
    return TIJUANA_ARCHIVO_DIGITAL_LISTA_URL + "?" + urllib.parse.urlencode(params)


def _headers_archivo_tijuana() -> dict:
    return {
        "User-Agent": f"SGC-Catastro-{APP_MUNICIPIO}/1.0 (+archivo-digital-tijuana)",
        "Referer": TIJUANA_ARCHIVO_DIGITAL_REFERER,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }


def _url_adeudos_tijuana(clave_norm: str) -> str:
    return TIJUANA_ADEUDOS_URL + "?" + urllib.parse.urlencode({"id": clave_norm})


def _resultado_tabla_adeudos_vacio() -> dict:
    return {"columnas": [], "filas_tabla": [], "filas": [], "total_adeudo": None}


def _limpiar_texto_adeudos_tijuana(html_texto: str) -> str:
    texto = re.sub(r"(?is)<script\b[^>]*>.*?</script>", " ", html_texto or "")
    texto = re.sub(r"(?is)<style\b[^>]*>.*?</style>", " ", texto)
    texto = re.sub(r"<[^>]+>", " ", texto)
    texto = unescape(texto)
    texto = re.sub(r"[.#][A-Za-z0-9_-]+\s*\{[^}]*\}", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def _extraer_tabla_adeudos_tijuana_texto(html_texto: str) -> dict:
    columnas = ["Valor Fiscal", "Tasa", "Valor Unitario", "Superficie", "Año", "Impuesto"]
    texto = _limpiar_texto_adeudos_tijuana(html_texto)
    if "valor fiscal" not in texto.lower() or "impuesto" not in texto.lower():
        return _resultado_tabla_adeudos_vacio()

    money = r"\$\s*[\d,]+(?:\.\d{2})?"
    numero = r"\d+(?:,\d{3})*(?:\.\d+)?"
    row_re = re.compile(
        rf"({money})\s+({numero})\s+({money})\s+({numero})\s+(\d{{4}})\s+({money})"
    )
    filas_tabla = [list(m.groups()) for m in row_re.finditer(texto)]
    if not filas_tabla:
        return _resultado_tabla_adeudos_vacio()

    total_adeudo = None
    total_match = re.search(r"total\s+de\s+adeudo\s*(" + money + r")?", texto, re.I)
    if total_match and total_match.group(1):
        total_adeudo = total_match.group(1)

    filas = [
        {columnas[i]: row[i] if i < len(row) else "" for i in range(len(columnas))}
        for row in filas_tabla
    ]
    return {
        "columnas": columnas,
        "filas_tabla": filas_tabla,
        "filas": filas,
        "total_adeudo": total_adeudo,
    }


class _TablaAdeudosTijuanaParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._table_depth = 0
        self._current_table = None
        self._current_row = None
        self._current_cell = None

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._current_table = []
            return
        if self._table_depth < 1:
            return
        if tag == "tr":
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []

    def handle_data(self, data):
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._table_depth < 1:
            return
        if tag in {"td", "th"} and self._current_cell is not None:
            texto = re.sub(r"\s+", " ", "".join(self._current_cell)).strip()
            self._current_row.append(texto)
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None:
            if any(c for c in self._current_row):
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table":
            if self._table_depth == 1 and self._current_table:
                self.tables.append(self._current_table)
                self._current_table = None
            self._table_depth = max(0, self._table_depth - 1)


def _extraer_tabla_adeudos_tijuana(html_texto: str) -> dict:
    parser = _TablaAdeudosTijuanaParser()
    try:
        parser.feed(html_texto or "")
    except Exception:
        return _extraer_tabla_adeudos_tijuana_texto(html_texto)

    tablas = [t for t in parser.tables if t]
    if not tablas:
        return _extraer_tabla_adeudos_tijuana_texto(html_texto)

    def score(tabla):
        plano = " ".join(" ".join(row) for row in tabla).lower()
        puntos = len(tabla)
        for token in ("valor fiscal", "tasa", "valor unitario", "superficie", "año", "impuesto"):
            if token in plano:
                puntos += 20
        return puntos

    tabla = max(tablas, key=score)
    idx_header = 0
    for i, row in enumerate(tabla):
        row_norm = " ".join(row).lower()
        if "valor fiscal" in row_norm and "impuesto" in row_norm:
            idx_header = i
            break

    columnas = [c or f"Columna {i + 1}" for i, c in enumerate(tabla[idx_header])]
    filas_tabla = []
    total_adeudo = None
    for row in tabla[idx_header + 1:]:
        row_norm = " ".join(row).strip()
        if not row_norm:
            continue
        if re.search(r"total\s+de\s+adeudo", row_norm, re.I):
            montos = re.findall(r"\$\s*[\d,]+(?:\.\d{2})?", row_norm)
            total_adeudo = montos[-1] if montos else total_adeudo
            continue
        if len(row) < len(columnas):
            row = row + [""] * (len(columnas) - len(row))
        elif len(row) > len(columnas):
            row = row[:len(columnas)]
        if not any(re.search(r"\d", c or "") for c in row):
            continue
        filas_tabla.append(row)

    filas = [
        {columnas[i]: row[i] if i < len(row) else "" for i in range(len(columnas))}
        for row in filas_tabla
    ]
    if not filas_tabla:
        return _extraer_tabla_adeudos_tijuana_texto(html_texto)
    return {
        "columnas": columnas,
        "filas_tabla": filas_tabla,
        "filas": filas,
        "total_adeudo": total_adeudo,
    }


def _resumen_adeudos_tijuana(html_texto: str) -> dict:
    texto = _limpiar_texto_adeudos_tijuana(html_texto)
    sin_adeudos = bool(re.search(r"no\s+existen\s+adeudos", texto, re.I))
    tabla = _extraer_tabla_adeudos_tijuana(html_texto)
    total_filas = len(tabla["filas_tabla"])
    tiene_adeudos = False if sin_adeudos else (True if total_filas else (None if not texto else True))
    return {
        "sin_adeudos": sin_adeudos,
        "tiene_adeudos": tiene_adeudos,
        "resumen": "No existen adeudos" if sin_adeudos else (
            f"{total_filas} ejercicio(s) con adeudo" if total_filas else "Detalle remoto disponible"
        ),
        **tabla,
    }


def _thumb_tijuana_a_pdf(url_thumb: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(str(url_thumb or "").strip())
    path = parsed.path
    if "/thumbnails/" not in path:
        raise ValueError("No es miniatura")
    path_pdf = path.replace("/thumbnails/", "/")
    path_pdf = re.sub(r"_thumb\.(?:jpg|jpeg|png|webp)$", ".pdf", path_pdf, flags=re.I)
    nombre_pdf = os.path.basename(path_pdf)
    parsed_pdf = parsed._replace(path=path_pdf, query="", fragment="")
    return nombre_pdf, urllib.parse.urlunparse(parsed_pdf)


def _extraer_documentos_tijuana_html(clave_norm: str, html_texto: str) -> list:
    documentos = []
    vistos = set()
    for m in TIJUANA_ARCHIVO_THUMB_RE.finditer(html_texto or ""):
        raw = (m.group("url") or m.group("plain") or "").strip()
        if not raw:
            continue
        raw = urllib.parse.urljoin(TIJUANA_ARCHIVO_DIGITAL_LISTA_URL, raw)
        if raw.startswith("//"):
            raw = "https:" + raw
        if f"/{clave_norm}/" not in urllib.parse.unquote(raw).upper():
            continue
        try:
            nombre_pdf, url_pdf = _thumb_tijuana_a_pdf(raw)
        except ValueError:
            continue
        if nombre_pdf in vistos:
            continue
        vistos.add(nombre_pdf)
        documentos.append({
            "id": len(documentos) + 1,
            "nombre_archivo": nombre_pdf,
            "thumbnail_url": raw,
            "pdf_url": url_pdf,
            "proxy_url": f"/expediente/{urllib.parse.quote(clave_norm)}/archivo-tijuana/pdf/{urllib.parse.quote(nombre_pdf)}",
            "descripcion": f"Documento Optistor #{len(documentos) + 1}",
            "origen": "TIJUANA_DIGITAL",
        })
    return documentos


def _slot_foto_valido(slot: str) -> str:
    slot_norm = str(slot or "").strip().lower()
    if slot_norm not in FOTOS_SLOTS:
        raise HTTPException(status_code=400, detail="Tipo de fotografía no válido")
    return slot_norm


def _slot_control_urbano_valido(slot: str) -> str:
    slot_norm = str(slot or "").strip().lower()
    if slot_norm not in CONTROL_URBANO_SLOTS:
        raise HTTPException(status_code=400, detail="Tipo de documento de control urbano no válido")
    return slot_norm


def _tipo_control_urbano_desde_slot(slot: str) -> str:
    return CONTROL_URBANO_SLOTS[_slot_control_urbano_valido(slot)]


def _slot_control_urbano_desde_tipo(tipo_documento: str):
    for slot, tipo in CONTROL_URBANO_SLOTS.items():
        if tipo == tipo_documento:
            return slot
    return None


def _ruta_foto_segura(clave_norm: str, nombre_relativo: str) -> str:
    base_dir = os.path.realpath(DOCUMENTOS_BASE_DIR)
    ruta = os.path.realpath(os.path.join(base_dir, clave_norm, nombre_relativo))
    if ruta != base_dir and not ruta.startswith(base_dir + os.sep):
        raise HTTPException(status_code=400, detail="Ruta de fotografía no válida")
    return ruta


def _asegurar_directorio_fotos(clave_norm: str) -> str:
    destino = _ruta_foto_segura(clave_norm, "fotos")
    os.makedirs(destino, exist_ok=True)
    return destino


def _asegurar_expediente(conn, clave_norm: str):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO catastro.expedientes (clave_catastral, estatus, fecha_alta, fecha_actualizacion)
        SELECT %s, 'ACTIVO', NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1
            FROM catastro.expedientes
            WHERE UPPER(TRIM(clave_catastral)) = %s
        );
        """,
        (clave_norm, clave_norm),
    )


def _actualizar_banderas_fotos(conn, clave_norm: str):
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE catastro.expedientes e
        SET
            tiene_fotografia = EXISTS (
                SELECT 1
                FROM catastro.expediente_documentos d
                WHERE UPPER(TRIM(d.clave_catastral)) = %s
                  AND COALESCE(d.activo, true) = true
                  AND d.tipo_documento IN ('FOTO_FACHADA', 'FOTO_AEREA')
            ),
            tiene_inspeccion = EXISTS (
                SELECT 1
                FROM catastro.expediente_documentos d
                WHERE UPPER(TRIM(d.clave_catastral)) = %s
                  AND COALESCE(d.activo, true) = true
                  AND d.tipo_documento IN ('FOTO_INSPECCION_1', 'FOTO_INSPECCION_2')
            ),
            fecha_actualizacion = NOW()
        WHERE UPPER(TRIM(e.clave_catastral)) = %s;
        """,
        (clave_norm, clave_norm, clave_norm),
    )


def _foto_slot_desde_tipo(tipo_documento: str):
    for slot, tipo in FOTOS_SLOTS.items():
        if tipo == tipo_documento:
            return slot
    return None


def _ruta_documento_foto_en_disco(clave_norm: str, row: dict):
    if not row:
        return None
    ruta = str(row.get("ruta_archivo") or "").strip()
    base = os.path.realpath(DOCUMENTOS_BASE_DIR)
    if ruta and os.path.isfile(ruta):
        ruta_real = os.path.realpath(ruta)
        if ruta_real == base or ruta_real.startswith(base + os.sep):
            return ruta_real
    nombre = str(row.get("nombre_archivo") or "").strip()
    if not nombre:
        return None
    try:
        candidata = _ruta_foto_segura(clave_norm, nombre)
    except HTTPException:
        return None
    return candidata if os.path.isfile(candidata) else None


def _eliminar_archivo_foto_en_disco(clave_norm: str, row: dict) -> bool:
    ruta = _ruta_documento_foto_en_disco(clave_norm, row)
    if not ruta:
        return False
    try:
        os.remove(ruta)
        return True
    except OSError:
        return False


@router.get("/control-cartografico/estadisticas")
def estadisticas_control(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                estado_cartografico,
                COUNT(*) AS total
            FROM catastro.v_control_cartografico
            GROUP BY estado_cartografico
            ORDER BY estado_cartografico;
        """)

        rows = cur.fetchall()
        cur.close()
        conn.close()

        resultado = {
            "DIBUJADO": 0,
            "SIN GEOMETRIA": 0,
            "NO EXISTE EN CARTOGRAFIA": 0,
            "TOTAL": 0,
            "COBERTURA": 0
        }

        for row in rows:
            estado = row["estado_cartografico"]
            total_estado = row["total"]
            resultado[estado] = total_estado
            resultado["TOTAL"] += total_estado

        if resultado["TOTAL"] > 0:
            resultado["COBERTURA"] = round(
                (resultado.get("DIBUJADO", 0) / resultado["TOTAL"]) * 100,
                2
            )

        return resultado

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/control-cartografico/sin-geometria")
def control_sin_geometria(
    limite: int = Query(100, ge=1, le=1000),
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                clave_catastral,
                nombre_completo,
                delegacion,
                colonia,
                calle,
                numof,
                valor2026,
                sup_documental,
                descripcion_uso,
                predio_id,
                estado_cartografico
            FROM catastro.v_control_cartografico
            WHERE estado_cartografico = 'SIN GEOMETRIA'
            ORDER BY clave_catastral
            LIMIT %s;
        """, (limite,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "estado": "SIN GEOMETRIA",
            "total": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expediente/{clave}")
def obtener_expediente_integral(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()
        asegurar_columna_folio_real_padron(cur, conn)

        cur.execute("""
            SELECT
                vei.id_expediente,
                vei.clave_catastral,
                vei.estatus_expediente,
                COALESCE(
                    NULLIF(TRIM(tit.nombre_visible), ''),
                    NULLIF(TRIM(tit.titular_principal), ''),
                    NULLIF(TRIM(vei.nombre_completo), '')
                ) AS nombre_completo,
                vei.delegacion,
                vei.colonia,
                vei.calle,
                vei.numof,
                vei.numint,
                vei.letra,
                vei.zona_homogenea,
                vei.descripcion_uso,
                vei.id_tasa,
                vei.porcentaje_tasa,
                vei.condominio,
                vei.valor2026,
                vei.sup_documental,
                vei.sup_fisica,
                vei.sup_const,
                vei.adeudo_2026,
                vei.adeudo_total,
                NULLIF(NULLIF(TRIM(pad.folio_real::text), ''), '0') AS folio_real,
                vei.predio_id,
                vei.estado_cartografico,
                vei.dibujado,
                vei.area_cartografica,
                vei.diferencia_area,
                vei.tiene_documentos,
                vei.tiene_cartografia,
                vei.tiene_construccion,
                vei.tiene_avaluo,
                vei.tiene_inspeccion,
                vei.tiene_rppc,
                vei.tiene_fotografia,
                vei.tiene_cedula,
                vei.tiene_historial,
                vei.observaciones,
                ex.fecha_alta,
                tit.id_persona,
                tit.tipo_persona,
                tit.rfc,
                tit.porcentaje_propiedad,
                tit.tipo_titularidad,
                tit.total_titulares,
                tit.suma_porcentaje,
                CASE
                    WHEN vei.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(vei.geom, 4326))::json
                END AS geometry
            FROM catastro.v_expediente_integral vei
            LEFT JOIN catalogos.padron_2026 pad
                ON UPPER(TRIM(pad.clave_catastral)) = UPPER(TRIM(vei.clave_catastral))
            LEFT JOIN catastro.expedientes ex
                ON UPPER(TRIM(ex.clave_catastral)) = UPPER(TRIM(vei.clave_catastral))
            LEFT JOIN catastro.v_titularidad_predio tit
                ON UPPER(TRIM(tit.clave_catastral)) = UPPER(TRIM(vei.clave_catastral))
            WHERE UPPER(TRIM(vei.clave_catastral)) = UPPER(TRIM(%s))
            LIMIT 1;
        """, (clave,))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Expediente no encontrado")

        geometry = row.pop("geometry")

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": row
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expediente/{clave}/historial")
def historial_expediente(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                fecha_modificacion,
                usuario_modifico,
                accion,
                tipo_movimiento,
                observaciones,
                tiene_documentos,
                tiene_cartografia,
                tiene_construccion,
                tiene_avaluo,
                tiene_inspeccion,
                tiene_rppc,
                tiene_fotografia,
                tiene_cedula,
                tiene_historial
            FROM auditoria.v_expedientes_timeline
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            ORDER BY fecha_modificacion DESC
            LIMIT 50;
        """, (clave,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave_catastral": clave.upper(),
            "total": len(rows),
            "historial": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expediente/{clave}/archivo-externo")
def proxy_archivo_externo(clave: str, usuario_actual: dict = Depends(requerir_pestana_archivo)):
    """Proxy same-origin del PDF del archivo digital municipal (evita CORS en el visor)."""
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")
    if not ARCHIVO_DIGITAL_EXTERNO_BASE:
        raise HTTPException(status_code=503, detail="Archivo digital externo no configurado")

    url = f"{ARCHIVO_DIGITAL_EXTERNO_BASE}{urllib.parse.quote(clave_norm, safe='')}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": f"SGC-Catastro-{APP_MUNICIPIO}/1.0 (+archivo-externo-interno)"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=ARCHIVO_EXTERNO_TIMEOUT) as resp:
            content_type = resp.headers.get("Content-Type", "application/pdf")
            body = resp.read()
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=e.code,
            detail="No se pudo obtener el archivo digital externo",
        ) from e
    except urllib.error.URLError as e:
        raise HTTPException(
            status_code=502,
            detail="Servicio de archivo digital externo no disponible",
        ) from e

    if not body:
        raise HTTPException(status_code=404, detail="El predio no tiene archivo digital externo")

    media_type = content_type.split(";")[0].strip() if content_type else "application/pdf"
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{clave_norm}.pdf"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.get("/expediente/{clave}/archivo-tijuana/documentos")
def documentos_archivo_tijuana(clave: str, usuario_actual: dict = Depends(requerir_pestana_archivo)):
    """Lista documentos remotos del expediente digital Tijuana sin descargarlos."""
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    url = _url_lista_archivo_tijuana(clave_norm)
    req = urllib.request.Request(
        url,
        headers=_headers_archivo_tijuana(),
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIJUANA_ARCHIVO_DIGITAL_TIMEOUT) as resp:
            raw = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
        texto = raw.decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=e.code,
            detail="No se pudo consultar el expediente digital Tijuana",
        ) from e
    except urllib.error.URLError as e:
        raise HTTPException(
            status_code=502,
            detail="Servicio de expediente digital Tijuana no disponible",
        ) from e

    documentos = _extraer_documentos_tijuana_html(clave_norm, texto)
    return {
        "clave_catastral": clave_norm,
        "total": len(documentos),
        "url_consulta": url,
        "documentos": documentos,
    }


@router.get("/expediente/{clave}/archivo-tijuana/pdf/{archivo}")
def proxy_archivo_tijuana_pdf(
    clave: str,
    archivo: str,
    usuario_actual: dict = Depends(requerir_pestana_archivo),
):
    """Proxy de PDF remoto Tijuana. No guarda documentos en disco."""
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")
    archivo_norm = _normalizar_archivo_tijuana(archivo)
    url = f"https://plataforma.tijuana.gob.mx/archivos/DMC/{urllib.parse.quote(clave_norm)}/{urllib.parse.quote(archivo_norm)}"
    headers = _headers_archivo_tijuana()
    headers["Accept"] = "application/pdf,*/*;q=0.8"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=TIJUANA_ARCHIVO_DIGITAL_TIMEOUT) as resp:
            body = resp.read()
            content_type = resp.headers.get("Content-Type", "application/pdf")
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=e.code,
            detail="No se pudo obtener el PDF remoto Tijuana",
        ) from e
    except urllib.error.URLError as e:
        raise HTTPException(
            status_code=502,
            detail="Servicio de expediente digital Tijuana no disponible",
        ) from e

    if not body:
        raise HTTPException(status_code=404, detail="Documento remoto vacío o inexistente")

    return Response(
        content=body,
        media_type=(content_type.split(";")[0].strip() or "application/pdf"),
        headers={
            "Content-Disposition": f'inline; filename="{archivo_norm}"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.get("/expediente/{clave}/adeudos-tijuana")
def adeudos_tijuana_remoto(clave: str, usuario_actual: dict = Depends(obtener_usuario_actual)):
    """Consulta remota de adeudos Tijuana sin guardar datos localmente."""
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    url = _url_adeudos_tijuana(clave_norm)
    headers = _headers_archivo_tijuana()
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=TIJUANA_ARCHIVO_DIGITAL_TIMEOUT) as resp:
            raw = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
        texto_html = raw.decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=e.code,
            detail="No se pudo consultar adeudos remotos Tijuana",
        ) from e
    except urllib.error.URLError as e:
        raise HTTPException(
            status_code=502,
            detail="Servicio de adeudos Tijuana no disponible",
        ) from e

    resumen = _resumen_adeudos_tijuana(texto_html)
    return {
        "clave_catastral": clave_norm,
        "url_consulta": url,
        **resumen,
    }


@router.get("/expediente/{clave}/documentos")
def documentos_expediente(clave: str, usuario_actual: dict = Depends(requerir_pestana_archivo)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id_documento,
                clave_catastral,
                tipo_documento,
                nombre_archivo,
                ruta_archivo,
                descripcion,
                anio,
                origen,
                usuario_carga,
                fecha_carga
            FROM catastro.v_expediente_documentos
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            ORDER BY fecha_carga DESC;
        """, (clave,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave_catastral": clave.upper(),
            "total": len(rows),
            "documentos": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expediente/{clave}/fotografias")
def listar_fotografias_expediente(clave: str, usuario_actual: dict = Depends(requerir_pestana_archivo)):
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                id_documento,
                clave_catastral,
                tipo_documento,
                nombre_archivo,
                descripcion,
                usuario_carga,
                fecha_carga
            FROM catastro.expediente_documentos
            WHERE UPPER(TRIM(clave_catastral)) = %s
              AND COALESCE(activo, true) = true
              AND tipo_documento = ANY(%s)
            ORDER BY fecha_carga DESC;
            """,
            (clave_norm, list(FOTOS_TIPOS)),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()

        por_slot = {}
        fotografias = []
        for row in rows:
            slot = _foto_slot_desde_tipo(row["tipo_documento"])
            if not slot or por_slot.get(slot):
                continue
            item = {
                "slot": slot,
                "id_documento": row["id_documento"],
                "tipo_documento": row["tipo_documento"],
                "nombre_archivo": row["nombre_archivo"],
                "descripcion": row.get("descripcion"),
                "usuario_carga": row.get("usuario_carga"),
                "fecha_carga": row.get("fecha_carga"),
            }
            por_slot[slot] = item
            fotografias.append(item)

        return {
            "clave_catastral": clave_norm,
            "total": len(fotografias),
            "fotografias": fotografias,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/expediente/{clave}/fotografias")
async def subir_fotografia_expediente(
    clave: str,
    slot: str = Form(...),
    archivo: UploadFile = File(...),
    usuario_actual: dict = Depends(requerir_permiso("editar_catastro")),
):
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    slot_norm = _slot_foto_valido(slot)
    tipo_documento = FOTOS_SLOTS[slot_norm]
    nombre_original = os.path.basename(str(archivo.filename or "foto.jpg"))
    extension = os.path.splitext(nombre_original)[1].lower()
    if extension not in FOTOS_EXTENSIONES:
        raise HTTPException(status_code=400, detail="Formato no permitido. Use JPG, PNG, WEBP o GIF.")

    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="Archivo vacío")
    if len(contenido) > MAX_FOTO_BYTES:
        raise HTTPException(status_code=400, detail="La fotografía supera el tamaño máximo de 8 MB")

    nombre_archivo = f"fotos/{slot_norm}_{datetime.now().strftime('%Y%m%d%H%M%S')}{extension}"
    ruta_abs = _ruta_foto_segura(clave_norm, nombre_archivo)

    conn = None
    cur = None
    try:
        os.makedirs(os.path.dirname(ruta_abs), exist_ok=True)
        with open(ruta_abs, "wb") as destino:
            destino.write(contenido)

        conn = get_conn()
        cur = conn.cursor()
        _asegurar_expediente(conn, clave_norm)
        cur.execute(
            """
            SELECT id_documento, nombre_archivo, ruta_archivo
            FROM catastro.expediente_documentos
            WHERE UPPER(TRIM(clave_catastral)) = %s
              AND tipo_documento = %s
              AND COALESCE(activo, true) = true;
            """,
            (clave_norm, tipo_documento),
        )
        fotos_anteriores = cur.fetchall() or []
        cur.execute(
            """
            UPDATE catastro.expediente_documentos
            SET activo = false
            WHERE UPPER(TRIM(clave_catastral)) = %s
              AND tipo_documento = %s
              AND COALESCE(activo, true) = true;
            """,
            (clave_norm, tipo_documento),
        )
        cur.execute(
            """
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
            )
            VALUES (%s, %s, %s, %s, %s, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'SGC', true, %s)
            RETURNING id_documento, fecha_carga;
            """,
            (
                clave_norm,
                tipo_documento,
                nombre_archivo,
                ruta_abs,
                FOTOS_SLOTS[slot_norm].replace("FOTO_", "").replace("_", " "),
                usuario_actual.get("usuario"),
            ),
        )
        insertado = cur.fetchone()
        _actualizar_banderas_fotos(conn, clave_norm)
        conn.commit()

        for previa in fotos_anteriores:
            _eliminar_archivo_foto_en_disco(clave_norm, previa)

        registrar_auditoria(
            usuario_actual.get("usuario"),
            "SUBIR_FOTO_EXPEDIENTE",
            "expediente",
            f"clave={clave_norm}; slot={slot_norm}; archivo={nombre_archivo}",
        )

        return {
            "ok": True,
            "clave_catastral": clave_norm,
            "slot": slot_norm,
            "id_documento": insertado["id_documento"],
            "nombre_archivo": nombre_archivo,
            "fecha_carga": insertado.get("fecha_carga"),
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        if os.path.isfile(ruta_abs):
            try:
                os.remove(ruta_abs)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.delete("/expediente/{clave}/fotografias/{id_documento}")
def eliminar_fotografia_expediente(
    clave: str,
    id_documento: int,
    usuario_actual: dict = Depends(requerir_permiso("editar_catastro")),
):
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id_documento, nombre_archivo, ruta_archivo, tipo_documento
            FROM catastro.expediente_documentos
            WHERE id_documento = %s
              AND UPPER(TRIM(clave_catastral)) = %s
              AND COALESCE(activo, true) = true
              AND tipo_documento = ANY(%s);
            """,
            (id_documento, clave_norm, list(FOTOS_TIPOS)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fotografía no encontrada")

        cur.execute(
            """
            UPDATE catastro.expediente_documentos
            SET activo = false
            WHERE id_documento = %s;
            """,
            (id_documento,),
        )
        _actualizar_banderas_fotos(conn, clave_norm)
        conn.commit()

        archivo_eliminado = _eliminar_archivo_foto_en_disco(clave_norm, row)

        registrar_auditoria(
            usuario_actual.get("usuario"),
            "ELIMINAR_FOTO_EXPEDIENTE",
            "expediente",
            f"clave={clave_norm}; id={id_documento}; archivo={row.get('nombre_archivo')}; disco={'si' if archivo_eliminado else 'no'}",
        )

        return {"ok": True, "id_documento": id_documento, "archivo_eliminado_disco": archivo_eliminado}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.get("/expediente/{clave}/control-urbano")
def listar_documentos_control_urbano(clave: str, usuario_actual: dict = Depends(requerir_pestana_control_urbano)):
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                id_documento,
                clave_catastral,
                tipo_documento,
                nombre_archivo,
                descripcion,
                usuario_carga,
                fecha_carga
            FROM catastro.expediente_documentos
            WHERE UPPER(TRIM(clave_catastral)) = %s
              AND COALESCE(activo, true) = true
              AND tipo_documento = ANY(%s)
            ORDER BY fecha_carga DESC;
            """,
            (clave_norm, list(CONTROL_URBANO_TIPOS)),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()

        documentos = []
        slots_con_actual = set()
        historial_por_slot = {slot: [] for slot in CONTROL_URBANO_SLOTS}

        for row in rows:
            slot = _slot_control_urbano_desde_tipo(row["tipo_documento"])
            if not slot:
                continue
            es_actual = slot not in slots_con_actual
            if es_actual:
                slots_con_actual.add(slot)
            item = {
                "slot": slot,
                "id_documento": row["id_documento"],
                "tipo_documento": row["tipo_documento"],
                "nombre_archivo": row["nombre_archivo"],
                "descripcion": row.get("descripcion"),
                "usuario_carga": row.get("usuario_carga"),
                "fecha_carga": row.get("fecha_carga"),
                "es_actual": es_actual,
            }
            documentos.append(item)
            historial_por_slot[slot].append(item)

        return {
            "clave_catastral": clave_norm,
            "total": len(documentos),
            "documentos": documentos,
            "historial_por_slot": historial_por_slot,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/expediente/{clave}/control-urbano")
async def subir_documento_control_urbano(
    clave: str,
    slot: str = Form(...),
    archivo: UploadFile = File(...),
    usuario_actual: dict = Depends(requerir_permiso("editar_catastro")),
):
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    slot_norm = _slot_control_urbano_valido(slot)
    tipo_documento = CONTROL_URBANO_SLOTS[slot_norm]
    etiqueta = CONTROL_URBANO_LABELS.get(slot_norm, slot_norm.replace("_", " "))
    nombre_original = os.path.basename(str(archivo.filename or "documento.pdf"))
    extension = os.path.splitext(nombre_original)[1].lower()
    if extension not in DOC_URBANO_EXTENSIONES:
        raise HTTPException(
            status_code=400,
            detail="Formato no permitido. Use PDF, JPG, PNG o WEBP.",
        )

    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="Archivo vacío")
    if len(contenido) > MAX_DOC_URBANO_BYTES:
        raise HTTPException(status_code=400, detail="El documento supera el tamaño máximo de 15 MB")

    nombre_archivo = f"control_urbano/{slot_norm}_{datetime.now().strftime('%Y%m%d%H%M%S')}{extension}"
    ruta_abs = _ruta_foto_segura(clave_norm, nombre_archivo)

    conn = None
    cur = None
    try:
        os.makedirs(os.path.dirname(ruta_abs), exist_ok=True)
        with open(ruta_abs, "wb") as destino:
            destino.write(contenido)

        conn = get_conn()
        cur = conn.cursor()
        _asegurar_expediente(conn, clave_norm)
        cur.execute(
            """
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
            )
            VALUES (%s, %s, %s, %s, %s, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'SGC', true, %s)
            RETURNING id_documento, fecha_carga;
            """,
            (
                clave_norm,
                tipo_documento,
                nombre_archivo,
                ruta_abs,
                etiqueta,
                usuario_actual.get("usuario"),
            ),
        )
        insertado = cur.fetchone()
        conn.commit()

        registrar_auditoria(
            usuario_actual.get("usuario"),
            "SUBIR_DOC_CONTROL_URBANO",
            "expediente",
            f"clave={clave_norm}; slot={slot_norm}; archivo={nombre_archivo}",
        )

        return {
            "ok": True,
            "clave_catastral": clave_norm,
            "slot": slot_norm,
            "id_documento": insertado["id_documento"],
            "nombre_archivo": nombre_archivo,
            "fecha_carga": insertado.get("fecha_carga"),
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        if os.path.isfile(ruta_abs):
            try:
                os.remove(ruta_abs)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.delete("/expediente/{clave}/control-urbano/{id_documento}")
def eliminar_documento_control_urbano(
    clave: str,
    id_documento: int,
    usuario_actual: dict = Depends(requerir_permiso("editar_catastro")),
):
    clave_norm = _normalizar_clave_expediente(clave)
    if not clave_norm:
        raise HTTPException(status_code=400, detail="Clave catastral no válida")

    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id_documento, nombre_archivo, ruta_archivo, tipo_documento
            FROM catastro.expediente_documentos
            WHERE id_documento = %s
              AND UPPER(TRIM(clave_catastral)) = %s
              AND COALESCE(activo, true) = true
              AND tipo_documento = ANY(%s);
            """,
            (id_documento, clave_norm, list(CONTROL_URBANO_TIPOS)),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Documento no encontrado")

        cur.execute(
            """
            UPDATE catastro.expediente_documentos
            SET activo = false
            WHERE id_documento = %s;
            """,
            (id_documento,),
        )
        conn.commit()

        archivo_eliminado = _eliminar_archivo_foto_en_disco(clave_norm, row)

        registrar_auditoria(
            usuario_actual.get("usuario"),
            "ELIMINAR_DOC_CONTROL_URBANO",
            "expediente",
            f"clave={clave_norm}; id={id_documento}; archivo={row.get('nombre_archivo')}; disco={'si' if archivo_eliminado else 'no'}",
        )

        return {"ok": True, "id_documento": id_documento, "archivo_eliminado_disco": archivo_eliminado}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.get("/documentos/{clave}/{archivo:path}")
def abrir_documento(
    clave: str,
    archivo: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    exigir_permiso_documento_ruta(usuario_actual, archivo)

    # Protección contra path traversal: la ruta final, ya resuelta (sin '..',
    # symlinks, etc.), debe quedar estrictamente dentro de la carpeta base.
    base_dir = os.path.realpath(DOCUMENTOS_BASE_DIR)
    ruta = os.path.realpath(os.path.join(base_dir, clave, archivo))

    if ruta != base_dir and not ruta.startswith(base_dir + os.sep):
        raise HTTPException(status_code=400, detail="Ruta de documento no válida")

    if not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    return FileResponse(ruta)


@router.get("/cambios-geometricos")
def cambios_geometricos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT json_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(json_agg(feature), '[]'::json)
            ) AS geojson
            FROM (
                SELECT json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json,
                    'properties', json_build_object(
                        'clave_catastral', c.clave_catastral,
                        'tipo_cambio', c.tipo_cambio,
                        'prioridad', c.prioridad,
                        'requiere_revision', c.requiere_revision,
                        'area_catastro', c.area_catastro,
                        'area_geonode', c.area_geonode,
                        'diferencia_area', c.diferencia_area,
                        'porcentaje_cambio', c.porcentaje_cambio,
                        'distancia_centroides', c.distancia_centroides,
                        'fecha_deteccion', c.fecha_deteccion
                    )
                ) AS feature
                FROM auditoria.cambios_geometricos_predios c
                JOIN catastro.predios p
                    ON p.clave_catastral = c.clave_catastral
                WHERE p.geom IS NOT NULL
            ) features;
        """)

        row = cur.fetchone()
        cur.close()
        conn.close()

        return row["geojson"]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard-cartografico")
def dashboard_cartografico(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE geom IS NOT NULL) AS dibujados,
                COUNT(*) FILTER (WHERE geom IS NULL) AS sin_geometria
            FROM catastro.predios;
        """)
        base = cur.fetchone()

        cambios = {
            "total_cambios": 0,
            "requieren_revision": 0,
            "prioridad_alta": 0,
            "prioridad_media": 0,
            "prioridad_baja": 0,
        }
        try:
            cur.execute("""
                SELECT
                    COUNT(*) AS total_cambios,
                    COUNT(*) FILTER (WHERE requiere_revision = true) AS requieren_revision,
                    COUNT(*) FILTER (WHERE prioridad = 'ALTA') AS prioridad_alta,
                    COUNT(*) FILTER (WHERE prioridad = 'MEDIA') AS prioridad_media,
                    COUNT(*) FILTER (WHERE prioridad = 'BAJA') AS prioridad_baja
                FROM auditoria.cambios_geometricos_predios;
            """)
            row_cambios = cur.fetchone()
            if row_cambios:
                cambios = dict(row_cambios)
        except Exception:
            pass

        cur.close()
        conn.close()

        total = int(base["total_predios"] or 0)
        dibujados = int(base["dibujados"] or 0)
        sin_geometria = int(base["sin_geometria"] or 0)
        cobertura = round((dibujados / total) * 100, 2) if total > 0 else 0

        return {
            "total_predios": total,
            "dibujados": dibujados,
            "sin_geometria": sin_geometria,
            "cobertura": cobertura,
            "cambios_geometricos": int(cambios.get("total_cambios") or 0),
            "requieren_revision": int(cambios.get("requieren_revision") or 0),
            "prioridad_alta": int(cambios.get("prioridad_alta") or 0),
            "prioridad_media": int(cambios.get("prioridad_media") or 0),
            "prioridad_baja": int(cambios.get("prioridad_baja") or 0)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard-fiscal")
def dashboard_fiscal(usuario_actual: dict = Depends(obtener_usuario_actual)):
    try:
        conn = get_conn()
        cur = conn.cursor()

        # Resumen fiscal general desde la ficha predial institucional
        cur.execute("""
            SELECT
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS con_adeudo,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) <= 0) AS sin_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(adeudo_2026), 0) AS adeudo_2026,
                COALESCE(SUM(valor2026), 0) AS valor_catastral_total,
                COALESCE(SUM(sup_documental), 0) AS superficie_documental_total,
                COALESCE(SUM(sup_fisica), 0) AS superficie_fisica_total,
                COALESCE(SUM(sup_const), 0) AS superficie_construccion_total,
                COUNT(*) FILTER (WHERE dibujado = true) AS dibujados,
                COUNT(*) FILTER (WHERE dibujado = false OR dibujado IS NULL) AS sin_geometria
            FROM catastro.v_ficha_predial;
        """)
        resumen = cur.fetchone()

        # Estado documental / expediente integral
        cur.execute("""
            SELECT
                COUNT(*) AS total_expedientes,
                COUNT(*) FILTER (WHERE tiene_documentos = true) AS con_documentos,
                COUNT(*) FILTER (WHERE tiene_documentos = false OR tiene_documentos IS NULL) AS sin_documentos,
                COUNT(*) FILTER (WHERE tiene_cartografia = true) AS con_cartografia,
                COUNT(*) FILTER (WHERE tiene_construccion = true) AS con_construccion,
                COUNT(*) FILTER (WHERE tiene_avaluo = true) AS con_avaluo,
                COUNT(*) FILTER (WHERE tiene_inspeccion = true) AS con_inspeccion,
                COUNT(*) FILTER (WHERE tiene_rppc = true) AS con_rppc,
                COUNT(*) FILTER (WHERE tiene_fotografia = true) AS con_fotografia,
                COUNT(*) FILTER (WHERE tiene_cedula = true) AS con_cedula,
                COUNT(*) FILTER (WHERE tiene_historial = true) AS con_historial
            FROM catastro.v_expediente_integral;
        """)
        expediente = cur.fetchone()

        # Top colonias por adeudo
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(colonia), ''), 'SIN COLONIA') AS colonia,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(colonia), ''), 'SIN COLONIA')
            ORDER BY COALESCE(SUM(adeudo_total), 0) DESC
            LIMIT 10;
        """)
        top_colonias = cur.fetchall()

        # Resumen por uso predial
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(descripcion_uso), ''), 'SIN USO') AS uso,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(descripcion_uso), ''), 'SIN USO')
            ORDER BY COUNT(*) DESC
            LIMIT 10;
        """)
        por_uso = cur.fetchall()

        # Resumen por zona homogénea
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(zonah), ''), 'SIN ZONA') AS zona_homogenea,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(zonah), ''), 'SIN ZONA')
            ORDER BY COALESCE(SUM(adeudo_total), 0) DESC
            LIMIT 10;
        """)
        por_zona = cur.fetchall()

        cur.close()
        conn.close()

        total_predios = resumen["total_predios"] or 0
        con_adeudo = resumen["con_adeudo"] or 0
        sin_adeudo = resumen["sin_adeudo"] or 0
        dibujados = resumen["dibujados"] or 0

        return {
            "total_predios": total_predios,
            "con_adeudo": con_adeudo,
            "sin_adeudo": sin_adeudo,
            "porcentaje_con_adeudo": round((con_adeudo / total_predios) * 100, 2) if total_predios > 0 else 0,
            "porcentaje_sin_adeudo": round((sin_adeudo / total_predios) * 100, 2) if total_predios > 0 else 0,
            "adeudo_total": float(resumen["adeudo_total"] or 0),
            "adeudo_2026": float(resumen["adeudo_2026"] or 0),
            "valor_catastral_total": float(resumen["valor_catastral_total"] or 0),
            "superficie_documental_total": float(resumen["superficie_documental_total"] or 0),
            "superficie_fisica_total": float(resumen["superficie_fisica_total"] or 0),
            "superficie_construccion_total": float(resumen["superficie_construccion_total"] or 0),
            "dibujados": dibujados,
            "sin_geometria": resumen["sin_geometria"] or 0,
            "cobertura_cartografica": round((dibujados / total_predios) * 100, 2) if total_predios > 0 else 0,
            "expediente": {
                "total_expedientes": expediente["total_expedientes"] or 0,
                "con_documentos": expediente["con_documentos"] or 0,
                "sin_documentos": expediente["sin_documentos"] or 0,
                "con_cartografia": expediente["con_cartografia"] or 0,
                "con_construccion": expediente["con_construccion"] or 0,
                "con_avaluo": expediente["con_avaluo"] or 0,
                "con_inspeccion": expediente["con_inspeccion"] or 0,
                "con_rppc": expediente["con_rppc"] or 0,
                "con_fotografia": expediente["con_fotografia"] or 0,
                "con_cedula": expediente["con_cedula"] or 0,
                "con_historial": expediente["con_historial"] or 0
            },
            "top_colonias_adeudo": filas_a_lista(top_colonias),
            "resumen_por_uso": filas_a_lista(por_uso),
            "resumen_por_zona": filas_a_lista(por_zona)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))