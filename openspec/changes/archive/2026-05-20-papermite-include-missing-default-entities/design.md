## Context

`mapper.map_extraction(raw, tenant_id, filename)` at `papermite/backend/app/services/mapper.py:267-299` builds the `ExtractionResult.entities` list. The current logic:

```python
if raw.tenant:
    data, mappings = _map_entity(raw.tenant, ENTITY_CLASSES["tenant"])
    data.setdefault("tenant_id", tenant_id)
    entities.append(EntityResult(entity_type="TENANT", entity=data, field_mappings=mappings))

entity_list_map = {"program": raw.programs, "student": raw.students, ...}
for entity_type, raw_list in entity_list_map.items():
    if raw_list:
        entities.extend(_map_entity_list(raw_list, entity_type, ENTITY_CLASSES[entity_type], tenant_id))

entities = _consolidate_entities(entities)
```

Two relevant existing behaviors:

1. **`_map_entity({}, model_class)` returns a fully-populated placeholder.** When called with an empty raw dict, the iteration `for key, value in raw.items()` is a no-op, but the "ensure ALL base model fields appear" loop (mapper.py lines 159-200) then populates `base_data` with `None` and `field_mappings` with one entry per base model field (with `value=None`, `source="base_model"`, `required` derived from `Optional[]` annotations, type inferred from name). This is exactly the placeholder shape the user wants.

2. **`_map_entity_list([{}], entity_type, model_class, tenant_id)` returns a single placeholder `EntityResult`.** It calls `_map_entity({}, model_class)` for the empty dict, then sets `tenant_id` and auto-generates a UUID for the `<entity_type>_id` field. One placeholder per empty input dict.

Today's guards (`if raw.tenant`, `if raw_list:`) skip these calls when the AI returned nothing, producing the missing-entity bug.

`_consolidate_entities` (mapper.py:230-264) merges multiple `EntityResult`s of the same type into one (union of field names, merged selection options). It is invoked after the extraction loop. Placeholders interact with it cleanly: a placeholder's field_mappings are a strict subset (just base fields) and would simply be the sole entry for its type when the AI extracted nothing.

`ENTITY_CLASSES` (`papermite/backend/app/models/domain.py:165-173`) maps the 8 canonical entity types — `tenant`, `program`, `student`, `family`, `contact`, `enrollment`, `attendance`, `registration_application` — to their Pydantic classes. The mapper today builds `entity_list_map` with 6 of these and treats `tenant` separately. **`attendance` is currently missing from `entity_list_map`** — see Decision below.

## Goals / Non-Goals

**Goals:**
- After this change, `mapper.map_extraction` returns an `entities` list containing exactly one `EntityResult` per entity type in `ENTITY_CLASSES`, every time.
- The Papermite review UI shows every canonical entity type as a card the user can edit before finalize, with sensible default base fields.
- Downstream consumers (`_build_model_definition`, Launchpad's `get_model`, admindash) see a complete model schema regardless of source-document content.

**Non-Goals:**
- No new entity types added to `ENTITY_CLASSES`. The set of "default" entities is exactly what the Pydantic schema declares today.
- No change to `_build_model_definition` — it already iterates `extraction.entities` correctly.
- No change to the review UI — empty-base-field entities already render today.
- Not addressing the pre-existing inconsistency that `attendance` is in `ENTITY_CLASSES` but absent from `raw` extraction fields. This change uses `ENTITY_CLASSES` as the source of truth and includes `attendance` placeholders for consistency.
- Not deduplicating against the user's intent — if AI extracts an entity AND a placeholder would have been added for the same type, the AI version wins (already true via the guard order).

## Decisions

### Decision: Drive coverage from `ENTITY_CLASSES`, not from `entity_list_map`

The mapper currently has two sources of "what entity types matter":
- `entity_list_map` in `map_extraction` — 6 list types.
- `ENTITY_CLASSES` in `domain.py` — 8 types (includes `tenant` and `attendance`).

After this change, the placeholder-coverage loop SHALL iterate `ENTITY_CLASSES.keys()` and produce a placeholder for every entry not already represented in `entities`. Rationale: `ENTITY_CLASSES` is the canonical source of truth for "what entity types exist in NeoApex." The `entity_list_map` is an implementation detail of how the AI's `RawExtraction` shape gets unpacked.

**Implication:** `attendance` will get a placeholder card even though the existing extraction path never produces a real `ATTENDANCE` entity. The placeholder is harmless (one empty card, base fields only) and it makes the model definition canonical.

### Decision: Add a single coverage backstop after consolidation; leave existing extraction guards in place

Implementation shape — keep the current tenant singleton path and list loop unchanged. Add ONE new block immediately after `entities = _consolidate_entities(entities)`:

```python
# Coverage backstop: every entity type in ENTITY_CLASSES must be present.
existing_types = {e.entity_type.lower() for e in entities}
for entity_type, model_class in ENTITY_CLASSES.items():
    if entity_type in existing_types:
        continue
    entities.extend(_map_entity_list([{}], entity_type, model_class, tenant_id))
```

**Why a single backstop, not three edit points:** `_map_entity_list([{}], entity_type, model_class, tenant_id)` produces the correct placeholder for every entity type, including TENANT. Internally:
1. `_map_entity({}, model_class)` populates all base fields via the existing "ensure ALL base model fields appear" loop (mapper.py:159-200), yielding a `data` dict and `field_mappings` whose values are `None` (or Pydantic defaults for List[str] / Enum fields).
2. `_map_entity_list` then sets `data.setdefault("tenant_id", tenant_id)` AND auto-generates a UUID for the `<entity_type>_id` field only when `data.get(id_field)` is falsy. For TENANT, `id_field == "tenant_id"` and `data["tenant_id"]` was just set in the line above — so the UUID step is skipped. For other entities (student, family, …), the `<entity_type>_id` field was populated as `None` by `_map_entity` and so the UUID step runs, producing a placeholder id consistent with how the existing list path already auto-generates ids for AI-extracted entities missing an id.
3. The returned `EntityResult` has `entity_type=entity_type.upper()`, matching the casing of TENANT, STUDENT, etc.

Net effect: placeholder TENANT carries `tenant_id` and no extra UUID; placeholder STUDENT/FAMILY/etc. carry `tenant_id` + a UUID `<entity_type>_id`. All identical to how `_map_entity_list` handles AI-extracted entities today.

**Alternatives considered:**
- *Change the existing tenant singleton guard (`if raw.tenant:`) and list-loop guard (`if raw_list:`) to provide empty defaults instead.* Three edit points doing what one backstop accomplishes. Rejected — minimum code.
- *Add `attendance` to `entity_list_map` and a corresponding field to `RawExtraction`.* Out of scope — extraction-shape changes belong in a separate change.
- *Only iterate `entity_list_map` for the backstop.* Misses `attendance` and any future addition to `ENTITY_CLASSES`. Rejected.

### Decision: Placeholder UUID for list-entity ids is fine

`_map_entity_list` auto-generates a UUID for the `<entity_type>_id` field when the entity has no id. For placeholders, the generated UUID is essentially throwaway data (model_definition cares only about field schema, not values). It does no harm and keeps the mapper code path uniform between real and placeholder entities.

No special-case handling for placeholders — they look identical to "AI extracted an entity but provided no id" today.

### Decision: TENANT is covered by the same backstop as every other type

The `TENANT` entity SHALL appear in `entities` every time. When `raw.tenant` exists, today's singleton path (`if raw.tenant: ... _map_entity(raw.tenant, ENTITY_CLASSES["tenant"])`) handles it. When `raw.tenant` is missing, the backstop produces the placeholder via `_map_entity_list([{}], "tenant", Tenant, tenant_id)`. The placeholder's `tenant_id` is set to the caller-provided value (via `setdefault` before the UUID check), so no UUID overwrite happens — TENANT placeholders never have an auto-generated stub id.

## Risks / Trade-offs

- **`attendance` placeholder appears even though the existing AI flow never produces one** → A new empty card in the review UI for an entity the user may not need. Mitigation accepted: this matches the user's stated request ("model should still include the missing entity") and `attendance` is a real entity in NeoApex. If undesired in practice, a follow-up change can prune which entities get placeholders.
- **One extra empty card per missing type could clutter the review UI** → Review UI is already designed to handle multiple entity cards; eight cards is the canonical NeoApex schema and a deliberate decision per the user's request. Mitigation: none required — this is the desired UX.
- **Placeholder `<entity_type>_id` UUIDs go unused** → No observable effect; model_definition does not store entity values. Mitigation: none required.
- **A future addition to `ENTITY_CLASSES` automatically gets a placeholder** → Intended behavior, since `ENTITY_CLASSES` is canonical. Anyone adding a new entity type can rely on the placeholder backstop.

## Migration Plan

- No data migration. The change affects only how `mapper.map_extraction` constructs its output. Previously-finalized model definitions in DataCore are unchanged; the next finalize after this change ships will produce a model that includes all 8 entity types.
- No backward-incompatible API change. The `ExtractionResult` and `EntityResult` shapes are unchanged.
- Rollback: revert the diff in `papermite/backend/app/services/mapper.py`. No other code or data to undo.
