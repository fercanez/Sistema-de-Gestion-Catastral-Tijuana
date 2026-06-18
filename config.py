import os
from dotenv import load_dotenv

load_dotenv()

# La SECRET_KEY DEBE venir del archivo .env. No se permite un valor por
# defecto inseguro: si falta o conserva el valor de ejemplo, la API no arranca.
SECRET_KEY = os.getenv("SECRET_KEY")
_SECRET_KEY_INSEGURA = "CATASTRO_BC_2026_CAMBIAR_EN_PRODUCCION"
if not SECRET_KEY or SECRET_KEY.strip() == "" or SECRET_KEY == _SECRET_KEY_INSEGURA:
    raise RuntimeError(
        "SECRET_KEY no configurada de forma segura. "
        "Define una SECRET_KEY robusta en el archivo .env (variable SECRET_KEY) "
        "antes de iniciar la API. Ejemplo para generarla: "
        'python -c "import secrets; print(secrets.token_urlsafe(64))"'
    )

ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
SESSION_INACTIVITY_MINUTES = int(os.getenv("SESSION_INACTIVITY_MINUTES", "15"))
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
GEONODE_DB_NAME = os.getenv("GEONODE_DB_NAME")

# RPPC Baja California (enlace remoto)
RPPC_BASE_URL = os.getenv(
    "RPPC_BASE_URL",
    "https://rppcweb.ebajacalifornia.gob.mx/rppweb/produccion",
).rstrip("/")
RPPC_USUARIO = os.getenv("RPPC_USUARIO", "").strip()
RPPC_PASSWORD = os.getenv("RPPC_PASSWORD", "").strip()
RPPC_SESSION_PATH = os.getenv(
    "RPPC_SESSION_PATH",
    "/rppapp/inicio?remoto=1",
).strip()
RPPC_LOGIN_PATH = os.getenv("RPPC_LOGIN_PATH", "").strip()
RPPC_REPORTES_PREFIX = os.getenv(
    "RPPC_REPORTES_PREFIX",
    "/WebAPI/Servicios/Reportes",
).strip().rstrip("/")
RPPC_MOVIMIENTOS_ACTION = os.getenv(
    "RPPC_MOVIMIENTOS_ACTION",
    "ObtenerLoteByFolioReal",
).strip()
RPPC_INSCRIPCIONES_ACTION = os.getenv(
    "RPPC_INSCRIPCIONES_ACTION",
    "obtenerInscripcionesPart",
).strip()
RPPC_DOCUMENTO_ACTION = os.getenv(
    "RPPC_DOCUMENTO_ACTION",
    "ObtenerDocumentoPorId",
).strip()
RPPC_TIMEOUT_POST = int(os.getenv("RPPC_TIMEOUT_POST", "40"))
RPPC_TIMEOUT_GET = int(os.getenv("RPPC_TIMEOUT_GET", "60"))
RPPC_SSL_LEGACY = os.getenv("RPPC_SSL_LEGACY", "1").strip().lower() in ("1", "true", "yes", "si")
RPPC_SSL_SECLEVEL = os.getenv("RPPC_SSL_SECLEVEL", "1" if RPPC_SSL_LEGACY else "2").strip()
RPPC_SSL_MIN_TLS = os.getenv("RPPC_SSL_MIN_TLS", "1.2" if not RPPC_SSL_LEGACY else "1.0").strip()
# Cookie RPPC opcional para pruebas / sesión manual.
# IMPORTANTE: no subir esta variable a GitHub; debe vivir solo en .env del servidor.
RPPC_COOKIE = os.getenv("RPPC_COOKIE", "").strip()

