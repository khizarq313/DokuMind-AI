# ═══════════════════════════════════════════
#  DocuMind Backend — Multi-stage Dockerfile
# ═══════════════════════════════════════════

# ── Stage 1: Builder ──
FROM python:3.11-slim as builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --no-compile --prefer-binary --prefix=/install -r requirements.txt \
    && find /install -type d \( -name "__pycache__" -o -name "tests" -o -name "test" \) -exec rm -rf {} + \
    && find /install -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete

# ── Stage 2: Production ──
FROM python:3.11-slim as production

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Create non-root user and runtime directories
RUN useradd --create-home --shell /bin/bash documind \
    && mkdir -p /app/data/uploads /app/data/images /app/data/chromadb /app/checkpoints \
    && chown -R documind:documind /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY --chown=documind:documind app/ ./app/
USER documind

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health').status == 200 else 1)"]

# Run with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
