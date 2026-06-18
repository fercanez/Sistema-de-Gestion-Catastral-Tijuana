-- Sesión por usuario y tipo: web (navegador) y servicio (scripts locales).
-- La API migra automáticamente al arrancar; este script es referencia manual.

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

ALTER TABLE seguridad.sesiones_activas
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'web';

DROP INDEX IF EXISTS seguridad.idx_sesiones_usuario_unico;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_usuario_tipo
    ON seguridad.sesiones_activas (usuario_id, tipo);
