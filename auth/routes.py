from fastapi import APIRouter, Depends, HTTPException, Query, Request

from config import ACCESS_TOKEN_EXPIRE_MINUTES
from database import get_conn
from auth.acl import ACL_BACKEND, normalizar_rol, permisos_por_rol, usuario_tiene_permiso
from auth.dependencies import (
    crear_token_acceso,
    obtener_usuario_actual,
    registrar_auditoria_login,
    requerir_roles,
    require_role,
    verificar_password,
)
from auth.models import LoginRequest

router = APIRouter(tags=["auth"])


@router.post("/login")
def login(datos: LoginRequest, request: Request):
    usuario_input = (datos.usuario or "").strip()
    password_input = datos.password or ""
    ip_cliente = request.client.host if request.client else "desconocida"

    if not usuario_input or not password_input:
        registrar_auditoria_login(usuario_input, ip_cliente, False, "Usuario o contraseña vacíos")
        raise HTTPException(status_code=400, detail="Usuario y contraseña son obligatorios")

    conn = None
    cur = None

    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute(
            """
            SELECT
                id,
                usuario,
                nombre_completo,
                password_hash,
                rol,
                activo
            FROM seguridad.usuarios
            WHERE usuario = %s;
            """,
            (usuario_input,),
        )
        row = cur.fetchone()

        if not row:
            registrar_auditoria_login(usuario_input, ip_cliente, False, "Usuario no encontrado")
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

        if not row["activo"]:
            registrar_auditoria_login(usuario_input, ip_cliente, False, "Usuario inactivo")
            raise HTTPException(status_code=401, detail="Usuario inactivo")

        if not verificar_password(password_input, row["password_hash"]):
            registrar_auditoria_login(usuario_input, ip_cliente, False, "Contraseña incorrecta")
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

        cur.execute(
            """
            UPDATE seguridad.usuarios
            SET ultimo_acceso = now()
            WHERE id = %s;
            """,
            (row["id"],),
        )
        conn.commit()

        token = crear_token_acceso({
            "sub": row["usuario"],
            "rol": row["rol"],
            "nombre": row["nombre_completo"],
        })

        registrar_auditoria_login(usuario_input, ip_cliente, True, "Login correcto")

        return {
            "access_token": token,
            "token_type": "bearer",
            "usuario": row["usuario"],
            "nombre": row["nombre_completo"],
            "rol": row["rol"],
            "permisos": permisos_por_rol(row["rol"]),
            "expira_minutos": ACCESS_TOKEN_EXPIRE_MINUTES,
        }

    except HTTPException:
        raise

    except Exception as e:
        registrar_auditoria_login(usuario_input, ip_cliente, False, f"Error interno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.get("/me")
def me(usuario_actual: dict = Depends(obtener_usuario_actual)):
    rol = normalizar_rol(usuario_actual.get("rol"))
    return {
        "autenticado": True,
        "usuario": usuario_actual["usuario"],
        "nombre": usuario_actual["nombre"],
        "rol": rol,
        "permisos": permisos_por_rol(rol),
    }


@router.get("/seguridad/usuarios")
def listar_usuarios(usuario_actual: dict = Depends(requerir_roles("admin"))):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                id,
                usuario,
                nombre_completo,
                rol,
                activo,
                fecha_creacion
            FROM seguridad.usuarios
            ORDER BY usuario;
            """
        )
        rows = cur.fetchall()
        return {"total": len(rows), "usuarios": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.get("/seguridad/auditoria-login")
def auditoria_login(
    limite: int = Query(100, ge=1, le=1000),
    usuario_actual: dict = Depends(requerir_roles("admin")),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                id,
                usuario,
                ip,
                exito,
                mensaje,
                fecha
            FROM seguridad.auditoria_login
            ORDER BY fecha DESC
            LIMIT %s;
            """,
            (limite,),
        )
        rows = cur.fetchall()
        return {"total": len(rows), "auditoria": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.get("/seguridad/permisos")
def obtener_permisos_usuario(usuario_actual: dict = Depends(obtener_usuario_actual)):
    rol = normalizar_rol(usuario_actual.get("rol"))
    return {
        "usuario": usuario_actual.get("usuario"),
        "rol": rol,
        "permisos": permisos_por_rol(rol),
        "matriz": {k: sorted(list(v)) for k, v in ACL_BACKEND.items()},
    }


@router.get("/admin/permisos")
def obtener_matriz_permisos_admin(user=Depends(require_role(["admin"]))):
    return {"matriz": {k: sorted(list(v)) for k, v in ACL_BACKEND.items()}}


@router.get("/seguridad/probar-permiso/{permiso}")
def probar_permiso(
    permiso: str,
    usuario_actual: dict = Depends(obtener_usuario_actual),
):
    return {
        "usuario": usuario_actual.get("usuario"),
        "rol": normalizar_rol(usuario_actual.get("rol")),
        "permiso": permiso,
        "autorizado": usuario_tiene_permiso(usuario_actual, permiso),
    }
