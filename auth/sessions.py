"""Sesiones activas: una por usuario y tipo (web / servicio), expiración por inactividad."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from config import SESSION_INACTIVITY_MINUTES
from database import get_conn

TIPOS_SESION_VALIDOS = frozenset({"web", "servicio"})

DDL_SESIONES_TABLA = """
CREATE TABLE IF NOT EXISTS seguridad.sesiones_activas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES seguridad.usuarios(id) ON DELETE CASCADE,
    jti VARCHAR(64) NOT NULL UNIQUE,
    tipo VARCHAR(20) NOT NULL DEFAULT 'web',
    ip VARCHAR(64),
    user_agent TEXT,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

DDL_SESIONES_INDICE = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_usuario_tipo
    ON seguridad.sesiones_activas (usuario_id, tipo);
"""


def normalizar_tipo_sesion(tipo: str | None) -> str:
    valor = (tipo or "web").strip().lower()
    return valor if valor in TIPOS_SESION_VALIDOS else "web"


def ip_es_interna(ip: str) -> bool:
    host = (ip or "").strip().lower()
    if host == "desconocida" or not host:
        return False
    if host in ("127.0.0.1", "::1", "localhost"):
        return True
    if host.startswith("10.") or host.startswith("192.168."):
        return True
    if host.startswith("172."):
        partes = host.split(".")
        if len(partes) >= 2:
            try:
                segundo = int(partes[1])
                return 16 <= segundo <= 31
            except ValueError:
                return False
    return False


def ensure_sesiones_table(cur) -> None:
    cur.execute(DDL_SESIONES_TABLA)
    cur.execute(
        "ALTER TABLE seguridad.sesiones_activas "
        "ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'web';"
    )
    cur.execute("DROP INDEX IF EXISTS seguridad.idx_sesiones_usuario_unico;")
    cur.execute(DDL_SESIONES_INDICE)


def _ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


def crear_sesion(
    usuario_id: int,
    jti: str,
    ip: str = "",
    user_agent: str = "",
    tipo: str = "web",
) -> None:
    tipo_norm = normalizar_tipo_sesion(tipo)
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_sesiones_table(cur)
        cur.execute(
            """
            DELETE FROM seguridad.sesiones_activas
            WHERE usuario_id = %s AND tipo = %s;
            """,
            (usuario_id, tipo_norm),
        )
        cur.execute(
            """
            INSERT INTO seguridad.sesiones_activas
                (usuario_id, jti, tipo, ip, user_agent, creada_en, ultima_actividad)
            VALUES (%s, %s, %s, %s, %s, now(), now());
            """,
            (usuario_id, jti, tipo_norm, ip or None, (user_agent or "")[:500] or None),
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
                s.tipo,
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
            "tipo_sesion": row.get("tipo") or "web",
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
