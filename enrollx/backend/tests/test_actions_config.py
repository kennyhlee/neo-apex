"""publish_config: block validation, version bump, prior-version archival."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.registration import engine
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


def test_publish_with_business_config_id_404s(client, fake_dc):
    """CONTRACT PIN (final review A1). The {application_id} path segment for
    publish_config carries the registration_config's DataCore **entity_id**,
    never its business `config_id` field. The two are independently generated
    and never match: DataCore mints entity_id server-side
    (`uuid.uuid4().hex[:12]`), while `config_id` comes from the next-id
    sequence. `_publish_config` resolves via `dc.get_entity(...)`, which
    filters on entity_id — so a caller handing over the business config_id
    gets a 404 and NO config ever reaches status='published'.

    The enrollx Flow Builder shipped exactly that bug; this test exists so
    the contract fails loudly here rather than silently in a second host.
    """
    cfg = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "ACME-RC260001", "program_id": "PR1", "version": 1,
        "status": "draft", "blocks": json.dumps(BLOCKS)})
    assert cfg["entity_id"] != cfg["base_data"]["config_id"]

    # The business id resolves nothing.
    assert publish(client, "ACME-RC260001").status_code == 404
    assert fake_dc.get_entity(
        "acme", "registration_config", cfg["entity_id"])["status"] == "draft"

    # The entity_id is the value that works.
    assert publish(client, cfg["entity_id"]).status_code == 200
    assert fake_dc.get_entity(
        "acme", "registration_config", cfg["entity_id"])["status"] == "published"


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


# ── I3: version numbering must scan ALL configs, not published-only ───────

def test_new_config_does_not_collide_when_nothing_is_published(client, fake_dc):
    """I3 failure 1. Scanning only `status = 'published'` returned max_version
    0 whenever no config was currently published, so the next publish handed
    out version 1 again — colliding with the archived original, which
    get_config_for_application still resolves pins against.
    """
    archived = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-old", "program_id": "PR1", "version": 1,
        "status": "archived", "blocks": json.dumps(BLOCKS)})
    new = draft_config(fake_dc)
    assert publish(client, new["entity_id"]).status_code == 200

    new_version = int(fake_dc.get_entity("acme", "registration_config",
                                         new["entity_id"])["version"])
    archived_version = int(fake_dc.get_entity("acme", "registration_config",
                                              archived["entity_id"])["version"])
    assert new_version == 2
    assert new_version != archived_version


def test_republishing_archived_config_preserves_its_version(client, fake_dc):
    """I3 failure 2. The guard only rejects an already-`published` config, so
    an archived one can be re-published. Giving it a NEW version would
    silently re-point every application pinned to its old config_version at a
    different config. Re-publish is a rollback: the version is preserved.
    """
    v1 = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-v1", "program_id": "PR1", "version": 1,
        "status": "archived", "blocks": json.dumps(BLOCKS)})
    v2 = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-v2", "program_id": "PR1", "version": 2,
        "status": "published", "blocks": json.dumps(BLOCKS)})

    assert publish(client, v1["entity_id"]).status_code == 200

    v1_row = fake_dc.get_entity("acme", "registration_config", v1["entity_id"])
    v2_row = fake_dc.get_entity("acme", "registration_config", v2["entity_id"])
    assert v1_row["status"] == "published" and int(v1_row["version"]) == 1
    # The previously-published config was archived, keeping exactly one
    # published config per program.
    assert v2_row["status"] == "archived" and int(v2_row["version"]) == 2

    # An application pinned to version 2 still resolves to the SAME config it
    # was created under, not the newly re-published one.
    resolved = engine.get_config_for_application(
        "acme", {"program_id": "PR1", "config_version": 2})
    assert resolved["entity_id"] == v2["entity_id"]


def test_republish_then_new_draft_gets_a_fresh_version(client, fake_dc):
    """Preserving a version on rollback must not make the next real publish
    reuse a number."""
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-v1", "program_id": "PR1", "version": 1,
        "status": "archived", "blocks": json.dumps(BLOCKS)})
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-v2", "program_id": "PR1", "version": 2,
        "status": "archived", "blocks": json.dumps(BLOCKS)})
    fresh = draft_config(fake_dc)
    assert publish(client, fresh["entity_id"]).status_code == 200
    assert int(fake_dc.get_entity("acme", "registration_config",
                                  fresh["entity_id"])["version"]) == 3


def test_version_scan_is_scoped_per_program(client, fake_dc):
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "other", "program_id": "PR2", "version": 9,
        "status": "published", "blocks": json.dumps(BLOCKS)})
    cfg = draft_config(fake_dc, program_id="PR1")
    assert publish(client, cfg["entity_id"]).status_code == 200
    assert int(fake_dc.get_entity("acme", "registration_config",
                                  cfg["entity_id"])["version"]) == 1
