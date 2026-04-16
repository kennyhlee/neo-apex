# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS runtime

# System deps: curl for health checks, ca-certificates for HTTPS to downstream services
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install uv (pinned release)
RUN pip install --no-cache-dir uv==0.5.14

# Non-root user — switch before WORKDIR so /app is created owned by app
RUN useradd --create-home --shell /bin/bash app
USER app
WORKDIR /app

# Copy dependency manifests first so this layer is cached when only source changes
COPY --chown=app:app pyproject.toml uv.lock ./

# Copy source
COPY --chown=app:app src ./src

# Sync dependencies into a project-local venv (honors uv.lock)
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5800

EXPOSE 5800

# DataCore's entrypoint is datacore.api.server:app (matches start-services.sh)
CMD ["uvicorn", "datacore.api.server:app", "--host", "0.0.0.0", "--port", "5800"]
