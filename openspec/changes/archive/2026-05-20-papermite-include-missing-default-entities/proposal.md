## Why

When a user uploads a document to Papermite that the AI cannot extract some entity types from (e.g., a tenant-policy PDF with no student information), `mapper.map_extraction` omits those entity types entirely from `ExtractionResult.entities`. The resulting model definition stored at finalize then lacks those entities — a downstream consumer that expects the canonical NeoApex schema (Student, Family, Contact, …) gets a partial model and either fails or silently renders empty.

The user's stated expectation: a model built from any document SHALL still include every canonical entity type, with default base fields populated from the Pydantic schema. Missing entities should appear in the Papermite review UI as empty cards the user can optionally fill in, not silently disappear.

## What Changes

- `mapper.map_extraction` SHALL produce exactly one `EntityResult` for every entity type in `app.models.domain.ENTITY_CLASSES` (tenant, student, family, contact, program, enrollment, attendance, registration_application) regardless of what the AI returned.
- When the AI did not extract an entity type, the corresponding `EntityResult` SHALL be a "placeholder" with `entity` and `field_mappings` derived from the canonical Pydantic class (one mapping per base field, `value=None`, `source="base_model"`). This is the same shape produced today by the "ensure ALL base model fields appear" branch of `_map_entity` when AI extracts an entity but omits some fields.
- For list-type entities (student, family, contact, program, enrollment, attendance, registration_application) the placeholder SHALL be exactly **one** `EntityResult` per missing entity type — not zero (today's behavior) and not many. When the AI list contains items, today's behavior is preserved (`_consolidate_entities` already collapses duplicates to one entity per type).
- For the singleton `tenant` entity, the placeholder SHALL be produced when `raw.tenant` is missing, matching list-entity behavior.

No UI changes. The Papermite review screen already renders entities with base fields of `value=None` (this happens today for any extracted entity whose AI output omits some base fields).

## Capabilities

### New Capabilities
- `papermite-mapper-default-entity-coverage`: Behavior of `mapper.map_extraction` with respect to guaranteeing that every canonical entity type appears in the output, with a placeholder when the AI extracted nothing for that type.

### Modified Capabilities
<!-- None — no existing spec covers map_extraction's entity-coverage guarantees. -->

## Impact

- **Code touched**: `papermite/backend/app/services/mapper.py`, function `map_extraction` (lines ~267-299). Two guards (`if raw.tenant:` and `if raw_list:`) are replaced with always-call-mapper using empty defaults.
- **Tests**: New tests in `papermite/backend/tests/test_mapper.py` covering: (a) all 8 entity types appear when AI returns nothing, (b) all 8 appear when AI returns only one entity type, (c) extracted entities still consolidate to one per type, (d) placeholder field_mappings shape matches the existing "ensure all base fields" output.
- **Downstream effect on model definition**: `_build_model_definition` already iterates whatever is in `extraction.entities` and produces one entry per entity type. Once mapper guarantees full coverage, finalize's resulting model definition will include all 8 entity types automatically — no change to `_build_model_definition` needed.
- **No frontend changes.** The review UI already handles entities with `value=None` field_mappings — placeholder entities will render as empty cards, identical to how a partially-extracted entity already looks.
- **No DataCore, Launchpad, or admindash changes.**
- **Backward-compatibility**: existing extractions that DID return entities are unaffected — they still flow through `_consolidate_entities` exactly as today. Only the missing-entity-type case behaves differently.
