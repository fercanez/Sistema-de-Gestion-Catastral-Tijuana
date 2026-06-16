"""Dependencias FastAPI basadas en permisos ACL (no solo rol JWT)."""
from fastapi import Depends, HTTPException, status

from auth.acl import usuario_tiene_permiso
from auth.dependencies import obtener_usuario_actual


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


def exigir_permiso_usuario(usuario_actual: dict, permiso: str, detalle: str | None = None) -> None:
    if not usuario_tiene_permiso(usuario_actual, permiso):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detalle or f"Permiso requerido: {permiso}",
        )


def validar_permiso_tipo_movimiento(usuario_actual: dict, tipo_movimiento: str) -> None:
    tipo = (tipo_movimiento or "").strip().upper()
    if tipo == "CAMBIO_TITULARIDAD":
        exigir_permiso_usuario(usuario_actual, "editar_titularidad")
    elif tipo == "CAMBIO_NOMBRE":
        exigir_permiso_usuario(usuario_actual, "editar_nombre_contribuyente")


permiso_consulta_catastro = requerir_alguno(
    "consulta",
    "ver_expediente",
    "editar_catastro",
    "editar_titularidad",
    "editar_nombre_contribuyente",
    "solicitar_movimientos",
    "aplicar_movimientos",
)
