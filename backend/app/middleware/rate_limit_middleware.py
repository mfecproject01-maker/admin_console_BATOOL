"""
rate_limit_middleware.py
────────────────────────
จำกัดจำนวน request ต่อ user ตาม rl_max_req_min ใน system settings
"""

import time
import logging
from collections import defaultdict
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from jose import JWTError, jwt

from app.db.database import AsyncSessionLocal
from app.services import system_service
from app.core.config import settings

logger = logging.getLogger(__name__)

_settings_cache: dict = {"ts": 0.0, "limit": 300}
_hits: dict[str, list[float]] = defaultdict(list)
CACHE_TTL = 60


async def _max_requests_per_minute() -> int:
    now = time.time()
    if now - _settings_cache["ts"] < CACHE_TTL:
        return _settings_cache["limit"]
    try:
        async with AsyncSessionLocal() as db:
            vals = await system_service.get_settings(db)
            limit = max(10, min(int(vals.get("rl_max_req_min", "300")), 10000))
    except Exception:
        limit = 300
    _settings_cache.update({"ts": now, "limit": limit})
    return limit


def _client_key(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = jwt.decode(auth[7:], settings.SECRET_KEY, algorithms=["HS256"])
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except JWTError:
            pass
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        path = request.url.path
        if not path.startswith("/api/") or path.startswith("/api/auth/login") or path.startswith("/api/health"):
            return await call_next(request)
        if path.startswith("/ws/"):
            return await call_next(request)
        if path.startswith("/api/system/maintenance") or path.startswith("/api/system/settings/public"):
            return await call_next(request)

        key = _client_key(request)
        now = time.time()
        window_start = now - 60
        hits = [t for t in _hits[key] if t > window_start]
        limit = await _max_requests_per_minute()
        if len(hits) >= limit:
            return JSONResponse(
                status_code=429,
                content={"success": False, "detail": f"Rate limit exceeded ({limit}/min)"},
            )
        hits.append(now)
        _hits[key] = hits
        return await call_next(request)
