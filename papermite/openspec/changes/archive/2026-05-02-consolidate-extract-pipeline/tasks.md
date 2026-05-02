## 1. Pre-flight

- [x] 1.1 Grep the entire repo (excluding `.venv`, `node_modules`, build artifacts) for direct imports of `app.services.parser`, `app.services.field_extractor`, and `app.services.processor`; confirm only the two routes (`api/extract.py`, `api/upload.py`) and the two test files (`test_field_extractor.py`, `test_processor.py`) reference them. If unexpected callers appear, stop and re-scope.
- [x] 1.2 Verify `extract_fields_from_pdf` does not yet exist in `extractor.py` (sanity check that this is greenfield).
- [x] 1.3 Confirm `PAPERMITE_PARSER_BACKEND` exists as a setting in `app/config.py` and is consulted via `settings.parser_backend`.

## 2. Schema cleanup: drop `raw_text` from extraction model

- [x] 2.1 Write failing test `test_extraction_result_has_no_raw_text_field` asserting `ExtractionResult` Pydantic schema has no `raw_text` attribute.
- [x] 2.2 Remove the `raw_text` field from `ExtractionResult` in `app/models/extraction.py`. Update any internal references.
- [x] 2.3 Update `mapper.map_extraction()` signature: drop the `text` parameter; update the function body to not reference text. Update existing `test_mapper.py` tests accordingly.
- [x] 2.4 Run mapper tests; confirm green.

## 3. New extractor variants in `extractor.py`

- [x] 3.1 Move `extract_fields(text, entity_type, model_definition, model_id) -> dict[str, Any]` from `field_extractor.py` into `extractor.py` (verbatim, plus its prompt-building helper). Add a passing test `test_extract_fields_text_path` mirroring the existing `test_field_extractor.py` coverage.
- [x] 3.2 Write failing test `test_extract_fields_from_pdf_returns_filtered_dict` covering the new function's contract: returns `dict[str, Any]`, only known fields, no None/empty values.
- [x] 3.3 Write failing tests for hallucinated-field filtering, empty-value filtering, and missing-entity-type returning `{}`.
- [x] 3.4 Add `extract_fields_from_pdf(file_path, model_id, entity_type, model_definition) -> dict[str, Any]` to `extractor.py`, mirroring `extract_entities_from_pdf` but using the model-definition-driven prompt builder.
- [x] 3.5 Run extractor tests; confirm all green.

## 4. New shared module: `extraction_pipeline.py`

- [x] 4.1 Write failing test `test_extract_for_discovery_dispatches_local` (PDF + `parser_backend=local` → docling parse → `extract_entities` called; mocks assert call args).
- [x] 4.2 Write failing test `test_extract_for_discovery_dispatches_claude_merged` (PDF + `parser_backend=claude_merged` → docling NOT called; `extract_entities_from_pdf` called).
- [x] 4.3 Write failing test `test_extract_for_discovery_returns_raw_extraction_directly` (return type is `RawExtraction`, not a tuple).
- [x] 4.4 Write failing test `test_extract_for_entity_dispatches_local` (PDF + local → docling parse → `extract_fields` called with model definition).
- [x] 4.5 Write failing test `test_extract_for_entity_dispatches_claude_merged` (PDF + claude_merged → `extract_fields_from_pdf` called).
- [x] 4.6 Write failing test `test_docx_always_uses_local` (`.docx` + claude_merged → docling parse → text extractor; merged-vision NOT called).
- [x] 4.7 Write failing test `test_txt_always_uses_direct_read` (`.txt` → file read directly, no docling, text extractor called).
- [x] 4.8 Write failing test `test_pdf_with_unknown_parser_backend_raises_value_error` (PDF + `parser_backend="bogus"` → `ValueError` mentioning supported values).
- [x] 4.9 Write failing test `test_pipeline_does_not_delete_input_file` (file at `path` still exists after either entrypoint returns).
- [x] 4.10 Write failing test `test_extract_for_entity_filters_unknown_fields` and `test_extract_for_entity_filters_empty_values` and `test_extract_for_entity_returns_empty_for_missing_entity_type`.
- [x] 4.11 Create `app/services/extraction_pipeline.py` with `extract_for_discovery`, `extract_for_entity`, an internal `_docling_parse` helper (replacing the old `parser.parse_document`), and the dispatch logic. Implement until all tests in §4.1–§4.10 pass.

## 5. Rewire `/api/upload`

- [x] 5.1 In `app/api/upload.py`, replace `from app.services.processor import process_document` with `from app.services.extraction_pipeline import extract_for_discovery`.
- [x] 5.2 Replace `raw_extraction, text = process_document(file_path, model_id)` with `raw_extraction = extract_for_discovery(file_path, model_id)`.
- [x] 5.3 Update the `mapper.map_extraction(raw_extraction, tenant_id, file.filename, text)` call to drop `text`: `mapper.map_extraction(raw_extraction, tenant_id, file.filename)`.
- [x] 5.4 Update existing `test_upload.py` tests for the new mocking target (`extract_for_discovery` instead of `process_document`) and the new mapper signature.
- [x] 5.5 Run upload tests; confirm green.

## 6. Rewire `/api/extract`

- [x] 6.1 Update `ALLOWED_EXTENSIONS` in `app/api/extract.py` from `{".pdf", ".png", ".jpg", ".jpeg"}` to `{".pdf", ".docx", ".txt"}`.
- [x] 6.2 Update the corresponding HTTP 422 message to name the new supported set.
- [x] 6.3 Write failing test `test_extract_route_calls_pipeline` (mock `extract_for_entity`; post a PDF; assert pipeline was called with `(file_path, settings.default_model, entity_type, model_definition)`; assert response is `{"fields": <pipeline output>}`).
- [x] 6.4 Write failing test `test_extract_route_rejects_image_formats` (post a `.png`; assert HTTP 422 with the new message).
- [x] 6.5 Write failing test `test_extract_route_accepts_docx` (post a `.docx`; mock pipeline; assert HTTP 200).
- [x] 6.6 Write failing test `test_extract_route_accepts_txt` (post a `.txt`; mock pipeline; assert HTTP 200).
- [x] 6.7 In `app/api/extract.py`, replace the `parse_document` + `extract_fields` calls with one `extract_for_entity(file_path, settings.default_model, entity_type, model_definition)` call; wrap the result in `{"fields": ...}`.
- [x] 6.8 Remove the now-unused imports `parse_document`, `extract_fields` from `app/api/extract.py`.
- [x] 6.9 Update the existing `test_extract_api.py::test_unsupported_file_format` to use a format that's actually unsupported under the new set (e.g., `.png`); update other tests to mock `extract_for_entity` instead of `parse_document`/`extract_fields`.
- [x] 6.10 Run extract-route tests; confirm all green.

## 7. Frontend cleanup: remove "Show Source" feature

- [x] 7.1 In `papermite/frontend/src/types/models.ts`, remove the `raw_text` field from the `ExtractionResult` interface.
- [x] 7.2 In the review-page component (`papermite/frontend/src/pages/ReviewPage.tsx` or equivalent), remove the "Show Source" toggle button, the source-text panel, and any related state.
- [x] 7.3 Remove the orphaned CSS classes for the source panel.
- [x] 7.4 Run `npm run build` and `npm run lint` in `papermite/frontend`; confirm green.

## 8. Frontend alignment: narrow admindash accepted formats

- [x] 8.1 In `admindash/frontend/src/components/DocumentUpload.tsx`, narrow `ACCEPTED_FORMATS` from `['.pdf', '.png', '.jpg', '.jpeg']` to `['.pdf', '.docx', '.txt']` and update `ACCEPTED_MIME` to match.
- [x] 8.2 Update the upload-prompt translation strings (`addStudent.supportedFormats`) to reflect the new set.
- [x] 8.3 Run `npm run build` and `npm run lint` in `admindash/frontend`; confirm green.

## 9. Hard delete retired modules

- [x] 9.1 Delete `app/services/parser.py`.
- [x] 9.2 Delete `app/services/field_extractor.py`.
- [x] 9.3 Delete `app/services/processor.py`.
- [x] 9.4 Delete `backend/tests/test_field_extractor.py`.
- [x] 9.5 Delete `backend/tests/test_processor.py`.
- [x] 9.6 Repo-wide grep to confirm no residual references to the deleted symbols (`parse_document`, `extract_fields` as imported from `field_extractor`, `process_document`).

## 10. Documentation and observability

- [x] 10.1 Update `papermite/CLAUDE.md`: document the new module location (`app/services/extraction_pipeline.py`) and the two entrypoints; remove references to `parser.py` / `field_extractor.py` / `processor.py`.
- [x] 10.2 Add an `X-Papermite-Parser-Backend` response header on `/api/extract` and `/api/upload` whose value is the active backend (`local` or `claude_merged`); add a test verifying the header is present.
- [x] 10.3 Sync the modified `document-field-extraction` spec to `papermite/openspec/specs/` (via `opsx:sync` or manual update) so the live spec reflects the new behavior.

## 11. Release

- [x] 11.1 Run the full papermite backend test suite (`cd papermite && uv run pytest backend/tests/`); confirm green and capture count.
- [x] 11.2 Run papermite frontend build (`cd papermite/frontend && npm run build`) and admindash frontend build; confirm green.
- [x] 11.3 Commit with conventional message `refactor(papermite): consolidate parse+extract into extraction_pipeline`. Include a body summarizing the unified format set, raw_text removal, and dispatcher coverage for /api/extract.
- [x] 11.4 Push to main; cut `papermite-vX.Y.Z` GitHub release with notes summarizing the consolidation and the operational benefit.
- [x] 11.5 Cut `papermite-frontend` and `admindash-frontend` releases in the same window so the deployed bundles match the new server contract.
- [x] 11.6 Approve the production deploys in the GitHub `production` environment per `docs/deployment/release-runbook.md`.
- [x] 11.7 Verify post-deploy: confirm `flyctl secrets list --app papermite-api | grep PAPERMITE_PARSER_BACKEND` shows the secret is set; if `claude_merged` is desired and not yet set, run `flyctl secrets set PAPERMITE_PARSER_BACKEND=claude_merged --app papermite-api`. Hit `/api/extract` from admin.floatify.com with a sample PDF; confirm `X-Papermite-Parser-Backend: claude_merged` in the response and no docling activity in `flyctl logs --app papermite-api`.

## 12. Soak and follow-ups

- [x] 12.1 Monitor `papermite-api` memory and extraction error rates for one week.
- [x] 12.2 If memory is stable on `claude_merged`, open a follow-up change to scale memory back from 4 GB to 2 GB.
- [x] 12.3 If extraction quality issues surface on the `claude_merged` path, log them with the `X-Papermite-Parser-Backend` value and revisit per-route or per-tenant defaults.
