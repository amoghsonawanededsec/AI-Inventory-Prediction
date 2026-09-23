from collections.abc import Callable
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from .config import get_settings
from .db import get_db
from .models import Business, User
from .security import ALGORITHM

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email or payload.get("type") != "access":
            raise ValueError("invalid token")
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token")
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive or missing")
    if user.role != "admin":
        business = db.get(Business, user.business_id) if user.business_id else None
        if not business or not business.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Business workspace is inactive or missing")
        db.info["business_id"] = business.id
        db.info["super_admin"] = False
    else:
        db.info["super_admin"] = True
    return user


def require_roles(*roles: str) -> Callable:
    def check(user: User = Depends(get_current_user)) -> User:
        owner_has_manager_access = user.role == "business_owner" and "manager" in roles
        if user.role not in roles and user.role != "admin" and not owner_has_manager_access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return check
