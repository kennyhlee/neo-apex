"""Read/prepare/write the tenant entity row (holds stripe_account_id).

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
that need to check a tenant's stripe_account_id (Task 6's webhook, the
Connect status route) read the already-fetched row's field in Python
instead of querying by it.

WRITES: use update_tenant_entity — it is the ONE sanctioned way to write a
tenant entity from this service. See its docstring for why hand-rolling
`entity_base_data(row)` + `dc_update` corrupts the tenant.
"""
import re

from app.registration.datacore import dc_update, get_entity

# Flattened-row columns that are NOT base_data (mirrors admindash leads.py's
# _SYSTEM_COLS / _lead_base_data in app/api/leads.py).
_SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector"}

# DataCore's own meta columns on a flattened entity row — the complete set,
# from ENTITIES_SCHEMA in datacore/src/datacore/store.py:41-45. These five
# are the ONLY underscore-prefixed columns that are not base_data.
_META_COLS = {"_version", "_status", "_change_id", "_created_at", "_updated_at"}

# A TOON top-level key line: zero indentation, then either a quoted key or a
# bare token, then optional [..] / {..} shape markers, then ':'. Nested
# values, tabular rows and multi-line content are all indented, and strings
# containing a newline are quoted+escaped onto one line, so a line starting
# in column 0 is always a top-level key. See datacore's toon encoding.
_TOON_TOP_KEY = re.compile(
    r'^(?:"((?:[^"\\]|\\.)*)"|([^:\[\{\s]+))\s*(?:\[[^\]]*\])?(?:\{[^\}]*\})?\s*:'
)


def entity_base_data(row: dict) -> dict:
    """Flattened entity row -> base_data dict for a full-replace PUT.

    NOTE: drops EVERY underscore-prefixed key, which is wrong for the tenant
    entity (`_abbrev` is base_data, not a meta column). Existing callers rely
    on this contract; the tenant write path uses update_tenant_entity below.
    """
    return {
        k: v
        for k, v in row.items()
        if k not in _SYSTEM_COLS and not k.startswith("_") and v is not None
    }


def _custom_field_keys(row: dict) -> set[str]:
    """Which of a flattened row's columns came from custom_fields, not base_data.

    DataCore's query path flattens custom_fields into their own columns
    (query.py::_flatten_custom_fields) and leaves the encoded `custom_fields`
    column in place alongside them, so the flattened row alone cannot tell a
    custom field from a base_data field — but the encoded column's top-level
    keys can. That distinction is load-bearing on a write: put_entity raises
    ValueError (-> DataCore 400) when base_data and custom_fields share a key,
    and a custom field swept into base_data is silently migrated out of the
    tenant's custom-field set for good.

    Conservative by construction: a key is only claimed if it is also an
    actual column on the row, so a TOON shape this regex does not recognize
    degrades to the previous behavior rather than dropping a real field.
    """
    encoded = row.get("custom_fields")
    if not isinstance(encoded, str) or not encoded.strip():
        return set()
    keys = set()
    for line in encoded.splitlines():
        if not line or line[0].isspace():
            continue  # nested value, tabular row, or list continuation
        m = _TOON_TOP_KEY.match(line)
        if not m:
            continue
        quoted, bare = m.group(1), m.group(2)
        key = re.sub(r"\\(.)", r"\1", quoted) if quoted is not None else bare
        if key in row:
            keys.add(key)
    return keys


def tenant_write_payload(row: dict) -> tuple[dict, dict]:
    """Flattened tenant row -> (base_data, custom_fields) for a full-replace PUT.

    Differs from entity_base_data in two ways that both matter only for the
    tenant entity:

    1. Underscore-prefixed base_data keys are PRESERVED; only DataCore's five
       real meta columns are dropped. `_abbrev` looks like a meta column but
       is base_data (datacore/src/datacore/api/routes.py:72-79) — it is locked
       at tenant creation and never re-derived, and it is the prefix of every
       auto-generated entity id in the platform (routes.py:97, routes.py:325
       fall back to `tenant_id[:3].upper()` when it is missing). Dropping it
       silently re-prefixes every student, lead, application and document
       created afterwards, in every service. DataCore's dedicated
       PUT /api/tenants/{id} re-injects it for exactly this reason; the
       generic entities route this module writes through does not.
    2. custom_fields are kept in custom_fields instead of being swept into
       base_data — see _custom_field_keys.
    """
    custom_keys = _custom_field_keys(row)
    base = {
        k: v
        for k, v in row.items()
        if k not in _SYSTEM_COLS and k not in _META_COLS and k not in custom_keys
        and v is not None
    }
    custom = {k: row[k] for k in custom_keys if row.get(k) is not None}
    return base, custom


def get_tenant_entity(tenant_id: str, token: str | None) -> dict | None:
    """Fetch the tenant entity row, keyed by entity_id == tenant_id."""
    return get_entity(tenant_id, "tenant", tenant_id, token)


def update_tenant_entity(
    tenant_id: str, row: dict, changes: dict, token: str | None = None
) -> dict:
    """Apply `changes` to a fetched tenant row and write it back.

    The one sanctioned tenant write: DataCore's generic entities PUT is a
    full replace, so the whole row has to be round-tripped, and doing that by
    hand loses `_abbrev` and the tenant's custom fields (see
    tenant_write_payload). `changes` wins over both, and any custom field a
    change would collide with is folded into base_data rather than left to
    trip DataCore's overlap check.
    """
    base, custom = tenant_write_payload(row)
    base.update(changes)
    custom = {k: v for k, v in custom.items() if k not in changes}
    return dc_update(tenant_id, "tenant", tenant_id, base, token, custom_fields=custom)
