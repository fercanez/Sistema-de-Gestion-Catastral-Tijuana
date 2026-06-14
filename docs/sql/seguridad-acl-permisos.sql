-- ACL dinámico: permisos y asignación por rol (PostgreSQL)
-- Ejecutar en el esquema seguridad. La API también crea estas tablas al primer uso.

CREATE TABLE IF NOT EXISTS seguridad.permisos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(80) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    es_sistema BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seguridad.rol_permisos (
    rol_id INTEGER NOT NULL REFERENCES seguridad.roles(id) ON DELETE CASCADE,
    permiso_id INTEGER NOT NULL REFERENCES seguridad.permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_rol_permisos_rol ON seguridad.rol_permisos (rol_id);
CREATE INDEX IF NOT EXISTS idx_rol_permisos_permiso ON seguridad.rol_permisos (permiso_id);

-- Tras ejecutar, reiniciar la API para que siembre permisos/roles desde ACL_BACKEND:
--   systemctl restart catastro-api
