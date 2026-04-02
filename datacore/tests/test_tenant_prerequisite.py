"""Tests for tenant prerequisite enforcement."""

import pytest


def test_put_model_without_tenant_raises(store):
    """put_model raises ValueError when no tenant entity exists."""
    with pytest.raises(ValueError, match="Tenant not set up"):
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={"base_fields": [], "custom_fields": []},
        )


def test_put_entity_without_tenant_raises(store):
    """put_entity raises ValueError when no tenant entity exists."""
    with pytest.raises(ValueError, match="Tenant not set up"):
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S001",
            base_data={"first_name": "Alice", "last_name": "Smith"},
        )


def test_put_tenant_entity_skips_check(store):
    """put_entity with entity_type='tenant' does not require tenant to exist."""
    result = store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
    assert result["entity_type"] == "tenant"
    assert result["_version"] == 1


def test_put_model_after_tenant_setup_succeeds(store):
    """put_model succeeds when tenant entity exists."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
    result = store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [], "custom_fields": []},
    )
    assert result["_version"] == 1


def test_put_entity_after_tenant_setup_succeeds(store):
    """put_entity succeeds when tenant entity exists."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
    result = store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )
    assert result["_version"] == 1
