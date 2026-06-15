import json
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime

from database import get_conn
from routers.rppc import (
    _clave_sgc_a_rppc,
    _consultar_inmuebles_por_clave,
    _elegir_mejor_inmueble_rppc,
    _normalizar_numero,
)

LIMITE = 100
PAUSA_SEGUNDOS = 1.5


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
                ORDER BY clave_catastral
                LIMIT %s;
                """,
                (limite,),
            )
            return [r["clave_catastral"] for r in cur.fetchall()]


def guardar_resultado(clave: str, folio_real: int | None, estado: str, detalle: str = ""):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if folio_real:
                cur.execute(
                    """
                    UPDATE catalogos.padron_2026
                    SET folio_real = %s,
                        folio_real_fuente = 'RPPC_BACKFILL',
                        folio_real_fecha_actualizacion = now()
                    WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s));
                    """,
                    (str(folio_real), clave),
                )
            else:
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


def procesar_clave(clave: str):
    clave_rppc = _clave_sgc_a_rppc(clave)
    inmuebles = _consultar_inmuebles_por_clave(clave)

    elegido = _elegir_mejor_inmueble_rppc(inmuebles, clave)

    if not elegido:
        guardar_resultado(clave, None, "RPPC_SIN_FOLIO")
        return {
            "clave": clave,
            "clave_rppc": clave_rppc,
            "ok": False,
            "estado": "sin_folio",
            "total": len(inmuebles),
        }

    folio = _normalizar_numero(elegido.get("FOLIO_REAL"))
    if not folio:
        guardar_resultado(clave, None, "RPPC_SIN_FOLIO")
        return {
            "clave": clave,
            "clave_rppc": clave_rppc,
            "ok": False,
            "estado": "folio_invalido",
            "total": len(inmuebles),
        }

    guardar_resultado(clave, folio, "RPPC_BACKFILL")
    return {
        "clave": clave,
        "clave_rppc": clave_rppc,
        "ok": True,
        "folio_real": folio,
        "total": len(inmuebles),
    }


def main():
    claves = obtener_claves_pendientes(LIMITE)
    print(f"Pendientes a procesar: {len(claves)}")

    ok = 0
    fail = 0

    for i, clave in enumerate(claves, start=1):
        try:
            r = procesar_clave(clave)
            print(f"[{i}/{len(claves)}] {json.dumps(r, ensure_ascii=False)}")
            if r.get("ok"):
                ok += 1
            else:
                fail += 1
        except Exception as e:
            fail += 1
            guardar_resultado(clave, None, "RPPC_ERROR")
            print(f"[{i}/{len(claves)}] ERROR {clave}: {e}")

        time.sleep(PAUSA_SEGUNDOS)

    print("Resumen:")
    print("OK:", ok)
    print("FAIL:", fail)


if __name__ == "__main__":
    main()