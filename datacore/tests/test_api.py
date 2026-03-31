"""Tests for the datacore REST API."""

import tempfile

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def app_client():
    with tempfile.TemporaryDirectory() as tmp:
        store = Store(data_dir=tmp)
        app = create_app(store)
        yield TestClient(app), store


def test_cors_allows_admindash_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5174"


def test_cors_allows_papermite_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
