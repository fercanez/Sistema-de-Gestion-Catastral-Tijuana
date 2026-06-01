# Matriz ACL → endpoints (auditoría BT-003)

## Propósito

Este documento registra la **auditoría endpoint por endpoint** del control de acceso real del backend, contrastada con la matriz de permisos definida en `auth/acl.py`.

- **Fecha de auditoría:** 2026-06-01  
- **Versión API revisada:** `main.py` (FastAPI `0.4.3`, endpoint `/` reporta `0.4.4`)  
- **Alcance:** todos los routers activos en `main.py` + rutas de `main.py`

Complementa a `docs/permisos-y-roles.md` y cierra el análisis inicial del backlog **BT-003**.

---

## 1. Matriz ACL declarada (`auth/acl.py`)

Permisos por rol según código (fuente de verdad **documental**, no aplicada en routers):

| Permiso | admin | supervisor | cartografia | catastro | fiscalizacion | consulta |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `administrar_usuarios` | ✓ | | | | | |
| `ver_auditoria` | ✓ | ✓ | | | | |
| `editar_cartografia` | ✓ | ✓ | ✓ | | | |
| `editar_catastro` | ✓ | ✓ | | ✓ | | |
| `editar_fiscal` | ✓ | ✓ | | | ✓ | |
| `ver_fiscal` | ✓ | ✓ | | | ✓ | |
| `ver_expediente` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ver_documentos` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ver_dashboard` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `exportar_pdf` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `exportar_excel` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `consulta` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Hallazgo central:** la función `requerir_permiso()` existe en `auth/dependencies.py` pero **no se usa en ningún router**. La ACL no gobierna rutas HTTP.

---

## 2. Mecanismos de autorización en uso

| Mecanismo | Qué valida | Fuente del rol | Usado en |
|---|---|---|---|
| *(ninguno)* | Público | — | login, visor, tiles, documentos directos, versión movimientos |
| `obtener_usuario_actual` | Token JWT válido | Payload JWT (`usuarios.rol`) | padrón lectura, expediente |
| `requerir_roles(...)` | Rol JWT ∈ lista | Payload JWT | padrón escritura, auth admin |
| `require_role([...])` | Rol en `usuario_roles` | Tabla `seguridad.usuario_roles` | admin router |
| `permiso_movimientos` | Rol JWT ∈ {admin, supervisor, catastro} | Hardcodeado | movimientos, propietarios, catálogos |
| `permiso_aplicar_movimientos` | Rol JWT ∈ {admin, supervisor} | Hardcodeado | aplicar movimientos, cambiar estado |

### Riesgo estructural: dos fuentes de rol

- El **JWT** se firma con `seguridad.usuarios.rol` al hacer login.
- **`require_role()`** consulta `seguridad.usuario_roles` + `seguridad.roles`.
- Si esas fuentes divergen, un usuario puede pasar rutas JWT y fallar en admin (o viceversa).

---

## 3. Resumen por patrón de acceso

| Patrón | Endpoints | Roles efectivos (JWT) | Permiso ACL esperado |
|---|---:|---|---|
| Público | 9 | todos | — |
| Solo autenticado | 35 | los 6 roles | según acción (no diferenciado) |
| admin + supervisor + catastro | 52 | 3 roles | `editar_catastro` |
| admin + supervisor | 6 | 2 roles | autorización / aplicación |
| admin (JWT) | 3 | 1 rol | `administrar_usuarios` / `ver_auditoria` |
| admin (tabla roles) | 6 | 1 rol* | `administrar_usuarios` |

\* Depende de `usuario_roles`, no necesariamente del JWT.

---

## 4. Inventario de endpoints

Leyenda de columnas:

- **Control real:** mecanismo aplicado en código.
- **Roles OK:** roles que pasan la validación.
- **Permiso sugerido:** permiso ACL que debería aplicarse.
- **Estado:** `OK` coherente | `GAP` brecha vs ACL | `CRIT` riesgo de seguridad.

### 4.1 Sistema / visor (`main.py`)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| GET | `/` | Público | todos | — | OK (health) |
| GET | `/visor`, `/visor/*` | Público | todos | — | OK (estáticos) |

### 4.2 Autenticación (`auth/routes.py`)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| POST | `/login` | Público | todos | — | OK |
| GET | `/me` | JWT | 6 roles | — | OK |
| GET | `/seguridad/usuarios` | `requerir_roles("admin")` | admin | `administrar_usuarios` | GAP (duplica admin, fuente JWT) |
| GET | `/seguridad/auditoria-login` | `requerir_roles("admin")` | admin | `ver_auditoria` | GAP (no usa `requerir_permiso`) |
| GET | `/seguridad/permisos` | JWT | 6 roles | — | **CRIT** (expone matriz ACL completa a cualquier autenticado) |
| GET | `/admin/permisos` | `require_role(["admin"])` | admin* | `administrar_usuarios` | GAP |
| GET | `/seguridad/probar-permiso/{permiso}` | JWT | 6 roles | — | OK (utilidad de diagnóstico) |

### 4.3 Administración (`routers/admin.py`)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| GET | `/admin/auditoria` | `require_role(["admin"])` | admin* | `ver_auditoria` | GAP (supervisor tiene permiso ACL pero no acceso) |
| GET | `/admin/usuarios` | `require_role(["admin"])` | admin* | `administrar_usuarios` | OK |
| GET | `/admin/roles` | `require_role(["admin"])` | admin* | `administrar_usuarios` | OK |
| POST | `/admin/usuarios` | `require_role(["admin"])` | admin* | `administrar_usuarios` | OK |
| PUT | `/admin/usuarios/{id}` | `require_role(["admin"])` | admin* | `administrar_usuarios` | OK |
| POST | `/admin/usuarios/{id}/reset-password` | `require_role(["admin"])` | admin* | `administrar_usuarios` | OK |

### 4.4 Padrón (`routers/padron.py`)

#### Consulta predial (lectura)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| GET | `/padron/buscar` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/busqueda-avanzada` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/{clave}/ficha` | JWT | 6 roles | `consulta` | OK |
| GET | `/predios/{clave}/ficha` | JWT | 6 roles | `consulta` | OK |
| GET | `/predios/{clave}/geojson` | JWT | 6 roles | `consulta` + cartografía | OK |
| GET | `/predios/buscar` | JWT | 6 roles | `consulta` | OK |
| GET | `/predios/intersecta` | JWT | 6 roles | `consulta` | OK |
| GET | `/predios/cercanos` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/catalogo/usos-tasa` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/catalogo/zonas-homogeneas` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/condominios/tipos` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/condominios/resumen` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/condominios/catalogo` | JWT | 6 roles | `consulta` | OK |
| GET | `/padron/condominios/unidades` | JWT | 6 roles | `consulta` | OK |
| GET | `/tiles/predios/{z}/{x}/{y}.pbf` | **Público** | todos | `consulta` / cartografía | **CRIT** (geometría sin auth) |

#### Análisis zonas homogéneas

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| GET | `/padron/analisis/zonas-homogeneas/filtros` | JWT | 6 roles | `consulta` | GAP (lectura amplia) |
| GET | `/padron/analisis/zonas-homogeneas/plantilla.csv` | JWT | 6 roles | `editar_catastro` | GAP |
| GET | `/padron/analisis/zonas-homogeneas/evolucion` | JWT | 6 roles | `consulta` | GAP |
| PATCH | `/padron/analisis/zonas-homogeneas` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| POST | `/padron/analisis/zonas-homogeneas` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| POST | `/padron/analisis/zonas-homogeneas/importar` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| POST | `/padron/analisis/zonas-homogeneas/importar-archivo` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |

#### Tenencia y régimen (escritura masiva)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| PUT | `/padron/tenencia/masiva` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| GET | `/padron/tenencia/por-prefijo/resumen` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| PUT | `/padron/tenencia/por-prefijo` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| GET | `/padron/condominios/regimen-masivo/resumen` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| POST | `/padron/condominios/regimen-masivo` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| GET | `/padron/condominios/sin-dato-a-privado/resumen` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |
| POST | `/padron/condominios/sin-dato-a-privado` | roles JWT | admin, supervisor, catastro | `editar_catastro` | OK |

### 4.5 Expediente y documentos (`routers/expediente.py`)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| GET | `/expediente/{clave}` | JWT | 6 roles | `ver_expediente` | GAP (no usa permiso) |
| GET | `/expediente/{clave}/historial` | JWT | 6 roles | `ver_expediente` | GAP |
| GET | `/expediente/{clave}/documentos` | JWT | 6 roles | `ver_documentos` | GAP |
| GET | `/documentos/{clave}/{archivo}` | **Público** | todos | `ver_documentos` | **CRIT** (descarga sin auth) |
| GET | `/control-cartografico/estadisticas` | JWT | 6 roles | `editar_cartografia` | GAP (consulta accede) |
| GET | `/control-cartografico/sin-geometria` | JWT | 6 roles | `editar_cartografia` | GAP |
| GET | `/cambios-geometricos` | JWT | 6 roles | `editar_cartografia` | GAP |
| GET | `/dashboard-cartografico` | JWT | 6 roles | `editar_cartografia` / `ver_dashboard` | GAP |
| GET | `/dashboard-fiscal` | JWT | 6 roles | `ver_fiscal` | **CRIT** (consulta/cartografia acceden) |

### 4.6 Propietarios (`routers/propietarios.py`) — 27 rutas

**Todas** usan `permiso_movimientos` → solo **admin, supervisor, catastro**.

| Acción | Rutas (resumen) | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|
| Lectura | `GET /predios/{clave}/propietarios`, búsquedas, catálogos, desfase, condominio | 3 roles | `consulta` / `ver_expediente` | **CRIT** (rol `consulta` bloqueado) |
| Escritura | `POST/PUT/DELETE` personas, relaciones, fusión, sync padrón, tenencia, condominios | 3 roles | `editar_catastro` | GAP (cartografia/fiscalizacion bloqueados; coherente para escritura) |

Rutas afectadas (todas con el mismo control):

- `/propietarios/*`, `/predios/{clave}/propietarios*`, `/predios/{clave}/condominio`, `/predios/{clave}/tenencia`, `/condominios/*`

### 4.7 Movimientos (`routers/movimientos.py`)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| GET | `/movimientos/aplicar-version` | **Público** | todos | — | GAP (info de versión) |
| GET | `/movimientos/tipos` | permiso_mov | admin, supervisor, catastro | `editar_catastro` | GAP |
| GET | `/movimientos` | permiso_mov | 3 roles | `editar_catastro` | GAP |
| GET | `/movimientos/{id}` | permiso_mov | 3 roles | `editar_catastro` | GAP |
| POST | `/movimientos` | permiso_mov | 3 roles | `editar_catastro` | OK |
| PUT | `/movimientos/{id}/estado` | permiso_aplicar | admin, supervisor | autorización | OK |
| GET | `/movimientos/historial/{clave}` | permiso_mov | 3 roles | `consulta` / `ver_expediente` | GAP |
| GET | `/movimientos/historial/{clave}/numero-oficial` | permiso_mov | 3 roles | `consulta` | GAP |
| GET | `/movimientos/copropietarios/{clave}` | permiso_mov | 3 roles | `consulta` | GAP |
| POST | `/movimientos/{id}/aplicar` | permiso_aplicar | admin, supervisor | aplicación | OK |

### 4.8 Movimientos legacy (`routers/movimientos_legacy.py`)

| Método | Ruta | Control real | Roles OK | Permiso sugerido | Estado |
|---|---|---|---|---|---|
| POST | `/movimientos/{id}/aplicar-titularidad` | permiso_aplicar | admin, supervisor | aplicación | OK |
| POST | `/movimientos/{id}/aplicar-titularidad-v27g` | permiso_aplicar | admin, supervisor | aplicación | OK |
| POST | `/movimientos/{id}/aplicar-titularidad-v27h` | permiso_aplicar | admin, supervisor | aplicación | OK |
| POST | `/movimientos/{id}/aplicar-titularidad-v27i` | permiso_aplicar | admin, supervisor | aplicación | OK |

### 4.9 Catálogos (`routers/catalogos.py`) — 10 rutas

Todas usan `permiso_movimientos` (admin, supervisor, catastro). Mantenimiento de calles/colonias.

| Permiso sugerido | Estado |
|---|---|
| `editar_catastro` para escritura; `consulta` para búsqueda | GAP (lectura restringida a 3 roles) |

---

## 5. Matriz rol → capacidad real (síntesis)

Comparación entre **intención ACL** y **comportamiento real**:

| Rol | Padrón lectura | Expediente | Documentos | Propietarios | Movimientos | Catálogos mant. | Admin | Dashboard fiscal |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| admin | ✓ | ✓ | ✓* | ✓ | ✓ | ✓ | ✓* | ✓ |
| supervisor | ✓ | ✓ | ✓* | ✓ | ✓ (+ aplicar) | ✓ | ✗† | ✓ |
| cartografia | ✓ | ✓ | ✓* | ✗ | ✗ | ✗ | ✗ | ✓‡ |
| catastro | ✓ | ✓ | ✓* | ✓ | ✓ (sin aplicar) | ✓ | ✗ | ✓‡ |
| fiscalizacion | ✓ | ✓ | ✓* | ✗ | ✗ | ✗ | ✗ | ✓‡ |
| consulta | ✓ | ✓ | ✓* | ✗ | ✗ | ✗ | ✗ | ✓‡ |

\* Listado de documentos requiere JWT; **descarga directa** (`GET /documentos/...`) es pública.  
† Supervisor tiene `ver_auditoria` en ACL pero no accede a `/admin/auditoria`.  
‡ Dashboard fiscal/cartográfico accesible sin permiso fiscal/cartográfico específico.

---

## 6. Hallazgos priorizados

### CRIT — corregir pronto

| ID | Hallazgo | Endpoints | Acción sugerida | Estado |
|---|---|---|---|---|
| ACL-C01 | Descarga documental sin autenticación | `GET /documentos/{clave}/{archivo}` | Exigir JWT + `ver_documentos` | **Corregido** (2026-06-01) |
| ACL-C02 | Tiles cartográficos públicos | `GET /tiles/predios/{z}/{x}/{y}.pbf` | Exigir JWT o token de mapa | **Corregido** (2026-06-01) |
| ACL-C03 | Rol `consulta` no puede ver propietarios | `GET /predios/{clave}/propietarios` y búsquedas | Separar lectura (`consulta`) de escritura (`editar_catastro`) | **Corregido** (2026-06-01) |
| ACL-C04 | Dashboard fiscal abierto a todos los autenticados | `GET /dashboard-fiscal` | Aplicar `ver_fiscal` | **Corregido** (2026-06-01) |
| ACL-C05 | Matriz ACL expuesta a cualquier usuario | `GET /seguridad/permisos` | Restringir a admin o quitar `matriz` del response | **Corregido** (2026-06-01) |

### GAP — alinear con ACL

| ID | Hallazgo | Acción sugerida |
|---|---|---|
| ACL-G01 | `requerir_permiso()` no se usa | Migrar routers a permisos ACL |
| ACL-G02 | Dos fuentes de rol (JWT vs `usuario_roles`) | Unificar; refrescar JWT o validar siempre en BD |
| ACL-G03 | Duplicidad admin (`/seguridad/*` vs `/admin/*`) | Consolidar rutas y un solo mecanismo |
| ACL-G04 | Supervisor con `ver_auditoria` sin ruta | Permitir supervisor en auditoría o quitar permiso ACL |
| ACL-G05 | Cartografia/fiscalizacion sin acceso a movimientos/historial | Definir si deben consultar historial de movimientos |
| ACL-G06 | Lectura de catálogos calles/colonias restringida | GET con `consulta`; POST/PUT/DELETE con `editar_catastro` |

---

## 7. Mapa permiso ACL → endpoints objetivo

Propuesta de mapeo para la **fase de corrección** (BT-003 implementación):

| Permiso ACL | Endpoints que deberían exigirlo |
|---|---|
| `consulta` | Búsqueda padrón, ficha, geojson espacial de consulta, historial movimientos (solo lectura) |
| `ver_expediente` | `/expediente/{clave}`, `/expediente/{clave}/historial` |
| `ver_documentos` | `/expediente/{clave}/documentos`, `/documentos/{clave}/{archivo}` |
| `ver_fiscal` | `/dashboard-fiscal` |
| `editar_cartografia` | control cartográfico, cambios geométricos, dashboard cartográfico, tiles |
| `editar_catastro` | movimientos captura, propietarios escritura, catálogos mant., zonas ZH escritura, tenencia masiva |
| `editar_fiscal` | *(sin endpoint dedicado hoy; dashboard fiscal usa lectura)* |
| `ver_auditoria` | `/admin/auditoria`, `/seguridad/auditoria-login` (admin + supervisor) |
| `administrar_usuarios` | todas las rutas `/admin/usuarios*`, `/admin/roles` |

**Regla de autorización/aplicación de movimientos** (mantener lógica actual, formalizar):

- Captura/edición: `editar_catastro`
- Cambio de estado / aplicar: rol supervisor o admin (equivalente a permiso operativo de autorización, hoy no modelado en ACL)

---

## 8. Conteo de endpoints

| Módulo | Total | Públicos | JWT genérico | Restringidos |
|---|:---:|:---:|:---:|:---:|
| main / visor | 8 | 8 | 0 | 0 |
| auth | 7 | 1 | 3 | 3 |
| admin | 6 | 0 | 0 | 6 |
| padron | 29 | 1 | 17 | 11 |
| expediente | 9 | 1 | 8 | 0 |
| propietarios | 27 | 0 | 0 | 27 |
| movimientos | 10 | 1 | 0 | 9 |
| movimientos legacy | 4 | 0 | 0 | 4 |
| catálogos | 10 | 0 | 0 | 10 |
| **Total** | **110** | **12** | **28** | **70** |

---

## 9. Próximos pasos recomendados

1. **Corregir CRIT** (ACL-C01 a ACL-C05) en código — impacto inmediato en seguridad.
2. **Introducir `requerir_permiso()`** en expediente y padrón lectura (bajo riesgo, alto alineamiento).
3. **Refactor propietarios:** dependencia `permiso_propietarios_lectura` vs `permiso_propietarios_escritura`.
4. **Unificar fuente de rol** en login y dependencias.
5. **Agregar pruebas** que validen matriz por rol (BT-019).

---

## 10. Referencias

- Código ACL: `auth/acl.py`
- Dependencias: `auth/dependencies.py`
- Backlog: BT-003, BT-004 en `docs/backlog-tecnico.md`
- Permisos conceptuales: `docs/permisos-y-roles.md`
