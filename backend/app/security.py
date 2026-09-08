from datetime import datetime, timedelta, timezone
from jose import jwt
from passlib.context import CryptContext
from .config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(subject: str, role: str, token_type: str = "access") -> str:
    settings = get_settings()
    lifetime = timedelta(minutes=settings.access_token_minutes) if token_type == "access" else timedelta(days=settings.refresh_token_days)
    payload = {"sub": subject, "role": role, "type": token_type, "exp": datetime.now(timezone.utc) + lifetime}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
