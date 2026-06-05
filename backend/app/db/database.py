from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from typing import AsyncGenerator

from app.core.config import settings

_url = settings.DATABASE_URL
if _url.startswith("postgresql://"):
    _url = _url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif _url.startswith("postgres://"):
    _url = _url.replace("postgres://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    _url,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    echo=False,
    connect_args={"statement_cache_size": 0},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """สร้าง table ทั้งหมดถ้ายังไม่มี + safe migrations"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # ── Safe migrations (idempotent ALTER TABLE) ──────────────────────────

        # session_records.status_cache
        await conn.execute(text(
            "ALTER TABLE session_records "
            "ADD COLUMN IF NOT EXISTS status_cache VARCHAR(16) DEFAULT 'active'"
        ))

        # mapping_rules — sync/audit fields (migration 001)
        await conn.execute(text(
            "ALTER TABLE mapping_rules "
            "ADD COLUMN IF NOT EXISTS error_message VARCHAR(256) DEFAULT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE mapping_rules "
            "ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE DEFAULT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE mapping_rules "
            "ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE mapping_rules "
            "ADD COLUMN IF NOT EXISTS source_type VARCHAR(128) DEFAULT ''"
        ))

        # unique index บน database_records.key (case-insensitive)
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_db_record_key_lower "
            "ON database_records (LOWER(key))"
        ))

        # ── Migration 007: system_logs ────────────────────────────────────────
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS system_logs (
                id         SERIAL       PRIMARY KEY,
                level      VARCHAR(16)  NOT NULL DEFAULT 'INFO',
                source     VARCHAR(64)  NOT NULL DEFAULT 'system',
                message    TEXT         NOT NULL DEFAULT '',
                detail     TEXT,
                created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_syslog_level      ON system_logs (level)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_syslog_source     ON system_logs (source)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_syslog_created_at ON system_logs (created_at DESC)"
        ))
        await conn.execute(text(
            "ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS external_key VARCHAR(256) DEFAULT NULL"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_syslog_external_key "
            "ON system_logs (external_key) WHERE external_key IS NOT NULL"
        ))

        # ── Migration 008: แยก log เป็น batool_logs + admin_console_logs ───────
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS batool_logs (
                id           SERIAL       PRIMARY KEY,
                level        VARCHAR(16)  NOT NULL DEFAULT 'INFO',
                message      TEXT         NOT NULL DEFAULT '',
                detail       TEXT,
                external_key VARCHAR(256),
                created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "ALTER TABLE batool_logs ADD COLUMN IF NOT EXISTS source_file VARCHAR(128) DEFAULT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE batool_logs ADD COLUMN IF NOT EXISTS username VARCHAR(128) DEFAULT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE batool_logs ADD COLUMN IF NOT EXISTS external_key VARCHAR(256) DEFAULT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_batool_log_level ON batool_logs (level)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_batool_log_created_at ON batool_logs (created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_batool_log_external_key "
            "ON batool_logs (external_key) WHERE external_key IS NOT NULL"
        ))

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_console_logs (
                id           SERIAL       PRIMARY KEY,
                level        VARCHAR(16)  NOT NULL DEFAULT 'INFO',
                message      TEXT         NOT NULL DEFAULT '',
                detail       TEXT,
                external_key VARCHAR(256),
                created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "ALTER TABLE admin_console_logs ADD COLUMN IF NOT EXISTS source_file VARCHAR(128) DEFAULT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE admin_console_logs ADD COLUMN IF NOT EXISTS username VARCHAR(128) DEFAULT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE admin_console_logs ADD COLUMN IF NOT EXISTS external_key VARCHAR(256) DEFAULT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_admin_log_level ON admin_console_logs (level)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_admin_log_created_at ON admin_console_logs (created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_admin_log_external_key "
            "ON admin_console_logs (external_key) WHERE external_key IS NOT NULL"
        ))

        # ย้ายข้อมูลเก่าจาก system_logs (ครั้งเดียว)
        await conn.execute(text("""
            INSERT INTO batool_logs (level, message, detail, external_key, created_at)
            SELECT level, message, detail, external_key, created_at
            FROM system_logs
            WHERE source = 'batool-backend'
              AND NOT EXISTS (
                SELECT 1 FROM batool_logs b
                WHERE b.external_key IS NOT NULL
                  AND b.external_key = system_logs.external_key
              )
        """))
        await conn.execute(text("""
            INSERT INTO admin_console_logs (level, message, detail, external_key, created_at)
            SELECT level, message, detail, external_key, created_at
            FROM system_logs
            WHERE source IN ('admin-console', 'admin-backend')
              AND NOT EXISTS (
                SELECT 1 FROM admin_console_logs a
                WHERE a.external_key IS NOT NULL
                  AND a.external_key = system_logs.external_key
              )
        """))

        # ── Migration 002: sync target tables ───────────────────────────────
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS datatype_raw_mapping (
                id           SERIAL PRIMARY KEY,
                db_id        INTEGER      NOT NULL,
                source_type  VARCHAR(128) NOT NULL DEFAULT '',
                raw_type     VARCHAR(128) NOT NULL,
                logical_type VARCHAR(128) NOT NULL DEFAULT '',
                standard_id  INTEGER,
                created_at   TIMESTAMPTZ  DEFAULT NOW(),
                updated_at   TIMESTAMPTZ  DEFAULT NOW(),
                CONSTRAINT unique_mapping_idx UNIQUE (db_id, raw_type, logical_type, source_type, standard_id)
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_raw_mapping_db_id ON datatype_raw_mapping (db_id)"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS datatype_mapping (
                id          SERIAL PRIMARY KEY,
                db_id       INTEGER      NOT NULL,
                standard_id INTEGER      NOT NULL,
                final_type  VARCHAR(128) NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ  DEFAULT NOW(),
                updated_at  TIMESTAMPTZ  DEFAULT NOW(),
                CONSTRAINT uq_datatype_mapping UNIQUE (db_id, standard_id)
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_datatype_mapping_db_id ON datatype_mapping (db_id)"
        ))
