-- Folio real del expediente predial (fuente: clave mas folio real.xlsx)
-- Ejecutar una vez en PostgreSQL antes de importar.

ALTER TABLE catalogos.padron_2026
    ADD COLUMN IF NOT EXISTS folio_real VARCHAR(32);

COMMENT ON COLUMN catalogos.padron_2026.folio_real IS
    'Folio real del expediente catastral/fiscal. NULL si no aplica o valor 0 en origen.';

CREATE INDEX IF NOT EXISTS idx_padron_2026_folio_real
    ON catalogos.padron_2026 (folio_real)
    WHERE folio_real IS NOT NULL AND TRIM(folio_real) <> '';
