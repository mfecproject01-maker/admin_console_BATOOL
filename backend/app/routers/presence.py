"""
app/routers/presence.py
───────────────────────
Real-time online user tracking via FastAPI WebSocket.

  ws://host/ws/presence                      ← user pages connect here
  ws://host/ws/presence/admin?ticket=<tok>   ← admin console (single-use WS ticket)
  ws://host/ws/presence/admin?token=<jwt>    ← legacy fallback (Bearer token in URL)
                                               kept for backward compatibility;
                                               will be removed in a future release.

Authentication preference order (admin endpoint):
  1. ?ticket=  — short-lived single-use ticket issued by POST /api/auth/ws-ticket
  2. ?token=   — legacy JWT in query string (deprecated, logs a warning)
"""

import json
import uuid
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt
from typing import Optional

from app.core.config   import settings
from app.core.ws_ticket import consume_ticket

ALGORITHM = "HS256"
logger    = logging.getLogger(__name__)

router = APIRouter(tags=["Presence"])

online_users:      dict[str, dict] = {}
admin_connections: set[WebSocket]  = set()

HEARTBEAT_INTERVAL = 30
HEARTBEAT_TIMEOUT  = 90


# ── Auth helpers ───────────────────────────────────────────────────────────────

def _verify_jwt(token: str) -> Optional[str]:
    """Decode a JWT and return the username, or None if invalid."""
    try:
        payload  = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        return username if username else None
    except (JWTError, Exception):
        return None


def _authenticate_ws(ticket: Optional[str], token: Optional[str]) -> Optional[str]:
    """
    Resolve the authenticated username for an admin WS connection.

    Priority:
      1. Single-use ticket (secure path)
      2. Legacy JWT query-param (deprecated — emits a warning)

    Returns username on success, None on failure.
    """
    if ticket:
        username = consume_ticket(ticket)
        if username:
            return username
        # Ticket was invalid/expired/already-used
        logger.warning("WS admin: invalid or expired ticket presented")
        return None

    if token:
        logger.warning(
            "WS admin: legacy ?token= auth used — upgrade frontend to use /api/auth/ws-ticket"
        )
        return _verify_jwt(token)

    return None


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _serialize_users() -> list[dict]:
    now = datetime.now(timezone.utc).timestamp()
    return [
        {**u, "idle_seconds": int(now - u["last_ping"])}
        for u in online_users.values()
    ]


async def _broadcast_to_admins(event: str, payload: dict) -> None:
    dead: set[WebSocket] = set()
    message = json.dumps({"event": event, **payload})
    for ws in admin_connections:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    admin_connections.difference_update(dead)


async def _evict_stale() -> None:
    """Background task: remove users that have not pinged within the timeout."""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        now   = datetime.now(timezone.utc).timestamp()
        stale = [
            cid for cid, u in online_users.items()
            if now - u["last_ping"] > HEARTBEAT_TIMEOUT
        ]
        for cid in stale:
            online_users.pop(cid, None)
        if stale:
            await _broadcast_to_admins(
                "update_online_users",
                {"users": _serialize_users(), "total": len(online_users)},
            )


# ── User WebSocket ─────────────────────────────────────────────────────────────

@router.websocket("/ws/presence")
async def user_presence(ws: WebSocket):
    await ws.accept()
    client_id = str(uuid.uuid4())
    try:
        raw  = await asyncio.wait_for(ws.receive_text(), timeout=10)
        data = json.loads(raw)
        if data.get("event") != "user_online":
            await ws.close(code=4000)
            return

        now = datetime.now(timezone.utc)
        online_users[client_id] = {
            "client_id":    client_id,
            "user_id":      data.get("user_id"),
            "page":         data.get("page", "/"),
            "user_agent":   data.get("user_agent", ""),
            "connected_at": now.isoformat(),
            "last_ping":    now.timestamp(),
        }
        await _broadcast_to_admins(
            "update_online_users",
            {"users": _serialize_users(), "total": len(online_users)},
        )

        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            event = msg.get("event")
            if event == "ping":
                online_users[client_id]["last_ping"] = datetime.now(timezone.utc).timestamp()
                await ws.send_text(json.dumps({"event": "pong"}))
            elif event == "page_change":
                online_users[client_id]["page"]     = msg.get("page", "/")
                online_users[client_id]["last_ping"] = datetime.now(timezone.utc).timestamp()
                await _broadcast_to_admins(
                    "update_online_users",
                    {"users": _serialize_users(), "total": len(online_users)},
                )
    except (WebSocketDisconnect, asyncio.TimeoutError, Exception):
        pass
    finally:
        online_users.pop(client_id, None)
        await _broadcast_to_admins(
            "update_online_users",
            {"users": _serialize_users(), "total": len(online_users)},
        )


# ── Admin WebSocket ────────────────────────────────────────────────────────────

@router.websocket("/ws/presence/admin")
async def admin_presence(
    ws:     WebSocket,
    ticket: Optional[str] = Query(None, description="Single-use WS ticket from /api/auth/ws-ticket"),
    token:  Optional[str] = Query(None, description="[Deprecated] JWT access token"),
):
    """
    Admin console real-time presence feed.

    Authenticate with a single-use ticket obtained from POST /api/auth/ws-ticket.
    The legacy ?token= parameter is still accepted but deprecated.
    """
    username = _authenticate_ws(ticket, token)
    if not username:
        # Reject before accepting — sends HTTP 403 during the WS upgrade handshake
        await ws.close(code=4001)
        return

    await ws.accept()
    admin_connections.add(ws)
    client_id = f"admin-{uuid.uuid4()}"
    now = datetime.now(timezone.utc)
    online_users[client_id] = {
        "client_id":    client_id,
        "user_id":      username,
        "page":         "admin-console",
        "user_agent":   "Admin Console",
        "connected_at": now.isoformat(),
        "last_ping":    now.timestamp(),
    }

    # Send current snapshot immediately after connecting
    await ws.send_text(json.dumps({
        "event": "update_online_users",
        "users": _serialize_users(),
        "total": len(online_users),
    }))

    try:
        while True:
            raw = await ws.receive_text()
            if json.loads(raw).get("event") == "ping":
                online_users[client_id]["last_ping"] = datetime.now(timezone.utc).timestamp()
                await ws.send_text(json.dumps({"event": "pong"}))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        online_users.pop(client_id, None)
        admin_connections.discard(ws)
        await _broadcast_to_admins(
            "update_online_users",
            {"users": _serialize_users(), "total": len(online_users)},
        )


# ── REST snapshot ──────────────────────────────────────────────────────────────

@router.get("/api/presence")
async def get_presence():
    return {
        "success": True,
        "total":   len(online_users),
        "users":   _serialize_users(),
    }
