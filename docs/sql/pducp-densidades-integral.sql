-- Carga de densidades PDUCP y vista integral de dictamen.
-- Ejecutar conectado a catastro_bc.

CREATE SCHEMA IF NOT EXISTS pducp;

ALTER TABLE pducp.densidades_distrito
    ADD COLUMN IF NOT EXISTS sector_nombre text,
    ADD COLUMN IF NOT EXISTS cos_rango text,
    ADD COLUMN IF NOT EXISTS cos_min numeric,
    ADD COLUMN IF NOT EXISTS cos_max numeric,
    ADD COLUMN IF NOT EXISTS cus_rango text,
    ADD COLUMN IF NOT EXISTS cus_min numeric,
    ADD COLUMN IF NOT EXISTS cus_max numeric;

-- Las columnas cos y cus se conservan como valor operativo maximo del rango.
-- Si se importa el CSV con DBeaver, mapear:
--   cos_max -> cos
--   cus_max -> cus
-- o ejecutar el UPDATE despues de importar.

UPDATE pducp.densidades_distrito
SET
    cos = COALESCE(cos, cos_max),
    cus = COALESCE(cus, cus_max)
WHERE cos IS NULL
   OR cus IS NULL;

CREATE INDEX IF NOT EXISTS densidades_distrito_cos_cus_idx
ON pducp.densidades_distrito (cos_max, cus_max);

-- Importar con DBeaver el archivo:
-- E:\Sistemas en Github\Sistema-de-Gestion-Catastral\outputs\pducp_densidades\densidades_distrito_pducp.csv
--
-- Tabla destino:
-- pducp.densidades_distrito
--
-- Recomendacion:
-- 1) Truncar la tabla si es una recarga completa:
--    TRUNCATE pducp.densidades_distrito;
-- 2) Importar columnas por nombre.
-- 3) Ejecutar:
--    UPDATE pducp.densidades_distrito SET cos = cos_max, cus = cus_max;

CREATE OR REPLACE VIEW pducp.v_predio_dictamen_integral AS
SELECT
    u.clave_catastral,
    u.sector_pducp,
    u.distrito,
    u.fuente_distrito,
    d.sector_nombre,
    d.cos_rango,
    d.cos_min,
    d.cos_max,
    d.cus_rango,
    d.cus_min,
    d.cus_max,
    d.densidad_unifamiliar_codigo,
    d.densidad_unifamiliar_min,
    d.densidad_unifamiliar_max,
    d.densidad_multifamiliar_codigo,
    d.densidad_multifamiliar_min,
    d.densidad_multifamiliar_max,
    u.uso_grupo,
    u.codigo_actividad,
    u.actividad,
    u.compatibilidad,
    u.resultado,
    u.prioridad_revision,
    u.confianza_color,
    u.nota AS nota_compatibilidad,
    d.nota AS nota_densidad
FROM pducp.v_predio_dictamen_uso u
LEFT JOIN pducp.densidades_distrito d
  ON d.distrito = u.distrito;

COMMENT ON VIEW pducp.v_predio_dictamen_integral IS
'Dictamen preliminar integral: clave catastral, distrito PDUCP, compatibilidad de uso, COS/CUS y densidades habitacionales.';

-- Prueba con la clave usada durante la integracion:
SELECT
    clave_catastral,
    distrito,
    cos_rango,
    cus_rango,
    densidad_unifamiliar_codigo,
    densidad_unifamiliar_min,
    densidad_unifamiliar_max,
    densidad_multifamiliar_codigo,
    densidad_multifamiliar_min,
    densidad_multifamiliar_max,
    uso_grupo,
    codigo_actividad,
    actividad,
    resultado
FROM pducp.v_predio_dictamen_integral
WHERE clave_catastral = 'NV108015'
  AND actividad ILIKE '%alimento%'
ORDER BY prioridad_revision, codigo_actividad;

