"""Punto de entrada de la API catastral. Registra routers por modulo."""
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

import config  # noqa: F401 - valida SECRET_KEY al importar
from database import get_conn, asegurar_tabla_predio_condominio
from auth.routes import router as auth_router
from routers.movimientos import router as movimientos_router
from routers.movimientos_legacy import router as movimientos_legacy_router
from routers.padron import router as padron_router
from routers.expediente import router as expediente_router
from routers.admin import router as admin_router
from routers.propietarios import router as propietarios_router
from routers.catalogos import router as catalogos_router

VISOR_DIR = "/var/www/catastro"

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


@app.on_event("startup")
def startup_migraciones():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                asegurar_tabla_predio_condominio(cur, conn)
    except Exception:
        pass


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
    }


@app.get("/visor")
def visor_sin_slash(request: Request):
    return RedirectResponse(url=str(request.url).rstrip("/") + "/", status_code=307)


@app.get("/visor/")
def visor():
    return FileResponse(f"{VISOR_DIR}/index.html")


@app.get("/visor/catastro.css")
def servir_css():
    return FileResponse(f"{VISOR_DIR}/catastro.css", media_type="text/css")


@app.get("/visor/catastro.js")
def servir_js():
    return FileResponse(f"{VISOR_DIR}/catastro.js", media_type="application/javascript")


@app.get("/visor/movimientos_padron_v57.js")
def servir_movimientos_js():
    return FileResponse(f"{VISOR_DIR}/movimientos_padron_v57.js", media_type="application/javascript")


@app.get("/visor/logomxli.png")
def servir_logo():
    return FileResponse(f"{VISOR_DIR}/logomxli.png", media_type="image/png")


# Montar archivos estaticos al final para no bloquear rutas API.
app.mount(
    "/visor",
    StaticFiles(directory=VISOR_DIR, html=True),
    name="visor",
)