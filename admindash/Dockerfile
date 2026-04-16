# syntax=docker/dockerfile:1.6
# Build context: admindash/ (this Dockerfile lives at admindash/Dockerfile)
FROM python:3.11-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
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
    PORT=5610

EXPOSE 5610

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "::", "--port", "5610"]
