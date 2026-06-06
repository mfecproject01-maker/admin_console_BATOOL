from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List, Optional
import json


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ENVIRONMENT: str = "development"
    PORT: int = 8000

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str

    ANTHROPIC_API_KEY: Optional[str] = None

    ALLOWED_ORIGINS: List[str] = [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5500",
        "http://localhost:5501",
        "http://127.0.0.1",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:5501",
    ]
    ALLOWED_ORIGIN_REGEX: Optional[str] = None

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return []
            if value.startswith("["):
                return json.loads(value)
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        if not v or v in ("change-this-to-a-secure-random-string", "secret", "changeme", ""):
            raise ValueError(
                "SECRET_KEY must be set to a secure random value. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long.")
        return v

    @field_validator("ADMIN_PASSWORD")
    @classmethod
    def admin_password_must_be_set(cls, v: str) -> str:
        if not v or v in ("password", "admin", "changeme", ""):
            raise ValueError(
                "ADMIN_PASSWORD must be set to a secure value via environment variable."
            )
        return v

    @field_validator("DATABASE_URL")
    @classmethod
    def database_url_must_be_set(cls, v: str) -> str:
        if not v or "user:password@localhost" in v:
            raise ValueError(
                "DATABASE_URL must be set to a real database connection string."
            )
        return v

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
