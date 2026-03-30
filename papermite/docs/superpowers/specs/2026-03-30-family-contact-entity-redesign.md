# Family & Contact Entity Redesign

## Summary

Replace Guardian, EmergencyContact, and MedicalContact with two new entities: **Family** (household/billing unit) and **Contact** (unified contact with role-based differentiation). This simplifies the entity model, keeps all fields flat and Arrow-queryable, and cleanly separates household grouping from per-student contact relationships.

## Motivation

- Guardian, EmergencyContact, and MedicalContact are structurally similar (name, phone, email, relationship) but modeled inconsistently — Guardian is a BaseEntity while the other two are plain BaseModels.
- Emergency and medical contacts are per-student, not per-family, because siblings in the same household may have different contacts.
- Guardians are also per-student (blended families).
- A household grouping entity (Family) is needed for administrative/billing purposes and "see everyone at a glance."
- All fields must be flat scalars for Arrow/LanceDB queryability — no list-contains queries.

## Entity Model

### Family (BaseEntity) — NEW

Represents a household. Primary purpose is administrative grouping and billing.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| family_id | str | yes | Generated identifier |
| family_name | str | yes | e.g. "Smith Household" |
| address | Address | no | Shared household address |
| primary_email | EmailStr | no | Household contact email |
| primary_phone | str | no | Household contact phone |

### Contact (BaseEntity) — NEW

Replaces Guardian, EmergencyContact, and MedicalContact. One record per student-contact association. If the same person is a contact for multiple students, there is one Contact record per student.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| contact_id | str | yes | Generated identifier; shared across duplicates for the same person |
| family_id | str | yes | Links to household |
| student_id | str | yes | Links to student — one record per association |
| first_name | str | yes | |
| last_name | str | yes | |
| email | EmailStr | no | |
| phone | str | no | |
| relationship | str | no | e.g. "mother", "father", "uncle" |
| role | str (selection) | yes | guardian \| emergency_contact \| medical_contact |
| clinic_name | str | no | Only relevant for medical_contact role |

**Queryability:** All fields are flat scalars. Common queries:
- `WHERE student_id = 'X'` — all contacts for a student
- `WHERE family_id = 'Y'` — all contacts in a household
- `WHERE role = 'guardian' AND student_id = 'X'` — guardians for a student

**Deduplication:** When the same person (same `contact_id`) appears as a contact for multiple students, downstream apps (datacore) handle sync on update by propagating changes across records sharing the same `contact_id`.

### Student (BaseEntity) — MODIFIED

Remove `guardian_ids`. Add `family_id`.

| Change | Detail |
|--------|--------|
| Add `family_id: str` | Links student to household |
| Remove `guardian_ids: List[str]` | Guardian relationships now live on Contact entity |

All other Student fields remain unchanged.

### RegistrationApplication (BaseEntity) — MODIFIED

| Change | Detail |
|--------|--------|
| Remove `guardians: List[Guardian]` | Replaced by contacts |
| Remove `emergency_contacts: List[EmergencyContact]` | Merged into Contact |
| Remove `medical_contacts: List[MedicalContact]` | Merged into Contact |
| Remove `program_id: str` | Student-program associations handled by Enrollment records |
| Remove `program_name: str` | Student-program associations handled by Enrollment records |
| Add `family: Optional[Family]` | Household info |
| Add `contacts: List[Contact]` | All contacts for this application |

### Removed Entities

- **Guardian** — replaced by Contact with `role = "guardian"`
- **EmergencyContact** — replaced by Contact with `role = "emergency_contact"`
- **MedicalContact** — replaced by Contact with `role = "medical_contact"`

### Unchanged Entities

Program, Enrollment, Attendance, Tenant — no changes.

Note: Multiple program selection per student is handled by creating multiple Enrollment records (one per student-program pair). This keeps queries flat:
- `WHERE student_id = 'X'` — all programs for a student
- `WHERE program_id = 'Y'` — all students in a program

## Impact Areas

### Backend

1. **`app/models/domain.py`**
   - Add `Family` class (BaseEntity)
   - Add `Contact` class (BaseEntity)
   - Remove `Guardian` class
   - Remove `EmergencyContact` class
   - Remove `MedicalContact` class
   - Update `Student`: add `family_id`, remove `guardian_ids`
   - Update `RegistrationApplication`: replace `guardians`/`emergency_contacts`/`medical_contacts` with `family`/`contacts`; remove `program_id`/`program_name`
   - Update `ENTITY_CLASSES`: add `family`/`contact`, remove `guardian`

2. **`app/models/extraction.py`**
   - `RawExtraction`: replace `guardians`, `emergency_contacts`, `medical_contacts` with `families` and `contacts`

3. **`app/services/extractor.py`**
   - No code changes needed — prompt auto-generates from `ENTITY_CLASSES` via `_schema_context()`

4. **`app/services/mapper.py`**
   - Remove imports of `Guardian`, `EmergencyContact`, `MedicalContact`
   - Remove special-case mapping for emergency/medical contacts (lines 221-227)
   - Add `family` and `contact` to `entity_list_map`
   - All entity types now go through the standard `_map_entity_list` path

### Frontend

5. **`EntityCard.tsx`**
   - Remove color entries for `GUARDIAN`, `EMERGENCY_CONTACT`, `MEDICAL_CONTACT`
   - Add color entries for `FAMILY`, `CONTACT`

6. **`FinalizedPage.tsx`**
   - Update sample data generation: `guardian_id` → `contact_id`, add `family_id` samples

### Existing Data

- Any existing model definitions in LanceDB that reference GUARDIAN, EMERGENCY_CONTACT, or MEDICAL_CONTACT entity types will not match the new schema. Tenants will need to re-upload/re-extract documents to get the new entity structure.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Flat `student_id` on Contact (not `student_ids` list) | Arrow can't efficiently query "list contains value." One record per association keeps all fields as flat scalars. |
| Contact duplication across students | Tradeoff: minor data duplication for full Arrow queryability. Downstream apps use `contact_id` to sync updates across duplicates. |
| Emergency/medical as Contact roles, not Student fields | Avoids numbered suffixes (`emergency_contact_1_name`) and supports variable number of contacts without schema changes. |
| Guardian as Contact role, not own entity | Same flat structure as emergency/medical. Consistent model. Per-student relationship via `student_id`. |
| Family as household grouping | Administrative/billing unit. Shared address and account. Secondary benefit: see all household members at a glance. |
| Datacore handles contact deduplication/sync | Papermite defines schema only. Aggregation and sync logic belongs in the data layer, not the ingestion gateway. |
| Remove program fields from RegistrationApplication | Student-program associations handled by Enrollment records (flat `student_id` + `program_id`). Supports multiple programs per student with bidirectional Arrow queries. |
