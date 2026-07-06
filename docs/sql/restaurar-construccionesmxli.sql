-- Restaurar public.construccionesmxli (catastro institucional)
-- Base: geonode_data
-- NO confundir con construcciones_tijuana (capa Tijuana / GeoServer)
--
-- Si construccionesmxli tiene el mismo COUNT(*) que construcciones_tijuana,
-- fue sobrescrita por error. Restaurar ANTES de seguir con Tijuana.

-- =============================================================================
-- A0) Confirmar sustitución accidental
-- =============================================================================
SELECT 'construccionesmxli' AS tabla, COUNT(*) AS registros
FROM public.construccionesmxli
UNION ALL
SELECT 'construcciones_tijuana', COUNT(*)
FROM public.construcciones_tijuana;
-- Si ambos iguales (ej. 1369119) → mxli hay que restaurar desde respaldo externo.

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'construccionesmxli'
ORDER BY ordinal_position;
-- Original mxli: clavecatas, claveconst, niveles, suphor…
-- Si aparecen nn, tconstr, shape_area → datos de Tijuana copiados por error.

-- Buscar otras tablas construcciones (copia legacy)
SELECT tablename, pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS tamano
FROM pg_tables
WHERE schemaname = 'public' AND tablename ILIKE '%construcc%'
ORDER BY tablename;

-- =============================================================================
-- B) Restaurar desde tabla respaldo (elige UNA variante)
-- =============================================================================

-- B1) Si existe construccionesmxli_backup (renombrar swap — más rápido)
-- BEGIN;
-- ALTER TABLE public.construccionesmxli RENAME TO construccionesmxli_mala_20260705;
-- ALTER TABLE public.construccionesmxli_backup RENAME TO construccionesmxli;
-- COMMIT;

-- B2) Si el respaldo tiene otro nombre (ej. construccionesmxli_backup_20260705)
-- BEGIN;
-- ALTER TABLE public.construccionesmxli RENAME TO construccionesmxli_mala_20260705;
-- ALTER TABLE public.construccionesmxli_backup_20260705 RENAME TO construccionesmxli;
-- COMMIT;

-- B3) Copiar desde respaldo sin borrar el respaldo
-- BEGIN;
-- DROP TABLE IF EXISTS public.construccionesmxli;
-- CREATE TABLE public.construccionesmxli AS
-- SELECT * FROM public.construccionesmxli_backup;
-- COMMIT;

-- =============================================================================
-- C) Restaurar desde dump PostgreSQL (si no hay tabla respaldo)
-- =============================================================================
-- En el servidor (shell), si tienen un .dump o .sql previo:
--
--   pg_restore -h 127.0.0.1 -U geonode -d geonode_data \
--     --table=construccionesmxli --clean --if-exists \
--     /ruta/al/respaldo_construccionesmxli.dump
--
-- o:
--   psql -h 127.0.0.1 -U geonode -d geonode_data \
--     -f /ruta/al/respaldo_construccionesmxli.sql

-- =============================================================================
-- D) Recrear índices típicos (después de restaurar)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_construccionesmxli_geom
  ON public.construccionesmxli USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_construccionesmxli_clavecatas
  ON public.construccionesmxli (UPPER(TRIM(clavecatas)));

CREATE INDEX IF NOT EXISTS idx_construccionesmxli_claveorig
  ON public.construccionesmxli (UPPER(TRIM(claveorig)));

ANALYZE public.construccionesmxli;

-- =============================================================================
-- E) Verificación post-restauración
-- =============================================================================

SELECT COUNT(*) AS registros FROM public.construccionesmxli;

SELECT clavecatas, claveconst, niveles, suphor, tipo
FROM public.construccionesmxli
WHERE clavecatas IS NOT NULL
LIMIT 10;

-- =============================================================================
-- G) Permisos PostGIS (OBLIGATORIO si importó con ogr2ogr como canez u otro usuario)
--    GeoServer error: permission denied for table construccionesmxli
-- =============================================================================

-- Ver dueño y usuario del store GeoServer (suele ser geonode)
SELECT tablename, tableowner FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'construccionesmxli';

-- Ejecutar como postgres o superuser:
GRANT USAGE ON SCHEMA public TO geonode;
GRANT SELECT ON TABLE public.construccionesmxli TO geonode;
ALTER TABLE public.construccionesmxli OWNER TO geonode;

-- Si el store usa otro usuario, repita GRANT para ese rol.

-- Probar como geonode:
-- SET ROLE geonode;
-- SELECT COUNT(*) FROM public.construccionesmxli;
-- RESET ROLE;

-- GeoServer: bounds MANUALES (no usar "Compute from data")
-- Native SRS: EPSG:32611
-- MinX 631863.56  MinY 3603096.52  MaxX 664943.17  MaxY 3646026.19
-- 1. GeoNode → capa construccionesmxli (si existe como layer separado)
-- 2. GeoServer → Stores → datastore PostGIS → Reload
-- 3. Layers → construccionesmxli → Reload
--
-- Probar WFS:
-- https://fcnarqnodo.hopto.org/geoserver/geonode/wfs?
--   service=WFS&version=1.1.0&request=GetFeature&
--   typeName=geonode:construccionesmxli&outputFormat=application/json&maxFeatures=1
