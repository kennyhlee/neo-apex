## Why

A production tenant whose entity models were seeded from an older `base_model.json` cannot publish a workflow created from the shipped enrollment template: the template picks eight `registration_application` fields the tenant's model never received, and publish fails with `field 'X' does not exist on model 'registration_application'`. LaunchPad's "sync defaults" cannot repair this because it only adds entity types the tenant lacks and never adds fields to an existing type. The template assumes a base-model generation it never names, and the admin has no way to see the gap before publish or to close it.

## What Changes

- **LaunchPad model sync becomes field-level.** `POST /tenants/{tenant_id}/model/sync-defaults` merges the current base fields into every entity type the tenant already has (base fields win, tenant custom fields preserved, carried-forward required-no-default fields demoted to optional), writes back only entity types whose definition changed, and reports per entity type what was added and what was demoted. Adding missing entity types continues to work as today.
- **Sync refuses to silently stall live workflows.** Before writing, the sync checks the tenant's published workflow definitions against the merged models and reports any that would become stale or broken. If any would, the write is refused with that report unless the request passes `force: true`.
- **Templates derive their model compatibility.** The apexflow templates route adds `missing_fields` (per entity model, derived from the template's own section picks against the tenant's current models) beside the existing `missing_models`. The gallery card and apply dialog show the missing fields.
- **Applying a template against an older model is an explicit choice.** When a template has missing fields, the apply dialog offers two paths: sync the tenant's model first, or apply without the missing fields. The second path strips those picks from the created draft so it validates and publishes against the tenant's current model. The admin sees the list of omitted fields before confirming; the template source itself is never changed.
- **The base-model rule is documented.** New base fields ship optional or with a `default`. A required field with no default is a deliberate decision to re-version every live workflow on that model, because the engine refuses new instances for a stale definition.

## Capabilities

### New Capabilities
- `launchpad-model-field-sync`: field-level merge of base-model fields into a tenant's existing entity models, with a per-type change report and a published-workflow health guard.
- `template-model-compatibility`: derived `missing_fields` on the template catalog, surfaced in the gallery, with an explicit sync-or-omit choice at apply time.

### Modified Capabilities
- (none — no existing spec in `openspec/specs/` governs the sync endpoint or the template catalog)

## Impact

- **launchpad/backend** — `app/api/tenants.py` sync endpoint; a merge helper imported from a shared location; new tests in `backend/tests/test_tenants_api.py`.
- **launchpad/frontend** — the sync call in `src/api/client.ts` and whatever renders its result must show the per-type report and the force confirmation.
- **apexflow/backend** — `app/api/designer.py` templates route gains `missing_fields`; a small preflight endpoint that evaluates `definition_health` for the tenant's published definitions against a proposed set of models, so LaunchPad can run the guard without importing apexflow code.
- **apexflow/frontend** — `TemplatesPage.tsx`, the apply dialog, `types/designer.ts`, `api/designer.ts`, `i18n/translations.ts` (en + zh).
- **scripts/apexflow-reseed-dev.py** — imports the merge rule from its new shared home instead of defining it; its tests move with it.
- **docs** — the base-model evolution rule, placed next to `base_model.json`'s owner (LaunchPad) and referenced from the root `CLAUDE.md`.
- **Cross-service dependency** — LaunchPad backend calls one new apexflow endpoint. LaunchPad does not currently call apexflow; `services.json` already carries its URL.
- **No data migration.** Existing tenants are unchanged until an admin runs sync. The production tenant that triggered this is unblocked by running the new sync once, which is a manual step after release.
