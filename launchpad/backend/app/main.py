"""FastAPI application entry point for Launchpad."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, tenants, users
from app.config import settings
from app.middleware.cloudflare_ip import CloudflareIPMiddleware

app = FastAPI(
    title="Launchpad",
    description="Tenant lifecycle and identity service for the NeoApex platform",
    version="0.1.0",
)

# Cloudflare IP allowlist — only applied when not running behind trust-all env.
# In dev, start-services.sh sets TRUST_ALL_IPS=1.
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
app.include_router(tenants.router, prefix="/api", tags=["tenants"])
app.include_router(users.router, prefix="/api", tags=["users"])

@app.get("/api/health")
def health():
    return {"status": "ok"}
