"""
routers/system.py
─────────────────
เพิ่ม record_activity ใน start/stop/settings/maintenance
"""
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Dict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.schemas.schemas import APIResponse
from app.services import system_service
from app.core.security import get_current_user
from app.db.database import get_db
from app.db.models import AdminUser
from app.routers.activity import record_activity

logger = logging.getLogger(__name__)

_BA_TOOL_URL = os.getenv(
    "BA_TOOL_BACKEND_URL",
    "https://ba-tool-yvb0.onrender.com",
).rstrip("/")


async def _notify_batool_cache_invalidate() -> None:
    """บอก BA_TOOL ให้ล้าง maintenance cache ทันที หลัง admin toggle"""
    url = f"{_BA_TOOL_URL}/system/maintenance/refresh"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(url)
        logger.info(
            "[MAINTENANCE] BA_TOOL cache invalidated — HTTP %d", resp.status_code
        )
    except Exception as e:
        # ไม่ให้ล้มเหลวนี้กระทบการ toggle — log แล้วผ่านต่อ
        logger.warning(
            "[MAINTENANCE] Could not notify BA_TOOL to invalidate cache: %s", e
        )
router = APIRouter(tags=["System"])


async def require_admin(
    current_user: dict       = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
) -> dict:
    username = current_user.get("username", "")
    result   = await db.execute(select(AdminUser).where(AdminUser.username == username))
    user     = result.scalar_one_or_none()
    if not user or user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="คุณไม่มีสิทธิ์ดำเนินการนี้ — ต้องเป็น Admin เท่านั้น",
        )
    return current_user


class MaintenanceRequest(BaseModel):
    enabled: bool
    reason:  str = ""


class SettingsRequest(BaseModel):
    settings: Dict[str, str]


@router.get("/status", response_model=APIResponse)
async def get_status(
    current_user: dict         = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    data = await system_service.get_status(db)
    return APIResponse(success=True, message="Status retrieved", data=data)


@router.post("/start", response_model=APIResponse)
async def start_system(
    current_user: dict         = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    data     = await system_service.start_system(db)
    username = current_user.get("username", "unknown")
    await record_activity(
        db          = db,
        username    = username,
        action      = "start",
        target_type = "system",
        target_id   = None,
        summary     = f"Start system โดย {username}",
        detail      = {"result": data},
    )
    await db.commit()
    logger.info("System started by user=%s", username)
    return APIResponse(success=True, message="System started", data=data)


@router.post("/stop", response_model=APIResponse)
async def stop_system(
    current_user: dict         = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    data     = await system_service.stop_system(db)
    username = current_user.get("username", "unknown")
    await record_activity(
        db          = db,
        username    = username,
        action      = "stop",
        target_type = "system",
        target_id   = None,
        summary     = f"Stop system โดย {username}",
        detail      = {"result": data},
    )
    await db.commit()
    logger.info("System stopped by user=%s", username)
    return APIResponse(success=True, message="System stopped", data=data)


@router.get("/settings/public", response_model=APIResponse)
async def get_public_settings(db: AsyncSession = Depends(get_db)):
    from app.services import auth_service
    data = await auth_service.get_public_auth_settings(db)
    return APIResponse(success=True, message="Public settings", data=data)


@router.get("/settings", response_model=APIResponse)
async def get_settings(
    current_user: dict         = Depends(get_current_user),
    db:           AsyncSession = Depends(get_db),
):
    data = await system_service.get_settings(db)
    return APIResponse(success=True, message="Settings retrieved", data=data)


@router.put("/settings", response_model=APIResponse)
async def update_settings(
    body:         SettingsRequest,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(require_admin),
):
    old_data = await system_service.get_settings(db)
    data     = await system_service.set_settings(db, body.settings)
    username = current_user.get("username", "unknown")

    # ── Cascade TTL update to all active sessions ─────────────────────────────
    # เมื่อ sec_session_timeout เปลี่ยน ต้อง update ttl_minutes ของทุก
    # SessionRecord ที่มีอยู่ด้วย ไม่งั้น TTL Remaining บนหน้า Sessions
    # จะยังแสดงค่าเก่าต่อไป เพราะ to_dict() คำนวณจาก created + ttl_minutes
    if "sec_session_timeout" in body.settings:
        try:
            new_ttl = max(5, min(int(body.settings["sec_session_timeout"]), 1440))
            from app.db.models import SessionRecord
            result = await db.execute(select(SessionRecord))
            sessions = result.scalars().all()
            for s in sessions:
                s.ttl_minutes = new_ttl
            logger.info(
                "Session timeout changed to %d min — updated %d session(s)",
                new_ttl, len(sessions),
            )
        except Exception as exc:
            logger.warning("Could not cascade TTL update to sessions: %s", exc)

    await record_activity(
        db          = db,
        username    = username,
        action      = "update",
        target_type = "system_settings",
        target_id   = None,
        summary     = f"แก้ไข system settings โดย {username}",
        detail      = {"before": old_data, "changes": body.settings, "after": data},
    )
    await db.commit()
    logger.info("System settings updated by admin %s", username)
    return APIResponse(success=True, message="Settings updated", data=data)


@router.get("/maintenance", response_model=APIResponse)
async def get_maintenance(db: AsyncSession = Depends(get_db)):
    data = await system_service.get_maintenance(db)
    return APIResponse(success=True, message="Maintenance status", data=data)


@router.post("/maintenance", response_model=APIResponse)
async def set_maintenance(
    body:         MaintenanceRequest,
    db:           AsyncSession = Depends(get_db),
    current_user: dict         = Depends(require_admin),
):
    data     = await system_service.set_maintenance(db, body.enabled)
    username = current_user.get("username", "unknown")

    if body.reason.strip():
        from app.db.models import SystemSetting
        result = await db.execute(
            select(SystemSetting).where(SystemSetting.key == "maintenance_reason")
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = body.reason.strip()
        else:
            db.add(SystemSetting(key="maintenance_reason", value=body.reason.strip()))

    state = "เปิด" if body.enabled else "ปิด"
    await record_activity(
        db          = db,
        username    = username,
        action      = "maintenance_on" if body.enabled else "maintenance_off",
        target_type = "system",
        target_id   = None,
        summary     = f"Maintenance mode {state}โดย {username}",
        detail      = {"enabled": body.enabled, "reason": body.reason},
    )
    await db.commit()
    logger.info("Maintenance mode %s by admin %s", state, username)

    # บอก BA_TOOL ให้ล้าง cache ทันที ไม่ต้องรอ TTL 10 วินาที
    await _notify_batool_cache_invalidate()

    return APIResponse(
        success=True,
        message=f"Maintenance mode {state}ใช้งานแล้ว",
        data={**data, "reason": body.reason},
    )


@router.get("/maintenance/reason", response_model=APIResponse)
async def get_maintenance_reason(db: AsyncSession = Depends(get_db)):
    from app.db.models import SystemSetting
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "maintenance_reason")
    )
    row = result.scalar_one_or_none()
    return APIResponse(
        success=True,
        message="Maintenance reason",
        data={"reason": row.value if row else ""},
    )