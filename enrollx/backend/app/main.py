# enrollx/backend/app/main.py
"""FastAPI application entry point for enrollx backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, entities, health, internal, query, registration, stripe_connect
from app.config import settings

app = FastAPI(
    title="EnrollX Backend",
    description="Enrollment system of action: flow builder, application lifecycle, tracking",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(entities.router, prefix="/api", tags=["entities"])
app.include_router(registration.router, prefix="/api", tags=["registration"])
app.include_router(internal.router, tags=["internal"])
app.include_router(stripe_connect.router, prefix="/api", tags=["stripe"])
