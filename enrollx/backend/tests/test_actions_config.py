"""publish_config: block validation, version bump, prior-version archival."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import BLOCKS, FakeDataCore, install_fake_datacore


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


def publish(client, config_eid):
    # Path quirk (binding): the application_id segment carries the config entity_id.
    return client.post(f"/api/registration/acme/applications/{config_eid}/actions",
                       json={"action": "publish_config"})


def draft_config(fake_dc, blocks=BLOCKS, program_id="PR1", version=1):
    return fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-d", "program_id": program_id, "version": version,
        "status": "draft", "blocks": json.dumps(blocks)})


def test_publish_first_config(client, fake_dc):
    cfg = draft_config(fake_dc)
    resp = publish(client, cfg["entity_id"])
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_config", cfg["entity_id"])
    assert row["status"] == "published"
    # Read back through the query path, so `version` is the STRING "1" — see
    # the STRINGIFIED READS note in tests/fakes.py.
    assert int(row["version"]) == 1


def test_publish_archives_prior_and_bumps_version(client, fake_dc):
    old = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-old", "program_id": "PR1", "version": 3,
        "status": "published", "blocks": json.dumps(BLOCKS)})
    new = draft_config(fake_dc)
    assert publish(client, new["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "registration_config",
                              old["entity_id"])["status"] == "archived"
    assert int(fake_dc.get_entity("acme", "registration_config",
                                  new["entity_id"])["version"]) == 4


def test_publish_unknown_config_404(client, fake_dc):
    assert publish(client, "missing").status_code == 404


def test_publish_already_published_409(client, fake_dc):
    cfg = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "c", "program_id": "PR1", "version": 1,
        "status": "published", "blocks": json.dumps(BLOCKS)})
    assert publish(client, cfg["entity_id"]).status_code == 409


def test_publish_invalid_blocks_422(client, fake_dc):
    bad = draft_config(fake_dc, blocks=[{"block_id": "b1", "type": "mystery", "title": ""}])
    resp = publish(client, bad["entity_id"])
    assert resp.status_code == 422
    assert resp.json()["detail"]["details"]


def test_publish_unparseable_blocks_422(client, fake_dc):
    cfg = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "c", "program_id": "PR1", "version": 1,
        "status": "draft", "blocks": "not-json"})
    assert publish(client, cfg["entity_id"]).status_code == 422
