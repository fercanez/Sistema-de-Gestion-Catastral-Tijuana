#!/usr/bin/env python3
"""
Backfill masivo RPPC — padrón completo Tijuana (backend directo, sin HTTP).

Ejecuta la misma lógica que el visor (_obtener_folio_por_clave, cascada unidad, resolver)
directamente en el proceso Python de la API.

IMPORTANTE: usar el Python del venv de la API (no el python3 del sistema):

  ./venv/bin/python3 scripts/rppc_backfill_masivo_tijuana.py --resumen

  # o el wrapper:
  ./scripts/rppc_backfill_masivo_tijuana.sh --resumen

Uso en servidor:

  # Resumen del padrón
  python3 scripts/rppc_backfill_masivo_tijuana.py --resumen

  # Lote de 100 claves sin folio (todo el padrón, sin filtros geográficos)
  python3 scripts/rppc_backfill_masivo_tijuana.py --limite 100 --nivel folio

  # Loop hasta agotar pendientes (cron nocturno)
  python3 scripts/rppc_backfill_masivo_tijuana.py --loop --limite 200 --nivel folio --pausa 2

  # Solo resolver folio+partida (más lento)
  python3 scripts/rppc_backfill_masivo_tijuana.py --limite 20 --nivel resolver

Alternativa vía API (admin JWT):
  POST /rppc/backfill/lote  {"limite": 100, "nivel": "folio"}
  GET  /rppc/backfill/estado
  GET  /rppc/backfill/resumen

Variables de entorno:
  RPPC_BACKFILL_LIMITE   default 100
  RPPC_BACKFILL_PAUSA    default 2.0
  RPPC_BACKFILL_LOG      .runtime/rppc_backfill.jsonl
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _reexec_con_venv_si_aplica() -> None:
    """Reinicia el script con venv/bin/python3 si existe (mismo intérprete que uvicorn)."""
    venv_py = ROOT / "venv" / "bin" / "python3"
    if not venv_py.is_file():
        return
    actual = Path(sys.executable).resolve()
    if actual == venv_py.resolve():
        return
    os.execv(str(venv_py), [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]])


_reexec_con_venv_si_aplica()

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.rppc_backfill_masivo import (  # noqa: E402
    BackfillLoteConfig,
    DEFAULT_LOG,
    ejecutar_lote_sincrono,
    listar_claves_pendientes,
    resumen_padron_rppc,
)


def parse_args() -> argparse.Namespace:
    import os

    parser = argparse.ArgumentParser(
        description="Backfill RPPC masivo — todo el padrón Tijuana (backend directo)"
    )
    parser.add_argument("--resumen", action="store_true", help="Solo mostrar conteos del padrón")
    parser.add_argument("--limite", type=int, default=int(os.getenv("RPPC_BACKFILL_LIMITE", "100")))
    parser.add_argument("--pausa", type=float, default=float(os.getenv("RPPC_BACKFILL_PAUSA", "2.0")))
    parser.add_argument(
        "--nivel",
        choices=("folio", "resolver", "pdf"),
        default=os.getenv("RPPC_BACKFILL_NIVEL", "folio"),
    )
    parser.add_argument("--loop", action="store_true", help="Repetir lotes hasta que no haya pendientes")
    parser.add_argument("--max-lotes", type=int, default=0, help="Con --loop, máximo de lotes (0=sin tope)")
    parser.add_argument("--reintentar-errores", action="store_true")
    parser.add_argument("--prefijos", help="Opcional: filtrar por prefijos (coma). Default: todo el padrón")
    parser.add_argument("--manzana", help="Opcional: filtrar por manzana")
    parser.add_argument("--colonia-like", help="Opcional: filtrar colonia ILIKE")
    parser.add_argument("--solo-condominio", action="store_true")
    parser.add_argument("--solo-unidades", action="store_true")
    parser.add_argument("--archivo-claves", type=Path, help="Archivo con claves explícitas")
    parser.add_argument("--dry-run", action="store_true", help="Listar claves del lote sin procesar")
    parser.add_argument("--log", default=os.getenv("RPPC_BACKFILL_LOG", DEFAULT_LOG))
    return parser.parse_args()


def _cfg_desde_args(args: argparse.Namespace) -> BackfillLoteConfig:
    claves = None
    if args.archivo_claves:
        claves = [
            line.strip().split(",")[0].strip()
            for line in args.archivo_claves.read_text(encoding="utf-8-sig").splitlines()
            if line.strip() and not line.startswith("#")
        ]
    prefijos = []
    if args.prefijos:
        prefijos = [p.strip().upper() for p in args.prefijos.split(",") if p.strip()]

    return BackfillLoteConfig(
        limite=args.limite,
        nivel=args.nivel,
        pausa_seg=args.pausa,
        reintentar_errores=args.reintentar_errores,
        prefijos=prefijos,
        manzana=args.manzana,
        colonia_like=args.colonia_like,
        solo_condominio=args.solo_condominio,
        solo_unidades=args.solo_unidades,
        claves=claves,
        log_path=args.log,
    )


def main() -> int:
    args = parse_args()

    if args.resumen:
        data = resumen_padron_rppc()
        print(f"Padrón elegible:     {data['total_elegibles']:,}")
        print(f"Con folio_real:      {data['con_folio']:,} ({data['porcentaje_con_folio']}%)")
        print(f"Pendientes:          {data['pendientes']:,}")
        print(f"Marcados error RPPC: {data['marcados_error']:,}")
        return 0

    cfg = _cfg_desde_args(args)

    if args.dry_run:
        claves = listar_claves_pendientes(cfg)
        print(f"Claves en lote: {len(claves)}")
        for c in claves:
            print(c)
        return 0

    lotes = 0
    while True:
        resumen_antes = resumen_padron_rppc()
        print(
            f"\n=== Lote {lotes + 1} | pendientes={resumen_antes['pendientes']:,} "
            f"| nivel={cfg.nivel} | limite={cfg.limite} ==="
        )
        estado = ejecutar_lote_sincrono(cfg)
        print(
            f"Procesadas: {estado.get('procesadas')} | OK: {estado.get('ok')} | "
            f"FAIL: {estado.get('fail')} | última: {estado.get('ultima_clave')}"
        )
        if estado.get("ultimo_error"):
            print(f"Último error: {estado['ultimo_error'][:220]}")

        lotes += 1
        resumen_despues = resumen_padron_rppc()
        if not args.loop:
            break
        if resumen_despues["pendientes"] <= 0:
            print("No quedan pendientes.")
            break
        if args.max_lotes and lotes >= args.max_lotes:
            print(f"Tope de lotes alcanzado ({args.max_lotes}).")
            break
        if estado.get("cookie_ok") is False:
            print("Cookie RPPC inválida — renueve .runtime/rppc_cookie.txt")
            return 2
        if estado.get("procesadas", 0) == 0:
            print("Lote vacío — deteniendo.")
            break
        time.sleep(3)

    final = resumen_padron_rppc()
    print("\nResumen final:")
    print(f"  Con folio:   {final['con_folio']:,} / {final['total_elegibles']:,}")
    print(f"  Pendientes:  {final['pendientes']:,}")
    print(f"  Errores:     {final['marcados_error']:,}")
    if args.log:
        print(f"  Bitácora:    {args.log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
