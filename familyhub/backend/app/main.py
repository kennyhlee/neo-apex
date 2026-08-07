# familyhub/backend/app/main.py
"""FastAPI application entry point for familyhub backend."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import documents, health, instance, workflows
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware
from app.middleware.security_headers import (
    SecurityHeadersMiddleware,
    install_access_log_scrubber,
)

install_access_log_scrubber()

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

# Referrer-Policy: no-referrer on every response. Added last (=outermost —
# Starlette's add_middleware makes the most-recently-added layer wrap
# everything else added before it) so the header lands on ALL responses,
# including CORS preflight replies and the 403s CloudflareIPMiddleware sends
# directly without calling further inward.
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(workflows.router, prefix="/api", tags=["workflows"])
app.include_router(instance.router, prefix="/api", tags=["instance"])
app.include_router(documents.router, prefix="/api", tags=["documents"])
