"""Permisos de acceso a módulos con vigencia temporal."""
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from auth.acl import normalizar_rol
from auth.modulos_sistema import MODULOS_SISTEMA, MODULOS_SISTEMA_IDS

TZ_MX = ZoneInfo("America/Tijuana")

DDL_ACCESOS_MODULO = """
CREATE TABLE IF NOT EXISTS seguridad.usuario_accesos_modulo (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES seguridad.usuarios(id) ON DELETE CASCADE,
    modulo_id VARCHAR(60) NOT NULL,
    permiso VARCHAR(80) NOT NULL DEFAULT 'acceso_modulo',
    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_fin TIMESTAMPTZ,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    motivo TEXT,
    creado_por VARCHAR(80),
    actualizado_por VARCHAR(80),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT usuario_accesos_modulo_estado_chk
        CHECK (estado IN ('activo', 'negado', 'vencido')),
    CONSTRAINT usuario_accesos_modulo_uk UNIQUE (usuario_id, modulo_id, permiso)
);

CREATE INDEX IF NOT EXISTS idx_usuario_accesos_modulo_usuario
    ON seguridad.usuario_accesos_modulo (usuario_id);

CREATE INDEX IF NOT EXISTS idx_usuario_accesos_modulo_modulo
    ON seguridad.usuario_accesos_modulo (modulo_id);
"""


def ensure_accesos_modulo_table(cur) -> None:
    cur.execute(DDL_ACCESOS_MODULO)


def inicio_dia_calendario(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=TZ_MX)


def fin_dia_calendario(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 23, 59, 59, 999999, tzinfo=TZ_MX)


def parse_fecha_calendario(valor: str | None, fin_dia: bool = False) -> Optional[datetime]:
    """Interpreta YYYY-MM-DD como día calendario en zona America/Tijuana."""
    if valor is None or str(valor).strip() == "":
        return None
    txt = str(valor).strip()[:10]
    d = date.fromisoformat(txt)
    return fin_dia_calendario(d) if fin_dia else inicio_dia_calendario(d)


def normalizar_fin_vigencia(fin) -> Optional[datetime]:
    """Convierte fecha_fin de BD al instante real de vencimiento (fin del día)."""
    if fin is None:
        return None
    if not isinstance(fin, datetime):
        return None
    if fin.tzinfo is None:
        fin = fin.replace(tzinfo=timezone.utc)
    utc = fin.astimezone(timezone.utc)
    # Registros legacy: medianoche UTC = día calendario elegido en el formulario
    if (utc.hour, utc.minute, utc.second, utc.microsecond) == (0, 0, 0, 0):
        return fin_dia_calendario(utc.date())
    return fin.astimezone(TZ_MX)


def _now_mx():
    return datetime.now(TZ_MX)


def acceso_esta_vigente(row: dict, ahora=None) -> bool:
    if not row:
        return False
    if str(row.get("estado") or "").lower() != "activo":
        return False
    fin = row.get("fecha_fin")
    if fin is None:
        return True
    ahora = ahora or _now_mx()
    if ahora.tzinfo is None:
        ahora = ahora.replace(tzinfo=TZ_MX)
    else:
        ahora = ahora.astimezone(TZ_MX)
    fin_mx = normalizar_fin_vigencia(fin)
    if fin_mx is None:
        return True
    return ahora <= fin_mx


def modulo_visible_por_rol(modulo_id: str, rol: str) -> bool:
    rol_norm = normalizar_rol(rol)
    for mod in MODULOS_SISTEMA:
        if mod["id"] == modulo_id:
            return rol_norm in mod.get("roles_base", [])
    return False


def modulos_visibles_usuario(cur, usuario_id: int, rol: str) -> list:
    """Módulos visibles: rol base + concesiones vigentes."""
    ensure_accesos_modulo_table(cur)
    visibles = []
    rol_norm = normalizar_rol(rol)
    ids_vistos = set()

    for mod in MODULOS_SISTEMA:
        mid = mod["id"]
        if rol_norm in mod.get("roles_base", []):
            visibles.append({
                "modulo_id": mid,
                "titulo": mod["titulo"],
                "origen": "rol",
                "estado": "activo",
                "fecha_fin": None,
            })
            ids_vistos.add(mid)

    cur.execute(
        """
        SELECT
            id,
            modulo_id,
            permiso,
            fecha_inicio,
            fecha_fin,
            estado,
            motivo
        FROM seguridad.usuario_accesos_modulo
        WHERE usuario_id = %s
        ORDER BY modulo_id, fecha_creacion DESC;
        """,
        (usuario_id,),
    )
    rows = cur.fetchall() or []
    by_modulo = {}
    for row in rows:
        mid = row.get("modulo_id")
        if mid in by_modulo:
            continue
        by_modulo[mid] = row

    for mid, row in by_modulo.items():
        if mid not in MODULOS_SISTEMA_IDS:
            continue
        vigente = acceso_esta_vigente(row)
        if vigente and mid not in ids_vistos:
            titulo = next((m["titulo"] for m in MODULOS_SISTEMA if m["id"] == mid), mid)
            visibles.append({
                "modulo_id": mid,
                "titulo": titulo,
                "origen": "concesion",
                "estado": row.get("estado"),
                "fecha_fin": row.get("fecha_fin"),
                "acceso_id": row.get("id"),
            })
            ids_vistos.add(mid)
        elif not vigente and str(row.get("estado")) == "activo" and row.get("fecha_fin"):
            cur.execute(
                """
                UPDATE seguridad.usuario_accesos_modulo
                SET estado = 'vencido', fecha_actualizacion = now()
                WHERE id = %s AND estado = 'activo';
                """,
                (row.get("id"),),
            )

    return visibles


def listar_accesos_usuario(cur, usuario_id: int) -> list:
    ensure_accesos_modulo_table(cur)
    cur.execute(
        """
        SELECT
            a.id,
            a.usuario_id,
            u.usuario,
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
        WHERE a.usuario_id = %s
        ORDER BY a.modulo_id, a.fecha_creacion DESC;
        """,
        (usuario_id,),
    )
    return cur.fetchall() or []


def validar_modulo_id(modulo_id: str) -> str:
    mid = str(modulo_id or "").strip()
    if mid not in MODULOS_SISTEMA_IDS:
        raise ValueError(f"Módulo no válido: {mid}")
    return mid
