# Sistema de Gestión Catastral BC

Sistema backend y documental para operación catastral, consulta predial, expediente, propietarios, movimientos catastrales, administración y soporte operativo, con integración a PostgreSQL, componentes geoespaciales y documentación técnica/operativa consolidada.

---

## Descripción general

Este proyecto implementa una API basada en FastAPI para la operación institucional del Sistema de Gestión Catastral BC.

Su propósito principal es soportar procesos como:

- autenticación y autorización
- consulta de padrón predial
- ficha predial
- expediente integral
- historial y documentos
- administración de propietarios
- captura y aplicación de movimientos catastrales
- mantenimiento de catálogos
- administración de usuarios, roles y permisos
- validación operativa y soporte técnico básico

---

## Capacidades principales

Entre las capacidades identificadas del sistema se encuentran:

- autenticación con JWT
- autorización por roles y permisos
- consulta de predios por clave catastral
- consulta de ficha predial
- consulta de historial del expediente
- consulta documental
- consulta y mantenimiento de propietarios
- flujos de captura, revisión y aplicación de movimientos
- soporte para control cartográfico y componentes geoespaciales
- administración operativa mediante `systemd`
- integración con visor y documentos en servidor

---

## Stack principal

Tecnologías principales identificadas:

- Python
- FastAPI
- Uvicorn
- PostgreSQL
- psycopg2
- python-dotenv
- python-jose
- passlib
- bcrypt

---

## Estructura general del proyecto

Componentes principales identificados:

- `main.py`  
  Punto de entrada de la aplicación.

- `config.py`  
  Configuración general y carga de variables de entorno.

- `database.py`  
  Manejo de conexión a PostgreSQL.

- `auth/`  
  Seguridad, autenticación, autorización, dependencias y ACL.

- `routers/`  
  Endpoints organizados por dominio funcional, incluyendo:
  - padrón
  - expediente
  - propietarios
  - movimientos
  - movimientos legacy
  - catálogos
  - administración

- `docs/`  
  Base documental técnica, operativa y de soporte.

---

## Configuración

La aplicación utiliza variables de entorno para configuración sensible.

Variables observadas:

- `SECRET_KEY`
- `JWT_ALGORITHM`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

### Recomendaciones
- no versionar `.env`
- proteger `SECRET_KEY`
- respaldar configuración antes de cambios
- validar variables antes de reiniciar en producción

---

## Ejecución local

Ejemplo general:

```bash
uvicorn main:app --host 0.0.0.0 --port 9000
```

---

## Despliegue observado

En producción se identificó una ejecución equivalente a:

```bash
/opt/catastro_api/venv/bin/python3 /opt/catastro_api/venv/bin/uvicorn main:app --host 0.0.0.0 --port 9000
```

Servicio principal observado:

```text
catastro-api.service
```

Ruta operativa observada:

```text
/opt/catastro_api
```

---

## Validación operativa mínima

Después de cambios o despliegues, conviene validar al menos:

- login
- ficha predial
- historial de expediente
- documentos del expediente
- propietarios por predio

Rutas críticas identificadas:

```text
GET /padron/{clave}/ficha
GET /expediente/{clave}/historial
GET /expediente/{clave}/documentos
GET /predios/{clave}/propietarios
```

---

## Documentación disponible

La carpeta `docs/` contiene documentación técnica, funcional, operativa y de soporte.

### Documento de entrada recomendado
- [`docs/indice-documentacion.md`](docs/indice-documentacion.md)  
  Mapa general de toda la documentación disponible.

---

## Índice documental

### Base general
- [`docs/indice-documentacion.md`](docs/indice-documentacion.md)  
  Índice maestro de la documentación del proyecto.

- [`docs/estructura-documentacion.md`](docs/estructura-documentacion.md)  
  Propuesta de organización futura de la documentación por categorías.
---

### Arquitectura y estructura
- [`docs/arquitectura-tecnica.md`](docs/arquitectura-tecnica.md)  
  Arquitectura técnica general del sistema.

- [`docs/matriz-modulos.md`](docs/matriz-modulos.md)  
  Módulos, responsabilidades, dependencias y riesgos principales.

---

### Datos y dominio
- [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md)  
  Descripción funcional inicial del modelo de datos.

- [`docs/glosario.md`](docs/glosario.md)  
  Glosario técnico, funcional y operativo.

---

### API, seguridad y comportamiento funcional
- [`docs/endpoints.md`](docs/endpoints.md)  
  Inventario inicial de endpoints confirmados y probables.

- [`docs/flujos-operativos.md`](docs/flujos-operativos.md)  
  Flujos funcionales principales del sistema.

- [`docs/permisos-y-roles.md`](docs/permisos-y-roles.md)  
  Roles, permisos y modelo de autorización.

---

### Producción y operación
- [`docs/operacion-servidor.md`](docs/operacion-servidor.md)  
  Operación del servidor, rutas y servicios relevantes.

- [`docs/despliegue.md`](docs/despliegue.md)  
  Guía de despliegue manual y validación posterior.

- [`docs/checklist-produccion.md`](docs/checklist-produccion.md)  
  Checklist práctico para cambios en producción.

- [`docs/respaldo-y-recuperacion.md`](docs/respaldo-y-recuperacion.md)  
  Estrategia básica de respaldos y restauración.

- [`docs/bitacora-cambios.md`](docs/bitacora-cambios.md)  
  Registro vivo de cambios, validaciones e incidencias.

---

### Administración, soporte y operación diaria
- [`docs/manual-admin.md`](docs/manual-admin.md)  
  Manual de administración del sistema.

- [`docs/manual-operacion-diaria.md`](docs/manual-operacion-diaria.md)  
  Rutina de operación diaria y revisión básica.

- [`docs/manual-soporte.md`](docs/manual-soporte.md)  
  Guía para atención inicial de soporte.

- [`docs/manual-usuarios.md`](docs/manual-usuarios.md)  
  Manual general para usuarios del sistema.

- [`docs/incidentes-comunes.md`](docs/incidentes-comunes.md)  
  Catálogo de incidentes frecuentes y reacción inicial.

- [`docs/faq-operativa.md`](docs/faq-operativa.md)  
  Preguntas frecuentes de operación, soporte y administración.
---

### Gestión técnica y mejora continua
- [`docs/pendientes-tecnicos.md`](docs/pendientes-tecnicos.md)  
  Lista razonada de hallazgos y mejoras técnicas.

- [`docs/backlog-tecnico.md`](docs/backlog-tecnico.md)  
  Backlog técnico inicial priorizado.

- [`docs/roadmap.md`](docs/roadmap.md)  
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

### `docs/roadmap.md`
Hoja de ruta técnica y operativa del sistema:
- horizontes de trabajo
- prioridades por fase
- evolución sugerida
- dependencias
- indicadores simples
- próximos pasos
---

## Orden de lectura sugerido

### Si eres nuevo en el proyecto
1. `README.md`
2. `docs/indice-documentacion.md`
3. `docs/arquitectura-tecnica.md`
4. `docs/matriz-modulos.md`
5. `docs/endpoints.md`

### Si vas a operar producción
1. `docs/operacion-servidor.md`
2. `docs/despliegue.md`
3. `docs/checklist-produccion.md`
4. `docs/respaldo-y-recuperacion.md`
5. `docs/manual-admin.md`

### Si vas a dar soporte
1. `docs/manual-soporte.md`
2. `docs/incidentes-comunes.md`
3. `docs/manual-operacion-diaria.md`
4. `docs/faq-operativa.md`

### Si vas a desarrollar o mantener el sistema
1. `docs/arquitectura-tecnica.md`
2. `docs/matriz-modulos.md`
3. `docs/modelo-de-datos.md`
4. `docs/endpoints.md`
5. `docs/permisos-y-roles.md`
6. `docs/backlog-tecnico.md`

---

## Módulos funcionales principales

### Autenticación y seguridad
Responsable de:
- login
- tokens JWT
- roles
- permisos
- control de acceso
- auditoría de acceso

### Padrón
Responsable de:
- consulta predial
- ficha predial
- clasificación territorial
- consultas base del sistema

### Propietarios
Responsable de:
- personas
- relación propietario-predio
- titularidad
- actualización de datos de persona

### Expediente
Responsable de:
- expediente integral
- historial
- documentos
- control cartográfico

### Movimientos
Responsable de:
- captura
- revisión
- autorización
- aplicación de cambios al padrón

### Catálogos
Responsable de:
- calles
- colonias
- tipos de movimiento
- estructuras de referencia del sistema

### Administración
Responsable de:
- usuarios
- roles
- auditoría administrativa
- control operativo del acceso

---

## Estado documental actual

El proyecto ya cuenta con una base documental amplia para:

- entendimiento técnico
- operación del servidor
- despliegue
- soporte
- administración
- control de producción
- trazabilidad de cambios
- mejora continua

Aun así, la documentación debe considerarse viva y seguir actualizándose conforme evolucionen:

- código
- base de datos
- infraestructura
- procesos operativos
 
---

## Recomendaciones de trabajo

- documentar todo cambio relevante
- usar `docs/checklist-produccion.md` antes de cambios productivos
- registrar resultados en `docs/bitacora-cambios.md`
- agregar nuevos pendientes en `docs/backlog-tecnico.md`
- revisar periódicamente `docs/roadmap.md` para orientar prioridades
- usar `docs/estructura-documentacion.md` como referencia si en el futuro se reorganiza `docs/`
- mantener `README.md` y `docs/indice-documentacion.md` sincronizados
---

## Recomendaciones de trabajo

- documentar todo cambio relevante
- usar `docs/checklist-produccion.md` antes de cambios productivos
- registrar resultados en `docs/bitacora-cambios.md`
- agregar nuevos pendientes en `docs/backlog-tecnico.md`
- revisar periódicamente `docs/roadmap.md` para orientar prioridades
- usar `docs/estructura-documentacion.md` como referencia si en el futuro se reorganiza `docs/`
- mantener `README.md` y `docs/indice-documentacion.md` sincronizados

## Licencia

Pendiente de definir según lineamientos institucionales o del repositorio.