"""
app/core/ws_ticket.py
─────────────────────
Secure WebSocket ticket store.

Flow:
  1. Authenticated client POSTs to /api/ws-ticket  → receives a one-time ticket.
  2. Client opens WebSocket with ?ticket=<token>   → server validates & consumes it.

Properties:
  • Cryptographically random 32-byte hex tokens.
  • 30-second expiration.
  • Single-use: consumed immediately on first valid lookup.
  • In-memory store: no DB required, no schema changes.
  • Periodic cleanup of expired tickets to prevent unbounded growth.
"""

import secrets
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

TICKET_TTL_SECONDS: int = 30
# Cleanup runs every 60 s — removes tickets that slipped past their TTL
_CLEANUP_INTERVAL_SECONDS: int = 60

# ticket_token → {"username": str, "expires_at": datetime}
_store: dict[str, dict] = {}


# ── Public API ────────────────────────────────────────────────────────────────

def issue_ticket(username: str) -> tuple[str, datetime]:
    """
    Generate and store a new single-use WS ticket for *username*.
    Returns (token, expires_at).
    """
    token      = secrets.token_hex(32)          # 256-bit cryptographically random
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=TICKET_TTL_SECONDS)
    _store[token] = {"username": username, "expires_at": expires_at}
    return token, expires_at


def consume_ticket(token: str) -> Optional[str]:
    """
    Validate and consume a ticket.
    Returns the associated *username* on success, or ``None`` if the ticket is
    unknown, already used, or expired.
    The ticket is deleted from the store whether or not it is valid, so a
    second call with the same token always returns ``None``.
    """
    if not token:
        return None

    entry = _store.pop(token, None)             # atomic pop — single-use guaranteed
    if entry is None:
        return None

    if datetime.now(timezone.utc) > entry["expires_at"]:
        return None                             # expired (already removed from store)

    return entry["username"]


# ── Background cleanup ────────────────────────────────────────────────────────

async def _cleanup_loop() -> None:
    """Periodically evict expired tickets that were never redeemed."""
    while True:
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
        now     = datetime.now(timezone.utc)
        expired = [t for t, v in _store.items() if now > v["expires_at"]]
        for t in expired:
            _store.pop(t, None)


def start_cleanup_task() -> asyncio.Task:
    """Schedule the cleanup coroutine.  Call once from app startup."""
    return asyncio.create_task(_cleanup_loop())
