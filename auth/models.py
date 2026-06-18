from pydantic import BaseModel


class LoginRequest(BaseModel):
    usuario: str
    password: str
    tipo_sesion: str | None = None


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


class AccesoModuloNuevo(BaseModel):
    modulo_id: str
    permiso: str = "acceso_modulo"
    fecha_inicio: str | None = None
    fecha_fin: str | None = None
    motivo: str | None = None


class AccesoModuloActualizar(BaseModel):
    modulo_id: str | None = None
    permiso: str | None = None
    fecha_inicio: str | None = None
    fecha_fin: str | None = None
    estado: str | None = None
    motivo: str | None = None


class AccesoModuloRenovar(BaseModel):
    dias: int = 30
    fecha_fin: str | None = None
    motivo: str | None = None


class AccesoModuloNegar(BaseModel):
    motivo: str | None = None


class RolNuevoAcl(BaseModel):
    nombre: str
    descripcion: str | None = None
    permisos: list[str] = []


class PermisoNuevoAcl(BaseModel):
    codigo: str
    descripcion: str | None = None


class RolPermisosAcl(BaseModel):
    permisos: list[str]
