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
- consulta de documento registral (RPPC Baja California)
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
- consulta de documento registral RPPC (folio real → PDF) desde el visor
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
  - **RPPC** (`routers/rppc.py`) — proxy al Registro Público de la Propiedad BC

- **Frontend modular (visor catastral)**  
  Interfaz en `index.html` con assets partidos en módulos:
  - `css/00-base.css` … `css/55-modulos-portal.css`
  - `js/00-nucleo.js` — utilidades, sesión, capas
  - `js/10-mapa.js` — mapa OpenLayers, WMS, leyenda
  - `js/20-ficha.js` — ficha predial y pestañas
  - `js/30-busqueda.js` — búsqueda y selección de predios
  - `js/05-modulos-portal.js` — portal por módulos y popup predio
  - `js/06-construcciones-medicion.js` — construcciones/medición en popup
  - `js/07-numeros-oficiales.js` — números oficiales cercanos en popup
  - `js/08-carta-urbana.js` — pestaña Carta Urbana 2040 (mapa WMS, sector, capas)
  - `js/45-ficha-carta-urbana-preview.js` — ficha imprimible Carta Urbana 2040
  - `js/52-popup-rppc.js` — pestaña **Documento RPPC** (resolver folio + visor PDF)
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
| `css/55-modulos-portal.css` | `v20260611_v164_rppc_api` |
| `js/05-modulos-portal.js` | `v20260611_v163_pestana_rppc` |
| `js/52-popup-rppc.js` | `v20260611_v164_rppc_api` |
| `js/08-carta-urbana.js` | `v118_carta_predio_g` |
| Pie visor (`footerVersionInst`) | **SGC v164 · RPPC API** |

---

## Integración RPPC — Documento registral (jun 2026)

Consulta al **RPPC de Baja California** (enlace remoto) desde el visor: dado un **folio real** o clave catastral, obtiene movimientos, partida, `DOC_TRAMITE_ID` y muestra el **PDF** en la pestaña **Documento RPPC** del popup predio.

### Arquitectura

| Capa | Rol |
|------|-----|
| **Visor** (`js/52-popup-rppc.js`) | Pestaña en popup; `fetch` con JWT SGC; PDF en iframe vía blob URL |
| **API SGC** (`routers/rppc.py`) | Proxy autenticado; no expone credenciales RPPC al navegador |
| **RPPC externo** | WebAPI ASP.NET en `rppcweb.ebajacalifornia.gob.mx` |

**Autenticación RPPC:** la sesión válida es la cookie ASP.NET **`.AspNet.ApplicationCookie`** (login del portal enlace remoto), **no** un login REST directo desde la API. La cookie se inyecta en cada request al RPPC.

**Prioridad de cookie:**

1. Archivo runtime: `/opt/catastro_api/.runtime/rppc_cookie.txt` (renovación automática con Playwright)
2. Respaldo manual: variable `RPPC_COOKIE` en `.env` del servidor

**Script de renovación (solo servidor):** `/opt/catastro_api/rppc_renovar_cookie.py` — usa `RPPC_USUARIO` / `RPPC_PASSWORD` del enlace remoto (cuenta distinta al usuario SGC).

### Variables `.env` (API — no versionar)

| Variable | Uso |
|----------|-----|
| `RPPC_USUARIO` / `RPPC_PASSWORD` | Credenciales **enlace remoto RPPC** (Playwright) |
| `RPPC_COOKIE` | Cookie manual de respaldo (contiene `.AspNet.ApplicationCookie=…`) |
| `RPPC_BASE_URL` | Base del portal (default producción BC) |
| `RPPC_SESSION_PATH` | Preflight sesión (`/rppapp/inicio?remoto=1`) |
| `RPPC_SSL_LEGACY`, `RPPC_SSL_SECLEVEL`, `RPPC_SSL_MIN_TLS` | TLS legacy (OpenSSL 3 / Ubuntu) |
| `RPPC_RUNTIME_COOKIE_FILE` | Ruta del archivo de cookie (opcional) |
| `RPPC_RENOVAR_COOKIE_SCRIPT` | Ruta del script Playwright (opcional) |

### Endpoints API (`/api/catastro/rppc/…`, JWT requerido salvo visor PDF)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/diagnostico` | Prueba conexión, cookie, consulta folio de prueba |
| `POST` | `/sesion/renovar` | Renueva cookie vía Playwright |
| `GET` | `/resolver/folio/{folio}` | Cadena folio → partida → `doc_tramite_id` |
| `GET` | `/resolver/clave/{clave}` | Igual por clave catastral (padrón) |
| `GET` | `/inmuebles/clave/{clave}` | Inmuebles RPPC por clave (backfill folios) |
| `GET` | `/movimientos/folio/{folio}` | Lista movimientos del folio |
| `GET` | `/pdf/folio/{folio}` | PDF por folio |
| `GET` | `/pdf/clave/{clave}` | PDF por clave |
| `GET` | `/pdf/doc/{doc_tramite_id}` | PDF directo (JWT) |
| `GET` | `/visor/pdf/doc/{doc_tramite_id}` | PDF para iframe del visor |

Flujo interno típico: `ConsultaAvanzada/obtenerMovimientosLote` → `obtenerInscripcionesPart` → PDF por partida o `ObtenerDocumentoPorId`.

### Operación en servidor

```bash
# Diagnóstico (con token SGC)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://<host>/api/catastro/rppc/diagnostico" | python3 -m json.tool

# Renovar sesión RPPC
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "https://<host>/api/catastro/rppc/sesion/renovar"

# Tras desplegar backend
sudo systemctl restart catastro-api
```

**Cron sugerido** (renovar cookie antes de expirar, p. ej. cada 6 h):

```cron
0 */6 * * * cd /opt/catastro_api && ./venv/bin/python3 rppc_renovar_cookie.py
```

### Despliegue visor

Subir a `/var/www/catastro/`: `index.html`, `css/55-modulos-portal.css`, `js/05-modulos-portal.js`, `js/52-popup-rppc.js`. Recarga **Ctrl+F5**.

### Validación rápida

- `rppc_cookie_configurada: true` en `/rppc/diagnostico`
- `post_ok: true` con folio de prueba (ej. `3454`)
- Popup predio → pestaña **Documento RPPC** → PDF visible

**Archivos clave:** `routers/rppc.py`, `config.py`, `js/52-popup-rppc.js`, `js/05-modulos-portal.js`, `css/55-modulos-portal.css`, `index.html`.

---

## Estado actual del visor (13 jun 2026)

### Carta Urbana 2040 — **v108–v118** (validado en producción)

Pestaña **Carta Urbana 2040** en popup predio (Gestión Catastral):

| Área | Implementación |
|------|----------------|
| **Consulta** | Panel izq.: clave, uso padrón, **Sector** (capa `sectores`), uso permitido (`usos_prop_au40`). Mapa OL con WMS usos + sectores + predio vectorial. |
| **Predio en mapa** | Contorno **negro punteado**, sin relleno (deja ver uso de suelo). |
| **Capas** | Botón en barra superior; panel flotante **sobre el mapa** (esquina sup. der.) con botón **−** para ocultar. |
| **Ficha / PDF** | `js/45-ficha-carta-urbana-preview.js`: encabezado con clave (sin nombre propietario), simbología horizontal de usos, plano imprimible con zoom/capas en toolbar de vista previa. |
| **Estilos** | Marcos de datos en **guinda** `#703341`; leyenda sectores **azul punteado**. |

**Backend:** `GET /padron/{clave}/carta-urbana-2040` (y alias `/predios/...`) en `routers/padron.py` — intersección GeoNode + fallback WMS GetFeatureInfo para sector y usos. Tras desplegar API: `systemctl restart catastro-api`.

**Archivos clave:** `js/08-carta-urbana.js`, `js/45-ficha-carta-urbana-preview.js`, `css/55-modulos-portal.css`, `js/05-modulos-portal.js`, `routers/padron.py`, `index.html`.

### Portal y panel lateral (sesiones previas)
- Modo **Gestión Catastral**: panel izquierdo con **Consulta** + **Capas** únicamente.
- Ocultas en ese modo: Herramientas, Zonas H., Condominios, Movimientos, Admin.
- Ficha del predio en **popup**; búsqueda y leyenda integrada en el panel.

### Capas del mapa (Gestión Catastral)
- **Inicio:** solo **colonias** WMS al 100 %; predios WMS apagados.
- **Al seleccionar predio:** zoom automático + encendido de capa predios WMS.

### Números oficiales y cédula (v105–v107)
- Pestaña números oficiales con mapa, ficha e impresión.
- Cédula de movimiento con vista previa cartográfica (`js/44-cedula-numero-oficial-preview.js`).

### Pendiente / mejoras futuras
- [ ] Cron systemd o timer para `rppc_renovar_cookie.py` en todos los entornos.
- [ ] Incluir `rppc_renovar_cookie.py` en repo (sin credenciales) y `.env.example`.
- [ ] Despliegue permanente del endpoint carta urbana en API si aún no está en todos los entornos.
- [ ] Revisar consulta WFS construcciones (`construccionesmxli`) — timeout GeoServer en algunas claves.
- [ ] Integrar herramientas del panel de trabajo en fichas del predio según privilegios.

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

### RPPC (Registro Público de la Propiedad BC)

Variables en `config.py` — ver sección [Integración RPPC](#integración-rppc--documento-registral-jun-2026):

- `RPPC_USUARIO`, `RPPC_PASSWORD` — enlace remoto (solo servidor / Playwright)
- `RPPC_COOKIE` — cookie ASP.NET manual (no subir a Git)
- `RPPC_BASE_URL`, `RPPC_SESSION_PATH`, `RPPC_SSL_*`, timeouts
- `RPPC_REPORTES_PREFIX`, acciones de movimientos/inscripciones/documento

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
- documento RPPC (folio con cookie activa)

Rutas críticas identificadas:

```text
GET /padron/{clave}/ficha
GET /expediente/{clave}/historial
GET /expediente/{clave}/documentos
GET /predios/{clave}/propietarios
GET /rppc/diagnostico
GET /rppc/resolver/folio/{folio_real}
GET /rppc/pdf/folio/{folio_real}
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
- indicador y consulta **Documento RPPC** (folio real / PDF registral)

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