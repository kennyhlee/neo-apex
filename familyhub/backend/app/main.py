# familyhub/backend/app/main.py
"""FastAPI application entry point for familyhub backend."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import application, documents, health, registration
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="FamilyHub Backend",
    description="Family-facing channel: registration runtime and parent hub",
    version="0.1.0",
)

# Cloudflare IP allowlist — rejects non-Cloudflare traffic in production.
# Set TRUST_ALL_IPS=1 in dev to bypass. Also the reason `ratelimit.py`'s
# `_client_ip` can trust the `CF-Connecting-IP` header: any request that
# reaches a route handler has already been proven, by this middleware, to
# have arrived via a genuine Cloudflare edge (or Fly's private network).
app.add_middleware(
    CloudflareIPMiddleware,
    trust_all_ips=os.environ.get("TRUST_ALL_IPS") == "1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(registration.router, prefix="/api", tags=["registration"])
app.include_router(application.router, prefix="/api", tags=["application"])
app.include_router(documents.router, prefix="/api", tags=["documents"])
