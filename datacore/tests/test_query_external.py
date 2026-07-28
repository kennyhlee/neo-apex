"""External (hardened) query mode blocks filesystem access."""
import pytest


def test_external_mode_still_returns_rows(seeded_engine):
    r = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE entity_type = 'student'",
        external=True,
    )
    assert r["total"] == 3


def test_external_mode_blocks_file_functions(seeded_engine):
    with pytest.raises(Exception):
        seeded_engine.query(
            tenant_id="t1", table_type="entities",
            sql="SELECT * FROM read_csv('/etc/hosts')",
            external=True,
        )
