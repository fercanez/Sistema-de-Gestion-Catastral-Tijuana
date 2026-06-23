"""Punto de entrada de la API catastral. Registra routers por modulo."""
import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

import config  # noqa: F401 - valida SECRET_KEY al importar
from database import get_conn, asegurar_tabla_predio_condominio
from auth.sessions import ensure_sesiones_table
from auth.routes import router as auth_router
from routers.movimientos import router as movimientos_router
from routers.movimientos_legacy import router as movimientos_legacy_router
from routers.padron import router as padron_router
from routers.expediente import router as expediente_router
from routers.admin import router as admin_router
from routers.propietarios import router as propietarios_router
from routers.catalogos import router as catalogos_router
from routers.rppc import router as rppc_router

VISOR_DIR = "/var/www/catastro"
VISOR_JS_DIR = os.path.join(VISOR_DIR, "js")
VISOR_CSS_DIR = os.path.join(VISOR_DIR, "css")
VISOR_IMG_DIR = os.path.join(VISOR_DIR, "img")

app = FastAPI(
    title="API Sistema de Gestion Catastral BC",
    version="0.4.3",
    root_path="/api/catastro",
)

app.include_router(auth_router)
app.include_router(movimientos_router)
app.include_router(movimientos_legacy_router)
app.include_router(padron_router)
app.include_router(expediente_router)
app.include_router(admin_router)
app.include_router(propietarios_router)
app.include_router(catalogos_router)
app.include_router(rppc_router)

logger = logging.getLogger("catastro-api")


@app.on_event("startup")
def startup_migraciones():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                asegurar_tabla_predio_condominio(cur, conn)
                ensure_sesiones_table(cur)
                conn.commit()
    except Exception as e:
        logger.exception("Error en migraciones de arranque: %s", e)


@app.get("/")
def root():
    return {
        "sistema": "API Sistema de Gestión Catastral BC",
        "estado": "operando",
        "version": "0.4.4",
        "propietarios_fusionar": True,
        "propietarios_fusionar_padron": True,
        "propietarios_sync_padron": True,
        "titular_directo_padron": True,
        "padron_sync_masivo": True,
        "titular_padron_masivo": True,
        "propietarios_delete": True,
        "propietarios_domicilio": True,
        "catalogo_calles": True,
        "catalogo_colonias": True,
        "catalogos_mantenimiento": True,
        "analisis_condominios": True,
        "condominio_modalidad": True,
        "condominio_clasificacion_masiva": True,
        "alta_clave_regimen_obligatorio": True,
        "tipos_tenencia_padron": True,
        "tenencia_predio_put": True,
        "tenencia_prefijo_clave": True,
        "ficha_titular_vigente": True,
        "fotografias_expediente": True,
        "fotografias_borra_disco": True,
        "numeros_oficiales_cercanos": True,
        "carta_urbana_2040": True,
        "pducp_carta_urbana": True,
    }


@app.get("/visor")
def visor_sin_slash(request: Request):
    return RedirectResponse(url=str(request.url).rstrip("/") + "/", status_code=307)


@app.get("/visor/")
def visor():
    return FileResponse(f"{VISOR_DIR}/index.html")


@app.get("/visor/logomxli.png")
def servir_logo():
    return FileResponse(f"{VISOR_DIR}/logomxli.png", media_type="image/png")


@app.get("/visor/img/{filename}")
def servir_img_visor(filename: str):
    return FileResponse(
        _archivo_visor_seguro(VISOR_IMG_DIR, filename),
        media_type="image/png",
    )


def _archivo_visor_seguro(base_dir: str, filename: str) -> str:
    """Resuelve ruta bajo base_dir; rechaza traversal."""
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Nombre de archivo no válido")
    path = os.path.join(base_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Archivo no encontrado: {filename}")
    return path


@app.get("/visor/js/{filename}")
def servir_js_modular(filename: str):
    return FileResponse(
        _archivo_visor_seguro(VISOR_JS_DIR, filename),
        media_type="application/javascript; charset=utf-8",
    )


@app.get("/visor/css/{filename}")
def servir_css_modular(filename: str):
    return FileResponse(
        _archivo_visor_seguro(VISOR_CSS_DIR, filename),
        media_type="text/css; charset=utf-8",
    )


@app.get("/visor/_diag/static")
def diag_visor_static():
    """Diagnóstico rápido: ¿existen js/ y css/ en el visor?"""
    js_files = sorted(os.listdir(VISOR_JS_DIR)) if os.path.isdir(VISOR_JS_DIR) else []
    css_files = sorted(os.listdir(VISOR_CSS_DIR)) if os.path.isdir(VISOR_CSS_DIR) else []
    return {
        "visor_dir": VISOR_DIR,
        "js_dir": VISOR_JS_DIR,
        "css_dir": VISOR_CSS_DIR,
        "js_dir_exists": os.path.isdir(VISOR_JS_DIR),
        "css_dir_exists": os.path.isdir(VISOR_CSS_DIR),
        "index_exists": os.path.isfile(os.path.join(VISOR_DIR, "index.html")),
        "js_count": len(js_files),
        "css_count": len(css_files),
        "js_files": js_files[:20],
        "css_files": css_files[:20],
    }


# Respaldo: archivos monolíticos legacy (si aún existen en el servidor).
@app.get("/visor/catastro.css")
def servir_css_legacy():
    path = f"{VISOR_DIR}/catastro.css"
    if os.path.isfile(path):
        return FileResponse(path, media_type="text/css")
    raise HTTPException(status_code=404, detail="catastro.css no encontrado")


@app.get("/visor/catastro.js")
def servir_js_legacy():
    path = f"{VISOR_DIR}/catastro.js"
    if os.path.isfile(path):
        return FileResponse(path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="catastro.js no encontrado")


@app.get("/visor/movimientos_padron_v57.js")
def servir_movimientos_js():
    return FileResponse(f"{VISOR_DIR}/movimientos_padron_v57.js", media_type="application/javascript")