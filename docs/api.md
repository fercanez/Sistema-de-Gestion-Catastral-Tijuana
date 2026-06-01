# Documentación de API

## Base de la API

La aplicación está construida con **FastAPI** y se ejecuta con `uvicorn`.

En despliegue, la aplicación utiliza:

```text
root_path=/api/catastro
```

Por lo tanto, si existe un proxy o publicación bajo ese prefijo, las rutas pueden exponerse como:

```text
/api/catastro/...
```

## Autenticación

La API utiliza autenticación basada en **JWT Bearer Token**.

### Flujo general

1. El usuario inicia sesión mediante `POST /login`
2. La API responde con un `access_token`
3. Ese token debe enviarse en el encabezado:

```http
Authorization: Bearer <token>
```

### Roles identificados

Los roles observados en el sistema son:

- `admin`
- `supervisor`
- `cartografia`
- `catastro`
- `fiscalizacion`
- `consulta`

### Permisos de backend

La API maneja una matriz de permisos por rol, incluyendo capacidades como:

- `administrar_usuarios`
- `ver_auditoria`
- `editar_cartografia`
- `editar_catastro`
- `editar_fiscal`
- `ver_fiscal`
- `ver_expediente`
- `ver_documentos`
- `ver_dashboard`
- `exportar_pdf`
- `exportar_excel`
- `consulta`

---

## Endpoints de autenticación

### `POST /login`

Inicia sesión y devuelve token JWT.

#### Body
```json
{
  "usuario": "usuario",
  "password": "contrasena"
}
```

#### Respuesta esperada
```json
{
  "access_token": "token",
  "token_type": "bearer",
  "usuario": "usuario",
  "nombre": "Nombre Completo",
  "rol": "admin",
  "permisos": [],
  "expira_minutos": 480
}
```

#### Errores posibles
- `400`: usuario o contraseña vacíos
- `401`: usuario no encontrado, contraseña incorrecta o usuario inactivo
- `500`: error interno

---

### `GET /me`

Devuelve información del usuario autenticado.

#### Requiere autenticación
Sí

#### Respuesta
```json
{
  "autenticado": true,
  "usuario": "usuario",
  "nombre": "Nombre Completo",
  "rol": "admin",
  "permisos": []
}
```

---

### `GET /seguridad/usuarios`

Lista usuarios del sistema.

#### Requiere rol
- `admin`

---

### `GET /seguridad/auditoria-login`

Consulta auditoría de inicios de sesión.

#### Query params
- `limite` (default: `100`, min: `1`, max: `1000`)

#### Requiere rol
- `admin`

---

### `GET /seguridad/permisos`

Devuelve permisos del usuario autenticado y la matriz global de permisos.

#### Requiere autenticación
Sí

---

### `GET /admin/permisos`

Devuelve matriz de permisos completa.

#### Requiere rol
- `admin`

---

### `GET /seguridad/probar-permiso/{permiso}`

Permite verificar si el usuario autenticado tiene un permiso específico.

#### Requiere autenticación
Sí

---

## Endpoints administrativos

## `GET /admin/auditoria`

Obtiene auditoría general del sistema.

#### Query params
- `limite` (default: `200`, min: `1`, max: `1000`)

#### Requiere rol
- `admin`

---

### `GET /admin/usuarios`

Obtiene listado de usuarios con roles agregados.

#### Requiere rol
- `admin`

---

### `GET /admin/roles`

Lista roles registrados en `seguridad.roles`.

#### Requiere rol
- `admin`

---

### `POST /admin/usuarios`

Crea un usuario nuevo.

#### Requiere rol
- `admin`

#### Body
```json
{
  "usuario": "nuevo_usuario",
  "nombre_completo": "Nombre Completo",
  "password": "contrasena",
  "rol": "consulta"
}
```

#### Errores posibles
- `400`: datos incompletos
- `409`: usuario ya existe

---

### `PUT /admin/usuarios/{usuario_id}`

Actualiza nombre, rol o estatus de un usuario.

#### Requiere rol
- `admin`

#### Body
```json
{
  "nombre_completo": "Nuevo Nombre",
  "rol": "admin",
  "activo": true
}
```

---

### `POST /admin/usuarios/{usuario_id}/reset-password`

Restablece contraseña de un usuario.

#### Requiere rol
- `admin`

#### Body
```json
{
  "password": "nueva_contrasena"
}
```

---

## Endpoints de movimientos

### Seguridad funcional

Los movimientos usan dos niveles principales:

- `permiso_movimientos`: roles `admin`, `supervisor`, `catastro`
- `permiso_aplicar_movimientos`: roles `admin`, `supervisor`

---

### `GET /movimientos/aplicar-version`

Devuelve la versión interna de la lógica de aplicación al padrón.

---

### `GET /movimientos/tipos`

Lista tipos de movimiento activos.

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

---

### `GET /movimientos`

Lista movimientos del padrón.

#### Query params
- `clave`
- `estado`
- `limite` (default `100`, max `500`)

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

---

### `GET /movimientos/{movimiento_id}`

Obtiene detalle de un movimiento, incluyendo:
- datos del movimiento
- detalle por campos
- auditoría relacionada

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

---

### `POST /movimientos`

Crea un movimiento nuevo.

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

#### Body base
```json
{
  "clave_catastral": "CLAVE",
  "clave_catastral_anterior": null,
  "clave_catastral_nueva": null,
  "tipo_movimiento": "CAMBIO_NOMBRE",
  "motivo": "Motivo",
  "observaciones": "Observaciones",
  "datos_anteriores": {},
  "datos_nuevos": {},
  "detalles": []
}
```

#### Estado inicial
- `BORRADOR`

---

### `PUT /movimientos/{movimiento_id}/estado`

Actualiza el estado del movimiento.

#### Requiere rol
- `admin`
- `supervisor`

#### Estados válidos
- `BORRADOR`
- `EN_REVISION`
- `OBSERVADO`
- `AUTORIZADO`
- `RECHAZADO`
- `APLICADO`
- `CANCELADO`

---

### `GET /movimientos/historial/{clave}`

Consulta historial de movimientos asociados a una clave catastral.

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

---

### `GET /movimientos/historial/{clave}/numero-oficial`

Consulta historial de cambios o asignaciones de número oficial.

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

---

### `GET /movimientos/copropietarios/{clave}`

Lista copropietarios asociados a una clave.

#### Requiere rol
- `admin`
- `supervisor`
- `catastro`

---

### `POST /movimientos/{movimiento_id}/aplicar`

Aplica un movimiento autorizado al padrón y/o estructuras relacionadas.

#### Requiere rol
- `admin`
- `supervisor`

#### Tipos de movimiento detectados con lógica de aplicación
- `CAMBIO_NOMBRE`
- `CAMBIO_TITULARIDAD`
- `CAMBIO_SUPERFICIE`
- `CAMBIO_CONSTRUCCION`
- `CAMBIO_USO_SUELO`
- `CAMBIO_ZONA_HOMOGENEA`
- `NUMERO_OFICIAL`
- `ASIGNACION_NUMERO_OFICIAL`
- `CAMBIO_NUMERO_OFICIAL`
- `CAMBIO_CLAVE`
- `BLOQUEO`
- `DESBLOQUEO`
- `BAJA_CLAVE`
- `ALTA_CLAVE`
- `SUBDIVISION`
- `FUSION`

#### Observaciones
Este endpoint también:
- registra auditoría
- actualiza estado a `APLICADO`
- puede sincronizar datos hacia `catalogos.padron_2026`
- puede propagar cambios a `catastro.predios`
- puede registrar relaciones prediales
- puede registrar información de condominio

---

## Endpoints legacy de movimientos

### `POST /movimientos/{movimiento_id}/aplicar-titularidad`
### `POST /movimientos/{movimiento_id}/aplicar-titularidad-v27g`
### `POST /movimientos/{movimiento_id}/aplicar-titularidad-v27h`
### `POST /movimientos/{movimiento_id}/aplicar-titularidad-v27i`

Endpoints conservados por compatibilidad para aplicar cambios de titularidad y RFC.

#### Requiere rol
- `admin`
- `supervisor`

#### Nota
Se consideran rutas legacy y conviene documentar su vigencia operativa antes de usarlas en nuevas integraciones.

---

## Endpoints de catálogos

Estos endpoints están orientados al mantenimiento institucional de calles y colonias.

#### Requieren permiso funcional
Usan `permiso_movimientos`, por lo que normalmente requieren:
- `admin`
- `supervisor`
- `catastro`

---

### Calles

#### `GET /catalogos/calles/mantenimiento/buscar`
Busca calles en catálogo y en padrón.

#### Query params
- `q`
- `limite`

---

#### `POST /catalogos/calles`
Crea o reactiva una calle.

#### Body
```json
{
  "nombre_calle": "NOMBRE DE CALLE"
}
```

---

#### `PUT /catalogos/calles/{id_calle}`
Actualiza nombre de calle y propaga cambios a padrón y personas.

---

#### `DELETE /catalogos/calles/{id_calle}`
Da de baja lógica una calle (`activo = FALSE`).

---

#### `POST /catalogos/calles/fusionar`
Fusiona varios registros de calle hacia uno destino.

#### Body
```json
{
  "id_destino": 1,
  "ids_origen": [2, 3]
}
```

---

### Colonias

#### `GET /catalogos/colonias/mantenimiento/buscar`
Busca colonias en catálogo y padrón.

#### Query params
- `q`
- `limite`

---

#### `POST /catalogos/colonias`
Crea o reactiva una colonia.

#### Body
```json
{
  "nombre_colonia": "NOMBRE DE COLONIA"
}
```

---

#### `PUT /catalogos/colonias/{id_colonia}`
Actualiza nombre de colonia y propaga cambios.

---

#### `DELETE /catalogos/colonias/{id_colonia}`
Da de baja lógica una colonia.

---

#### `POST /catalogos/colonias/fusionar`
Fusiona colonias origen hacia una colonia destino.

#### Body
```json
{
  "id_destino": 1,
  "ids_origen": [2, 3]
}
```

---

## Endpoints de expediente y control cartográfico

Todos estos endpoints usan autenticación con usuario actual.

### `GET /control-cartografico/estadisticas`

Resumen de control cartográfico:
- dibujados
- sin geometría
- no existe en cartografía
- total
- cobertura

---

### `GET /control-cartografico/sin-geometria`

Lista predios sin geometría.

#### Query params
- `limite` (default `100`, max `1000`)

---

### `GET /expediente/{clave}`

Devuelve expediente integral de una clave catastral en formato **GeoJSON Feature**:

```json
{
  "type": "Feature",
  "geometry": {},
  "properties": {}
}
```

Incluye información como:
- datos generales del predio
- titular principal
- adeudos
- superficies
- estado cartográfico
- indicadores documentales
- geometría transformada a EPSG:4326

---

### `GET /expediente/{clave}/historial`

Devuelve historial de expediente.

---

### `GET /expediente/{clave}/documentos`

Lista documentos asociados al expediente.

---

### `GET /documentos/{clave}/{archivo}`

Entrega archivo físico de documento.

#### Observación importante
Incluye protección contra **path traversal** validando que la ruta resuelta permanezca dentro de:

```text
/var/www/catastro/documentos
```

---

### `GET /cambios-geometricos`

Devuelve cambios geométricos en formato GeoJSON `FeatureCollection`.

---

### `GET /dashboard-cartografico`

Resumen ejecutivo cartográfico:
- total predios
- dibujados
- sin geometría
- cobertura
- cambios geométricos
- prioridad de revisión

---

### `GET /dashboard-fiscal`

Dashboard fiscal y documental con indicadores como:

- total de predios
- adeudo total
- adeudo anual
- valor catastral total
- superficies acumuladas
- cobertura cartográfica
- expedientes con o sin documentos
- top colonias con adeudo
- resumen por uso
- resumen por zona homogénea

---

## Módulos detectados pero pendientes de documentación detallada

### Padrón
Se identifican funcionalidades relacionadas con:

- búsqueda simple y avanzada
- ficha de padrón
- ficha predial
- GeoJSON de predio
- búsqueda geográfica
- usos y tasas
- zonas homogéneas
- importación y ajuste de zonas homogéneas
- teselas (`tile_predios`)
- resumen y aplicación de tenencia
- operaciones masivas sobre régimen/tenencia
- manejo de condominios

> Este módulo requiere una pasada adicional para documentar cada endpoint de forma individual.

### Propietarios
Se identifican capacidades como:

- mantenimiento de personas del catálogo
- búsqueda de propietarios
- apellidos, nombres y razones sociales
- mantenimiento y fusión de propietarios
- asociación propietario-predio
- sincronización padrón-catálogo
- clasificación de condominio
- reemplazo masivo de propietarios
- gestión de domicilio de personas

> Este módulo requiere una pasada adicional con el archivo completo para documentar rutas exactas, métodos HTTP y payloads.

---

## Recomendación de uso

Para exploración técnica en ambiente activo, complementar esta documentación con la interfaz automática de FastAPI:

- `/docs`
- `/redoc`

según la configuración final del despliegue y el prefijo publicado de la aplicación.