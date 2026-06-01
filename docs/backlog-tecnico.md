# Backlog técnico

## Propósito

Este documento convierte los hallazgos técnicos y operativos del proyecto en una lista de trabajo priorizable y gestionable.

Su objetivo es servir como backlog base para seguimiento interno de mejoras sobre:

- seguridad
- despliegue
- arquitectura
- datos
- pruebas
- documentación
- operación en producción

Complementa especialmente a:

- `docs/pendientes-tecnicos.md`
- `docs/checklist-produccion.md`
- `docs/matriz-modulos.md`
- `docs/permisos-y-roles.md`

---

## Criterios de prioridad

### Alta
Debe atenderse pronto porque puede impactar:
- seguridad
- integridad de datos
- disponibilidad
- control operativo

### Media
Mejora mantenibilidad, orden, trazabilidad o calidad general.

### Baja
Mejora madurez, claridad o soporte documental, pero sin urgencia inmediata.

---

## Estados sugeridos

Se recomienda usar uno de estos estados para dar seguimiento:

- `pendiente`
- `en análisis`
- `en progreso`
- `bloqueado`
- `hecho`
- `descartado`

---

## Backlog inicial

| ID | Tema | Pendiente | Prioridad | Estado sugerido | Observaciones |
|---|---|---|---|---|---|
| BT-001 | Seguridad | Revisar robustez y resguardo de `SECRET_KEY` | Alta | pendiente | Crítico para autenticación JWT |
| BT-002 | Seguridad | Revisar expiración y política de tokens | Alta | pendiente | Confirmar tiempos y estrategia de sesión |
| BT-003 | Seguridad | Formalizar matriz rol -> permiso -> endpoint | Alta | en progreso | Matriz en `docs/matriz-acl-endpoints.md`; CRIT ACL-C01–C05 corregidos en código (2026-06-01) |
| BT-004 | Seguridad | Auditar endpoints sensibles de administración y movimientos | Alta | pendiente | Confirmar que todos validen rol y permiso |
| BT-005 | Despliegue | Formalizar procedimiento estándar de despliegue | Alta | pendiente | Reducir cambios manuales no trazables |
| BT-006 | Despliegue | Mantener fuente Git controlada para despliegues | Alta | pendiente | Evitar diferencias entre código fuente y producción |
| BT-007 | Despliegue | Documentar instalación reproducible del entorno | Media | pendiente | Python, venv, dependencias, servicio |
| BT-008 | Monitoreo | Establecer monitoreo básico del servicio `catastro-api` | Media | pendiente | Estado, logs, disponibilidad, recursos |
| BT-009 | Datos | Crear diccionario técnico de datos | Alta | pendiente | Tablas, columnas, tipos, llaves, índices |
| BT-010 | Datos | Documentar vistas críticas del sistema | Alta | pendiente | `v_ficha_predial`, `v_expediente_integral`, `v_control_cartografico` |
| BT-011 | Datos | Definir estrategia formal del padrón anual | Alta | pendiente | Aclarar uso de `padron_2026` y cortes históricos |
| BT-012 | Datos | Revisar integridad de relaciones propietario-predio | Alta | pendiente | Titular principal, porcentajes, duplicados |
| BT-013 | Datos | Documentar reglas de subdivisión y fusión predial | Media | pendiente | Flujo crítico para trazabilidad histórica |
| BT-014 | Arquitectura | Revisar tamaño y responsabilidad de routers grandes | Media | pendiente | Facilitar mantenimiento y pruebas |
| BT-015 | Arquitectura | Extraer lógica de negocio compleja fuera de endpoints | Media | pendiente | Mejor separación de capas |
| BT-016 | Arquitectura | Centralizar/documentar SQL crítico | Media | pendiente | Evitar lógica dispersa y opaca |
| BT-017 | Arquitectura | Evaluar consolidación o retiro de rutas legacy | Media | pendiente | Especialmente módulo de movimientos legacy |
| BT-018 | Validación | Fortalecer validación de entrada en payloads y parámetros | Media | pendiente | Claves, ids, rutas, datos sensibles |
| BT-019 | Pruebas | Crear pruebas automatizadas mínimas | Alta | pendiente | Login, ficha, historial, documentos, propietarios |
| BT-020 | Pruebas | Implementar smoke tests post-despliegue | Alta | pendiente | Validación rápida de endpoints críticos |
| BT-021 | Pruebas | Preparar dataset o ambiente de prueba controlado | Media | pendiente | Reducir dependencia de producción |
| BT-022 | Documentación | Mantener README sincronizado con docs/ | Media | pendiente | Evitar desfase documental |
| BT-023 | Documentación | Ampliar glosario institucional/técnico | Baja | pendiente | Abreviaturas y términos locales |
| BT-024 | Documentación | Crear manual por perfil de usuario | Media | pendiente | Admin, consulta, supervisor, cartografía |
| BT-025 | Documentación | Vincular endpoints reales con OpenAPI generado | Media | pendiente | Afinar inventario de endpoints |
| BT-026 | Respaldo | Automatizar respaldos de base de datos | Alta | pendiente | Dumps periódicos y retención |
| BT-027 | Respaldo | Automatizar respaldo de documentos críticos | Alta | pendiente | Especialmente expediente/documentos |
| BT-028 | Respaldo | Probar restauraciones controladas | Alta | pendiente | Validar que backups realmente sirven |
| BT-029 | Respaldo | Mantener copia de respaldo fuera del servidor principal | Alta | pendiente | Reducir riesgo por pérdida total del host |
| BT-030 | Producción | Separar mejor producción, fuentes y artefactos históricos | Alta | pendiente | Evitar confusión operativa en servidor |
| BT-031 | Producción | Mantener inventario actualizado de servicios y rutas | Media | pendiente | Facilita soporte y operación |
| BT-032 | Producción | Revisar exposición pública y tráfico no deseado | Media | pendiente | Firewall, proxy, rate limiting |
| BT-033 | Limpieza | Estandarizar rutas del servidor por tipo de componente | Media | pendiente | `/opt`, `/srv`, `/var/www`, backups |
| BT-034 | Auditoría | Revisar que acciones críticas de negocio queden auditadas | Alta | pendiente | Aplicación de movimientos, cambios de titularidad, usuarios |
| BT-035 | Operación | Formalizar bitácora de cambios de producción | Media | pendiente | Qué se cambió, cuándo, por quién, resultado |
| BT-036 | Operación | Formalizar checklist corto de pre-flight para cambios | Media | pendiente | Versión resumida del checklist de producción |
| BT-037 | Operación | Crear procedimiento de rollback rápido | Alta | pendiente | Código, `.env`, DB, validaciones |
| BT-038 | Seguridad | Revisar política de altas, bajas y cambios de roles | Media | pendiente | Gobernanza de usuarios y permisos |
| BT-039 | Datos | Crear reportes de inconsistencias de calidad de datos | Media | pendiente | Duplicados, porcentajes, claves, relaciones |
| BT-040 | Cartografía | Documentar integración entre padrón, expediente y cartografía | Media | pendiente | Especialmente control cartográfico y cambios geométricos |

---

## Priorización sugerida por fases

## Fase 1: estabilidad y control
Atender primero:

- BT-001
- BT-002
- BT-003
- BT-004
- BT-005
- BT-006
- BT-019
- BT-020
- BT-026
- BT-028
- BT-029
- BT-030
- BT-037

### Objetivo
Reducir riesgo operativo inmediato en seguridad, despliegue, pruebas y recuperación.

---

## Fase 2: integridad funcional y mantenibilidad
Atender después:

- BT-009
- BT-010
- BT-011
- BT-012
- BT-014
- BT-015
- BT-016
- BT-017
- BT-018
- BT-021
- BT-034
- BT-039
- BT-040

### Objetivo
Mejorar comprensión estructural del sistema y reducir deuda técnica del núcleo funcional.

---

## Fase 3: madurez operativa y documental
Atender posteriormente:

- BT-007
- BT-008
- BT-022
- BT-023
- BT-024
- BT-025
- BT-031
- BT-032
- BT-033
- BT-035
- BT-036
- BT-038

### Objetivo
Fortalecer documentación, soporte, gobernanza y disciplina operativa.

---

## Recomendación de uso

### Opción 1: mantener este archivo manualmente
Actualizar columnas como:
- estado real
- responsable
- fecha objetivo
- observaciones de avance

### Opción 2: migrarlo a tablero operativo
Llevar este backlog a:
- GitHub Issues
- GitHub Projects
- hoja de cálculo institucional
- herramienta interna de seguimiento

---

## Formato extendido sugerido por tarea

Si una tarea se vuelve prioritaria, puede desglosarse así:

### Ejemplo
```markdown
## BT-003 - Formalizar matriz rol -> permiso -> endpoint

**Prioridad:** Alta  
**Estado:** pendiente  
**Responsable:** por definir  

### Objetivo
Documentar y validar la relación exacta entre roles, permisos funcionales y endpoints expuestos por el sistema.

### Entregables
- matriz documentada
- revisión de ACL real
- listado de inconsistencias
- propuesta de corrección

### Riesgos si no se atiende
- accesos indebidos
- restricciones incompletas
- dificultad para auditoría

### Dependencias
- revisión de `auth/acl.py`
- revisión de routers
- revisión de permisos por módulo
```

---

## Indicadores simples sugeridos

Para medir avance técnico, pueden usarse métricas como:

- porcentaje de tareas altas cerradas
- número de endpoints críticos cubiertos por pruebas
- número de respaldos automatizados verificados
- porcentaje de módulos con documentación técnica suficiente
- número de incidentes de despliegue con rollback necesario
- tiempo promedio de recuperación ante falla

---

## Resumen ejecutivo

Este backlog organiza los principales trabajos técnicos pendientes del sistema en torno a:

- seguridad
- despliegue
- datos
- arquitectura
- pruebas
- documentación
- respaldo y recuperación
- operación de producción

Su propósito no es solo listar ideas, sino servir como base para priorización real y mejora continua del proyecto.