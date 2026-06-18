import json
import os
import time
import urllib.parse
import urllib.request
import urllib.error
from database import get_conn

# Cantidad por corrida. Puedes cambiarlo a 100, 500, 1000, etc.
LIMITE = int(os.getenv("RPPC_BACKFILL_LIMITE", "500"))

# Pausa entre predios para no saturar RPPC.
PAUSA_SEGUNDOS = float(os.getenv("RPPC_BACKFILL_PAUSA", "1.5"))

# API local FastAPI.
API_BASE = os.getenv("RPPC_BACKFILL_API_BASE", "http://127.0.0.1:9000").rstrip("/")

# Credenciales SGC para obtener JWT local.
SGC_USUARIO = os.getenv("SGC_USUARIO", "canez")
SGC_PASSWORD = os.getenv("SGC_PASSWORD", "012170")

# Si quieres limitar por prefijos, ejemplo:
# export RPPC_BACKFILL_PREFIJOS="SP,ST,CV,BDM"
PREFIJOS = [
    x.strip().upper()
    for x in os.getenv("RPPC_BACKFILL_PREFIJOS", "").split(",")
    if x.strip()
]


def obtener_token() -> str:
    data = json.dumps({
        "usuario": SGC_USUARIO,
        "password": SGC_PASSWORD,
        "tipo_sesion": "servicio",
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/login",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["access_token"]


def obtener_claves_pendientes(limite: int) -> list[str]:
    where_prefijos = ""
    params: list[object] = []

    if PREFIJOS:
        where_prefijos = "AND (" + " OR ".join(["clave_catastral LIKE %s" for _ in PREFIJOS]) + ")"
        params.extend([f"{p}%" for p in PREFIJOS])

    params.append(limite)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT clave_catastral
                FROM catalogos.padron_2026
                WHERE folio_real IS NULL
                  AND clave_catastral IS NOT NULL
                  AND TRIM(clave_catastral) <> ''
                  AND COALESCE(folio_real_fuente, '') NOT IN (
                      'RPPC_SIN_FOLIO',
                      'RPPC_SIN_DOC',
                      'RPPC_ERROR',
                      'RPPC_PDF_SIN_FOLIO',
                      'RPPC_NO_JSON'
                  )
                  AND clave_catastral ~ '^[A-Z]{{2,3}}[0-9]{{6}}$'
                  AND LEFT(clave_catastral, 2) NOT IN ('A8','A9')
                  {where_prefijos}
                ORDER BY clave_catastral
                LIMIT %s;
                """,
                tuple(params),
            )
            return [r["clave_catastral"] for r in cur.fetchall()]


def marcar_estado(clave: str, estado: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE catalogos.padron_2026
                SET folio_real_fuente = %s,
                    folio_real_fecha_actualizacion = now()
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND folio_real IS NULL;
                """,
                (estado[:50], clave),
            )
            conn.commit()


def consultar_folio_local(clave: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    NULLIF(NULLIF(TRIM(folio_real::text), ''), '0') AS folio_real,
                    folio_real_fuente,
                    folio_real_fecha_actualizacion
                FROM catalogos.padron_2026
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                LIMIT 1;
                """,
                (clave,),
            )
            return cur.fetchone()


def request_json(token: str, url: str, timeout: int = 90):
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.getcode(), json.loads(raw)
            except Exception:
                return resp.getcode(), {"detail": raw[:300], "_raw_no_json": True}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"detail": body[:300], "_raw_no_json": True}
    except Exception as e:
        return 0, {"detail": str(e)}


def resolver_clave(token: str, clave: str):
    url = f"{API_BASE}/rppc/resolver/clave/{urllib.parse.quote(clave)}"
    return request_json(token, url, timeout=90)


def construir_pdf_url(pdf_url: str, clave: str) -> str:
    if not pdf_url:
        return ""

    if pdf_url.startswith("http://") or pdf_url.startswith("https://"):
        url = pdf_url
    else:
        url = f"{API_BASE}{'' if pdf_url.startswith('/') else '/'}{pdf_url}"

    # Si el PDF viene por partida, conviene mandar la clave para que el backend pueda
    # guardar folio_real extraído del PDF en el registro correcto.
    if "/rppc/pdf/partida/" in url and "clave_catastral=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}clave_catastral={urllib.parse.quote(clave)}"

    return url


def descargar_pdf_para_extraer_folio(token: str, clave: str, pdf_url: str):
    url = construir_pdf_url(pdf_url, clave)
    if not url:
        return 0, "sin pdf_url"

    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/pdf,*/*"},
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            content = resp.read(20)
            ctype = resp.headers.get("Content-Type", "")
            if resp.getcode() == 200 and (b"%PDF" in content or "pdf" in ctype.lower()):
                return 200, "PDF descargado"
            return resp.getcode(), f"Respuesta no PDF: {ctype}"
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body[:250]
    except Exception as e:
        return 0, str(e)


def clasificar_error(detalle: str) -> str:
    d = (detalle or "").lower()

    if "doc_tramite_id" in d:
        return "RPPC_SIN_DOC"
    if "sin folio" in d or "ninguna trae folio" in d or "folio_real válido" in d:
        return "RPPC_SIN_FOLIO"
    if "no json" in d or "expecting value" in d:
        return "RPPC_NO_JSON"
    return "RPPC_ERROR"


def main():
    token = obtener_token()
    claves = obtener_claves_pendientes(LIMITE)

    print(f"Pendientes a procesar: {len(claves)}")
    if PREFIJOS:
        print(f"Prefijos filtrados: {', '.join(PREFIJOS)}")

    ok = 0
    ok_pdf = 0
    fail = 0

    for i, clave in enumerate(claves, start=1):
        status, data = resolver_clave(token, clave)

        # Si expiró el JWT durante una corrida larga, renovamos una vez y repetimos.
        if status in (401, 403):
            token = obtener_token()
            status, data = resolver_clave(token, clave)

        folio = data.get("folio_real") or data.get("FOLIO_REAL")
        pdf_url = data.get("pdf_url") or data.get("PDF_URL")
        tipo_doc = data.get("tipo_documento") or data.get("TIPO_DOCUMENTO") or ""
        doc_id = data.get("doc_tramite_id") or data.get("DOC_TRAMITE_ID")

        if status == 200 and folio:
            ok += 1
            print(
                f"[{i}/{len(claves)}] OK {clave} -> folio {folio} "
                f"tipo={tipo_doc or '-'} doc={doc_id or '-'} pdf={pdf_url or '-'}"
            )

        elif status == 200 and pdf_url:
            # El resolver encontró PDF alternativo, pero no trajo folio.
            # Descargamos el PDF para que el backend intente extraer FOLIO REAL y guardarlo.
            pdf_status, pdf_msg = descargar_pdf_para_extraer_folio(token, clave, pdf_url)
            row = consultar_folio_local(clave)
            folio_local = row.get("folio_real") if row else None

            if folio_local:
                ok_pdf += 1
                print(
                    f"[{i}/{len(claves)}] OK_PDF {clave} -> folio {folio_local} "
                    f"tipo={tipo_doc or '-'} pdf_status={pdf_status}"
                )
            else:
                fail += 1
                marcar_estado(clave, "RPPC_PDF_SIN_FOLIO")
                print(
                    f"[{i}/{len(claves)}] PDF_SIN_FOLIO {clave} "
                    f"HTTP {status}, pdf_status={pdf_status}: {pdf_msg}"
                )

        else:
            fail += 1
            detalle = str(data.get("detail", ""))[:220]
            estado = clasificar_error(detalle)
            marcar_estado(clave, estado)
            print(f"[{i}/{len(claves)}] FAIL {clave} HTTP {status} {estado}: {detalle}")

        time.sleep(PAUSA_SEGUNDOS)

    print("Resumen:")
    print("OK_RESOLVER:", ok)
    print("OK_PDF_EXTRACT:", ok_pdf)
    print("FAIL:", fail)


if __name__ == "__main__":
    main()
