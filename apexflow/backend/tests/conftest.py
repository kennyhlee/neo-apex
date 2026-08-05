# apexflow/backend/tests/conftest.py
"""Shared pytest fixtures for apexflow-backend.

enrollx's test suite duplicates a `fake_dc` + `client` fixture pair in nearly
every test file (it has no conftest.py of its own). apexflow-backend starts
fresh, so task-1-brief.md Step 2 asks for these to be centralized here
instead — see tests/fakes.py for `FakeDataCore`/`install_fake_datacore`
themselves.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    return TestClient(app)
