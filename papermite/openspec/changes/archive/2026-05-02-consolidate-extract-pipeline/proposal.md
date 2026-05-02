## Why

Papermite has two routes that both run a "parse a document → extract structured data" pipeline, but they took divergent paths during the recent Claude-vision migration. `/api/upload` (model-building, used by the papermite frontend) goes through `process_document()` — a dispatcher that selects between docling-local and Claude-vision-merged via `PAPERMITE_PARSER_BACKEND`. `/api/extract` (used by admindash for "Add Student → Upload Document") still calls `parse_document()` (docling-only) and `extract_fields()` directly, bypassing the dispatcher.

Two concrete problems result:

1. **Operational**: every `/api/extract` call eagerly loads docling + RapidOCR PyTorch models (~1.85 GB RSS), which OOM-killed papermite-api on 2 GB and forced an emergency scale to 4 GB. The Claude-vision path would have avoided this entirely — but the route can't reach it.
2. **Architectural**: the parse+extract pipeline now exists as two separate code paths with subtly different file-format support, lifecycle behavior, error handling, and prompting strategies. Future workflows (additional entity-extraction surfaces in admindash, similar features in other admin products) will need the same pipeline and there is no single, reusable component to wire them through. New callers will either copy `/api/extract`'s pattern (and re-inherit the docling-only limitation) or copy `/api/upload`'s (which produces an output shape they don't want).

The fix is to define one shared parse+extract pipeline that both existing routes consume and that future callers can reuse, while preserving each route's externally visible response contract.

## What Changes

- Introduce a single internal pipeline module (`app/services/extraction_pipeline.py`) that owns parse+extract dispatch (parser-backend selection, discovery-vs-targeted extraction strategy).
- Rewire `/api/extract` to consume the shared pipeline so it inherits Claude-vision support when `PAPERMITE_PARSER_BACKEND=claude_merged`.
- Rewire `/api/upload` to consume the shared pipeline (it already does via `process_document()`; this change formalizes the boundary).
- **Unify the supported file-format set across both routes to `.pdf`, `.docx`, `.txt`.** Drop image support (`.png`, `.jpg`, `.jpeg`) from `/api/extract` — beta status, no consumer impact.
- **Remove the `raw_text` return from the discovery pipeline and the `ExtractionResult` schema.** Drop the corresponding "Show Source" feature from the papermite-frontend review page. The placeholder string previously emitted on the merged-vision path is no longer needed.
- Hard-delete the standalone `services/parser.py`, `services/field_extractor.py`, and `services/processor.py` modules and their dedicated tests once their callers are rewired. No transitional shims; no `DeprecationWarning` runway — there are no consumers outside what we're rewriting.

Out of scope:
- Changing LLM model selection or `RawExtraction` schema.
- Adding new entity types or new file formats.
- Splitting parse+extract into a separate microservice (evaluated, deferred — see design.md §6).
- Flipping the production `PAPERMITE_PARSER_BACKEND` value. The consolidation makes the dispatcher effective on `/api/extract`; whether to set the secret to `claude_merged` for OOM relief is a separate operational decision (see design.md, "Operational rollout").

## Capabilities

### New Capabilities
- `document-extraction-pipeline`: the shared parse+extract pipeline contract — input (file, mode, model context), output (typed extraction result), backend dispatch (docling-local vs Claude-vision-merged for PDFs), and lifecycle (pure-function, caller owns the file). Includes both extraction modes: **discovery** (open-ended, multi-entity, used by model-building) and **targeted** (model-driven, single-entity, used by entity-extraction).

### Modified Capabilities
- `document-field-extraction`: `/api/extract` requirements update — the endpoint MUST consume the shared pipeline, MUST honor `PAPERMITE_PARSER_BACKEND`, and the supported file formats change from `pdf, png, jpg, jpeg` to `pdf, docx, txt`. External response shape (`{"fields": {...}}`) is preserved.

## Impact

**Affected code (papermite/backend):**
- `app/services/extraction_pipeline.py` — **new** shared module
- `app/services/parser.py` — **deleted**
- `app/services/field_extractor.py` — **deleted**
- `app/services/processor.py` — **deleted**
- `app/services/extractor.py` — gains `extract_fields` (text) and `extract_fields_from_pdf` (vision); `field_extractor`'s logic moves here
- `app/services/mapper.py` — `map_extraction()` loses its `text` parameter
- `app/api/extract.py` — calls the pipeline; updates `ALLOWED_EXTENSIONS` to `{.pdf, .docx, .txt}`
- `app/api/upload.py` — calls the pipeline (semantics unchanged)
- `app/models/extraction.py` — `ExtractionResult.raw_text` field deleted
- `backend/tests/test_field_extractor.py` — **deleted**
- `backend/tests/test_processor.py` — **deleted**
- `backend/tests/test_extract_api.py` — updated for new `ALLOWED_EXTENSIONS` and pipeline-mocking pattern
- New `backend/tests/test_extraction_pipeline.py` — covers both entrypoints across both backends (mock-based, no live LLM calls)

**Affected code (papermite/frontend):**
- Review-page "Show Source" toggle and panel — **deleted** (small component + CSS class cleanup)
- `types/models.ts` — `ExtractionResult.raw_text` field removed

**Affected APIs:**
- `/api/upload`: response no longer includes `raw_text` (small breaking shape change; consumed only by papermite-frontend, which is updated in lockstep).
- `/api/extract`: external response shape unchanged. Accepted file formats change: adds `.docx`/`.txt`, removes `.png`/`.jpg`/`.jpeg`.

**Affected dependencies:** none added or removed. `PAPERMITE_PARSER_BACKEND` setting becomes effective on `/api/extract` (currently a no-op for that route).

**Operational impact:** when `PAPERMITE_PARSER_BACKEND=claude_merged` is set on `papermite-api`, admindash document uploads of PDFs will skip the docling/RapidOCR load entirely. DOCX uploads still load docling (preserved fallback). The recent OOM-driven 2 GB → 4 GB scale-up may become reversible after this change ships and the parser-backend secret is verified set to `claude_merged`; that decision is a follow-up after a soak window.
