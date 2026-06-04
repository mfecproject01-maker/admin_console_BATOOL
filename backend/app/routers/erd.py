"""
ERD / Database Explorer Router
ใช้ SQLAlchemy AsyncSession เหมือน router อื่นๆ ใน project นี้
ไม่ต้องติดตั้ง library เพิ่ม
"""

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.database import AsyncSessionLocal

router = APIRouter(prefix="/api/schema", tags=["erd"])

# ── DB session dependency ─────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

# ── Table whitelist cache ─────────────────────────────────────
_table_whitelist: set[str] | None = None


async def _get_whitelist(db: AsyncSession) -> set[str]:
    global _table_whitelist
    if _table_whitelist is None:
        result = await db.execute(text("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
        """))
        _table_whitelist = {row[0] for row in result.fetchall()}
    return _table_whitelist


def _validate_table_name(name: str) -> str:
    """ป้องกัน SQL injection — รับเฉพาะชื่อที่เป็น identifier ปกติ"""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise HTTPException(status_code=400, detail="Invalid table name")
    return name


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/tables")
async def get_tables(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """ดึงรายชื่อ table ทั้งหมดใน public schema"""
    result = await db.execute(text("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    """))
    return [{"table_name": row[0]} for row in result.fetchall()]


@router.get("/columns/{table}")
async def get_columns(
    table: str,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """ดึง column metadata ของ table ที่ระบุ"""
    _validate_table_name(table)
    whitelist = await _get_whitelist(db)
    if table not in whitelist:
        raise HTTPException(status_code=404, detail=f"Table '{table}' not found")

    result = await db.execute(
        text("""
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                ordinal_position
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = :table
            ORDER BY ordinal_position
        """),
        {"table": table},
    )
    rows = result.fetchall()
    return [
        {
            "column_name":      r[0],
            "data_type":        r[1],
            "is_nullable":      r[2],
            "column_default":   r[3],
            "ordinal_position": r[4],
        }
        for r in rows
    ]


@router.get("/relations")
async def get_relations(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """ดึง foreign key relationships ทั้งหมด"""
    result = await db.execute(text("""
        SELECT
            tc.table_name,
            kcu.column_name,
            ccu.table_name  AS foreign_table,
            ccu.column_name AS foreign_column,
            tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema    = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema    = 'public'
    """))
    rows = result.fetchall()
    return [
        {
            "table_name":      r[0],
            "column_name":     r[1],
            "foreign_table":   r[2],
            "foreign_column":  r[3],
            "constraint_name": r[4],
        }
        for r in rows
    ]


# ── Table data (อยู่ใน prefix /api เพื่อให้ path เป็น /api/table/{table}/data)
data_router = APIRouter(prefix="/api/table", tags=["erd"])


@data_router.get("/{table}/data")
async def get_table_data(
    table: str,
    limit: int = Query(default=50, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    ดึงข้อมูลจริงจาก table (สูงสุด 50 rows)
    - ชื่อ table ผ่าน whitelist เสมอ
    - ใช้ parameterized identifier — ไม่มี SQL injection
    """
    _validate_table_name(table)
    whitelist = await _get_whitelist(db)
    if table not in whitelist:
        raise HTTPException(status_code=404, detail=f"Table '{table}' not found")

    # ชื่อ table ผ่าน validate แล้ว ใช้ f-string ได้อย่างปลอดภัย
    result = await db.execute(
        text(f'SELECT * FROM public."{table}" LIMIT :limit OFFSET :offset'),  # noqa: S608
        {"limit": limit, "offset": offset},
    )
    columns = list(result.keys())
    rows_raw = result.fetchall()
    rows = [dict(zip(columns, r)) for r in rows_raw]

    # count estimate
    count_result = await db.execute(
        text(f'SELECT COUNT(*) FROM public."{table}"')  # noqa: S608
    )
    total = count_result.scalar()

    return {
        "table":  table,
        "offset": offset,
        "limit":  limit,
        "total":  total,
        "rows":   rows,
    }


@router.post("/refresh")
async def refresh_whitelist() -> dict:
    """Force-refresh whitelist cache (เรียกหลัง schema เปลี่ยน)"""
    global _table_whitelist
    _table_whitelist = None
    return {"refreshed": True}
