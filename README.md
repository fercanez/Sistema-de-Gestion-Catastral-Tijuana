# Sistema de Gestión Catastral Base en Baja California

## Descripción

Sistema de Gestión Catastral orientado al ámbito municipal en Baja California, diseñado para integrar y administrar información catastral, padrón predial y cartografía dentro de una plataforma web centralizada.

El sistema está concebido como una base funcional para un catastro municipal completo, con capacidades de consulta, homologación, análisis de información territorial, generación de reportes y visualización geográfica.

## Objetivo del proyecto

El objetivo principal del proyecto es construir un sistema integral de gestión catastral municipal con capacidad para:

- realizar consultas entre padrón y cartografía
- validar información homologada entre distintas fuentes
- generar reportes
- mostrar información geográfica
- facilitar la posible generación de mapas
- apoyar procesos de limpieza, catalogación y organización de datos catastrales

## Stack tecnológico

### Backend
- **Python**
- **FastAPI**
- **Uvicorn**

### Frontend
- **HTML**
- **CSS**
- **JavaScript**

### Base de datos
- **PostgreSQL**

### Infraestructura
- **Servidor Linux**
- **systemd** para administración del servicio
- **GeoNode v5** como parte del entorno operativo geoespacial

## Arquitectura general

La aplicación expone una API catastral construida con FastAPI y organizada por módulos o routers funcionales.

Actualmente se identifican componentes para:

- autenticación
- movimientos
- movimientos heredados o legacy
- padrón
- expediente
- administración
- propietarios
- catálogos

Además, el sistema se complementa con archivos cartográficos, documentos PDF, tablas auxiliares y otros insumos necesarios para la operación catastral.

## Estructura general del proyecto

La estructura actual del repositorio incluye componentes como:

- `auth/`: autenticación y control de acceso
- `routers/`: rutas principales del sistema
- `scripts/`: utilerías y procesos auxiliares
- `catalogos/`: catálogos de referencia y homologación
- `main.py`: punto de entrada principal de la API
- `config.py`: configuración del sistema
- `database.py`: conexión y utilidades de base de datos
- `index.html`: interfaz base
- archivos cartográficos (`.shp`, `.dbf`, `.prj`, `.shx`, `.cpg`)
- archivos documentales y de apoyo (`.pdf`, `.xlsx`, etc.)

## Módulos identificados en la API

Con base en la estructura actual del proyecto, la API registra routers para módulos como:

- autenticación
- movimientos
- movimientos legacy
- padrón
- expediente
- administración
- propietarios
- catálogos

Esto permite una arquitectura modular y facilita la evolución progresiva del sistema.

## Visor web

El sistema también incluye un visor web expuesto mediante la ruta:

```text
/visor
```

Desde esta ruta se sirven recursos estáticos y archivos de interfaz como:

- `index.html`
- `catastro.css`
- `catastro.js`
- `movimientos_padron_v57.js`
- `logomxli.png`

Esto indica que el proyecto no solo expone una API, sino también una parte visual para consulta e interacción.

## Variables de entorno

El sistema requiere un archivo `.env` con variables como las siguientes:

```env
SECRET_KEY=coloca_aqui_una_clave_segura
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

DB_HOST=localhost
DB_PORT=5432
DB_NAME=nombre_bd
DB_USER=usuario
DB_PASSWORD=contrasena
```

> Importante: la API no arranca si `SECRET_KEY` no está definida de forma segura.

## Instalación

Crear entorno virtual e instalar dependencias:

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Ejecución local

Para iniciar la aplicación de forma local:

```bash
uvicorn main:app --host 0.0.0.0 --port 9000
```

## Despliegue en servidor

La aplicación se ejecuta en un servidor Linux como un servicio administrado con `systemd`.

### Servicio del sistema
```bash
catastro-api.service
```

### Ejemplo de ejecución observada
```bash
/opt/catastro_api/venv/bin/python3 /opt/catastro_api/venv/bin/uvicorn main:app --host 0.0.0.0 --port 9000
```

### Características del despliegue actual
- servicio activo en Linux mediante `systemd`
- entorno virtual ubicado en `/opt/catastro_api/venv`
- API expuesta en el puerto `9000`
- operación integrada dentro de un entorno con GeoNode v5

## Capacidades funcionales del sistema

Entre las capacidades previstas o ya incorporadas dentro del proyecto se encuentran:

- consulta de información catastral
- cruce de información entre padrón y cartografía
- homologación de registros y claves
- consulta de expedientes
- administración de catálogos
- gestión de propietarios
- manejo de movimientos
- soporte para procesos de análisis, limpieza y catalogación
- generación de reportes
- base para visualización geográfica

## Estado actual del proyecto

Proyecto en desarrollo y consolidación.

Actualmente se encuentra en una etapa de integración funcional, documentación y organización del repositorio, con enfoque en construir una base robusta para un sistema catastral municipal completo.

## Próximas líneas de trabajo

- fortalecer la homologación entre padrón y cartografía
- documentar con mayor detalle cada módulo
- mejorar la organización del repositorio
- separar con mayor claridad código, datos y documentos
- formalizar la generación de reportes y mapas
- ampliar procesos de limpieza y catalogación de información
- documentar endpoints y flujos operativos

## Uso previsto

Sistema orientado principalmente a uso técnico, administrativo e institucional dentro de procesos de gestión catastral municipal.

## Autor

Proyecto gestionado por `fercanez`.