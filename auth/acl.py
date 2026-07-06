ACL_BACKEND = {
    "admin": {
        "administrar_usuarios", "ver_auditoria", "editar_cartografia",
        "editar_catastro", "editar_titularidad", "editar_nombre_contribuyente",
        "solicitar_movimientos", "aplicar_movimientos",
        "editar_fiscal", "ver_fiscal", "ver_expediente",
        "ver_documentos", "ver_dashboard", "exportar_pdf", "exportar_excel",
        "gestionar_marca_agua",
        "ver_pestana_archivo", "ver_pestana_control_urbano", "ver_pestana_rppc",
        "ver_pestana_zona_homogenea",
        "consulta"
    },
    "supervisor": {
        "ver_auditoria", "editar_cartografia", "editar_catastro",
        "editar_titularidad", "editar_nombre_contribuyente",
        "solicitar_movimientos", "aplicar_movimientos",
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel",
        "gestionar_marca_agua",
        "ver_pestana_archivo", "ver_pestana_control_urbano", "ver_pestana_rppc",
        "ver_pestana_zona_homogenea",
        "consulta"
    },
    "cartografia": {
        "editar_cartografia", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel",
        "gestionar_marca_agua",
        "ver_pestana_archivo", "ver_pestana_control_urbano", "ver_pestana_rppc",
        "ver_pestana_zona_homogenea",
        "consulta"
    },
    "catastro": {
        "editar_catastro", "editar_titularidad", "editar_nombre_contribuyente",
        "solicitar_movimientos",
        "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel",
        "gestionar_marca_agua",
        "ver_pestana_archivo", "ver_pestana_control_urbano", "ver_pestana_rppc",
        "ver_pestana_zona_homogenea",
        "consulta"
    },
    "fiscalizacion": {
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel",
        "gestionar_marca_agua",
        "ver_pestana_archivo", "ver_pestana_control_urbano", "ver_pestana_rppc",
        "ver_pestana_zona_homogenea",
        "consulta"
    },
    "consulta": {
        "ver_expediente", "ver_dashboard",
        "exportar_pdf", "exportar_excel", "consulta"
    }
}


def normalizar_rol(rol):
    base = (rol or "consulta").strip().lower()
    alias = {
        "administrador": "admin",
        "administrator": "admin",
        "admin tijuana": "admin",
        "administrador tijuana": "admin",
    }
    return alias.get(base, base)


def _permisos_fallback(rol):
    rol_norm = normalizar_rol(rol)
    return _filtrar_permisos_exclusion_rol(rol_norm, ACL_BACKEND.get(rol_norm, ACL_BACKEND["consulta"]))


def _filtrar_permisos_exclusion_rol(rol, permisos):
    """Quita permisos que nunca deben aplicar a ciertos roles (p. ej. matriz BD desactualizada)."""
    rol_norm = normalizar_rol(rol)
    out = set(permisos or [])
    if rol_norm == "consulta":
        out.discard("ver_pestana_zona_homogenea")
    return sorted(out)


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
        fallback = set(_permisos_fallback(rol))
        return _filtrar_permisos_exclusion_rol(rol, fallback | set(perms))
    except Exception:
        return _permisos_fallback(rol)


def usuario_tiene_permiso(usuario_actual: dict, permiso: str) -> bool:
    rol = normalizar_rol(usuario_actual.get("rol"))
    efectivos = set(permisos_por_rol(rol))
    return permiso in efectivos
