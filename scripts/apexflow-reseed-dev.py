#!/usr/bin/env python3
"""Wipe dev-tenant registration/workflow rows and reseed apexflow's models +
enrollment template.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§10 "Teardown and migration (dev only — nothing deployed)". Same precedent
as scripts/reset_registration_dev_data.py: DEV ONLY, destructive, archives
(never deletes — DataCore's archive endpoint flips `_status` to 'archived',
recoverable), and generalizes that script's base-fields-win /
custom-fields-preserved model merge to EVERY entity type in
launchpad/backend/app/data/base_model.json (not just the two registration
ones) — that file already carries the §8-enriched student/family/contact/
registration_application fields and the new workflow_* entity types, so one
PUT per tenant brings both up to date without a second, apexflow-specific
model file to maintain.

Three phases, per tenant:
  1. wipe   — archive every active row of the registration-era types the
              apexflow entities replace, plus apexflow's own workflow_*
              types (a prior reseed's leftovers).
  2. models — PUT base_model.json's base fields for every entity type,
              preserving whatever custom fields the tenant already has
              (the SAME merge rule Papermite's finalize path applies —
              interface map §9 — so a tenant whose model-setup already
              extracted admission-packet fields, e.g. acme-afterschool,
              keeps them as custom fields; re-running Papermite's finalize
              afterwards is safe but no longer necessary, exactly as
              reset_registration_dev_data.py's docstring notes for its
              narrower scope).
  3. template — seed_enrollment_template(tenant), which publishes through
              the real validate_definition gate (app.workflows.definitions.
              publish_definition) — never re-implemented here.

Dev tenants default to every `{tenant}_entities.lance` table found under
datacore/data/lancedb (task-9-brief.md: "targets the dev tenants found in
datacore/data/lancedb — enumerate *_entities tables"); pass tenant names
explicitly to narrow the run.

Usage (run from the apexflow-backend uv environment so `app.templates.
enrollment` / `app.workflows.*` are importable — a running DataCore server,
default http://localhost:5800 per services.json, is required for anything
but --dry-run):

    cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py
    cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py acme acme-afterschool
    cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py --dry-run
    cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py --models-only

NOT run against the real dev LanceDB by Task 9 (task-9-brief.md's own Step 3
note: "do NOT run the reseed script against the real dev LanceDB in this
task ... the coordinator runs it in Task 13's gate"). This file's pure
helpers (`discover_dev_tenants`, `merge_model_definition`) are unit-tested
in apexflow/backend/tests/test_reseed_script.py; the archive/PUT/seed I/O
below is exercised only by that later live run.
"""
import argparse
import json
import sys
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
LANCEDB_DIR = REPO_ROOT / "datacore" / "data" / "lancedb"
BASE_MODEL_PATH = REPO_ROOT / "launchpad" / "backend" / "app" / "data" / "base_model.json"
APEXFLOW_BACKEND = REPO_ROOT / "apexflow" / "backend"

# So `from app.templates.enrollment import seed_enrollment_template` resolves
# regardless of the script's invocation cwd -- harmless to insert even when
# apexflow-backend's own deps (fastapi/httpx/pydantic) aren't on the running
# interpreter's path, since that import is deferred (see seed_template()).
sys.path.insert(0, str(APEXFLOW_BACKEND))

# Entity types this reseed wipes (spec §10): registration-era rows the
# apexflow entities replace, plus apexflow's own workflow rows (so re-running
# this script is idempotent against a PRIOR reseed's template/instances, not
# just the registration era it migrated from). `document` and `payment` rows
# are wiped wholesale, same precedent as reset_registration_dev_data.py
# ("document and payment rows are registration-scoped in this codebase ...
# these are all test rows").
WIPE_ENTITY_TYPES = [
    "registration_config",
    "registration_application",
    "application_item",
    "application_activity",
    "payment",
    "document",
    "workflow_definition",
    "workflow_instance",
    "workflow_item",
    "workflow_activity",
]


def load_datacore_base_url() -> str:
    """DataCore's API base URL, from the repo's single source of truth
    (services.json) -- same helper shape as reset_registration_dev_data.py's
    load_port(), generalized to the full URL callers below need."""
    services = json.loads((REPO_ROOT / "services.json").read_text())["services"]
    return f"http://localhost:{int(services['datacore']['port'])}/api"


def discover_dev_tenants() -> list[str]:
    """Every dev tenant with an `{tenant}_entities.lance` table under
    datacore/data/lancedb -- pure filesystem scan, no DataCore call. Returns
    [] (not an error) when the directory doesn't exist (datacore never run
    locally yet); the caller decides what that means."""
    if not LANCEDB_DIR.exists():
        return []
    suffix = "_entities.lance"
    return sorted(
        p.name[: -len(suffix)] for p in LANCEDB_DIR.iterdir()
        if p.name.endswith(suffix)
    )


def merge_model_definition(base_fields: list[dict], existing: list[dict]) -> dict:
    """`base_fields` (always win) + whatever of `existing` isn't itself a
    base field, deduped by name, first-write-wins.

    The exact merge rule scripts/reset_registration_dev_data.py established
    for spec §4 rule 1 (Papermite finalize's "merge, never replace"),
    generalized here to every entity type in base_model.json rather than
    just the two registration ones. Pure function: no I/O, does not mutate
    either input.
    """
    base_names = {f["name"] for f in base_fields}
    custom: list[dict] = []
    seen: set[str] = set()
    for f in existing:
        name = f.get("name")
        if not name or name in base_names or name in seen:
            continue
        custom.append(f)
        seen.add(name)
    return {"base_fields": base_fields, "custom_fields": custom}


# --- I/O: DataCore HTTP (not exercised by this task's own test run) --------


def active_entity_ids(base_url: str, tenant: str, entity_type: str) -> list[str]:
    resp = httpx.post(f"{base_url}/query", json={
        "tenant_id": tenant, "table": "entities",
        "sql": f"SELECT entity_id FROM data WHERE entity_type = '{entity_type}' "
               f"AND _status = 'active'",
    }, timeout=30.0)
    if resp.status_code != 200:
        # A tenant that has never written this type has no table/column for
        # it; that is "nothing to wipe", not an error (DuckDB binder error).
        return []
    return [r["entity_id"] for r in resp.json().get("data", []) if r.get("entity_id")]


def existing_fields(base_url: str, tenant: str, entity_type: str) -> list[dict]:
    """The tenant's current fields for one entity type, base AND custom, in
    that order -- both buckets matter (see reset_registration_dev_data.py's
    docstring: model setup can leave document-extracted fields sitting in
    `base_fields`, not just `custom_fields`)."""
    resp = httpx.post(f"{base_url}/query", json={
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
    return ([f for f in raw.get("base_fields") or [] if isinstance(f, dict)]
            + [f for f in raw.get("custom_fields") or [] if isinstance(f, dict)])


def wipe_tenant(base_url: str, tenant: str, *, dry_run: bool) -> dict[str, int]:
    wiped: dict[str, int] = {}
    for entity_type in WIPE_ENTITY_TYPES:
        ids = active_entity_ids(base_url, tenant, entity_type)
        wiped[entity_type] = len(ids)
        if not ids or dry_run:
            continue
        resp = httpx.post(f"{base_url}/entities/{tenant}/{entity_type}/archive",
                          json={"entity_ids": ids}, timeout=60.0)
        resp.raise_for_status()
    return wiped


def reseed_models(base_url: str, tenant: str, base_model: dict) -> dict:
    return {
        entity_type: merge_model_definition(
            defn["base_fields"], existing_fields(base_url, tenant, entity_type)
        )
        for entity_type, defn in base_model.items()
    }


def push_models(base_url: str, tenant: str, base_model: dict, *, dry_run: bool) -> dict:
    reseed = reseed_models(base_url, tenant, base_model)
    if dry_run:
        return reseed
    resp = httpx.put(f"{base_url}/models/{tenant}", json={
        "model_definition": reseed,
        "source_filename": "base_model.json",
        "created_by": "apexflow-reseed-dev.py",
    }, timeout=60.0)
    resp.raise_for_status()
    return reseed


def seed_template(tenant: str, *, dry_run: bool) -> str | None:
    """Seed + publish the enrollment template via the SAME publish_definition
    service function the definitions API uses -- validate_definition runs
    for real here, never re-implemented in this script (task-9-brief.md
    Step 2/3's structural requirement). Deferred import: apexflow-backend's
    own deps only need to be importable when this actually runs."""
    if dry_run:
        return None
    from app.templates.enrollment import seed_enrollment_template
    published = seed_enrollment_template(tenant)
    return published.get("entity_id")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tenants", nargs="*", default=None,
                        help="Dev tenants to reseed (default: every "
                             "*_entities.lance table under datacore/data/lancedb)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would happen; write nothing")
    parser.add_argument("--models-only", action="store_true",
                        help="Reseed models + the template without wiping any "
                             "rows -- use this to repair a model/template "
                             "without destroying in-progress flow data")
    args = parser.parse_args()

    tenants = args.tenants or discover_dev_tenants()
    if not tenants:
        print("No dev tenants found (datacore/data/lancedb is empty or missing); "
              "pass tenant names explicitly.")
        return 1

    base_url = load_datacore_base_url()
    base_model = json.loads(BASE_MODEL_PATH.read_text())

    for tenant in tenants:
        print(f"\n== {tenant} ==")

        if not args.models_only:
            wiped = wipe_tenant(base_url, tenant, dry_run=args.dry_run)
            for entity_type, count in wiped.items():
                if count:
                    suffix = " (dry-run)" if args.dry_run else ""
                    print(f"  wiped {entity_type}: {count} row(s){suffix}")

        reseed = push_models(base_url, tenant, base_model, dry_run=args.dry_run)
        suffix = " (dry-run)" if args.dry_run else ""
        print(f"  models: pushed {len(reseed)} entity type(s){suffix}")

        if args.dry_run:
            print("  template: would seed + publish 'enrollment' (dry-run)")
        else:
            entity_id = seed_template(tenant, dry_run=args.dry_run)
            print(f"  template: published 'enrollment' ({entity_id})")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
