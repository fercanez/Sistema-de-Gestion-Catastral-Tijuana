from datetime import datetime, timedelta
import secrets

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, SESSION_INACTIVITY_MINUTES
from database import get_conn
from auth.acl import ACL_BACKEND, normalizar_rol, permisos_por_rol, usuario_tiene_permiso
from auth.sessions import validar_sesion_activa, cerrar_sesion_por_jti

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


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


def crear_token_acceso(data: dict, jti: str | None = None, expires_delta: timedelta | None = None) -> str:
    datos = data.copy()
    token_jti = jti or secrets.token_urlsafe(32)
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    datos.update({"exp": expire, "jti": token_jti})
    return jwt.encode(datos, SECRET_KEY, algorithm=ALGORITHM)


def decodificar_token_acceso(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


def resolver_usuario_desde_token(token: str) -> dict:
    payload = decodificar_token_acceso(token)
    usuario = payload.get("sub")
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    jti = payload.get("jti")
    sesion = validar_sesion_activa(jti)
    return {
        "usuario": sesion["usuario"],
        "rol": sesion["rol"] or payload.get("rol"),
        "nombre": sesion["nombre"] or payload.get("nombre"),
        "jti": jti,
        "usuario_id": sesion["usuario_id"],
    }


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


def obtener_usuario_actual(token: str = Depends(oauth2_scheme)):
    return resolver_usuario_desde_token(token)


def requerir_roles(*roles_permitidos):
    def validador(usuario_actual: dict = Depends(obtener_usuario_actual)):
        if usuario_actual.get("rol") not in roles_permitidos:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tiene permisos para esta operación",
            )
        return usuario_actual
    return validador


def require_role(roles_permitidos: list):
    async def verifier(token: str = Security(oauth2_scheme)):
        usuario_actual = resolver_usuario_desde_token(token)
        usuario = usuario_actual["usuario"]
        usuario_id = usuario_actual.get("usuario_id")

        conn = get_conn()
        cur = conn.cursor()
        if not usuario_id:
            cur.execute(
                """
                SELECT id, usuario
                FROM seguridad.usuarios
                WHERE usuario = %s
                AND activo = TRUE
                """,
                (usuario,),
            )
            user = cur.fetchone()
            if not user:
                cur.close()
                conn.close()
                raise HTTPException(status_code=401, detail="No autorizado")
            usuario_id = user["id"]
        else:
            cur.execute(
                "SELECT id, usuario FROM seguridad.usuarios WHERE id = %s AND activo = TRUE;",
                (usuario_id,),
            )
            user = cur.fetchone()
            if not user:
                cur.close()
                conn.close()
                raise HTTPException(status_code=401, detail="No autorizado")

        roles = obtener_roles_usuario(usuario_id, conn)
        cur.close()
        conn.close()

        autorizado = any(r in roles for r in roles_permitidos)
        if not autorizado:
            raise HTTPException(status_code=403, detail="Permisos insuficientes")

        return {"usuario": usuario, "roles": roles}

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
