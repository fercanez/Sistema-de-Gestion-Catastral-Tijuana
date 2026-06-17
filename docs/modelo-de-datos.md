# Modelo de datos

## Propósito

Este documento describe de manera funcional y técnica las principales estructuras de datos identificadas en el sistema catastral a partir del código revisado.

No pretende sustituir un diccionario de datos exhaustivo de base de datos, sino servir como mapa inicial de:

- esquemas
- tablas
- vistas
- relaciones funcionales
- responsabilidades por dominio

---

## Enfoque general

El sistema trabaja sobre PostgreSQL y organiza la información en varios esquemas lógicos, cada uno con responsabilidad propia.

Los dominios identificados son:

- seguridad
- catálogos
- catastro
- auditoría
- pducp

La arquitectura de datos parece combinar:

- tablas operativas
- tablas de relación
- vistas de consulta
- estructuras auxiliares para auditoría y trazabilidad

---

## Esquemas identificados

### 1. `seguridad`

Responsable de:
- usuarios
- roles
- asignación de roles
- auditoría de acceso
- auditoría de sistema

Tablas detectadas:
- `seguridad.usuarios`
- `seguridad.roles`
- `seguridad.usuario_roles`
- `seguridad.auditoria_login`
- `seguridad.auditoria_sistema`

#### Función del esquema
Controla identidad, autenticación, autorización y trazabilidad básica de acceso.

---

### 2. `catalogos`

Responsable de:
- padrón base
- personas
- calles
- colonias
- tipos de movimiento
- otros catálogos institucionales

Tablas detectadas:
- `catalogos.padron_2026`
- `catalogos.personas`
- `catalogos.cat_calles`
- `catalogos.cat_colonias`
- `catalogos.cat_tipos_movimiento_padron`

#### Función del esquema
Concentra datos de referencia y estructuras reutilizadas por distintos módulos.

---

### 3. `catastro`

Responsable de:
- predios
- relaciones prediales
- propietarios por predio
- condominios
- movimientos catastrales
- vistas integrales del expediente
- control cartográfico

Tablas y vistas detectadas:
- `catastro.predios`
- `catastro.predio_propietario`
- `catastro.predio_condominio`
- `catastro.movimientos_padron`
- `catastro.movimientos_padron_detalle`
- `catastro.relaciones_prediales`
- `catastro.v_expediente_integral`
- `catastro.v_control_cartografico`
- `catastro.v_ficha_predial`

#### Función del esquema
Es el núcleo operativo del sistema catastral.

---

### 4. `auditoria`

Responsable de:
- auditoría de movimientos
- cambios geométricos
- líneas de tiempo de expediente
- historial de cambios relevantes

Tablas y vistas detectadas:
- `auditoria.movimientos_padron_auditoria`
- `auditoria.cambios_geometricos_predios`
- `auditoria.v_expedientes_timeline`

#### Función del esquema
Permite trazabilidad técnica e institucional sobre operaciones relevantes.

---

### 5. `pducp`

Responsable de:
- matriz de compatibilidad de usos del PDUCP Mexicali 2040
- densidades habitacionales propuestas
- relacion normativa por distrito urbano

Tablas propuestas:
- `pducp.matriz_compatibilidad`
- `pducp.densidades_habitacionales`
- `pducp.densidades_distrito`

Vistas relacionadas en GeoNode:
- `public.v_predios_distrito_pducp`

#### Función del esquema
Permite relacionar un predio con su distrito PDUCP y consultar densidad, COS/CUS y compatibilidad preliminar de uso.

---

## Entidades funcionales principales

## 1. Usuario

### Tabla principal
- `seguridad.usuarios`

### Relacionadas
- `seguridad.usuario_roles`
- `seguridad.roles`
- `seguridad.auditoria_login`
- `seguridad.auditoria_sistema`

### Responsabilidad
Representa a cada persona con acceso al sistema.

### Datos esperados
Aunque no se listan todas las columnas exactas, por el código se infiere que maneja datos como:
- identificador
- nombre de usuario
- contraseña hasheada
- estatus activo/inactivo
- datos básicos de identidad
- relación con roles

### Relaciones funcionales
- un usuario puede tener uno o varios roles
- un usuario genera eventos de auditoría
- un usuario puede aplicar movimientos o realizar acciones administrativas

---

## 2. Rol

### Tabla principal
- `seguridad.roles`

### Relacionada
- `seguridad.usuario_roles`

### Responsabilidad
Clasifica permisos de acceso por perfil funcional.

### Roles detectados en código
- `admin`
- `supervisor`
- `cartografia`
- `catastro`
- `fiscalizacion`
- `consulta`

### Uso funcional
Los roles se usan para:
- controlar acceso a endpoints
- limitar acciones sensibles
- habilitar capacidades de consulta, edición, autorización y aplicación

---

## 3. Persona / propietario

### Tabla principal
- `catalogos.personas`

### Relacionadas
- `catastro.predio_propietario`
- estructuras auxiliares del módulo de propietarios

### Responsabilidad
Representa personas físicas o morales asociadas a predios.

### Capacidades funcionales detectadas
- alta y consulta de personas
- edición de datos generales
- actualización de domicilio
- búsqueda por nombre o identificadores
- fusión de personas duplicadas
- sincronización al padrón

### Posibles atributos funcionales
- nombre o razón social
- tipo de persona
- RFC, CURP u otros identificadores
- domicilio
- estatus
- datos homologados de captura

---

## 4. Predio

### Tabla principal
- `catastro.predios`

### Relacionadas
- `catastro.predio_propietario`
- `catastro.predio_condominio`
- `catastro.relaciones_prediales`
- vistas de expediente y ficha
- estructuras de padrón base en `catalogos.padron_2026`

### Responsabilidad
Representa la unidad territorial/administrativa central del sistema.

### Identificador funcional principal
- clave catastral

### Capacidades funcionales relacionadas
- consulta simple y avanzada
- ficha predial
- ubicación geográfica
- asociación con propietarios
- historial de movimientos
- clasificación de régimen y tenencia
- vinculación cartográfica
- expediente integral

---

## 5. Relación propietario-predio

### Tabla principal
- `catastro.predio_propietario`

### Relacionadas
- `catalogos.personas`
- `catastro.predios`

### Responsabilidad
Modela la relación entre una persona y un predio.

### Datos funcionales esperados
- identificador de predio
- identificador de persona
- porcentaje de propiedad
- tipo de titularidad
- indicador de titular principal
- vigencia o estatus

### Valor funcional
Permite:
- copropiedad
- titular principal
- porcentajes parciales
- sincronización de nombre visible en padrón

---

## 6. Padrón base

### Tabla principal detectada
- `catalogos.padron_2026`

### Responsabilidad
Constituye la fuente principal de consulta alfanumérica del padrón catastral observado en el código.

### Uso funcional detectado
- búsqueda de predios
- ficha predial
- consulta consolidada con titular principal
- clasificación de tenencia
- consultas espaciales indirectas
- base para operaciones del módulo padrón

### Observación
El nombre `padron_2026` sugiere que el sistema puede trabajar con cortes o versiones anuales del padrón.

---

## 7. Movimiento catastral

### Tabla principal
- `catastro.movimientos_padron`

### Relacionada
- `catastro.movimientos_padron_detalle`

### Relación con auditoría
- `auditoria.movimientos_padron_auditoria`

### Responsabilidad
Representa un cambio propuesto o aplicado sobre el padrón.

### Tipos de movimiento observados
- nombre
- titularidad
- superficie
- construcción
- uso de suelo
- zona homogénea
- número oficial
- clave
- alta
- baja
- bloqueo
- desbloqueo
- subdivisión
- fusión

### Modelo funcional
Parece manejar:
- encabezado del movimiento
- detalle de cambios por campo
- estado del trámite
- usuario que captura
- usuario que aplica
- fecha de aplicación
- observaciones o justificación

---

## 8. Detalle de movimiento

### Tabla principal
- `catastro.movimientos_padron_detalle`

### Responsabilidad
Desglosa los cambios individuales contenidos en un movimiento.

### Datos funcionales esperados
- id de movimiento
- campo afectado
- valor anterior
- valor nuevo
- metadatos de cambio

### Valor
Permite:
- trazabilidad fina
- comparación antes/después
- auditoría técnica
- aplicación controlada de cambios

---

## 9. Condominio

### Tabla principal detectada
- `catastro.predio_condominio`

### Responsabilidad
Clasifica y organiza predios sujetos a régimen de condominio.

### Uso funcional detectado
- identificación de régimen
- tipo de condominio
- resumen de unidades
- agrupación por prefijos o claves
- operaciones masivas de tenencia/régimen

### Observación
El sistema parece haber reforzado esta parte con lógica específica y validaciones adicionales.

---

## 10. Relaciones prediales

### Tabla principal detectada
- `catastro.relaciones_prediales`

### Responsabilidad
Representa vínculos entre predios, por ejemplo en:
- subdivisiones
- fusiones
- relaciones históricas
- asociaciones técnicas entre claves

### Valor funcional
Ayuda a reconstruir transformaciones prediales a lo largo del tiempo.

---

## Vistas principales

## 1. `catastro.v_expediente_integral`

### Función
Concentrar información ampliada del predio para consulta integral.

### Posible contenido funcional
- datos del predio
- titular
- estado cartográfico
- indicadores fiscales
- documentos
- metadatos de expediente

### Uso
Es la base probable del módulo expediente.

---

## 2. `catastro.v_control_cartografico`

### Función
Dar soporte a análisis cartográfico y monitoreo geométrico.

### Uso funcional detectado
- control cartográfico
- dashboards
- análisis de consistencia geográfica
- verificación de cobertura o cambios

---

## 3. `catastro.v_ficha_predial`

### Función
Proveer una vista simplificada o consolidada de información predial.

### Uso funcional
- ficha rápida del predio
- consulta operativa desde módulo padrón
- respuesta lista para interfaz

---

## 4. `auditoria.v_expedientes_timeline`

### Función
Construir una línea de tiempo del expediente.

### Uso funcional
- historial del predio
- seguimiento cronológico
- visualización de eventos relevantes

---

## Auditoría y trazabilidad

El sistema incorpora varias capas de auditoría.

### Estructuras detectadas
- `seguridad.auditoria_login`
- `seguridad.auditoria_sistema`
- `auditoria.movimientos_padron_auditoria`
- `auditoria.cambios_geometricos_predios`
- `auditoria.v_expedientes_timeline`

### Objetivos
- registrar accesos
- registrar acciones administrativas
- registrar aplicación de movimientos
- registrar cambios geométricos
- facilitar revisión histórica

---

## Relaciones funcionales principales

### Usuario -> Rol
Un usuario puede tener uno o varios roles mediante:
- `seguridad.usuario_roles`

### Persona -> Predio
Una persona se relaciona con uno o más predios mediante:
- `catastro.predio_propietario`

### Predio -> Movimiento
Un predio puede tener múltiples movimientos en:
- `catastro.movimientos_padron`

### Movimiento -> Detalle
Un movimiento tiene uno o varios detalles en:
- `catastro.movimientos_padron_detalle`

### Movimiento -> Auditoría
La aplicación de movimientos deja rastro en:
- `auditoria.movimientos_padron_auditoria`

### Predio -> Expediente
La vista consolidada se obtiene desde:
- `catastro.v_expediente_integral`

### Predio -> Control cartográfico
El estado cartográfico puede verse mediante:
- `catastro.v_control_cartografico`

---

## Zonas homogéneas

Aunque no se identificó una tabla puntual confirmada con nombre completo en todos los casos, el módulo padrón evidencia un subsistema importante para zonas homogéneas.

### Capacidades detectadas
- creación
- importación
- ajuste
- consulta
- evolución por año
- análisis técnico

### Modelos funcionales detectados
- valores por año
- payloads de ajuste
- payloads de creación
- payloads de importación

### Interpretación
Es probable que existan tablas específicas de zonas homogéneas oficiales y adicionales, además de estructuras auxiliares de análisis y catálogo.

---

## Tenencia y régimen

El código muestra una clasificación funcional de tenencia y régimen con códigos como:

- `C`
- `P`
- `G`
- `S`
- `R`
- `E`

### Interpretación funcional
Estos códigos parecen usarse para:
- clasificar predios
- distinguir condominios
- ejecutar saneamientos masivos
- resumir impacto de cambios
- aplicar regularizaciones

### Observación
La lógica parece estar implementada parcialmente en SQL y parcialmente en código de negocio.

---

## Observaciones sobre el modelo de datos

### Fortalezas
- separación por esquemas
- existencia de vistas consolidadas
- soporte de auditoría
- trazabilidad de movimientos
- soporte para titularidad compleja
- integración de dimensión cartográfica

### Posibles retos
- fuerte dependencia de vistas y SQL manual
- estructuras anuales del padrón
- complejidad creciente en régimen/condominio
- necesidad de diccionario de datos formal

---

## Recomendaciones futuras

### 1. Crear diccionario de datos detallado
Por tabla:
- columnas
- tipos
- nullability
- llaves primarias
- llaves foráneas
- índices

### 2. Documentar vistas críticas
Especialmente:
- `v_expediente_integral`
- `v_control_cartografico`
- `v_ficha_predial`

### 3. Documentar catálogos de códigos
Ejemplos:
- tipos de movimiento
- códigos de tenencia
- tipos de condominio
- estados de movimiento

### 4. Documentar modelo temporal del padrón
Aclarar si:
- `padron_2026` reemplaza años previos
- existen tablas por año
- existe estrategia de versionado histórico

---

## Resumen

El modelo de datos del sistema catastral está organizado alrededor de cuatro dominios principales:

- seguridad
- catálogos
- catastro
- auditoría

La entidad central es el predio, identificado por su clave catastral, y conectado con:

- propietarios
- movimientos
- expediente
- cartografía
- auditoría

A nivel funcional, el modelo ya soporta:
- operación diaria
- control de acceso
- trazabilidad
- mantenimiento predial
- expediente integral
- análisis territorial y cartográfico

Este documento debe entenderse como una base inicial para evolucionar hacia un diccionario de datos completo.
