-- Integracion espacial PDUCP en la base geonode_data
-- Ejecutar conectado a la base geonode_data, esquema public.
--
-- Tablas confirmadas por DBeaver:
--   public.predios_mexicali(clavecatas, geom)
--   public.diatritos_pdupm(distrito, fuente, geom)
--
-- Si el nombre real de la capa cambia a diatritos_pmdupm o diatritos_pmdum,
-- reemplazar public.diatritos_pdupm en este archivo.

CREATE INDEX IF NOT EXISTS predios_mexicali_clavecatas_idx
ON public.predios_mexicali (clavecatas);

CREATE INDEX IF NOT EXISTS predios_mexicali_geom_gix
ON public.predios_mexicali
USING gist (geom);

CREATE INDEX IF NOT EXISTS diatritos_pdupm_distrito_idx
ON public.diatritos_pdupm (distrito);

CREATE INDEX IF NOT EXISTS diatritos_pdupm_geom_gix
ON public.diatritos_pdupm
USING gist (geom);

DROP VIEW IF EXISTS public.v_predios_distrito_pducp;

CREATE OR REPLACE VIEW public.v_predios_distrito_pducp AS
SELECT
    p.clavecatas AS clave_catastral,
    substring(d.distrito from 1 for 1) AS sector,
    d.distrito,
    d.fuente
FROM public.predios_mexicali p
JOIN public.diatritos_pdupm d
  ON ST_Covers(d.geom, ST_PointOnSurface(p.geom));

COMMENT ON VIEW public.v_predios_distrito_pducp IS
'Cruce espacial entre predios de Mexicali y distritos del PDUCP usando ST_PointOnSurface del predio.';

-- Prueba validada durante el analisis:
-- Debe devolver NV108015, sector C, distrito C4.
SELECT *
FROM public.v_predios_distrito_pducp
WHERE clave_catastral = 'NV108015';
