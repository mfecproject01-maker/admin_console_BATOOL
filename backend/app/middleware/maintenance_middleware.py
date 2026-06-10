"""
middleware/maintenance_middleware.py
─────────────────────────────────────
Block requests จาก user ทั่วไปเมื่อ maintenance_mode = true

กฎ:
  - OPTIONS (CORS preflight)         → pass เสมอ  ห้าม block เด็ดขาด
  - /api/system/maintenance  (GET)   → pass เสมอ  ให้ทุกคน poll ได้
  - /api/system/maintenance  (POST)  → pass (admin toggle)
  - /api/system/maintenance/reason   → pass เสมอ
  - /api/auth/*                      → pass เสมอ  (ต้อง login ได้ก่อน)
  - /api/health                      → pass เสมอ
  - /api/wake/*                      → pass เสมอ
  - admin role                       → pass เสมอ  (admin ยังทำงานได้ปกติ)
  - อื่น ๆ ทั้งหมด                   → 503 เมื่อ maintenance เปิดอยู่
"""

import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.db.database import AsyncSessionLocal
from app.services.system_service import is_maintenance_active

logger = logging.getLogger(__name__)

# Paths ที่ผ่านได้เสมอแม้ maintenance เปิดอยู่
_ALWAYS_PASS_PREFIXES = (
    "/api/auth/",
    "/api/health",
    "/api/system/maintenance",
    "/api/wake",
    "/ws/",           # WebSocket endpoints ต้อง pass เสมอ
    "/docs",
    "/redoc",
    "/openapi.json",
)


class MaintenanceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # ── CRITICAL: Always pass CORS preflight requests ────────────────────
        # OPTIONS must reach CORSMiddleware before any business-logic check.
        # Blocking it here would cause net::ERR_FAILED on every cross-origin
        # mutating request even outside maintenance mode.
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path

        # 1. paths ที่ยกเว้นเสมอ
        for prefix in _ALWAYS_PASS_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # 2. ตรวจ maintenance flag จาก DB
        try:
            async with AsyncSessionLocal() as db:
                in_maintenance = await is_maintenance_active(db)
        except Exception as exc:
            # ถ้า DB ล่ม ให้ผ่านไปก่อน (fail-open) — ไม่ block ทุก request
            logger.warning("MaintenanceMiddleware: DB check failed — fail-open: %s", exc)
            return await call_next(request)

        if not in_maintenance:
            return await call_next(request)

        # 3. อยู่ใน maintenance — ตรวจ role จาก JWT (admin ผ่านได้)
        # Check both cookie and Authorization header
        token = None

        # Prefer HttpOnly cookie (same logic as security.py)
        cookie_token = request.cookies.get("ba_access_token")
        if cookie_token:
            token = cookie_token
        else:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1]

        if token:
            try:
                from jose import jwt as _jwt
                from app.core.config import settings
                from app.core.security import ALGORITHM
                from sqlalchemy import select
                from app.db.models import AdminUser

                payload  = _jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
                username = payload.get("sub", "")

                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(AdminUser).where(AdminUser.username == username)
                    )
                    user = result.scalar_one_or_none()
                    if user and user.role == "admin":
                        return await call_next(request)
            except Exception:
                pass  # token ผิด/หมดอายุ → block ตามปกติ

        # 4. Block — คืน 503
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "message": "ระบบอยู่ในโหมดซ่อมบำรุง (Maintenance Mode) — กรุณาลองใหม่ในภายหลัง",
                "code": "MAINTENANCE_MODE",
            },
            headers={"Retry-After": "3600"},
        )