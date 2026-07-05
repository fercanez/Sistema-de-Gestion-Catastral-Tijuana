-- Mapeo colonias SGC → ID colonia RPPC (Consulta Avanzada BC).
-- Ejecutar en catastro_tijuana antes de usar búsqueda RPPC por ubicación/unidad.

ALTER TABLE catalogos.cat_colonias
    ADD COLUMN IF NOT EXISTS rppc_colonia_id integer;

COMMENT ON COLUMN catalogos.cat_colonias.rppc_colonia_id IS
    'ID colonia en portal RPPC BC (consultaInmuebles, MUNICIPIO=2 Tijuana)';

-- Villa Residencial Santa Fe Segunda Sección (ejemplo validado en portal, clave XL701261)
UPDATE catalogos.cat_colonias
SET rppc_colonia_id = 1342
WHERE UPPER(nombre_colonia) LIKE '%VILLA RESIDENCIAL SANTA FE%'
  AND (rppc_colonia_id IS NULL OR rppc_colonia_id <> 1342);

-- Ver colonias sin mapear RPPC
-- SELECT id, nombre_colonia, rppc_colonia_id
-- FROM catalogos.cat_colonias
-- WHERE rppc_colonia_id IS NULL
-- ORDER BY nombre_colonia;
