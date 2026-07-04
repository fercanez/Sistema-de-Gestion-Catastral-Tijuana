"""Importador de cartografía catastral.

Integra el importador SHP -> PostGIS al Sistema de Gestión Catastral BC.
Requiere que el script probado en servidor exista y sea ejecutable.

Variables opcionales en .env:
  IMPORTADOR_PREDIOS_SCRIPT=/opt/sgc-web/importador_shp/importador/importar_predios.sh
  IMPORTADOR_WORKDIR=/opt/catastro-tijuana-tools/importador_uploads
  IMPORTADOR_DB=geonode_data
  IMPORTADOR_SCHEMA=public
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

try:
    from auth.deps import require_roles
except Exception:  # compatibilidad si el proyecto usa otro helper de auth
    require_roles = None

try:
    from database import get_conn
except Exception:
    get_conn = None


router = APIRouter(prefix="/admin/cartografia", tags=["admin-cartografia"])

SCRIPT_PATH = os.getenv(
    "IMPORTADOR_PREDIOS_SCRIPT",
    "/opt/sgc-web/importador_shp/importador/importar_predios.sh",
)
WORKDIR = Path(os.getenv("IMPORTADOR_WORKDIR", "/opt/catastro-tijuana-tools/importador_uploads"))
PGDATABASE = os.getenv("IMPORTADOR_DB", "geonode_data")
SCHEMA_NAME = os.getenv("IMPORTADOR_SCHEMA", "public")

TABLAS_PERMITIDAS = {"predios_tijuana_prueba", "predios_tijuana"}


def _validar_tabla(tabla: str) -> str:
    tabla = (tabla or "").strip()
    if tabla not in TABLAS_PERMITIDAS:
        raise HTTPException(status_code=400, detail="Tabla destino no permitida")
    return tabla


def _limpiar_nombre(nombre: str) -> str:
    nombre = os.path.basename(nombre or "")
    if not nombre or nombre in {".", ".."}:
        raise HTTPException(status_code=400, detail="Nombre de archivo no válido")
    return nombre


def _extraer_uploads(files: List[UploadFile], destino: Path) -> Path:
    destino.mkdir(parents=True, exist_ok=True)

    for f in files:
        nombre = _limpiar_nombre(f.filename)
        path = destino / nombre
        with path.open("wb") as out:
            shutil.copyfileobj(f.file, out)

        if nombre.lower().endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                for member in z.infolist():
                    if member.is_dir():
                        continue
                    bn = os.path.basename(member.filename)
                    if not bn:
                        continue
                    ext = Path(bn).suffix.lower()
                    if ext not in {".shp", ".dbf", ".shx", ".prj", ".cpg", ".qmd"}:
                        continue
                    with z.open(member) as src, (destino / bn).open("wb") as out:
                        shutil.copyfileobj(src, out)

    shp_files = sorted(destino.glob("*.shp"))
    if not shp_files:
        raise HTTPException(status_code=400, detail="No se encontró archivo .shp")
    return shp_files[0]


@router.get("/importador-estado")
def importador_estado():
    script = Path(SCRIPT_PATH)
    return {
        "script": str(script),
        "script_existe": script.exists(),
        "script_ejecutable": os.access(script, os.X_OK) if script.exists() else False,
        "workdir": str(WORKDIR),
        "database": PGDATABASE,
        "schema": SCHEMA_NAME,
        "tablas_permitidas": sorted(TABLAS_PERMITIDAS),
    }


@router.post("/importar-predios")
async def importar_predios(
    files: List[UploadFile] = File(...),
    tabla: str = Form("predios_tijuana_prueba"),
    srid: int = Form(32611),
    confirmar_produccion: bool = Form(False),
):
    tabla = _validar_tabla(tabla)

    if tabla == "predios_tijuana" and not confirmar_produccion:
        raise HTTPException(
            status_code=400,
            detail="Debe confirmar explícitamente el reemplazo de producción",
        )

    script = Path(SCRIPT_PATH)
    if not script.exists():
        raise HTTPException(status_code=500, detail=f"No existe el importador: {script}")
    if not os.access(script, os.X_OK):
        raise HTTPException(status_code=500, detail=f"El importador no es ejecutable: chmod +x {script}")

    WORKDIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix="predios_", dir=str(WORKDIR)))

    try:
        shp = _extraer_uploads(files, tmp_dir)

        env = os.environ.copy()
        env["SRID"] = str(srid)
        env.setdefault("PGDATABASE", PGDATABASE)
        env.setdefault("SCHEMA_NAME", SCHEMA_NAME)

        cmd = [str(script), str(shp), tabla]
        proc = subprocess.run(
            cmd,
            cwd=str(tmp_dir),
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=60 * 30,
        )

        log = proc.stdout or ""
        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Importación falló con código {proc.returncode}\n{log[-3000:]}",
            )

        return {
            "ok": True,
            "tabla": f"{SCHEMA_NAME}.{tabla}",
            "srid": srid,
            "log": log,
        }
    finally:
        if os.getenv("IMPORTADOR_KEEP_UPLOADS", "NO").upper() != "YES":
            shutil.rmtree(tmp_dir, ignore_errors=True)


@router.get("/validar-tabla")
def validar_tabla(tabla: str):
    tabla = _validar_tabla(tabla)

    if get_conn is None:
        raise HTTPException(status_code=500, detail="database.get_conn no disponible")

    sql = f"""
    SELECT
      COUNT(*)::bigint AS registros,
      COALESCE(ST_SRID(geom), 0) AS srid,
      COALESCE(GeometryType(geom), 'N/D') AS tipo_geometria
    FROM {SCHEMA_NAME}.{tabla}
    GROUP BY 2,3
    ORDER BY 1 DESC
    LIMIT 1;
    """

    invalid_sql = f"""
    SELECT COUNT(*)::bigint
    FROM {SCHEMA_NAME}.{tabla}
    WHERE geom IS NULL OR NOT ST_IsValid(geom);
    """

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                row = cur.fetchone()
                cur.execute(invalid_sql)
                invalidas = cur.fetchone()[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo validar tabla: {e}")

    if not row:
        return {
            "tabla": f"{SCHEMA_NAME}.{tabla}",
            "registros": 0,
            "srid": None,
            "tipo_geometria": None,
            "invalidas": None,
        }

    return {
        "tabla": f"{SCHEMA_NAME}.{tabla}",
        "registros": row[0],
        "srid": row[1],
        "tipo_geometria": row[2],
        "invalidas": invalidas,
    }
