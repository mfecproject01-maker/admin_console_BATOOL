from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from app.core.config import settings

ALGORITHM = "HS256"

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
# Keep OAuth2PasswordBearer for backward-compatible Bearer token fallback
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT token, raising HTTPException on failure."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise credentials_exception
        return {"username": username}
    except JWTError:
        raise credentials_exception


async def get_current_user(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> dict:
    """
    Authenticate via HttpOnly cookie first, then fall back to Authorization header.
    This supports both the hardened cookie-based frontend and legacy Bearer token clients.
    """
    # 1. Prefer HttpOnly cookie (secure, not accessible to JS)
    cookie_token = request.cookies.get("ba_access_token")
    if cookie_token:
        return _decode_token(cookie_token)

    # 2. Fall back to Authorization: Bearer header (API clients / legacy)
    if bearer_token:
        return _decode_token(bearer_token)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
