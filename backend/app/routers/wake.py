"""
app/routers/wake.py
───────────────────
Proxy endpoints สำหรับ ping BA Tool API จาก Admin Console
เพื่อหลีกเลี่ยงปัญหา CORS ที่ Frontend ยิง request ตรงไม่ได้

Tasks implemented:
  Task 3 — BA_TOOL URL from env var (BA_TOOL_BACKEND_URL)
  Task 4 — timeout=10s, retry=3, exponential backoff (1s, 2s, 4s)
  Task 5 — deep health validation (HTTP 200 AND status=="ok" AND non-empty DB)
  Task 6 — structured logging with [WAKE] / [HEALTH] / [ERROR] prefixes
  Task 7 — GET /api/wake/status monitoring endpoint
"""

import asyncio
import os
import time
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.schemas.schemas import APIResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Wake"])

# ── Configuration ─────────────────────────────────────────────────────────────
BA_TOOL_URL = os.getenv(
    "BA_TOOL_BACKEND_URL",
    "https://ba-tool-yvb0.onrender.com",   # fallback for local dev / legacy deploys
).rstrip("/")

# Render cold-start takes up to ~60s; total wake budget is 3 attempts × 10s + backoff
WAKE_PER_REQUEST_TIMEOUT_S = 10   # Task 4: each httpx attempt
WAKE_MAX_RETRIES            = 3   # Task 4: retry count
WAKE_BACKOFF_BASE_S         = 1   # Task 4: 1s → 2s → 4s

# ── In-memory last-status store (Task 7) ─────────────────────────────────────
_last_status: dict[str, Any] = {
    "reachable":        None,
    "healthy":          None,
    "response_time_ms": None,
    "last_check":       None,
    "details":          {},
}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _validate_health_body(body: dict) -> tuple[bool, str]:
    """
    Task 5: deep validation of BA_TOOL /health response body.

    Healthy conditions (ALL must be true):
      • status == "ok"
      • db dict is non-empty
      • startup == "complete" (if key present)

    Returns (is_healthy, reason_if_not).
    """
    status  = body.get("status")
    db_info = body.get("db", {})
    startup = body.get("startup")

    if status != "ok":
        return False, f"BA Tool reported status='{status}' (expected 'ok')"

    if not db_info:
        return False, "BA Tool /health returned empty db map — pool may not be initialized"

    if startup and startup != "complete":
        return False, f"BA Tool startup state is '{startup}' — still initializing"

    return True, ""


async def _attempt_health(client: httpx.AsyncClient, attempt: int) -> dict:
    """
    Single health-check attempt.  Returns a result dict:
      { ok, reachable, healthy, reason, http_status, body, elapsed_ms }
    """
    t0 = time.monotonic()
    try:
        resp = await client.get(f"{BA_TOOL_URL}/health")
        elapsed_ms = round((time.monotonic() - t0) * 1000)

        logger.info(
            "[WAKE] Attempt %d/%d → HTTP %d in %dms",
            attempt, WAKE_MAX_RETRIES, resp.status_code, elapsed_ms,
        )

        reachable = True

        if resp.status_code != 200:
            reason = f"HTTP {resp.status_code}"
            logger.warning("[HEALTH] Non-200 response: %s", reason)
            return dict(
                ok=False, reachable=reachable, healthy=False,
                reason=reason, http_status=resp.status_code,
                body={}, elapsed_ms=elapsed_ms,
            )

        try:
            body = resp.json()
        except Exception:
            reason = "Response body is not valid JSON"
            logger.warning("[HEALTH] %s", reason)
            return dict(
                ok=False, reachable=reachable, healthy=False,
                reason=reason, http_status=resp.status_code,
                body={}, elapsed_ms=elapsed_ms,
            )

        healthy, reason = _validate_health_body(body)
        if not healthy:
            logger.warning("[HEALTH] Unhealthy: %s", reason)

        return dict(
            ok=healthy, reachable=reachable, healthy=healthy,
            reason=reason or "ok", http_status=resp.status_code,
            body=body, elapsed_ms=elapsed_ms,
        )

    except httpx.TimeoutException:
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        reason = f"Timeout after {elapsed_ms}ms (limit {WAKE_PER_REQUEST_TIMEOUT_S}s)"
        logger.warning("[WAKE] Attempt %d/%d — %s", attempt, WAKE_MAX_RETRIES, reason)
        return dict(
            ok=False, reachable=False, healthy=False,
            reason=reason, http_status=None, body={}, elapsed_ms=elapsed_ms,
        )
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        reason = f"Connection error: {exc}"
        logger.error("[ERROR] Attempt %d/%d — %s", attempt, WAKE_MAX_RETRIES, reason)
        return dict(
            ok=False, reachable=False, healthy=False,
            reason=reason, http_status=None, body={}, elapsed_ms=elapsed_ms,
        )


async def _wake_with_retry() -> dict:
    """
    Task 4: retry loop with exponential backoff.
    Returns the final result dict from _attempt_health.
    """
    logger.info("[WAKE] Starting wake — target: %s", BA_TOOL_URL)
    last_result: dict = {}

    async with httpx.AsyncClient(timeout=WAKE_PER_REQUEST_TIMEOUT_S) as client:
        for attempt in range(1, WAKE_MAX_RETRIES + 1):
            result = await _attempt_health(client, attempt)
            last_result = result

            if result["ok"]:
                logger.info(
                    "[WAKE] ✅ Success on attempt %d — %dms", attempt, result["elapsed_ms"]
                )
                return result

            if attempt < WAKE_MAX_RETRIES:
                backoff = WAKE_BACKOFF_BASE_S * (2 ** (attempt - 1))   # 1s, 2s, 4s
                logger.info(
                    "[WAKE] Retry %d/%d in %ds — reason: %s",
                    attempt, WAKE_MAX_RETRIES, backoff, result["reason"],
                )
                await asyncio.sleep(backoff)

    logger.warning(
        "[WAKE] ❌ All %d attempts failed — last reason: %s",
        WAKE_MAX_RETRIES, last_result.get("reason"),
    )
    return last_result


def _update_last_status(result: dict, total_elapsed_ms: float) -> None:
    """Task 7: persist latest probe result for GET /api/wake/status."""
    _last_status["reachable"]        = result.get("reachable", False)
    _last_status["healthy"]          = result.get("healthy", False)
    _last_status["response_time_ms"] = result.get("elapsed_ms")
    _last_status["last_check"]       = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _last_status["details"] = {
        "http_status":    result.get("http_status"),
        "reason":         result.get("reason"),
        "body":           result.get("body", {}),
        "total_ms":       round(total_elapsed_ms),
        "target_url":     BA_TOOL_URL,
    }


# ── POST /api/wake-batool ─────────────────────────────────────────────────────

@router.post("/wake-batool", response_model=APIResponse)
async def wake_batool(current_user: dict = Depends(get_current_user)):
    """
    Ping BA Tool /health endpoint จาก Backend (proxy to avoid CORS).
    Implements retry with exponential backoff and deep health validation.
    """
    wall_start = time.monotonic()
    logger.info(
        "[WAKE] Request initiated by user='%s' — target: %s",
        current_user.get("sub", "unknown"), BA_TOOL_URL,
    )

    result = await _wake_with_retry()

    total_elapsed_ms = round((time.monotonic() - wall_start) * 1000)
    _update_last_status(result, total_elapsed_ms)

    elapsed_s = round(total_elapsed_ms / 1000, 2)

    if result["ok"]:
        body = result.get("body", {})
        logger.info(
            "[WAKE] Final status: HEALTHY — %dms — db=%s",
            total_elapsed_ms, body.get("db", {}),
        )
        return APIResponse(
            success=True,
            message="BA Tool API is awake and healthy",
            data={
                "status":          body.get("status", "ok"),
                "elapsed_seconds": elapsed_s,
                "http_status":     result.get("http_status"),
                "db":              body.get("db", {}),
                "sessions":        body.get("sessions"),
                "startup":         body.get("startup"),
                "timestamp":       body.get("timestamp"),
                "target_url":      BA_TOOL_URL,
            },
        )

    logger.warning(
        "[WAKE] Final status: UNHEALTHY — %dms — reason: %s",
        total_elapsed_ms, result.get("reason"),
    )
    return APIResponse(
        success=False,
        message=f"BA Tool is unreachable or unhealthy: {result.get('reason')}",
        data={
            "elapsed_seconds": elapsed_s,
            "http_status":     result.get("http_status"),
            "reason":          result.get("reason"),
            "reachable":       result.get("reachable"),
            "healthy":         result.get("healthy"),
            "target_url":      BA_TOOL_URL,
        },
    )


# ── GET /api/wake/status  (Task 7) ───────────────────────────────────────────

@router.get("/wake/status")
async def wake_status(current_user: dict = Depends(get_current_user)):
    """
    Returns the result of the most recent wake probe without triggering a new one.
    Use POST /api/wake-batool to initiate an active probe.
    """
    if _last_status["last_check"] is None:
        return {
            "reachable":        None,
            "healthy":          None,
            "response_time_ms": None,
            "last_check":       None,
            "details":          {"note": "No probe has been run yet. Call POST /api/wake-batool first."},
        }
    return _last_status