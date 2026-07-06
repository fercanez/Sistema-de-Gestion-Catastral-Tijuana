# Publicar `construcciones_tijuana` en GeoServer

La tabla vive en **PostgreSQL/PostGIS** (`geonode_data.public.construcciones_tijuana`).  
El visor ya apunta a **`geonode:construcciones_tijuana`** (`js/06-construcciones-medicion.js`).

## Tablas (no mezclar)

| Tabla | Uso |
|-------|-----|
| `construcciones_tijuana` | Capa mapa WMS/WFS Tijuana |
| `construccionesmxli` | Backend API (`GET /predios/{clave}/construcciones`) — **no reemplazar** |

---

## Paso 1 — Verificar la tabla (PuTTY)

```bash
sudo -u postgres psql -d geonode_data -c "
SELECT COUNT(*) AS total FROM public.construcciones_tijuana;
SELECT ST_SRID(geom) AS srid FROM public.construcciones_tijuana WHERE geom IS NOT NULL LIMIT 1;
"
```

Debe haber registros y SRID **32611**.

---

## Paso 2 — Mapeo de columnas (si no se corrió)

```bash
sudo -u postgres psql -d geonode_data \
  -f /var/www/catastro_tijuana/sql/importar-construcciones-tijuana-mapeo.sql
```

(Si falta el script de permisos, cópialo a `/var/www/catastro_tijuana/sql/publicar-construcciones-tijuana-geoserver.sql`.)

Al final debe mostrar `con_clave` > 0 (construcciones ligadas a predios).

---

## Paso 3 — Permisos para GeoServer

```bash
sudo -u postgres psql -d geonode_data \
  -f /var/www/catastro_tijuana/sql/publicar-construcciones-tijuana-geoserver.sql
```

---

## Paso 4 — Publicar en GeoServer

### Opción A — La capa ya existe (`geonode:construcciones_tijuana`)

1. Entrar a GeoServer: `https://fcnarqnodo.hopto.org/geoserver/web/`
2. **Data → Stores** → store PostGIS de `geonode_data` → **Reload**
3. **Data → Layers** → `construcciones_tijuana` → **Reload**
4. Pestaña **Publishing** → marcar **WMS** y **WFS**
5. **Save**

### Opción B — La capa no existe

**Desde GeoNode** (recomendado si usan GeoNode):

1. `https://fcnarqnodo.hopto.org/` → iniciar sesión admin
2. **Layers → Add layer** → datastore PostGIS → tabla `construcciones_tijuana`
3. Completar asistente y publicar

**Desde GeoServer directo:**

1. **Data → Workspaces → geonode → Add store** (o usar el store existente)
2. **Publish** → elegir `construcciones_tijuana`
3. Configurar:
   - **Native SRS:** `EPSG:32611`
   - **Declared SRS:** `EPSG:32611`
   - **Bounding boxes:** **manual** (no “Compute from native bounds” si falla):
     - MinX `631863.56`, MinY `3603096.52`
     - MaxX `664943.17`, MaxY `3646026.19`
   - **Geometry:** campo `geom`, tipo MultiPolygon

---

## Paso 5 — Probar

```bash
curl -s "https://fcnarqnodo.hopto.org/geoserver/geonode/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=geonode:construcciones_tijuana&outputFormat=application/json&maxFeatures=1" | head -c 500
```

Debe devolver JSON con al menos un feature.

WMS (imagen):

```
https://fcnarqnodo.hopto.org/geoserver/geonode/wms?
  service=WMS&version=1.1.1&request=GetMap&
  layers=geonode:construcciones_tijuana&
  bbox=631863,3603096,664943,3646026&width=800&height=600&srs=EPSG:32611&format=image/png
```

---

## Paso 6 — Visor Catastro Tijuana

1. Abrir visor → activar capa construcciones (si hay toggle)
2. Abrir un predio → pestaña **Construcción**
3. Debe dibujar polígonos (WMS/WFS)

---

## Errores frecuentes

| Error | Solución |
|-------|----------|
| `permission denied for table construcciones_tijuana` | Paso 3 (GRANT + OWNER geonode) |
| Capa vacía / 404 en WFS | Publicar o Reload capa (Paso 4) |
| `Could not compute bounds` | Bounds manuales EPSG:32611 |
| Sin claves en popup | Correr mapeo SQL paso 2 (`con_clave` = 0) |
| API sin datos pero mapa sí | Normal: API usa `construccionesmxli`; mapa usa `construcciones_tijuana` |

---

## Siguiente mejora (opcional)

Unificar API para leer `construcciones_tijuana` con variable `GEONODE_CONSTRUCCIONES_TABLE` (como `GEONODE_PREDIOS_TABLE`).
