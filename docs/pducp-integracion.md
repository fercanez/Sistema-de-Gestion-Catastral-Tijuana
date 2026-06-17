# Integracion PDUCP Mexicali 2040

## Estado confirmado

Ya se valido el cruce espacial entre predios y distritos PDUCP en `geonode_data`.

Consulta probada:

```sql
SELECT
    p.clavecatas AS clave_catastral,
    substring(d.distrito from 1 for 1) AS sector,
    d.distrito
FROM public.predios_mexicali p
JOIN public.diatritos_pdupm d
  ON ST_Contains(d.geom, ST_PointOnSurface(p.geom))
WHERE p.clavecatas = 'NV108015';
```

Resultado validado:

```text
NV108015 -> sector C -> distrito C4
```

## Archivos SQL

- `docs/sql/pducp-geonode-vistas.sql`: crea indices y la vista `public.v_predios_distrito_pducp` en `geonode_data`.
- `docs/sql/pducp-esquema-compatibilidad.sql`: crea el esquema `pducp`, la tabla de matriz de compatibilidad y las tablas base de densidades.
- `docs/sql/pducp-densidades-integral.sql`: agrega columnas de rangos COS/CUS y crea `pducp.v_predio_dictamen_integral`.
- `docs/sql/pducp-consultas-dictamen.sql`: crea vistas de compatibilidad y dictamen por clave catastral.

## Archivos generados

- `outputs/pducp_matriz/matriz_compatibilidad_ciudad_largo.csv`
- `outputs/pducp_matriz/matriz_compatibilidad_pducp_mexicali.xlsx`
- `outputs/pducp_matriz/diccionario_distritos.csv`
- `outputs/pducp_matriz/resumen_compatibilidad_por_distrito.csv`
- `outputs/pducp_matriz/catalogo_actividades_extraidas.csv`
- `outputs/pducp_matriz/matriz_extraccion_qc.json`
- `outputs/pducp_densidades/densidades_distrito_pducp.csv`
- `outputs/pducp_densidades/densidades_extraccion_qc.json`

## Flujo objetivo

```text
clave catastral
-> predio
-> distrito PDUCP
-> densidad/COS/CUS
-> matriz de compatibilidad por actividad
-> dictamen preliminar
```

## Notas

La matriz de compatibilidad fue extraida desde PDF por clasificacion de simbolos de color. Hay registros con compatibilidad vacia o confianza baja que deben revisarse antes de usarla como fuente normativa final.

La tabla `pducp.densidades_distrito` queda preparada para cargar el Cuadro 258 del PDUCP Mexicali 2040.

El archivo `outputs/pducp_densidades/densidades_distrito_pducp.csv` contiene 98 distritos extraidos del Cuadro 258. En algunos registros el documento fuente presenta inconsistencias aparentes entre codigo de densidad y rango; esos casos se conservan con nota de revision.
