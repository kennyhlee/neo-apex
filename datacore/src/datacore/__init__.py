"""Datacore — centralized storage and query engine for NeoApex."""

from datacore.store import Store
from datacore.query import QueryEngine
from datacore.api import create_app


def __getattr__(name):
    if name == "Embedder":
        from datacore.embedder import Embedder
        return Embedder
    raise AttributeError(f"module 'datacore' has no attribute {name!r}")


__all__ = ["Store", "QueryEngine", "create_app", "Embedder"]
