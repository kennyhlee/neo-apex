"""enrollx hydrates entity-model form fields before serving a config to
familyhub.

flow-runtime never fetches anything — the HOST supplies `config.fields`. The
enrollx frontend does that in TypeScript, but familyhub holds no DataCore
credential at all, so without this an entity-sourced form block renders ZERO
fields on the parent channel: the channel spec §4 is actually about.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore

KEY = {"X-Internal-Key": "dev-internal-key-change-in-prod"}

BLOCKS = [
    {"block_id": "s1", "type": "form", "title": "Student", "required": True,
     "blocking": True, "config": {"entity_type": "student"}},
    {"block_id": "a1", "type": "form", "title": "Agreement", "required": True,
     "blocking": True, "config": {"entity_type": "registration_application"}},
    {"block_id": "c1", "type": "form", "title": "Extra", "required": False,
     "blocking": False, "config": {"custom_fields": [
         {"name": "nickname", "type": "str", "required": False}]}},
    {"block_id": "r1", "type": "review", "title": "Review", "required": True,
     "blocking": False, "config": {}},
]


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    monkeypatch.setattr(settings, "internal_key", "dev-internal-key-change-in-prod")
    fdc.rows.append(FakeDataCore._store_row("acme", "tenant", "acme", {
        "name": "Acme Afterschool", "display_name": "Acme Afterschool"}))
    fdc.dc_create("acme", "registration_config", {
        "config_id": "cfg1", "version": 1, "status": "published",
        "blocks": json.dumps(BLOCKS)})
    fdc.set_model("acme", "student", {
        "base_fields": [{"name": "student_id", "type": "str", "required": True},
                        {"name": "first_name", "type": "str", "required": True},
                        {"name": "status", "type": "selection", "required": False}],
        "custom_fields": [{"name": "allergies", "type": "str", "required": False}]})
    fdc.set_model("acme", "registration_application", {
        "base_fields": [{"name": "application_id", "type": "str", "required": True},
                        {"name": "school_year", "type": "str", "required": True}],
        "custom_fields": [{"name": "agreement_signed_by", "type": "str", "required": True},
                          {"name": "initials", "type": "str", "required": False}]})
    return fdc


@pytest.fixture
def client(fake_dc):
    return TestClient(app)


def blocks_of(payload):
    return {b["block_id"]: b for b in json.loads(payload["config"]["blocks"])}


def test_student_block_gets_base_plus_custom_minus_the_id_field(client, fake_dc):
    body = client.get("/internal/registration/acme/config", headers=KEY).json()
    fields = [f["name"] for f in blocks_of(body)["s1"]["config"]["fields"]]
    # `status` is kept: the engine-owned exclusion applies ONLY to
    # registration_application. Dropping it here would delete a legitimate
    # student field staff rely on.
    assert fields == ["first_name", "status", "allergies"]


def test_application_block_gets_custom_fields_only(client, fake_dc):
    body = client.get("/internal/registration/acme/config", headers=KEY).json()
    fields = [f["name"] for f in blocks_of(body)["a1"]["config"]["fields"]]
    assert fields == ["agreement_signed_by", "initials"]


def test_builder_authored_block_is_left_alone(client, fake_dc):
    body = client.get("/internal/registration/acme/config", headers=KEY).json()
    assert "fields" not in blocks_of(body)["c1"]["config"]


def test_a_missing_model_degrades_to_no_fields_not_a_500(client, fake_dc):
    fake_dc.models.clear()
    resp = client.get("/internal/registration/acme/config", headers=KEY)
    assert resp.status_code == 200
    assert blocks_of(resp.json())["s1"]["config"]["fields"] == []


def test_hydration_does_not_write_back_to_datacore(client, fake_dc):
    stored_before = fake_dc.find("registration_config")[0]["blocks"]
    client.get("/internal/registration/acme/config", headers=KEY)
    assert fake_dc.find("registration_config")[0]["blocks"] == stored_before


def test_token_bundle_is_hydrated_too(client, fake_dc):
    started = client.post("/internal/registration/acme/start", headers=KEY, json={
        "school_year": "2026-2027", "applicant_email": "p@example.com"}).json()
    body = client.get(f"/internal/application-by-token/{started['token']}",
                      headers=KEY).json()
    fields = [f["name"] for f in blocks_of(body)["a1"]["config"]["fields"]]
    assert fields == ["agreement_signed_by", "initials"]
