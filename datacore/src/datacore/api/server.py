"""Uvicorn entry point for the datacore API."""

from datacore.api import create_app
from datacore.store import Store

app = create_app(Store())
