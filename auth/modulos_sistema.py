"""Catálogo de módulos del portal institucional."""

MODULOS_SISTEMA = [
    {
        "id": "gestion-catastral",
        "titulo": "Gestión Catastral",
        "descripcion": "Mapa de consulta y ficha predial.",
        "roles_base": ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion", "consulta"],
    },
    {
        "id": "zonas-homogeneas",
        "titulo": "Análisis de Zonas Homogéneas",
        "descripcion": "Catálogo y evolución de valores.",
        "roles_base": ["admin", "supervisor", "catastro", "fiscalizacion", "cartografia", "consulta"],
    },
    {
        "id": "condominios",
        "titulo": "Régimen en Condominio",
        "descripcion": "Consulta y análisis de condominios.",
        "roles_base": ["admin", "supervisor", "catastro", "fiscalizacion", "cartografia", "consulta"],
    },
    {
        "id": "movimientos",
        "titulo": "Movimientos Catastrales",
        "descripcion": "Solicitudes y aplicación al padrón.",
        "roles_base": ["admin", "supervisor", "catastro"],
    },
    {
        "id": "modulo-cartografico",
        "titulo": "Módulo Cartográfico",
        "descripcion": "Edición geométrica ligada a alta, subdivisión y fusión.",
        "roles_base": ["admin", "supervisor", "cartografia"],
    },
    {
        "id": "administracion",
        "titulo": "Administración del Sistema",
        "descripcion": "Usuarios, permisos y auditoría.",
        "roles_base": ["admin"],
    },
    {
        "id": "portal-completo",
        "titulo": "Portal Integral",
        "descripcion": "Vista clásica con panel lateral completo.",
        "roles_base": ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion", "consulta"],
    },
]

MODULOS_SISTEMA_IDS = {m["id"] for m in MODULOS_SISTEMA}
