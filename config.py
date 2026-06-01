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
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
