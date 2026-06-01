from auth.dependencies import (
    obtener_usuario_actual,
    requerir_roles,
    require_role,
    requerir_permiso,
    oauth2_scheme,
)
from auth.acl import ACL_BACKEND, normalizar_rol, permisos_por_rol, usuario_tiene_permiso
