-- Diagnóstico rápido: nombres con ? o mojibake en padrón Tijuana
-- Ejecutar en DBeaver (BD catastro_tijuana) antes/después del script Python.

-- A) Catálogo personas (fuente de titulares: nombre, apellido_paterno, apellido_materno, razon_social)
SELECT
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(apellido_materno, '')) > 0) AS materno_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(apellido_paterno, '')) > 0) AS paterno_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(nombre, '')) > 0) AS nombre_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(razon_social, '')) > 0) AS razon_con_interrogacion
FROM catalogos.personas;

SELECT id_persona, nombre, apellido_paterno, apellido_materno, razon_social
FROM catalogos.personas
WHERE POSITION('?' IN COALESCE(apellido_materno, '')) > 0
   OR POSITION('?' IN COALESCE(apellido_paterno, '')) > 0
ORDER BY id_persona
LIMIT 30;

-- B) Padrón fiscal
-- 1) Conteo general
SELECT
  COUNT(*) AS total_padron,
  COUNT(*) FILTER (WHERE POSITION('?' IN nombre_completo) > 0) AS nombre_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('Ã' IN nombre_completo) > 0) AS nombre_mojibake,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(colonia, '')) > 0) AS colonia_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(calle, '')) > 0) AS calle_con_interrogacion
FROM catalogos.padron_2026;

-- 2) Ejemplos IBA?EZ y similares
SELECT clave_catastral, nombre_completo, colonia, calle
FROM catalogos.padron_2026
WHERE POSITION('?' IN nombre_completo) > 0
   OR POSITION('?' IN COALESCE(colonia, '')) > 0
ORDER BY clave_catastral
LIMIT 50;

-- 3) Comparar con staging (si existe y tiene datos limpios)
-- SELECT p.clave_catastral,
--        p.nombre_completo AS padron_actual,
--        s.nombre_completo AS staging_limpio
-- FROM catalogos.padron_2026 p
-- JOIN staging.padron_tijuana s
--   ON UPPER(TRIM(p.clave_catastral)) = UPPER(TRIM(s.clave_catastral))
-- WHERE p.nombre_completo LIKE '%?%'
--   AND s.nombre_completo NOT LIKE '%?%'
-- LIMIT 30;

-- 4) Corrección puntual manual (ejemplo)
-- UPDATE catalogos.padron_2026
-- SET paterno = REPLACE(paterno, '?', 'Ñ'),
--     nombre_completo = REPLACE(nombre_completo, '?', 'Ñ')
-- WHERE paterno LIKE '%?%';

-- =============================================================================
-- C) Corregir colonia y calle en padron_2026 (? entre letras → Ñ)
--    Ejecutar en orden: vista previa → UPDATE → verificación
-- =============================================================================

-- C.0) Conteo antes
SELECT
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(colonia, '')) > 0) AS colonia_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(calle, '')) > 0) AS calle_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('Ã' IN COALESCE(colonia, '')) > 0) AS colonia_mojibake,
  COUNT(*) FILTER (WHERE POSITION('Ã' IN COALESCE(calle, '')) > 0) AS calle_mojibake
FROM catalogos.padron_2026;

-- C.1) Vista previa colonia (30 ejemplos)
SELECT DISTINCT colonia,
       REGEXP_REPLACE(colonia, '([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\?([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])', '\1Ñ\2', 'g') AS colonia_corregida
FROM catalogos.padron_2026
WHERE POSITION('?' IN COALESCE(colonia, '')) > 0
ORDER BY colonia
LIMIT 30;

-- C.2) Vista previa calle (30 ejemplos)
SELECT DISTINCT calle,
       REGEXP_REPLACE(calle, '([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\?([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])', '\1Ñ\2', 'g') AS calle_corregida
FROM catalogos.padron_2026
WHERE POSITION('?' IN COALESCE(calle, '')) > 0
ORDER BY calle
LIMIT 30;

-- C.3) Aplicar corrección (repite hasta agotar ? entre letras; máx. 5 pasadas)
DO $$
DECLARE
  v_colonia int := 1;
  v_calle int := 1;
  v_paso int := 0;
  rx text := '([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\?([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])';
BEGIN
  WHILE (v_colonia > 0 OR v_calle > 0) AND v_paso < 5 LOOP
    v_paso := v_paso + 1;

    UPDATE catalogos.padron_2026
    SET colonia = REGEXP_REPLACE(colonia, rx, '\1Ñ\2', 'g')
    WHERE colonia ~ rx;
    GET DIAGNOSTICS v_colonia = ROW_COUNT;

    UPDATE catalogos.padron_2026
    SET calle = REGEXP_REPLACE(calle, rx, '\1Ñ\2', 'g')
    WHERE calle ~ rx;
    GET DIAGNOSTICS v_calle = ROW_COUNT;

    RAISE NOTICE 'Paso %: colonia=%, calle=%', v_paso, v_colonia, v_calle;
  END LOOP;
END $$;

-- C.3b) Topónimos: PE?N → PEÑON, CA?N → CAÑON (la Ñ corrompida pierde la O)
-- Vista previa
SELECT DISTINCT calle,
       REGEXP_REPLACE(calle, '(PE|CA|ARE|PI)\?N', '\1ÑON', 'g') AS calle_corregida
FROM catalogos.padron_2026
WHERE calle ~ '(PE|CA|ARE|PI)\?N'
UNION
SELECT DISTINCT colonia,
       REGEXP_REPLACE(colonia, '(PE|CA|ARE|PI)\?N', '\1ÑON', 'g')
FROM catalogos.padron_2026
WHERE colonia ~ '(PE|CA|ARE|PI)\?N';

-- Aplicar
UPDATE catalogos.padron_2026
SET calle = REGEXP_REPLACE(calle, '(PE|CA|ARE|PI)\?N', '\1ÑON', 'g')
WHERE calle ~ '(PE|CA|ARE|PI)\?N';

UPDATE catalogos.padron_2026
SET colonia = REGEXP_REPLACE(colonia, '(PE|CA|ARE|PI)\?N', '\1ÑON', 'g')
WHERE colonia ~ '(PE|CA|ARE|PI)\?N';

UPDATE catalogos.cat_calles
SET nombre_calle = REGEXP_REPLACE(nombre_calle, '(PE|CA|ARE|PI)\?N', '\1ÑON', 'g')
WHERE nombre_calle ~ '(PE|CA|ARE|PI)\?N';

UPDATE catalogos.cat_colonias
SET nombre_colonia = REGEXP_REPLACE(nombre_colonia, '(PE|CA|ARE|PI)\?N', '\1ÑON', 'g')
WHERE nombre_colonia ~ '(PE|CA|ARE|PI)\?N';

-- C.3c) PE??N → PEÑÓN (doble ? = Ñ + Ó perdidos; ej. LOMA DEL PE??N)
-- Vista previa
SELECT DISTINCT calle,
       REGEXP_REPLACE(calle, 'PE\?\?N', 'PEÑÓN', 'g') AS calle_corregida
FROM catalogos.padron_2026
WHERE calle ~ 'PE\?\?N'
UNION
SELECT DISTINCT colonia,
       REGEXP_REPLACE(colonia, 'PE\?\?N', 'PEÑÓN', 'g')
FROM catalogos.padron_2026
WHERE colonia ~ 'PE\?\?N';

-- Aplicar
UPDATE catalogos.padron_2026
SET calle = REGEXP_REPLACE(calle, 'PE\?\?N', 'PEÑÓN', 'g')
WHERE calle ~ 'PE\?\?N';

UPDATE catalogos.padron_2026
SET colonia = REGEXP_REPLACE(colonia, 'PE\?\?N', 'PEÑÓN', 'g')
WHERE colonia ~ 'PE\?\?N';

UPDATE catalogos.cat_calles
SET nombre_calle = REGEXP_REPLACE(nombre_calle, 'PE\?\?N', 'PEÑÓN', 'g')
WHERE nombre_calle ~ 'PE\?\?N';

UPDATE catalogos.cat_colonias
SET nombre_colonia = REGEXP_REPLACE(nombre_colonia, 'PE\?\?N', 'PEÑÓN', 'g')
WHERE nombre_colonia ~ 'PE\?\?N';

-- C.3d) Opcional: unificar PEÑON → PEÑÓN (sin acento en O)
UPDATE catalogos.padron_2026
SET calle = REGEXP_REPLACE(calle, 'PEÑON', 'PEÑÓN', 'g')
WHERE calle ~ 'PEÑON';

UPDATE catalogos.padron_2026
SET colonia = REGEXP_REPLACE(colonia, 'PEÑON', 'PEÑÓN', 'g')
WHERE colonia ~ 'PEÑON';

-- C.4) Mojibake frecuente (opcional, si quedan Ã)
UPDATE catalogos.padron_2026
SET
  colonia = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    COALESCE(colonia, ''),
    'Ã±', 'ñ'), 'Ã¡', 'á'), 'Ã©', 'é'), 'Ã­', 'í'), 'Ã³', 'ó'), 'Ãº', 'ú'), 'Ã¼', 'ü'),
  calle = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    COALESCE(calle, ''),
    'Ã±', 'ñ'), 'Ã¡', 'á'), 'Ã©', 'é'), 'Ã­', 'í'), 'Ã³', 'ó'), 'Ãº', 'ú'), 'Ã¼', 'ü')
WHERE POSITION('Ã' IN COALESCE(colonia, '')) > 0
   OR POSITION('Ã' IN COALESCE(calle, '')) > 0;

-- C.5) Verificación después
SELECT
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(colonia, '')) > 0) AS colonia_con_interrogacion,
  COUNT(*) FILTER (WHERE POSITION('?' IN COALESCE(calle, '')) > 0) AS calle_con_interrogacion
FROM catalogos.padron_2026;

-- Residual: ? que NO están entre letras (revisar manual)
SELECT DISTINCT colonia
FROM catalogos.padron_2026
WHERE POSITION('?' IN COALESCE(colonia, '')) > 0
ORDER BY 1
LIMIT 50;

SELECT DISTINCT calle
FROM catalogos.padron_2026
WHERE POSITION('?' IN COALESCE(calle, '')) > 0
ORDER BY 1
LIMIT 50;

-- =============================================================================
-- D) Catálogos institucionales (si también tienen ?)
-- =============================================================================

-- Diagnóstico
SELECT COUNT(*) FILTER (WHERE POSITION('?' IN nombre_colonia) > 0) AS cat_colonias
FROM catalogos.cat_colonias;

SELECT COUNT(*) FILTER (WHERE POSITION('?' IN nombre_calle) > 0) AS cat_calles
FROM catalogos.cat_calles;

-- Corregir cat_colonias
DO $$
DECLARE v int := 1; rx text := '([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\?([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])'; p int := 0;
BEGIN
  WHILE v > 0 AND p < 5 LOOP
    p := p + 1;
    UPDATE catalogos.cat_colonias
    SET nombre_colonia = REGEXP_REPLACE(nombre_colonia, rx, '\1Ñ\2', 'g')
    WHERE nombre_colonia ~ rx;
    GET DIAGNOSTICS v = ROW_COUNT;
  END LOOP;
END $$;

-- Corregir cat_calles
DO $$
DECLARE v int := 1; rx text := '([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])\?([A-Za-zÁÉÍÓÚÜáéíóúüÑñ])'; p int := 0;
BEGIN
  WHILE v > 0 AND p < 5 LOOP
    p := p + 1;
    UPDATE catalogos.cat_calles
    SET nombre_calle = REGEXP_REPLACE(nombre_calle, rx, '\1Ñ\2', 'g')
    WHERE nombre_calle ~ rx;
    GET DIAGNOSTICS v = ROW_COUNT;
  END LOOP;
END $$;
