"""Tests for global (non-tenant-scoped) table support."""
import pytest
import tempfile
from datacore import Store


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        yield Store(data_dir=d)


class TestPutGlobal:
    def test_creates_record(self, store):
        result = store.put_global("registry", "user:u-001", {
            "email": "jane@acme.edu",
            "name": "Jane Admin",
            "tenant_id": "acme",
            "role": "admin",
        })
        assert result["record_key"] == "user:u-001"
        assert result["data"]["email"] == "jane@acme.edu"
        assert result["_created_at"] is not None

    def test_updates_existing_record(self, store):
        store.put_global("registry", "user:u-001", {"name": "Jane"})
        result = store.put_global("registry", "user:u-001", {"name": "Jane Updated"})
        assert result["data"]["name"] == "Jane Updated"
        assert result["_updated_at"] is not None


class TestGetGlobal:
    def test_returns_record(self, store):
        store.put_global("registry", "user:u-001", {"email": "jane@acme.edu"})
        result = store.get_global("registry", "user:u-001")
        assert result is not None
        assert result["data"]["email"] == "jane@acme.edu"

    def test_returns_none_for_missing(self, store):
        result = store.get_global("registry", "nonexistent")
        assert result is None


class TestQueryGlobal:
    def test_returns_all_records(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com", "tenant_id": "t1"})
        store.put_global("registry", "user:u-002", {"email": "b@test.com", "tenant_id": "t1"})
        store.put_global("registry", "user:u-003", {"email": "c@test.com", "tenant_id": "t2"})
        results = store.query_global("registry")
        assert len(results) == 3

    def test_filters_by_field(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com", "tenant_id": "t1"})
        store.put_global("registry", "user:u-002", {"email": "b@test.com", "tenant_id": "t2"})
        results = store.query_global("registry", filters={"tenant_id": "t1"})
        assert len(results) == 1
        assert results[0]["data"]["email"] == "a@test.com"

    def test_returns_empty_for_no_matches(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com", "tenant_id": "t1"})
        results = store.query_global("registry", filters={"tenant_id": "nonexistent"})
        assert len(results) == 0


class TestDeleteGlobal:
    def test_deletes_record(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com"})
        deleted = store.delete_global("registry", "user:u-001")
        assert deleted is True
        assert store.get_global("registry", "user:u-001") is None

    def test_returns_false_for_missing(self, store):
        deleted = store.delete_global("registry", "nonexistent")
        assert deleted is False
