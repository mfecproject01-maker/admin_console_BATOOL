"""
routers/sync.py
───────────────
Endpoints สำหรับ Sync Engine:
  GET  /api/sync/status  — ดู status ปัจจุบัน
  POST /api/sync/run     — trigger manual sync
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.schemas import APIResponse
from app.core.security import get_current_user
from app import sync_engine

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Sync"])


@router.get("/sync/status", response_model=APIResponse)
async def get_sync_status(current_user: dict = Depends(get_current_user)):
    """ดู sync status + metrics ของ cycle ล่าสุด"""
    return APIResponse(
        success=True,
        message="Sync status retrieved",
        data=await sync_engine.get_status(),
    )


@router.post("/sync/run", response_model=APIResponse)
async def trigger_sync(current_user: dict = Depends(get_current_user)):
    """
    Manual trigger sync cycle ทันที
    ถ้ากำลัง sync อยู่ → return สถานะปัจจุบันแทน (ไม่ run ซ้อน)
    """
    username = current_user.get("username", "unknown")
    logger.info("[sync] Manual trigger by user=%s", username)
    metrics = await sync_engine.run_sync_cycle(triggered_by=username)
    if metrics.get("skipped"):
        raise HTTPException(status_code=409, detail="Sync already in progress")
    return APIResponse(
        success=True,
        message=f"Sync complete: {metrics.get('synced', 0)} synced, {metrics.get('errors', 0)} errors",
        data=metrics,
    )