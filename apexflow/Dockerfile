# syntax=docker/dockerfile:1.6
# Build context: apexflow/ (this Dockerfile lives at apexflow/Dockerfile)
FROM python:3.11-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.5.14

# Create user FIRST, then switch to it, then create workdir
RUN useradd --create-home --shell /bin/bash app
USER app
WORKDIR /app

# pyproject.toml + uv.lock live at apexflow/ (the build context root)
COPY --chown=app:app pyproject.toml uv.lock ./

# The Python package lives at apexflow/backend/app per hatch config
COPY --chown=app:app backend/app ./backend/app

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=5910

EXPOSE 5910

# From /app, uvicorn needs --app-dir backend to find app.main
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "5910"]
