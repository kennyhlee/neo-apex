"""FastAPI application entry point for Papermite."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, upload, extraction, finalize, extract

app = FastAPI(
    title="Papermite",
    description="Document ingestion gateway for the NeoApex platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(extraction.router, prefix="/api", tags=["schema"])
app.include_router(finalize.router, prefix="/api", tags=["finalize"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
