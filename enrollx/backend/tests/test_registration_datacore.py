"""DataCore client: SQL construction, auth-header policy, error mapping.

Also self-tests FakeDataCore, the in-memory stub every other test file uses.
"""
import httpx
import pytest
from fastapi import HTTPException

from app.registration import datacore as dc
from tests.fakes import FakeDataCore, install_fake_datacore


class DummyResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


@pytest.fixture
def capture(monkeypatch):
    captured = {}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        captured.update(method=method, url=url, json=json, headers=headers)
        return DummyResponse(captured.pop("_status", 200), captured.pop("_payload", {"data": []}))

    monkeypatch.setattr(httpx, "request", fake_request)
    return captured


def test_list_entities_builds_scoped_sql(capture):
    capture["_payload"] = {"data": [{"entity_id": "e1"}]}
    rows = dc.list_entities("acme", "registration_application", "program_id = 'PR1'")
    assert rows == [{"entity_id": "e1"}]
    assert capture["json"]["sql"] == (
        "SELECT * FROM data WHERE entity_type = 'registration_application' "
        "AND _status = 'active' AND program_id = 'PR1'"
    )
    assert capture["json"]["tenant_id"] == "acme"
    assert "Authorization" not in capture["headers"]


def test_token_is_forwarded_when_present(capture):
    dc.list_entities("acme", "program", token="Bearer xyz")
    assert capture["headers"]["Authorization"] == "Bearer xyz"


def test_dc_create_posts_and_raises_on_error(capture):
    capture["_status"] = 400
    capture["_payload"] = {"detail": "bad"}
    with pytest.raises(HTTPException) as exc:
        dc.dc_create("acme", "student", {"first_name": "A"})
    assert exc.value.status_code == 400


def test_unreachable_datacore_is_502(monkeypatch):
    def boom(*args, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "request", boom)
    with pytest.raises(HTTPException) as exc:
        dc.dc_query("acme", "SELECT 1")
    assert exc.value.status_code == 502


def test_next_id_returns_value(capture):
    capture["_payload"] = {"next_id": "AC-RA260001"}
    assert dc.next_id("acme", "registration_application") == "AC-RA260001"
    assert capture["url"].endswith("/api/entities/acme/registration_application/next-id")


# ── Injection hygiene ──────────────────────────────────────────────────────

def test_sql_literal_escapes_quotes():
    assert dc.sql_literal("O'Brien") == "'O''Brien'"


def test_get_entity_rejects_malicious_entity_id_without_querying(capture):
    """A quote-bearing entity_id must be rejected before any request is sent —
    it must not be able to widen the result set or escape the entity_type scope.
    """
    with pytest.raises(HTTPException) as exc:
        dc.get_entity("acme", "program", "x' OR '1'='1")
    assert exc.value.status_code == 400
    assert capture == {}  # fake_request was never called


def test_list_entities_rejects_malicious_entity_type_without_querying(capture):
    with pytest.raises(HTTPException) as exc:
        dc.list_entities("acme", "program'; DROP TABLE data; --")
    assert exc.value.status_code == 400
    assert capture == {}


def test_dc_create_rejects_malicious_tenant_id_without_querying(capture):
    with pytest.raises(HTTPException) as exc:
        dc.dc_create("acme'; --", "program", {"program_id": "PR1"})
    assert exc.value.status_code == 400
    assert capture == {}


def test_dc_update_rejects_malicious_entity_id_without_querying(capture):
    with pytest.raises(HTTPException) as exc:
        dc.dc_update("acme", "program", "x' OR '1'='1", {"program_id": "PR1"})
    assert exc.value.status_code == 400
    assert capture == {}


# ── FakeDataCore self-tests ───────────────────────────────────────────────

def test_fake_create_assigns_id_field_and_is_queryable():
    fdc = FakeDataCore()
    created = fdc.dc_create("acme", "payment", {"amount": 100})
    assert created["base_data"]["payment_id"].startswith("TT-PA26")
    rows = fdc.list_entities("acme", "payment", f"entity_id = '{created['entity_id']}'")
    assert rows and rows[0]["amount"] == 100


def test_fake_where_parsing_and_tenant_scoping():
    fdc = FakeDataCore()
    fdc.dc_create("acme", "program", {"program_id": "PR1"})
    fdc.dc_create("globex", "program", {"program_id": "PR1"})
    assert len(fdc.list_entities("acme", "program", "program_id = 'PR1'")) == 1
    assert fdc.list_entities("acme", "program", "program_id = 'NOPE'") == []
    with pytest.raises(AssertionError):
        fdc.list_entities("acme", "program", "program_id LIKE 'x'")


def test_fake_update_replaces_base_data():
    fdc = FakeDataCore()
    created = fdc.dc_create("acme", "program", {"program_id": "PR1", "name": "Fall"})
    fdc.dc_update("acme", "program", created["entity_id"], {"program_id": "PR1", "capacity": 5})
    row = fdc.get_entity("acme", "program", created["entity_id"])
    assert row["capacity"] == 5
    assert "name" not in row


def test_install_fake_datacore_blocks_raw_dc_query(monkeypatch):
    """Proves the guard fires through the real installation path used by every
    later test file — not just against a bare FakeDataCore() instance.
    """
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    with pytest.raises(AssertionError):
        dc.dc_query("acme", "SELECT * FROM data")
