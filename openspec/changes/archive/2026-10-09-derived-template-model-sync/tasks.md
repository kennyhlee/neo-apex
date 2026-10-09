## 1. Merge rule moves to LaunchPad

- [x] 1.1 Create `launchpad/backend/app/model_merge.py` with `merge_model_definition` moved verbatim from `scripts/apexflow-reseed-dev.py`; move its seven unit tests from `apexflow/backend/tests/test_reseed_script.py` to `launchpad/backend/tests/test_model_merge.py` and confirm they pass in the LaunchPad env
- [x] 1.2 Make `scripts/apexflow-reseed-dev.py` load the function from the LaunchPad file by path (`importlib.util.spec_from_file_location`) and delete its local copy; add one test in `test_reseed_script.py` asserting the script's attribute is the LaunchPad function; run the apexflow suite

## 2. apexflow model preflight endpoint

- [x] 2.1 Add `POST /api/workflows/{tenant_id}/model-preflight` in `apexflow/backend/app/api/designer.py` returning `health_before`/`health_after` per published definition, batching the stored-model fetch as `list_definitions` does; parse failures report `broken`
- [x] 2.2 Tests in `test_designer_api.py` for: required-no-default field makes a published workflow stale; optional additions leave health unchanged; drafts excluded; unparseable row reports broken; wrong tenant 403. Verify by mutation (overlay order swapped, status filter removed)

## 3. LaunchPad field-level sync

- [x] 3.1 Add `apexflow_backend_url` to `launchpad/backend/app/config.py` (services.json default, `LAUNCHPAD_APEXFLOW_BACKEND_URL` override) with a test
- [x] 3.2 Rewrite `sync_default_model` in `launchpad/backend/app/api/tenants.py`: fetch full stored definitions, merge per existing type, add missing types, compute `added_entities`/`changed`, write only changed types in one PUT, return the new response shape; take `Authorization` as a `Header` parameter and an optional `{"force": bool}` body
- [x] 3.3 Add the preflight call and guard: call apexflow with the to-be-written definitions, build `workflows_at_risk`, 409 unless `force`, 502 on preflight failure unless `force` (then `preflight: "unavailable"`); skip preflight when nothing would be written
- [x] 3.4 Rewrite the sync tests in `launchpad/backend/tests/test_tenants_api.py`: eight-field lag with a custom field preserved; nothing to do sends no PUT; only changed types written; tenant-only type untouched; report lists added and demoted fields; 409 on at-risk without force; 200 with force; 502 on preflight failure; forced through preflight failure; no preflight when nothing to write; tenant mismatch 403. Verify by mutation (drop the diff check, drop the force check)

## 4. LaunchPad settings page

- [x] 4.1 Update `syncDefaultModel` in `launchpad/frontend/src/api/client.ts` to the new response type, pass `force`, and surface a 409 body instead of throwing
- [x] 4.2 Update `TenantSettingsPage.tsx` to render added entities, per-type added/demoted fields, and at-risk workflows, with a "Sync anyway" action on 409; `npm run build` and `npm run lint` pass

## 5. apexflow templates gallery

- [x] 5.1 Add derived `missing_fields` to `templates_route` in `designer.py`; tests in `test_designer_api.py`: lagging model reports the exact fields; custom field satisfies a pick; missing model not double-reported; complete tenant gives `{}`; key always present and sorted. Verify by mutation
- [x] 5.2 Add `missing_fields` to `TemplateCatalogEntry` in `types/designer.ts` and default it to `{}` in `api/designer.ts`'s normalizer, mirroring `missing_models`
- [x] 5.3 Update `TemplatesPage.tsx`: badge when either list is non-empty, card copy naming fields per model, dialog note, confirm label "Create without {n} fields", and strip the listed picks from the matching model's sections before `createDefinition`; add en + zh strings in `translations.ts`
- [x] 5.4 Unit test the pick-stripping helper (pure function next to the page or in `editor/`): matching model stripped, other model untouched, empty map is identity, structure otherwise deep-equal; `npm run build` and `npm run lint` pass

## 6. Documentation

- [x] 6.1 Add the base-model evolution rule to the root `CLAUDE.md` Conventions section, naming `base_model.json` and the stale-definition consequence; reference it from the sync endpoint docstring
- [x] 6.2 Add `LAUNCHPAD_APEXFLOW_BACKEND_URL` to `docs/deployment/provisioning.md` secrets/env for `launchpad-api` with the flycast value, and note the release order (apexflow before LaunchPad) in the release runbook
