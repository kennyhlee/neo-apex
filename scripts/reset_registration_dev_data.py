#!/usr/bin/env python3
"""Wipe a dev tenant's registration data and reseed its registration models.

DEV ONLY, and destructive. Nothing is deployed, so the whole-school revision
takes the simple path the spec authorizes (§6): archive every registration
row rather than migrating it, then re-put the registration model definitions
from base_model.json so the tenant's models match the new base fields.

Archive, not delete: DataCore's archive flips `_status` to 'archived', which
is exactly what every registration query filters on, and it leaves the rows
recoverable. There is no delete endpoint and this does not need one.

The model reseed PUTs ONLY the two registration entity types. DataCore stores
models one row per entity_type, so the tenant's other models are untouched.

The reseed applies the SAME merge rule Papermite's finalize now applies
(spec §4 rule 1): base_model's base fields win, and whatever custom fields
the tenant already had are carried over. That matters here, not just in
theory -- model setup had already replaced acme-afterschool's
`registration_application` model with the extraction shape, dropping every
engine-owned base field and leaving only `application_id, school_year,
school_id`. A naive reseed would restore the base fields but delete the
tenant's real admission-packet fields (`agreement_signed_by`, `initials`,
...), which is the exact data loss this revision exists to stop. Re-running
Papermite's finalize afterwards is now safe but no longer necessary.

Usage:
    python3 scripts/reset_registration_dev_data.py                # dev tenants
    python3 scripts/reset_registration_dev_data.py acme other-dev
    python3 scripts/reset_registration_dev_data.py --dry-run
"""
import argparse
import json
import sys
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parent.parent
BASE_MODEL = REPO / "launchpad" / "backend" / "app" / "data" / "base_model.json"
# Both dev tenants that carry registration data: `acme` holds the
# program-scoped rows Phase 1 created, `acme-afterschool` is the tenant whose
# real admission packet drove the model.
DEFAULT_TENANTS = ["acme", "acme-afterschool"]

# Every entity type the registration feature owns. `document` and `payment`
# rows are registration-scoped in this codebase (they carry application_id),
# so they go too -- these are all test rows.
REGISTRATION_TYPES = [
    "registration_config",
    "registration_application",
    "application_item",
    "application_activity",
    "document",
    "payment",
]

RESEED_TYPES = ["registration_config", "registration_application"]


def load_port() -> int:
    """DataCore's port, from the repo's single source of truth."""
    services = json.loads((REPO / "services.json").read_text())["services"]
    return int(services["datacore"]["port"])


def active_entity_ids(base: str, tenant: str, entity_type: str) -> list[str]:
    resp = httpx.post(f"{base}/query", json={
        "tenant_id": tenant, "table": "entities",
        "sql": f"SELECT entity_id FROM data WHERE entity_type = '{entity_type}' "
               f"AND _status = 'active'",
    }, timeout=30.0)
    if resp.status_code != 200:
        # A tenant that has never written this type has no table/column for
        # it; that is "nothing to wipe", not an error.
        return []
    return [r["entity_id"] for r in resp.json().get("data", []) if r.get("entity_id")]


def existing_custom_fields(base: str, tenant: str, entity_type: str) -> list[dict]:
    """The tenant's current custom fields for one entity type, or []."""
    resp = httpx.post(f"{base}/query", json={
        "tenant_id": tenant, "table": "models",
        "sql": f"SELECT model_definition FROM data WHERE _status = 'active' "
               f"AND entity_type = '{entity_type}'",
    }, timeout=30.0)
    if resp.status_code != 200:
        return []
    rows = resp.json().get("data", [])
    if not rows:
        return []
    raw = rows[0].get("model_definition")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, dict):
        return []
    return [f for f in raw.get("custom_fields") or [] if isinstance(f, dict)]


def reseed_definition(base: str, tenant: str, base_model: dict) -> dict:
    """base_model's base fields + the tenant's existing custom fields.

    The same merge rule Papermite's finalize applies (spec §4 rule 1), so a
    reseed restores the engine-owned base fields WITHOUT deleting whatever
    model setup extracted from the school's real admission packet.
    """
    out = {}
    for entity_type in RESEED_TYPES:
        base_fields = base_model[entity_type]["base_fields"]
        base_names = {f["name"] for f in base_fields}
        custom = [f for f in existing_custom_fields(base, tenant, entity_type)
                  if f.get("name") not in base_names]
        out[entity_type] = {"base_fields": base_fields, "custom_fields": custom}
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tenants", nargs="*", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    tenants = args.tenants or DEFAULT_TENANTS
    base = f"http://localhost:{load_port()}/api"
    base_model = json.loads(BASE_MODEL.read_text())

    for tenant in tenants:
        print(f"\n== {tenant} ==")
        for entity_type in REGISTRATION_TYPES:
            ids = active_entity_ids(base, tenant, entity_type)
            print(f"  {entity_type}: {len(ids)} active row(s)")
            if not ids or args.dry_run:
                continue
            resp = httpx.post(f"{base}/entities/{tenant}/{entity_type}/archive",
                              json={"entity_ids": ids}, timeout=60.0)
            resp.raise_for_status()
            print(f"    archived {resp.json().get('archived', 0)}")

        reseed = reseed_definition(base, tenant, base_model)
        for entity_type, defn in reseed.items():
            kept = [f["name"] for f in defn["custom_fields"]]
            print(f"  reseed {entity_type}: "
                  f"{len(defn['base_fields'])} base field(s), "
                  f"custom kept: {kept or 'none'}")
        if args.dry_run:
            continue
        resp = httpx.put(f"{base}/models/{tenant}", json={
            "model_definition": reseed,
            "source_filename": "base_model.json",
            "created_by": "reset_registration_dev_data.py",
        }, timeout=60.0)
        resp.raise_for_status()
        print(f"    {resp.json().get('status', 'ok')}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
