"""Router administrativo: usuarios, roles y auditoria."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from database import get_conn
from auth.models import UsuarioNuevo, UsuarioActualizar, PasswordReset
from auth.dependencies import require_role, registrar_auditoria, pwd_context, verificar_password

router = APIRouter(tags=["admin"])

@router.get("/admin/auditoria")
async def obtener_auditoria(
    limite: int = Query(200, ge=1, le=1000),
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id,
                usuario,
                accion,
                modulo,
                detalle,
                ip,
                fecha
            FROM seguridad.auditoria_sistema
            ORDER BY fecha DESC
            LIMIT %s;
        """, (limite,))

        rows = cur.fetchall()

        return {
            "total": len(rows),
            "auditoria": rows
        }

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


@router.get("/admin/usuarios")
async def obtener_usuarios(
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                u.id,
                u.usuario,
                u.nombre_completo,
                u.rol AS rol_principal,
                COALESCE(
                    json_agg(r.nombre ORDER BY r.nombre)
                    FILTER (WHERE r.nombre IS NOT NULL),
                    '[]'
                ) AS roles,
                u.activo,
                u.fecha_creacion,
                u.ultimo_acceso
            FROM seguridad.usuarios u
            LEFT JOIN seguridad.usuario_roles ur
                ON ur.usuario_id = u.id
            LEFT JOIN seguridad.roles r
                ON r.id = ur.rol_id
            GROUP BY
                u.id,
                u.usuario,
                u.nombre_completo,
                u.rol,
                u.activo,
                u.fecha_creacion,
                u.ultimo_acceso
            ORDER BY u.usuario;
        """)

        rows = cur.fetchall()

        return {
            "total": len(rows),
            "usuarios": rows
        }

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


@router.get("/admin/roles")
async def obtener_roles(
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id,
                nombre,
                descripcion
            FROM seguridad.roles
            ORDER BY nombre;
        """)

        rows = cur.fetchall()

        return {
            "total": len(rows),
            "roles": rows
        }

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


@router.post("/admin/usuarios")
async def crear_usuario_admin(
    nuevo: UsuarioNuevo,
    request: Request,
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        usuario = nuevo.usuario.strip().lower()
        rol = nuevo.rol.strip().lower()

        if not usuario or not nuevo.password:
            raise HTTPException(status_code=400, detail="Usuario y contraseña son obligatorios")

        conn = get_conn()
        cur = conn.cursor()

        password_hash = pwd_context.hash(nuevo.password)

        cur.execute("""
            INSERT INTO seguridad.usuarios (
                usuario,
                nombre_completo,
                password_hash,
                rol,
                activo,
                fecha_creacion
            )
            VALUES (%s, %s, %s, %s, TRUE, now())
            RETURNING id;
        """, (
            usuario,
            nuevo.nombre_completo.strip(),
            password_hash,
            rol
        ))

        usuario_id = cur.fetchone()["id"]

        cur.execute("""
            SELECT id
            FROM seguridad.roles
            WHERE nombre = %s;
        """, (rol,))

        rol_row = cur.fetchone()

        if rol_row:
            cur.execute("""
                INSERT INTO seguridad.usuario_roles (
                    usuario_id,
                    rol_id
                )
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING;
            """, (usuario_id, rol_row["id"]))

        conn.commit()

        registrar_auditoria(
            user["usuario"],
            "CREAR_USUARIO",
            "ADMIN",
            f"Usuario creado: {usuario}",
            request.client.host if request.client else ""
        )

        return {
            "success": True,
            "usuario": usuario,
            "id": usuario_id
        }

    except psycopg2.errors.UniqueViolation:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=409, detail="El usuario ya existe")

    except HTTPException:
        if conn:
            conn.rollback()
        raise

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.put("/admin/usuarios/{usuario_id}")
async def actualizar_usuario_admin(
    usuario_id: int,
    datos: UsuarioActualizar,
    request: Request,
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, usuario
            FROM seguridad.usuarios
            WHERE id = %s;
        """, (usuario_id,))

        usuario_row = cur.fetchone()
        if not usuario_row:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        if datos.nombre_completo is not None:
            cur.execute("""
                UPDATE seguridad.usuarios
                SET nombre_completo = %s
                WHERE id = %s;
            """, (datos.nombre_completo.strip(), usuario_id))

        if datos.activo is not None:
            cur.execute("""
                UPDATE seguridad.usuarios
                SET activo = %s
                WHERE id = %s;
            """, (datos.activo, usuario_id))

        if datos.rol is not None:
            rol = datos.rol.strip().lower()

            cur.execute("""
                UPDATE seguridad.usuarios
                SET rol = %s
                WHERE id = %s;
            """, (rol, usuario_id))

            cur.execute("""
                SELECT id
                FROM seguridad.roles
                WHERE nombre = %s;
            """, (rol,))
            rol_row = cur.fetchone()

            if rol_row:
                cur.execute("""
                    DELETE FROM seguridad.usuario_roles
                    WHERE usuario_id = %s;
                """, (usuario_id,))

                cur.execute("""
                    INSERT INTO seguridad.usuario_roles (
                        usuario_id,
                        rol_id
                    )
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING;
                """, (usuario_id, rol_row["id"]))

        conn.commit()

        registrar_auditoria(
            user["usuario"],
            "ACTUALIZAR_USUARIO",
            "ADMIN",
            f"Usuario actualizado: {usuario_row['usuario']}",
            request.client.host if request.client else ""
        )

        return {
            "success": True,
            "id": usuario_id
        }

    except HTTPException:
        if conn:
            conn.rollback()
        raise

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.post("/admin/usuarios/{usuario_id}/reset-password")
async def reset_password_usuario_admin(
    usuario_id: int,
    datos: PasswordReset,
    request: Request,
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        if not datos.password:
            raise HTTPException(status_code=400, detail="Contraseña obligatoria")

        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, usuario
            FROM seguridad.usuarios
            WHERE id = %s;
        """, (usuario_id,))
        usuario_row = cur.fetchone()

        if not usuario_row:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        password_hash = pwd_context.hash(datos.password)

        cur.execute("""
            UPDATE seguridad.usuarios
            SET password_hash = %s
            WHERE id = %s;
        """, (password_hash, usuario_id))

        conn.commit()

        registrar_auditoria(
            user["usuario"],
            "RESET_PASSWORD",
            "ADMIN",
            f"Reset password: {usuario_row['usuario']}",
            request.client.host if request.client else ""
        )

        return {
            "success": True,
            "id": usuario_id
        }

    except HTTPException:
        if conn:
            conn.rollback()
        raise

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


