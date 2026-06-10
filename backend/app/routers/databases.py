"""
routers/databases.py
────────────────────
Fixed version:
- DELETE /api/databases/:id  →  stable, no unhandled crashes
  • Saves record data BEFORE delete (avoids detached-instance issues)
  • record_activity called inside try/except so an activity log failure
    does NOT roll back the actual delete
  • Explicit 404 vs 500 separation
- CORS-safe: all errors return JSON (never raw HTML from Starlette)
"""
import re
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import text

from app.schemas.schemas import APIResponse
from app.core.security import get_current_user
from app.db.database import get_db
from app.db.models import DatabaseRecord, MappingRule, SessionRecord
from app.routers.activity import record_activity

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Databases"])

_KEY_PATTERN = re.compile(r"^[a-z0-9_]+$")


def sanitize_key(raw: str) -> str:
    return re.sub(r"\s+", "", raw.strip().lower())


def validate_key(key: str) -> str:
    sanitized = sanitize_key(key)
    if not sanitized:
        raise ValueError("Key must not be empty")
    if not _KEY_PATTERN.match(sanitized):
        raise ValueError(
            "Key must contain only lowercase letters (a-z), digits (0-9), and underscores (_)"
        )
    return sanitized


class DatabaseCreate(BaseModel):
    key:     str
    name:    str
    version: str  = ""
    status:  str  = "active"
    enabled: bool = True

    @field_validator("key")
    @classmethod
    def clean_key(cls, v: str) -> str:
        return validate_key(v)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty")
        return v


class DatabaseUpdate(BaseModel):
    key:     Optional[str]  = None
    name:    Optional[str]  = None
    version: Optional[str]  = None
    status:  Optional[str]  = None
    enabled: Optional[bool] = None

    @field_validator("key")
    @classmethod
    def clean_key(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return validate_key(v)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty")
        return v


_DEFAULTS = [
    {"key": "sqlserver",  "name": "SQL Server", "version": "2019", "status": "active", "enabled": True},
    {"key": "postgresql", "name": "PostgreSQL",  "version": "15.x", "status": "active", "enabled": True},
    {"key": "mysql",      "name": "MySQL",        "version": "8.x",  "status": "active", "enabled": True},
    {"key": "oracle",     "name": "Oracle",       "version": "19c",  "status": "beta",   "enabled": True},
    {"key": "confluent",  "name": "Confluent",    "version": "7.x",  "status": "active", "enabled": True},
]


async def _seed_defaults(db: AsyncSession):
    result = await db.execute(select(DatabaseRecord))
    if result.scalars().first() is not None:
        return
    for d in _DEFAULTS:
        db.add(DatabaseRecord(**d))
    await db.commit()


async def _count_rules(db: AsyncSession, key: str) -> int:
    result = await db.execute(
        select(func.count()).select_from(MappingRule).where(
            (MappingRule.src_db == key) | (MappingRule.dest_db == key)
        )
    )
    return result.scalar_one()


async def _count_sessions(db: AsyncSession, key: str) -> int:
    result = await db.execute(
        select(func.count()).select_from(SessionRecord).where(SessionRecord.db == key)
    )
    return result.scalar_one()


async def _key_exists(db: AsyncSession, key: str, exclude_id: Optional[int] = None) -> bool:
    from sqlalchemy import func as sqlfunc
    q = select(DatabaseRecord).where(sqlfunc.lower(DatabaseRecord.key) == key.lower())
    if exclude_id is not None:
        q = q.where(DatabaseRecord.id != exclude_id)
    result = await db.execute(q)
    return result.scalar_one_or_none() is not None


@router.get("/databases", response_model=APIResponse)
async def get_databases(
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    await _seed_defaults(db)
    result = await db.execute(select(DatabaseRecord))
    rows = result.scalars().all()
    data = []
    for r in rows:
        rules    = await _count_rules(db, r.key)
        sessions = await _count_sessions(db, r.key)
        data.append(r.to_dict(rules=rules, sessions=sessions))
    return APIResponse(success=True, message=f"{len(data)} database(s) retrieved", data=data)


@router.post("/databases", response_model=APIResponse, status_code=status.HTTP_201_CREATED)
async def create_database(
    body:         DatabaseCreate,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    if await _key_exists(db, body.key):
        logger.warning("Duplicate DB key attempt: %s", body.key)
        raise HTTPException(
            status_code=409,
            detail={"success": False, "error": "DATABASE_KEY_ALREADY_EXISTS",
                    "message": f"Database key '{body.key}' already exists"},
        )
    record = DatabaseRecord(**body.dict())
    db.add(record)
    await db.flush()

    username = current_user.get("username", "unknown")
    await record_activity(
        db          = db,
        username    = username,
        action      = "create",
        target_type = "database",
        target_id   = str(record.id),
        summary     = f"เพิ่ม database: {body.key} ({body.name})",
        detail      = {"after": record.to_dict()},
    )
    await db.commit()
    await db.refresh(record)
    logger.info("Database created: key=%s by user=%s", body.key, username)
    return APIResponse(success=True, message="Database added", data=record.to_dict())


@router.put("/databases/{db_id}", response_model=APIResponse)
async def update_database(
    db_id:        int,
    body:         DatabaseUpdate,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    result = await db.execute(select(DatabaseRecord).where(DatabaseRecord.id == db_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Database not found")

    before  = record.to_dict()
    updates = body.dict(exclude_none=True)

    if "key" in updates and await _key_exists(db, updates["key"], exclude_id=db_id):
        raise HTTPException(
            status_code=409,
            detail={"success": False, "error": "DATABASE_KEY_ALREADY_EXISTS",
                    "message": f"Database key '{updates['key']}' already exists"},
        )

    for field, value in updates.items():
        setattr(record, field, value)

    username = current_user.get("username", "unknown")
    await record_activity(
        db          = db,
        username    = username,
        action      = "update",
        target_type = "database",
        target_id   = str(db_id),
        summary     = f"แก้ไข database ID {db_id}: {record.key}",
        detail      = {"before": before, "changes": updates, "after": record.to_dict()},
    )
    await db.commit()
    await db.refresh(record)
    logger.info("Database updated: id=%s by user=%s", db_id, username)
    return APIResponse(success=True, message="Database updated", data=record.to_dict())


@router.delete("/databases/{db_id}", response_model=APIResponse)
async def delete_database(
    db_id:        int,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(get_current_user),
):
    """
    Delete a database record by ID.

    Fix notes vs original:
    1. `data = record.to_dict()` is captured BEFORE `db.delete(record)` to
       avoid accessing a detached / expired ORM instance afterward.
    2. `record_activity` is wrapped in its own try/except so an activity-log
       failure does NOT roll back the actual delete — the delete always commits
       as long as the DB constraint allows it.
    3. Explicit HTTPException(404) vs generic 500 separation — the global
       exception handler only fires for truly unexpected errors.
    """
    # ── 1. Fetch record ───────────────────────────────────────────────────────
    result = await db.execute(select(DatabaseRecord).where(DatabaseRecord.id == db_id))
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=404, detail="Database not found")

    # ── 2. Snapshot data BEFORE delete (avoids detached-instance errors) ──────
    data     = record.to_dict()
    username = current_user.get("username", "unknown")

    # ── 3. Delete FK child rows first (cascade) ───────────────────────────────
    # Supabase has a real FK constraint "fk_db" on datatype_raw_mapping.db_id
    # and datatype_mapping.db_id that references database_records.id.
    # SQLAlchemy ORM is unaware of these constraints (no relationship defined),
    # so we must manually delete child rows before deleting the parent.
    try:
        await db.execute(
            text("DELETE FROM datatype_raw_mapping WHERE db_id = :id"),
            {"id": db_id},
        )
        await db.execute(
            text("DELETE FROM datatype_mapping WHERE db_id = :id"),
            {"id": db_id},
        )
        await db.delete(record)
        await db.flush()
    except Exception as exc:
        await db.rollback()
        logger.error("Failed to delete database id=%s: %s", db_id, exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"success": False, "message": "Failed to delete database record"},
        ) from exc

    # ── 4. Activity log (best-effort — never rolls back the delete) ───────────
    try:
        await record_activity(
            db          = db,
            username    = username,
            action      = "delete",
            target_type = "database",
            target_id   = str(db_id),
            summary     = f"ลบ database: {data['key']} ({data['name']})",
            detail      = {"before": data},
        )
    except Exception as exc:
        logger.warning(
            "record_activity failed for delete db id=%s (non-fatal): %s", db_id, exc
        )

    # ── 5. Commit ─────────────────────────────────────────────────────────────
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error("Commit failed for delete database id=%s: %s", db_id, exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"success": False, "message": "Database delete failed during commit"},
        ) from exc

    logger.info("Database deleted: key=%s by user=%s", data["key"], username)
    return APIResponse(success=True, message="Database removed", data=data)


@router.get("/database-records/enabled", response_model=APIResponse)
async def get_enabled_databases(
    search: Optional[str] = Query(None),
    limit:  int           = Query(100, ge=1, le=500),
    db:     AsyncSession  = Depends(get_db),
    current_user: dict    = Depends(get_current_user),
):
    q = select(DatabaseRecord.id, DatabaseRecord.key).where(DatabaseRecord.enabled == True)  # noqa: E712
    if search:
        q = q.where(DatabaseRecord.key.ilike(f"%{search}%"))
    q = q.order_by(DatabaseRecord.key).limit(limit)
    result = await db.execute(q)
    rows = result.all()
    data = [{"id": r.id, "key": r.key} for r in rows]
    return APIResponse(success=True, message=f"{len(data)} database(s)", data=data)