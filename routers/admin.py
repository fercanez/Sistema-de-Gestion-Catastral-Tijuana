"""Router administrativo: usuarios, roles y auditoria."""
import psycopg2
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from database import get_conn, filas_a_lista
from auth.models import (
    UsuarioNuevo,
    UsuarioActualizar,
    PasswordReset,
    AccesoModuloNuevo,
    AccesoModuloActualizar,
    AccesoModuloRenovar,
    AccesoModuloNegar,
    RolNuevoAcl,
    PermisoNuevoAcl,
    RolPermisosAcl,
)
from auth.dependencies import requerir_permiso, registrar_auditoria, pwd_context, verificar_password
from auth.acl import ACL_BACKEND
from auth.acl_db import (
    ensure_acl_db,
    matriz_acl_db,
    crear_permiso_db,
    crear_rol_db,
    asignar_permisos_rol_db,
    listar_roles_db,
)
from auth.modulos_sistema import MODULOS_SISTEMA
from auth.accesos_modulo import (
    TZ_MX,
    acceso_esta_vigente,
    ensure_accesos_modulo_table,
    fin_dia_calendario,
    listar_accesos_usuario,
    normalizar_fin_vigencia,
    parse_fecha_calendario,
    validar_modulo_id,
)

_permiso_administrar = requerir_permiso("administrar_usuarios")
_permiso_auditoria = requerir_permiso("ver_auditoria")

router = APIRouter(tags=["admin"])

@router.get("/admin/auditoria")
async def obtener_auditoria(
    limite: int = Query(200, ge=1, le=1000),
    user = Depends(_permiso_auditoria),
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
            "auditoria": filas_a_lista(rows)
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
    user = Depends(_permiso_administrar)
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
            "usuarios": filas_a_lista(rows)
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
    user = Depends(_permiso_administrar)
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
    user = Depends(_permiso_administrar)
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
    user = Depends(_permiso_administrar)
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
    user = Depends(_permiso_administrar)
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


def _parse_fecha_iso(valor: str | None, obligatorio: bool = False, fin_dia: bool = False):
    if valor is None or str(valor).strip() == "":
        if obligatorio:
            raise HTTPException(status_code=400, detail="Fecha obligatoria")
        return None
    txt = str(valor).strip()
    try:
        if len(txt) <= 10:
            return parse_fecha_calendario(txt, fin_dia=fin_dia)
        dt = datetime.fromisoformat(txt.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ_MX)
        if fin_dia:
            return fin_dia_calendario(dt.astimezone(TZ_MX).date())
        return dt
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Fecha no válida: {txt}")


def _serializar_acceso(row: dict) -> dict:
    if not row:
        return {}
    item = dict(row)
    item["vigente"] = acceso_esta_vigente(row)
    return item


@router.get("/admin/modulos")
async def obtener_modulos_sistema(user=Depends(_permiso_administrar)):
    return {"total": len(MODULOS_SISTEMA), "modulos": MODULOS_SISTEMA}


@router.get("/admin/permisos/matriz")
async def obtener_matriz_permisos(user=Depends(_permiso_administrar)):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        payload = matriz_acl_db(cur)
        conn.commit()
        return payload
    except Exception as e:
        if conn:
            conn.rollback()
        return {"matriz": {k: sorted(list(v)) for k, v in ACL_BACKEND.items()}}
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@router.get("/admin/acl/matriz")
async def obtener_matriz_acl(user=Depends(_permiso_administrar)):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        payload = matriz_acl_db(cur)
        conn.commit()
        return payload
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


@router.post("/admin/acl/roles")
async def crear_rol_acl(
    datos: RolNuevoAcl,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        row = crear_rol_db(cur, datos.nombre, datos.descripcion, datos.permisos)
        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "CREAR_ROL",
            "ADMIN",
            f"Rol creado: {row['nombre']}",
            request.client.host if request.client else "",
        )
        return {"success": True, "rol": row}
    except ValueError as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
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


@router.post("/admin/acl/permisos")
async def crear_permiso_acl(
    datos: PermisoNuevoAcl,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        row = crear_permiso_db(cur, datos.codigo, datos.descripcion)
        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "CREAR_PERMISO",
            "ADMIN",
            f"Permiso creado: {row['codigo']}",
            request.client.host if request.client else "",
        )
        return {"success": True, "permiso": row}
    except ValueError as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
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


@router.put("/admin/acl/roles/{rol_id}/permisos")
async def actualizar_permisos_rol_acl(
    rol_id: int,
    datos: RolPermisosAcl,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_acl_db(cur)
        cur.execute("SELECT nombre FROM seguridad.roles WHERE id = %s;", (rol_id,))
        rol = cur.fetchone()
        if not rol:
            raise HTTPException(status_code=404, detail="Rol no encontrado")
        codes = asignar_permisos_rol_db(cur, rol_id, datos.permisos)
        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "ACTUALIZAR_PERMISOS_ROL",
            "ADMIN",
            f"Permisos rol {rol['nombre']}: {', '.join(codes)}",
            request.client.host if request.client else "",
        )
        return {"success": True, "rol_id": rol_id, "permisos": codes}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except ValueError as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
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


@router.get("/admin/accesos")
async def listar_todos_accesos(
    usuario_id: int = Query(0, ge=0),
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_accesos_modulo_table(cur)
        conn.commit()

        if usuario_id:
            rows = listar_accesos_usuario(cur, usuario_id)
        else:
            cur.execute(
                """
                SELECT
                    a.id,
                    a.usuario_id,
                    u.usuario,
                    u.nombre_completo,
                    a.modulo_id,
                    a.permiso,
                    a.fecha_inicio,
                    a.fecha_fin,
                    a.estado,
                    a.motivo,
                    a.creado_por,
                    a.actualizado_por,
                    a.fecha_creacion,
                    a.fecha_actualizacion
                FROM seguridad.usuario_accesos_modulo a
                INNER JOIN seguridad.usuarios u ON u.id = a.usuario_id
                ORDER BY u.usuario, a.modulo_id, a.fecha_creacion DESC;
                """
            )
            rows = cur.fetchall() or []

        return {
            "total": len(rows),
            "accesos": [_serializar_acceso(dict(r)) for r in rows],
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


@router.get("/admin/usuarios/{usuario_id}/accesos")
async def obtener_accesos_usuario(
    usuario_id: int,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_accesos_modulo_table(cur)
        conn.commit()
        rows = listar_accesos_usuario(cur, usuario_id)
        return {
            "usuario_id": usuario_id,
            "total": len(rows),
            "accesos": [_serializar_acceso(dict(r)) for r in rows],
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


@router.post("/admin/usuarios/{usuario_id}/accesos")
async def crear_acceso_modulo(
    usuario_id: int,
    datos: AccesoModuloNuevo,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        try:
            modulo_id = validar_modulo_id(datos.modulo_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        conn = get_conn()
        cur = conn.cursor()
        ensure_accesos_modulo_table(cur)

        cur.execute("SELECT id, usuario FROM seguridad.usuarios WHERE id = %s;", (usuario_id,))
        urow = cur.fetchone()
        if not urow:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        fecha_inicio = _parse_fecha_iso(datos.fecha_inicio) or datetime.now(TZ_MX)
        fecha_fin = _parse_fecha_iso(datos.fecha_fin, fin_dia=True)
        permiso = (datos.permiso or "acceso_modulo").strip()

        cur.execute(
            """
            SELECT id FROM seguridad.usuario_accesos_modulo
            WHERE usuario_id = %s AND modulo_id = %s AND permiso = %s;
            """,
            (usuario_id, modulo_id, permiso),
        )
        existente = cur.fetchone()

        if existente:
            cur.execute(
                """
                UPDATE seguridad.usuario_accesos_modulo
                SET fecha_inicio = %s,
                    fecha_fin = %s,
                    estado = 'activo',
                    motivo = %s,
                    actualizado_por = %s,
                    fecha_actualizacion = now()
                WHERE id = %s
                RETURNING id;
                """,
                (
                    fecha_inicio,
                    fecha_fin,
                    (datos.motivo or "").strip() or None,
                    user.get("usuario"),
                    existente["id"],
                ),
            )
            row = cur.fetchone()
        else:
            cur.execute(
                """
                INSERT INTO seguridad.usuario_accesos_modulo (
                    usuario_id, modulo_id, permiso, fecha_inicio, fecha_fin,
                    estado, motivo, creado_por, actualizado_por
                )
                VALUES (%s, %s, %s, %s, %s, 'activo', %s, %s, %s)
                RETURNING id;
                """,
                (
                    usuario_id,
                    modulo_id,
                    permiso,
                    fecha_inicio,
                    fecha_fin,
                    (datos.motivo or "").strip() or None,
                    user.get("usuario"),
                    user.get("usuario"),
                ),
            )
            row = cur.fetchone()

        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "CREAR_ACCESO_MODULO",
            "ADMIN",
            f"Acceso {modulo_id} → {urow['usuario']}",
            request.client.host if request.client else "",
        )
        return {"success": True, "id": row["id"] if row else None}
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


@router.put("/admin/accesos/{acceso_id}")
async def actualizar_acceso_modulo(
    acceso_id: int,
    datos: AccesoModuloActualizar,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_accesos_modulo_table(cur)

        cur.execute(
            """
            SELECT a.*, u.usuario
            FROM seguridad.usuario_accesos_modulo a
            INNER JOIN seguridad.usuarios u ON u.id = a.usuario_id
            WHERE a.id = %s;
            """,
            (acceso_id,),
        )
        acc = cur.fetchone()
        if not acc:
            raise HTTPException(status_code=404, detail="Acceso no encontrado")

        if datos.modulo_id is not None:
            try:
                validar_modulo_id(datos.modulo_id)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

        sets = []
        params = []
        if datos.modulo_id is not None:
            sets.append("modulo_id = %s")
            params.append(datos.modulo_id.strip())
        if datos.permiso is not None:
            sets.append("permiso = %s")
            params.append(datos.permiso.strip())
        if datos.fecha_inicio is not None:
            sets.append("fecha_inicio = %s")
            params.append(_parse_fecha_iso(datos.fecha_inicio, obligatorio=True))
        if datos.fecha_fin is not None:
            sets.append("fecha_fin = %s")
            params.append(_parse_fecha_iso(datos.fecha_fin, fin_dia=True))
        if datos.estado is not None:
            estado = datos.estado.strip().lower()
            if estado not in ("activo", "negado", "vencido"):
                raise HTTPException(status_code=400, detail="Estado no válido")
            sets.append("estado = %s")
            params.append(estado)
        if datos.motivo is not None:
            sets.append("motivo = %s")
            params.append(datos.motivo.strip() or None)

        if not sets:
            raise HTTPException(status_code=400, detail="Sin cambios")

        sets.append("actualizado_por = %s")
        params.append(user.get("usuario"))
        sets.append("fecha_actualizacion = now()")
        params.append(acceso_id)

        cur.execute(
            f"UPDATE seguridad.usuario_accesos_modulo SET {', '.join(sets)} WHERE id = %s;",
            params,
        )
        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "ACTUALIZAR_ACCESO_MODULO",
            "ADMIN",
            f"Acceso #{acceso_id} ({acc['modulo_id']}) → {acc['usuario']}",
            request.client.host if request.client else "",
        )
        return {"success": True, "id": acceso_id}
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


@router.post("/admin/accesos/{acceso_id}/renovar")
async def renovar_acceso_modulo(
    acceso_id: int,
    datos: AccesoModuloRenovar,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_accesos_modulo_table(cur)

        cur.execute(
            """
            SELECT a.*, u.usuario
            FROM seguridad.usuario_accesos_modulo a
            INNER JOIN seguridad.usuarios u ON u.id = a.usuario_id
            WHERE a.id = %s;
            """,
            (acceso_id,),
        )
        acc = cur.fetchone()
        if not acc:
            raise HTTPException(status_code=404, detail="Acceso no encontrado")

        if datos.fecha_fin:
            nueva_fin = _parse_fecha_iso(datos.fecha_fin, obligatorio=True, fin_dia=True)
        else:
            ahora = datetime.now(TZ_MX)
            base = normalizar_fin_vigencia(acc.get("fecha_fin")) or ahora
            if base < ahora:
                base = ahora
            base_date = base.astimezone(TZ_MX).date()
            nueva_fin = fin_dia_calendario(
                base_date + timedelta(days=max(1, int(datos.dias or 30)))
            )

        motivo = (datos.motivo or acc.get("motivo") or "").strip() or None
        cur.execute(
            """
            UPDATE seguridad.usuario_accesos_modulo
            SET fecha_fin = %s,
                estado = 'activo',
                motivo = %s,
                actualizado_por = %s,
                fecha_actualizacion = now()
            WHERE id = %s;
            """,
            (nueva_fin, motivo, user.get("usuario"), acceso_id),
        )
        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "RENOVAR_ACCESO_MODULO",
            "ADMIN",
            f"Renovado acceso #{acceso_id} ({acc['modulo_id']}) hasta {nueva_fin.isoformat()}",
            request.client.host if request.client else "",
        )
        return {"success": True, "id": acceso_id, "fecha_fin": nueva_fin.isoformat()}
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


@router.post("/admin/accesos/{acceso_id}/negar")
async def negar_acceso_modulo(
    acceso_id: int,
    datos: AccesoModuloNegar,
    request: Request,
    user=Depends(_permiso_administrar),
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_accesos_modulo_table(cur)

        cur.execute(
            """
            SELECT a.*, u.usuario
            FROM seguridad.usuario_accesos_modulo a
            INNER JOIN seguridad.usuarios u ON u.id = a.usuario_id
            WHERE a.id = %s;
            """,
            (acceso_id,),
        )
        acc = cur.fetchone()
        if not acc:
            raise HTTPException(status_code=404, detail="Acceso no encontrado")

        motivo = (datos.motivo or "Acceso negado por administrador").strip()
        cur.execute(
            """
            UPDATE seguridad.usuario_accesos_modulo
            SET estado = 'negado',
                motivo = %s,
                actualizado_por = %s,
                fecha_actualizacion = now()
            WHERE id = %s;
            """,
            (motivo, user.get("usuario"), acceso_id),
        )
        conn.commit()
        registrar_auditoria(
            user["usuario"],
            "NEGAR_ACCESO_MODULO",
            "ADMIN",
            f"Negado acceso #{acceso_id} ({acc['modulo_id']}) → {acc['usuario']}",
            request.client.host if request.client else "",
        )
        return {"success": True, "id": acceso_id}
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

