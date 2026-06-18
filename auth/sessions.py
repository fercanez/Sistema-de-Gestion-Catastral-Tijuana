"""Sesiones activas: una por usuario, expiración por inactividad."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from config import SESSION_INACTIVITY_MINUTES
from database import get_conn

DDL_SESIONES_TABLA = """
CREATE TABLE IF NOT EXISTS seguridad.sesiones_activas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES seguridad.usuarios(id) ON DELETE CASCADE,
    jti VARCHAR(64) NOT NULL UNIQUE,
    ip VARCHAR(64),
    user_agent TEXT,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

DDL_SESIONES_INDICE = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_usuario_unico
    ON seguridad.sesiones_activas (usuario_id);
"""


def ensure_sesiones_table(cur) -> None:
    cur.execute(DDL_SESIONES_TABLA)
    cur.execute(DDL_SESIONES_INDICE)


def _ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


def crear_sesion(usuario_id: int, jti: str, ip: str = "", user_agent: str = "") -> None:
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_sesiones_table(cur)
        cur.execute(
            "DELETE FROM seguridad.sesiones_activas WHERE usuario_id = %s;",
            (usuario_id,),
        )
        cur.execute(
            """
            INSERT INTO seguridad.sesiones_activas
                (usuario_id, jti, ip, user_agent, creada_en, ultima_actividad)
            VALUES (%s, %s, %s, %s, now(), now());
            """,
            (usuario_id, jti, ip or None, (user_agent or "")[:500] or None),
        )
        conn.commit()
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


def cerrar_sesion_por_jti(jti: str) -> None:
    if not jti:
        return
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM seguridad.sesiones_activas WHERE jti = %s;",
            (jti,),
        )
        conn.commit()
    except Exception:
        pass
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


def validar_sesion_activa(jti: str) -> dict:
    """Valida jti, aplica timeout por inactividad y actualiza ultima_actividad."""
    if not jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión no válida",
            headers={"WWW-Authenticate": "Bearer"},
        )

    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_sesiones_table(cur)
        cur.execute(
            """
            SELECT
                s.usuario_id,
                s.ultima_actividad,
                u.usuario,
                u.nombre_completo,
                u.rol,
                u.activo
            FROM seguridad.sesiones_activas s
            JOIN seguridad.usuarios u ON u.id = s.usuario_id
            WHERE s.jti = %s
            LIMIT 1;
            """,
            (jti,),
        )
        row = cur.fetchone()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sesión cerrada: se inició sesión en otro lugar",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not row["activo"]:
            cur.execute(
                "DELETE FROM seguridad.sesiones_activas WHERE jti = %s;",
                (jti,),
            )
            conn.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario inactivo",
                headers={"WWW-Authenticate": "Bearer"},
            )

        ultima = row["ultima_actividad"]
        if ultima.tzinfo is None:
            ultima = ultima.replace(tzinfo=timezone.utc)
        limite = _ahora_utc() - timedelta(minutes=SESSION_INACTIVITY_MINUTES)
        if ultima < limite:
            cur.execute(
                "DELETE FROM seguridad.sesiones_activas WHERE jti = %s;",
                (jti,),
            )
            conn.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sesión expirada por inactividad",
                headers={"WWW-Authenticate": "Bearer"},
            )

        cur.execute(
            """
            UPDATE seguridad.sesiones_activas
            SET ultima_actividad = now()
            WHERE jti = %s;
            """,
            (jti,),
        )
        conn.commit()

        return {
            "usuario_id": row["usuario_id"],
            "usuario": row["usuario"],
            "nombre": row["nombre_completo"],
            "rol": row["rol"],
            "jti": jti,
        }

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión no válida",
            headers={"WWW-Authenticate": "Bearer"},
        )

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass
