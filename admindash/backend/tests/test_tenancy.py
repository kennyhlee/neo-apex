"""Tenant-match enforcement on proxy routes."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import require_authenticated_user
from app.tenancy import assert_tenant_scoped_sql
from fastapi import HTTPException


def fake_user_acme():
    return {"user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}


@pytest.fixture
def client():
    app.dependency_overrides[require_authenticated_user] = fake_user_acme
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_cross_tenant_entity_write_is_403(client):
    resp = client.post("/api/entities/othertenant/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_cross_tenant_leads_read_is_403(client):
    resp = client.get("/api/leads/othertenant")
    assert resp.status_code == 403


def test_query_referencing_other_tenant_table_is_403(client):
    resp = client.post("/api/query", json={"sql": "SELECT * FROM othertenant_entities"})
    assert resp.status_code == 403


def test_sql_guard_allows_own_tenant_tables():
    assert_tenant_scoped_sql("SELECT * FROM acme_entities e JOIN acme_models m ON 1=1", "acme")


def test_sql_guard_rejects_foreign_table():
    with pytest.raises(HTTPException) as exc:
        assert_tenant_scoped_sql("SELECT * FROM globex_entities", "acme")
    assert exc.value.status_code == 403


def test_sql_guard_rejects_global_table():
    with pytest.raises(HTTPException):
        assert_tenant_scoped_sql("SELECT * FROM global", "acme")
