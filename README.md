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

- `services/`  
  Jobs internos de la API (sin HTTP):
  - `rppc_backfill_masivo.py` — backfill masivo `folio_real` / partida / PDF en padrón

- `scripts/`  
  Utilidades operativas, incluyendo:
  - `rppc_backfill_masivo_tijuana.py` — CLI del backfill (usa el venv de la API)
  - `rppc_backfill_masivo_tijuana.sh` — wrapper al venv
  - `install_rppc_backfill_timer.sh` — instala timer systemd (alternativa: `deploy/systemd/install.sh`)

- `deploy/systemd/`  
  Unidades para backfill automático RPPC:
  - `catastro-rppc-backfill.service` — un lote por ejecución
  - `catastro-rppc-backfill.timer` — 02:00, 08:00, 14:00 y 20:00 (hora local del servidor)
  - `env.rppc-backfill.example` — plantilla de lote (`RPPC_BACKFILL_LIMITE`, etc.)

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
| API FastAPI | `/opt/catastro_tijuana_api/` | `sudo systemctl restart catastro-tijuana-api` |
| Visor web | `/var/www/catastro_tijuana/` | Recarga forzada en navegador (**Ctrl+F5**) |

URL del visor (base): `/api/catastro-tijuana/visor/` (según `index.html`).

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

## Integración RPPC — Documento registral (jul 2026)

Consulta al **RPPC de Baja California** (enlace remoto) desde el visor: dado un **folio real** o clave catastral, obtiene movimientos, partida, `DOC_TRAMITE_ID` (o **Hoja de Inscripción por partida** en inscripciones antiguas) y muestra el **PDF** en la pestaña **Documento RPPC** del popup predio.

Instancia **Tijuana**: municipio RPPC `2`, localidad `1`, cookie en `/opt/catastro_tijuana_api/.runtime/rppc_cookie.txt`, API en puerto **9001** (`catastro-tijuana-api.service`).

### Arquitectura

| Capa | Rol |
|------|-----|
| **Visor** (`js/52-popup-rppc.js`) | Pestaña en popup; `fetch` con JWT SGC; PDF en iframe vía blob URL |
| **API SGC** (`routers/rppc.py`) | Proxy autenticado; cascada clave → unidad (XL) → folio; no expone cookie RPPC al navegador |
| **Backfill** (`services/rppc_backfill_masivo.py`) | Job interno: recorre `padron_2026` sin `folio_real` y persiste resultados |
| **RPPC externo** | WebAPI ASP.NET en `rppcweb.ebajacalifornia.gob.mx` |

**Autenticación RPPC:** sesión válida = cookie ASP.NET **`.AspNet.ApplicationCookie`** (login activo en portal enlace remoto). Copiar desde F12 → Application → Cookies tras iniciar sesión en el portal.

**Prioridad de cookie:**

1. **Recomendado:** `/opt/catastro_tijuana_api/.runtime/rppc_cookie.txt` (≥400 caracteres, incluye `.AspNet.ApplicationCookie`)
2. Respaldo: variable `RPPC_COOKIE` en `.env`

**Renovación automática:** `rppc_renovar_cookie.py` (Playwright) — **no usar en producción** hasta corregirlo (generaba cookies incompletas). Renovar manualmente desde F12 y reiniciar la API.

### Variables `.env` (API — no versionar)

| Variable | Uso |
|----------|-----|
| `RPPC_USUARIO` / `RPPC_PASSWORD` | Credenciales enlace remoto (Playwright / pruebas) |
| `RPPC_USUARIO_ID` | ID usuario RPPC para consultas (ej. Tijuana: `5526`) |
| `RPPC_MUNICIPIO_ID` / `RPPC_LOCALIDAD_ID` | Tijuana: `2` / `1` |
| `RPPC_COOKIE` | Cookie manual de respaldo |
| `RPPC_RUNTIME_COOKIE_FILE` | Ruta del archivo de cookie (default `.runtime/rppc_cookie.txt`) |
| `RPPC_BASE_URL`, `RPPC_SESSION_PATH`, `RPPC_SSL_*` | Portal y TLS legacy |

### Endpoints API (`/rppc/…`, JWT + permiso pestaña RPPC; backfill solo **admin**)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/diagnostico` | Cookie, `consultaInmuebles` rápida (`?rapido=1`) |
| `GET` | `/inmuebles/clave/{clave}` | Cascada clave / unidad / ubicación → folio |
| `GET` | `/inmuebles/unidad` | Búsqueda por LOCAL + manzana + colonia RPPC |
| `GET` | `/resolver/clave/{clave}` | Folio + partida + `pdf_url` (cache en padrón) |
| `GET` | `/resolver/folio/{folio}` | Igual por folio real |
| `GET` | `/movimientos/folio/{folio}` | Movimientos (`obtenerMovimientosLote`) |
| `GET` | `/pdf/clave/{clave}` · `/pdf/folio/{folio}` · `/pdf/partida/{partida}` | PDF registral |
| `POST` | `/precalcular/clave/{clave}` | Comparación titular en segundo plano |
| `GET` | `/backfill/resumen` | Conteos padrón (con folio / pendientes) — **admin** |
| `POST` | `/backfill/lote` | Inicia lote en background — **admin** |
| `GET` | `/backfill/estado` | Progreso del lote — **admin** |
| `POST` | `/backfill/detener` | Detiene tras la clave actual — **admin** |

Flujo típico visor: cascada inmuebles → folio → movimientos → partida → PDF (por `DOC_TRAMITE_ID` o hoja por partida).

### Backfill masivo `folio_real` (padrón completo Tijuana)

Persiste en `catalogos.padron_2026`: `folio_real`, `rppc_partida`, `rppc_doc_tramite_id`, PDF local opcional.

**Resumen del padrón:**

```bash
cd /opt/catastro_tijuana_api
./venv/bin/python3 scripts/rppc_backfill_masivo_tijuana.py --resumen
```

**Un lote manual (100 claves, solo folio — más rápido):**

```bash
./venv/bin/python3 scripts/rppc_backfill_masivo_tijuana.py --limite 100 --nivel folio --pausa 2
```

| `nivel` | Qué guarda |
|---------|------------|
| `folio` | Solo `folio_real` (recomendado fase 1) |
| `resolver` | Folio + partida + metadatos documento |
| `pdf` | Lo anterior + PDF en cache local |

**Timer systemd (automático, 4× día, 200 claves/lote por defecto):**

```bash
cd /opt/catastro_tijuana_api
sudo sed 's/\r$//' deploy/systemd/catastro-rppc-backfill.service | sudo tee /etc/systemd/system/catastro-rppc-backfill.service > /dev/null
sudo sed 's/\r$//' deploy/systemd/catastro-rppc-backfill.timer   | sudo tee /etc/systemd/system/catastro-rppc-backfill.timer   > /dev/null
sudo cp deploy/systemd/env.rppc-backfill.example .env.rppc-backfill   # opcional
sudo systemctl daemon-reload
sudo systemctl enable --now catastro-rppc-backfill.timer
systemctl list-timers catastro-rppc-backfill.timer
```

Lanzar un lote **sin bloquear la terminal** (200 claves pueden tardar horas):

```bash
sudo systemctl start --no-block catastro-rppc-backfill.service
sudo journalctl -u catastro-rppc-backfill -f
```

Bitácora: `.runtime/rppc_backfill.jsonl` · Lock: `.runtime/rppc_backfill.lock`

Ajuste de lote en `.env.rppc-backfill`: `RPPC_BACKFILL_LIMITE`, `RPPC_BACKFILL_PAUSA`, `RPPC_BACKFILL_NIVEL`.

### Operación en servidor (Tijuana)

```bash
# Cookie RPPC (tras login en portal, F12)
sudo tee /opt/catastro_tijuana_api/.runtime/rppc_cookie.txt > /dev/null << 'EOF'
...cookie completa...
EOF
sudo chmod 600 /opt/catastro_tijuana_api/.runtime/rppc_cookie.txt
sudo systemctl restart catastro-tijuana-api

# Diagnóstico
TOKEN=$(curl -s -X POST http://127.0.0.1:9001/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","password":"admin123","tipo_sesion":"servicio"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s "http://127.0.0.1:9001/rppc/diagnostico?rapido=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Despliegue archivos RPPC / backfill

Subir a `/opt/catastro_tijuana_api/`:

| Ruta | Cuándo |
|------|--------|
| `routers/rppc.py` | Lógica RPPC, resolver, backfill API |
| `services/__init__.py`, `services/rppc_backfill_masivo.py` | Job backfill |
| `scripts/rppc_backfill_masivo_tijuana.py` | CLI |
| `deploy/systemd/*` | Timer (solo servidor) |

Visor: `js/52-popup-rppc.js`, `js/05-modulos-portal.js`, `index.html` → `/var/www/catastro_tijuana/` + **Ctrl+F5**.

### Validación rápida

- `diagnostico?rapido=1` → `ok: true`, cookie `valida: true`
- Clave unidad (ej. `XL701261`) → folio en pestaña RPPC + PDF
- `scripts/rppc_backfill_masivo_tijuana.py --resumen` → `con_folio` incrementa tras lotes

**Archivos clave:** `routers/rppc.py`, `services/rppc_backfill_masivo.py`, `scripts/rppc_backfill_masivo_tijuana.py`, `js/52-popup-rppc.js`, `.runtime/rppc_cookie.txt`.

---

## Integración RPPC — sección histórica (jun 2026)

<details>
<summary>Texto anterior (Mexicali / referencia)</summary>

Consulta al RPPC desde el visor con proxy FastAPI. Endpoints legacy en puerto 9000 / `/opt/catastro_api`. Ver sección **Integración RPPC — Documento registral (jul 2026)** arriba para Tijuana.

</details>

---

## Estado anterior visor (13 jun 2026)

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
- [x] Timer systemd backfill RPPC (`deploy/systemd/catastro-rppc-backfill.timer`) — jul 2026
- [ ] Corregir `rppc_renovar_cookie.py` (cookie completa con `.AspNet.ApplicationCookie`)
- [ ] Cron o timer para renovación manual documentada de cookie RPPC
- [ ] Despliegue permanente del endpoint carta urbana en API si aún no está en todos los entornos
- [ ] Revisar consulta WFS construcciones (`construccionesmxli`) — timeout GeoServer en algunas claves
- [ ] Integrar herramientas del panel de trabajo en fichas del predio según privilegios
- [ ] Optimizar cascada unidad XL (tiempo de respuesta en claves condominio)

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

**Tijuana (producción actual):**

```text
/opt/catastro_tijuana_api
catastro-tijuana-api.service  →  uvicorn main:app --host 0.0.0.0 --port 9001
/var/www/catastro_tijuana/    →  visor web
```

**Referencia histórica Mexicali:**

```bash
/opt/catastro_api/venv/bin/python3 ... uvicorn main:app --host 0.0.0.0 --port 9000
catastro-api.service
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