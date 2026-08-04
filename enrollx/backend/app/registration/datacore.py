"""Structured DataCore client for the registration engine.

DataCore's entity/query routes are unauthenticated by design (private-network
trust — see this plan's Global Constraints). `token` is forwarded when a staff
JWT is present, and omitted on the parent/internal channel.

Sync httpx (like admindash leads.py) so tests can monkeypatch httpx.request.
Engine code must reach DataCore ONLY through this module, and must use
list_entities/get_entity (not raw dc_query) for entity reads.

dc_create / dc_update / dc_query are BINDING names consumed by Plans 3 and 5.
"""
import httpx
from fastapi import HTTPException, status

from app.config import settings


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
    resp = _request("POST", f"/api/entities/{tenant_id}/{entity_type}", token,
                    {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore create failed: {resp.text}")
    return resp.json()


def dc_update(tenant_id: str, entity_type: str, entity_id: str, base_data: dict,
              token: str | None = None) -> dict:
    resp = _request("PUT", f"/api/entities/{tenant_id}/{entity_type}/{entity_id}", token,
                    {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore update failed: {resp.text}")
    return resp.json()


def dc_query(tenant_id: str, sql: str, token: str | None = None, table: str = "entities") -> list[dict]:
    resp = _request("POST", "/api/query", token,
                    {"tenant_id": tenant_id, "table": table, "sql": sql})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore query failed: {resp.text}")
    return resp.json().get("data", [])


def next_id(tenant_id: str, entity_type: str, token: str | None = None) -> str:
    resp = _request("GET", f"/api/entities/{tenant_id}/{entity_type}/next-id", token)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore next-id failed: {resp.text}")
    return resp.json()["next_id"]


def list_entities(tenant_id: str, entity_type: str, where: str = "",
                  token: str | None = None) -> list[dict]:
    sql = f"SELECT * FROM data WHERE entity_type = '{entity_type}' AND _status = 'active'"
    if where:
        sql += f" AND {where}"
    return dc_query(tenant_id, sql, token)


def get_entity(tenant_id: str, entity_type: str, entity_id: str,
               token: str | None = None) -> dict | None:
    rows = list_entities(tenant_id, entity_type, f"entity_id = '{entity_id}'", token)
    return rows[0] if rows else None
