-- Cache de comparación padrón vs titular RPPC (evita releer PDF en cada consulta).
-- Las columnas también se crean automáticamente al consultar RPPC vía API.

ALTER TABLE catalogos.padron_2026
  ADD COLUMN IF NOT EXISTS rppc_titular_estado text,
  ADD COLUMN IF NOT EXISTS rppc_titular_mensaje text,
  ADD COLUMN IF NOT EXISTS rppc_titular_nombre_folio text,
  ADD COLUMN IF NOT EXISTS rppc_titular_rol_folio text,
  ADD COLUMN IF NOT EXISTS rppc_titular_nombre_padron_ref text,
  ADD COLUMN IF NOT EXISTS rppc_titular_doc_ref text,
  ADD COLUMN IF NOT EXISTS rppc_titular_comparacion_fecha timestamp;

COMMENT ON COLUMN catalogos.padron_2026.rppc_titular_estado IS 'coincide | difiere';
COMMENT ON COLUMN catalogos.padron_2026.rppc_titular_doc_ref IS 'doc:{id} o partida:{n} usado al comparar';
