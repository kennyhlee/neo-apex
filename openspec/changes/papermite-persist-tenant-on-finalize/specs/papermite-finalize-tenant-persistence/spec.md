## ADDED Requirements

### Requirement: Finalize SHALL persist values from the extracted TENANT entity's field_mappings to DataCore's tenants table

When Papermite's `POST /api/tenants/{tenant_id}/finalize/commit` is invoked with an `ExtractionResult` whose `entities` list contains an entity with `entity_type == "TENANT"` AND whose `field_mappings` contains at least one mapping with a non-empty value (where "non-empty" means: not `None` and not an empty/whitespace-only string), the endpoint SHALL — after a successful model-definition write — persist values from that entity to DataCore's tenants table by issuing `PUT /api/tenants/{tenant_id}` to DataCore with a body shaped `{"base_data": <merged-base>, "custom_fields": <merged-custom>}`.

Extracted values SHALL be sourced from `field_mappings`, classified by the mapping's `source` field:
- Mappings with `source == "base_model"` and non-empty `value` form `extracted_base`.
- Mappings with `source == "custom_field"` and non-empty `value` form `extracted_custom`.

The merged payload SHALL be computed using the merge policy defined in the "Merge policy" requirement below, applied independently to base and custom buckets.

#### Scenario: Extraction provides base and custom fields; DataCore has no active tenant row

- **GIVEN** the `TENANT` entity's `field_mappings` contains `(field_name="name", value="Acme", source="base_model")` and `(field_name="school_district_code", value="DC-100", source="custom_field")`
- **AND** DataCore returns no active tenant row for `t1`
- **WHEN** finalize is called
- **THEN** Papermite SHALL issue `PUT /api/tenants/t1` to DataCore with body `{"base_data": {"name": "Acme"}, "custom_fields": {"school_district_code": "DC-100"}}`
- **AND** finalize SHALL return its existing 200 success response

#### Scenario: Extraction provides base and custom fields; DataCore has existing values for both

- **GIVEN** the `TENANT` entity's `field_mappings` contains `(field_name="name", value="Acme Extracted", source="base_model")` and `(field_name="accreditation_id", value="ACC-42", source="custom_field")`
- **AND** the active DataCore tenant row's flattened columns include `name="User Typed Name"` and `accreditation_id=None`
- **WHEN** finalize is called
- **THEN** Papermite SHALL issue `PUT /api/tenants/t1` to DataCore where the merged `base_data` contains `name="User Typed Name"` and the merged `custom_fields` contains `accreditation_id="ACC-42"`
- **AND** finalize SHALL return its existing 200 success response

#### Scenario: Mappings whose value is None or empty/whitespace are excluded from the extracted payload

- **GIVEN** the `TENANT` entity's `field_mappings` contains `(field_name="name", value="Acme", source="base_model")`, `(field_name="contact_phone", value=None, source="base_model")`, `(field_name="display_name", value="   ", source="base_model")`, and `(field_name="notes", value="", source="base_model")`
- **WHEN** finalize computes `extracted_base`
- **THEN** `extracted_base` SHALL contain `{"name": "Acme"}` only
- **AND** the keys `contact_phone`, `display_name`, and `notes` SHALL NOT appear in the PUT body's `base_data`

### Requirement: Merge policy SHALL fill only empty-or-null fields; existing values SHALL be preserved

When building the merged `base_data` and merged `custom_fields` for the tenant write, Papermite SHALL, for each `(field_name, extracted_value)` pair in `extracted_base` (and likewise for `extracted_custom`), include `extracted_value` in the corresponding merged bucket only if the existing value for that field name is **absent, `None`, or an empty/whitespace-only string**. All other existing field values SHALL be preserved unchanged.

Existing values are read from the flattened columns returned by `POST /api/query` and cleaned by dropping internal columns (`_status`, `_version`, `_created_at`, `_updated_at`, `_change_id`, `entity_type`, `entity_id`, `base_data`, `custom_fields`, `vector`), any column whose name starts with `_`, and any column whose value is `None`. The cleaned columns are split into "existing base" vs "existing custom" by membership in `app.models.domain.Tenant.model_fields` (excluding system fields). The merge is applied independently within each bucket. Fields present in an existing bucket but absent from the corresponding extracted bucket SHALL be preserved unchanged in the merged result.

Note: `POST /api/query` stringifies all values (a `False` in storage comes back as `"False"`, a `0` as `"0"`). This requirement treats non-empty strings — including `"False"`, `"0"`, and `"[]"` — as **existing non-empty values** that are preserved. Only `None` and empty/whitespace strings are overwritten.

#### Scenario: Existing non-empty base value is preserved over extracted base value

- **GIVEN** `existing_base["display_name"] == "My Custom School Name"`
- **AND** `extracted_base["display_name"] == "Acme School District"`
- **WHEN** finalize merges and writes
- **THEN** the merged `base_data` SHALL contain `display_name == "My Custom School Name"`

#### Scenario: Existing base field with empty string is overwritten by extracted value

- **GIVEN** `existing_base["contact_phone"] == ""`
- **AND** `extracted_base["contact_phone"] == "555-0100"`
- **WHEN** finalize merges and writes
- **THEN** the merged `base_data` SHALL contain `contact_phone == "555-0100"`

#### Scenario: Existing base field with whitespace-only string is overwritten by extracted value

- **GIVEN** `existing_base["contact_email"] == "   "`
- **AND** `extracted_base["contact_email"] == "info@acme.edu"`
- **WHEN** finalize merges and writes
- **THEN** the merged `base_data` SHALL contain `contact_email == "info@acme.edu"`

#### Scenario: Stringified-False from DataCore is treated as non-empty and preserved

- **GIVEN** `existing_base["accepts_paper_applications"] == "False"` (a string, because query flattening stringifies)
- **AND** `extracted_base["accepts_paper_applications"] == True`
- **WHEN** finalize merges and writes
- **THEN** the merged `base_data` SHALL contain `accepts_paper_applications == "False"`

#### Scenario: Custom-field bucket merges independently from base-field bucket

- **GIVEN** `existing_custom["accreditation_id"] == ""` and `existing_custom["school_district_code"] == "DC-100"`
- **AND** `extracted_custom["accreditation_id"] == "ACC-42"` and `extracted_custom["school_district_code"] == "DC-999"`
- **WHEN** finalize merges and writes
- **THEN** the merged `custom_fields` SHALL contain `accreditation_id == "ACC-42"` (filled) and `school_district_code == "DC-100"` (preserved)

#### Scenario: Existing fields absent from extraction are preserved in the merged payload

- **GIVEN** `existing_base["notes"] == "do not contact between 9pm-7am"` and `extracted_base` has no `notes` key
- **AND** `existing_custom["legacy_marker"] == "v1"` and `extracted_custom` has no `legacy_marker` key
- **WHEN** finalize merges and writes
- **THEN** the merged `base_data` SHALL contain `notes == "do not contact between 9pm-7am"`
- **AND** the merged `custom_fields` SHALL contain `legacy_marker == "v1"`

### Requirement: Existing-row classification SHALL discriminate base vs custom via Tenant.model_fields

When splitting the cleaned existing-row columns into `existing_base` and `existing_custom`, Papermite SHALL use `app.models.domain.Tenant.model_fields` as the discriminator. A cleaned column whose key is in `Tenant.model_fields` (excluding the system field names `tenant_id`, `entity_type`, `custom_fields`) goes to `existing_base`. Every other cleaned column goes to `existing_custom`. Papermite SHALL NOT decode the raw `base_data` or `custom_fields` TOON columns; classification operates on the flattened-column view only.

#### Scenario: A canonical Tenant base field is classified as existing_base

- **GIVEN** the cleaned existing-row dict contains `{"name": "Acme", "contact_email": "a@x.com"}`
- **AND** both `name` and `contact_email` are keys in `Tenant.model_fields`
- **WHEN** finalize splits the dict
- **THEN** `existing_base` SHALL contain both `name` and `contact_email`
- **AND** `existing_custom` SHALL NOT contain either

#### Scenario: A non-canonical key is classified as existing_custom

- **GIVEN** the cleaned existing-row dict contains `{"name": "Acme", "school_district_code": "DC-100"}`
- **AND** `school_district_code` is NOT a key in `Tenant.model_fields`
- **WHEN** finalize splits the dict
- **THEN** `existing_base` SHALL contain `name` only
- **AND** `existing_custom` SHALL contain `school_district_code` only

### Requirement: Tenant write SHALL be skipped silently when extraction has no usable tenant data

If the `ExtractionResult` contains no entity with `entity_type == "TENANT"`, OR if the `TENANT` entity exists but `extracted_base` and `extracted_custom` are both empty dicts after applying the non-empty filter, finalize SHALL NOT issue any tenant read or write to DataCore. The model-definition write SHALL still execute, and finalize SHALL return its existing 200 success response. No error SHALL be raised for this case.

#### Scenario: Extraction has no TENANT entity

- **GIVEN** an `ExtractionResult` whose `entities` list contains only `STUDENT` and `FAMILY` entities
- **WHEN** finalize is called
- **THEN** Papermite SHALL NOT call `POST /api/query` on DataCore for the tenants table
- **AND** Papermite SHALL NOT call `PUT /api/tenants/t1` on DataCore
- **AND** finalize SHALL return its existing 200 success response

#### Scenario: TENANT entity present but every mapping value is None or empty

- **GIVEN** a `TENANT` entity whose `field_mappings` contains base-model entries for `name`, `display_name`, `contact_email`, `contact_phone` all with `value=None`, plus `display_name` with `value="   "`, and no custom-field mappings
- **WHEN** finalize is called
- **THEN** Papermite SHALL NOT call `POST /api/query` on DataCore for the tenants table
- **AND** Papermite SHALL NOT call `PUT /api/tenants/t1` on DataCore
- **AND** finalize SHALL return its existing 200 success response

### Requirement: Tenant-write failure SHALL surface as HTTP 502 without rolling back the model write

If the tenant read (`POST /api/query`) or the tenant write (`PUT /api/tenants/{tenant_id}`) returns a non-2xx status, or raises a network error, Papermite SHALL raise an HTTP 502 response with a clear detail message indicating the tenant persistence failed. The previously-successful model-definition write SHALL NOT be rolled back or archived as a result. The error path SHALL execute only after the model write has succeeded; failures during the model write SHALL behave exactly as today (no tenant work attempted).

#### Scenario: DataCore returns 500 from PUT /api/tenants/{tenant_id}

- **GIVEN** the model-definition write succeeded
- **AND** the subsequent `PUT /api/tenants/t1` returns status 500
- **WHEN** finalize processes the response
- **THEN** finalize SHALL raise `HTTPException(status_code=502, detail="Failed to persist tenant from extraction")`
- **AND** the model row written earlier SHALL remain active in DataCore (no compensating delete)

#### Scenario: DataCore /api/query is unreachable

- **GIVEN** the model-definition write succeeded
- **AND** the subsequent `POST /api/query` raises a connection error
- **WHEN** finalize attempts the tenant read
- **THEN** finalize SHALL raise `HTTPException(status_code=502, detail="Failed to persist tenant from extraction")`
- **AND** the model row SHALL remain active in DataCore

#### Scenario: Model-definition write fails — no tenant work is attempted

- **GIVEN** the `PUT /api/models/t1` call returns a non-2xx status
- **WHEN** finalize processes that response
- **THEN** finalize SHALL raise the same HTTPException as today (matching pre-change behavior)
- **AND** Papermite SHALL NOT issue any tenant read or write to DataCore
