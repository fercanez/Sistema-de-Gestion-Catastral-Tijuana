-- Sesión única por usuario con expiración por inactividad (API valida en auth/sessions.py).
-- La tabla se crea automáticamente al arrancar la API; este script es referencia manual.

CREATE TABLE IF NOT EXISTS seguridad.sesiones_activas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES seguridad.usuarios(id) ON DELETE CASCADE,
    jti VARCHAR(64) NOT NULL UNIQUE,
    ip VARCHAR(64),
    user_agent TEXT,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_usuario_unico
    ON seguridad.sesiones_activas (usuario_id);
