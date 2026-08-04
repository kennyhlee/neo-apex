# familyhub/backend/tests/test_health.py
from fastapi.testclient import TestClient

from app.main import app


def test_health():
    resp = TestClient(app).get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "familyhub-backend"
