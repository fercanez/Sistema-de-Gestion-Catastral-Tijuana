-- Zonas homogeneas adicionales o temporales (fuera de tabla oficial PDF)
CREATE TABLE IF NOT EXISTS catalogos.cat_zonas_homogeneas_adicionales (
    id SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL,
    subsector TEXT,
    homoclave_col_fracc TEXT,
    seccion TEXT,
    codigo_zona_homogenea TEXT NOT NULL,
    descripcion_col_fracc TEXT NOT NULL,
    valor_m2 NUMERIC(12,2) NOT NULL,
    tipo_zona TEXT NOT NULL DEFAULT 'ADICIONAL',
    fundamento_legal TEXT,
    clave_catastral_origen TEXT,
    movimiento_id BIGINT,
    usuario_registro TEXT,
    fecha_registro TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_cat_zonas_adic_anio
    ON catalogos.cat_zonas_homogeneas_adicionales(anio);
CREATE INDEX IF NOT EXISTS idx_cat_zonas_adic_codigo
    ON catalogos.cat_zonas_homogeneas_adicionales(codigo_zona_homogenea);
