from pydantic import BaseModel


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
