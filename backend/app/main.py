from pathlib import Path
from alembic import command
from alembic.config import Config
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from .config import get_settings
from .routers.api import api
from .rate_limit import limiter

settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0", description="Live inventory intelligence, forecasting, waste prevention, reordering, and grounded decision support.")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])


@app.on_event("startup")
def apply_schema_migrations() -> None:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"message": str(exc.detail), "status": exc.status_code}})


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok", "service": settings.app_name, "environment": settings.environment}


app.include_router(api)
