import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.schemas import APIResponse
from app.core.security import get_current_user
from app.db.database import get_db
from app.db.models import SessionRecord
from app.routers.activity import record_activity

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Sessions"])


class SessionCreate(BaseModel):
    id:          str
    user:        str
    role:        str = "user"
    db:          str
    tables:      int = 0
    ttl_minutes: int = 60


@router.get("/sessions", response_model=APIResponse)
async def get_sessions(
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    result = await db.execute(select(SessionRecord))
    rows   = result.scalars().all()
    data   = [r.to_dict() for r in rows]
    stats  = {
        "active":  sum(1 for s in data if s["status"] == "active"),
        "warning": sum(1 for s in data if s["status"] == "warning"),
        "expired": sum(1 for s in data if s["status"] == "expired"),
    }
    return APIResponse(
        success=True,
        message=f"{len(data)} session(s) retrieved",
        data={"sessions": data, "stats": stats},
    )


@router.post("/sessions", response_model=APIResponse)
async def register_session(
    body:         SessionCreate,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    created = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    result  = await db.execute(select(SessionRecord).where(SessionRecord.id == body.id))
    record  = result.scalar_one_or_none()
    username = current_user.get("username", "unknown")

    if record:
        record.user         = body.user
        record.role         = body.role
        record.db           = body.db
        record.tables       = body.tables
        record.ttl_minutes  = body.ttl_minutes
        record.created      = created
        record.status_cache = "active"
        message = "Session refreshed"
        action  = "refresh"
    else:
        record  = SessionRecord(**body.dict(), created=created)
        db.add(record)
        message = "Session registered"
        action  = "create"

    await record_activity(
        db          = db,
        username    = username,
        action      = action,
        target_type = "session",
        target_id   = body.id,
        summary     = f"{message}: {body.id} (user={body.user})",
        detail      = {"session": body.dict()},
    )
    await db.commit()
    await db.refresh(record)
    logger.info("Session %s: id=%s by user=%s", action, body.id, username)
    return APIResponse(success=True, message=message, data=record.to_dict())


@router.delete("/sessions/all", response_model=APIResponse)
async def revoke_all_sessions(
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    my_id    = f"auth-{current_user.get('username', '')}"
    username = current_user.get("username", "unknown")
    result   = await db.execute(select(SessionRecord))
    rows     = result.scalars().all()
    revoked  = 0
    revoked_ids = []
    for r in rows:
        if r.id == my_id:
            continue
        revoked_ids.append(r.id)
        await db.delete(r)
        revoked += 1

    await record_activity(
        db          = db,
        username    = username,
        action      = "revoke_all",
        target_type = "session",
        target_id   = None,
        summary     = f"Revoke all sessions ({revoked} sessions) by {username}",
        detail      = {"revoked_ids": revoked_ids, "count": revoked},
    )
    await db.commit()
    logger.info("All sessions revoked by user=%s count=%d", username, revoked)
    return APIResponse(
        success=True,
        message=f"{revoked} session(s) revoked",
        data={"revoked": revoked},
    )


@router.delete("/sessions/{session_id}", response_model=APIResponse)
async def revoke_session(
    session_id:   str,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    result = await db.execute(select(SessionRecord).where(SessionRecord.id == session_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")

    data     = record.to_dict()
    username = current_user.get("username", "unknown")
    await db.delete(record)
    await record_activity(
        db          = db,
        username    = username,
        action      = "revoke",
        target_type = "session",
        target_id   = session_id,
        summary     = f"Revoke session: {session_id} (user={data.get('user')})",
        detail      = {"before": data},
    )
    await db.commit()
    logger.info("Session revoked: id=%s by user=%s", session_id, username)
    return APIResponse(success=True, message="Session revoked", data=data)


@router.delete("/sessions", response_model=APIResponse)
async def cleanup_expired(
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    result  = await db.execute(select(SessionRecord))
    rows    = result.scalars().all()
    expired = [r for r in rows if r.to_dict()["status"] == "expired"]
    expired_ids = [r.id for r in expired]
    for r in expired:
        await db.delete(r)

    username = current_user.get("username", "unknown")
    await record_activity(
        db          = db,
        username    = username,
        action      = "cleanup",
        target_type = "session",
        target_id   = None,
        summary     = f"Cleanup expired sessions ({len(expired)} sessions)",
        detail      = {"expired_ids": expired_ids, "count": len(expired)},
    )
    await db.commit()
    logger.info("Expired sessions cleaned: count=%d by user=%s", len(expired), username)
    return APIResponse(
        success=True,
        message=f"{len(expired)} expired session(s) removed",
        data={"removed": len(expired)},
    )
