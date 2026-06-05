from datetime import datetime, timezone, date
from typing import Optional
from sqlalchemy import Integer, String, Boolean, DateTime, Date, UniqueConstraint, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ─────────────────────────────────────────────────────────────────────────────
class MappingRule(Base):
    __tablename__ = "mapping_rules"
    __table_args__ = (
        UniqueConstraint("src_db", "source_type", "raw_type", "dest_db", "final_type", name="uq_mapping_rules"),
        Index("ix_mapping_src_db",  "src_db"),
        Index("ix_mapping_dest_db", "dest_db"),
        Index("ix_mapping_status",  "status"),
    )

    id:            Mapped[int]            = mapped_column(Integer, primary_key=True, autoincrement=True)
    src_db:        Mapped[str]            = mapped_column(String(64),  nullable=False)
    raw_type:      Mapped[str]            = mapped_column(String(128), nullable=False)
    source_type:   Mapped[str]            = mapped_column(String(128), default="")
    logical_type:  Mapped[str]            = mapped_column(String(128), default="")
    master_type:   Mapped[str]            = mapped_column(String(128), default="")
    dest_db:       Mapped[str]            = mapped_column(String(64),  nullable=False)
    final_type:    Mapped[str]            = mapped_column(String(128), default="")
    confidence:    Mapped[int]            = mapped_column(Integer,     default=100)
    status:        Mapped[str]            = mapped_column(String(32),  default="draft")
    updated:       Mapped[datetime]        = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    error_message: Mapped[Optional[str]]  = mapped_column(String(512), nullable=True, default=None)
    synced_at:     Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    retry_count:   Mapped[int]            = mapped_column(Integer, default=0)

    def to_dict(self) -> dict:
        return {
            "id":            self.id,
            "src_db":        self.src_db,
            "raw_type":      self.raw_type,
            "source_type":   self.source_type,
            "logical_type":  self.logical_type,
            "master_type":   self.master_type,
            "dest_db":       self.dest_db,
            "final_type":    self.final_type,
            "confidence":    self.confidence,
            "status":        self.status,
            "updated":       self.updated.isoformat() if self.updated else None,
            "error_message": self.error_message,
            "synced_at":     self.synced_at.isoformat() if self.synced_at else None,
            "retry_count":   self.retry_count,
        }


# ─────────────────────────────────────────────────────────────────────────────
class DatabaseRecord(Base):
    __tablename__ = "database_records"
    __table_args__ = (
        Index("ix_db_record_key", "key"),
    )

    id:      Mapped[int]  = mapped_column(Integer, primary_key=True, autoincrement=True)
    key:     Mapped[str]  = mapped_column(String(64),  unique=True, nullable=False)
    name:    Mapped[str]  = mapped_column(String(128), nullable=False)
    version: Mapped[str]  = mapped_column(String(32),  default="")
    status:  Mapped[str]  = mapped_column(String(32),  default="active")
    enabled: Mapped[bool] = mapped_column(Boolean,     default=True)

    def to_dict(self, rules: int = 0, sessions: int = 0) -> dict:
        return {
            "id":       self.id,
            "key":      self.key,
            "name":     self.name,
            "version":  self.version,
            "status":   self.status,
            "enabled":  self.enabled,
            "rules":    rules,
            "sessions": sessions,
        }


# ─────────────────────────────────────────────────────────────────────────────
class DatatypeStandard(Base):
    __tablename__ = "datatype_standard"

    id:            Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    standard_type: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description:   Mapped[str] = mapped_column(String(256), default="")

    def to_dict(self) -> dict:
        return {
            "id":            self.id,
            "standard_type": self.standard_type,
            "description":   self.description,
        }


# ─────────────────────────────────────────────────────────────────────────────
class SessionRecord(Base):
    __tablename__ = "session_records"
    __table_args__ = (
        Index("ix_session_db",     "db"),
        Index("ix_session_status", "status_cache"),
    )

    id:           Mapped[str] = mapped_column(String(64),  primary_key=True)
    user:         Mapped[str] = mapped_column(String(128), nullable=False)
    role:         Mapped[str] = mapped_column(String(32),  default="user")
    db:           Mapped[str] = mapped_column(String(64),  nullable=False)
    tables:       Mapped[int] = mapped_column(Integer,     default=0)
    ttl_minutes:  Mapped[int] = mapped_column(Integer,     default=60)
    created:      Mapped[str] = mapped_column(String(32),  default=_now_str)
    status_cache: Mapped[str] = mapped_column(String(16),  default="active")

    def to_dict(self) -> dict:
        try:
            created_dt = datetime.strptime(self.created, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            created_dt = datetime.now(timezone.utc)
        elapsed = (datetime.now(timezone.utc) - created_dt).total_seconds() / 60
        ttl     = max(0, int(self.ttl_minutes - elapsed))
        status  = "expired" if ttl <= 0 else "warning" if ttl < 10 else "active"
        return {
            "id":      self.id,
            "user":    self.user,
            "role":    self.role,
            "db":      self.db,
            "tables":  self.tables,
            "created": self.created,
            "ttl":     ttl,
            "status":  status,
        }


# ─────────────────────────────────────────────────────────────────────────────
class SystemSetting(Base):
    __tablename__ = "system_settings"

    key:   Mapped[str] = mapped_column(String(64),  primary_key=True)
    value: Mapped[str] = mapped_column(String(256), nullable=False, default="")


# ─────────────────────────────────────────────────────────────────────────────
class UpdateActivity(Base):
    """บันทึกทุกครั้งที่ผู้ใช้ทำการ create / update / delete mapping rules"""
    __tablename__ = "update_activities"
    __table_args__ = (
        Index("ix_activity_user",       "username"),
        Index("ix_activity_action",     "action"),
        Index("ix_activity_created_at", "created_at"),
    )

    id:          Mapped[int]           = mapped_column(Integer,  primary_key=True, autoincrement=True)
    username:    Mapped[str]           = mapped_column(String(128), nullable=False)
    action:      Mapped[str]           = mapped_column(String(32),  nullable=False)
    target_type: Mapped[str]           = mapped_column(String(64),  default="mapping")
    target_id:   Mapped[Optional[str]] = mapped_column(String(64),  nullable=True)
    summary:     Mapped[str]           = mapped_column(String(256), default="")
    detail:      Mapped[Optional[str]] = mapped_column(Text,        nullable=True)
    created_at:  Mapped[datetime]      = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def to_dict(self) -> dict:
        return {
            "id":          self.id,
            "username":    self.username,
            "action":      self.action,
            "target_type": self.target_type,
            "target_id":   self.target_id,
            "summary":     self.summary,
            "detail":      self.detail,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
class AdminUser(Base):
    """ผู้ใช้งานระบบ Admin Console"""
    __tablename__ = "admin_users"
    __table_args__ = (
        Index("ix_admin_user_username", "username", unique=True),
    )

    id:           Mapped[int]           = mapped_column(Integer,  primary_key=True, autoincrement=True)
    username:     Mapped[str]           = mapped_column(String(128), nullable=False, unique=True)
    hashed_pw:    Mapped[str]           = mapped_column(String(256), nullable=False)
    role:         Mapped[str]           = mapped_column(String(32),  default="viewer")
    display_name: Mapped[str]           = mapped_column(String(128), default="")
    is_active:    Mapped[bool]          = mapped_column(Boolean,     default=True)
    created_at:   Mapped[datetime]      = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_login:   Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "username":     self.username,
            "role":         self.role,
            "display_name": self.display_name,
            "is_active":    self.is_active,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "last_login":   self.last_login.isoformat() if self.last_login else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
class BatoolLog(Base):
    """Log จาก BA Tool backend"""
    __tablename__ = "batool_logs"
    __table_args__ = (
        Index("ix_batool_log_level",       "level"),
        Index("ix_batool_log_created_at",  "created_at"),
        Index("ix_batool_log_external_key", "external_key", unique=True),
    )

    id:           Mapped[int]           = mapped_column(Integer, primary_key=True, autoincrement=True)
    level:        Mapped[str]           = mapped_column(String(16),  default="INFO", nullable=False)
    message:      Mapped[str]           = mapped_column(Text,        default="",     nullable=False)
    detail:       Mapped[Optional[str]] = mapped_column(Text,        nullable=True)
    source_file:  Mapped[Optional[str]] = mapped_column(String(128), nullable=True,  default=None)
    username:     Mapped[Optional[str]] = mapped_column(String(128), nullable=True,  default=None)  # ← เพิ่ม: ใครทำ
    external_key: Mapped[Optional[str]] = mapped_column(String(256), nullable=True,  default=None)
    created_at:   Mapped[datetime]      = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def to_dict(self) -> dict:
        return {
            "id":          self.id,
            "level":       self.level,
            "source":      "batool-backend",
            "source_file": self.source_file,
            "username":    self.username,
            "message":     self.message,
            "detail":      self.detail,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
class AdminConsoleLog(Base):
    """Log จาก Admin Console backend (request / system events)"""
    __tablename__ = "admin_console_logs"
    __table_args__ = (
        Index("ix_admin_log_level",       "level"),
        Index("ix_admin_log_created_at",  "created_at"),
        Index("ix_admin_log_external_key", "external_key", unique=True),
    )

    id:           Mapped[int]           = mapped_column(Integer, primary_key=True, autoincrement=True)
    level:        Mapped[str]           = mapped_column(String(16),  default="INFO", nullable=False)
    message:      Mapped[str]           = mapped_column(Text,        default="",     nullable=False)
    detail:       Mapped[Optional[str]] = mapped_column(Text,        nullable=True)
    source_file:  Mapped[Optional[str]] = mapped_column(String(128), nullable=True,  default=None)
    username:     Mapped[Optional[str]] = mapped_column(String(128), nullable=True,  default=None)  # ← เพิ่ม: ใครทำ
    external_key: Mapped[Optional[str]] = mapped_column(String(256), nullable=True,  default=None)
    created_at:   Mapped[datetime]      = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def to_dict(self) -> dict:
        return {
            "id":          self.id,
            "level":       self.level,
            "source":      "admin-console",
            "source_file": self.source_file,
            "username":    self.username,
            "message":     self.message,
            "detail":      self.detail,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }
