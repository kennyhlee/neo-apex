"""Pytest fixtures for admindash backend tests."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Provides a TestClient against the FastAPI app.

    Imports inside the fixture so test_cors.py can manipulate env vars
    before the app is constructed.
    """
    from app.main import app
    with TestClient(app) as c:
        yield c
