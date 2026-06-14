-- Permisos por módulo con vigencia (Administración del Sistema)
-- Ejecutar en PostgreSQL como usuario con permisos sobre schema seguridad.

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
