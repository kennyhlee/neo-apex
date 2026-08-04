"""Structured DataCore client for the registration engine.

DataCore's entity/query routes are unauthenticated by design (private-network
trust — see this plan's Global Constraints). `token` is forwarded when a staff
JWT is present, and omitted on the parent/internal channel.

Sync httpx (like admindash leads.py) so tests can monkeypatch httpx.request.
Engine code must reach DataCore ONLY through this module, and must use
list_entities/get_entity (not raw dc_query) for entity reads.

dc_create / dc_update / dc_query are BINDING names consumed by Plans 3 and 5.

Injection hygiene: `tenant_id`, `entity_type`, and `entity_id` are always
id-shaped values (see `_ID_RE`) — they are validated with a strict
allow-list regex (mirroring admindash leads.py's `public_intake` check)
before being placed in a URL path or a SQL string, and any value this module
itself interpolates into SQL is additionally escaped with `sql_literal`
(mirroring admindash `chat/datacore.py`'s helper of the same name) as
defense in depth. The free-form `where` parameter accepted by
`list_entities`/`get_entity` is NOT validated or escaped by this module —
see the trust-boundary note on those functions.
"""
import re

import httpx
from fastapi import HTTPException, status

from app.config import settings

# Allow-list for tenant_id / entity_type / entity_id — same shape admindash's
# leads.py enforces on tenant_id (`re.fullmatch(r"[A-Za-z0-9_-]+", ...)`).
_ID_RE = re.compile(r"[A-Za-z0-9_-]+")


def _validate_id(value: str, label: str) -> str:
    """Reject any id-shaped value that doesn't match the strict allow-list.

    Raises HTTPException(400) rather than silently coercing or stripping —
    a rejected request is safe; a silently-modified one is not.
    """
    if not value or not _ID_RE.fullmatch(value):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid {label}: {value!r}")
    return value


def sql_literal(value: str) -> str:
    """Return a safe single-quoted SQL string literal (single-quote doubling).

    Same approach as admindash `app/chat/datacore.py::sql_literal`. Used as
    defense in depth for values this module places in SQL — in practice
    `_validate_id` already rejects anything a quote could hide in, since
    `_ID_RE` excludes quotes entirely.
    """
    return "'" + str(value).replace("'", "''") + "'"


def _request(method: str, path: str, token: str | None = None, json_body: dict | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    try:
        return httpx.request(
            method,
            f"{settings.datacore_url}{path}",
            json=json_body,
            headers=headers,
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "DataCore is unreachable")


def dc_create(tenant_id: str, entity_type: str, base_data: dict, token: str | None = None) -> dict:
    _validate_id(tenant_id, "tenant_id")
    _validate_id(entity_type, "entity_type")
    resp = _request("POST", f"/api/entities/{tenant_id}/{entity_type}", token,
                    {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore create failed: {resp.text}")
    return resp.json()


def dc_update(tenant_id: str, entity_type: str, entity_id: str, base_data: dict,
              token: str | None = None, custom_fields: dict | None = None) -> dict:
    """Full-replace PUT of one entity.

    `custom_fields` defaults to `{}` because the registration engine's own
    entities have none — but this route REPLACES the stored custom_fields,
    so any caller round-tripping an entity that may carry them (the tenant
    entity; see app/tenant_lookup.py) must pass them back explicitly or they
    are erased.
    """
    _validate_id(tenant_id, "tenant_id")
    _validate_id(entity_type, "entity_type")
    _validate_id(entity_id, "entity_id")
    resp = _request("PUT", f"/api/entities/{tenant_id}/{entity_type}/{entity_id}", token,
                    {"base_data": base_data, "custom_fields": custom_fields or {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore update failed: {resp.text}")
    return resp.json()


def dc_query(tenant_id: str, sql: str, token: str | None = None, table: str = "entities") -> list[dict]:
    """Raw query passthrough — the sanctioned escape hatch for callers that
    need custom SQL beyond list_entities/get_entity's entity_type-scoped reads.

    Trust boundary: `sql` is NOT validated or escaped here. Callers must build
    it from server-constructed predicates only, and must escape any
    caller-derived value themselves (see `sql_literal`) before interpolating
    it. `tenant_id` IS validated, since it is always id-shaped and always
    under this module's control to check.
    """
    _validate_id(tenant_id, "tenant_id")
    resp = _request("POST", "/api/query", token,
                    {"tenant_id": tenant_id, "table": table, "sql": sql})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore query failed: {resp.text}")
    return resp.json().get("data", [])


def next_id(tenant_id: str, entity_type: str, token: str | None = None) -> str:
    _validate_id(tenant_id, "tenant_id")
    _validate_id(entity_type, "entity_type")
    resp = _request("GET", f"/api/entities/{tenant_id}/{entity_type}/next-id", token)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore next-id failed: {resp.text}")
    return resp.json()["next_id"]


def list_entities(tenant_id: str, entity_type: str, where: str = "",
                  token: str | None = None) -> list[dict]:
    """List active entities of `entity_type`, always scoped by that type.

    `tenant_id` and `entity_type` are validated (`_validate_id`) and, since
    `entity_type` is interpolated into SQL here, additionally escaped with
    `sql_literal` as defense in depth.

    Trust boundary: `where`, if supplied, is a raw SQL fragment appended
    verbatim after `AND`. This module does NOT validate or escape it — the
    caller must build it only from server-constructed predicates (e.g.
    literal field names and pre-validated ids) and must escape any
    caller-derived value itself via `sql_literal` before interpolating it
    into `where`. Never build `where` from unsanitized user input.
    """
    _validate_id(tenant_id, "tenant_id")
    _validate_id(entity_type, "entity_type")
    sql = f"SELECT * FROM data WHERE entity_type = {sql_literal(entity_type)} AND _status = 'active'"
    if where:
        sql += f" AND {where}"
    return dc_query(tenant_id, sql, token)


def get_entity(tenant_id: str, entity_type: str, entity_id: str,
               token: str | None = None) -> dict | None:
    """Fetch a single active entity by id, scoped by `entity_type`.

    `entity_id` is validated (`_validate_id`) and escaped with `sql_literal`
    before being placed in the `where` clause passed to `list_entities` — a
    crafted `entity_id` cannot widen the query or escape the entity_type
    scope. See `list_entities`'s trust-boundary note for the `where`
    parameter in general.
    """
    _validate_id(tenant_id, "tenant_id")
    _validate_id(entity_type, "entity_type")
    _validate_id(entity_id, "entity_id")
    rows = list_entities(tenant_id, entity_type, f"entity_id = {sql_literal(entity_id)}", token)
    return rows[0] if rows else None
