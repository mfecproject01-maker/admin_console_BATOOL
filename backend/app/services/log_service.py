"""
log_service.py
──────────────
ดึง logs จาก BA Tool backend และ persist ลง batool_logs
รองรับ source_file และ username field
"""

import re
import httpx
from typing import List, Iterable, Optional
from datetime import datetime, timezone
from sqlalchemy import select, func

from app.schemas.schemas import LogEntry
from app.db.database import AsyncSessionLocal
from app.db.models import BatoolLog

BA_TOOL_URL = "https://ba-tool-yvb0.onrender.com"

_last_seen_id: int = 0

# pattern: "module_name - INFO - [filename.py:42] - message"
_SOURCE_FILE_RE = re.compile(r"\[([^\]]+\.py:\d+)\]")
_USERNAME_IN_MESSAGE_RE = re.compile(
    r"\b(?:username|user|actor|created_by|uploaded_by|converted_by|operator|email)=([^\s,;]+)",
    re.IGNORECASE,
)


async def _load_last_seen_id() -> int:
    """โหลด last seen id จาก DB เพื่อไม่ให้ reset เมื่อ backend restart"""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(func.max(BatoolLog.external_key)).where(
                    BatoolLog.external_key.like("batool:%")
                )
            )
            val = result.scalar_one_or_none()
            if val:
                return int(val.replace("batool:", ""))
    except Exception:
        pass
    return 0


def _parse_created_at(ts: str) -> datetime:
    """
    แปลง timestamp string → datetime
    ถ้า parse ไม่ได้ → ใช้เวลาจริงจากเครื่อง server แทน
    """
    raw = (ts or "").strip()
    if not raw:
        return datetime.now(timezone.utc)  # ← ใช้เวลาจริง
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    # ลอง format เพิ่มเติม เช่น "2026-06-02 04:36:52"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc)  # ← fallback เวลาจริง


def _extract_source_file(entry_dict: dict, message: str) -> Optional[str]:
    for key in ("source_file", "file", "filename"):
        val = entry_dict.get(key)
        if val and isinstance(val, str):
            return val

    logger_name = entry_dict.get("logger") or entry_dict.get("name") or entry_dict.get("module")
    if logger_name and isinstance(logger_name, str) and "." in logger_name:
        parts = logger_name.split(".")
        if parts[0] == "app":
            parts = parts[1:]
        return "/".join(parts) + ".py"

    m = _SOURCE_FILE_RE.search(message or "")
    if m:
        return m.group(1)

    return None


def _extract_username(entry_dict: dict) -> Optional[str]:
    """ดึง username จาก log entry ถ้ามี"""
    for key in (
        "username",
        "user",
        "actor",
        "created_by",
        "uploaded_by",
        "converted_by",
        "operator",
        "email",
        "user_email",
        "display_name",
    ):
        val = entry_dict.get(key)
        if val and isinstance(val, str):
            return val
    message = entry_dict.get("message") or entry_dict.get("msg") or ""
    if isinstance(message, str):
        match = _USERNAME_IN_MESSAGE_RE.search(message)
        if match:
            return match.group(1)
    return None


async def _persist_to_batool_logs(entries: Iterable[LogEntry], raw_dicts: List[dict]) -> None:
    rows: list[BatoolLog] = []
    keys: list[str] = []

    raw_map = {d.get("id", i): d for i, d in enumerate(raw_dicts)}

    for e in entries:
        external_key = f"batool:{e.id}"
        keys.append(external_key)
        raw = raw_map.get(e.id, {})
        source_file = _extract_source_file(raw, e.message)
        username    = _extract_username(raw)

        # ใช้ timestamp จาก log ถ้ามี ไม่งั้นใช้เวลาจริง
        created_at = _parse_created_at(e.timestamp)

        rows.append(BatoolLog(
            level        = e.level.upper(),
            message      = e.message,
            detail       = f"batool_id={e.id}; timestamp={e.timestamp}",
            source_file  = source_file,
            username     = username,
            external_key = external_key,
            created_at   = created_at,
        ))

    if not rows:
        return

    try:
        async with AsyncSessionLocal() as db:
            existing = await db.execute(
                select(BatoolLog.external_key).where(BatoolLog.external_key.in_(keys))
            )
            seen = {r for r in existing.scalars().all() if r}
            for row in rows:
                if row.external_key in seen:
                    continue
                db.add(row)
            await db.commit()
    except Exception:
        return


async def get_all_logs() -> List[LogEntry]:
    global _last_seen_id
    if _last_seen_id == 0:
        _last_seen_id = await _load_last_seen_id()
    entries, raw_dicts = await _fetch_raw()
    if entries:
        await _persist_to_batool_logs(entries, raw_dicts)
        _last_seen_id = max(e.id for e in entries)
    return entries


async def get_new_logs() -> List[LogEntry]:
    global _last_seen_id
    if _last_seen_id == 0:
        _last_seen_id = await _load_last_seen_id()
    all_entries, raw_dicts = await _fetch_raw()
    new_entries = [e for e in all_entries if e.id > _last_seen_id]
    if new_entries:
        await _persist_to_batool_logs(new_entries, raw_dicts)
        _last_seen_id = max(e.id for e in new_entries)
    return new_entries


async def clear_display_logs() -> int:
    """ล้าง batool_logs ใน DB และ reset poll cursor"""
    global _last_seen_id
    from sqlalchemy import delete
    deleted = 0
    try:
        async with AsyncSessionLocal() as db:
            count = await db.execute(select(func.count()).select_from(BatoolLog))
            deleted = count.scalar_one() or 0
            await db.execute(delete(BatoolLog))
            await db.commit()
    except Exception:
        pass
    _last_seen_id = 0
    return deleted


async def _fetch_raw() -> tuple[List[LogEntry], List[dict]]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{BA_TOOL_URL}/logs")
            res.raise_for_status()
            data = res.json()
    except Exception:
        return [], []

    raw_list: list = []
    if isinstance(data, list):
        raw_list = data
    elif isinstance(data, dict):
        raw_list = data.get("logs") or data.get("data") or []

    logs: List[LogEntry] = []
    for i, entry in enumerate(raw_list):
        if isinstance(entry, str):
            parts = entry.split("]", 1)
            if len(parts) == 2:
                ts_part = parts[0].replace("[", "").strip()
                rest    = parts[1].strip()
                words   = rest.split(" ", 1)
                level   = words[0] if words else "INFO"
                message = words[1] if len(words) > 1 else rest
            else:
                ts_part, level, message = "", "INFO", entry
            logs.append(LogEntry(id=i + 1, timestamp=ts_part, level=level.upper(), message=message))
        elif isinstance(entry, dict):
            # ดึง timestamp จาก field ที่เป็นไปได้ทั้งหมด
            ts = (
                entry.get("timestamp")
                or entry.get("created_at")
                or entry.get("time")
                or ""
            )
            logs.append(LogEntry(
                id        = entry.get("id", i + 1),
                timestamp = ts,
                level     = str(entry.get("level", "INFO")).upper(),
                message   = entry.get("message", entry.get("msg", str(entry))),
            ))

    return logs, [e if isinstance(e, dict) else {} for e in raw_list]
