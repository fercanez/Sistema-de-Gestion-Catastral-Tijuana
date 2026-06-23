"""Dependencias FastAPI basadas en permisos ACL (no solo rol JWT)."""
from fastapi import Depends, HTTPException, status

from auth.acl import usuario_tiene_permiso
from auth.dependencies import obtener_usuario_actual, requerir_permiso

PERM_PESTANA_ARCHIVO = "ver_pestana_archivo"
PERM_PESTANA_CONTROL_URBANO = "ver_pestana_control_urbano"
PERM_PESTANA_RPPC = "ver_pestana_rppc"
PERM_PESTANA_ZONA_HOMOGENEA = "ver_pestana_zona_homogenea"

requerir_pestana_archivo = requerir_permiso(PERM_PESTANA_ARCHIVO)
requerir_pestana_control_urbano = requerir_permiso(PERM_PESTANA_CONTROL_URBANO)
requerir_pestana_rppc = requerir_permiso(PERM_PESTANA_RPPC)
requerir_pestana_zona_homogenea = requerir_permiso(PERM_PESTANA_ZONA_HOMOGENEA)


def permiso_documento_por_ruta(ruta_relativa: str) -> str:
    """Resuelve el permiso de pestaña según la ruta relativa bajo /documentos/{clave}/."""
    ruta = str(ruta_relativa or "").replace("\\", "/").strip().lstrip("/").lower()
    if ruta.startswith("control_urbano/"):
        return PERM_PESTANA_CONTROL_URBANO
    if ruta.startswith("rppc/"):
        return PERM_PESTANA_RPPC
    return PERM_PESTANA_ARCHIVO


def exigir_permiso_usuario(usuario_actual: dict, permiso: str, detalle: str | None = None) -> None:
    if not usuario_tiene_permiso(usuario_actual, permiso):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detalle or f"Permiso requerido: {permiso}",
        )


def exigir_permiso_documento_ruta(usuario_actual: dict, ruta_relativa: str) -> None:
    permiso = permiso_documento_por_ruta(ruta_relativa)
    exigir_permiso_usuario(
        usuario_actual,
        permiso,
        detalle=f"Permiso requerido para descargar documento ({permiso})",
    )


def validar_permiso_tipo_movimiento(usuario_actual: dict, tipo_movimiento: str) -> None:
    tipo = (tipo_movimiento or "").strip().upper()
    if tipo == "CAMBIO_TITULARIDAD":
        exigir_permiso_usuario(usuario_actual, "editar_titularidad")
    elif tipo == "CAMBIO_NOMBRE":
        exigir_permiso_usuario(usuario_actual, "editar_nombre_contribuyente")


def requerir_alguno(*permisos: str):
    permisos_norm = tuple(p for p in permisos if p)

    def validador(usuario_actual: dict = Depends(obtener_usuario_actual)):
        if any(usuario_tiene_permiso(usuario_actual, p) for p in permisos_norm):
            return usuario_actual
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permiso requerido: {' o '.join(permisos_norm)}",
        )

    return validador


permiso_consulta_catastro = requerir_alguno(
    "consulta",
    "ver_expediente",
    "editar_catastro",
    "editar_titularidad",
    "editar_nombre_contribuyente",
    "solicitar_movimientos",
    "aplicar_movimientos",
)
