# familyhub/backend/app/main.py
"""FastAPI application entry point for familyhub backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import application, health, registration
from app.config import settings

app = FastAPI(
    title="FamilyHub Backend",
    description="Family-facing channel: registration runtime and parent hub",
    version="0.1.0",
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
