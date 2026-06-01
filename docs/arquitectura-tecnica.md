# Arquitectura técnica del sistema

## Visión general

El Sistema de Gestión Catastral Base en Baja California está implementado como una aplicación web/API orientada a operación institucional catastral, con arquitectura modular sobre Python.

La solución combina:

- backend API con FastAPI
- servidor ASGI con Uvicorn
- despliegue en Linux
- servicio administrado con systemd
- base de datos PostgreSQL
- integración con GeoNode v5
- recursos estáticos para visor web
- organización modular por routers

---

## Stack técnico identificado

### Backend
- Python
- FastAPI
- Uvicorn

### Base de datos
- PostgreSQL
- acceso mediante `psycopg2`
- cursores tipo `RealDictCursor`

### Configuración
- variables de entorno mediante `.env`
- carga con `python-dotenv`

### Seguridad
- JWT
- `python-jose`
- `passlib` con `bcrypt`
- OAuth2 Bearer Token en FastAPI

### Frontend/visor
- HTML
- CSS
- JavaScript
- archivos estáticos servidos por FastAPI

### Infraestructura
- Linux
- `systemd`
- entorno virtual Python
- GeoNode v5

---

## Punto de entrada de la aplicación

El punto de entrada principal es:

```python
main.py
```

La aplicación FastAPI se declara como:

```python
app = FastAPI(
    title="API Sistema de Gestion Catastral BC",
    version="0.4.3",
    root_path="/api/catastro",
)
```

### Implicaciones técnicas

- la aplicación está pensada para publicarse detrás de un prefijo
- el prefijo configurado es `/api/catastro`
- la documentación automática de FastAPI probablemente se publica bajo ese contexto
- las rutas del backend no necesariamente viven en `/` a nivel de proxy externo

---

## Ejecución de la aplicación

En el entorno observado, la aplicación corre mediante:

```bash
uvicorn main:app --host 0.0.0.0 --port 9000
```

Y específicamente en producción se observó una ejecución equivalente a:

```bash
/opt/catastro_api/venv/bin/python3 /opt/catastro_api/venv/bin/uvicorn main:app --host 0.0.0.0 --port 9000
```

---

## Despliegue en Linux

La aplicación se ejecuta como servicio persistente de `systemd`.

### Servicio detectado

```text
catastro-api.service
```

### Función del servicio

- iniciar la API al arrancar el sistema
- reiniciarla si falla
- mantenerla en ejecución persistente
- integrarla al entorno del servidor Linux

---

## Estructura modular del backend

La aplicación registra routers desde `main.py`:

- `auth.routes`
- `routers.movimientos`
- `routers.movimientos_legacy`
- `routers.padron`
- `routers.expediente`
- `routers.admin`
- `routers.propietarios`
- `routers.catalogos`

### Interpretación técnica

La API está organizada por dominios funcionales, lo cual aporta:

- separación de responsabilidades
- mantenimiento más sencillo
- crecimiento modular
- documentación progresiva por subsistema

---

## Módulos técnicos identificados

### 1. `auth`
Responsable de:
- autenticación
- dependencias de seguridad
- ACL backend
- modelos de login
- validación de permisos

Archivos observados:
- `auth/__init__.py`
- `auth/acl.py`
- `auth/dependencies.py`
- `auth/models.py`
- `auth/routes.py`

---

### 2. `routers/movimientos.py`
Responsable de:
- CRUD de movimientos catastrales
- transición de estados
- aplicación de cambios al padrón
- auditoría de aplicación
- propagación a estructuras relacionadas

---

### 3. `routers/movimientos_legacy.py`
Responsable de:
- endpoints legacy de titularidad
- compatibilidad con versiones anteriores
- rutas históricas de aplicación

---

### 4. `routers/padron.py`
Responsable de:
- consulta del padrón
- ficha predial
- GeoJSON
- zonas homogéneas
- clasificación de condominio
- operaciones masivas de régimen y tenencia
- búsquedas espaciales y de proximidad

---

### 5. `routers/propietarios.py`
Responsable de:
- catálogo de personas
- relaciones propietario-predio
- sincronización padrón-catálogo
- clasificación de condominio
- auditoría simple
- mantenimiento de domicilio

---

### 6. `routers/expediente.py`
Responsable de:
- expediente integral
- documentos
- dashboards
- control cartográfico
- cambios geométricos
- respuestas GeoJSON
- acceso a archivos documentales

---

### 7. `routers/catalogos.py`
Responsable de:
- mantenimiento de calles
- mantenimiento de colonias
- fusiones de registros
- actualización de referencias en padrón y personas

---

### 8. `routers/admin.py`
Responsable de:
- auditoría administrativa
- usuarios
- roles
- reset de contraseñas
- operaciones de administración del sistema

---

## Configuración centralizada

El archivo:

```python
config.py
```

carga variables de entorno mediante:

```python
from dotenv import load_dotenv
load_dotenv()
```

### Variables observadas

- `SECRET_KEY`
- `JWT_ALGORITHM`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

### Comportamiento importante

La aplicación **no arranca** si `SECRET_KEY`:
- no existe
- está vacía
- conserva el valor inseguro de ejemplo

Esto es una buena práctica porque evita despliegues inseguros por accidente.

---

## Acceso a base de datos

El archivo `database.py` centraliza la conexión a PostgreSQL mediante `psycopg2`.

### Función principal detectada

```python
def get_conn():
    return psycopg2.connect(...)
```

### Características técnicas

- conexión directa con PostgreSQL
- uso de `RealDictCursor`
- consultas SQL escritas manualmente
- fuerte dependencia en vistas, tablas y esquemas ya definidos

### Implicación arquitectónica

La solución sigue un enfoque de acceso a datos basado en:

- SQL explícito
- control manual de consultas
- mínimo nivel de abstracción ORM
- uso intensivo de vistas/materialización lógica del lado de base de datos

---

## Estructura de datos por esquemas

Del código revisado se identifican al menos estos esquemas lógicos:

### `seguridad`
Ejemplos:
- `seguridad.usuarios`
- `seguridad.roles`
- `seguridad.usuario_roles`
- `seguridad.auditoria_login`
- `seguridad.auditoria_sistema`

### `catalogos`
Ejemplos:
- `catalogos.padron_2026`
- `catalogos.personas`
- `catalogos.cat_calles`
- `catalogos.cat_colonias`
- `catalogos.cat_tipos_movimiento_padron`

### `catastro`
Ejemplos:
- `catastro.predios`
- `catastro.predio_propietario`
- `catastro.predio_condominio`
- `catastro.movimientos_padron`
- `catastro.movimientos_padron_detalle`
- `catastro.relaciones_prediales`
- `catastro.v_expediente_integral`
- `catastro.v_control_cartografico`
- `catastro.v_ficha_predial`

### `auditoria`
Ejemplos:
- `auditoria.movimientos_padron_auditoria`
- `auditoria.cambios_geometricos_predios`
- `auditoria.v_expedientes_timeline`

### Lectura técnica
La base de datos ya está separada por dominios:
- seguridad
- datos de catálogo
- operación catastral
- auditoría

Eso es una señal de madurez en diseño institucional.

---

## Estrategia de seguridad

### Autenticación
El sistema usa JWT firmado con `SECRET_KEY`.

### Autorización
Se usan dos estrategias:

1. control por rol
2. control por permiso funcional

### Componentes observados
- `OAuth2PasswordBearer`
- `jwt.encode / jwt.decode`
- `require_role(...)`
- `requerir_roles(...)`
- `requerir_permiso(...)`

### ACL backend
Existe una matriz de permisos en `auth/acl.py` para roles como:
- admin
- supervisor
- cartografia
- catastro
- fiscalizacion
- consulta

Esto permite proteger rutas según capacidad funcional y no solo por identidad.

---

## Manejo de contraseñas

El sistema utiliza `passlib` con:

```python
CryptContext(schemes=["bcrypt"], deprecated="auto")
```

### Implicación
Las contraseñas no se almacenan en texto plano, sino como hash seguro.

---

## Recursos estáticos y visor web

La aplicación también sirve contenido estático desde:

```python
VISOR_DIR = "/var/www/catastro"
```

### Rutas observadas
- `/visor/`
- `/visor/catastro.css`
- `/visor/catastro.js`
- `/visor/movimientos_padron_v57.js`
- `/visor/logomxli.png`

Y además monta:

```python
app.mount("/visor", StaticFiles(directory=VISOR_DIR, html=True), name="visor")
```

### Interpretación técnica

La misma aplicación FastAPI:
- expone la API
- sirve interfaz estática
- entrega archivos del visor web

Esto simplifica el despliegue al concentrar backend y visor en una sola app publicada.

---

## Manejo documental

En `routers/expediente.py` se observa acceso a documentos físicos desde:

```text
/var/www/catastro/documentos
```

### Protección técnica observada
Se valida la ruta resuelta con `os.path.realpath(...)` para evitar:
- `..`
- symlinks maliciosos
- path traversal

Esto es una medida importante de seguridad para publicación de archivos.

---

## Componentes geoespaciales

La arquitectura técnica incorpora una dimensión geoespacial importante.

### Indicadores observados
- uso de geometrías
- transformación a EPSG:4326
- salida GeoJSON
- consultas espaciales
- cambios geométricos
- control cartográfico
- integración con GeoNode v5

### Lectura técnica
La solución mezcla:
- backend transaccional
- consulta alfanumérica
- consulta espacial
- representación geográfica

Esto la convierte en una plataforma híbrida entre sistema administrativo y sistema geoespacial.

---

## Enfoque de lógica de negocio

La lógica de negocio está distribuida principalmente en:

- routers
- helpers auxiliares
- funciones de apoyo por dominio

Ejemplos:
- `movimientos_aplicar_helpers.py`
- funciones auxiliares en `padron.py`
- funciones auxiliares en `propietarios.py`

### Implicación técnica
El código actual parece privilegiar:
- rapidez de implementación
- control detallado del SQL
- lógica encapsulada por módulo
- reutilización mediante helpers internos

---

## Versionado interno de lógica

Se observan versiones internas explícitas en algunos componentes, por ejemplo:

- `APLICAR_PADRON_VERSION = "20260530_v57e"`
- nombres como `v27g`, `v27h`, `v27i`, `v28`

### Interpretación
El sistema ha evolucionado por iteraciones funcionales sucesivas, manteniendo compatibilidad o trazabilidad informal por versión.

Esto es útil operativamente, aunque a futuro convendría:
- centralizar changelog técnico
- reducir rutas legacy cuando ya no se usen
- documentar vigencia de versiones internas

---

## Arranque y migraciones ligeras

En `main.py` se observa un evento de arranque:

```python
@app.on_event("startup")
def startup_migraciones():
    ...
```

### Función observada
Al iniciar, intenta asegurar la existencia/estructura de:

- `catastro.predio_condominio`

### Lectura técnica
La aplicación implementa pequeñas migraciones o validaciones estructurales al arranque, al menos para ciertos componentes.

Esto puede ser útil para cambios menores, aunque para evolución futura podría convenir un mecanismo formal de migraciones.

---

## Dependencias identificadas por código

A partir del código compartido, además de las ya documentadas en `requirements.txt`, también se observan dependencias implícitas como:

- `python-jose`
- `passlib`
- `bcrypt`
- `pydantic`

Si estas no están todavía en `requirements.txt`, convendría revisarlas y agregarlas si el proyecto depende de ellas en instalación limpia.

---

## Observaciones técnicas sobre el estado actual

### Fortalezas
- arquitectura modular por dominio
- separación funcional razonable
- uso de JWT y hashing de contraseñas
- control de roles y permisos
- integración alfanumérica + espacial
- despliegue ya operativo en Linux
- auditoría presente
- uso de PostgreSQL con esquemas diferenciados

### Posibles áreas de mejora
- formalizar migraciones de base de datos
- separar mejor lógica de negocio de routers en algunos módulos grandes
- consolidar endpoints legacy
- ampliar documentación técnica de tablas y vistas
- revisar y completar dependencias instalables
- agregar pruebas automatizadas si aún no existen
- aislar scripts auxiliares o de parcheo fuera de rutas productivas

---

## Riesgos técnicos potenciales

### 1. Routers demasiado grandes
Archivos como `padron.py`, `propietarios.py` y `movimientos.py` parecen concentrar mucha lógica.

Riesgo:
- mantenimiento complejo
- mayor dificultad para pruebas unitarias
- riesgo de regresiones

### 2. Dependencia fuerte de SQL manual
Esto da control, pero también puede incrementar:
- complejidad de mantenimiento
- duplicación de lógica SQL
- dificultad para refactors

### 3. Persistencia de rutas legacy
Los endpoints legacy son útiles para compatibilidad, pero a largo plazo pueden:
- aumentar deuda técnica
- duplicar reglas de negocio
- confundir integraciones nuevas

### 4. Dependencia en vistas/tablas externas
Mucho comportamiento depende de que la base de datos institucional exista con nombres y estructuras concretas.

Riesgo:
- poca portabilidad
- mayor complejidad para replicar ambientes

---

## Recomendaciones técnicas futuras

### Corto plazo
- revisar `requirements.txt` completo
- documentar dependencias reales
- aislar scripts auxiliares no productivos
- agregar inventario de endpoints confirmados
- documentar tablas/vistas críticas

### Mediano plazo
- dividir módulos muy grandes
- extraer servicios o capas de negocio
- formalizar migraciones
- definir estrategia de pruebas

### Largo plazo
- generar arquitectura técnica por capas
- documentar dependencias con GeoNode/PostgreSQL/PostGIS
- establecer proceso de versionado más formal
- consolidar módulos legacy

---

## Resumen técnico

Desde el punto de vista técnico, el sistema está construido como una API modular de FastAPI con despliegue productivo en Linux, autenticación JWT, base PostgreSQL y capacidades geoespaciales integradas.

Los principales pilares técnicos son:

- FastAPI como framework principal
- Uvicorn como servidor de aplicación
- PostgreSQL como base de datos operativa
- SQL manual como estrategia de acceso a datos
- JWT + roles/permisos para seguridad
- módulos especializados por dominio
- GeoNode y geometría como soporte espacial
- visor estático servido por la misma aplicación

Esto lo convierte en una base técnica sólida para un sistema catastral institucional, aunque con oportunidades claras de maduración en documentación, modularización y mantenibilidad.