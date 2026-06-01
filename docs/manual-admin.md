# Bitácora de cambios

## Propósito

Este documento sirve para registrar cambios relevantes realizados sobre el Sistema de Gestión Catastral BC en producción, infraestructura relacionada o documentación operativa.

Su objetivo es mantener trazabilidad práctica sobre:

- despliegues
- cambios de configuración
- modificaciones de base de datos
- reinicios relevantes
- limpiezas o retiros de componentes
- incidentes y recuperaciones
- actualizaciones documentales importantes

---

## Instrucciones de uso

Se recomienda agregar una entrada cada vez que ocurra alguno de estos eventos:

- despliegue de código
- cambio en `.env`
- cambio en servicio `systemd`
- ajuste relevante de base de datos
- modificación de rutas operativas o documentos
- desinstalación de software auxiliar
- rollback o restauración
- incidente operativo relevante
- actualización importante de documentación técnica/operativa

### Recomendaciones
- usar fecha completa
- describir qué cambió realmente
- indicar si hubo respaldo previo
- indicar resultado
- anotar validaciones realizadas
- si hubo problema, dejar evidencia breve del impacto y la recuperación

---

## Formato sugerido por entrada

```markdown
## YYYY-MM-DD HH:MM - Título corto del cambio

**Tipo:** despliegue | configuración | base de datos | operación | limpieza | incidente | documentación  
**Responsable:** nombre o referencia  
**Entorno:** producción  

### Resumen
Descripción breve del cambio realizado.

### Cambios aplicados
- cambio 1
- cambio 2
- cambio 3

### Respaldos
- indicar qué se respaldó antes del cambio
- o indicar "no aplica"

### Validación realizada
- servicio validado
- endpoints probados
- logs revisados
- resultado observado

### Resultado
- exitoso / exitoso con observaciones / fallido / revertido

### Observaciones
Notas adicionales, impacto, pendientes o riesgos identificados.
```

---

## Entradas

## 2026-06-01 00:00 - Inicio de documentación técnica y operativa del sistema

**Tipo:** documentación  
**Responsable:** por registrar  
**Entorno:** producción / repositorio

### Resumen
Se inició la consolidación de documentación técnica y operativa del Sistema de Gestión Catastral BC para mejorar trazabilidad, mantenimiento y transferencia de conocimiento.

### Cambios aplicados
- elaboración de documentación de arquitectura técnica
- documentación inicial del modelo de datos
- documentación inicial de endpoints
- documentación de flujos operativos
- documentación de despliegue
- documentación de operación de servidor
- documentación de permisos y roles
- documentación de respaldo y recuperación
- creación de glosario
- creación de backlog técnico
- creación de matriz de módulos
- creación de checklist de producción

### Respaldos
- no aplica

### Validación realizada
- revisión de consistencia entre documentos generados
- consolidación de índice documental en `README.md`

### Resultado
- exitoso

### Observaciones
Esta documentación constituye una base inicial y debe refinarse con validación directa contra código, base de datos y operación real.

---

## 2026-06-01 00:00 - Identificación operativa de servicios principales del servidor

**Tipo:** operación  
**Responsable:** por registrar  
**Entorno:** producción

### Resumen
Se realizó una revisión operativa del servidor para identificar rutas, servicios activos y componentes no esenciales.

### Cambios aplicados
- verificación de existencia de repos Git en servidor
- identificación de rutas con `.git`
- confirmación de que `/opt/catastro_api` no era un clon Git
- identificación de `GeoNode` como componente activo separado
- identificación de QCarta como componente adicional no requerido

### Respaldos
- no aplica

### Validación realizada
- revisión manual de rutas del servidor
- inspección de servicios activos
- validación de `catastro-api.service`
- validación de `geonode.service`
- validación de `geonode-celery.service`

### Resultado
- exitoso

### Observaciones
Esta revisión permitió distinguir entre:
- API de catastro
- GeoNode
- QCarta
- rutas de publicación web
- componentes retirables del servidor

---

## 2026-06-01 00:00 - Retiro de QCarta del servidor

**Tipo:** limpieza  
**Responsable:** por registrar  
**Entorno:** producción

### Resumen
Se retiró QCarta y sus componentes asociados del servidor, por no ser necesarios para la operación actual, procurando no afectar GeoNode ni la API de catastro.

### Cambios aplicados
- detención y retiro de componentes asociados a QCarta
- recarga de `systemd`
- recreación de `/var/www/html` vacío para conservar docroot estándar
- limpieza final de cuarentena asociada a QCarta

### Respaldos
- se utilizó estrategia de cuarentena temporal antes de la eliminación final

### Validación realizada
- validación de `catastro-api.service` activo
- validación de `geonode.service` activo
- validación de `geonode-celery.service` activo
- revisión de estado de servicios tras la limpieza

### Resultado
- exitoso

### Observaciones
La API del sistema catastral continuó operando normalmente tras el retiro de QCarta. GeoNode también permaneció activo sin afectación visible.

---

## 2026-06-01 00:00 - Confirmación operativa de la API catastral

**Tipo:** operación  
**Responsable:** por registrar  
**Entorno:** producción

### Resumen
Se validó que la API del sistema continuara en ejecución correcta después de tareas de revisión y limpieza del servidor.

### Cambios aplicados
- no se realizaron cambios funcionales directos sobre la API en esta validación

### Respaldos
- no aplica

### Validación realizada
- revisión de `systemctl status catastro-api --no-pager`
- confirmación de proceso `uvicorn`
- observación de tráfico real atendido por endpoints del sistema

### Resultado
- exitoso

### Observaciones
Se observaron respuestas correctas para rutas como:
- `/padron/{clave}/ficha`
- `/expediente/{clave}/historial`
- `/expediente/{clave}/documentos`
- `/predios/{clave}/propietarios`

---

## Plantilla en blanco para nuevas entradas

## YYYY-MM-DD HH:MM - Título corto del cambio

**Tipo:**  
**Responsable:**  
**Entorno:** producción

### Resumen
-

### Cambios aplicados
- 

### Respaldos
- 

### Validación realizada
- 

### Resultado
- 

### Observaciones
-

---

## Recomendaciones operativas

### 1. Registrar cambios el mismo día
Mientras más tiempo pase, más fácil es olvidar detalles importantes.

### 2. Registrar también cambios “pequeños”
Especialmente si afectan:
- configuración
- credenciales
- rutas
- systemd
- SQL
- documentos

### 3. Usar esta bitácora junto con el checklist de producción
Idealmente:
- primero se ejecuta `docs/checklist-produccion.md`
- luego se registra el resultado en esta bitácora

### 4. Relacionar entradas con respaldos
Cuando exista respaldo, anotar:
- ruta
- fecha
- tipo de backup

### 5. Relacionar entradas con incidentes o backlog
Si un cambio abre un pendiente, conviene referenciarlo luego en:
- `docs/backlog-tecnico.md`
- `docs/pendientes-tecnicos.md`

---

## Resumen

La bitácora de cambios ayuda a mantener memoria operativa del sistema y reduce dependencia de conocimiento informal.

Debe utilizarse como registro vivo para:
- despliegues
- limpiezas
- validaciones
- incidentes
- recuperaciones
- cambios de configuración
- avances documentales