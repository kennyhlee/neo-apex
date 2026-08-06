# apexflow/backend/app/main.py
"""FastAPI application entry point for apexflow backend.

Ported/trimmed from enrollx/backend/app/main.py: this task scaffolds only
config, auth deps, the DataCore client, tokens, and emails (see
task-1-brief.md) — no business routers exist yet, so this app only mounts a
health check. Later tasks add routers the same way enrollx's main.py does
(`app.include_router(...)`).

task-1-brief.md Step 3 asserts `/health` (no `/api` prefix, unlike enrollx's
`/api/health`) — there is no api/ package in this task's file list, so the
route is declared directly here rather than in a separate app/api/health.py.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import definitions as definitions_api
from app.api import documents as documents_api
from app.api import instances as instances_api
from app.api import internal as internal_api
from app.config import settings

app = FastAPI(
    title="ApexFlow Backend",
    description="Generic workflow engine: registration flow builder, "
                 "application lifecycle, tracking — generalized from enrollx-backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(definitions_api.router)
app.include_router(instances_api.router)
app.include_router(documents_api.router, prefix="/api")
app.include_router(internal_api.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "apexflow-backend"}
