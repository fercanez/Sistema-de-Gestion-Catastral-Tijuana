from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Query, Security, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from database import get_conn
from auth.acl import ACL_BACKEND, normalizar_rol, permisos_por_rol, usuario_tiene_permiso

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)

_ROLES_PRIORIDAD = (
    "admin",
    "supervisor",
    "catastro",
    "cartografia",
    "fiscalizacion",
    "consulta",
)


def obtener_roles_usuario(usuario_id, conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT r.nombre
        FROM seguridad.usuario_roles ur
        JOIN seguridad.roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = %s
        """,
        (usuario_id,),
    )
    rows = cur.fetchall()
    return [r["nombre"] for r in rows]


def resolver_rol_usuario(usuario_id: int, rol_fallback: str | None, conn) -> str:
    """Rol efectivo: prioriza seguridad.usuario_roles; si no hay filas, usa usuarios.rol."""
    roles = [normalizar_rol(r) for r in obtener_roles_usuario(usuario_id, conn)]
    if roles:
        for candidato in _ROLES_PRIORIDAD:
            if candidato in roles:
                return candidato
        return roles[0]
    return normalizar_rol(rol_fallback)


def registrar_auditoria(usuario, accion, modulo="", detalle="", ip=""):
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO seguridad.auditoria_sistema
            (usuario, accion, modulo, detalle, ip)
            VALUES (%s,%s,%s,%s,%s)
            """,
            (usuario, accion, modulo, detalle, ip),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print("Error auditoría:", e)


def verificar_password(password_plano: str, password_hash: str) -> bool:
    return pwd_context.verify(password_plano, password_hash)


def crear_token_acceso(data: dict, expires_delta: timedelta | None = None) -> str:
    datos = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    datos.update({"exp": expire})
    return jwt.encode(datos, SECRET_KEY, algorithm=ALGORITHM)


def registrar_auditoria_login(usuario: str, ip: str, exito: bool, mensaje: str):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO seguridad.auditoria_login (
                usuario, ip, exito, mensaje, fecha
            )
            VALUES (%s, %s, %s, %s, now());
            """,
            (usuario, ip, exito, mensaje),
        )
        conn.commit()
    except Exception as e:
        print(f"Error registrando auditoría de login: {e}")
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


def _usuario_desde_payload(payload: dict) -> dict:
    usuario = payload.get("sub")
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {
        "usuario": usuario,
        "rol": payload.get("rol"),
        "nombre": payload.get("nombre"),
    }


def _decodificar_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return _usuario_desde_payload(payload)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


def resolver_token_acceso(
    bearer: Optional[str] = Depends(oauth2_scheme_optional),
    access_token: Optional[str] = Query(
        None,
        description="JWT alternativo (descargas y tiles cuando no hay cabecera Authorization)",
    ),
) -> str:
    token = bearer
    if not token and access_token:
        token = access_token.strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def obtener_usuario_actual(token: str = Depends(oauth2_scheme)):
    return _decodificar_token(token)


def obtener_usuario_token_o_query(token: str = Depends(resolver_token_acceso)):
    """Autenticación por Bearer o query ?access_token= (recursos binarios)."""
    return _decodificar_token(token)


def requerir_roles(*roles_permitidos):
    roles_norm = {normalizar_rol(r) for r in roles_permitidos}

    def validador(usuario_actual: dict = Depends(obtener_usuario_actual)):
        if normalizar_rol(usuario_actual.get("rol")) not in roles_norm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tiene permisos para esta operación",
            )
        return usuario_actual
    return validador


def require_role(roles_permitidos: list):
    """Compatibilidad: valida rol del JWT (misma fuente que login y requerir_roles)."""
    roles_norm = {normalizar_rol(r) for r in roles_permitidos}

    async def verifier(usuario_actual: dict = Depends(obtener_usuario_actual)):
        rol = normalizar_rol(usuario_actual.get("rol"))
        if rol not in roles_norm:
            raise HTTPException(status_code=403, detail="Permisos insuficientes")
        return {"usuario": usuario_actual.get("usuario"), "roles": [rol]}

    return verifier


def requerir_permiso(permiso: str):
    def validador(usuario_actual: dict = Depends(obtener_usuario_actual)):
        if not usuario_tiene_permiso(usuario_actual, permiso):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso requerido: {permiso}",
            )
        return usuario_actual
    return validador


def requerir_permiso_token_o_query(permiso: str):
    """Como requerir_permiso, pero acepta token en cabecera o ?access_token=."""
    def validador(usuario_actual: dict = Depends(obtener_usuario_token_o_query)):
        if not usuario_tiene_permiso(usuario_actual, permiso):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso requerido: {permiso}",
            )
        return usuario_actual
    return validador
