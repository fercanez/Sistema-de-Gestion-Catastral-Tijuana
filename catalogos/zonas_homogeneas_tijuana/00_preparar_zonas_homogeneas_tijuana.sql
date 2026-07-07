-- Paso 1 de 4: ejecutar primero en DBeaver (Execute SQL Script)

CREATE SCHEMA IF NOT EXISTS catalogos;

CREATE TABLE IF NOT EXISTS catalogos.cat_zonas_homogeneas_detalle (
    id SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL,
    zona TEXT NOT NULL,
    sector TEXT NOT NULL,
    subsector TEXT NOT NULL,
    homoclave_col_fracc TEXT NOT NULL,
    seccion TEXT NOT NULL,
    descripcion_col_fracc TEXT NOT NULL,
    valor_m2 NUMERIC(12,2) NOT NULL,
    codigo_zona_homogenea TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (anio, zona, sector, subsector, homoclave_col_fracc, seccion, descripcion_col_fracc)
);


DELETE FROM catalogos.cat_zonas_homogeneas_detalle
WHERE anio IN (2024, 2025, 2026);


CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (codigo_zona_homogenea);

CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_anio_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (anio, codigo_zona_homogenea);

