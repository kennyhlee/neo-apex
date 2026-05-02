## Context

Papermite's document parse+extract pipeline currently lives in two places:

- **`/api/upload`** (papermite frontend, model-building flow): uses `services/processor.py:process_document()` — a dispatcher introduced in commit `ec7968c` that selects between docling-local and Claude-vision-merged based on `settings.parser_backend`. Returns multi-entity `RawExtraction`, then `mapper.map_extraction()` shapes it into `ExtractionResult` for the review UI.
- **`/api/extract`** (admindash, add-student-with-document flow): uses `services/parser.py:parse_document()` (docling-only) followed by `services/field_extractor.py:extract_fields()` (text-based, single-entity, model-driven prompt). Returns `{"fields": {field_name: value}}`.

The two paths have legitimately different *extraction strategies* (open-ended discovery vs targeted model-driven extraction) but share the *parsing concern* — and only the model-building path benefits from the dispatcher. Concretely:

| | `/api/upload` | `/api/extract` |
|---|---|---|
| Strategy | open-ended (extract everything) | targeted (extract these fields) |
| Prompt | broad system prompt over `ENTITY_CLASSES` | per-entity prompt built from `model_definition` |
| Parser backend | configurable (docling or vision) | hardcoded docling |
| File formats | pdf, docx, txt | pdf, png, jpg, jpeg |
| File lifecycle | persisted (review session) | deleted in `finally` |
| Output | `ExtractionResult` (multi-entity, mapped) | `{"fields": {...}}` (single-entity, flat) |

The OOM incident exposed the cost of `/api/extract` not benefiting from vision-merged parsing. This design takes the two paths and gives them one shared "core" (the parse+dispatch pipeline) while keeping the strategies that each route legitimately needs different. The consolidation also unifies the supported file-format set and retires the `raw_text` placeholder leak that has lived in the merged-vision path since `ec7968c`.

## Goals / Non-Goals

**Goals:**
- Single source of truth for the parse step and the docling-vs-vision dispatch decision.
- `/api/extract` honors `PAPERMITE_PARSER_BACKEND` and gains Claude-vision support for PDFs.
- Both extraction strategies (discovery, targeted) are first-class, reusable from a stable internal API.
- Pipeline API is leak-free: no placeholder strings, no optional types, no caller-visible mode artifacts.
- Both routes share one accepted file-format set: `.pdf`, `.docx`, `.txt`.
- `/api/upload` and `/api/extract` keep their externally visible response contracts (modulo the deliberate `raw_text` removal from `ExtractionResult`).

**Non-Goals:**
- Splitting parse+extract into a separate microservice (evaluated, deferred — see Decisions §6).
- Changing LLM model selection, prompts beyond what's required for the new vision-targeted path, or `RawExtraction` schema.
- Adding new entity types.
- Image-format support on either route (intentionally dropped — beta, no consumer impact).
- Flipping the production `PAPERMITE_PARSER_BACKEND` secret. That's a separate operational step (see "Operational rollout").
- Frontend work beyond the deletion of the now-unused "Show Source" toggle.

## Decisions

### 1. Module layout

**Decision:** Create `app/services/extraction_pipeline.py` as the new shared module. **Hard-delete** `app/services/parser.py`, `app/services/field_extractor.py`, and `app/services/processor.py` — no transitional shims, no `DeprecationWarning`. The repo-wide grep (tasks §1.1) confirms there are no consumers outside the two routes and the two test files we're also deleting; a shim layer adds ceremony with no migration value. `app/services/extractor.py` keeps `extract_entities` / `extract_entities_from_pdf` and gains `extract_fields` / `extract_fields_from_pdf`.

**Alternatives considered:**
- Evolve `processor.py` in place. Rejected — the name "processor" undersells what the module owns.
- Single function with a `mode='discovery'|'targeted'` parameter. Rejected — mode parameters bloat as new strategies appear, and call sites become less self-explanatory than two named functions.
- Pipeline as a class. Rejected — the pipeline is stateless; a class adds ceremony with no benefit.
- Keep `DeprecationWarning` shims for one release. Rejected — there are no consumers to migrate; shims would be code that exists only to be deleted later.

### 2. Public API of the pipeline

**Decision:** Two named entrypoints, sharing internal helpers:

```python
def extract_for_discovery(
    file_path: Path, model_id: str
) -> RawExtraction:
    """Run multi-entity discovery extraction. Used by model-building."""

def extract_for_entity(
    file_path: Path,
    model_id: str,
    entity_type: str,
    model_definition: dict,
) -> dict[str, Any]:
    """Run targeted, model-driven extraction for a single entity type.
    Returns a flat dict of {field_name: value} filtered to known fields."""
```

Both internally consult `settings.parser_backend` and dispatch to the appropriate extractor. Discovery returns `RawExtraction` directly (no tuple, no placeholder string). Targeted returns the filtered field dict.

Future callers requiring discovery use `extract_for_discovery`; targeted use `extract_for_entity`. Adding a third strategy means adding a third entrypoint, not mutating the existing two.

### 3. Vision support for targeted extraction

**Decision:** Add `extract_fields_from_pdf(file_path, model_id, entity_type, model_definition) -> dict[str, Any]` to `extractor.py`. It mirrors `extract_entities_from_pdf` but uses a model-definition-driven prompt (the same prompt-building helper as today's `field_extractor.extract_fields`, with `BinaryContent` instead of pasted markdown). Output schema is `dict[str, Any]` — same as text-based variant — so caller behavior is unchanged.

**Alternatives considered:**
- Reuse `extract_entities_from_pdf` and post-filter to one entity. Rejected — wastes tokens (the model attempts every entity in `ENTITY_CLASSES`) and produces less precise results than a focused prompt.

### 4. `raw_text` removal

**Decision:** Remove `raw_text` from the discovery pipeline return, from `mapper.map_extraction()`'s signature, and from the `ExtractionResult` Pydantic schema. The papermite-frontend review page's "Show Source" toggle is deleted in the same change.

**Rationale:** the merged-vision path never produced real `raw_text` — it returned a literal placeholder string ("[Document processed in merged mode...]") that surfaced into the UI. The "Show Source" feature is unused in practice; user research confirmed end users don't reference it. Removing it eliminates a leaky abstraction and a UX wart in one move.

**Alternative considered:** make `raw_text` optional and have the route hide the toggle when None. Rejected — the feature isn't valuable enough to keep; deletion is cleaner.

### 5. File-format unification

**Decision:** Both routes accept the same set: `{.pdf, .docx, .txt}`. `/api/extract`'s `ALLOWED_EXTENSIONS` is updated; image formats (`.png`, `.jpg`, `.jpeg`) are dropped. The HTTP 422 "unsupported format" message is updated correspondingly.

**Rationale:** Beta product; no production consumer relies on image support. Aligning the format sets removes a confusing asymmetry that was an artifact of how the two routes evolved separately, and simplifies the pipeline contract (one supported set, one set of tests).

**Non-PDF handling under `claude_merged`:** unchanged from today's `processor.py` behavior. `.txt` is read directly (no docling, no LLM parse). `.docx` falls back to docling regardless of `parser_backend` — Claude vision does not natively accept DOCX inputs reliably, and converting DOCX→PDF in-process is a separate concern. This means DOCX uploads still load docling; PDF + `claude_merged` is the only fully docling-free path, and that's the dominant case for the admindash flow we care about for OOM.

### 6. File lifecycle

**Decision:** Pipeline does not manage file lifecycle. Routes save the upload, call the pipeline, and decide whether to persist or delete. `/api/upload` persists (review session). `/api/extract` deletes in `finally` (single-shot). This keeps the pipeline pure and stateless.

### 7. In-process module vs separate microservice

**Decision:** Stay in-process. Pipeline is a Python module imported by both routes.

**Rationale:** Today there are two callers, both within papermite. The proposal's stated future workflows ("other entity types, other admin products") most naturally consume the pipeline via a stable HTTP API on papermite (the existing `/api/extract` endpoint, after this consolidation), not via a Python import — which means the consolidation already gives them a usable surface. Splitting to a microservice would add operational cost (separate Fly app, deploy pipeline, secrets, monitoring) without removing duplication: the routes still need their adapters.

**Revisit if:** (a) the pipeline ever needs GPU acceleration (different machine class), or (b) >2 distinct services need to import the pipeline as a Python module across repository boundaries.

### 8. Test strategy

**Decision:** Mock-based tests at two layers:

1. **Pipeline unit tests** (`backend/tests/test_extraction_pipeline.py`): mock `extract_entities`, `extract_entities_from_pdf`, `extract_fields`, `extract_fields_from_pdf`, and `parse_document` (the docling caller, which becomes an internal helper in the pipeline). Assert the pipeline dispatches to the correct extractor under each `parser_backend` × file-extension combination. Mocks let us cover both backends without an Anthropic key in CI.
2. **Route adapter tests** (existing `test_extract_api.py` extended; existing `test_upload.py` updated): mock the pipeline entrypoints; assert routes wrap the result in the right response shape.

No live-LLM snapshot tests in this change. LLM output is non-deterministic; byte-equivalent assertions would flap. A live-LLM smoke check is logged as a follow-up (out of scope) for pre-release confidence if desired.

### 9. Naming

**Decision:** Use these three terms consistently:
- **Entity** = a domain object (Student, Family, Contact). Multi-entity discovery extracts entities.
- **Field** = a name/value pair within an entity. Targeted extraction returns fields.
- **Extraction** = the act/result of running the pipeline. Both modes produce extractions; their shapes differ.

`extract_for_discovery` / `extract_for_entity` / `extract_fields_from_pdf` follow this convention.

## Risks / Trade-offs

**[Risk]** New `extract_fields_from_pdf` prompt under-performs docling+text on documents with small print or scanned handwriting → **Mitigation:** the parser-backend choice is a deployment-time setting, so `local` remains a one-secret-flip rollback. The vision path is opt-in.

**[Risk]** DOCX uploads still load docling, so `papermite-api` still has tail-risk OOM exposure if a heavy DOCX arrives soon after start → **Mitigation:** DOCX is rare for the admindash add-student flow. Keep the 4 GB machine until soak window confirms steady-state PDF traffic on the merged path. The 2 GB scale-back is a separate decision (tasks §10.1).

**[Risk]** Removing `ExtractionResult.raw_text` is a breaking shape change to `/api/upload`'s response → **Mitigation:** the only consumer is papermite-frontend, updated in lockstep in this same change. Deploy frontend and backend together (same release tag).

**[Risk]** Changing `/api/extract`'s `ALLOWED_EXTENSIONS` could surface a forgotten admindash UI flow that uploads images → **Mitigation:** the admindash frontend's `DocumentUpload.tsx` defines `ACCEPTED_FORMATS = ['.pdf', '.png', '.jpg', '.jpeg']` — also updated in this change to match the new server-side set, ensuring the UI never offers a format the backend rejects.

## Migration Plan

1. **Land the pipeline** (`extraction_pipeline.py`) and the new `extract_fields` / `extract_fields_from_pdf` in `extractor.py`, with mock-based unit tests. New module is unused at this point.
2. **Update model schema** — drop `ExtractionResult.raw_text`, drop `text` arg from `mapper.map_extraction()`. Update tests for `mapper`.
3. **Rewire `/api/upload`** to call `extract_for_discovery`. Existing tests should pass after mocking is updated.
4. **Rewire `/api/extract`** to call `extract_for_entity`. Update `ALLOWED_EXTENSIONS`. Existing `test_extract_api.py` updated for new format set and pipeline mocking.
5. **Update papermite-frontend** — delete "Show Source" toggle/panel and the `raw_text` field from `types/models.ts`.
6. **Update admindash-frontend** — narrow `DocumentUpload.tsx` `ACCEPTED_FORMATS` to `['.pdf', '.docx', '.txt']`.
7. **Delete** `parser.py`, `field_extractor.py`, `processor.py`, `test_field_extractor.py`, `test_processor.py`.
8. **Cut releases** through the existing pipeline, in this order: papermite-api, papermite-frontend, admindash-frontend.
9. **Soak**: monitor papermite-api memory and extraction error rates for one week. If green and `parser_backend=claude_merged` is set, evaluate scaling memory back to 2 GB (separate change).

**Rollback:** revert the route rewires (steps 3–4). The pipeline module can stay (unused). Frontend deletions are reverted by reverting commits. No data migration required.

## Operational rollout

Independent of the code change, OOM relief requires `PAPERMITE_PARSER_BACKEND=claude_merged` to be set on `papermite-api`. This change does not flip the secret automatically. Confirm or set:

```bash
# Set it (idempotent)
flyctl secrets set PAPERMITE_PARSER_BACKEND=claude_merged --app papermite-api
```

If the value is already `claude_merged`, the consolidation gives admindash PDF uploads docling-free behavior on the next restart. If it's `local`, the consolidation gives admindash the *option* to flip later.

## Open Questions

- Should the pipeline expose a programmatic cost-estimate hook (token count, expected $) for callers that want to gate by cost? Not in this change; revisit when a caller asks.
- Should DOCX get a Claude-vision path via in-process DOCX→PDF conversion? Not now; DOCX is tail traffic. Revisit if DOCX-driven OOMs appear post-rollout.
