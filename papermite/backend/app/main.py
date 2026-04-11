"""FastAPI application entry point for Papermite."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, upload, extraction, finalize, extract
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="Papermite",
    description="Document ingestion gateway for the NeoApex platform",
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
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(extraction.router, prefix="/api", tags=["schema"])
app.include_router(finalize.router, prefix="/api", tags=["finalize"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
