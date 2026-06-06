from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.core.ws_ticket import issue_ticket
from app.db.database import get_db
from app.db.models import SessionRecord
from app.schemas.schemas import APIResponse, LoginRequest
from app.services import auth_service
from app.routers.activity import record_activity

router = APIRouter(tags=["Auth"])

_IS_PROD = settings.ENVIRONMENT == "production"


def _set_auth_cookie(response: Response, token: str, max_age: int) -> None:
    """Set the auth token as a secure, HttpOnly cookie."""
    response.set_cookie(
        key="ba_access_token",
        value=token,
        max_age=max_age,
        httponly=True,
        secure=_IS_PROD,          # HTTPS-only in production
        samesite="lax",           # Protects against CSRF while allowing normal navigation
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    """Clear the auth cookie on logout."""
    response.delete_cookie(
        key="ba_access_token",
        path="/",
        httponly=True,
        secure=_IS_PROD,
        samesite="lax",
    )


class RefreshRequest(BaseModel):
    access_token: str


async def _upsert_auth_session(db: AsyncSession, username: str, ttl_minutes: int | None = None) -> None:
    session_id = f"auth-{username}"
    created = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    ttl = ttl_minutes if ttl_minutes is not None else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    result = await db.execute(select(SessionRecord).where(SessionRecord.id == session_id))
    record = result.scalar_one_or_none()

    if record:
        record.created = created
        record.ttl_minutes = ttl
        record.status_cache = "active"
    else:
        db.add(SessionRecord(
            id=session_id,
            user=username,
            role="admin" if username == settings.ADMIN_USERNAME else "user",
            db="admin-console",
            tables=0,
            ttl_minutes=ttl,
            created=created,
            status_cache="active",
        ))
    await db.commit()


@router.post("/login", response_model=APIResponse)
async def login(
    request: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    locked, remain = auth_service.is_login_locked(request.username)
    if locked:
        mins = max(1, (remain + 59) // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {mins} minute(s).",
        )

    ok = await auth_service.authenticate_user(request.username, request.password, db)
    if not ok:
        _, now_locked = await auth_service.record_failed_login(request.username, db)
        await record_activity(
            db=db,
            username=request.username,
            action="login_failed",
            target_type="auth",
            target_id=None,
            summary=f"Login failed: {request.username}",
            detail={"reason": "incorrect_password", "locked": now_locked},
        )
        await db.commit()
        if now_locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed attempts. Account locked for 15 minutes.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    auth_service.clear_login_lockout(request.username)
    token_data = await auth_service.generate_token(request.username, db)
    expire_min = token_data["expires_in"] // 60
    await _upsert_auth_session(db, request.username, expire_min)
    await auth_service.update_last_login(request.username, db)

    await record_activity(
        db=db,
        username=request.username,
        action="login",
        target_type="auth",
        target_id=None,
        summary=f"Login successful: {request.username}",
        detail={"expires_in": token_data["expires_in"]},
    )
    await db.commit()

    # Set secure HttpOnly cookie
    _set_auth_cookie(response, token_data["access_token"], token_data["expires_in"])

    # Return token in body as well for API/legacy clients
    return APIResponse(success=True, message="Login successful", data=token_data)


@router.post("/refresh", response_model=APIResponse)
async def refresh_token(
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token_data = await auth_service.generate_token(current_user["username"], db)
    expire_min = token_data["expires_in"] // 60
    await _upsert_auth_session(db, current_user["username"], expire_min)

    # Refresh the cookie with new token
    _set_auth_cookie(response, token_data["access_token"], token_data["expires_in"])

    return APIResponse(success=True, message="Token refreshed", data=token_data)


@router.get("/me", response_model=APIResponse)
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from app.db.models import AdminUser
    username = current_user["username"]
    result = await db.execute(select(AdminUser).where(AdminUser.username == username))
    user_rec = result.scalar_one_or_none()
    role = user_rec.role if user_rec else ("admin" if username == settings.ADMIN_USERNAME else "viewer")
    return APIResponse(success=True, message="OK", data={**current_user, "role": role})


@router.post("/ws-ticket", response_model=APIResponse)
async def get_ws_ticket(
    current_user: dict = Depends(get_current_user),
):
    """
    Issue a short-lived (30 s), single-use WebSocket authentication ticket.

    The frontend exchanges this ticket for a WebSocket connection without
    placing any token in the URL query string (which would leak into server
    logs, browser history, and Referer headers).

    Flow:
        1. POST /api/auth/ws-ticket  →  { ticket, expires_at }
        2. Open  wss://host/ws/presence/admin?ticket=<ticket>
        3. Server validates & consumes the ticket at handshake time.
    """
    token, expires_at = issue_ticket(current_user["username"])
    return APIResponse(
        success=True,
        message="Ticket issued",
        data={
            "ticket":     token,
            "expires_at": expires_at.isoformat(),
            "ttl_seconds": 30,
        },
    )

async def logout(
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    username = current_user["username"]
    await db.execute(
        delete(SessionRecord).where(SessionRecord.id == f"auth-{username}")
    )
    await record_activity(
        db=db,
        username=username,
        action="logout",
        target_type="auth",
        target_id=None,
        summary=f"Logout: {username}",
        detail=None,
    )
    await db.commit()

    # Clear the auth cookie
    _clear_auth_cookie(response)

    return APIResponse(success=True, message="Logged out", data=None)
