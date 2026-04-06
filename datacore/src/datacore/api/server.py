"""Uvicorn entry point for the datacore API."""

from datacore.api import create_app
from datacore.auth.seed import seed_test_user
from datacore.embedder import Embedder
from datacore.store import Store

_store = Store(embedder=Embedder())
seed_test_user(_store)
app = create_app(_store)
