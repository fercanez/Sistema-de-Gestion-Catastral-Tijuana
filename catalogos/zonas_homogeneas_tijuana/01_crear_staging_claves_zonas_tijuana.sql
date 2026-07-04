-- Paso 1: crear tabla temporal de carga para relacion predio -> zona homogenea.
-- Ejecutar en la base catastro_tijuana.
-- Despues importar con DBeaver el archivo:
--   catalogos/zonas_homogeneas_tijuana/claves zh tij.csv
-- hacia staging.claves_zonas_homogeneas_tijuana.

CREATE SCHEMA IF NOT EXISTS staging;

DROP TABLE IF EXISTS staging.claves_zonas_homogeneas_tijuana;

CREATE TABLE staging.claves_zonas_homogeneas_tijuana (
    "CLAVE_CATASTRAL" TEXT,
    "zona homogenea" TEXT
);

COMMENT ON TABLE staging.claves_zonas_homogeneas_tijuana IS
'Relacion importada desde CSV de Tijuana: clave catastral -> zona homogenea.';

COMMENT ON COLUMN staging.claves_zonas_homogeneas_tijuana."CLAVE_CATASTRAL" IS
'Columna CSV original: CLAVE_CATASTRAL.';

COMMENT ON COLUMN staging.claves_zonas_homogeneas_tijuana."zona homogenea" IS
'Columna CSV original: zona homogenea.';
