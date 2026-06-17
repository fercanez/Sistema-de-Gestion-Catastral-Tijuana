-- Esquema base PDUCP para compatibilidad de usos y densidades.
-- Ejecutar conectado a la base donde se integrara el modulo catastral.

CREATE SCHEMA IF NOT EXISTS pducp;

CREATE TABLE IF NOT EXISTS pducp.matriz_compatibilidad (
    id bigserial PRIMARY KEY,
    nivel text,
    seccion text,
    pagina_pdf integer,
    uso_grupo text,
    codigo_actividad text,
    actividad text,
    distrito text NOT NULL,
    sector text,
    compatibilidad text,
    compatibilidad_desc text,
    confianza_color integer,
    fuente text,
    nota text
);

CREATE INDEX IF NOT EXISTS matriz_compatibilidad_distrito_idx
ON pducp.matriz_compatibilidad (distrito);

CREATE INDEX IF NOT EXISTS matriz_compatibilidad_codigo_idx
ON pducp.matriz_compatibilidad (codigo_actividad);

CREATE INDEX IF NOT EXISTS matriz_compatibilidad_sector_idx
ON pducp.matriz_compatibilidad (sector);

CREATE INDEX IF NOT EXISTS matriz_compatibilidad_lookup_idx
ON pducp.matriz_compatibilidad (distrito, codigo_actividad);

COMMENT ON TABLE pducp.matriz_compatibilidad IS
'Matriz de compatibilidad PDUCPM extraida del PDF. Revisar registros con compatibilidad vacia o confianza_color baja.';

CREATE TABLE IF NOT EXISTS pducp.densidades_habitacionales (
    codigo text PRIMARY KEY,
    descripcion text NOT NULL,
    vivienda_tipo text NOT NULL,
    viv_ha_min integer,
    viv_ha_max integer,
    fuente text
);

INSERT INTO pducp.densidades_habitacionales
    (codigo, descripcion, vivienda_tipo, viv_ha_min, viv_ha_max, fuente)
VALUES
    ('dub', 'Unifamiliar baja', 'unifamiliar', 8, 29, 'PDUCP Mexicali 2040, Cuadro 257'),
    ('dum', 'Unifamiliar media', 'unifamiliar', 30, 39, 'PDUCP Mexicali 2040, Cuadro 257'),
    ('dua', 'Unifamiliar alta', 'unifamiliar', 40, 49, 'PDUCP Mexicali 2040, Cuadro 257'),
    ('DMB', 'Multifamiliar baja', 'multifamiliar', 24, 79, 'PDUCP Mexicali 2040, Cuadro 257'),
    ('DMM', 'Multifamiliar media', 'multifamiliar', 80, 149, 'PDUCP Mexicali 2040, Cuadro 257'),
    ('DMA', 'Multifamiliar alta', 'multifamiliar', 150, 250, 'PDUCP Mexicali 2040, Cuadro 257')
ON CONFLICT (codigo) DO UPDATE SET
    descripcion = EXCLUDED.descripcion,
    vivienda_tipo = EXCLUDED.vivienda_tipo,
    viv_ha_min = EXCLUDED.viv_ha_min,
    viv_ha_max = EXCLUDED.viv_ha_max,
    fuente = EXCLUDED.fuente;

CREATE TABLE IF NOT EXISTS pducp.densidades_distrito (
    distrito text PRIMARY KEY,
    sector text,
    sector_nombre text,
    cos_rango text,
    cos_min numeric,
    cos_max numeric,
    cos numeric,
    cus_rango text,
    cus_min numeric,
    cus_max numeric,
    cus numeric,
    densidad_unifamiliar_codigo text REFERENCES pducp.densidades_habitacionales(codigo),
    densidad_unifamiliar_min integer,
    densidad_unifamiliar_max integer,
    densidad_multifamiliar_codigo text REFERENCES pducp.densidades_habitacionales(codigo),
    densidad_multifamiliar_min integer,
    densidad_multifamiliar_max integer,
    fuente text,
    nota text
);

CREATE INDEX IF NOT EXISTS densidades_distrito_sector_idx
ON pducp.densidades_distrito (sector);

COMMENT ON TABLE pducp.densidades_distrito IS
'COS, CUS y densidades por distrito del PDUCPM. Pendiente de cargar completo desde Cuadro 258.';

-- Carga sugerida de matriz_compatibilidad:
-- En DBeaver se puede usar Import Data sobre pducp.matriz_compatibilidad
-- con el archivo:
-- E:\Sistemas en Github\Sistema-de-Gestion-Catastral\outputs\pducp_matriz\matriz_compatibilidad_ciudad_largo.csv
--
-- Si se ejecuta desde psql en la misma maquina del archivo:
-- \copy pducp.matriz_compatibilidad(nivel,seccion,pagina_pdf,uso_grupo,codigo_actividad,actividad,distrito,sector,compatibilidad,compatibilidad_desc,confianza_color,fuente,nota)
-- FROM 'E:/Sistemas en Github/Sistema-de-Gestion-Catastral/outputs/pducp_matriz/matriz_compatibilidad_ciudad_largo.csv'
-- WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
