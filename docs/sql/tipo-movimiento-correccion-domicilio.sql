-- Tipo de movimiento: corrección de domicilio (colonia / calle desde catálogo)
-- Ejecutar una vez en la base catastro (psql o pgAdmin).

INSERT INTO catalogos.cat_tipos_movimiento_padron (clave, nombre, descripcion, requiere_autorizacion, activo)
VALUES (
  'CORRECCION_DOMICILIO',
  'Corrección de domicilio',
  'Corrige colonia y/o calle del predio según catálogos institucionales (cat_colonias, cat_calles).',
  TRUE,
  TRUE
)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  requiere_autorizacion = EXCLUDED.requiere_autorizacion,
  activo = TRUE;
