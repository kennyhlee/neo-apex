## ADDED Requirements

### Requirement: Unified TOON encoding for entity data
The datacore Store SHALL encode both `base_data` and `custom_fields` using TOON serialization.

#### Scenario: Entity stored with TOON encoding
- **WHEN** `put_entity()` is called with `base_data` and `custom_fields`
- **THEN** both are serialized using `toon.encode()` before storage

#### Scenario: Entity read with TOON decoding
- **WHEN** `get_active_entity()` reads a stored entity
- **THEN** both `base_data` and `custom_fields` are deserialized using `toon.decode()`

#### Scenario: Entity history read with TOON decoding
- **WHEN** `get_entity_history()` reads stored entity versions
- **THEN** both `base_data` and `custom_fields` are deserialized using `toon.decode()` for each version

### Requirement: Rename _custom_fields to custom_fields
The `_custom_fields` column SHALL be renamed to `custom_fields` in the entities schema, as it contains user data, not system metadata.

#### Scenario: Schema uses custom_fields
- **WHEN** the `ENTITIES_SCHEMA` is defined
- **THEN** the column is named `custom_fields` (without underscore prefix)

#### Scenario: Store methods use custom_fields
- **WHEN** `put_entity()`, `get_active_entity()`, or `get_entity_history()` reference the custom fields column
- **THEN** they use the column name `custom_fields`

### Requirement: QueryEngine flattens both TOON columns
The QueryEngine SHALL decode TOON for both `base_data` and `custom_fields` when flattening entity data into Arrow columns for DuckDB querying.

#### Scenario: QueryEngine processes entities table
- **WHEN** the QueryEngine processes an entities table for a DuckDB query
- **THEN** both `base_data` and `custom_fields` are decoded from TOON and flattened into individual Arrow columns

#### Scenario: Flattening method renamed
- **WHEN** the QueryEngine flattens a TOON-encoded column
- **THEN** it uses a method named `_flatten_toon_column()` (renamed from `_flatten_json_column()`)
