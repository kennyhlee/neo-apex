"""POST /api/registration/{tenant}/applications — staff creation endpoint."""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore, seed_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


BODY = {"school_year": "2026-2027",
        "channel": "admin", "applicant_email": "parent@example.com"}


def test_create_application_201_with_items(client, fake_dc):
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json=BODY)
    assert resp.status_code == 201
    data = resp.json()
    assert data["application"]["base_data"]["status"] == "draft"
    assert data["application"]["base_data"]["channel_started"] == "admin"
    assert len(data["items"]) == 4
    kinds = sorted(i["base_data"]["kind"] for i in data["items"])
    assert kinds == ["document", "document", "form", "payment"]

    # Verify items were actually persisted via the fake, keyed on the
    # application's entity_id (not the human application_id).
    app_entity_id = data["application"]["entity_id"]
    stored_items = fake_dc.find("application_item", application_id=app_entity_id)
    assert len(stored_items) == 4


def test_create_application_404_without_config(client, fake_dc):
    resp = client.post("/api/registration/acme/applications", json=BODY)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No published registration config for this tenant"


def test_create_application_rejects_program_id_422(client, fake_dc):
    """Shim-free cutover (spec §8): a caller still sending program_id must
    fail loudly rather than have it silently ignored."""
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications",
                       json={**BODY, "program_id": "PR1"})
    assert resp.status_code == 422


def test_create_application_requires_school_year_422(client, fake_dc):
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications",
                       json={"channel": "admin"})
    assert resp.status_code == 422


def test_create_application_validates_channel(client, fake_dc):
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications",
                       json={**BODY, "channel": "carrier-pigeon"})
    assert resp.status_code == 422


def test_create_application_requires_auth(fake_dc):
    resp = TestClient(app).post("/api/registration/acme/applications", json=BODY)
    assert resp.status_code == 401


def test_create_application_cross_tenant_403(client, fake_dc):
    resp = client.post("/api/registration/globex/applications", json=BODY)
    assert resp.status_code == 403


def test_create_application_parent_role_403(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "p1", "tenant_id": "acme", "role": "parent", "_token": "Bearer x"}
    try:
        resp = TestClient(app).post("/api/registration/acme/applications", json=BODY)
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()
