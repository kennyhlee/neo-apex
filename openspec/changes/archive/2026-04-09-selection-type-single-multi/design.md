## Context

Selection-type fields in entity models already have a `multiple` boolean property in `FieldDefinition`, but it's not consistently set or respected. The mapper in Papermite infers `multiple` from the data shape during extraction rather than from an explicit model declaration. The AdminDash `DynamicForm` already branches on `field.multiple` — rendering checkboxes when true and a `<select>` dropdown when false. However, single-select currently uses a dropdown, not radio buttons, and there's no way for model definition editors to explicitly control cardinality.

The Student domain model (`papermite/backend/app/models/domain.py`) defines grade_level, gender, and status as `List[str]` fields with default option lists, but the mapper sometimes sets `multiple=false` for base model fields. The behavior is inconsistent and implicit. There is no way to declare selection cardinality at the domain model level — `List[str]` is used for both single and multi-select fields.

## Goals / Non-Goals

**Goals:**
- Make `multiple` an explicit, first-class property in model definitions that editors can set
- Render radio buttons for single-select fields and checkboxes for multi-select fields across all frontends (AdminDash, Launchpad, Papermite)
- Set correct defaults for Student fields: grade_level, gender, status → single-select
- Ensure data format consistency: single-select stores a string, multi-select stores a JSON array

**Non-Goals:**
- Changing the DataCore storage schema or API — `FieldDefinition` already supports `multiple`
- Adding validation that enforces cardinality at the API level (future work)
- Migrating existing stored entity data — existing data will be handled gracefully by the UI
- Searchable/filterable dropdowns or combobox patterns

## Decisions

### 1. Radio buttons for single-select, checkboxes for multi-select

**Decision**: Replace the current `<select>` dropdown for single-select with radio button groups. Keep checkboxes for multi-select.

**Rationale**: Radio buttons make all options visible at once, which is better for short option lists (gender, status, grade level). Dropdowns hide options behind a click. Since entity model selection fields typically have fewer than 10 options, radio buttons are the better UX. If a field has many options (>10), the form already scrolls — this is acceptable for the current use case.

**Alternative considered**: Keep dropdown for single-select, add radio as a separate type. Rejected because it adds unnecessary complexity — the `multiple` flag is sufficient to determine rendering.

### 2. `json_schema_extra` for multi-select, single implied by default

**Decision**: Use Pydantic's `json_schema_extra` on `Field()` to mark multi-select fields. Single-select is the default — no annotation needed.

```python
# Multi-select: explicit annotation
days_of_week: List[str] = Field(
    default_factory=lambda: ["Mon", "Tue", ...],
    json_schema_extra={"multiple": True},
)

# Single-select: no annotation needed (implied)
grade_level: List[str] = Field(
    default_factory=lambda: ["TK", "Kinder", ...],
)
```

**Rationale**: Zero mapper refactoring — the annotation stays `List[str]`, so existing `model_field.annotation is List[str]` identity checks (lines 121 and 166) continue to work. The mapper just adds one line to read `json_schema_extra.get("multiple", False)`. Only multi-select fields need annotation since they're the exception, not the rule.

**Alternative considered**: Custom `Annotated` types (`SingleSelect`/`MultiSelect`) — cleaner type signatures but breaks the mapper's `is List[str]` checks, requiring a refactor of both detection points with `get_origin`/`get_args` unwrapping.

### 3. Default `multiple` to `false`

**Decision**: When `multiple` is not explicitly set in a field definition, default to `false` (single-select).

**Rationale**: Most selection fields in practice are single-select (gender, status, grade level, etc.). Multi-select is the exception (days of week, tags). Defaulting to single-select is safer — a user selecting one value from a single-select field is correct behavior, while a multi-select field that should be single-select allows invalid data.

### 4. Toggle in Papermite model editor

**Decision**: Add a "Allow multiple selections" checkbox toggle in the `OptionsEditor` component of Papermite's `FieldRow.tsx`. This lets model definition editors explicitly control cardinality per field.

**Rationale**: The model editor is where field definitions are configured. This is the natural place to expose the `multiple` toggle. The toggle already conceptually exists in the data model — this just surfaces it in the UI.

### 5. Handle legacy data gracefully

**Decision**: When a single-select field encounters a JSON array value (from before this change), display the first element. When a multi-select field encounters a plain string, treat it as a single-element array.

**Rationale**: Avoids the need for a data migration. Existing entities may have array values for fields that are now single-select. The UI should degrade gracefully rather than break.

## Risks / Trade-offs

- **Risk**: Radio buttons take more vertical space than a dropdown → **Mitigation**: For fields with many options, the extra space is acceptable since entity forms already scroll. Could add a threshold (e.g., >8 options falls back to dropdown) as future enhancement if needed.
- **Risk**: Changing default from implicit multi to explicit single could surprise users editing existing models → **Mitigation**: The Papermite model editor toggle makes cardinality visible and editable. Existing model definitions that already have `multiple: true` won't be affected.
- **Risk**: Inconsistent data format between old multi-select arrays and new single-select strings → **Mitigation**: Decision #4 handles graceful degradation in both directions.
- **Risk**: Consolidator in `_consolidate_entities()` (mapper.py:260) forces `multiple=True` when merging selection options from duplicate entities, overriding domain model cardinality → **Mitigation**: Fix the consolidator to preserve the original `multiple` value from the first mapping instead of hardcoding `True`.
