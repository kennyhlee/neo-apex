## Context

Tenant entity models are seeded by LaunchPad from `launchpad/backend/app/data/base_model.json` and later extended by Papermite extraction (custom fields). The file has evolved (2026-08-05 added workflow-era fields to `student`/`family`/`contact`/`registration_application`), but a tenant seeded before that keeps its original field set forever: `POST /tenants/{id}/model/sync-defaults` only adds entity types that are missing outright.

apexflow's shipped templates (`app/templates/enrollment.py`, `signup.py`) pick fields that exist in the current base model. Applying one against a lagging tenant produces a draft that fails publish with `field 'X' does not exist on model '...'`. The templates route already derives `missing_models` for the gallery; nothing derives missing fields.

Three facts shape the design:

- **Each backend is built from its own directory.** `launchpad/Dockerfile` and `apexflow/Dockerfile` copy only `pyproject.toml`, `uv.lock` and `backend/app`. A top-level shared Python module is not in either image.
- **A tested merge rule already exists** in `scripts/apexflow-reseed-dev.py::merge_model_definition` (base fields win, custom fields preserved first-write-wins, carried-forward required-no-default fields demoted to optional), unit-tested in `apexflow/backend/tests/test_reseed_script.py`. Papermite's finalize has its own variant with a different signature; it is not touched.
- **apexflow already owns model-coherence evaluation**: `definition_health(machine, steps, models)` and the `list_definitions` route's batched "parse all rows, fetch the union of models once" pattern. The engine refuses new instances for a `stale`/`broken` published definition; in-flight instances are unaffected.

## Goals / Non-Goals

**Goals:**
- A lagging tenant can be brought up to the current base fields with one sync, without losing Papermite custom fields.
- The sync says exactly what it changed, and refuses to silently stall live workflows.
- The admin sees, before applying a template, which fields the tenant's model lacks, and can choose to sync or to apply without them.
- Compatibility is derived from the template's own section picks against the tenant's current model. No declared schema version anywhere.

**Non-Goals:**
- Changing template sources or the validator's coverage rules.
- Auto-syncing models on template apply, or any write from apexflow to the models table.
- Touching Papermite's finalize merge.
- Deriving compatibility for machine-level references (guard/effect sources). Section picks are the contract this change covers; see Risks.
- Unblocking the production tenant. That is a manual run of the new sync after release.

## Decisions

### D1. The merge rule moves to LaunchPad: `launchpad/backend/app/model_merge.py`

LaunchPad owns `base_model.json`, so it owns the rule for folding base fields into a tenant model. The function moves verbatim (same name, signature, docstring) along with its seven unit tests, which move to `launchpad/backend/tests/test_model_merge.py`. The dev reseed script loads it by file path with `importlib.util.spec_from_file_location` (it already reads `base_model.json` by path from the LaunchPad tree), so it has no `app`-package collision with apexflow's own `app`.

*Alternatives:* a top-level shared package (not in either Docker image; would need Dockerfile and build-context changes in two services for one 30-line function); keep two copies with a parity test (two copies is the thing the parity test would exist to apologize for).

### D2. Sync is field-level, writes only what changed, and reports per entity type

For each entity type in `base_model.json`:
- absent from the tenant: written as today, reported under `added_entities`;
- present: `merge_model_definition(base_fields, existing_base + existing_custom)`; written only if the merged definition differs from the stored one (normalized the way DataCore's PUT compares), reported under `changed[entity_type] = {added_fields: [...], demoted_fields: [...]}`.

Entity types the tenant has but the base model does not are left alone. One PUT carries every changed type (DataCore's PUT is a per-type upsert under one `change_id`, which is also what makes the write atomic from the tenant's point of view).

Response shape replaces `{"added": [...]}` — LaunchPad's own settings page is the only consumer and is updated in the same change:

```json
{
  "added_entities": ["lead"],
  "changed": {
    "registration_application": {
      "added_fields": ["handbook_acknowledged", "..."],
      "demoted_fields": ["config_version"]
    }
  },
  "workflows_at_risk": []
}
```

### D3. The published-workflow guard runs in apexflow, behind one new read-only endpoint

`POST /api/workflows/{tenant_id}/model-preflight` with body `{"models": {entity_type: definition}}` returns, for every **published** definition row of the tenant:

```json
{"definitions": [{"definition_id": "enrollment", "name": "Enrollment", "version": 2,
                  "health_before": "current", "health_after": "stale"}]}
```

`health_before` uses the tenant's stored models; `health_after` uses the stored models overlaid with the request body. Same batched pattern as `list_definitions` (parse all rows, fetch the union of referenced models once). Rows that fail to parse report `"broken"` for both, as the list route does. Staff-or-admin, tenant-matched auth, same as every other designer route.

LaunchPad calls it with the merged definitions for every changed type and forwards the caller's own `Authorization` header (the sync route takes it as a `Header` parameter, since `get_current_user` does not retain the raw token). Any definition whose `health_after` is worse than `health_before` goes into `workflows_at_risk`. If that list is non-empty and the request body does not carry `force: true`, the sync returns **409** with the full report and writes nothing.

*Alternatives:* importing the validator into LaunchPad (apexflow's `app` package is not in LaunchPad's image, and duplicating the validator is far worse than duplicating the merge rule); skipping the guard (the user asked for it, and the engine's 409 on new instances is exactly the failure a sync must not cause silently).

### D4. If apexflow cannot answer, the guard cannot be evaluated, and the sync refuses

A non-200 or connection failure from the preflight call returns **502** from the sync unless `force: true`. Writing blind would defeat the guard's purpose. `force` is the explicit way to proceed anyway, and the settings page offers it only after showing the failure.

### D5. `missing_fields` is derived on the templates route, per entity model, from section picks

Beside `missing_models`, each catalog entry gains:

```json
"missing_fields": {"registration_application": ["handbook_acknowledged", "liability_waiver_signed", "..."]}
```

Computed by walking the template's form-step sections and comparing each pick name to the tenant's model (base + custom field names). Only models the tenant **has** appear here; a model that is missing entirely is already in `missing_models` and would otherwise list every pick. Keys and lists are sorted. The key is always present (possibly `{}`), matching how the frontend treats `missing_models`.

### D6. Applying with missing fields is an explicit choice made in the apply dialog, stripped client-side

The gallery card shows the "Needs setup" badge when either list is non-empty, with copy naming the fields. In the apply dialog, when `missing_fields` is non-empty:
- a note lists the fields per model and says that syncing the model in LaunchPad's tenant settings adds them;
- the confirm button reads "Create without these fields" (count in the label).

On confirm, `TemplatesPage.submitUseTemplate` removes the listed picks from the template's section field lists before calling `createDefinition`. The catalog entry itself is untouched; the stripping is per-apply. This is the user's decision after hearing the concern that a waiver or signature field can be dropped this way; making the omission visible and named in the button is the mitigation.

*Alternatives:* a server-side `template_id` + `omit_missing` on `POST /definitions` (moves the same filter behind an API for one caller); a deep link into LaunchPad settings (cross-service navigation needs an exchange code; out of scope, and the note names the place instead).

### D7. The base-model rule is a documented convention, not code

A short section in the root `CLAUDE.md` under Conventions: new base fields ship optional or with a `default`; a required field with no default is a deliberate re-version of every live workflow on that model, because `create_instance` refuses a stale definition. The sync endpoint's docstring points at it. No lint or test enforces it; the guard in D3 is what catches a violation at the moment it would matter.

## Risks / Trade-offs

- **Stripped picks still referenced by the machine** → a template whose `show_if`/guard sources or `set_entity_field` effects name a stripped field would publish as `broken`. Neither shipped template does this for the fields a lagging tenant lacks; the publish error names the reference, so it is loud, not silent. Deriving machine-level references is a follow-up if a future template needs it.
- **Stripping empties a section** → the section stays with `fields: []` and renders nothing. Not reachable with the shipped templates against any base-model generation that has existed; noted so the plan's tests cover a synthetic case rather than guess.
- **LaunchPad gains a runtime dependency on apexflow** → only on the sync path, and D4 makes an outage visible rather than ignored. Production needs one new LaunchPad env var for apexflow's internal URL (`apexflow-api.flycast:5910`, per `docs/deployment/architecture.md`), following how admindash reaches it.
- **Demotion is a schema change the admin did not ask for by name** → it is reported under `demoted_fields` so it is never silent, and it only ever loosens a field the current base model no longer declares.
- **Response shape change on `sync-defaults`** → the LaunchPad settings page is the only consumer and ships in the same change.

## Migration Plan

1. Release apexflow first (new preflight endpoint, `missing_fields`, dialog). It is additive and safe without the LaunchPad change.
2. Set `LAUNCHPAD_APEXFLOW_BACKEND_URL` on `launchpad-api`, then release LaunchPad (field-level sync, settings page).
3. Run sync once on the production tenant from its LaunchPad settings page; it reports what it added and whether any workflow is at risk. Re-apply the enrollment template.

Rollback is per module and independent: the previous LaunchPad sync is a strict subset of the new one, and the previous apexflow gallery simply ignores `missing_fields`.

## Open Questions

- None blocking. Whether the "Needs setup" badge should distinguish "missing models" from "missing fields" visually is a copy decision left to the plan.
