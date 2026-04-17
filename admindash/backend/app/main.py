"""FastAPI application entry point for admindash backend."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, entities, extract, health, query
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="Admindash Backend",
    description="School operations backend powering the admindash product",
    version="0.1.0",
)

# Cloudflare IP allowlist — rejects non-Cloudflare traffic in production.
# Set TRUST_ALL_IPS=1 in dev to bypass.
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

# Auth routes mounted at root → /auth/login, /auth/me
# (matches what admindash currently calls on DataCore directly)
app.include_router(auth.router, prefix="/auth", tags=["auth"])

# Other routes mounted under /api → /api/health, /api/query, /api/entities/...
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(entities.router, prefix="/api", tags=["entities"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
