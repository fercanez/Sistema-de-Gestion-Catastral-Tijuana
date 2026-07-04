-- Paso 2: aplicar zona homogenea al padron y cruzar valores 2024-2026.
-- Ejecutar en catastro_tijuana DESPUES de importar el CSV a:
--   staging.claves_zonas_homogeneas_tijuana

CREATE SCHEMA IF NOT EXISTS catalogos;

-- Asegura columnas de trabajo en padron_2026.
ALTER TABLE catalogos.padron_2026
    ADD COLUMN IF NOT EXISTS zonah TEXT,
    ADD COLUMN IF NOT EXISTS valor2024 NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS valor2025 NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS valor2026 NUMERIC(12,2);

-- Normaliza staging: quita espacios, guiones y puntos en clave; deja zona en mayusculas.
DROP TABLE IF EXISTS staging.claves_zonas_homogeneas_tijuana_norm;

CREATE TABLE staging.claves_zonas_homogeneas_tijuana_norm AS
SELECT DISTINCT ON (
    regexp_replace(upper(trim("CLAVE_CATASTRAL")), '[^A-Z0-9]', '', 'g')
)
    regexp_replace(upper(trim("CLAVE_CATASTRAL")), '[^A-Z0-9]', '', 'g') AS clave_catastral_norm,
    upper(trim("zona homogenea")) AS zona_homogenea
FROM staging.claves_zonas_homogeneas_tijuana
WHERE nullif(trim(coalesce("CLAVE_CATASTRAL", '')), '') IS NOT NULL
  AND nullif(trim(coalesce("zona homogenea", '')), '') IS NOT NULL
ORDER BY
    regexp_replace(upper(trim("CLAVE_CATASTRAL")), '[^A-Z0-9]', '', 'g'),
    upper(trim("zona homogenea"));

CREATE INDEX IF NOT EXISTS claves_zonas_tijuana_norm_clave_idx
ON staging.claves_zonas_homogeneas_tijuana_norm (clave_catastral_norm);

CREATE INDEX IF NOT EXISTS claves_zonas_tijuana_norm_zona_idx
ON staging.claves_zonas_homogeneas_tijuana_norm (zona_homogenea);

-- Indices utiles para el cruce.
CREATE INDEX IF NOT EXISTS padron_2026_clave_norm_idx
ON catalogos.padron_2026 (
    regexp_replace(upper(trim(clave_catastral::text)), '[^A-Z0-9]', '', 'g')
);

CREATE INDEX IF NOT EXISTS cat_zonas_homogeneas_detalle_anio_codigo_idx
ON catalogos.cat_zonas_homogeneas_detalle (anio, codigo_zona_homogenea);

-- Aplica zona homogenea y valores unitarios por anio al padron.
WITH valores AS (
    SELECT
        upper(trim(codigo_zona_homogenea)) AS zona_homogenea,
        max(valor_m2) FILTER (WHERE anio = 2024) AS valor2024,
        max(valor_m2) FILTER (WHERE anio = 2025) AS valor2025,
        max(valor_m2) FILTER (WHERE anio = 2026) AS valor2026
    FROM catalogos.cat_zonas_homogeneas_detalle
    WHERE activo = TRUE
      AND anio IN (2024, 2025, 2026)
    GROUP BY upper(trim(codigo_zona_homogenea))
),
fuente AS (
    SELECT
        z.clave_catastral_norm,
        z.zona_homogenea,
        v.valor2024,
        v.valor2025,
        v.valor2026
    FROM staging.claves_zonas_homogeneas_tijuana_norm z
    LEFT JOIN valores v
      ON v.zona_homogenea = z.zona_homogenea
)
UPDATE catalogos.padron_2026 p
SET
    zonah = f.zona_homogenea,
    valor2024 = f.valor2024,
    valor2025 = f.valor2025,
    valor2026 = f.valor2026
FROM fuente f
WHERE regexp_replace(upper(trim(p.clave_catastral::text)), '[^A-Z0-9]', '', 'g') = f.clave_catastral_norm;

-- Vista de consulta: cada predio con su zona y valores 2024-2026.
CREATE OR REPLACE VIEW catalogos.v_padron_zonas_valores_tijuana AS
WITH valores AS (
    SELECT
        upper(trim(codigo_zona_homogenea)) AS zona_homogenea,
        max(descripcion_col_fracc) FILTER (WHERE anio = 2026) AS descripcion_zona_2026,
        max(valor_m2) FILTER (WHERE anio = 2024) AS valor2024,
        max(valor_m2) FILTER (WHERE anio = 2025) AS valor2025,
        max(valor_m2) FILTER (WHERE anio = 2026) AS valor2026
    FROM catalogos.cat_zonas_homogeneas_detalle
    WHERE activo = TRUE
      AND anio IN (2024, 2025, 2026)
    GROUP BY upper(trim(codigo_zona_homogenea))
)
SELECT
    p.clave_catastral,
    p.zonah AS zona_homogenea,
    v.descripcion_zona_2026,
    v.valor2024,
    v.valor2025,
    v.valor2026,
    p.nombre_completo,
    p.colonia,
    p.calle,
    p.numof,
    p.sup_documental,
    p.sup_fisica
FROM catalogos.padron_2026 p
LEFT JOIN valores v
  ON upper(trim(p.zonah)) = v.zona_homogenea;

-- Resumen de control.
SELECT
    count(*) AS filas_csv_importadas,
    count(*) FILTER (WHERE zona_homogenea IS NOT NULL AND zona_homogenea <> '') AS filas_con_zona,
    count(DISTINCT zona_homogenea) AS zonas_unicas_csv
FROM staging.claves_zonas_homogeneas_tijuana_norm;

SELECT
    count(*) AS predios_padron_con_zona,
    count(*) FILTER (WHERE valor2026 IS NOT NULL) AS predios_con_valor_2026,
    count(*) FILTER (WHERE zonah IS NOT NULL AND valor2026 IS NULL) AS predios_con_zona_sin_valor_2026
FROM catalogos.padron_2026;

SELECT
    z.zona_homogenea,
    count(*) AS predios
FROM staging.claves_zonas_homogeneas_tijuana_norm z
LEFT JOIN catalogos.cat_zonas_homogeneas_detalle d
  ON d.anio = 2026
 AND upper(trim(d.codigo_zona_homogenea)) = z.zona_homogenea
WHERE d.id IS NULL
GROUP BY z.zona_homogenea
ORDER BY predios DESC, z.zona_homogenea
LIMIT 100;
