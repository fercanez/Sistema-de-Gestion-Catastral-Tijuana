# Respaldo y recuperación

## Propósito

Este documento describe una estrategia básica de respaldo y recuperación para el Sistema de Gestión Catastral BC, considerando los componentes observados actualmente en servidor y la operación del sistema.

Su objetivo es servir como guía práctica para:

- identificar qué componentes conviene respaldar
- reducir riesgo antes de cambios
- facilitar recuperación ante fallas
- documentar acciones mínimas de restauración

No sustituye un plan institucional completo de continuidad operativa, pero sí establece una base técnica inicial.

---

## Alcance

Este documento considera principalmente:

- código desplegado de la API
- configuración sensible
- visor/documentos
- base de datos PostgreSQL
- servicios relacionados
- componentes geoespaciales vinculados
- documentación operativa

---

## Principios generales

### 1. Respaldar antes de cambiar
Antes de:
- desplegar código
- actualizar dependencias
- modificar configuración
- tocar base de datos
- alterar servicios systemd
- retirar componentes del servidor

conviene generar respaldo.

### 2. Priorizar lo irremplazable
No todo tiene el mismo valor. Debe priorizarse:

1. base de datos
2. documentos operativos
3. configuración sensible
4. código desplegado
5. servicios y scripts auxiliares críticos

### 3. Probar restauración
Un respaldo no vale mucho si nunca se verifica que realmente puede restaurarse.

### 4. Nombrar respaldos con fecha
Usar marcas de tiempo claras ayuda a:
- ordenar históricos
- hacer rollback rápido
- identificar el respaldo correcto

---

## Componentes que conviene respaldar

## 1. Código desplegado de la API

Ruta observada:
```text
/opt/catastro_api
```

### Contenido relevante
- `main.py`
- `config.py`
- `database.py`
- `auth/`
- `routers/`
- `requirements.txt`
- documentación local si existe
- entorno general del despliegue

### Comando ejemplo
```bash
cp -a /opt/catastro_api /opt/catastro_api_backup_$(date +%Y%m%d_%H%M%S)
```

---

## 2. Archivo de configuración / variables de entorno

Si existe `.env` dentro del despliegue, es crítico respaldarlo.

### Riesgo
Sin este archivo o sin sus valores correctos, la aplicación puede:
- no arrancar
- fallar al conectar a base de datos
- invalidar autenticación JWT

### Comando ejemplo
```bash
cp -a /opt/catastro_api/.env /root/backups/.env_catastro_$(date +%Y%m%d_%H%M%S) 2>/dev/null
```

---

## 3. Documentos del sistema

Ruta observada:
```text
/var/www/catastro/documentos
```

### Importancia
Estos archivos forman parte del expediente operativo y pueden ser difíciles de reconstruir si se pierden.

### Comando ejemplo
```bash
cp -a /var/www/catastro/documentos /root/backups/documentos_catastro_$(date +%Y%m%d_%H%M%S)
```

---

## 4. Recursos estáticos / visor

Ruta observada:
```text
/var/www/catastro
```

### Qué puede incluir
- HTML
- CSS
- JavaScript
- imágenes
- archivos de interfaz
- documentos servidos por web

### Comando ejemplo
```bash
cp -a /var/www/catastro /root/backups/catastro_web_$(date +%Y%m%d_%H%M%S)
```

---

## 5. Servicio systemd de la API

Ruta observada:
```text
/etc/systemd/system/catastro-api.service
```

### Importancia
Si se pierde o cambia incorrectamente, la API puede dejar de iniciar automáticamente.

### Comando ejemplo
```bash
cp -a /etc/systemd/system/catastro-api.service /root/backups/catastro-api.service_$(date +%Y%m%d_%H%M%S)
```

---

## 6. Base de datos PostgreSQL

La base de datos es el activo más importante.

### Contenido crítico
- usuarios
- roles
- padrón
- personas
- predios
- movimientos
- auditoría
- vistas
- funciones
- estructuras institucionales

### Recomendación
Mantener respaldos periódicos consistentes de PostgreSQL mediante `pg_dump` o estrategia institucional equivalente.

---

## Respaldo lógico de PostgreSQL

### Ejemplo de base completa
```bash
pg_dump -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -Fc -f /root/backups/catastro_db_$(date +%Y%m%d_%H%M%S).dump
```

### Ventajas del formato custom (`-Fc`)
- compresión
- restauración selectiva
- mayor flexibilidad con `pg_restore`

### Recomendaciones
- ejecutar con usuario autorizado
- almacenar también credenciales de forma segura fuera del comando
- validar tamaño y fecha del dump generado
- conservar varias generaciones

---

## Respaldo por esquema o componente

Si se requiere respaldo parcial, podría hacerse por esquema:

### Ejemplo
```bash
pg_dump -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -n seguridad -Fc -f /root/backups/catastro_seguridad_$(date +%Y%m%d_%H%M%S).dump
pg_dump -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -n catalogos -Fc -f /root/backups/catastro_catalogos_$(date +%Y%m%d_%H%M%S).dump
pg_dump -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -n catastro -Fc -f /root/backups/catastro_catastro_$(date +%Y%m%d_%H%M%S).dump
pg_dump -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -n auditoria -Fc -f /root/backups/catastro_auditoria_$(date +%Y%m%d_%H%M%S).dump
```

### Uso recomendado
Solo cuando exista una necesidad clara de respaldo segmentado.

---

## Directorio sugerido para respaldos

Se recomienda centralizar respaldos locales temporales en una ruta clara, por ejemplo:

```text
/root/backups
```

### Crear si no existe
```bash
mkdir -p /root/backups
```

---

## Respaldo mínimo antes de despliegue

Antes de actualizar código o dependencias, al menos respaldar:

- `/opt/catastro_api`
- `/opt/catastro_api/.env`
- `/etc/systemd/system/catastro-api.service`

### Ejemplo rápido
```bash
mkdir -p /root/backups
cp -a /opt/catastro_api /root/backups/catastro_api_$(date +%Y%m%d_%H%M%S)
cp -a /opt/catastro_api/.env /root/backups/.env_catastro_$(date +%Y%m%d_%H%M%S) 2>/dev/null
cp -a /etc/systemd/system/catastro-api.service /root/backups/catastro-api.service_$(date +%Y%m%d_%H%M%S)
```

---

## Respaldo mínimo antes de cambios de base de datos

Antes de alterar:
- tablas
- vistas
- funciones
- índices
- scripts de regularización
- cargas masivas

hacer al menos un `pg_dump` del esquema afectado o de la base completa.

---

## Respaldo antes de limpieza o retiro de componentes

La experiencia reciente con QCarta deja una lección útil:

Antes de retirar componentes del servidor conviene:
1. detener servicio
2. mover a cuarentena o respaldar
3. validar que el resto del sistema siga bien
4. solo después eliminar definitivamente

### Estrategia sugerida
Usar una carpeta temporal de cuarentena, por ejemplo:

```text
/root/quarantine_<componente>
```

---

## Recuperación del código desplegado

Si el despliegue falla y existe respaldo previo:

### Ejemplo de restauración
```bash
systemctl stop catastro-api
rm -rf /opt/catastro_api
cp -a /root/backups/catastro_api_YYYYMMDD_HHMMSS /opt/catastro_api
systemctl start catastro-api
```

### Después verificar
```bash
systemctl status catastro-api --no-pager
journalctl -u catastro-api -n 100 --no-pager
```

---

## Recuperación del archivo `.env`

Si se pierde o se rompe la configuración:

```bash
cp -a /root/backups/.env_catastro_YYYYMMDD_HHMMSS /opt/catastro_api/.env
systemctl restart catastro-api
```

---

## Recuperación del servicio systemd

Si el archivo de servicio se pierde o queda corrupto:

```bash
cp -a /root/backups/catastro-api.service_YYYYMMDD_HHMMSS /etc/systemd/system/catastro-api.service
systemctl daemon-reload
systemctl restart catastro-api
```

---

## Restauración de PostgreSQL

### Base completa con `pg_restore`
Ejemplo general:

```bash
pg_restore -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> /root/backups/catastro_db_YYYYMMDD_HHMMSS.dump
```

> Importante: dependiendo del escenario, puede requerirse restaurar primero sobre una base nueva, o limpiar objetos previos.

### Recomendaciones antes de restaurar
- confirmar destino correcto
- no restaurar sobre producción sin evaluación previa
- preferir pruebas en ambiente alterno cuando sea posible
- revisar si deben restaurarse roles, extensiones o privilegios aparte

---

## Recuperación de documentos

Si se pierde contenido documental:

```bash
cp -a /root/backups/documentos_catastro_YYYYMMDD_HHMMSS /var/www/catastro/documentos
```

### Verificar después
- permisos del directorio
- acceso desde backend
- descarga/apertura desde expediente

---

## Recuperación del visor o estáticos

Si se altera o elimina contenido en `/var/www/catastro`:

```bash
cp -a /root/backups/catastro_web_YYYYMMDD_HHMMSS /var/www/catastro
```

### Verificar después
- CSS
- JS
- imágenes
- páginas estáticas
- documentos si comparten ruta

---

## Validación posterior a restauración

Después de cualquier recuperación, validar al menos:

### Servicios
```bash
systemctl status catastro-api --no-pager
systemctl status geonode --no-pager
systemctl status geonode-celery --no-pager
```

### Logs
```bash
journalctl -u catastro-api -n 100 --no-pager
```

### Endpoints críticos
- ficha predial
- historial de expediente
- documentos
- propietarios por predio

### Recursos web
- visor
- documentos
- rutas estáticas relevantes

---

## Frecuencia sugerida de respaldos

### Diario
- base de datos
- documentos nuevos o modificados

### Antes de cada despliegue
- código
- `.env`
- servicio systemd

### Antes de cambios estructurales
- dump de base de datos
- scripts implicados
- vistas/funciones afectadas

### Antes de limpiezas
- cuarentena o backup de componentes a retirar

---

## Riesgos si no se respalda

- pérdida de documentos no reproducibles
- indisponibilidad prolongada tras despliegue fallido
- pérdida de configuraciones sensibles
- dificultad para volver a un estado funcional
- pérdida de auditoría y trazabilidad
- recuperación lenta o incompleta de producción

---

## Recomendaciones futuras

### 1. Formalizar política de respaldos
Definir:
- responsables
- frecuencia
- ubicación
- retención
- validación de restauración

### 2. Respaldar fuera del mismo servidor
Idealmente mantener copia en:
- otro disco
- otro servidor
- almacenamiento institucional seguro

### 3. Automatizar dumps de PostgreSQL
Mediante:
- cron
- scripts controlados
- monitoreo de éxito/fracaso

### 4. Documentar restauraciones probadas
Registrar:
- fecha de prueba
- qué se restauró
- cuánto tardó
- problemas encontrados

### 5. Controlar permisos de respaldos
Los respaldos pueden contener:
- datos personales
- credenciales
- información catastral sensible

Por ello deben protegerse adecuadamente.

---

## Checklist rápido

### Antes de cambiar algo
- [ ] crear respaldo de código
- [ ] respaldar `.env`
- [ ] respaldar servicio systemd si aplica
- [ ] respaldar base de datos si hay riesgo funcional
- [ ] respaldar documentos si se tocarán rutas web o almacenamiento

### Después del cambio
- [ ] verificar `catastro-api`
- [ ] revisar logs
- [ ] probar endpoints críticos
- [ ] validar documentos
- [ ] validar visor si aplica

### Si algo falla
- [ ] restaurar respaldo previo
- [ ] reiniciar servicio
- [ ] revisar logs
- [ ] repetir validación operativa mínima

---

## Resumen

La estrategia mínima de respaldo y recuperación del sistema debe cubrir al menos:

- código desplegado
- configuración sensible
- documentos
- recursos estáticos
- servicio systemd
- base de datos PostgreSQL

La prioridad máxima debe darse a la base de datos y a los documentos del expediente.

Este documento ofrece una base inicial para reducir riesgo operativo y facilitar recuperación ante errores de despliegue, fallas de configuración o cambios no exitosos.