# papermite-mapper-default-entity-coverage Specification

## Purpose

Defines the contract that `mapper.map_extraction` produces a complete `ExtractionResult.entities` list — exactly one `EntityResult` per canonical entity type declared in `app.models.domain.ENTITY_CLASSES`. Entity types the AI did not extract are filled in by a coverage backstop that builds a placeholder via `_map_entity_list([{}], …)`, giving the placeholder full base-field coverage from the Pydantic class with `value=None`, `source="base_model"`, and selection options from defaults. Guarantees downstream consumers (e.g., `finalize._build_model_definition`) see the canonical NeoApex schema regardless of source-document content.

## Requirements


### Requirement: map_extraction SHALL produce one EntityResult per entity type in ENTITY_CLASSES

When `mapper.map_extraction` returns an `ExtractionResult`, the `entities` list SHALL contain exactly one `EntityResult` for every key in `app.models.domain.ENTITY_CLASSES`. The set of `EntityResult.entity_type` values (upper-cased) SHALL equal `{key.upper() for key in ENTITY_CLASSES}`. This guarantee SHALL hold regardless of which entity types the AI populated in `raw` — including when the AI returns `RawExtraction()` with all fields empty.

Entity types that the AI extracted SHALL preserve today's behavior: they flow through `_map_entity` / `_map_entity_list` and are consolidated by `_consolidate_entities` to exactly one `EntityResult` per type. Entity types absent from `raw` SHALL be represented by a single placeholder `EntityResult` as described in the "Placeholder shape" requirement below.

#### Scenario: AI returns nothing — all 8 placeholders present

- **GIVEN** `raw = RawExtraction()` (every field empty / default)
- **WHEN** `mapper.map_extraction(raw, tenant_id="t1", filename="f.pdf")` runs
- **THEN** the returned `ExtractionResult.entities` SHALL contain exactly 8 entries
- **AND** the set of `entity_type` values SHALL equal `{"TENANT", "PROGRAM", "STUDENT", "FAMILY", "CONTACT", "ENROLLMENT", "ATTENDANCE", "REGISTRATION_APPLICATION"}`

#### Scenario: AI extracts only tenant — other 7 are placeholders

- **GIVEN** `raw.tenant = {"name": "Acme"}` and every other `raw.<type>` is empty
- **WHEN** `mapper.map_extraction(...)` runs
- **THEN** `entities` SHALL contain 8 entries (one per `ENTITY_CLASSES` key)
- **AND** the `TENANT` entity's `field_mappings` SHALL include a mapping with `field_name="name"` and `value="Acme"`
- **AND** every other entity type SHALL have its `field_mappings` populated with base-model entries whose `value` is `None`

#### Scenario: AI extracts multiple students — they consolidate to one STUDENT entity, others remain placeholders

- **GIVEN** `raw.students = [{"first_name": "Sam"}, {"first_name": "Alex"}]` and every other `raw.<type>` is empty
- **WHEN** `mapper.map_extraction(...)` runs
- **THEN** `entities` SHALL contain 8 entries
- **AND** exactly one entry SHALL have `entity_type == "STUDENT"` (consolidated)
- **AND** the remaining 7 entries SHALL each correspond to one of the other `ENTITY_CLASSES` keys, with placeholder content

### Requirement: Placeholder EntityResults SHALL carry full base-model field_mappings with value=None

A placeholder `EntityResult` (one created for an entity type absent from `raw`) SHALL have its `field_mappings` populated identically to the output produced by calling `_map_entity({}, ENTITY_CLASSES[entity_type])` today. This SHALL mean: one `FieldMapping` per base field declared on the entity's Pydantic class (excluding the system fields `tenant_id`, `entity_type`, `custom_fields`), with `value=None` (or the Pydantic default for `List[str]` selection fields), `source="base_model"`, `required` derived from whether the field is `Optional[...]`, `field_type` inferred via `_infer_field_type`, and `options`/`multiple` set for selection-type fields.

The placeholder's `entity` dict SHALL contain `tenant_id` set to the caller-provided `tenant_id`, and (for list-type entities) an auto-generated UUID for the `<entity_type>_id` field — identical to today's behavior when `_map_entity_list` processes an empty dict.

#### Scenario: Placeholder STUDENT has all Student base fields with value=None

- **GIVEN** `raw.students` is empty
- **WHEN** `mapper.map_extraction(raw, tenant_id="t1", filename="f.pdf")` runs
- **AND** the placeholder `STUDENT` `EntityResult` is located in the output
- **THEN** every base field declared on `Student` (excluding `tenant_id`, `entity_type`, `custom_fields`) SHALL appear in the placeholder's `field_mappings`
- **AND** each non-selection mapping's `value` SHALL be `None`
- **AND** each mapping's `source` SHALL equal `"base_model"`
- **AND** each selection-type mapping (e.g., `grade_level`, `gender`, `status`) SHALL carry its `options` list from the Pydantic field default

#### Scenario: Placeholder list-entity gets tenant_id and a UUID id

- **GIVEN** `raw.families` is empty and `tenant_id == "t1"`
- **WHEN** `mapper.map_extraction(...)` runs
- **AND** the placeholder `FAMILY` `EntityResult` is located
- **THEN** the placeholder's `entity` dict SHALL contain `tenant_id == "t1"`
- **AND** the placeholder's `entity` dict SHALL contain a non-empty `family_id` (auto-generated)

#### Scenario: Placeholder TENANT does not get a UUID overwrite of tenant_id

- **GIVEN** `raw.tenant` is `None`
- **WHEN** `mapper.map_extraction(raw, tenant_id="t1", filename="f.pdf")` runs
- **AND** the placeholder `TENANT` `EntityResult` is located
- **THEN** the placeholder's `entity` dict SHALL contain `tenant_id == "t1"` (the caller-provided value)
- **AND** the placeholder's `tenant_id` SHALL NOT be overwritten with an 8-character UUID slice (no other `<entity_type>_id` field exists for tenant — `tenant_id` is the entity id itself, and `_map_entity_list`'s UUID-generation step is gated on `not data.get(id_field)` which is False because `tenant_id` was set just above the gate)

### Requirement: AI-extracted entities SHALL retain today's per-type consolidation behavior

When the AI returns one or more entities of the same type, `mapper.map_extraction` SHALL invoke `_consolidate_entities` exactly as today, producing one `EntityResult` per extracted entity type. Placeholders SHALL only be added for types not produced by the consolidation step. Placeholders SHALL NOT be consolidated with extracted entities (the placeholder is added only when no extracted entity exists for that type).

#### Scenario: Three extracted students consolidate into one STUDENT EntityResult; no placeholder added for STUDENT

- **GIVEN** `raw.students = [{"first_name": "A"}, {"first_name": "B"}, {"first_name": "C"}]`
- **WHEN** `mapper.map_extraction(...)` runs
- **THEN** `entities` SHALL contain exactly one `EntityResult` with `entity_type == "STUDENT"`
- **AND** that STUDENT's `field_mappings` SHALL be the consolidated union of the three input entities (per existing `_consolidate_entities` behavior)
- **AND** no placeholder STUDENT SHALL be added

### Requirement: Coverage backstop SHALL iterate ENTITY_CLASSES as the source of truth

The placeholder-injection step SHALL iterate `ENTITY_CLASSES.items()` to determine which entity types are canonical. It SHALL NOT iterate `entity_list_map` alone. This guarantees that any entity type declared in `ENTITY_CLASSES` but not present in `entity_list_map` (currently `attendance`) still receives a placeholder.

#### Scenario: Attendance placeholder is added even though raw has no attendances field

- **GIVEN** `raw = RawExtraction()` (no `attendances` field exists on `RawExtraction`)
- **WHEN** `mapper.map_extraction(...)` runs
- **THEN** `entities` SHALL contain exactly one `EntityResult` with `entity_type == "ATTENDANCE"`
- **AND** that ATTENDANCE entity SHALL be a placeholder with base-model field_mappings (per the "Placeholder shape" requirement)

#### Scenario: Future entity added to ENTITY_CLASSES automatically gets coverage

- **GIVEN** a hypothetical future entity type `FOO` is added to `ENTITY_CLASSES` but not to `entity_list_map` or `RawExtraction`
- **WHEN** `mapper.map_extraction(...)` runs
- **THEN** `entities` SHALL contain a placeholder `EntityResult` with `entity_type == "FOO"`

This scenario is for documentation only — it does not require a test. The backstop's loop over `ENTITY_CLASSES.items()` provides this guarantee by construction.
