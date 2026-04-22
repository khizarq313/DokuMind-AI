"""
DocuMind — Multi-Modal RAG Platform

FastAPI application entry point with CORS, structured logging,
health checks, and all route registrations.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.config import settings
from app.models.schemas import HealthResponse
from app.routers import documents, query, analytics
from app.services.mlops import init_mlflow
from app.utils.logging import setup_logging, get_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle — startup and shutdown hooks."""
    setup_logging()
    logger = get_logger("main")
    logger.info("starting_documind", version="1.2.0-beta")

    # Initialize MLflow (optional — fails gracefully if unavailable)
    try:
        init_mlflow()
    except Exception as exc:
        logger.warning("mlflow_init_skipped", error=str(exc))

    # Ensure data directories exist (uses /tmp on Vercel, ./data elsewhere)
    import os as _os
    _data_base = Path("/tmp/documind") if _os.environ.get("VERCEL") else Path("./data")
    try:
        (_data_base / "uploads").mkdir(parents=True, exist_ok=True)
        (_data_base / "images").mkdir(parents=True, exist_ok=True)
        (_data_base / "chromadb").mkdir(parents=True, exist_ok=True)
    except OSError:
        pass  # Read-only filesystem on certain serverless runtimes

    logger.info("documind_ready", host=settings.backend_host, port=settings.backend_port)
    yield
    logger.info("shutting_down")


app = FastAPI(
    title="DocuMind AI",
    description="Multi-Modal RAG Platform for Document Intelligence",
    version="1.2.0-beta",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# Build CORS origins from config + well-known dev/prod values.
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://doku-mind-p1nmijfnk-khizarq313s-projects.vercel.app",
    "https://doku-mind-ai-git-main-khizarq313s-projects.vercel.app",
    "https://doku-mind-ai.vercel.app",
]

# Allow any extra origin set via FRONTEND_URL env var (e.g. the Render preview URL)
if settings.frontend_url and settings.frontend_url not in origins:
    origins.append(settings.frontend_url)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ──
app.include_router(documents.router)
app.include_router(query.router)
app.include_router(analytics.router)


@app.get("/api/health", response_model=HealthResponse)
async def health():
    """Health check endpoint with service status."""
    services = {
        "api": "healthy",
        "chromadb": "healthy",
        "mlflow": "healthy",
    }

    # Check ChromaDB connectivity
    try:
        from app.services.embedding import get_collection
        get_collection()
    except Exception:
        services["chromadb"] = "unhealthy"

    return HealthResponse(
        status="healthy" if all(v == "healthy" for v in services.values()) else "degraded",
        services=services,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=True,
        log_level=settings.log_level.lower(),
    )
