-- Consultas de enlace PDUCP para dictamen preliminar.
-- Ejecutar en catastro_bc.
--
-- Objetivo:
--   clave catastral -> distrito PDUCP -> matriz de compatibilidad
--
-- PASO 1. Detectar que tablas/vistas de GeoNode ve catastro_bc mediante FDW.
-- En DBeaver se observan esquemas posibles:
--   fdw_geonode
--   geonode_fdw
--
-- Ejecutar primero SOLO este bloque de diagnostico.

SELECT
    table_schema,
    table_name
FROM information_schema.tables
WHERE table_schema IN ('fdw_geonode', 'geonode_fdw')
  AND (
      table_name ILIKE '%predios%'
      OR table_name ILIKE '%distrito%'
      OR table_name ILIKE '%diatrito%'
      OR table_name ILIKE '%pducp%'
  )
ORDER BY table_schema, table_name;

SELECT
    foreign_table_schema,
    foreign_table_name
FROM information_schema.foreign_tables
WHERE foreign_table_schema IN ('fdw_geonode', 'geonode_fdw')
ORDER BY foreign_table_schema, foreign_table_name;

-- PASO 1B. Si solo aparece predios_mexicali, falta importar distritos.
-- Primero identificar el nombre del foreign server usado por el FDW:

SELECT
    n.nspname AS foreign_schema,
    c.relname AS foreign_table,
    s.srvname AS foreign_server,
    ft.ftoptions
FROM pg_foreign_table ft
JOIN pg_class c ON c.oid = ft.ftrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_foreign_server s ON s.oid = ft.ftserver
WHERE n.nspname IN ('fdw_geonode', 'geonode_fdw')
ORDER BY n.nspname, c.relname;

-- PASO 1C. Con el foreign_server encontrado arriba, importar la tabla de distritos.
-- Reemplazar NOMBRE_DEL_FOREIGN_SERVER por el valor de foreign_server.
-- Usar el esquema donde ya existe predios_mexicali; por tus capturas puede ser fdw_geonode.

-- IMPORT FOREIGN SCHEMA public
-- LIMIT TO (diatritos_pdupm)
-- FROM SERVER NOMBRE_DEL_FOREIGN_SERVER
-- INTO fdw_geonode;

-- Si quieres importar tambien la vista creada en geonode_data:
-- IMPORT FOREIGN SCHEMA public
-- LIMIT TO (v_predios_distrito_pducp)
-- FROM SERVER NOMBRE_DEL_FOREIGN_SERVER
-- INTO fdw_geonode;

-- PASO 2A.
-- Usar esta variante si en el diagnostico existe:
--   geonode_fdw.v_predios_distrito_pducp

CREATE OR REPLACE VIEW pducp.v_predio_compatibilidad AS
SELECT
    v.clave_catastral,
    v.sector AS sector_pducp,
    v.distrito,
    v.fuente AS fuente_distrito,
    m.uso_grupo,
    m.codigo_actividad,
    m.actividad,
    m.compatibilidad,
    m.compatibilidad_desc,
    m.confianza_color,
    m.fuente AS fuente_matriz,
    m.nota
FROM geonode_fdw.v_predios_distrito_pducp v
JOIN pducp.matriz_compatibilidad m
  ON m.distrito = v.distrito;

SELECT *
FROM pducp.v_predio_compatibilidad
WHERE clave_catastral = 'NV108015'
ORDER BY uso_grupo, codigo_actividad
LIMIT 50;

-- PASO 2B.
-- Usar esta variante si existen las foreign tables:
--   fdw_geonode.predios_mexicali
--   fdw_geonode.diatritos_pdupm

CREATE OR REPLACE VIEW pducp.v_predio_compatibilidad_desde_fdw AS
SELECT
    p.clavecatas AS clave_catastral,
    substring(d.distrito from 1 for 1) AS sector_pducp,
    d.distrito,
    d.fuente AS fuente_distrito,
    m.uso_grupo,
    m.codigo_actividad,
    m.actividad,
    m.compatibilidad,
    m.compatibilidad_desc,
    m.confianza_color,
    m.fuente AS fuente_matriz,
    m.nota
FROM fdw_geonode.predios_mexicali p
JOIN fdw_geonode.diatritos_pdupm d
  ON ST_Covers(d.geom, ST_PointOnSurface(p.geom))
JOIN pducp.matriz_compatibilidad m
  ON m.distrito = d.distrito;

SELECT *
FROM pducp.v_predio_compatibilidad_desde_fdw
WHERE clave_catastral = 'NV108015'
ORDER BY uso_grupo, codigo_actividad
LIMIT 50;

-- PASO 3. Vista resumida para consulta operativa.
-- Esta vista normaliza el resultado de compatibilidad para dictamen preliminar.

CREATE OR REPLACE VIEW pducp.v_predio_dictamen_uso AS
SELECT
    clave_catastral,
    sector_pducp,
    distrito,
    fuente_distrito,
    uso_grupo,
    codigo_actividad,
    actividad,
    compatibilidad,
    CASE
        WHEN compatibilidad = 'C' THEN 'Compatible'
        WHEN compatibilidad = 'COND' THEN 'Condicionada'
        WHEN compatibilidad = 'NP' THEN 'No permitida'
        ELSE 'Revisar'
    END AS resultado,
    CASE
        WHEN compatibilidad = 'NP' THEN 1
        WHEN compatibilidad = 'COND' THEN 2
        WHEN compatibilidad = 'C' THEN 3
        ELSE 4
    END AS prioridad_revision,
    confianza_color,
    nota
FROM pducp.v_predio_compatibilidad_desde_fdw;

COMMENT ON VIEW pducp.v_predio_dictamen_uso IS
'Vista resumida para consultar compatibilidad preliminar de uso por clave catastral y actividad PDUCP.';

-- Consulta ejemplo: todos los usos de una clave.
SELECT
    clave_catastral,
    distrito,
    uso_grupo,
    codigo_actividad,
    actividad,
    resultado
FROM pducp.v_predio_dictamen_uso
WHERE clave_catastral = 'NV108015'
ORDER BY prioridad_revision, uso_grupo, codigo_actividad
LIMIT 100;

-- Consulta ejemplo: busqueda por actividad.
SELECT
    clave_catastral,
    distrito,
    uso_grupo,
    codigo_actividad,
    actividad,
    resultado
FROM pducp.v_predio_dictamen_uso
WHERE clave_catastral = 'NV108015'
  AND (
      actividad ILIKE '%alimento%'
      OR actividad ILIKE '%bebida%'
      OR actividad ILIKE '%preparacion%'
      OR actividad ILIKE '%preparación%'
      OR actividad ILIKE '%comida%'
  )
ORDER BY prioridad_revision, codigo_actividad;

-- PASO 2C.
-- Si se prefiere usar el esquema geonode_fdw, importar tambien ahi la capa
-- diatritos_pdupm y reemplazar fdw_geonode por geonode_fdw.
