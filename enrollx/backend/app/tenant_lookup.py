"""Read/prepare the tenant entity row (holds stripe_account_id).

Reads go through app.registration.datacore's get_entity, which always
scopes by entity_type — never call dc_query directly (app/registration/
datacore.py's module docstring; the test fake in tests/fakes.py raises
AssertionError on direct dc_query use, by design).

Not a sparse-field lookup: this is keyed on entity_id ("tenant"'s entity_id
== tenant_id, confirmed against Task 3/6's TENANT_ROW fixtures), which is a
system column present on every row from the moment the tenant entity
exists. That is unlike stripe_account_id, which is absent until a tenant's
first Connect completion — DataCore only materializes a flattened column
once some row in the tenant's table carries that key, so a SQL predicate
filtering ON stripe_account_id would binder-error for every tenant that
hasn't connected yet. get_entity/list_entities never do that here; callers
that need to check a tenant's stripe_account_id (Task 6's webhook) read the
already-fetched row's field in Python instead of querying by it.
"""
from app.registration.datacore import get_entity

# Flattened-row columns that are NOT base_data (mirrors admindash leads.py's
# _SYSTEM_COLS / _lead_base_data in app/api/leads.py).
_SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector"}


def entity_base_data(row: dict) -> dict:
    """Flattened entity row -> base_data dict for a full-replace PUT."""
    return {
        k: v
        for k, v in row.items()
        if k not in _SYSTEM_COLS and not k.startswith("_") and v is not None
    }


def get_tenant_entity(tenant_id: str, token: str | None) -> dict | None:
    """Fetch the tenant entity row, keyed by entity_id == tenant_id."""
    return get_entity(tenant_id, "tenant", tenant_id, token)
