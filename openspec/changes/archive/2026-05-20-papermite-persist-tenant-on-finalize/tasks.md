## 1. Pure helpers in `papermite/backend/app/api/finalize.py`

- [x] 1.1 Add `_is_empty(value) -> bool` returning True iff `value is None` or `isinstance(value, str) and value.strip() == ""`. Other values (`0`, `False`, `[]`, dicts, non-empty strings) return False.
- [x] 1.2 Add `_split_extracted_tenant(entity: EntityResult) -> tuple[dict, dict]` that returns `(extracted_base, extracted_custom)`. Iterate `entity.field_mappings`; skip mappings where `_is_empty(mapping.value)`; route by `mapping.source` (`"base_model"` → base bucket, `"custom_field"` → custom bucket). Both returned dicts use `mapping.field_name` as key, `mapping.value` as value.
- [x] 1.3 Add `_split_existing_tenant_row(cleaned: dict) -> tuple[dict, dict]` that returns `(existing_base, existing_custom)`. Import `Tenant` from `app.models.domain`; compute `_TENANT_BASE_KEYS = set(Tenant.model_fields.keys()) - {"tenant_id", "entity_type", "custom_fields"}` once at module scope. Keys in that set → base bucket; everything else → custom bucket.
- [x] 1.4 Add `_merge_fields(existing: dict, extracted: dict) -> dict` that returns a new dict starting from `existing`, then for each `(k, v)` in `extracted`: if `_is_empty(existing.get(k))`, set `result[k] = v`; otherwise leave existing. Pure function, no I/O. Both bucket merges use this same helper.

## 2. Read-merge-write integration with DataCore

- [x] 2.1 Add `_fetch_existing_tenant_row(tenant_id: str) -> dict` that issues `httpx.post(f"{settings.datacore_api_url}/query", json={"tenant_id": tenant_id, "table": "tenants", "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'"}, timeout=30.0)`. On non-2xx, raise `HTTPException(502, "Failed to persist tenant from extraction")`. Parse `resp.json()["data"]`; if empty, return `{}`. Otherwise clean the first row by dropping keys `{"_status", "_version", "_created_at", "_updated_at", "_change_id", "entity_type", "entity_id", "base_data", "custom_fields", "vector"}`, any key starting with `_`, and any `None` value. Return the cleaned dict (do NOT split here — caller invokes `_split_existing_tenant_row`).
- [x] 2.2 In `finalize_commit`, after the existing successful `PUT /api/models/{tenant_id}` block, find the first entity with `entity_type == "TENANT"` (use a generator with `next(..., None)`). If `None`, return the existing success response unchanged (no read or write to DataCore).
- [x] 2.3 Otherwise call `_split_extracted_tenant(tenant_entity)` to get `(extracted_base, extracted_custom)`. If both dicts are empty, return the existing success response unchanged (no DataCore call).
- [x] 2.4 Otherwise: call `_fetch_existing_tenant_row(tenant_id)` → `_split_existing_tenant_row(cleaned)` → `_merge_fields` on each bucket. Build `payload = {"base_data": merged_base, "custom_fields": merged_custom}`. Call `httpx.put(f"{settings.datacore_api_url}/tenants/{tenant_id}", json=payload, timeout=30.0)`. On non-2xx, raise `HTTPException(502, "Failed to persist tenant from extraction")`. On success, return the existing success response unchanged (response shape unchanged from today).

## 3. Pure-helper unit tests in new file `papermite/backend/tests/test_finalize_helpers.py`

- [x] 3.1 `test_is_empty_returns_true_for_none_and_blank_strings` — assert `_is_empty(None)`, `_is_empty("")`, `_is_empty("   ")`, `_is_empty("\t\n")` all return True.
- [x] 3.2 `test_is_empty_returns_false_for_falsy_nonblank_values` — assert `_is_empty(0)`, `_is_empty(False)`, `_is_empty([])`, `_is_empty({})`, `_is_empty("0")`, `_is_empty("False")`, `_is_empty(" x ")` all return False.
- [x] 3.3 `test_split_extracted_tenant_routes_by_source_and_drops_empties` — given an `EntityResult` with mappings `[(name="Acme", base_model), (contact_phone=None, base_model), (display_name="   ", base_model), (school_district_code="DC-100", custom_field), (legacy="", custom_field)]`, assert `extracted_base == {"name": "Acme"}` and `extracted_custom == {"school_district_code": "DC-100"}`.
- [x] 3.4 `test_split_existing_tenant_row_uses_tenant_model_fields_as_discriminator` — given `{"name": "Acme", "contact_email": "a@x.com", "school_district_code": "DC-100", "accreditation_id": "ACC-42"}` (where `name` and `contact_email` are in `Tenant.model_fields` but the others are not), assert `existing_base == {"name": "Acme", "contact_email": "a@x.com"}` and `existing_custom == {"school_district_code": "DC-100", "accreditation_id": "ACC-42"}`.
- [x] 3.5 `test_merge_fields_fills_missing_keys` — `_merge_fields({"a": "x"}, {"b": "y"})` returns `{"a": "x", "b": "y"}`.
- [x] 3.6 `test_merge_fields_fills_none_and_empty_and_whitespace` — `_merge_fields({"a": None, "b": "", "c": "   "}, {"a": "1", "b": "2", "c": "3"})` returns `{"a": "1", "b": "2", "c": "3"}`.
- [x] 3.7 `test_merge_fields_preserves_nonempty_string_over_extracted` — `_merge_fields({"a": "kept"}, {"a": "overwritten"})` returns `{"a": "kept"}`.
- [x] 3.8 `test_merge_fields_preserves_stringified_false_and_zero` — `_merge_fields({"a": "False", "b": "0", "c": "[]"}, {"a": True, "b": 1, "c": [1, 2]})` returns `{"a": "False", "b": "0", "c": "[]"}` (these strings come from DataCore query stringification).
- [x] 3.9 `test_merge_fields_preserves_existing_keys_not_in_extracted` — `_merge_fields({"a": "kept", "b": "also-kept"}, {"c": "new"})` returns `{"a": "kept", "b": "also-kept", "c": "new"}`.

## 4. Endpoint integration tests in `papermite/backend/tests/test_finalize_api.py`

Mock both `httpx.put` (models PUT + tenants PUT) and `httpx.post` (query) to capture calls and return controlled responses. Use the existing `mock_auth` fixture pattern.

- [x] 4.1 `test_finalize_persists_extracted_tenant_when_row_empty` — `httpx.post` returns `{"data": [], "total": 0}`. Extraction's `TENANT` entity has field_mappings `(name="Acme", base_model)` and `(school_district_code="DC-100", custom_field)`. Assert `httpx.put` was called for tenants with `json={"base_data": {"name": "Acme"}, "custom_fields": {"school_district_code": "DC-100"}}` and the endpoint returned 200.
- [x] 4.2 `test_finalize_merges_with_existing_tenant_row` — `httpx.post` returns a flattened row including `name="User Typed Name"`, `contact_email=None`, `school_district_code=""`, `legacy_marker="keep-me"`. Extraction provides `(name="Extracted Name", base_model)`, `(contact_email="a@x.com", base_model)`, `(school_district_code="DC-100", custom_field)`. Assert the tenants PUT body has `base_data["name"] == "User Typed Name"`, `base_data["contact_email"] == "a@x.com"`, `custom_fields["school_district_code"] == "DC-100"`, `custom_fields["legacy_marker"] == "keep-me"`.
- [x] 4.3 `test_finalize_skips_tenant_write_when_no_tenant_entity` — extraction has only STUDENT/FAMILY entities. Assert `httpx.put` called exactly once (models only), `httpx.post` NOT called, finalize returns 200.
- [x] 4.4 `test_finalize_skips_tenant_write_when_all_tenant_mappings_are_empty` — `TENANT` entity has base-model mappings for `name`, `display_name`, `contact_email` all with `value=None` and no custom-field mappings. Assert no tenants read or write occurred; finalize returns 200.
- [x] 4.5 `test_finalize_raises_502_when_tenants_put_fails` — mock the tenants PUT to return status 500. Assert response is 502 with detail `"Failed to persist tenant from extraction"` and the models PUT mock was still invoked first.
- [x] 4.6 `test_finalize_raises_502_when_query_fails` — mock `httpx.post` (the query) to return status 500. Assert response is 502 and the models PUT mock was still invoked first.
- [x] 4.7 `test_finalize_does_not_attempt_tenant_work_when_model_put_fails` — mock the models PUT to return 500. Assert the existing failure response is unchanged (no 502 for tenant), `httpx.post` was NOT called, and the tenants PUT mock was NOT called.

## 5. Verify

- [x] 5.1 Run `cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py tests/test_finalize_helpers.py -v` and confirm all new tests pass.
- [x] 5.2 Run the full Papermite backend test suite (`cd papermite/backend && uv run python -m pytest tests/ -v`) and confirm no regressions.
- [x] 5.3 Manually verify end-to-end in a dev environment: start datacore + papermite + launchpad via `./start-services.sh`; upload a document containing tenant fields via Papermite UI; complete review and click Finish; navigate to Launchpad tenant detail page; confirm extracted base fields appear in inputs that were previously empty AND any extracted custom fields appear in the tenant form (assuming the model definition included them).
