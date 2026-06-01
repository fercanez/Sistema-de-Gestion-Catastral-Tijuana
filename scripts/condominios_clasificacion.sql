-- Clasificación de condominios en PostgreSQL (Mexicali catastro)
-- Ejecutar en psql conectado a la base del padrón.
-- Siempre haga SELECT antes del UPDATE para validar el alcance.

-- =============================================================================
-- 1) Normalizar padrón: Sin dato (vacío) y/o Normal (N) → Privado (P)
--    Excluye predios ya clasificados en catastro como condominio.
-- =============================================================================

-- Vista previa
SELECT COUNT(*) AS actualizables
FROM catalogos.padron_2026 p
WHERE (
    NULLIF(TRIM(COALESCE(p.condominio, '')), '') IS NULL
    OR UPPER(TRIM(p.condominio)) = 'N'
)
AND NOT EXISTS (
    SELECT 1 FROM catastro.predio_condominio pc
    WHERE UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
      AND (
          UPPER(TRIM(COALESCE(pc.regimen_catastro, ''))) = 'C'
          OR UPPER(TRIM(COALESCE(pc.modalidad, ''))) IN ('VERTICAL', 'HORIZONTAL')
      )
);

-- Aplicar (descomente cuando el conteo sea el esperado)
-- UPDATE catalogos.padron_2026 p
-- SET condominio = 'P'
-- WHERE (
--     NULLIF(TRIM(COALESCE(p.condominio, '')), '') IS NULL
--     OR UPPER(TRIM(p.condominio)) = 'N'
-- )
-- AND NOT EXISTS (
--     SELECT 1 FROM catastro.predio_condominio pc
--     WHERE UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
--       AND (
--           UPPER(TRIM(COALESCE(pc.regimen_catastro, ''))) = 'C'
--           OR UPPER(TRIM(COALESCE(pc.modalidad, ''))) IN ('VERTICAL', 'HORIZONTAL')
--       )
-- );


-- =============================================================================
-- 2) Clasificar un predio como condominio HORIZONTAL o VERTICAL (catastro)
--    Ejemplo: F4002047 en LAGO DE CUITZEO 398
-- =============================================================================

-- INSERT INTO catastro.predio_condominio (
--     clave_catastral, modalidad, nombre_condominio, regimen_catastro,
--     observaciones, usuario_actualizacion, fecha_actualizacion
-- ) VALUES (
--     'F4002047', 'HORIZONTAL', 'NOMBRE DEL CONJUNTO', 'C',
--     'Clasificación manual SQL', 'admin', now()
-- )
-- ON CONFLICT (clave_catastral) DO UPDATE SET
--     modalidad = EXCLUDED.modalidad,
--     nombre_condominio = EXCLUDED.nombre_condominio,
--     regimen_catastro = 'C',
--     observaciones = EXCLUDED.observaciones,
--     usuario_actualizacion = EXCLUDED.usuario_actualizacion,
--     fecha_actualizacion = now();

-- UPDATE catalogos.padron_2026 SET condominio = 'C' WHERE UPPER(TRIM(clave_catastral)) = 'F4002047';


-- =============================================================================
-- 3) Clasificar varias claves del mismo domicio (lista explícita)
-- =============================================================================

-- WITH claves AS (
--     SELECT unnest(ARRAY[
--         'F4002047', 'F4002048', 'F4002049'
--     ]) AS clave_catastral
-- )
-- INSERT INTO catastro.predio_condominio (
--     clave_catastral, modalidad, nombre_condominio, regimen_catastro,
--     usuario_actualizacion, fecha_actualizacion
-- )
-- SELECT c.clave_catastral, 'HORIZONTAL', 'NOMBRE DEL CONJUNTO', 'C', 'admin', now()
-- FROM claves c
-- ON CONFLICT (clave_catastral) DO UPDATE SET
--     modalidad = EXCLUDED.modalidad,
--     nombre_condominio = EXCLUDED.nombre_condominio,
--     regimen_catastro = 'C',
--     usuario_actualizacion = EXCLUDED.usuario_actualizacion,
--     fecha_actualizacion = now();

-- UPDATE catalogos.padron_2026 p
-- SET condominio = 'C'
-- WHERE UPPER(TRIM(p.clave_catastral)) IN (
--     SELECT UPPER(TRIM(clave_catastral)) FROM (
--         VALUES ('F4002047'), ('F4002048'), ('F4002049')
--     ) t(clave_catastral)
-- );


-- =============================================================================
-- 4) Clasificar por mismo domicilio (calle + número + colonia)
--    Útil para filas horizontales en la misma calle.
-- =============================================================================

-- WITH grupo AS (
--     SELECT p.clave_catastral
--     FROM catalogos.padron_2026 p
--     WHERE UPPER(TRIM(p.calle)) = 'LAGO DE CUITZEO'
--       AND UPPER(TRIM(COALESCE(p.numof, ''))) = '398'
--       AND UPPER(TRIM(p.colonia)) LIKE '%COLORADO%'
-- )
-- SELECT * FROM grupo;

-- WITH grupo AS (
--     SELECT p.clave_catastral
--     FROM catalogos.padron_2026 p
--     WHERE UPPER(TRIM(p.calle)) = 'LAGO DE CUITZEO'
--       AND UPPER(TRIM(COALESCE(p.numof, ''))) = '398'
--       AND UPPER(TRIM(p.colonia)) LIKE '%COLORADO%'
-- )
-- INSERT INTO catastro.predio_condominio (
--     clave_catastral, modalidad, nombre_condominio, regimen_catastro,
--     usuario_actualizacion, fecha_actualizacion
-- )
-- SELECT g.clave_catastral, 'HORIZONTAL', 'NOMBRE DEL CONJUNTO', 'C', 'admin', now()
-- FROM grupo g
-- ON CONFLICT (clave_catastral) DO UPDATE SET
--     modalidad = EXCLUDED.modalidad,
--     nombre_condominio = EXCLUDED.nombre_condominio,
--     regimen_catastro = 'C',
--     usuario_actualizacion = EXCLUDED.usuario_actualizacion,
--     fecha_actualizacion = now();

-- UPDATE catalogos.padron_2026 p
-- SET condominio = 'C'
-- FROM (
--     SELECT p2.clave_catastral
--     FROM catalogos.padron_2026 p2
--     WHERE UPPER(TRIM(p2.calle)) = 'LAGO DE CUITZEO'
--       AND UPPER(TRIM(COALESCE(p2.numof, ''))) = '398'
--       AND UPPER(TRIM(p2.colonia)) LIKE '%COLORADO%'
-- ) g
-- WHERE p.clave_catastral = g.clave_catastral;


-- =============================================================================
-- 6) Sincronizar padrón → C según clasificación en catastro.predio_condominio
--    (vertical, horizontal o régimen C en catastro)
-- =============================================================================

-- Vista previa: clasificados en catastro pero padrón aún no es C
-- SELECT
--     UPPER(TRIM(COALESCE(p.condominio, ''))) AS padron_actual,
--     COUNT(*) AS total
-- FROM catalogos.padron_2026 p
-- INNER JOIN catastro.predio_condominio pc
--     ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
-- WHERE (
--     UPPER(TRIM(COALESCE(pc.regimen_catastro, ''))) = 'C'
--     OR UPPER(TRIM(COALESCE(pc.modalidad, ''))) IN ('VERTICAL', 'HORIZONTAL')
-- )
-- AND UPPER(TRIM(COALESCE(p.condominio, ''))) <> 'C'
-- GROUP BY 1
-- ORDER BY 2 DESC;

-- Muestra de claves que se actualizarían
-- SELECT
--     p.clave_catastral,
--     p.condominio AS padron_actual,
--     pc.modalidad,
--     pc.regimen_catastro,
--     pc.nombre_condominio,
--     p.colonia, p.calle, p.numof
-- FROM catalogos.padron_2026 p
-- INNER JOIN catastro.predio_condominio pc
--     ON UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
-- WHERE (
--     UPPER(TRIM(COALESCE(pc.regimen_catastro, ''))) = 'C'
--     OR UPPER(TRIM(COALESCE(pc.modalidad, ''))) IN ('VERTICAL', 'HORIZONTAL')
-- )
-- AND UPPER(TRIM(COALESCE(p.condominio, ''))) <> 'C'
-- ORDER BY p.clave_catastral
-- LIMIT 50;

-- Aplicar: padrón → C solo donde catastro ya indica condominio
-- BEGIN;
-- UPDATE catalogos.padron_2026 p
-- SET condominio = 'C'
-- FROM catastro.predio_condominio pc
-- WHERE UPPER(TRIM(pc.clave_catastral)) = UPPER(TRIM(p.clave_catastral))
--   AND (
--       UPPER(TRIM(COALESCE(pc.regimen_catastro, ''))) = 'C'
--       OR UPPER(TRIM(COALESCE(pc.modalidad, ''))) IN ('VERTICAL', 'HORIZONTAL')
--   )
--   AND UPPER(TRIM(COALESCE(p.condominio, ''))) <> 'C';
-- COMMIT;

-- Verificación final del padrón
-- SELECT
--     CASE
--         WHEN UPPER(TRIM(COALESCE(condominio, ''))) = 'P' THEN 'Privado (P)'
--         WHEN UPPER(TRIM(COALESCE(condominio, ''))) = 'C' THEN 'Condominio (C)'
--         WHEN NULLIF(TRIM(COALESCE(condominio, '')), '') IS NULL THEN 'Vacío'
--         WHEN UPPER(TRIM(condominio)) = 'NULL' THEN 'Texto NULL'
--         WHEN UPPER(TRIM(condominio)) = 'N' THEN 'Normal (N)'
--         ELSE 'Otro: ' || condominio
--     END AS tipo_actual,
--     COUNT(*) AS total
-- FROM catalogos.padron_2026
-- GROUP BY 1
-- ORDER BY 2 DESC;

