import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import date, datetime
from decimal import Decimal

from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, GEONODE_DB_NAME


def get_conn():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        cursor_factory=RealDictCursor,
    )


def get_geonode_conn():
    """Conexión a geonode_data (capa construccionesmxli y otras de GeoNode)."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=GEONODE_DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        cursor_factory=RealDictCursor,
    )


def columnas_tabla(cur, esquema: str, tabla: str) -> set:
    """Devuelve el conjunto de nombres de columnas de una tabla."""
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s
          AND table_name = %s;
        """,
        (esquema, tabla),
    )
    return {r["column_name"] for r in cur.fetchall()}


def valor_json_serializable(valor):
    """Convierte tipos de PostgreSQL a JSON estándar."""
    if valor is None:
        return None
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    if isinstance(valor, dict):
        return {k: valor_json_serializable(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [valor_json_serializable(v) for v in valor]
    return valor


def fila_a_dict(fila):
    if not fila:
        return {}
    raw = fila if isinstance(fila, dict) else dict(fila)
    return {k: valor_json_serializable(v) for k, v in raw.items()}


def filas_a_lista(filas):
    return [fila_a_dict(f) for f in (filas or [])]


def asegurar_tabla_predio_condominio(cur, conn) -> None:
    """Crea catastro.predio_condominio y agrega columnas nuevas si faltan."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS catastro.predio_condominio (
            clave_catastral VARCHAR(30) PRIMARY KEY,
            modalidad VARCHAR(20),
            nombre_condominio VARCHAR(200),
            regimen_catastro VARCHAR(1),
            observaciones TEXT,
            usuario_actualizacion VARCHAR(80),
            fecha_actualizacion TIMESTAMP DEFAULT now()
        );
    """)
    cols = columnas_tabla(cur, "catastro", "predio_condominio")
    if "nombre_condominio" not in cols:
        cur.execute(
            "ALTER TABLE catastro.predio_condominio ADD COLUMN IF NOT EXISTS nombre_condominio VARCHAR(200);"
        )
    if "regimen_catastro" not in cols:
        cur.execute(
            "ALTER TABLE catastro.predio_condominio ADD COLUMN IF NOT EXISTS regimen_catastro VARCHAR(1);"
        )
    cur.execute("""
        UPDATE catastro.predio_condominio
        SET regimen_catastro = 'C'
        WHERE modalidad IN ('VERTICAL', 'HORIZONTAL')
          AND NULLIF(TRIM(regimen_catastro), '') IS NULL;
    """)
    conn.commit()


def asegurar_columna_folio_real_padron(cur, conn) -> None:
    """Agrega catalogos.padron_2026.folio_real si aún no existe."""
    cols = columnas_tabla(cur, "catalogos", "padron_2026")
    if "folio_real" in cols:
        return
    cur.execute("ALTER TABLE catalogos.padron_2026 ADD COLUMN folio_real VARCHAR(32);")
    conn.commit()
