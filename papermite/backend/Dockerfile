# syntax=docker/dockerfile:1.6
# Build context: papermite/ (NOT papermite/backend/)
# Build with: docker build -t papermite-api-test -f papermite/backend/Dockerfile papermite/
FROM python:3.11-slim AS runtime

# System deps:
# - curl + ca-certificates for health checks + HTTPS to downstream services
# - poppler-utils: PDF → text for docling
# - libmagic1: file type detection
# - build-essential + pkg-config: some Python deps need a compiler at install time
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    libmagic1 \
    pkg-config \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.5.14

# Create user FIRST, then switch to it, then create workdir
RUN useradd --create-home --shell /bin/bash app
USER app
WORKDIR /app

COPY --chown=app:app pyproject.toml uv.lock ./
COPY --chown=app:app backend/app ./backend/app

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5710

EXPOSE 5710

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "5710"]
