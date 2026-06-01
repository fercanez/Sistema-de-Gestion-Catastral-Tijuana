ACL_BACKEND = {
    "admin": {
        "administrar_usuarios", "ver_auditoria", "editar_cartografia",
        "editar_catastro", "editar_fiscal", "ver_fiscal", "ver_expediente",
        "ver_documentos", "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "supervisor": {
        "ver_auditoria", "editar_cartografia", "editar_catastro",
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "cartografia": {
        "editar_cartografia", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "catastro": {
        "editar_catastro", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "fiscalizacion": {
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "consulta": {
        "ver_expediente", "ver_documentos", "ver_dashboard",
        "exportar_pdf", "exportar_excel", "consulta"
    }
}


def normalizar_rol(rol):
    return (rol or "consulta").strip().lower()


def permisos_por_rol(rol):
    rol_norm = normalizar_rol(rol)
    return sorted(list(ACL_BACKEND.get(rol_norm, ACL_BACKEND["consulta"])))


def usuario_tiene_permiso(usuario_actual: dict, permiso: str) -> bool:
    rol = normalizar_rol(usuario_actual.get("rol"))
    return permiso in ACL_BACKEND.get(rol, ACL_BACKEND["consulta"])
