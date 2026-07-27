from dataclasses import dataclass, field

import httpx


@dataclass
class ChatDeps:
    tenant_id: str
    token: str
    datacore_url: str
    pending_proposals: list[dict] = field(default_factory=list)


def sql_literal(value: str) -> str:
    """Return a safe single-quoted SQL string literal."""
    return "'" + str(value).replace("'", "''") + "'"


async def dc_query(deps: ChatDeps, sql: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/query",
            json={"tenant_id": deps.tenant_id, "table": "entities", "sql": sql},
            headers={"Authorization": deps.token},
        )
    resp.raise_for_status()
    return resp.json().get("data", [])


async def dc_create(deps: ChatDeps, entity_type: str, base_data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/entities/{deps.tenant_id}/{entity_type}",
            json={"base_data": base_data, "custom_fields": {}},
            headers={"Authorization": deps.token},
        )
    resp.raise_for_status()
    return resp.json()


async def dc_duplicate_check(deps: ChatDeps, entity_type: str, fields: dict) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{deps.datacore_url}/api/entities/{deps.tenant_id}/{entity_type}/duplicate-check",
            json=fields,
            headers={"Authorization": deps.token},
        )
    if resp.status_code != 200:
        return []
    return resp.json().get("duplicates", [])
