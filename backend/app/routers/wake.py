"""
app/routers/wake.py
───────────────────
Proxy endpoint สำหรับ ping BA Tool API จาก Admin Console
เพื่อหลีกเลี่ยงปัญหา CORS ที่ Frontend ยิง request ตรงไม่ได้
"""

import time
import httpx
from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.schemas.schemas import APIResponse

router = APIRouter(tags=["Wake"])

BA_TOOL_URL    = "https://ba-tool-yvb0.onrender.com"
WAKE_TIMEOUT_S = 65  # Render cold start สูงสุด ~60s


@router.post("/wake-batool", response_model=APIResponse)
async def wake_batool(current_user: dict = Depends(get_current_user)):
    """
    Ping BA Tool /health endpoint จาก Backend
    เพื่อปลุก Render service ที่หลับอยู่
    """
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=WAKE_TIMEOUT_S) as client:
            res = await client.get(f"{BA_TOOL_URL}/health")
        elapsed = round(time.monotonic() - start, 2)

        if res.status_code == 200:
            try:
                body = res.json()
            except Exception:
                body = {}
            return APIResponse(
                success=True,
                message="BA Tool API is awake",
                data={
                    "status":          body.get("status", "ok"),
                    "elapsed_seconds": elapsed,
                    "http_status":     res.status_code,
                },
            )
        else:
            elapsed = round(time.monotonic() - start, 2)
            return APIResponse(
                success=False,
                message=f"BA Tool API responded with HTTP {res.status_code}",
                data={"elapsed_seconds": elapsed, "http_status": res.status_code},
            )

    except httpx.TimeoutException:
        elapsed = round(time.monotonic() - start, 2)
        return APIResponse(
            success=False,
            message=f"Timeout after {elapsed}s — BA Tool may still be booting",
            data={"elapsed_seconds": elapsed},
        )
    except Exception as e:
        elapsed = round(time.monotonic() - start, 2)
        return APIResponse(
            success=False,
            message=f"Failed to reach BA Tool: {str(e)}",
            data={"elapsed_seconds": elapsed},
        )