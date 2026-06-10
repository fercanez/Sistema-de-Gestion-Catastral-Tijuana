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

- **Frontend modular (visor catastral)**  
  Interfaz en `index.html` con assets partidos en módulos:
  - `css/00-base.css` … `css/55-modulos-portal.css`
  - `js/00-nucleo.js` — utilidades, sesión, capas
  - `js/10-mapa.js` — mapa OpenLayers, WMS, leyenda
  - `js/20-ficha.js` — ficha predial y pestañas
  - `js/30-busqueda.js` — búsqueda y selección de predios
  - `js/05-modulos-portal.js` — portal por módulos y popup predio
  - `js/06-construcciones-medicion.js` — construcciones/medición en popup
  - `js/50-admin.js` … `js/99-init.js` — admin, propietarios, movimientos, init
  - Respaldos monolíticos en `respaldo de originales/` (`catastro.js`, `catastro.css`)

- `docs/`  
  Base documental técnica, operativa y de soporte.

---

## Despliegue frontend + backend

| Componente | Ruta en servidor | Acción tras subir archivos |
|------------|------------------|----------------------------|
| API FastAPI | `/opt/catastro_api/` | `sudo systemctl restart catastro-api` |
| Visor web | `/var/www/catastro/` | Recarga forzada en navegador (**Ctrl+F5**) |

URL del visor (base): `/api/catastro/visor/` (según `index.html`).

### Cache buster actual (jun 2026)

Tras cambios en JS/CSS, actualizar el parámetro `?v=` en `index.html`. Referencia reciente:

| Archivo | Versión |
|---------|---------|
| `css/50-modulos.css`, `css/55-modulos-portal.css` | `v149_ocultar_tabs` |
| `js/05-modulos-portal.js` | `v149_ocultar_tabs` |
| `js/10-mapa.js` | `v148_solo_tabs` |
| `js/30-busqueda.js` | `v145_panel_capas` |
| `js/90-mantenimiento.js` | `v141_adeudos` |

---

## Estado actual del visor (10 jun 2026)

Trabajo reciente en **Gestión Catastral** (sesión en curso, pendiente commit):

### Portal y panel lateral
- Modo **Gestión Catastral**: panel izquierdo con **Consulta** + **Capas** únicamente.
- Ocultas en ese modo: Herramientas, Zonas H., Condominios, Movimientos, Admin (clase `tab-modulo-extra` + CSS + JS `ocultarTabsExtraGestionCatastral()`).
- Ficha del predio en **popup** (`popupPredioWorkspace`); búsqueda y leyenda integrada en el panel.

### Capas del mapa (Gestión Catastral)
- **Inicio:** solo **colonias** WMS al 100 %; predios WMS apagados.
- **Al seleccionar predio:** zoom automático + encendido de capa predios WMS.
- Sincronización checkbox ↔ capa: `sincronizarCapasWmsDesdeControles()` en `js/10-mapa.js`.

### Backend / mantenimiento
- Importación **Adeudos 2026** desde Excel (~439k filas): `POST /padron/mantenimiento/adeudos/importar` (`routers/padron.py`).
- UI: botón en Movimientos → Catálogos → **Adeudos 2026** (`js/90-mantenimiento.js`).
- Optimización carga ficha: caché y menos peticiones duplicadas (`js/30-busqueda.js`, `js/20-ficha.js`, `js/60-propietarios.js`).

### Pendiente para siguiente sesión
- [ ] Confirmar despliegue completo de `v149_ocultar_tabs` en producción (panel + pestañas ocultas).
- [ ] Validar capas: colonias solas al entrar; predios al seleccionar; toggles en pestaña Capas.
- [ ] Integrar herramientas del panel de trabajo en **fichas del predio** según privilegios (Herramientas, Zonas, Condominios, Movimientos, Admin).
- [ ] Revisar consulta WFS construcciones (`construccionesmxli`) — timeout en GeoServer para claves como `ST312031`.
- [ ] Unificar cache busters en `index.html` y crear **commit** con todos los cambios locales sin commitear.
- [ ] Post-import adeudos (opcional): `ANALYZE catalogos.padron_2026;`

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
  Hoja de ruta técnica y operativa del sistema.

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

- documentar todo cambio relevante en `docs/bitacora-cambios.md`
- usar `docs/checklist-produccion.md` antes de cambios productivos
- agregar nuevos pendientes en `docs/backlog-tecnico.md`
- revisar periódicamente `docs/roadmap.md` para orientar prioridades
- mantener `README.md` y `docs/indice-documentacion.md` sincronizados
- tras desplegar frontend, verificar en DevTools que los `.js`/`.css` carguen con el cache buster esperado

---

Pendiente de definir según lineamientos institucionales o del repositorio.