import psycopg2
from psycopg2.extras import RealDictCursor

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
