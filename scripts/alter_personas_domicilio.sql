-- Domicilio de notificación en catálogo de propietarios (opcional; la API también lo crea al grabar).
ALTER TABLE catalogos.personas ADD COLUMN IF NOT EXISTS calle VARCHAR(200);
ALTER TABLE catalogos.personas ADD COLUMN IF NOT EXISTS colonia VARCHAR(150);
ALTER TABLE catalogos.personas ADD COLUMN IF NOT EXISTS numof VARCHAR(30);
ALTER TABLE catalogos.personas ADD COLUMN IF NOT EXISTS cp VARCHAR(10);
ALTER TABLE catalogos.personas ADD COLUMN IF NOT EXISTS delegacion VARCHAR(100);
