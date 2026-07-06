-- Publicar construcciones_tijuana en GeoServer (workspace geonode)
-- Base: geonode_data | Esquema: public
-- Ruta servidor: /var/www/catastro_tijuana/sql/
--
-- Ejecutar DESPUÉS de:
--   1) Tabla cargada (ogr2ogr o similar)
--   2) importar-construcciones-tijuana-mapeo.sql
--
-- NO tocar construccionesmxli (backend catastro). Ver restaurar-construccionesmxli.sql

-- A) Diagnóstico rápido
SELECT 'construcciones_tijuana' AS tabla, COUNT(*) AS registros
FROM public.construcciones_tijuana;

SELECT COUNT(*) AS con_geom
FROM public.construcciones_tijuana WHERE geom IS NOT NULL;

SELECT ST_SRID(geom) AS srid, COUNT(*) AS n
FROM public.construcciones_tijuana
WHERE geom IS NOT NULL
GROUP BY 1;

SELECT
  COUNT(*) AS total,
  COUNT(clavecatas) AS con_clave,
  COUNT(*) FILTER (WHERE clavecatas IS NULL) AS sin_clave
FROM public.construcciones_tijuana;

SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'construcciones_tijuana';

-- B) Permisos para el store PostGIS de GeoServer (usuario geonode_data)
GRANT USAGE ON SCHEMA public TO geonode;
GRANT USAGE ON SCHEMA public TO geonode_data;
GRANT SELECT ON TABLE public.construcciones_tijuana TO geonode;
GRANT SELECT ON TABLE public.construcciones_tijuana TO geonode_data;
ALTER TABLE public.construcciones_tijuana OWNER TO geonode_data;

-- C) Probar lectura como geonode
-- SET ROLE geonode;
-- SELECT COUNT(*), MIN(ST_XMin(geom)), MIN(ST_YMin(geom)), MAX(ST_XMax(geom)), MAX(ST_YMax(geom))
-- FROM public.construcciones_tijuana WHERE geom IS NOT NULL;
-- RESET ROLE;

-- D) Índices (idempotente)
CREATE INDEX IF NOT EXISTS idx_constr_tij_geom
  ON public.construcciones_tijuana USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_constr_tij_clavecatas
  ON public.construcciones_tijuana (UPPER(TRIM(clavecatas)));
CREATE INDEX IF NOT EXISTS idx_constr_tij_claveorig
  ON public.construcciones_tijuana (UPPER(TRIM(claveorig)));

ANALYZE public.construcciones_tijuana;

-- =============================================================================
-- E) GeoServer / GeoNode (interfaz web — no se ejecuta en SQL)
--
-- Capa esperada: geonode:construcciones_tijuana
-- Native SRS:     EPSG:32611
-- Bounds manuales (NO "Compute from data"):
--   MinX 631863.56  MinY 3603096.52  MaxX 664943.17  MaxY 3646026.19
-- =============================================================================
