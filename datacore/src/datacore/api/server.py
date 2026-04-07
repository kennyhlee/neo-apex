"""Uvicorn entry point for the datacore API."""

from datacore.api import create_app
from datacore.embedder import Embedder
from datacore.store import Store

_store = Store(embedder=Embedder())
app = create_app(_store)
