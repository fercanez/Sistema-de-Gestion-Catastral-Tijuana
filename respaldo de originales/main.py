from typing import Optional
import os
import json
import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Depends, status
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from datetime import datetime, timedelta
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer
from fastapi import Security
from passlib.context import CryptContext

load_dotenv()

# ============================================================
# SEGURIDAD INSTITUCIONAL - JWT / ROLES
# ============================================================
SECRET_KEY = os.getenv("SECRET_KEY", "CATASTRO_BC_2026_CAMBIAR_EN_PRODUCCION")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
def obtener_roles_usuario(usuario_id, conn):
    cur = conn.cursor()

    cur.execute("""
        SELECT r.nombre
        FROM seguridad.usuario_roles ur
        JOIN seguridad.roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = %s
    """, (usuario_id,))

    rows = cur.fetchall()

    return [r["nombre"] for r in rows]


def registrar_auditoria(usuario, accion, modulo="", detalle="", ip=""):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            INSERT INTO seguridad.auditoria_sistema
            (usuario, accion, modulo, detalle, ip)
            VALUES (%s,%s,%s,%s,%s)
        """, (
            usuario,
            accion,
            modulo,
            detalle,
            ip
        ))

        conn.commit()

        cur.close()
        conn.close()

    except Exception as e:
        print("Error auditoría:", e)


def require_role(roles_permitidos: list):

    async def verifier(token: str = Security(oauth2_scheme)):

        credentials_exception = HTTPException(
            status_code=401,
            detail="No autorizado"
        )

        try:
            payload = jwt.decode(
                token,
                SECRET_KEY,
                algorithms=[ALGORITHM]
            )

            usuario = payload.get("sub")

            if usuario is None:
                raise credentials_exception

        except JWTError:
            raise credentials_exception

        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, usuario
            FROM seguridad.usuarios
            WHERE usuario = %s
            AND activo = TRUE
        """, (usuario,))

        user = cur.fetchone()

        if not user:
            raise credentials_exception

        usuario_id = user["id"]

        roles = obtener_roles_usuario(usuario_id, conn)

        cur.close()
        conn.close()

        autorizado = any(
            r in roles
            for r in roles_permitidos
        )

        if not autorizado:
            raise HTTPException(
                status_code=403,
                detail="Permisos insuficientes"
            )

        return {
            "usuario": usuario,
            "roles": roles
        }

    return verifier

class LoginRequest(BaseModel):
    usuario: str
    password: str


class UsuarioNuevo(BaseModel):
    usuario: str
    nombre_completo: str
    password: str
    rol: str = "consulta"


class UsuarioActualizar(BaseModel):
    nombre_completo: str | None = None
    rol: str | None = None
    activo: bool | None = None


class PasswordReset(BaseModel):
    password: str


def verificar_password(password_plano: str, password_hash: str) -> bool:
    return pwd_context.verify(password_plano, password_hash)


def crear_token_acceso(data: dict, expires_delta: timedelta | None = None) -> str:
    datos = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    datos.update({"exp": expire})
    return jwt.encode(datos, SECRET_KEY, algorithm=ALGORITHM)


def registrar_auditoria_login(usuario: str, ip: str, exito: bool, mensaje: str):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO seguridad.auditoria_login (
                usuario,
                ip,
                exito,
                mensaje,
                fecha
            )
            VALUES (%s, %s, %s, %s, now());
        """, (usuario, ip, exito, mensaje))
        conn.commit()
    except Exception as e:
        # La auditoría no debe tumbar el login si falla.
        print(f"Error registrando auditoría de login: {e}")
    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


def obtener_usuario_actual(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        usuario = payload.get("sub")
        rol = payload.get("rol")
        nombre = payload.get("nombre")

        if usuario is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return {
            "usuario": usuario,
            "rol": rol,
            "nombre": nombre
        }

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


def requerir_roles(*roles_permitidos):
    def validador(usuario_actual: dict = Depends(obtener_usuario_actual)):
        if usuario_actual.get("rol") not in roles_permitidos:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tiene permisos para esta operación"
            )
        return usuario_actual
    return validador



# ============================================================
# v25b - ACL BACKEND SEGURO
# No rompe endpoints existentes; agrega matriz de permisos consultable.
# ============================================================
ACL_BACKEND = {
    "admin": {
        "administrar_usuarios", "ver_auditoria", "editar_cartografia",
        "editar_catastro", "editar_fiscal", "ver_fiscal", "ver_expediente",
        "ver_documentos", "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "supervisor": {
        "ver_auditoria", "editar_cartografia", "editar_catastro",
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "cartografia": {
        "editar_cartografia", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "catastro": {
        "editar_catastro", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "fiscalizacion": {
        "editar_fiscal", "ver_fiscal", "ver_expediente", "ver_documentos",
        "ver_dashboard", "exportar_pdf", "exportar_excel", "consulta"
    },
    "consulta": {
        "ver_expediente", "ver_documentos", "ver_dashboard",
        "exportar_pdf", "exportar_excel", "consulta"
    }
}


def normalizar_rol(rol):
    return (rol or "consulta").strip().lower()


def permisos_por_rol(rol):
    rol_norm = normalizar_rol(rol)
    return sorted(list(ACL_BACKEND.get(rol_norm, ACL_BACKEND["consulta"])))


def usuario_tiene_permiso(usuario_actual: dict, permiso: str) -> bool:
    rol = normalizar_rol(usuario_actual.get("rol"))
    return permiso in ACL_BACKEND.get(rol, ACL_BACKEND["consulta"])


def requerir_permiso(permiso: str):
    def validador(usuario_actual: dict = Depends(obtener_usuario_actual)):
        if not usuario_tiene_permiso(usuario_actual, permiso):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso requerido: {permiso}"
            )
        return usuario_actual
    return validador


app = FastAPI(
    title="API Sistema de Gestión Catastral BC",
    version="0.1.0",
    root_path="/api/catastro"
)


def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        cursor_factory=RealDictCursor
    )




# ============================================================
# ENDPOINTS DE AUTENTICACIÓN INSTITUCIONAL
# ============================================================
@app.post("/login")
def login(datos: LoginRequest, request: Request):
    usuario_input = (datos.usuario or "").strip()
    password_input = datos.password or ""
    ip_cliente = request.client.host if request.client else "desconocida"

    if not usuario_input or not password_input:
        registrar_auditoria_login(usuario_input, ip_cliente, False, "Usuario o contraseña vacíos")
        raise HTTPException(status_code=400, detail="Usuario y contraseña son obligatorios")

    conn = None
    cur = None

    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id,
                usuario,
                nombre_completo,
                password_hash,
                rol,
                activo
            FROM seguridad.usuarios
            WHERE usuario = %s;
        """, (usuario_input,))

        row = cur.fetchone()

        if not row:
            registrar_auditoria_login(usuario_input, ip_cliente, False, "Usuario no encontrado")
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

        if not row["activo"]:
            registrar_auditoria_login(usuario_input, ip_cliente, False, "Usuario inactivo")
            raise HTTPException(status_code=401, detail="Usuario inactivo")

        if not verificar_password(password_input, row["password_hash"]):
            registrar_auditoria_login(usuario_input, ip_cliente, False, "Contraseña incorrecta")
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

        cur.execute("""
            UPDATE seguridad.usuarios
            SET ultimo_acceso = now()
            WHERE id = %s;
        """, (row["id"],))
        conn.commit()

        token = crear_token_acceso({
            "sub": row["usuario"],
            "rol": row["rol"],
            "nombre": row["nombre_completo"]
        })

        registrar_auditoria_login(usuario_input, ip_cliente, True, "Login correcto")

        return {
            "access_token": token,
            "token_type": "bearer",
            "usuario": row["usuario"],
            "nombre": row["nombre_completo"],
            "rol": row["rol"],
            "permisos": permisos_por_rol(row["rol"]),
            "expira_minutos": ACCESS_TOKEN_EXPIRE_MINUTES
        }

    except HTTPException:
        raise

    except Exception as e:
        registrar_auditoria_login(usuario_input, ip_cliente, False, f"Error interno: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/me")
def me(usuario_actual: dict = Depends(obtener_usuario_actual)):
    rol = normalizar_rol(usuario_actual.get("rol"))
    return {
        "autenticado": True,
        "usuario": usuario_actual["usuario"],
        "nombre": usuario_actual["nombre"],
        "rol": rol,
        "permisos": permisos_por_rol(rol)
    }


@app.get("/seguridad/usuarios")
def listar_usuarios(usuario_actual: dict = Depends(requerir_roles("admin"))):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                id,
                usuario,
                nombre_completo,
                rol,
                activo,
                fecha_creacion
            FROM seguridad.usuarios
            ORDER BY usuario;
        """)
        rows = cur.fetchall()

        return {
            "total": len(rows),
            "usuarios": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/seguridad/auditoria-login")
def auditoria_login(
    limite: int = Query(100, ge=1, le=1000),
    usuario_actual: dict = Depends(requerir_roles("admin"))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT
                id,
                usuario,
                ip,
                exito,
                mensaje,
                fecha
            FROM seguridad.auditoria_login
            ORDER BY fecha DESC
            LIMIT %s;
        """, (limite,))
        rows = cur.fetchall()

        return {
            "total": len(rows),
            "auditoria": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass




@app.get("/seguridad/permisos")
def obtener_permisos_usuario(usuario_actual: dict = Depends(obtener_usuario_actual)):
    rol = normalizar_rol(usuario_actual.get("rol"))
    return {
        "usuario": usuario_actual.get("usuario"),
        "rol": rol,
        "permisos": permisos_por_rol(rol),
        "matriz": {k: sorted(list(v)) for k, v in ACL_BACKEND.items()}
    }


@app.get("/admin/permisos")
def obtener_matriz_permisos_admin(user = Depends(require_role(["admin"]))):
    return {
        "matriz": {k: sorted(list(v)) for k, v in ACL_BACKEND.items()}
    }


@app.get("/seguridad/probar-permiso/{permiso}")
def probar_permiso(
    permiso: str,
    usuario_actual: dict = Depends(obtener_usuario_actual)
):
    return {
        "usuario": usuario_actual.get("usuario"),
        "rol": normalizar_rol(usuario_actual.get("rol")),
        "permiso": permiso,
        "autorizado": usuario_tiene_permiso(usuario_actual, permiso)
    }

@app.get("/")
def root():
    return {
        "sistema": "API Sistema de Gestión Catastral BC",
        "estado": "operando"
    }


@app.get("/visor")
def visor_sin_slash():
    return FileResponse("/var/www/catastro/index.html")


@app.get("/visor/")
def visor():
    return FileResponse("/var/www/catastro/index.html")


@app.get("/padron/buscar")
def buscar_padron(
    clave: str = Query(..., min_length=1),
    limite: int = Query(100, ge=1, le=5000)
):
    try:
        limite = min(max(limite, 1), 5000)
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT COUNT(*) AS total
            FROM catastro.v_ficha_predial
            WHERE UPPER(clave_catastral) LIKE UPPER(%s);
        """, (clave + "%",))
        total_row = cur.fetchone()
        total = total_row["total"] if total_row else 0

        cur.execute("""
            SELECT
                NULL::BIGINT AS predio_id,
                clave_catastral,
                propietario AS nombre_completo,
                colonia,
                calle,
                numof,
                zonah AS zona_homogenea,
                valor2026,
                sup_documental,
                id_tasa,
                porcentaje_tasa,
                condominio,
                descripcion_uso,
                dibujado
            FROM catastro.v_ficha_predial
            WHERE UPPER(clave_catastral) LIKE UPPER(%s)
            ORDER BY clave_catastral
            LIMIT %s;
        """, (clave + "%", limite))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave": clave,
            "total": total,
            "limite": limite,
            "cargados": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/padron/busqueda-avanzada")
def busqueda_avanzada(
    clave: str = Query("", max_length=50),
    nombre: str = Query("", max_length=150),
    colonia: str = Query("", max_length=150),
    calle: str = Query("", max_length=150),
    numero: str = Query("", max_length=50),
    limite: int = Query(100, ge=1, le=5000)
):
    try:
        limite = min(max(limite, 1), 5000)

        clave_like = (clave or "").strip() + "%"
        nombre_like = "%" + (nombre or "").strip() + "%"
        colonia_like = "%" + (colonia or "").strip() + "%"
        calle_like = "%" + (calle or "").strip() + "%"
        numero_txt = (numero or "").strip()

        conn = get_conn()
        cur = conn.cursor()

        where_sql = """
            WHERE
                (%s = '' OR UPPER(clave_catastral) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(propietario) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(colonia) LIKE UPPER(%s))
                AND (%s = '' OR UPPER(calle) LIKE UPPER(%s))
                AND (%s = '' OR CAST(numof AS TEXT) = %s)
        """

        params_where = (
            (clave or "").strip(), clave_like,
            (nombre or "").strip(), nombre_like,
            (colonia or "").strip(), colonia_like,
            (calle or "").strip(), calle_like,
            numero_txt, numero_txt
        )

        # Total real SIN LIMIT para que el frontend conozca todos los predios encontrados.
        cur.execute(f"""
            SELECT COUNT(*) AS total
            FROM catastro.v_ficha_predial
            {where_sql};
        """, params_where)
        total_row = cur.fetchone()
        total = total_row["total"] if total_row else 0

        # Resultados cargados con límite controlado.
        cur.execute(f"""
            SELECT
                clave_catastral,
                propietario AS nombre_completo,
                delegacion,
                colonia,
                calle,
                numof,
                zonah AS zona_homogenea,
                valor2026,
                sup_documental,
                id_tasa,
                porcentaje_tasa,
                condominio,
                descripcion_uso,
                dibujado
            FROM catastro.v_ficha_predial
            {where_sql}
            ORDER BY clave_catastral
            LIMIT %s;
        """, params_where + (limite,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "total": total,
            "limite": limite,
            "cargados": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/padron/{clave}/ficha")
def ficha_padron(clave: str):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                NULL::BIGINT AS predio_id,
                clave_catastral,
                propietario AS nombre_completo,
                delegacion,
                colonia,
                calle,
                zonah AS zona_homogenea,
                NULL::INTEGER AS anio_zona,
                descripcion_uso,
                id_tasa,
                porcentaje_tasa,
                NULL::TEXT AS cp,
                numof,
                numint,
                letra,
                sup_documental,
                sup_fisica,
                sup_const,
                valor2026,
                NULL::TEXT AS estatus,
                TRUE AS vigente,
                dibujado,
                condominio,
                adeudo_2026,
                adeudo_total,
                id_persona,
                tipo_persona,
                rfc,
                porcentaje_propiedad,
                tipo_titularidad,
                CASE
                    WHEN geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(geom, 4326))::json
                END AS geometry
            FROM catastro.v_ficha_predial
            WHERE UPPER(clave_catastral) = UPPER(%s)
            LIMIT 1;
        """, (clave,))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Predio no encontrado")

        geometry = row.pop("geometry")

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": row
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/predios/{clave}/ficha")
def ficha_predio_alias(clave: str):
    return ficha_padron(clave)


@app.get("/predios/buscar")
def buscar_predios(
    clave: str = Query(..., min_length=1),
    limite: int = Query(100, ge=1, le=5000)
):
    return buscar_padron(clave=clave, limite=limite)


@app.get("/predios/intersecta")
def predio_por_coordenada(
    lon: float = Query(...),
    lat: float = Query(...)
):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            WITH punto AS (
                SELECT ST_Transform(
                    ST_SetSRID(ST_Point(%s, %s), 4326),
                    32611
                ) AS geom
            )
            SELECT
                p.id,
                p.clave_catastral,
                p.estatus,
                p.sup_documental AS superficie,
                ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry
            FROM catastro.predios p, punto pt
            WHERE p.geom IS NOT NULL
              AND (
                    ST_Intersects(p.geom, pt.geom)
                    OR ST_DWithin(p.geom, pt.geom, 2)
              )
            ORDER BY
                CASE WHEN ST_Intersects(p.geom, pt.geom) THEN 0 ELSE 1 END,
                ST_Area(p.geom) ASC,
                ST_Distance(p.geom, pt.geom) ASC
            LIMIT 1;
        """, (lon, lat))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="No se encontró predio")

        geometry = row.pop("geometry")

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": row
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/predios/cercanos")
def predios_cercanos(
    lon: float = Query(...),
    lat: float = Query(...),
    radio: float = Query(50, ge=1, le=500)
):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            WITH punto AS (
                SELECT ST_Transform(
                    ST_SetSRID(ST_Point(%s, %s), 4326),
                    32611
                ) AS geom
            )
            SELECT
                p.id,
                p.clave_catastral,
                p.estatus,
                col.nombre_colonia AS colonia,
                p.cp,
                p.sup_documental AS superficie,
                ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json AS geometry
            FROM catastro.predios p
            LEFT JOIN catalogos.cat_colonias col
                ON p.colonia_id = col.id,
                punto pt
            WHERE p.geom IS NOT NULL
              AND ST_DWithin(p.geom, pt.geom, %s)
            ORDER BY ST_Distance(p.geom, pt.geom)
            LIMIT 100;
        """, (lon, lat, radio))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        features = []
        for row in rows:
            geometry = row.pop("geometry")
            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": row
            })

        return {
            "type": "FeatureCollection",
            "total": len(features),
            "features": features
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tiles/predios/{z}/{x}/{y}.pbf")
def tile_predios(z: int, x: int, y: int):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            WITH
            bounds AS (
                SELECT ST_TileEnvelope(%s, %s, %s) AS geom
            ),
            mvtgeom AS (
                SELECT
                    p.id,
                    p.clave_catastral,
                    col.nombre_colonia AS colonia,
                    p.cp,
                    p.sup_documental AS superficie,
                    ST_AsMVTGeom(
                        ST_Transform(p.geom, 3857),
                        bounds.geom,
                        4096,
                        64,
                        true
                    ) AS geom
                FROM catastro.predios p
                LEFT JOIN catalogos.cat_colonias col
                    ON p.colonia_id = col.id,
                    bounds
                WHERE p.geom IS NOT NULL
                  AND ST_Transform(p.geom, 3857) && bounds.geom
            )
            SELECT ST_AsMVT(
                mvtgeom,
                'predios',
                4096,
                'geom'
            ) AS tile
            FROM mvtgeom;
        """, (z, x, y))

        row = cur.fetchone()
        cur.close()
        conn.close()

        tile = row["tile"] if row and row["tile"] else b""

        return Response(
            content=bytes(tile),
            media_type="application/vnd.mapbox-vector-tile"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/control-cartografico/estadisticas")
def estadisticas_control():
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                estado_cartografico,
                COUNT(*) AS total
            FROM catastro.v_control_cartografico
            GROUP BY estado_cartografico
            ORDER BY estado_cartografico;
        """)

        rows = cur.fetchall()
        cur.close()
        conn.close()

        resultado = {
            "DIBUJADO": 0,
            "SIN GEOMETRIA": 0,
            "NO EXISTE EN CARTOGRAFIA": 0,
            "TOTAL": 0,
            "COBERTURA": 0
        }

        for row in rows:
            estado = row["estado_cartografico"]
            total_estado = row["total"]
            resultado[estado] = total_estado
            resultado["TOTAL"] += total_estado

        if resultado["TOTAL"] > 0:
            resultado["COBERTURA"] = round(
                (resultado.get("DIBUJADO", 0) / resultado["TOTAL"]) * 100,
                2
            )

        return resultado

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/control-cartografico/sin-geometria")
def control_sin_geometria(
    limite: int = Query(100, ge=1, le=1000)
):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                clave_catastral,
                nombre_completo,
                delegacion,
                colonia,
                calle,
                numof,
                valor2026,
                sup_documental,
                descripcion_uso,
                predio_id,
                estado_cartografico
            FROM catastro.v_control_cartografico
            WHERE estado_cartografico = 'SIN GEOMETRIA'
            ORDER BY clave_catastral
            LIMIT %s;
        """, (limite,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "estado": "SIN GEOMETRIA",
            "total": len(rows),
            "resultados": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/expediente/{clave}")
def obtener_expediente_integral(clave: str):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id_expediente,
                clave_catastral,
                estatus_expediente,
                nombre_completo,
                delegacion,
                colonia,
                calle,
                numof,
                numint,
                letra,
                zona_homogenea,
                descripcion_uso,
                id_tasa,
                porcentaje_tasa,
                condominio,
                valor2026,
                sup_documental,
                sup_fisica,
                sup_const,
                adeudo_2026,
                adeudo_total,
                predio_id,
                estado_cartografico,
                dibujado,
                area_cartografica,
                diferencia_area,
                tiene_documentos,
                tiene_cartografia,
                tiene_construccion,
                tiene_avaluo,
                tiene_inspeccion,
                tiene_rppc,
                tiene_fotografia,
                tiene_cedula,
                tiene_historial,
                observaciones,
                CASE
                    WHEN geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ST_Transform(geom, 4326))::json
                END AS geometry
            FROM catastro.v_expediente_integral
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            LIMIT 1;
        """, (clave,))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Expediente no encontrado")

        geometry = row.pop("geometry")

        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": row
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/expediente/{clave}/historial")
def historial_expediente(clave: str):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                fecha_modificacion,
                usuario_modifico,
                accion,
                tipo_movimiento,
                observaciones,
                tiene_documentos,
                tiene_cartografia,
                tiene_construccion,
                tiene_avaluo,
                tiene_inspeccion,
                tiene_rppc,
                tiene_fotografia,
                tiene_cedula,
                tiene_historial
            FROM auditoria.v_expedientes_timeline
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            ORDER BY fecha_modificacion DESC
            LIMIT 50;
        """, (clave,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave_catastral": clave.upper(),
            "total": len(rows),
            "historial": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/expediente/{clave}/documentos")
def documentos_expediente(clave: str):
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id_documento,
                clave_catastral,
                tipo_documento,
                nombre_archivo,
                ruta_archivo,
                descripcion,
                anio,
                origen,
                usuario_carga,
                fecha_carga
            FROM catastro.v_expediente_documentos
            WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
            ORDER BY fecha_carga DESC;
        """, (clave,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {
            "clave_catastral": clave.upper(),
            "total": len(rows),
            "documentos": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/documentos/{clave}/{archivo}")
def abrir_documento(clave: str, archivo: str):
    ruta = f"/var/www/catastro/documentos/{clave}/{archivo}"
    if not os.path.exists(ruta):
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return FileResponse(ruta)


@app.get("/cambios-geometricos")
def cambios_geometricos():
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT json_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(json_agg(feature), '[]'::json)
            ) AS geojson
            FROM (
                SELECT json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(p.geom, 4326))::json,
                    'properties', json_build_object(
                        'clave_catastral', c.clave_catastral,
                        'tipo_cambio', c.tipo_cambio,
                        'prioridad', c.prioridad,
                        'requiere_revision', c.requiere_revision,
                        'area_catastro', c.area_catastro,
                        'area_geonode', c.area_geonode,
                        'diferencia_area', c.diferencia_area,
                        'porcentaje_cambio', c.porcentaje_cambio,
                        'distancia_centroides', c.distancia_centroides,
                        'fecha_deteccion', c.fecha_deteccion
                    )
                ) AS feature
                FROM auditoria.cambios_geometricos_predios c
                JOIN catastro.predios p
                    ON p.clave_catastral = c.clave_catastral
                WHERE p.geom IS NOT NULL
            ) features;
        """)

        row = cur.fetchone()
        cur.close()
        conn.close()

        return row["geojson"]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/dashboard-cartografico")
def dashboard_cartografico():
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE geom IS NOT NULL) AS dibujados,
                COUNT(*) FILTER (WHERE geom IS NULL) AS sin_geometria
            FROM catastro.predios;
        """)
        base = cur.fetchone()

        cur.execute("""
            SELECT
                COUNT(*) AS total_cambios,
                COUNT(*) FILTER (WHERE requiere_revision = true) AS requieren_revision,
                COUNT(*) FILTER (WHERE prioridad = 'ALTA') AS prioridad_alta,
                COUNT(*) FILTER (WHERE prioridad = 'MEDIA') AS prioridad_media,
                COUNT(*) FILTER (WHERE prioridad = 'BAJA') AS prioridad_baja
            FROM auditoria.cambios_geometricos_predios;
        """)
        cambios = cur.fetchone()

        cur.close()
        conn.close()

        total = base["total_predios"] or 0
        dibujados = base["dibujados"] or 0
        sin_geometria = base["sin_geometria"] or 0
        cobertura = round((dibujados / total) * 100, 2) if total > 0 else 0

        return {
            "total_predios": total,
            "dibujados": dibujados,
            "sin_geometria": sin_geometria,
            "cobertura": cobertura,
            "cambios_geometricos": cambios["total_cambios"] or 0,
            "requieren_revision": cambios["requieren_revision"] or 0,
            "prioridad_alta": cambios["prioridad_alta"] or 0,
            "prioridad_media": cambios["prioridad_media"] or 0,
            "prioridad_baja": cambios["prioridad_baja"] or 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/dashboard-fiscal")
def dashboard_fiscal():
    try:
        conn = get_conn()
        cur = conn.cursor()

        # Resumen fiscal general desde la ficha predial institucional
        cur.execute("""
            SELECT
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS con_adeudo,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) <= 0) AS sin_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(adeudo_2026), 0) AS adeudo_2026,
                COALESCE(SUM(valor2026), 0) AS valor_catastral_total,
                COALESCE(SUM(sup_documental), 0) AS superficie_documental_total,
                COALESCE(SUM(sup_fisica), 0) AS superficie_fisica_total,
                COALESCE(SUM(sup_const), 0) AS superficie_construccion_total,
                COUNT(*) FILTER (WHERE dibujado = true) AS dibujados,
                COUNT(*) FILTER (WHERE dibujado = false OR dibujado IS NULL) AS sin_geometria
            FROM catastro.v_ficha_predial;
        """)
        resumen = cur.fetchone()

        # Estado documental / expediente integral
        cur.execute("""
            SELECT
                COUNT(*) AS total_expedientes,
                COUNT(*) FILTER (WHERE tiene_documentos = true) AS con_documentos,
                COUNT(*) FILTER (WHERE tiene_documentos = false OR tiene_documentos IS NULL) AS sin_documentos,
                COUNT(*) FILTER (WHERE tiene_cartografia = true) AS con_cartografia,
                COUNT(*) FILTER (WHERE tiene_construccion = true) AS con_construccion,
                COUNT(*) FILTER (WHERE tiene_avaluo = true) AS con_avaluo,
                COUNT(*) FILTER (WHERE tiene_inspeccion = true) AS con_inspeccion,
                COUNT(*) FILTER (WHERE tiene_rppc = true) AS con_rppc,
                COUNT(*) FILTER (WHERE tiene_fotografia = true) AS con_fotografia,
                COUNT(*) FILTER (WHERE tiene_cedula = true) AS con_cedula,
                COUNT(*) FILTER (WHERE tiene_historial = true) AS con_historial
            FROM catastro.v_expediente_integral;
        """)
        expediente = cur.fetchone()

        # Top colonias por adeudo
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(colonia), ''), 'SIN COLONIA') AS colonia,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(colonia), ''), 'SIN COLONIA')
            ORDER BY COALESCE(SUM(adeudo_total), 0) DESC
            LIMIT 10;
        """)
        top_colonias = cur.fetchall()

        # Resumen por uso predial
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(descripcion_uso), ''), 'SIN USO') AS uso,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(descripcion_uso), ''), 'SIN USO')
            ORDER BY COUNT(*) DESC
            LIMIT 10;
        """)
        por_uso = cur.fetchall()

        # Resumen por zona homogénea
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(zonah), ''), 'SIN ZONA') AS zona_homogenea,
                COUNT(*) AS total_predios,
                COUNT(*) FILTER (WHERE COALESCE(adeudo_total, 0) > 0) AS predios_con_adeudo,
                COALESCE(SUM(adeudo_total), 0) AS adeudo_total,
                COALESCE(SUM(valor2026), 0) AS valor_catastral
            FROM catastro.v_ficha_predial
            GROUP BY COALESCE(NULLIF(TRIM(zonah), ''), 'SIN ZONA')
            ORDER BY COALESCE(SUM(adeudo_total), 0) DESC
            LIMIT 10;
        """)
        por_zona = cur.fetchall()

        cur.close()
        conn.close()

        total_predios = resumen["total_predios"] or 0
        con_adeudo = resumen["con_adeudo"] or 0
        sin_adeudo = resumen["sin_adeudo"] or 0
        dibujados = resumen["dibujados"] or 0

        return {
            "total_predios": total_predios,
            "con_adeudo": con_adeudo,
            "sin_adeudo": sin_adeudo,
            "porcentaje_con_adeudo": round((con_adeudo / total_predios) * 100, 2) if total_predios > 0 else 0,
            "porcentaje_sin_adeudo": round((sin_adeudo / total_predios) * 100, 2) if total_predios > 0 else 0,
            "adeudo_total": float(resumen["adeudo_total"] or 0),
            "adeudo_2026": float(resumen["adeudo_2026"] or 0),
            "valor_catastral_total": float(resumen["valor_catastral_total"] or 0),
            "superficie_documental_total": float(resumen["superficie_documental_total"] or 0),
            "superficie_fisica_total": float(resumen["superficie_fisica_total"] or 0),
            "superficie_construccion_total": float(resumen["superficie_construccion_total"] or 0),
            "dibujados": dibujados,
            "sin_geometria": resumen["sin_geometria"] or 0,
            "cobertura_cartografica": round((dibujados / total_predios) * 100, 2) if total_predios > 0 else 0,
            "expediente": {
                "total_expedientes": expediente["total_expedientes"] or 0,
                "con_documentos": expediente["con_documentos"] or 0,
                "sin_documentos": expediente["sin_documentos"] or 0,
                "con_cartografia": expediente["con_cartografia"] or 0,
                "con_construccion": expediente["con_construccion"] or 0,
                "con_avaluo": expediente["con_avaluo"] or 0,
                "con_inspeccion": expediente["con_inspeccion"] or 0,
                "con_rppc": expediente["con_rppc"] or 0,
                "con_fotografia": expediente["con_fotografia"] or 0,
                "con_cedula": expediente["con_cedula"] or 0,
                "con_historial": expediente["con_historial"] or 0
            },
            "top_colonias_adeudo": top_colonias,
            "resumen_por_uso": por_uso,
            "resumen_por_zona": por_zona
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/visor/catastro.css")
def servir_css():
    return FileResponse("/var/www/catastro/catastro.css", media_type="text/css")


@app.get("/visor/catastro.js")
def servir_js():
    return FileResponse("/var/www/catastro/catastro.js", media_type="application/javascript")



# ============================================================
# ENDPOINTS ADMINISTRATIVOS INSTITUCIONALES
# ============================================================
@app.get("/admin/auditoria")
async def obtener_auditoria(
    limite: int = Query(200, ge=1, le=1000),
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id,
                usuario,
                accion,
                modulo,
                detalle,
                ip,
                fecha
            FROM seguridad.auditoria_sistema
            ORDER BY fecha DESC
            LIMIT %s;
        """, (limite,))

        rows = cur.fetchall()

        return {
            "total": len(rows),
            "auditoria": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/admin/usuarios")
async def obtener_usuarios(
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                u.id,
                u.usuario,
                u.nombre_completo,
                u.rol AS rol_principal,
                COALESCE(
                    json_agg(r.nombre ORDER BY r.nombre)
                    FILTER (WHERE r.nombre IS NOT NULL),
                    '[]'
                ) AS roles,
                u.activo,
                u.fecha_creacion,
                u.ultimo_acceso
            FROM seguridad.usuarios u
            LEFT JOIN seguridad.usuario_roles ur
                ON ur.usuario_id = u.id
            LEFT JOIN seguridad.roles r
                ON r.id = ur.rol_id
            GROUP BY
                u.id,
                u.usuario,
                u.nombre_completo,
                u.rol,
                u.activo,
                u.fecha_creacion,
                u.ultimo_acceso
            ORDER BY u.usuario;
        """)

        rows = cur.fetchall()

        return {
            "total": len(rows),
            "usuarios": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/admin/roles")
async def obtener_roles(
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                id,
                nombre,
                descripcion
            FROM seguridad.roles
            ORDER BY nombre;
        """)

        rows = cur.fetchall()

        return {
            "total": len(rows),
            "roles": rows
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.post("/admin/usuarios")
async def crear_usuario_admin(
    nuevo: UsuarioNuevo,
    request: Request,
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        usuario = nuevo.usuario.strip().lower()
        rol = nuevo.rol.strip().lower()

        if not usuario or not nuevo.password:
            raise HTTPException(status_code=400, detail="Usuario y contraseña son obligatorios")

        conn = get_conn()
        cur = conn.cursor()

        password_hash = pwd_context.hash(nuevo.password)

        cur.execute("""
            INSERT INTO seguridad.usuarios (
                usuario,
                nombre_completo,
                password_hash,
                rol,
                activo,
                fecha_creacion
            )
            VALUES (%s, %s, %s, %s, TRUE, now())
            RETURNING id;
        """, (
            usuario,
            nuevo.nombre_completo.strip(),
            password_hash,
            rol
        ))

        usuario_id = cur.fetchone()["id"]

        cur.execute("""
            SELECT id
            FROM seguridad.roles
            WHERE nombre = %s;
        """, (rol,))

        rol_row = cur.fetchone()

        if rol_row:
            cur.execute("""
                INSERT INTO seguridad.usuario_roles (
                    usuario_id,
                    rol_id
                )
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING;
            """, (usuario_id, rol_row["id"]))

        conn.commit()

        registrar_auditoria(
            user["usuario"],
            "CREAR_USUARIO",
            "ADMIN",
            f"Usuario creado: {usuario}",
            request.client.host if request.client else ""
        )

        return {
            "success": True,
            "usuario": usuario,
            "id": usuario_id
        }

    except psycopg2.errors.UniqueViolation:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=409, detail="El usuario ya existe")

    except HTTPException:
        if conn:
            conn.rollback()
        raise

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.put("/admin/usuarios/{usuario_id}")
async def actualizar_usuario_admin(
    usuario_id: int,
    datos: UsuarioActualizar,
    request: Request,
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, usuario
            FROM seguridad.usuarios
            WHERE id = %s;
        """, (usuario_id,))

        usuario_row = cur.fetchone()
        if not usuario_row:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        if datos.nombre_completo is not None:
            cur.execute("""
                UPDATE seguridad.usuarios
                SET nombre_completo = %s
                WHERE id = %s;
            """, (datos.nombre_completo.strip(), usuario_id))

        if datos.activo is not None:
            cur.execute("""
                UPDATE seguridad.usuarios
                SET activo = %s
                WHERE id = %s;
            """, (datos.activo, usuario_id))

        if datos.rol is not None:
            rol = datos.rol.strip().lower()

            cur.execute("""
                UPDATE seguridad.usuarios
                SET rol = %s
                WHERE id = %s;
            """, (rol, usuario_id))

            cur.execute("""
                SELECT id
                FROM seguridad.roles
                WHERE nombre = %s;
            """, (rol,))
            rol_row = cur.fetchone()

            if rol_row:
                cur.execute("""
                    DELETE FROM seguridad.usuario_roles
                    WHERE usuario_id = %s;
                """, (usuario_id,))

                cur.execute("""
                    INSERT INTO seguridad.usuario_roles (
                        usuario_id,
                        rol_id
                    )
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING;
                """, (usuario_id, rol_row["id"]))

        conn.commit()

        registrar_auditoria(
            user["usuario"],
            "ACTUALIZAR_USUARIO",
            "ADMIN",
            f"Usuario actualizado: {usuario_row['usuario']}",
            request.client.host if request.client else ""
        )

        return {
            "success": True,
            "id": usuario_id
        }

    except HTTPException:
        if conn:
            conn.rollback()
        raise

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass


@app.post("/admin/usuarios/{usuario_id}/reset-password")
async def reset_password_usuario_admin(
    usuario_id: int,
    datos: PasswordReset,
    request: Request,
    user = Depends(require_role(["admin"]))
):
    conn = None
    cur = None
    try:
        if not datos.password:
            raise HTTPException(status_code=400, detail="Contraseña obligatoria")

        conn = get_conn()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, usuario
            FROM seguridad.usuarios
            WHERE id = %s;
        """, (usuario_id,))
        usuario_row = cur.fetchone()

        if not usuario_row:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")

        password_hash = pwd_context.hash(datos.password)

        cur.execute("""
            UPDATE seguridad.usuarios
            SET password_hash = %s
            WHERE id = %s;
        """, (password_hash, usuario_id))

        conn.commit()

        registrar_auditoria(
            user["usuario"],
            "RESET_PASSWORD",
            "ADMIN",
            f"Reset password: {usuario_row['usuario']}",
            request.client.host if request.client else ""
        )

        return {
            "success": True,
            "id": usuario_id
        }

    except HTTPException:
        if conn:
            conn.rollback()
        raise

    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        try:
            if cur:
                cur.close()
            if conn:
                conn.close()
        except Exception:
            pass




# ============================================================
# v26 - ENDPOINTS MÓDULO MOVIMIENTOS CATASTRALES
# ============================================================

class MovimientoPadronCreate(BaseModel):
    clave_catastral: Optional[str] = None
    clave_catastral_anterior: Optional[str] = None
    clave_catastral_nueva: Optional[str] = None
    tipo_movimiento: str
    motivo: Optional[str] = None
    observaciones: Optional[str] = None
    datos_anteriores: Optional[dict] = {}
    datos_nuevos: Optional[dict] = {}
    detalles: Optional[list[dict]] = []


class MovimientoEstadoUpdate(BaseModel):
    estado: str
    observaciones: Optional[str] = None


def permiso_movimientos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    rol = normalizar_rol(usuario_actual.get("rol")) if "normalizar_rol" in globals() else (usuario_actual.get("rol") or "").lower()
    if rol not in ["admin", "supervisor", "catastro"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere rol admin, supervisor o catastro para movimientos catastrales"
        )
    return usuario_actual


def permiso_aplicar_movimientos(usuario_actual: dict = Depends(obtener_usuario_actual)):
    rol = normalizar_rol(usuario_actual.get("rol")) if "normalizar_rol" in globals() else (usuario_actual.get("rol") or "").lower()
    if rol not in ["admin", "supervisor"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo admin o supervisor pueden autorizar/aplicar movimientos"
        )
    return usuario_actual


@app.get("/movimientos/tipos")
def listar_tipos_movimiento(usuario_actual: dict = Depends(permiso_movimientos)):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT clave, nombre, descripcion, requiere_autorizacion
                FROM catalogos.cat_tipos_movimiento_padron
                WHERE activo = TRUE
                ORDER BY nombre;
            """)
            return cur.fetchall()


@app.get("/movimientos")
def listar_movimientos(
    clave: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    limite: int = Query(100, ge=1, le=500),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    sql = """
        SELECT *
        FROM catastro.v_movimientos_padron
        WHERE 1=1
    """
    params = []

    if clave:
        sql += " AND clave_catastral ILIKE %s"
        params.append(f"%{clave}%")

    if estado:
        sql += " AND estado = %s"
        params.append(estado)

    sql += " ORDER BY fecha_solicitud DESC LIMIT %s"
    params.append(limite)

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall()


@app.get("/movimientos/{movimiento_id}")
def obtener_movimiento(
    movimiento_id: int,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT *
                FROM catastro.v_movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron_detalle
                WHERE movimiento_id = %s
                ORDER BY id;
            """, (movimiento_id,))
            detalles = cur.fetchall()

            cur.execute("""
                SELECT *
                FROM auditoria.movimientos_padron_auditoria
                WHERE movimiento_id = %s
                ORDER BY fecha DESC;
            """, (movimiento_id,))
            auditoria = cur.fetchall()

            mov["detalles"] = detalles
            mov["auditoria"] = auditoria
            return mov


@app.post("/movimientos")
def crear_movimiento(
    payload: MovimientoPadronCreate,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    tipo = (payload.tipo_movimiento or "").strip().upper()
    estado_inicial = "BORRADOR"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO catastro.movimientos_padron (
                    clave_catastral,
                    clave_catastral_anterior,
                    clave_catastral_nueva,
                    tipo_movimiento,
                    estado,
                    motivo,
                    observaciones,
                    datos_anteriores,
                    datos_nuevos,
                    usuario_solicita,
                    ip_origen
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s)
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado, fecha_solicitud;
            """, (
                payload.clave_catastral,
                payload.clave_catastral_anterior,
                payload.clave_catastral_nueva,
                tipo,
                estado_inicial,
                payload.motivo,
                payload.observaciones,
                json.dumps(payload.datos_anteriores or {}),
                json.dumps(payload.datos_nuevos or {}),
                usuario_actual.get("usuario"),
                request.client.host if request.client else None
            ))

            mov = cur.fetchone()

            for det in payload.detalles or []:
                cur.execute("""
                    INSERT INTO catastro.movimientos_padron_detalle (
                        movimiento_id, grupo, campo, etiqueta,
                        valor_anterior, valor_nuevo, tipo_dato,
                        requiere_validacion
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
                """, (
                    mov["id"],
                    det.get("grupo"),
                    det.get("campo"),
                    det.get("etiqueta"),
                    det.get("valor_anterior"),
                    det.get("valor_nuevo"),
                    det.get("tipo_dato"),
                    bool(det.get("requiere_validacion", False))
                ))

            conn.commit()
            return {
                "ok": True,
                "mensaje": "Movimiento creado correctamente",
                "movimiento": mov
            }


@app.put("/movimientos/{movimiento_id}/estado")
def actualizar_estado_movimiento(
    movimiento_id: int,
    payload: MovimientoEstadoUpdate,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    estado = (payload.estado or "").strip().upper()

    estados_validos = ["BORRADOR", "EN_REVISION", "OBSERVADO", "AUTORIZADO", "RECHAZADO", "APLICADO", "CANCELADO"]
    if estado not in estados_validos:
        raise HTTPException(status_code=400, detail="Estado no válido")

    campos = ["estado = %s", "observaciones = COALESCE(%s, observaciones)"]
    params = [estado, payload.observaciones]

    usuario = usuario_actual.get("usuario")

    if estado == "EN_REVISION":
        campos += ["usuario_revisa = %s", "fecha_revision = now()"]
        params.append(usuario)
    elif estado == "AUTORIZADO":
        campos += ["usuario_autoriza = %s", "fecha_autorizacion = now()"]
        params.append(usuario)
    elif estado == "APLICADO":
        campos += ["usuario_aplica = %s", "fecha_aplicacion = now()"]
        params.append(usuario)
    elif estado == "CANCELADO":
        campos += ["usuario_cancela = %s", "fecha_cancelacion = now()"]
        params.append(usuario)

    params.append(movimiento_id)

    sql = f"""
        UPDATE catastro.movimientos_padron
        SET {", ".join(campos)}
        WHERE id = %s
        RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
    """

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            conn.commit()
            return {
                "ok": True,
                "mensaje": "Estado actualizado correctamente",
                "movimiento": row
            }


@app.get("/movimientos/historial/{clave}")
def historial_movimientos_clave(
    clave: str,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT *
                FROM catastro.v_movimientos_padron
                WHERE clave_catastral = %s
                   OR clave_catastral_anterior = %s
                   OR clave_catastral_nueva = %s
                ORDER BY fecha_solicitud DESC;
            """, (clave, clave, clave))
            return cur.fetchall()


@app.get("/movimientos/copropietarios/{clave}")
def listar_copropietarios(
    clave: str,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT *
                FROM catastro.predios_copropietarios
                WHERE clave_catastral = %s
                ORDER BY titular_principal DESC, nombre_completo;
            """, (clave,))
            return cur.fetchall()


# Montar archivos estáticos al final para no bloquear rutas API.
app.mount(
    "/visor",
    StaticFiles(directory="/var/www/catastro", html=True),
    name="visor"
)


# ============================================================
# v26c - APLICACIÓN REAL DE MOVIMIENTOS AL PADRÓN
# Primera etapa: CAMBIO_NOMBRE sobre catalogos.padron_2026.nombre_completo
# ============================================================

def obtener_movimiento_base(cur, movimiento_id: int):
    cur.execute("""
        SELECT *
        FROM catastro.movimientos_padron
        WHERE id = %s;
    """, (movimiento_id,))
    mov = cur.fetchone()
    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    return mov


def obtener_detalles_movimiento(cur, movimiento_id: int):
    cur.execute("""
        SELECT *
        FROM catastro.movimientos_padron_detalle
        WHERE movimiento_id = %s
        ORDER BY id;
    """, (movimiento_id,))
    return cur.fetchall()


def valor_detalle(detalles, campo_busqueda: str):
    campo_busqueda = (campo_busqueda or "").strip().lower()
    for d in detalles:
        if str(d.get("campo") or "").strip().lower() == campo_busqueda:
            return d.get("valor_nuevo")
    return None


def actualizar_estado_aplicado(cur, movimiento_id: int, usuario: str):
    cur.execute("""
        UPDATE catastro.movimientos_padron
        SET estado = 'APLICADO',
            usuario_aplica = %s,
            fecha_aplicacion = now()
        WHERE id = %s
        RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
    """, (usuario, movimiento_id))
    return cur.fetchone()


@app.post("/movimientos/{movimiento_id}/aplicar")
def aplicar_movimiento_padron(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            mov = obtener_movimiento_base(cur, movimiento_id)

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()
            clave = mov["clave_catastral"]
            detalles = obtener_detalles_movimiento(cur, movimiento_id)

            if not clave and tipo != "ALTA_CLAVE":
                raise HTTPException(status_code=400, detail="El movimiento no tiene clave catastral")

            # ------------------------------------------------------------
            # CAMBIO_NOMBRE
            # ------------------------------------------------------------
            if tipo in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                nuevo_nombre = (
                    valor_detalle(detalles, "nombre_propietario")
                    or valor_detalle(detalles, "nombre_completo")
                    or valor_detalle(detalles, "propietario")
                )

                if not nuevo_nombre:
                    datos_nuevos = mov.get("datos_nuevos") or {}
                    if isinstance(datos_nuevos, str):
                        datos_nuevos = json.loads(datos_nuevos)
                    nuevo_nombre = (
                        datos_nuevos.get("nombre_propietario")
                        or datos_nuevos.get("nombre_completo")
                        or datos_nuevos.get("propietario")
                    )

                if not nuevo_nombre:
                    raise HTTPException(
                        status_code=400,
                        detail="No se encontró valor nuevo para nombre_propietario"
                    )

                cur.execute("""
                    SELECT nombre_completo
                    FROM catalogos.padron_2026
                    WHERE clave_catastral = %s
                    LIMIT 1;
                """, (clave,))
                anterior = cur.fetchone()

                if not anterior:
                    raise HTTPException(
                        status_code=404,
                        detail="No se encontró la clave en catalogos.padron_2026"
                    )

                cur.execute("""
                    UPDATE catalogos.padron_2026
                    SET nombre_completo = %s
                    WHERE clave_catastral = %s
                    RETURNING clave_catastral, nombre_completo;
                """, (nuevo_nombre, clave))
                actualizado = cur.fetchone()

                cur.execute("""
                    INSERT INTO catastro.historial_titularidad (
                        clave_catastral,
                        movimiento_id,
                        tipo_evento,
                        nombre_anterior,
                        nombre_nuevo,
                        motivo,
                        usuario_modifica
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s);
                """, (
                    clave,
                    movimiento_id,
                    tipo,
                    anterior.get("nombre_completo"),
                    nuevo_nombre,
                    mov.get("motivo"),
                    usuario
                ))

                cur.execute("""
                    INSERT INTO auditoria.movimientos_padron_auditoria (
                        movimiento_id,
                        clave_catastral,
                        accion,
                        estado_anterior,
                        estado_nuevo,
                        detalle,
                        datos,
                        usuario,
                        ip
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
                """, (
                    movimiento_id,
                    clave,
                    "APLICAR_CAMBIO_NOMBRE",
                    mov["estado"],
                    "APLICADO",
                    "Cambio aplicado a catalogos.padron_2026.nombre_completo",
                    json.dumps({
                        "tabla": "catalogos.padron_2026",
                        "campo": "nombre_completo",
                        "valor_anterior": anterior.get("nombre_completo"),
                        "valor_nuevo": nuevo_nombre
                    }),
                    usuario,
                    request.client.host if request.client else None
                ))

                mov_final = actualizar_estado_aplicado(cur, movimiento_id, usuario)
                conn.commit()

                return {
                    "ok": True,
                    "mensaje": "Cambio de nombre aplicado al padrón correctamente",
                    "movimiento": mov_final,
                    "actualizado": actualizado
                }

            # ------------------------------------------------------------
            # CAMBIOS AÚN NO MAPEADOS A TABLA MAESTRA
            # ------------------------------------------------------------
            raise HTTPException(
                status_code=400,
                detail=f"El tipo de movimiento {tipo} ya se registra, pero aún no tiene regla de aplicación real configurada."
            )




# ============================================================
# v27f - APLICACIÓN TITULARIDAD COMPLETA
# Actualiza padron_2026 + catalogos.personas vía predio_propietario
# ============================================================

def extraer_json_dict(valor):
    if valor is None:
        return {}
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except Exception:
            return {}
    return {}


def aplicar_titularidad_completa(cur, movimiento_id: int, usuario: str, ip: str = None):
    cur.execute("""
        SELECT *
        FROM catastro.movimientos_padron
        WHERE id = %s;
    """, (movimiento_id,))
    mov = cur.fetchone()

    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")

    if mov["estado"] == "APLICADO":
        raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

    tipo = str(mov["tipo_movimiento"] or "").upper()
    if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
        raise HTTPException(
            status_code=400,
            detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
        )

    clave = mov["clave_catastral"]
    datos_nuevos = extraer_json_dict(mov.get("datos_nuevos"))

    nombre_nuevo = (
        datos_nuevos.get("nombre_propietario")
        or datos_nuevos.get("nombre_completo")
        or datos_nuevos.get("razon_social")
    )

    rfc_nuevo = datos_nuevos.get("rfc")
    tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
    primer_apellido = datos_nuevos.get("primer_apellido")
    segundo_apellido = datos_nuevos.get("segundo_apellido")
    nombres = datos_nuevos.get("nombres")
    razon_social = datos_nuevos.get("razon_social")

    if not clave:
        raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

    if not nombre_nuevo:
        raise HTTPException(status_code=400, detail="Movimiento sin nombre nuevo")

    # 1) Leer datos actuales del padrón
    cur.execute("""
        SELECT nombre_completo
        FROM catalogos.padron_2026
        WHERE clave_catastral = %s
        LIMIT 1;
    """, (clave,))
    padron_actual = cur.fetchone()

    if not padron_actual:
        raise HTTPException(
            status_code=404,
            detail="No se encontró la clave en catalogos.padron_2026"
        )

    nombre_anterior = padron_actual.get("nombre_completo")

    # 2) Actualizar padron_2026
    cur.execute("""
        UPDATE catalogos.padron_2026
        SET nombre_completo = %s
        WHERE clave_catastral = %s
        RETURNING clave_catastral, nombre_completo;
    """, (nombre_nuevo, clave))
    padron_actualizado = cur.fetchone()

    # 3) Buscar propietario/persona vigente relacionado al predio
    cur.execute("""
        SELECT
            pp.id AS predio_propietario_id,
            pp.id_persona,
            per.rfc AS rfc_anterior,
            per.nombre AS nombre_persona_anterior
        FROM catastro.predio_propietario pp
        LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
        WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
        ORDER BY COALESCE(pp.titular_principal, false) DESC, pp.id DESC
        LIMIT 1;
    """, (clave,))
    rel = cur.fetchone()

    persona_actualizada = None
    rfc_anterior = None

    if rel and rel.get("id_persona"):
        rfc_anterior = rel.get("rfc_anterior")

        # Actualizar datos existentes de persona.
        # Se usa COALESCE por si algunas columnas no aplican en ciertos modelos.
        cur.execute("""
            UPDATE catalogos.personas
            SET
                nombre = %s,
                rfc = NULLIF(%s, ''),
                tipo_persona = NULLIF(%s, '')
            WHERE id_persona = %s
            RETURNING id_persona, nombre, rfc, tipo_persona;
        """, (
            nombre_nuevo,
            rfc_nuevo or "",
            tipo_persona_nuevo or "",
            rel["id_persona"]
        ))
        persona_actualizada = cur.fetchone()

    else:
        # Si no existe relación, crear persona base y relación predio-propietario.
        cur.execute("""
            INSERT INTO catalogos.personas (
                nombre,
                rfc,
                tipo_persona
            )
            VALUES (%s, NULLIF(%s, ''), NULLIF(%s, ''))
            RETURNING id_persona, nombre, rfc, tipo_persona;
        """, (
            nombre_nuevo,
            rfc_nuevo or "",
            tipo_persona_nuevo or ""
        ))
        persona_actualizada = cur.fetchone()

        cur.execute("""
            INSERT INTO catastro.predio_propietario (
                clave_catastral,
                id_persona,
                porcentaje_propiedad,
                titular_principal,
                tipo_titularidad
            )
            VALUES (%s, %s, 100, TRUE, 'PROPIETARIO');
        """, (
            clave,
            persona_actualizada["id_persona"]
        ))

    # 4) Historial titularidad
    cur.execute("""
        INSERT INTO catastro.historial_titularidad (
            clave_catastral,
            movimiento_id,
            tipo_evento,
            nombre_anterior,
            nombre_nuevo,
            tipo_titularidad_nueva,
            documento_soporte,
            motivo,
            usuario_modifica
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s);
    """, (
        clave,
        movimiento_id,
        tipo,
        nombre_anterior,
        nombre_nuevo,
        tipo_persona_nuevo,
        None,
        mov.get("motivo"),
        usuario
    ))

    # 5) Auditoría
    cur.execute("""
        INSERT INTO auditoria.movimientos_padron_auditoria (
            movimiento_id,
            clave_catastral,
            accion,
            estado_anterior,
            estado_nuevo,
            detalle,
            datos,
            usuario,
            ip
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
    """, (
        movimiento_id,
        clave,
        "APLICAR_TITULARIDAD_COMPLETA",
        mov["estado"],
        "APLICADO",
        "Cambio aplicado a catalogos.padron_2026 y catalogos.personas",
        json.dumps({
            "padron_2026": {
                "nombre_anterior": nombre_anterior,
                "nombre_nuevo": nombre_nuevo
            },
            "personas": {
                "rfc_anterior": rfc_anterior,
                "rfc_nuevo": rfc_nuevo,
                "tipo_persona": tipo_persona_nuevo,
                "primer_apellido": primer_apellido,
                "segundo_apellido": segundo_apellido,
                "nombres": nombres,
                "razon_social": razon_social
            }
        }),
        usuario,
        ip
    ))

    # 6) Marcar aplicado
    cur.execute("""
        UPDATE catastro.movimientos_padron
        SET estado = 'APLICADO',
            usuario_aplica = %s,
            fecha_aplicacion = now()
        WHERE id = %s
        RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
    """, (usuario, movimiento_id))
    mov_final = cur.fetchone()

    return {
        "ok": True,
        "mensaje": "Movimiento de titularidad aplicado correctamente",
        "movimiento": mov_final,
        "actualizado": {
            "clave_catastral": clave,
            "nombre_completo": nombre_nuevo,
            "rfc": rfc_nuevo,
            "tipo_persona": tipo_persona_nuevo
        },
        "persona": persona_actualizada,
        "padron": padron_actualizado
    }


@app.post("/movimientos/{movimiento_id}/aplicar-titularidad")
def aplicar_movimiento_titularidad_completa(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            resultado = aplicar_titularidad_completa(
                cur,
                movimiento_id,
                usuario,
                request.client.host if request.client else None
            )
            conn.commit()
            return resultado




# ============================================================
# v27g - APLICACIÓN FLEXIBLE TITULARIDAD / RFC
# Permite aplicar:
# - cambio de nombre
# - solo RFC
# - tipo_persona
# - titularidad completa
# ============================================================

def extraer_json_dict_v27g(valor):
    if valor is None:
        return {}
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except Exception:
            return {}
    return {}


@app.post("/movimientos/{movimiento_id}/aplicar-titularidad-v27g")
def aplicar_movimiento_titularidad_v27g(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()

            if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
                )

            clave = mov["clave_catastral"]
            if not clave:
                raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

            datos_nuevos = extraer_json_dict_v27g(mov.get("datos_nuevos"))

            nombre_nuevo = (
                datos_nuevos.get("nombre_propietario")
                or datos_nuevos.get("nombre_completo")
                or datos_nuevos.get("razon_social")
            )

            rfc_nuevo = datos_nuevos.get("rfc")
            tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
            primer_apellido = datos_nuevos.get("primer_apellido")
            segundo_apellido = datos_nuevos.get("segundo_apellido")
            nombres = datos_nuevos.get("nombres")
            razon_social = datos_nuevos.get("razon_social")

            # Leer padrón actual
            cur.execute("""
                SELECT nombre_completo
                FROM catalogos.padron_2026
                WHERE clave_catastral = %s
                LIMIT 1;
            """, (clave,))
            padron_actual = cur.fetchone()

            if not padron_actual:
                raise HTTPException(
                    status_code=404,
                    detail="No se encontró la clave en catalogos.padron_2026"
                )

            nombre_anterior = padron_actual.get("nombre_completo")

            # Si no viene nombre nuevo, conservar el actual para permitir RFC-only
            if not nombre_nuevo:
                nombre_nuevo = nombre_anterior

            # Validar que al menos haya algo que aplicar
            if not nombre_nuevo and not rfc_nuevo and not tipo_persona_nuevo:
                raise HTTPException(
                    status_code=400,
                    detail="No se encontró nombre, RFC o tipo de persona para aplicar"
                )

            # Actualizar nombre en padrón solo si cambió o si viene explícito
            padron_actualizado = None
            if nombre_nuevo:
                cur.execute("""
                    UPDATE catalogos.padron_2026
                    SET nombre_completo = %s
                    WHERE clave_catastral = %s
                    RETURNING clave_catastral, nombre_completo;
                """, (nombre_nuevo, clave))
                padron_actualizado = cur.fetchone()

            # Buscar relación persona
            cur.execute("""
                SELECT
                    pp.id AS predio_propietario_id,
                    pp.id_persona,
                    per.rfc AS rfc_anterior,
                    per.nombre AS nombre_persona_anterior,
                    per.tipo_persona AS tipo_persona_anterior
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                ORDER BY COALESCE(pp.titular_principal, false) DESC, pp.id DESC
                LIMIT 1;
            """, (clave,))
            rel = cur.fetchone()

            persona_actualizada = None
            rfc_anterior = None
            tipo_persona_anterior = None

            if rel and rel.get("id_persona"):
                rfc_anterior = rel.get("rfc_anterior")
                tipo_persona_anterior = rel.get("tipo_persona_anterior")

                cur.execute("""
                    UPDATE catalogos.personas
                    SET
                        nombre = COALESCE(NULLIF(%s, ''), nombre),
                        rfc = COALESCE(NULLIF(%s, ''), rfc),
                        tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)
                    WHERE id_persona = %s
                    RETURNING id_persona, nombre, rfc, tipo_persona;
                """, (
                    nombre_nuevo or "",
                    rfc_nuevo or "",
                    tipo_persona_nuevo or "",
                    rel["id_persona"]
                ))
                persona_actualizada = cur.fetchone()

            else:
                cur.execute("""
                    INSERT INTO catalogos.personas (
                        nombre,
                        rfc,
                        tipo_persona
                    )
                    VALUES (%s, NULLIF(%s, ''), NULLIF(%s, ''))
                    RETURNING id_persona, nombre, rfc, tipo_persona;
                """, (
                    nombre_nuevo or "",
                    rfc_nuevo or "",
                    tipo_persona_nuevo or ""
                ))
                persona_actualizada = cur.fetchone()

                cur.execute("""
                    INSERT INTO catastro.predio_propietario (
                        clave_catastral,
                        id_persona,
                        porcentaje_propiedad,
                        titular_principal,
                        tipo_titularidad
                    )
                    VALUES (%s, %s, 100, TRUE, 'PROPIETARIO');
                """, (
                    clave,
                    persona_actualizada["id_persona"]
                ))

            # Historial
            cur.execute("""
                INSERT INTO catastro.historial_titularidad (
                    clave_catastral,
                    movimiento_id,
                    tipo_evento,
                    nombre_anterior,
                    nombre_nuevo,
                    tipo_titularidad_nueva,
                    motivo,
                    usuario_modifica
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
            """, (
                clave,
                movimiento_id,
                tipo,
                nombre_anterior,
                nombre_nuevo,
                tipo_persona_nuevo,
                mov.get("motivo"),
                usuario
            ))

            # Auditoría
            cur.execute("""
                INSERT INTO auditoria.movimientos_padron_auditoria (
                    movimiento_id,
                    clave_catastral,
                    accion,
                    estado_anterior,
                    estado_nuevo,
                    detalle,
                    datos,
                    usuario,
                    ip
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
            """, (
                movimiento_id,
                clave,
                "APLICAR_TITULARIDAD_RFC_V27G",
                mov["estado"],
                "APLICADO",
                "Cambio aplicado a catalogos.padron_2026 y catalogos.personas",
                json.dumps({
                    "padron_2026": {
                        "nombre_anterior": nombre_anterior,
                        "nombre_nuevo": nombre_nuevo
                    },
                    "personas": {
                        "rfc_anterior": rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_anterior": tipo_persona_anterior,
                        "tipo_persona_nuevo": tipo_persona_nuevo,
                        "primer_apellido": primer_apellido,
                        "segundo_apellido": segundo_apellido,
                        "nombres": nombres,
                        "razon_social": razon_social
                    }
                }),
                usuario,
                request.client.host if request.client else None
            ))

            cur.execute("""
                UPDATE catastro.movimientos_padron
                SET estado = 'APLICADO',
                    usuario_aplica = %s,
                    fecha_aplicacion = now()
                WHERE id = %s
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
            """, (usuario, movimiento_id))
            mov_final = cur.fetchone()

            conn.commit()

            return {
                "ok": True,
                "mensaje": "Movimiento de titularidad/RFC aplicado correctamente",
                "movimiento": mov_final,
                "actualizado": {
                    "clave_catastral": clave,
                    "nombre_completo": nombre_nuevo,
                    "rfc": rfc_nuevo,
                    "tipo_persona": tipo_persona_nuevo
                },
                "persona": persona_actualizada,
                "padron": padron_actualizado
            }




# ============================================================
# v27h - FIX predio_propietario sin pp.id
# Aplicación flexible titularidad/RFC sin depender de pp.id
# ============================================================

def columnas_tabla_v27h(cur, esquema: str, tabla: str):
    cur.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s
          AND table_name = %s;
    """, (esquema, tabla))
    return {r["column_name"] for r in cur.fetchall()}


def extraer_json_dict_v27h(valor):
    if valor is None:
        return {}
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except Exception:
            return {}
    return {}


@app.post("/movimientos/{movimiento_id}/aplicar-titularidad-v27h")
def aplicar_movimiento_titularidad_v27h(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()

            if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
                )

            clave = mov["clave_catastral"]
            if not clave:
                raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

            datos_nuevos = extraer_json_dict_v27h(mov.get("datos_nuevos"))

            nombre_nuevo = (
                datos_nuevos.get("nombre_propietario")
                or datos_nuevos.get("nombre_completo")
                or datos_nuevos.get("razon_social")
            )

            rfc_nuevo = datos_nuevos.get("rfc")
            tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
            primer_apellido = datos_nuevos.get("primer_apellido")
            segundo_apellido = datos_nuevos.get("segundo_apellido")
            nombres = datos_nuevos.get("nombres")
            razon_social = datos_nuevos.get("razon_social")

            # 1) Padrón actual
            cur.execute("""
                SELECT nombre_completo
                FROM catalogos.padron_2026
                WHERE clave_catastral = %s
                LIMIT 1;
            """, (clave,))
            padron_actual = cur.fetchone()

            if not padron_actual:
                raise HTTPException(
                    status_code=404,
                    detail="No se encontró la clave en catalogos.padron_2026"
                )

            nombre_anterior = padron_actual.get("nombre_completo")

            # Si solo se actualiza RFC, conservar nombre actual
            if not nombre_nuevo:
                nombre_nuevo = nombre_anterior

            if not nombre_nuevo and not rfc_nuevo and not tipo_persona_nuevo:
                raise HTTPException(
                    status_code=400,
                    detail="No se encontró nombre, RFC o tipo de persona para aplicar"
                )

            # 2) Actualizar catalogos.padron_2026
            cur.execute("""
                UPDATE catalogos.padron_2026
                SET nombre_completo = %s
                WHERE clave_catastral = %s
                RETURNING clave_catastral, nombre_completo;
            """, (nombre_nuevo, clave))
            padron_actualizado = cur.fetchone()

            cols_pp = columnas_tabla_v27h(cur, "catastro", "predio_propietario")
            cols_personas = columnas_tabla_v27h(cur, "catalogos", "personas")

            if "clave_catastral" not in cols_pp or "id_persona" not in cols_pp:
                raise HTTPException(
                    status_code=500,
                    detail="catastro.predio_propietario debe tener clave_catastral e id_persona"
                )

            if "id_persona" not in cols_personas:
                raise HTTPException(
                    status_code=500,
                    detail="catalogos.personas debe tener id_persona"
                )

            # 3) Buscar persona relacionada SIN usar pp.id
            cur.execute("""
                SELECT
                    pp.id_persona,
                    per.rfc AS rfc_anterior,
                    per.nombre AS nombre_persona_anterior,
                    per.tipo_persona AS tipo_persona_anterior
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                ORDER BY pp.id_persona DESC
                LIMIT 1;
            """, (clave,))
            rel = cur.fetchone()

            persona_actualizada = None
            rfc_anterior = None
            tipo_persona_anterior = None

            # Columnas que realmente podemos actualizar en catalogos.personas
            set_parts = []
            params = []

            if "nombre" in cols_personas:
                set_parts.append("nombre = COALESCE(NULLIF(%s, ''), nombre)")
                params.append(nombre_nuevo or "")

            if "rfc" in cols_personas:
                set_parts.append("rfc = COALESCE(NULLIF(%s, ''), rfc)")
                params.append(rfc_nuevo or "")

            if "tipo_persona" in cols_personas:
                set_parts.append("tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)")
                params.append(tipo_persona_nuevo or "")

            if rel and rel.get("id_persona"):
                rfc_anterior = rel.get("rfc_anterior")
                tipo_persona_anterior = rel.get("tipo_persona_anterior")

                if set_parts:
                    params.append(rel["id_persona"])
                    sql_update_persona = f"""
                        UPDATE catalogos.personas
                        SET {", ".join(set_parts)}
                        WHERE id_persona = %s
                        RETURNING *;
                    """
                    cur.execute(sql_update_persona, params)
                    persona_actualizada = cur.fetchone()

            else:
                # Crear persona mínima si no existe relación.
                insert_cols = []
                insert_vals = []
                insert_params = []

                if "nombre" in cols_personas:
                    insert_cols.append("nombre")
                    insert_vals.append("%s")
                    insert_params.append(nombre_nuevo or "")

                if "rfc" in cols_personas:
                    insert_cols.append("rfc")
                    insert_vals.append("NULLIF(%s, '')")
                    insert_params.append(rfc_nuevo or "")

                if "tipo_persona" in cols_personas:
                    insert_cols.append("tipo_persona")
                    insert_vals.append("NULLIF(%s, '')")
                    insert_params.append(tipo_persona_nuevo or "")

                if not insert_cols:
                    raise HTTPException(
                        status_code=500,
                        detail="catalogos.personas no tiene columnas actualizables para titularidad"
                    )

                sql_insert_persona = f"""
                    INSERT INTO catalogos.personas ({", ".join(insert_cols)})
                    VALUES ({", ".join(insert_vals)})
                    RETURNING *;
                """
                cur.execute(sql_insert_persona, insert_params)
                persona_actualizada = cur.fetchone()

                nueva_id_persona = persona_actualizada.get("id_persona")

                # Insertar relación con solo columnas existentes
                rel_cols = ["clave_catastral", "id_persona"]
                rel_vals = ["%s", "%s"]
                rel_params = [clave, nueva_id_persona]

                if "porcentaje_propiedad" in cols_pp:
                    rel_cols.append("porcentaje_propiedad")
                    rel_vals.append("%s")
                    rel_params.append(100)

                if "titular_principal" in cols_pp:
                    rel_cols.append("titular_principal")
                    rel_vals.append("%s")
                    rel_params.append(True)

                if "tipo_titularidad" in cols_pp:
                    rel_cols.append("tipo_titularidad")
                    rel_vals.append("%s")
                    rel_params.append("PROPIETARIO")

                sql_insert_rel = f"""
                    INSERT INTO catastro.predio_propietario ({", ".join(rel_cols)})
                    VALUES ({", ".join(rel_vals)});
                """
                cur.execute(sql_insert_rel, rel_params)

            # 4) Historial titularidad
            cur.execute("""
                INSERT INTO catastro.historial_titularidad (
                    clave_catastral,
                    movimiento_id,
                    tipo_evento,
                    nombre_anterior,
                    nombre_nuevo,
                    tipo_titularidad_nueva,
                    motivo,
                    usuario_modifica
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
            """, (
                clave,
                movimiento_id,
                tipo,
                nombre_anterior,
                nombre_nuevo,
                tipo_persona_nuevo,
                mov.get("motivo"),
                usuario
            ))

            # 5) Auditoría
            cur.execute("""
                INSERT INTO auditoria.movimientos_padron_auditoria (
                    movimiento_id,
                    clave_catastral,
                    accion,
                    estado_anterior,
                    estado_nuevo,
                    detalle,
                    datos,
                    usuario,
                    ip
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
            """, (
                movimiento_id,
                clave,
                "APLICAR_TITULARIDAD_RFC_V27H",
                mov["estado"],
                "APLICADO",
                "Cambio aplicado a catalogos.padron_2026 y catalogos.personas sin depender de pp.id",
                json.dumps({
                    "padron_2026": {
                        "nombre_anterior": nombre_anterior,
                        "nombre_nuevo": nombre_nuevo
                    },
                    "personas": {
                        "rfc_anterior": rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_anterior": tipo_persona_anterior,
                        "tipo_persona_nuevo": tipo_persona_nuevo,
                        "primer_apellido": primer_apellido,
                        "segundo_apellido": segundo_apellido,
                        "nombres": nombres,
                        "razon_social": razon_social
                    }
                }),
                usuario,
                request.client.host if request.client else None
            ))

            # 6) Movimiento aplicado
            cur.execute("""
                UPDATE catastro.movimientos_padron
                SET estado = 'APLICADO',
                    usuario_aplica = %s,
                    fecha_aplicacion = now()
                WHERE id = %s
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
            """, (usuario, movimiento_id))
            mov_final = cur.fetchone()

            conn.commit()

            return {
                "ok": True,
                "mensaje": "Movimiento de titularidad/RFC aplicado correctamente",
                "movimiento": mov_final,
                "actualizado": {
                    "clave_catastral": clave,
                    "nombre_completo": nombre_nuevo,
                    "rfc": rfc_nuevo,
                    "tipo_persona": tipo_persona_nuevo
                },
                "persona": persona_actualizada,
                "padron": padron_actualizado
            }




# ============================================================
# v27i - APLICACIÓN TITULARIDAD ACTUALIZANDO predio_propietario.rfc
# La ficha v_ficha_predial toma RFC desde catastro.predio_propietario.rfc
# ============================================================

@app.post("/movimientos/{movimiento_id}/aplicar-titularidad-v27i")
def aplicar_movimiento_titularidad_v27i(
    movimiento_id: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    usuario = usuario_actual.get("usuario")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT *
                FROM catastro.movimientos_padron
                WHERE id = %s;
            """, (movimiento_id,))
            mov = cur.fetchone()

            if not mov:
                raise HTTPException(status_code=404, detail="Movimiento no encontrado")

            if mov["estado"] == "APLICADO":
                raise HTTPException(status_code=400, detail="El movimiento ya fue aplicado")

            tipo = str(mov["tipo_movimiento"] or "").upper()
            if tipo not in ["CAMBIO_NOMBRE", "CAMBIO_TITULARIDAD"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"El tipo de movimiento {tipo} no corresponde a titularidad."
                )

            clave = mov["clave_catastral"]
            if not clave:
                raise HTTPException(status_code=400, detail="Movimiento sin clave catastral")

            datos_nuevos = extraer_json_dict_v27h(mov.get("datos_nuevos"))

            nombre_nuevo = (
                datos_nuevos.get("nombre_propietario")
                or datos_nuevos.get("nombre_completo")
                or datos_nuevos.get("razon_social")
            )

            rfc_nuevo = datos_nuevos.get("rfc")
            tipo_persona_nuevo = datos_nuevos.get("tipo_persona")
            primer_apellido = datos_nuevos.get("primer_apellido")
            segundo_apellido = datos_nuevos.get("segundo_apellido")
            nombres = datos_nuevos.get("nombres")
            razon_social = datos_nuevos.get("razon_social")

            cur.execute("""
                SELECT nombre_completo
                FROM catalogos.padron_2026
                WHERE clave_catastral = %s
                LIMIT 1;
            """, (clave,))
            padron_actual = cur.fetchone()

            if not padron_actual:
                raise HTTPException(
                    status_code=404,
                    detail="No se encontró la clave en catalogos.padron_2026"
                )

            nombre_anterior = padron_actual.get("nombre_completo")
            if not nombre_nuevo:
                nombre_nuevo = nombre_anterior

            cols_pp = columnas_tabla_v27h(cur, "catastro", "predio_propietario")
            cols_personas = columnas_tabla_v27h(cur, "catalogos", "personas")

            # 1) Actualizar nombre maestro del padrón
            cur.execute("""
                UPDATE catalogos.padron_2026
                SET nombre_completo = %s
                WHERE clave_catastral = %s
                RETURNING clave_catastral, nombre_completo;
            """, (nombre_nuevo, clave))
            padron_actualizado = cur.fetchone()

            # 2) Buscar relación predio_propietario
            cur.execute("""
                SELECT
                    pp.id_persona,
                    pp.rfc AS pp_rfc_anterior,
                    per.rfc AS persona_rfc_anterior,
                    per.nombre AS nombre_persona_anterior,
                    per.tipo_persona AS tipo_persona_anterior
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas per ON per.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                ORDER BY pp.id_persona DESC
                LIMIT 1;
            """, (clave,))
            rel = cur.fetchone()

            persona_actualizada = None
            predio_propietario_actualizado = None
            pp_rfc_anterior = None
            persona_rfc_anterior = None
            tipo_persona_anterior = None

            if rel:
                pp_rfc_anterior = rel.get("pp_rfc_anterior")
                persona_rfc_anterior = rel.get("persona_rfc_anterior")
                tipo_persona_anterior = rel.get("tipo_persona_anterior")

            # 3) Actualizar catastro.predio_propietario porque de ahí lee la ficha
            pp_set = []
            pp_params = []

            if "rfc" in cols_pp:
                pp_set.append("rfc = COALESCE(NULLIF(%s, ''), rfc)")
                pp_params.append(rfc_nuevo or "")

            if "tipo_persona" in cols_pp:
                pp_set.append("tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)")
                pp_params.append(tipo_persona_nuevo or "")

            if "nombre_completo" in cols_pp:
                pp_set.append("nombre_completo = COALESCE(NULLIF(%s, ''), nombre_completo)")
                pp_params.append(nombre_nuevo or "")

            if pp_set:
                pp_params.append(clave)
                cur.execute(f"""
                    UPDATE catastro.predio_propietario
                    SET {", ".join(pp_set)}
                    WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                    RETURNING *;
                """, pp_params)
                predio_propietario_actualizado = cur.fetchone()

            # 4) Actualizar catalogos.personas si existe relación
            if rel and rel.get("id_persona"):
                persona_set = []
                persona_params = []

                if "nombre" in cols_personas:
                    persona_set.append("nombre = COALESCE(NULLIF(%s, ''), nombre)")
                    persona_params.append(nombre_nuevo or "")

                if "rfc" in cols_personas:
                    persona_set.append("rfc = COALESCE(NULLIF(%s, ''), rfc)")
                    persona_params.append(rfc_nuevo or "")

                if "tipo_persona" in cols_personas:
                    persona_set.append("tipo_persona = COALESCE(NULLIF(%s, ''), tipo_persona)")
                    persona_params.append(tipo_persona_nuevo or "")

                if persona_set:
                    persona_params.append(rel["id_persona"])
                    cur.execute(f"""
                        UPDATE catalogos.personas
                        SET {", ".join(persona_set)}
                        WHERE id_persona = %s
                        RETURNING *;
                    """, persona_params)
                    persona_actualizada = cur.fetchone()

            # 5) Historial titularidad
            cur.execute("""
                INSERT INTO catastro.historial_titularidad (
                    clave_catastral,
                    movimiento_id,
                    tipo_evento,
                    nombre_anterior,
                    nombre_nuevo,
                    tipo_titularidad_nueva,
                    motivo,
                    usuario_modifica
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s);
            """, (
                clave,
                movimiento_id,
                tipo,
                nombre_anterior,
                nombre_nuevo,
                tipo_persona_nuevo,
                mov.get("motivo"),
                usuario
            ))

            # 6) Auditoría
            cur.execute("""
                INSERT INTO auditoria.movimientos_padron_auditoria (
                    movimiento_id,
                    clave_catastral,
                    accion,
                    estado_anterior,
                    estado_nuevo,
                    detalle,
                    datos,
                    usuario,
                    ip
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s);
            """, (
                movimiento_id,
                clave,
                "APLICAR_TITULARIDAD_RFC_V27I",
                mov["estado"],
                "APLICADO",
                "Cambio aplicado a padron_2026, predio_propietario.rfc y catalogos.personas",
                json.dumps({
                    "padron_2026": {
                        "nombre_anterior": nombre_anterior,
                        "nombre_nuevo": nombre_nuevo
                    },
                    "predio_propietario": {
                        "rfc_anterior": pp_rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_nuevo": tipo_persona_nuevo
                    },
                    "personas": {
                        "rfc_anterior": persona_rfc_anterior,
                        "rfc_nuevo": rfc_nuevo,
                        "tipo_persona_anterior": tipo_persona_anterior,
                        "tipo_persona_nuevo": tipo_persona_nuevo,
                        "primer_apellido": primer_apellido,
                        "segundo_apellido": segundo_apellido,
                        "nombres": nombres,
                        "razon_social": razon_social
                    }
                }),
                usuario,
                request.client.host if request.client else None
            ))

            # 7) Movimiento aplicado
            cur.execute("""
                UPDATE catastro.movimientos_padron
                SET estado = 'APLICADO',
                    usuario_aplica = %s,
                    fecha_aplicacion = now()
                WHERE id = %s
                RETURNING id, folio, clave_catastral, tipo_movimiento, estado;
            """, (usuario, movimiento_id))
            mov_final = cur.fetchone()

            conn.commit()

            return {
                "ok": True,
                "mensaje": "Movimiento de titularidad/RFC aplicado correctamente",
                "movimiento": mov_final,
                "actualizado": {
                    "clave_catastral": clave,
                    "nombre_completo": nombre_nuevo,
                    "rfc": rfc_nuevo,
                    "tipo_persona": tipo_persona_nuevo
                },
                "padron": padron_actualizado,
                "predio_propietario": predio_propietario_actualizado,
                "persona": persona_actualizada
            }




# ============================================================
# v28 - CATÁLOGO DE PROPIETARIOS Y COPROPIETARIOS
# Soporta búsqueda/alta/edición de personas y titularidad múltiple
# sobre catalogos.personas + catastro.predio_propietario.
# ============================================================

class PropietarioPersonaPayload(BaseModel):
    tipo_persona: str = "FISICA"
    nombre: Optional[str] = None
    apellido_paterno: Optional[str] = None
    apellido_materno: Optional[str] = None
    razon_social: Optional[str] = None
    rfc: Optional[str] = None
    curp: Optional[str] = None
    activo: Optional[bool] = True


class PredioPropietarioPayload(BaseModel):
    id_persona: int
    porcentaje_propiedad: float
    tipo_titularidad: Optional[str] = "PROPIETARIO"


class PredioPropietariosReemplazoPayload(BaseModel):
    propietarios: list[PredioPropietarioPayload]


def upper_clean_v28(valor):
    if valor is None:
        return None
    txt = str(valor).strip().upper()
    return txt if txt else None


def nombre_persona_sql_v28(alias="p"):
    return f"""
        CASE
            WHEN UPPER(COALESCE({alias}.tipo_persona, 'FISICA')) = 'MORAL' THEN
                UPPER(TRIM(COALESCE({alias}.razon_social, '')))
            ELSE
                UPPER(TRIM(
                    COALESCE({alias}.apellido_paterno, '') || ' ' ||
                    COALESCE({alias}.apellido_materno, '') || ' ' ||
                    COALESCE({alias}.nombre, '')
                ))
        END
    """


def validar_porcentaje_v28(valor):
    try:
        numero = float(valor)
    except Exception:
        raise HTTPException(status_code=400, detail="Porcentaje inválido")
    if numero < 0 or numero > 100:
        raise HTTPException(status_code=400, detail="El porcentaje debe estar entre 0 y 100")
    return round(numero, 6)


def suma_propiedad_vigente_v28(cur, clave: str, excluir_id_persona: Optional[int] = None):
    params = [clave]
    filtro_extra = ""
    if excluir_id_persona is not None:
        filtro_extra = " AND id_persona <> %s"
        params.append(excluir_id_persona)

    cur.execute(f"""
        SELECT COALESCE(SUM(porcentaje_propiedad), 0) AS suma
        FROM catastro.predio_propietario
        WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
          AND vigente = TRUE
          {filtro_extra};
    """, tuple(params))
    row = cur.fetchone()
    return float(row["suma"] or 0)


def registrar_auditoria_simple_v28(cur, usuario: str, accion: str, modulo: str, detalle: str, ip: Optional[str] = None):
    try:
        cur.execute("""
            INSERT INTO seguridad.auditoria_sistema
            (usuario, accion, modulo, detalle, ip)
            VALUES (%s,%s,%s,%s,%s);
        """, (usuario, accion, modulo, detalle, ip))
    except Exception:
        # La auditoría no debe impedir la operación principal.
        pass


@app.get("/propietarios/buscar")
def buscar_propietarios_catalogo(
    q: str = Query("", max_length=150),
    limite: int = Query(25, ge=1, le=100),
    usuario_actual: dict = Depends(permiso_movimientos)
):
    texto = upper_clean_v28(q) or ""
    like = f"%{texto}%"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT
                    p.id_persona,
                    UPPER(COALESCE(p.tipo_persona, 'FISICA')) AS tipo_persona,
                    p.nombre,
                    p.apellido_paterno,
                    p.apellido_materno,
                    p.razon_social,
                    p.rfc,
                    p.curp,
                    p.activo,
                    {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catalogos.personas p
                WHERE COALESCE(p.activo, TRUE) = TRUE
                  AND (
                        %s = ''
                        OR {nombre_persona_sql_v28('p')} ILIKE %s
                        OR COALESCE(p.rfc, '') ILIKE %s
                        OR COALESCE(p.curp, '') ILIKE %s
                  )
                ORDER BY nombre_completo
                LIMIT %s;
            """, (texto, like, like, like, limite))
            rows = cur.fetchall()
            return {
                "total": len(rows),
                "propietarios": rows
            }


@app.get("/propietarios/{id_persona}")
def obtener_propietario_catalogo(
    id_persona: int,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT
                    p.*,
                    {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catalogos.personas p
                WHERE p.id_persona = %s;
            """, (id_persona,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Propietario no encontrado")
            return row


@app.post("/propietarios")
def crear_propietario_catalogo(
    payload: PropietarioPersonaPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    tipo = upper_clean_v28(payload.tipo_persona) or "FISICA"
    if tipo not in ["FISICA", "MORAL"]:
        raise HTTPException(status_code=400, detail="tipo_persona debe ser FISICA o MORAL")

    nombre = upper_clean_v28(payload.nombre)
    ap_pat = upper_clean_v28(payload.apellido_paterno)
    ap_mat = upper_clean_v28(payload.apellido_materno)
    razon = upper_clean_v28(payload.razon_social)
    rfc = upper_clean_v28(payload.rfc)
    curp = upper_clean_v28(payload.curp)

    if tipo == "MORAL" and not razon:
        raise HTTPException(status_code=400, detail="Razón social obligatoria para persona moral")
    if tipo == "FISICA" and not (nombre or ap_pat or ap_mat):
        raise HTTPException(status_code=400, detail="Debe capturar apellido o nombre para persona física")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO catalogos.personas (
                    tipo_persona,
                    nombre,
                    apellido_paterno,
                    apellido_materno,
                    razon_social,
                    rfc,
                    curp,
                    activo,
                    fecha_creacion
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now())
                RETURNING *;
            """, (
                tipo,
                nombre,
                ap_pat,
                ap_mat,
                razon,
                rfc,
                curp,
                bool(payload.activo if payload.activo is not None else True)
            ))
            row = cur.fetchone()
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "CREAR_PROPIETARIO",
                "PROPIETARIOS",
                f"Propietario creado id_persona={row['id_persona']}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {"ok": True, "propietario": row}


@app.put("/propietarios/{id_persona}")
def actualizar_propietario_catalogo(
    id_persona: int,
    payload: PropietarioPersonaPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    tipo = upper_clean_v28(payload.tipo_persona) or "FISICA"
    if tipo not in ["FISICA", "MORAL"]:
        raise HTTPException(status_code=400, detail="tipo_persona debe ser FISICA o MORAL")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE catalogos.personas
                SET
                    tipo_persona = %s,
                    nombre = %s,
                    apellido_paterno = %s,
                    apellido_materno = %s,
                    razon_social = %s,
                    rfc = %s,
                    curp = %s,
                    activo = %s
                WHERE id_persona = %s
                RETURNING *;
            """, (
                tipo,
                upper_clean_v28(payload.nombre),
                upper_clean_v28(payload.apellido_paterno),
                upper_clean_v28(payload.apellido_materno),
                upper_clean_v28(payload.razon_social),
                upper_clean_v28(payload.rfc),
                upper_clean_v28(payload.curp),
                bool(payload.activo if payload.activo is not None else True),
                id_persona
            ))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Propietario no encontrado")
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ACTUALIZAR_PROPIETARIO",
                "PROPIETARIOS",
                f"Propietario actualizado id_persona={id_persona}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {"ok": True, "propietario": row}


@app.get("/predios/{clave}/propietarios")
def listar_propietarios_predio_v28(
    clave: str,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT
                    pp.id_predio_propietario,
                    pp.id_predio,
                    pp.clave_catastral,
                    pp.id_persona,
                    pp.porcentaje_propiedad,
                    pp.tipo_titularidad,
                    pp.vigente,
                    pp.fecha_inicio,
                    pp.fecha_fin,
                    p.tipo_persona,
                    p.nombre,
                    p.apellido_paterno,
                    p.apellido_materno,
                    p.razon_social,
                    p.rfc,
                    p.curp,
                    {nombre_persona_sql_v28('p')} AS nombre_completo
                FROM catastro.predio_propietario pp
                LEFT JOIN catalogos.personas p
                    ON p.id_persona = pp.id_persona
                WHERE UPPER(TRIM(pp.clave_catastral)) = UPPER(TRIM(%s))
                  AND pp.vigente = TRUE
                ORDER BY
                    CASE WHEN pp.tipo_titularidad = 'PROPIETARIO' THEN 1 ELSE 2 END,
                    pp.porcentaje_propiedad DESC,
                    nombre_completo;
            """, (clave,))
            rows = cur.fetchall()
            total_porcentaje = sum(float(r.get("porcentaje_propiedad") or 0) for r in rows)
            return {
                "clave_catastral": clave.upper(),
                "total": len(rows),
                "suma_porcentaje": round(total_porcentaje, 6),
                "valido": abs(total_porcentaje - 100) < 0.000001,
                "propietarios": rows
            }


@app.post("/predios/{clave}/propietarios")
def agregar_propietario_predio_v28(
    clave: str,
    payload: PredioPropietarioPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    porcentaje = validar_porcentaje_v28(payload.porcentaje_propiedad)
    tipo_titularidad = upper_clean_v28(payload.tipo_titularidad) or "PROPIETARIO"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id_persona FROM catalogos.personas WHERE id_persona = %s AND COALESCE(activo, TRUE)=TRUE;", (payload.id_persona,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="La persona no existe o está inactiva")

            suma_actual = suma_propiedad_vigente_v28(cur, clave, excluir_id_persona=payload.id_persona)
            suma_nueva = round(suma_actual + porcentaje, 6)
            if suma_nueva > 100.000001:
                raise HTTPException(
                    status_code=400,
                    detail=f"La suma de copropiedad no puede exceder 100%. Suma resultante: {suma_nueva}"
                )

            # Evita duplicar una persona vigente para la misma clave; si ya existe la actualiza.
            cur.execute("""
                SELECT id_predio_propietario
                FROM catastro.predio_propietario
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND id_persona = %s
                  AND vigente = TRUE
                LIMIT 1;
            """, (clave, payload.id_persona))
            existente = cur.fetchone()

            if existente:
                cur.execute("""
                    UPDATE catastro.predio_propietario
                    SET porcentaje_propiedad = %s,
                        tipo_titularidad = %s
                    WHERE id_predio_propietario = %s
                    RETURNING *;
                """, (porcentaje, tipo_titularidad, existente["id_predio_propietario"]))
            else:
                cur.execute("""
                    INSERT INTO catastro.predio_propietario (
                        clave_catastral,
                        id_persona,
                        porcentaje_propiedad,
                        tipo_titularidad,
                        vigente,
                        fecha_inicio
                    )
                    VALUES (%s,%s,%s,%s,TRUE,CURRENT_DATE)
                    RETURNING *;
                """, (clave.upper(), payload.id_persona, porcentaje, tipo_titularidad))

            row = cur.fetchone()
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "AGREGAR_COPROPIETARIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} id_persona={payload.id_persona} porcentaje={porcentaje}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "mensaje": "Propietario agregado/actualizado en el predio",
                "relacion": row,
                "suma_porcentaje": suma_nueva,
                "valido": abs(suma_nueva - 100) < 0.000001
            }


@app.put("/predios/{clave}/propietarios/{id_persona}")
def actualizar_propietario_predio_v28(
    clave: str,
    id_persona: int,
    payload: PredioPropietarioPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    porcentaje = validar_porcentaje_v28(payload.porcentaje_propiedad)
    tipo_titularidad = upper_clean_v28(payload.tipo_titularidad) or "PROPIETARIO"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            suma_actual = suma_propiedad_vigente_v28(cur, clave, excluir_id_persona=id_persona)
            suma_nueva = round(suma_actual + porcentaje, 6)
            if suma_nueva > 100.000001:
                raise HTTPException(
                    status_code=400,
                    detail=f"La suma de copropiedad no puede exceder 100%. Suma resultante: {suma_nueva}"
                )

            cur.execute("""
                UPDATE catastro.predio_propietario
                SET porcentaje_propiedad = %s,
                    tipo_titularidad = %s
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND id_persona = %s
                  AND vigente = TRUE
                RETURNING *;
            """, (porcentaje, tipo_titularidad, clave, id_persona))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Relación propietario-predio no encontrada")

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "ACTUALIZAR_COPROPIETARIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} id_persona={id_persona} porcentaje={porcentaje}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "relacion": row,
                "suma_porcentaje": suma_nueva,
                "valido": abs(suma_nueva - 100) < 0.000001
            }


@app.delete("/predios/{clave}/propietarios/{id_persona}")
def quitar_propietario_predio_v28(
    clave: str,
    id_persona: int,
    request: Request,
    usuario_actual: dict = Depends(permiso_movimientos)
):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE catastro.predio_propietario
                SET vigente = FALSE,
                    fecha_fin = CURRENT_DATE
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND id_persona = %s
                  AND vigente = TRUE
                RETURNING *;
            """, (clave, id_persona))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Relación propietario-predio no encontrada")

            suma = suma_propiedad_vigente_v28(cur, clave)
            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "QUITAR_COPROPIETARIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} id_persona={id_persona}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "relacion": row,
                "suma_porcentaje": suma,
                "valido": abs(suma - 100) < 0.000001
            }


@app.post("/predios/{clave}/propietarios/reemplazar")
def reemplazar_propietarios_predio_v28(
    clave: str,
    payload: PredioPropietariosReemplazoPayload,
    request: Request,
    usuario_actual: dict = Depends(permiso_aplicar_movimientos)
):
    propietarios = payload.propietarios or []
    if not propietarios:
        raise HTTPException(status_code=400, detail="Debe incluir al menos un propietario")

    ids = [p.id_persona for p in propietarios]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="No puede repetir el mismo propietario")

    suma = round(sum(validar_porcentaje_v28(p.porcentaje_propiedad) for p in propietarios), 6)
    if abs(suma - 100) > 0.000001:
        raise HTTPException(
            status_code=400,
            detail=f"La suma de copropiedad debe ser exactamente 100%. Suma actual: {suma}"
        )

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id_persona FROM catalogos.personas WHERE id_persona = ANY(%s) AND COALESCE(activo, TRUE)=TRUE;", (ids,))
            existentes = {r["id_persona"] for r in cur.fetchall()}
            faltantes = [i for i in ids if i not in existentes]
            if faltantes:
                raise HTTPException(status_code=404, detail=f"Personas no encontradas o inactivas: {faltantes}")

            cur.execute("""
                UPDATE catastro.predio_propietario
                SET vigente = FALSE,
                    fecha_fin = CURRENT_DATE
                WHERE UPPER(TRIM(clave_catastral)) = UPPER(TRIM(%s))
                  AND vigente = TRUE;
            """, (clave,))

            insertados = []
            for p in propietarios:
                cur.execute("""
                    INSERT INTO catastro.predio_propietario (
                        clave_catastral,
                        id_persona,
                        porcentaje_propiedad,
                        tipo_titularidad,
                        vigente,
                        fecha_inicio
                    )
                    VALUES (%s,%s,%s,%s,TRUE,CURRENT_DATE)
                    RETURNING *;
                """, (
                    clave.upper(),
                    p.id_persona,
                    validar_porcentaje_v28(p.porcentaje_propiedad),
                    upper_clean_v28(p.tipo_titularidad) or "PROPIETARIO"
                ))
                insertados.append(cur.fetchone())

            registrar_auditoria_simple_v28(
                cur,
                usuario_actual.get("usuario"),
                "REEMPLAZAR_TITULARIDAD_PREDIO",
                "COPROPIETARIOS",
                f"Clave {clave.upper()} titulares={len(insertados)} suma={suma}",
                request.client.host if request.client else None
            )
            conn.commit()
            return {
                "ok": True,
                "mensaje": "Titularidad reemplazada correctamente",
                "clave_catastral": clave.upper(),
                "suma_porcentaje": suma,
                "valido": True,
                "propietarios": insertados
            }
