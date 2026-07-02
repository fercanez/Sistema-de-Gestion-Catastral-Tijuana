# Integración: botón "Importar Predios" en Sistema de Gestión Catastral BC

Este paquete integra el importador SHP -> PostGIS al sistema ubicado en:

- Backend: `/opt/catastro_api`
- Frontend visor: `/var/www/catastro`
- URL: `/api/catastro/visor/`

## 1) Backend

Copiar:

```bash
cp backend/routers/importador_cartografia.py /opt/catastro_api/routers/
```

Editar `/opt/catastro_api/main.py` y agregar:

```python
from routers.importador_cartografia import router as importador_cartografia_router
app.include_router(importador_cartografia_router)
```

Puede poner el import junto a los demás routers y el `include_router` después de `admin_router`.

## 2) Variables recomendadas en `/opt/catastro_api/.env`

```env
IMPORTADOR_PREDIOS_SCRIPT=/opt/sgc-web/importador_shp/importador/importar_predios.sh
IMPORTADOR_WORKDIR=/opt/catastro-tools/importador_uploads
IMPORTADOR_DB=geonode_data
IMPORTADOR_SCHEMA=public
```

Verifique que el script exista y sea ejecutable:

```bash
chmod +x /opt/sgc-web/importador_shp/importador/importar_predios.sh
```

## 3) Frontend

Copiar:

```bash
cp frontend/index.html /var/www/catastro/index.html
cp frontend/js/05-modulos-portal.js /var/www/catastro/js/05-modulos-portal.js
cp frontend/js/50-admin.js /var/www/catastro/js/50-admin.js
cp frontend/js/61-importador-cartografia.js /var/www/catastro/js/61-importador-cartografia.js
cp frontend/css/60-importador-cartografia.css /var/www/catastro/css/60-importador-cartografia.css
```

## 4) Reiniciar API

```bash
sudo systemctl restart catastro-api
sudo systemctl status catastro-api --no-pager
```

## 5) Probar endpoints

```bash
curl -k https://fcnarqnodo.hopto.org/api/catastro/admin/cartografia/importador-estado
```

Si pide autenticación, pruebe desde el navegador ya logueado.

## 6) Uso

1. Ingresar al sistema.
2. Abrir **Administración del Sistema** o el nuevo módulo **Importar Cartografía**.
3. Ir a pestaña **Cartografía**.
4. Seleccionar archivos `.shp`, `.dbf`, `.shx`, `.prj`, `.cpg` o un `.zip`.
5. Importar primero a `predios_mexicali_prueba`.
6. Validar conteo/SRID/geometría.
7. Solo después importar a `predios_mexicali` marcando autorización de producción.
