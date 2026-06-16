import json
import time
import urllib.request
import urllib.error
from database import get_conn

LIMITE = 500
PAUSA_SEGUNDOS = 1.5
API_BASE = "http://127.0.0.1:9000"


def obtener_token():
    data = json.dumps({"usuario": "canez", "password": "012170"}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/login",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["access_token"]


def obtener_claves_pendientes(limite: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT clave_catastral
                FROM catalogos.padron_2026
                WHERE folio_real IS NULL
                  AND clave_catastral IS NOT NULL
                  AND TRIM(clave_catastral) <> ''
                  AND COALESCE(folio_real_fuente, '') NOT IN ('RPPC_SIN_FOLIO', 'RPPC_ERROR')
                  AND clave_catastral ~ '^[C-Z]{2,3}[0-9]{6}$'
                  AND LEFT(clave_catastral, 2) NOT IN ('A8','A9')
                ORDER BY clave_catastral
                LIMIT %s;
                """,
                (limite,),
            )
            return [r["clave_catastral"] for r in cur.fetchall()]


def marcar_error(clave: str, estado: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE catalogos.padron_2026
                SET folio_real_fuente = %s,
                    folio_real_fecha_actualizacion = now()
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
                """,
                (estado[:50], clave),
            )
            conn.commit()


def resolver_clave(token: str, clave: str):
    req = urllib.request.Request(
        f"{API_BASE}/rppc/resolver/clave/{clave}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"detail": body[:300]}
    except Exception as e:
        return 0, {"detail": str(e)}


def main():
    token = obtener_token()
    claves = obtener_claves_pendientes(LIMITE)

    print(f"Pendientes a procesar: {len(claves)}")

    ok = 0
    fail = 0

    for i, clave in enumerate(claves, start=1):
        status, data = resolver_clave(token, clave)

        if status == 200 and data.get("folio_real"):
            ok += 1
            print(f"[{i}/{len(claves)}] OK {clave} -> folio {data.get('folio_real')} doc {data.get('doc_tramite_id')}")
        else:
            fail += 1
            detalle = str(data.get("detail", ""))[:180]
            if "sin folio" in detalle.lower() or "ninguna trae folio" in detalle.lower():
                marcar_error(clave, "RPPC_SIN_FOLIO")
            elif "DOC_TRAMITE_ID" in detalle:
                marcar_error(clave, "RPPC_SIN_DOC")
            else:
                marcar_error(clave, "RPPC_ERROR")
            print(f"[{i}/{len(claves)}] FAIL {clave} HTTP {status}: {detalle}")

        time.sleep(PAUSA_SEGUNDOS)

    print("Resumen:")
    print("OK:", ok)
    print("FAIL:", fail)


if __name__ == "__main__":
    main()
