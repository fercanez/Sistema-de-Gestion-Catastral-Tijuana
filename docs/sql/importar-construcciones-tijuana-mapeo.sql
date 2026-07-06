-- Mapeo capa construcciones_tijuana (PostGIS geonode_data)
-- Campos origen del vector:
--   nn         = niveles
--   tconstr    = tipo de construcción
--   shape_area = superficie horizontal (1 nivel)
--   t_const    = superficie total (nn * shape_area)
--   geom       = polígono SRID 32611 (UTM, metros)
--   perimetro  = ST_Perimeter(geom) en metros
--
-- Ejecutar después de ogr2ogr → public.construcciones_tijuana
--
-- Verificar columnas en predios_tijuana (clave: cve_cat_or):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'predios_tijuana'
-- ORDER BY ordinal_position;

-- 1) Columnas que espera la API / WFS / pestaña Construcciones
ALTER TABLE public.construcciones_tijuana
  ADD COLUMN IF NOT EXISTS clavecatas varchar(20),
  ADD COLUMN IF NOT EXISTS claveorig  varchar(20),
  ADD COLUMN IF NOT EXISTS claveconst varchar(30),
  ADD COLUMN IF NOT EXISTS niveles    integer,
  ADD COLUMN IF NOT EXISTS suphor     double precision,
  ADD COLUMN IF NOT EXISTS colonia    varchar(120),
  ADD COLUMN IF NOT EXISTS perimetro  double precision,
  ADD COLUMN IF NOT EXISTS tipo       varchar(50),
  ADD COLUMN IF NOT EXISTS sup_total  double precision;

-- 2) Mapear campos origen → esquema institucional
UPDATE public.construcciones_tijuana
SET
  niveles   = NULLIF(regexp_replace(COALESCE(nn::text, ''), '\D', '', 'g'), '')::int,
  tipo      = NULLIF(TRIM(tconstr::text), ''),
  suphor    = shape_area,
  sup_total = t_const,
  perimetro = ST_Perimeter(geom);

-- 2b) Geometrías inválidas (causan TopologyException en ST_Intersects)
SELECT 'construcciones_tijuana' AS capa, COUNT(*) AS invalidas
FROM public.construcciones_tijuana
WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)
UNION ALL
SELECT 'predios_tijuana', COUNT(*)
FROM public.predios_tijuana
WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);

-- 2c) Reparar geometrías (puede tardar varios minutos)
-- ST_MakeValid puede devolver GeometryCollection → forzar MultiPolygon
UPDATE public.construcciones_tijuana
SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);

UPDATE public.predios_tijuana
SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);

-- 2c-alt) Si aún falla alguna fila, truco buffer cero:
-- UPDATE public.construcciones_tijuana
-- SET geom = ST_Multi(ST_Buffer(geom, 0))
-- WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
-- UPDATE public.predios_tijuana
-- SET geom = ST_Multi(ST_Buffer(geom, 0))
-- WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);

-- 2d) Diagnóstico antes del paso 3 (si con_clave = 0)
-- SRID de ambas capas (deben coincidir, ej. 32611)
SELECT 'construcciones_tijuana' AS capa, ST_SRID(geom) AS srid
FROM public.construcciones_tijuana WHERE geom IS NOT NULL LIMIT 1;

SELECT 'predios_tijuana' AS capa, ST_SRID(geom) AS srid
FROM public.predios_tijuana WHERE geom IS NOT NULL LIMIT 1;

-- ¿Predios tienen clave?
SELECT
  COUNT(*) AS total_predios,
  COUNT(NULLIF(TRIM(cve_cat_or), '')) AS con_cve_cat_or
FROM public.predios_tijuana;

-- ¿Hay solapamiento espacial (solo bbox)?
SELECT COUNT(*) AS pares_bbox
FROM public.construcciones_tijuana c
INNER JOIN public.predios_tijuana p ON c.geom && p.geom;

-- Prueba rápida: 5 matches
SELECT c.fid, NULLIF(TRIM(p.cve_cat_or), '') AS cve
FROM public.construcciones_tijuana c
INNER JOIN public.predios_tijuana p
  ON c.geom && p.geom
 AND ST_Within(ST_PointOnSurface(c.geom), p.geom)
WHERE NULLIF(TRIM(p.cve_cat_or), '') IS NOT NULL
LIMIT 5;

-- 3) Clave catastral por intersección con predios (puede tardar)
--    predios_tijuana: clave en cve_cat_or
--    Usa ST_MakeValid + bbox (&&) para evitar TopologyException
UPDATE public.construcciones_tijuana c
SET
  clavecatas = sub.cve,
  claveorig  = sub.cve
FROM (
  SELECT DISTINCT ON (c.fid)
    c.fid,
    NULLIF(TRIM(p.cve_cat_or), '') AS cve
  FROM public.construcciones_tijuana c
  INNER JOIN public.predios_tijuana p
    ON c.geom && p.geom
   AND ST_Intersects(
         ST_MakeValid(c.geom),
         ST_MakeValid(p.geom)
       )
  WHERE c.clavecatas IS NULL
    AND NULLIF(TRIM(p.cve_cat_or), '') IS NOT NULL
  ORDER BY
    c.fid,
    ST_Area(
      ST_Intersection(
        ST_MakeValid(c.geom),
        ST_MakeValid(p.geom)
      )
    ) DESC NULLS LAST
) sub
WHERE c.fid = sub.fid;

-- 3-alt) Recomendado si con_clave=0 o paso 3 muy lento: centroide dentro del predio
UPDATE public.construcciones_tijuana c
SET clavecatas = sub.cve, claveorig = sub.cve
FROM (
  SELECT DISTINCT ON (c.fid)
    c.fid,
    NULLIF(TRIM(p.cve_cat_or), '') AS cve
  FROM public.construcciones_tijuana c
  INNER JOIN public.predios_tijuana p
    ON c.geom && p.geom
   AND ST_Within(ST_PointOnSurface(c.geom), p.geom)
  WHERE c.clavecatas IS NULL
    AND NULLIF(TRIM(p.cve_cat_or), '') IS NOT NULL
  ORDER BY c.fid, p.ctid
) sub
WHERE c.fid = sub.fid;

-- 3-srid) Solo si predios y construcciones tienen SRID distinto (ej. predios 4326, construcciones 32611):
-- UPDATE public.construcciones_tijuana c
-- SET clavecatas = sub.cve, claveorig = sub.cve
-- FROM (
--   SELECT DISTINCT ON (c.fid)
--     c.fid, NULLIF(TRIM(p.cve_cat_or), '') AS cve
--   FROM public.construcciones_tijuana c
--   INNER JOIN public.predios_tijuana p
--     ON c.geom && ST_Transform(p.geom, ST_SRID(c.geom))
--    AND ST_Within(ST_PointOnSurface(c.geom), ST_Transform(p.geom, ST_SRID(c.geom)))
--   WHERE c.clavecatas IS NULL AND NULLIF(TRIM(p.cve_cat_or), '') IS NOT NULL
--   ORDER BY c.fid, p.ctid
-- ) sub
-- WHERE c.fid = sub.fid;

-- 3b) Colonia desde predios (opcional; quitar si predios_tijuana no tiene columna colonia)
-- UPDATE public.construcciones_tijuana c
-- SET colonia = COALESCE(c.colonia, NULLIF(TRIM(p.colonia), ''))
-- FROM public.predios_tijuana p
-- WHERE c.colonia IS NULL
--   AND NULLIF(TRIM(p.colonia), '') IS NOT NULL
--   AND ST_Intersects(c.geom, p.geom);

-- 4) Clave de construcción (predio + consecutivo)
WITH ranked AS (
  SELECT
    fid,
    clavecatas,
    ROW_NUMBER() OVER (PARTITION BY clavecatas ORDER BY fid) AS n
  FROM public.construcciones_tijuana
  WHERE clavecatas IS NOT NULL
)
UPDATE public.construcciones_tijuana c
SET claveconst = ranked.clavecatas || '-C' || ranked.n
FROM ranked
WHERE c.fid = ranked.fid
  AND c.claveconst IS NULL;

-- 5) Índices
CREATE INDEX IF NOT EXISTS idx_constr_tij_geom
  ON public.construcciones_tijuana USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_constr_tij_clavecatas
  ON public.construcciones_tijuana (UPPER(TRIM(clavecatas)));
CREATE INDEX IF NOT EXISTS idx_constr_tij_claveorig
  ON public.construcciones_tijuana (UPPER(TRIM(claveorig)));

ANALYZE public.construcciones_tijuana;

-- 6) Verificación
SELECT
  COUNT(*) AS total,
  COUNT(clavecatas) AS con_clave,
  COUNT(*) FILTER (WHERE clavecatas IS NULL) AS sin_clave
FROM public.construcciones_tijuana;

SELECT clavecatas, claveconst, nn, niveles, tconstr, tipo,
       shape_area, suphor, t_const, sup_total
FROM public.construcciones_tijuana
WHERE clavecatas IS NOT NULL
LIMIT 20;

-- =============================================================================
-- 7) GeoServer: publicar / recargar capa geonode:construcciones_tijuana
--    (NO tocar construccionesmxli — ver docs/sql/restaurar-construccionesmxli.sql)
--
-- Tablas separadas:
--   construcciones_tijuana  → mapa WMS/WFS y pestaña Construcciones (visor Tijuana)
--   construccionesmxli      → lectura del backend catastro (no reemplazar desde aquí)
--
-- Visor: js/06-construcciones-medicion.js ya usa geonode:construcciones_tijuana
-- API:   routers/padron.py consulta construcciones_tijuana (GEONODE_CONSTRUCCIONES_TABLE)
-- =============================================================================
