from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import asyncio
import importlib
import logging

from app.core.config import settings
from app.routers import auth, logs, system, health, mappings, databases, sessions
from app.routers import sync as sync_router
from app.routers.presence    import router as presence_router, _evict_stale
from app.routers.activity    import router as activity_router
from app.routers.users       import router as users_router
from app.middleware.logging_middleware     import LoggingMiddleware
from app.middleware.maintenance_middleware import MaintenanceMiddleware
from app.middleware.rate_limit_middleware  import RateLimitMiddleware
from app.db.database import init_db
from app import sync_engine
from app import log_retention_scheduler

admin_logs_router = None
for module_name in ("app.routers.admin_logs", "app.routers.adminlogs", "app.routers.admin_log"):
    try:
        module = importlib.import_module(module_name)
        admin_logs_router = module.router
        break
    except ModuleNotFoundError:
        continue

if admin_logs_router is None:
    raise ImportError("Could not import admin logs router module")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="BA Tool API",
    version="1.0.0",
    docs_url="/docs"  if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(MaintenanceMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


async def _seed_env_admin() -> None:
    from sqlalchemy import select
    from app.db.database import AsyncSessionLocal
    from app.db.models import AdminUser
    from app.core.security import get_password_hash
    from datetime import datetime, timezone

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AdminUser).where(AdminUser.username == settings.ADMIN_USERNAME)
        )
        user   = result.scalar_one_or_none()
        hashed = get_password_hash(settings.ADMIN_PASSWORD)

        if user is None:
            db.add(AdminUser(
                username     = settings.ADMIN_USERNAME,
                hashed_pw    = hashed,
                role         = "admin",
                display_name = "Superadmin",
                is_active    = True,
                created_at   = datetime.now(timezone.utc),
            ))
            logger.info("Seeded env superadmin '%s'", settings.ADMIN_USERNAME)
        else:
            user.role = "admin"
            logger.info("Env superadmin '%s' already exists", settings.ADMIN_USERNAME)

        await db.commit()


@app.on_event("startup")
async def on_startup():
    await init_db()
    logger.info("Database tables initialized")
    await _seed_env_admin()

    asyncio.create_task(_evict_stale())
    logger.info("Presence heartbeat monitor started")

    sync_engine.start_scheduler()
    logger.info("Sync engine scheduler started")

    log_retention_scheduler.start_scheduler()
    logger.info("Log retention scheduler started")


@app.on_event("shutdown")
async def on_shutdown():
    sync_engine.stop_scheduler()
    logger.info("Sync engine scheduler stopped")

    log_retention_scheduler.stop_scheduler()
    logger.info("Log retention scheduler stopped")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    message = str(exc) if settings.ENVIRONMENT != "production" else "Internal server error"
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": message},
    )


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(health.router,           prefix="/api")
app.include_router(auth.router,             prefix="/api/auth")
app.include_router(logs.router,             prefix="/api")
app.include_router(system.router,           prefix="/api/system")
app.include_router(mappings.router,         prefix="/api")
app.include_router(databases.router,        prefix="/api")
app.include_router(sessions.router,         prefix="/api")
app.include_router(sync_router.router,      prefix="/api")
app.include_router(presence_router)
app.include_router(activity_router,         prefix="/api")
app.include_router(users_router,            prefix="/api")
app.include_router(admin_logs_router,       prefix="/api")
