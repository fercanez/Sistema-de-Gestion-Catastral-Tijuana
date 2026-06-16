ACL_BACKEND = {
    "admin": {
        "administrar_usuarios", "ver_auditoria", "editar_cartografia",
        "editar_catastro", "editar_titularidad", "editar_nombre_contribuyente",
        "solicitar_movimientos", "aplicar_movimientos",
        "editar_fiscal", "ver_fiscal", "ver_expediente",
        "ver_documentos", "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "supervisor": {
        "ver_auditoria", "editar_cartografia", "editar_catastro",
        "editar_titularidad", "editar_nombre_contribuyente",
        "solicitar_movimientos", "aplicar_movimientos",
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "cartografia": {
        "editar_cartografia", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "catastro": {
        "editar_catastro", "editar_titularidad", "editar_nombre_contribuyente",
        "solicitar_movimientos",
        "ver_expediente", "ver_documentos",
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


def _permisos_fallback(rol):
    rol_norm = normalizar_rol(rol)
    return sorted(list(ACL_BACKEND.get(rol_norm, ACL_BACKEND["consulta"])))


def permisos_por_rol(rol):
    try:
        from database import get_conn
        from auth.acl_db import ensure_acl_db, permisos_por_rol_db

        conn = get_conn()
        cur = conn.cursor()
        ensure_acl_db(cur)
        conn.commit()
        perms = permisos_por_rol_db(cur, rol)
        cur.close()
        conn.close()
        return perms
    except Exception:
        return _permisos_fallback(rol)


def usuario_tiene_permiso(usuario_actual: dict, permiso: str) -> bool:
    rol = normalizar_rol(usuario_actual.get("rol"))
    return permiso in set(permisos_por_rol(rol))
