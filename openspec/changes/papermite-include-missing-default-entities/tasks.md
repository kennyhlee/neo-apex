## 1. Modify `map_extraction` in mapper

- [ ] 1.1 In `papermite/backend/app/services/mapper.py`, leave the existing tenant singleton block (lines ~271-275) and list loop (lines ~277-290) untouched. Immediately AFTER the existing `entities = _consolidate_entities(entities)` line (line ~293), add a coverage-backstop loop: compute `existing_types = {e.entity_type.lower() for e in entities}`; iterate `ENTITY_CLASSES.items()`; for each `(entity_type, model_class)` not in `existing_types`, call `_map_entity_list([{}], entity_type, model_class, tenant_id)` and extend `entities` with the result. The backstop uses `_map_entity_list` uniformly for every missing type — including `tenant`, where the existing `data.setdefault("tenant_id", tenant_id)` inside `_map_entity_list` ensures no UUID overwrite happens.

## 2. Unit tests in `papermite/backend/tests/test_mapper.py`

- [ ] 2.1 Add `test_map_extraction_all_placeholders_when_raw_is_empty`: pass `RawExtraction()` with every field at default; assert `len(result.entities) == 8` and the set of `entity_type` values equals `{"TENANT", "PROGRAM", "STUDENT", "FAMILY", "CONTACT", "ENROLLMENT", "ATTENDANCE", "REGISTRATION_APPLICATION"}`.
- [ ] 2.2 Add `test_map_extraction_only_tenant_extracted_yields_7_placeholders`: pass `RawExtraction(tenant={"name": "Acme"})`; assert 8 entities total, TENANT has a `name` field with `value="Acme"`, and each of the other 7 has all `value=None` on its field_mappings (no extracted values).
- [ ] 2.3 Add `test_map_extraction_extracted_students_consolidate_no_student_placeholder`: pass `RawExtraction(students=[{"first_name": "A"}, {"first_name": "B"}, {"first_name": "C"}])`; assert exactly one STUDENT entity exists, its field_mappings reflect consolidation (one mapping per unique field name across the three inputs), and 7 placeholders exist for the other entity types.
- [ ] 2.4 Add `test_placeholder_student_has_full_base_field_coverage`: pass empty `RawExtraction`; locate the STUDENT placeholder; assert every base field in `Student.model_fields` (excluding `tenant_id`, `entity_type`, `custom_fields`) appears in `field_mappings` with `source="base_model"`; assert selection fields (`grade_level`, `gender`, `status`) have non-empty `options` lists from the Pydantic defaults.
- [ ] 2.5 Add `test_placeholder_list_entity_gets_tenant_id_and_uuid_id`: pass empty `RawExtraction`; locate the FAMILY placeholder; assert `entity["tenant_id"] == "t1"` and `entity["family_id"]` is a non-empty string (UUID slice from `_map_entity_list`).
- [ ] 2.6 Add `test_placeholder_tenant_keeps_caller_provided_tenant_id`: pass empty `RawExtraction` (no `raw.tenant`); locate the TENANT placeholder; assert `entity["tenant_id"] == "t1"` (the caller-provided value, not an 8-char UUID slice). Verify by checking `len(entity["tenant_id"]) != 8` or directly `entity["tenant_id"] == "t1"`.
- [ ] 2.7 Add `test_placeholder_attendance_is_added_despite_no_raw_field`: pass empty `RawExtraction`; assert exactly one ATTENDANCE EntityResult exists and its field_mappings include `student_id`, `date`, `program_id`, `class_id`, `status` (the `Attendance` base fields).

## 3. Integration check via `_build_model_definition`

- [ ] 3.1 Add `test_build_model_definition_includes_all_entity_types_for_empty_extraction`: construct an `ExtractionResult` via `mapper.map_extraction(RawExtraction(), "t1", "f.pdf")`; pass `result.entities` to `_build_model_definition` (in `app/api/finalize.py`); assert the returned dict has keys for all 8 entity types (`tenant`, `student`, `family`, `contact`, `program`, `enrollment`, `attendance`, `registration_application`) and each value has non-empty `base_fields`.

## 4. Verify

- [ ] 4.1 Run `cd papermite/backend && uv run python -m pytest tests/test_mapper.py -v` and confirm all new tests pass alongside pre-existing mapper tests.
- [ ] 4.2 Run the full Papermite backend suite (`cd papermite/backend && uv run python -m pytest tests/ --ignore=tests/test_auth.py -v`) and confirm no regressions. (The `test_auth.py` ignore is for a pre-existing unrelated import error.)
- [ ] 4.3 Manually verify in dev: start services via `./start-services.sh`; upload a document that contains only tenant info via Papermite; on the Review screen confirm that all 8 entity cards appear, with the TENANT card carrying extracted values and the other 7 showing empty fields ready for the user to edit.
