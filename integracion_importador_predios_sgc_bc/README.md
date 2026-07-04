# Integración: botón "Importar Predios" en Sistema de Gestión Catastral BC

Este paquete integra el importador SHP -> PostGIS al sistema ubicado en:

- Backend: `/opt/catastro_tijuana_api`
- Frontend visor: `/var/www/catastro_tijuana`
- URL: `/api/catastro-tijuana/visor/`

## 1) Backend

Copiar:

```bash
cp backend/routers/importador_cartografia.py /opt/catastro_tijuana_api/backend/routers/
```

Editar `/opt/catastro_tijuana_api/main.py` y agregar:

```python
from backend.routers.importador_cartografia import router as importador_cartografia_router
app.include_router(importador_cartografia_router)
```

Puede poner el import junto a los demás routers y el `include_router` después de `admin_router`.

## 2) Variables recomendadas en `/opt/catastro_tijuana_api/.env`

```env
IMPORTADOR_PREDIOS_SCRIPT=/opt/sgc-web/importador_shp/importador/importar_predios.sh
IMPORTADOR_WORKDIR=/opt/catastro-tijuana-tools/importador_uploads
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
cp frontend/index.html /var/www/catastro_tijuana/index.html
cp frontend/js/05-modulos-portal.js /var/www/catastro_tijuana/js/05-modulos-portal.js
cp frontend/js/50-admin.js /var/www/catastro_tijuana/js/50-admin.js
cp frontend/js/61-importador-cartografia.js /var/www/catastro_tijuana/js/61-importador-cartografia.js
cp frontend/css/60-importador-cartografia.css /var/www/catastro_tijuana/css/60-importador-cartografia.css
```

## 4) Reiniciar API

```bash
sudo systemctl restart catastro-tijuana-api
sudo systemctl status catastro-tijuana-api --no-pager
```

## 5) Probar endpoints

```bash
curl -k https://fcnarqnodo.hopto.org/api/catastro-tijuana/admin/cartografia/importador-estado
```

Si pide autenticación, pruebe desde el navegador ya logueado.

## 6) Uso

1. Ingresar al sistema.
2. Abrir **Administración del Sistema** o el nuevo módulo **Importar Cartografía**.
3. Ir a pestaña **Cartografía**.
4. Seleccionar archivos `.shp`, `.dbf`, `.shx`, `.prj`, `.cpg` o un `.zip`.
5. Importar primero a `predios_tijuana_prueba`.
6. Validar conteo/SRID/geometría.
7. Solo después importar a `predios_tijuana` marcando autorización de producción.
