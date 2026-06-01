# Permisos y roles

## Propósito

Este documento describe el esquema de autorización identificado en el Sistema de Gestión Catastral BC, con base en el código revisado y en la estructura funcional observada.

Su objetivo es explicar:

- qué roles existen
- cómo se usan los permisos
- qué controles de acceso aplica el backend
- cómo interpretar la seguridad funcional del sistema

No sustituye una matriz final exhaustiva rol -> endpoint -> acción, pero sí establece la base conceptual y operativa del modelo de acceso.

---

## Enfoque general

El sistema implementa seguridad en dos niveles complementarios:

1. **autenticación**
2. **autorización**

### Autenticación
Se realiza mediante:
- usuario y contraseña
- token JWT firmado
- esquema OAuth2 Bearer Token de FastAPI

### Autorización
Se realiza mediante:
- validación por rol
- validación por permiso funcional

Esto implica que no basta con estar autenticado: el usuario también debe tener capacidad funcional suficiente para ejecutar ciertas acciones.

---

## Componentes técnicos identificados

En el código se observaron mecanismos como:

- `OAuth2PasswordBearer`
- `jwt.encode(...)`
- `jwt.decode(...)`
- `require_role(...)`
- `requerir_roles(...)`
- `requerir_permiso(...)`

También se identificó una ACL backend en:

```text
auth/acl.py
```

Esto sugiere que el sistema mantiene una matriz de acceso centralizada o semcentralizada para asignar permisos por rol.

---

## Roles identificados

En el código/documentación se detectaron al menos los siguientes roles:

- `admin`
- `supervisor`
- `cartografia`
- `catastro`
- `fiscalizacion`
- `consulta`

---

## Interpretación funcional de roles

## 1. `admin`

### Perfil
Rol con mayor capacidad operativa y administrativa.

### Funciones esperadas
- administrar usuarios
- asignar roles
- restablecer contraseñas
- acceder a funciones administrativas
- consultar auditoría
- posiblemente autorizar o corregir operaciones sensibles

### Nivel de acceso
Muy alto.

### Riesgo
Debe asignarse con control estricto, ya que probablemente permite operar sobre seguridad y configuración funcional crítica.

---

## 2. `supervisor`

### Perfil
Rol orientado a revisión, autorización y control de calidad operativa.

### Funciones esperadas
- revisar movimientos
- autorizar o rechazar cambios
- consultar expedientes completos
- supervisar procesos institucionales
- acceder a información más amplia que un capturista o consultor

### Nivel de acceso
Alto, pero normalmente menor que `admin`.

---

## 3. `cartografia`

### Perfil
Rol especializado en componente territorial/geográfico.

### Funciones esperadas
- consultar información cartográfica
- revisar control cartográfico
- gestionar o validar cambios geométricos
- participar en flujos de expediente/cartografía
- validar consistencia espacial

### Nivel de acceso
Especializado.

### Observación
Este rol no necesariamente debe tener control administrativo de usuarios o seguridad, pero sí acceso extendido a información geográfica y técnica.

---

## 4. `catastro`

### Perfil
Rol operativo principal para procesos catastrales.

### Funciones esperadas
- consultar padrón
- trabajar con propietarios
- capturar movimientos
- consultar expedientes
- actualizar información operativa según permisos otorgados

### Nivel de acceso
Operativo alto dentro del dominio catastral.

### Observación
Es probable que este rol concentre gran parte del trabajo diario del sistema.

---

## 5. `fiscalizacion`

### Perfil
Rol orientado a revisión, análisis o consulta institucional con enfoque fiscal.

### Funciones esperadas
- consultar datos prediales
- revisar expedientes
- acceder a información útil para procesos de control, validación o fiscalización
- posiblemente consultar historial y documentos

### Nivel de acceso
Intermedio o especializado.

---

## 6. `consulta`

### Perfil
Rol de solo lectura o lectura restringida.

### Funciones esperadas
- consultar información predial
- visualizar expedientes o fichas según restricciones
- acceder a búsquedas y consulta general
- sin privilegios de cambio

### Nivel de acceso
Bajo o limitado a lectura.

---

## Modelo de control de acceso

El sistema parece usar una combinación de:

### 1. Restricción por autenticación
Ejemplo conceptual:
- solo usuarios autenticados pueden acceder a endpoints protegidos

### 2. Restricción por rol
Ejemplo conceptual:
- solo `admin` o `supervisor` pueden entrar a ciertas rutas administrativas o de revisión

### 3. Restricción por permiso funcional
Ejemplo conceptual:
- un usuario con determinado rol puede o no poder aplicar movimientos, aunque sí pueda consultarlos

---

## Ventajas del modelo actual

### 1. Mayor precisión
Permite distinguir entre:
- consultar
- capturar
- revisar
- autorizar
- administrar

### 2. Menor dependencia de un único rol “todopoderoso”
Evita que todo dependa solo de `admin`.

### 3. Flexibilidad institucional
Facilita adaptar permisos según responsabilidades reales del área.

### 4. Mejor trazabilidad
Al limitar funciones por rol y permiso, la auditoría gana contexto útil.

---

## Permisos funcionales esperables

Aunque no se listó una matriz final completa de permisos, por los módulos observados es razonable identificar permisos funcionales en categorías como:

### Seguridad y administración
- administrar usuarios
- asignar roles
- restablecer contraseñas
- consultar auditoría

### Padrón
- consultar padrón
- consultar ficha predial
- consultar GeoJSON
- actualizar datos prediales
- operar zonas homogéneas
- regularizar régimen o tenencia

### Propietarios
- consultar personas
- crear persona
- editar persona
- actualizar domicilio
- relacionar persona con predio
- fusionar duplicados

### Expediente
- consultar expediente integral
- consultar historial
- consultar documentos
- descargar documentos
- consultar control cartográfico

### Movimientos
- crear movimiento
- editar movimiento
- revisar movimiento
- autorizar movimiento
- rechazar movimiento
- aplicar movimiento
- consultar auditoría del movimiento

### Catálogos
- consultar calles
- editar calles
- consultar colonias
- editar colonias
- fusionar catálogos

---

## Relación rol -> capacidad funcional (interpretación inicial)

> Esta matriz es orientativa y debe confirmarse contra la ACL real.

| Rol | Consulta general | Edición operativa | Revisión/autorización | Administración |
|---|---|---:|---:|---:|
| `admin` | Sí | Sí | Sí | Sí |
| `supervisor` | Sí | Parcial/según permiso | Sí | Parcial |
| `cartografia` | Sí | Especializada | Parcial | No esperado |
| `catastro` | Sí | Sí | Parcial/según permiso | No esperado |
| `fiscalizacion` | Sí | Limitada | Limitada | No esperado |
| `consulta` | Sí | No esperado | No | No |

---

## Seguridad de autenticación

El sistema utiliza JWT firmado con `SECRET_KEY`.

### Implicaciones
- el token representa identidad autenticada
- el backend valida firma y vigencia
- el token se envía como Bearer Token
- el acceso a rutas protegidas depende de la autenticación válida

### Riesgos si se configura mal
- `SECRET_KEY` débil o expuesta
- tiempos de expiración inadecuados
- usuarios activos sin control adecuado
- permisos mal asignados

---

## Validaciones observadas

Del comportamiento descrito se infiere que el backend valida al menos:

- existencia del usuario
- estado activo del usuario
- coincidencia de contraseña
- roles asignados
- permiso suficiente para ciertas acciones
- token válido y decodificable

---

## Relación con auditoría

El modelo de permisos y roles tiene sentido en conjunto con auditoría.

Estructuras detectadas:
- `seguridad.auditoria_login`
- `seguridad.auditoria_sistema`
- `auditoria.movimientos_padron_auditoria`

### Valor
Permite responder preguntas como:
- quién ingresó
- quién capturó un movimiento
- quién aplicó un cambio
- quién administró usuarios
- qué operación se realizó y cuándo

---

## Recomendaciones futuras

### 1. Generar matriz formal rol -> permiso -> endpoint
Ejemplo:

| Módulo | Acción | Permiso | Roles autorizados |
|---|---|---|---|

### 2. Documentar permisos exactos definidos en `auth/acl.py`
Esto permitiría:
- alinear backend y documentación
- revisar inconsistencias
- facilitar auditoría funcional

### 3. Separar permisos de lectura, captura, autorización y administración
Especialmente en:
- movimientos
- propietarios
- expediente
- catálogos

### 4. Revisar periódicamente usuarios con rol `admin`
Para evitar sobrerrepresentación de privilegios.

### 5. Definir política de altas, bajas y cambios de roles
Idealmente:
- quién autoriza altas
- quién puede asignar roles
- quién revisa accesos inactivos
- cada cuánto se depuran permisos

---

## Resumen

El sistema implementa un modelo de seguridad robusto para operación institucional, basado en:

- autenticación con JWT
- control por roles
- control por permisos funcionales
- auditoría de accesos y acciones

Los roles identificados permiten distinguir entre:

- administración
- supervisión
- operación catastral
- análisis cartográfico
- fiscalización
- consulta

Este documento constituye una base inicial para evolucionar hacia una matriz formal de autorizaciones del sistema.