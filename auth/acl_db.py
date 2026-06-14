"""ACL persistido en PostgreSQL (roles, permisos y asignaciones)."""
from auth.acl import ACL_BACKEND, normalizar_rol

DDL_ACL = """
CREATE TABLE IF NOT EXISTS seguridad.permisos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(80) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    es_sistema BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seguridad.rol_permisos (
    rol_id INTEGER NOT NULL REFERENCES seguridad.roles(id) ON DELETE CASCADE,
    permiso_id INTEGER NOT NULL REFERENCES seguridad.permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_rol_permisos_rol ON seguridad.rol_permisos (rol_id);
CREATE INDEX IF NOT EXISTS idx_rol_permisos_permiso ON seguridad.rol_permisos (permiso_id);
"""


def ensure_acl_db(cur) -> None:
    cur.execute(DDL_ACL)
    _sembrar_permisos_base(cur)
    _sembrar_roles_base(cur)
    _sincronizar_matriz_desde_codigo(cur)


def _todos_codigos_acl() -> set:
    codigos = set()
    for perms in ACL_BACKEND.values():
        codigos.update(perms)
    return codigos


def _sembrar_permisos_base(cur) -> None:
    for codigo in sorted(_todos_codigos_acl()):
        cur.execute(
            """
            INSERT INTO seguridad.permisos (codigo, descripcion, es_sistema, activo)
            VALUES (%s, %s, TRUE, TRUE)
            ON CONFLICT (codigo) DO NOTHING;
            """,
            (codigo, codigo.replace("_", " ")),
        )


def _sembrar_roles_base(cur) -> None:
    for rol in ACL_BACKEND.keys():
        cur.execute(
            "SELECT id FROM seguridad.roles WHERE LOWER(TRIM(nombre)) = %s LIMIT 1;",
            (rol.lower(),),
        )
        if cur.fetchone():
            continue
        cur.execute(
            """
            INSERT INTO seguridad.roles (nombre, descripcion)
            VALUES (%s, %s);
            """,
            (rol, "Rol del sistema"),
        )


def _sincronizar_matriz_desde_codigo(cur) -> None:
    """Si un rol no tiene permisos en BD, copia la matriz embebida ACL_BACKEND."""
    for rol_nombre, permisos in ACL_BACKEND.items():
        cur.execute(
            "SELECT id FROM seguridad.roles WHERE LOWER(TRIM(nombre)) = %s LIMIT 1;",
            (rol_nombre.lower(),),
        )
        row = cur.fetchone()
        if not row:
            continue
        rol_id = row["id"]
        cur.execute(
            "SELECT COUNT(*) AS n FROM seguridad.rol_permisos WHERE rol_id = %s;",
            (rol_id,),
        )
        if int((cur.fetchone() or {}).get("n") or 0) > 0:
            continue
        for codigo in permisos:
            cur.execute(
                "SELECT id FROM seguridad.permisos WHERE codigo = %s;",
                (codigo,),
            )
            perm = cur.fetchone()
            if not perm:
                continue
            cur.execute(
                """
                INSERT INTO seguridad.rol_permisos (rol_id, permiso_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING;
                """,
                (rol_id, perm["id"]),
            )


def listar_permisos_db(cur) -> list:
    ensure_acl_db(cur)
    cur.execute(
        """
        SELECT id, codigo, descripcion, activo, es_sistema
        FROM seguridad.permisos
        WHERE activo = TRUE
        ORDER BY codigo;
        """
    )
    return cur.fetchall() or []


def listar_roles_db(cur) -> list:
    ensure_acl_db(cur)
    cur.execute(
        """
        SELECT id, nombre, descripcion
        FROM seguridad.roles
        ORDER BY nombre;
        """
    )
    return cur.fetchall() or []


def permisos_por_rol_db(cur, rol: str) -> list:
    ensure_acl_db(cur)
    rol_norm = normalizar_rol(rol)
    cur.execute(
        """
        SELECT p.codigo
        FROM seguridad.roles r
        INNER JOIN seguridad.rol_permisos rp ON rp.rol_id = r.id
        INNER JOIN seguridad.permisos p ON p.id = rp.permiso_id AND p.activo = TRUE
        WHERE LOWER(TRIM(r.nombre)) = %s
        ORDER BY p.codigo;
        """,
        (rol_norm,),
    )
    rows = cur.fetchall() or []
    if rows:
        return [r["codigo"] for r in rows]
    return sorted(list(ACL_BACKEND.get(rol_norm, ACL_BACKEND["consulta"])))


def matriz_acl_db(cur) -> dict:
    ensure_acl_db(cur)
    roles = listar_roles_db(cur)
    permisos = listar_permisos_db(cur)
    matriz = {}
    detalle_roles = []
    for rol in roles:
        cur.execute(
            """
            SELECT p.codigo
            FROM seguridad.rol_permisos rp
            INNER JOIN seguridad.permisos p ON p.id = rp.permiso_id AND p.activo = TRUE
            WHERE rp.rol_id = %s
            ORDER BY p.codigo;
            """,
            (rol["id"],),
        )
        codes = [r["codigo"] for r in (cur.fetchall() or [])]
        nombre = str(rol["nombre"]).lower()
        matriz[nombre] = codes
        detalle_roles.append({
            "id": rol["id"],
            "nombre": nombre,
            "descripcion": rol.get("descripcion") or "",
            "permisos": codes,
        })
    return {
        "matriz": matriz,
        "roles": detalle_roles,
        "permisos": [
            {
                "id": p["id"],
                "codigo": p["codigo"],
                "descripcion": p.get("descripcion") or "",
                "es_sistema": bool(p.get("es_sistema")),
            }
            for p in permisos
        ],
    }


def crear_permiso_db(cur, codigo: str, descripcion: str | None = None) -> dict:
    ensure_acl_db(cur)
    cod = str(codigo or "").strip().lower().replace(" ", "_")
    if len(cod) < 2:
        raise ValueError("Código de permiso inválido")
    cur.execute(
        """
        INSERT INTO seguridad.permisos (codigo, descripcion, es_sistema, activo)
        VALUES (%s, %s, FALSE, TRUE)
        ON CONFLICT (codigo) DO UPDATE SET
            descripcion = COALESCE(EXCLUDED.descripcion, seguridad.permisos.descripcion),
            activo = TRUE
        RETURNING id, codigo, descripcion, es_sistema;
        """,
        (cod, (descripcion or cod.replace("_", " ")).strip()),
    )
    return dict(cur.fetchone())


def crear_rol_db(cur, nombre: str, descripcion: str | None = None, permisos: list | None = None) -> dict:
    ensure_acl_db(cur)
    nom = normalizar_rol(nombre)
    if len(nom) < 2:
        raise ValueError("Nombre de rol inválido")
    cur.execute(
        "SELECT id, nombre, descripcion FROM seguridad.roles WHERE LOWER(TRIM(nombre)) = %s LIMIT 1;",
        (nom,),
    )
    row = cur.fetchone()
    if not row:
        cur.execute(
            """
            INSERT INTO seguridad.roles (nombre, descripcion)
            VALUES (%s, %s)
            RETURNING id, nombre, descripcion;
            """,
            (nom, (descripcion or "").strip() or None),
        )
        row = cur.fetchone()
    elif descripcion:
        cur.execute(
            "UPDATE seguridad.roles SET descripcion = %s WHERE id = %s;",
            ((descripcion or "").strip() or None, row["id"]),
        )
    if permisos:
        asignar_permisos_rol_db(cur, int(row["id"]), permisos)
    cur.execute(
        """
        SELECT p.codigo FROM seguridad.rol_permisos rp
        INNER JOIN seguridad.permisos p ON p.id = rp.permiso_id
        WHERE rp.rol_id = %s ORDER BY p.codigo;
        """,
        (row["id"],),
    )
    codes = [r["codigo"] for r in (cur.fetchall() or [])]
    return {"id": row["id"], "nombre": nom, "descripcion": row.get("descripcion") or "", "permisos": codes}


def asignar_permisos_rol_db(cur, rol_id: int, permisos: list) -> list:
    ensure_acl_db(cur)
    cur.execute("SELECT id, nombre FROM seguridad.roles WHERE id = %s;", (rol_id,))
    rol = cur.fetchone()
    if not rol:
        raise ValueError("Rol no encontrado")
    codigos = []
    for p in permisos or []:
        c = str(p or "").strip().lower().replace(" ", "_")
        if c and c not in codigos:
            codigos.append(c)
    cur.execute("DELETE FROM seguridad.rol_permisos WHERE rol_id = %s;", (rol_id,))
    for codigo in codigos:
        cur.execute(
            "SELECT id FROM seguridad.permisos WHERE codigo = %s AND activo = TRUE;",
            (codigo,),
        )
        perm = cur.fetchone()
        if not perm:
            cur.execute(
                """
                INSERT INTO seguridad.permisos (codigo, descripcion, es_sistema, activo)
                VALUES (%s, %s, FALSE, TRUE)
                ON CONFLICT (codigo) DO UPDATE SET activo = TRUE
                RETURNING id;
                """,
                (codigo, codigo.replace("_", " ")),
            )
            perm = cur.fetchone()
        cur.execute(
            """
            INSERT INTO seguridad.rol_permisos (rol_id, permiso_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING;
            """,
            (rol_id, perm["id"]),
        )
    return codigos
