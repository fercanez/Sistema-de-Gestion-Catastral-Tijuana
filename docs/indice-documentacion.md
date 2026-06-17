# Índice de documentación

## Propósito

Este documento sirve como mapa general de la documentación del Sistema de Gestión Catastral BC.

Su objetivo es facilitar navegación, consulta y mantenimiento del conjunto documental generado para el proyecto, agrupando los archivos por tema y sugiriendo un orden de lectura según el perfil o necesidad.

---

## Vista general

La documentación disponible cubre actualmente estas áreas:

- arquitectura técnica
- operación del servidor
- despliegue
- modelo de datos
- endpoints
- flujos operativos
- permisos y roles
- respaldo y recuperación
- operación diaria
- soporte
- administración
- incidencias
- backlog y pendientes
- glosario
- FAQ

---

## Índice por documento

## Documentación base del proyecto

### `README.md`
Documento principal del repositorio.

Incluye:
- descripción general
- stack principal
- estructura del proyecto
- configuración básica
- ejecución
- despliegue observado
- índice documental resumido

### `docs/indice-documentacion.md`
Mapa general del conjunto documental.

### `docs/estructura-documentacion.md`
Propuesta de organización futura para la carpeta `docs/`:
- estructura objetivo
- categorías temáticas
- estrategia de migración
- reglas de crecimiento documental

### `docs/arquitectura-tecnica.md`
Describe la arquitectura general del sistema:
- componentes
- organización funcional
- backend
- seguridad
- datos
- despliegue
- relaciones principales

### `docs/matriz-modulos.md`
Resumen transversal de módulos del sistema:
- responsabilidad
- tablas/vistas principales
- endpoints representativos
- roles típicos
- riesgos y observaciones

---

## Datos y dominio funcional

### `docs/modelo-de-datos.md`
Descripción inicial del modelo de datos:
- esquemas
- tablas principales
- vistas
- relaciones funcionales
- observaciones y recomendaciones

### `docs/pducp-integracion.md`
Notas de integracion del PDUCP Mexicali 2040:
- cruce espacial predio -> distrito
- matriz de compatibilidad generada
- SQL de apoyo para vistas, compatibilidad y densidades
- flujo objetivo para dictamen preliminar por clave catastral

### `docs/glosario.md`
Glosario técnico y funcional:
- términos de negocio catastral
- términos técnicos del backend
- términos operativos y de infraestructura

---

## API y comportamiento funcional

### `docs/endpoints.md`
Inventario inicial de endpoints:
- rutas confirmadas
- rutas probables
- módulos responsables
- rutas críticas para validación

### `docs/flujos-operativos.md`
Descripción funcional de procesos principales:
- autenticación
- ficha predial
- expediente
- propietarios
- movimientos
- administración
- control cartográfico

### `docs/permisos-y-roles.md`
Descripción del modelo de seguridad:
- autenticación
- autorización
- roles detectados
- permisos funcionales esperables

### `docs/matriz-acl-endpoints.md`
Auditoría endpoint por endpoint (BT-003):
- matriz ACL declarada vs controles reales
- inventario de 110 rutas con mecanismo de auth
- hallazgos CRIT y GAP priorizados
- mapa permiso → endpoints objetivo para corrección
- recomendaciones

---

## Producción, operación y servidor

### `docs/operacion-servidor.md`
Describe el entorno operativo observado:
- servicios activos
- rutas importantes
- limpieza de QCarta
- validaciones realizadas
- comandos útiles

### `docs/despliegue.md`
Guía de despliegue:
- rutas principales
- servicio systemd
- proceso manual
- validación posterior
- rollback básico

### `docs/checklist-produccion.md`
Checklist práctico para cambios en producción:
- antes
- durante
- después
- rollback
- respaldo
- limpieza
- validación general

### `docs/respaldo-y-recuperacion.md`
Guía de respaldo y restauración:
- código
- configuración
- base de datos
- documentos
- visor
- restauración básica

### `docs/bitacora-cambios.md`
Registro operativo de cambios:
- despliegues
- limpiezas
- incidentes
- validaciones
- cambios documentales y técnicos

---

## Operación, administración y soporte

### `docs/manual-admin.md`
Manual de administración:
- usuarios
- roles
- validación del sistema
- reinicio de servicios
- coordinación de cambios
- buenas prácticas

### `docs/manual-operacion-diaria.md`
Guía de operación cotidiana:
- revisión diaria
- validaciones mínimas
- chequeo de logs
- reacción inicial ante fallas
- rutina semanal

### `docs/manual-soporte.md`
Manual de soporte inicial:
- recepción del reporte
- clasificación de incidentes
- validación mínima
- escalación
- registro

### `docs/manual-usuarios.md`
Manual general para usuarios:
- ingreso al sistema
- consulta de ficha predial
- consulta de expediente
- documentos
- propietarios
- movimientos
- reporte básico de problemas

### `docs/incidentes-comunes.md`
Catálogo de incidentes frecuentes:
- síntomas
- posibles causas
- acciones iniciales
- cuándo escalar

### `docs/faq-operativa.md`
Preguntas frecuentes operativas:
- servicios
- rutas
- respaldos
- incidencias
- documentación
- cambios en producción
---

## Gestión técnica y mejora continua

### `docs/pendientes-tecnicos.md`
Lista razonada de hallazgos y áreas de mejora:
- seguridad
- despliegue
- datos
- pruebas
- documentación
- infraestructura

### `docs/backlog-tecnico.md`
Backlog inicial priorizado:
- ID
- tema
- pendiente
- prioridad
- estado sugerido
- observaciones
- fases sugeridas

---

## Ruta de lectura sugerida por perfil

## 1. Persona nueva en el proyecto
Orden recomendado:

1. `README.md`
2. `docs/indice-documentacion.md`
3. `docs/arquitectura-tecnica.md`
4. `docs/matriz-modulos.md`
5. `docs/endpoints.md`
6. `docs/modelo-de-datos.md`
7. `docs/manual-operacion-diaria.md`

---

## 2. Perfil técnico / desarrollo
Orden recomendado:

1. `README.md`
2. `docs/arquitectura-tecnica.md`
3. `docs/matriz-modulos.md`
4. `docs/modelo-de-datos.md`
5. `docs/endpoints.md`
6. `docs/permisos-y-roles.md`
7. `docs/backlog-tecnico.md`
8. `docs/pendientes-tecnicos.md`

---

## 3. Perfil de operación / administración
Orden recomendado:

1. `docs/operacion-servidor.md`
2. `docs/despliegue.md`
3. `docs/checklist-produccion.md`
4. `docs/respaldo-y-recuperacion.md`
5. `docs/manual-admin.md`
6. `docs/bitacora-cambios.md`

---

## 4. Perfil de soporte
Orden recomendado:

1. `docs/manual-soporte.md`
2. `docs/incidentes-comunes.md`
3. `docs/manual-operacion-diaria.md`
4. `docs/faq-operativa.md`
5. `docs/checklist-produccion.md`

---

## 5. Perfil funcional / supervisión
Orden recomendado:

1. `docs/flujos-operativos.md`
2. `docs/permisos-y-roles.md`
3. `docs/endpoints.md`
4. `docs/manual-operacion-diaria.md`
5. `docs/faq-operativa.md`

---

## Relación rápida entre necesidades y documentos

| Necesidad | Documento recomendado |
|---|---|
| Entender el sistema en general | `README.md`, `docs/arquitectura-tecnica.md` |
| Ubicar módulos y responsabilidades | `docs/matriz-modulos.md` |
| Entender datos y entidades | `docs/modelo-de-datos.md` |
| Revisar rutas de API | `docs/endpoints.md` |
| Entender permisos y roles | `docs/permisos-y-roles.md` |
| Auditar control de acceso por endpoint | `docs/matriz-acl-endpoints.md` |
| Entender procesos del negocio | `docs/flujos-operativos.md` |
| Operar el servidor | `docs/operacion-servidor.md` |
| Desplegar cambios | `docs/despliegue.md` |
| Validar producción | `docs/checklist-produccion.md` |
| Hacer respaldo/recuperación | `docs/respaldo-y-recuperacion.md` |
| Llevar registro de cambios | `docs/bitacora-cambios.md` |
| Administrar el sistema | `docs/manual-admin.md` |
| Operación diaria | `docs/manual-operacion-diaria.md` |
| Soporte inicial | `docs/manual-soporte.md` |
| Atender incidentes frecuentes | `docs/incidentes-comunes.md` |
| Resolver dudas rápidas | `docs/faq-operativa.md` |
| Priorizar mejoras | `docs/pendientes-tecnicos.md`, `docs/backlog-tecnico.md` |
| Entender términos | `docs/glosario.md` |
| Entender cómo usar el sistema como usuario | `docs/manual-usuarios.md`, `docs/faq-operativa.md` |
| Entender cómo está organizada o cómo debería organizarse la documentación | `docs/estructura-documentacion.md`, `docs/indice-documentacion.md` |
---

## Recomendaciones de mantenimiento documental

### 1. Mantener sincronizado el índice
Cada vez que se agregue o retire un documento, actualizar este índice.

### 2. Evitar documentos huérfanos
Todo documento nuevo debería:
- agregarse a este índice
- mencionarse en `README.md` si aplica

### 3. Vincular cambios importantes con bitácora
Si un cambio técnico importante modifica la documentación, conviene registrarlo en:
- `docs/bitacora-cambios.md`

### 4. Revisar periódicamente consistencia
Al menos de forma periódica, validar que:
- rutas sigan vigentes
- nombres de servicios sigan correctos
- documentos no se contradigan
- prioridades del backlog sigan actuales

---

## Documentos futuros recomendados

Si se desea ampliar la documentación, los siguientes serían buenos candidatos:

- `docs/roadmap.md`
- `docs/manual-usuarios.md`
- `docs/diccionario-datos.md`
- `docs/matriz-permisos-endpoints.md`
- `docs/guia-staging.md`
- `docs/faq-desarrollo.md`

---

## 6. Usuario general
Orden recomendado:

1. `docs/manual-usuarios.md`
2. `docs/faq-operativa.md`
3. `docs/flujos-operativos.md`

| Planear evolución del sistema | `docs/roadmap.md`, `docs/backlog-tecnico.md` |
## Resumen

Este índice organiza la documentación del proyecto como una base de conocimiento navegable para perfiles técnicos, operativos, funcionales y de soporte.

Debe mantenerse como documento vivo para asegurar que el repositorio siga siendo entendible, operable y mantenible con el tiempo.
