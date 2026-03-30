# Family & Contact Entity Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Guardian, EmergencyContact, and MedicalContact with Family and Contact entities, remove program fields from RegistrationApplication.

**Architecture:** New `Family` and `Contact` BaseEntity classes with flat, Arrow-queryable fields. Contact uses `role` (selection: guardian | emergency_contact | medical_contact) and flat `student_id` for per-student associations. RegistrationApplication drops program fields (handled by Enrollment).

**Tech Stack:** Python/Pydantic (backend models), FastAPI, pytest, React/TypeScript (frontend)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/app/models/domain.py` | Modify | Add Family, Contact; remove Guardian, EmergencyContact, MedicalContact; update Student, RegistrationApplication, ENTITY_CLASSES |
| `backend/app/models/extraction.py` | Modify | Update RawExtraction fields |
| `backend/app/services/mapper.py` | Modify | Remove old entity mapping, add family/contact to standard path |
| `backend/tests/test_domain.py` | Create | Tests for new entity model classes |
| `backend/tests/test_mapper.py` | Create | Tests for mapper with new entity types |
| `frontend/src/components/EntityCard.tsx` | Modify | Update TYPE_COLORS |
| `frontend/src/pages/FinalizedPage.tsx` | Modify | Update sample data generation |

---

### Task 1: Add Family and Contact domain models

**Files:**
- Create: `backend/tests/test_domain.py`
- Modify: `backend/app/models/domain.py`

- [ ] **Step 1: Write tests for Family and Contact entities**

Create `backend/tests/test_domain.py`:

```python
"""Tests for Family and Contact domain entities."""
from app.models.domain import Family, Contact, ENTITY_CLASSES


def test_family_defaults():
    f = Family(family_id="F1", family_name="Smith Household")
    assert f.entity_type == "FAMILY"
    assert f.family_id == "F1"
    assert f.family_name == "Smith Household"
    assert f.primary_email is None
    assert f.primary_phone is None
    assert f.address is None
    assert f.custom_fields == {}


def test_contact_guardian_role():
    c = Contact(
        contact_id="C1",
        family_id="F1",
        student_id="S1",
        first_name="Jane",
        last_name="Smith",
        role="guardian",
    )
    assert c.entity_type == "CONTACT"
    assert c.role == "guardian"
    assert c.student_id == "S1"
    assert c.family_id == "F1"
    assert c.clinic_name is None


def test_contact_medical_role():
    c = Contact(
        contact_id="C2",
        family_id="F1",
        student_id="S1",
        first_name="Dr. Lee",
        last_name="Park",
        role="medical_contact",
        clinic_name="Springfield Pediatrics",
    )
    assert c.role == "medical_contact"
    assert c.clinic_name == "Springfield Pediatrics"


def test_contact_emergency_role():
    c = Contact(
        contact_id="C3",
        family_id="F1",
        student_id="S1",
        first_name="Bob",
        last_name="Smith",
        role="emergency_contact",
        relationship="uncle",
    )
    assert c.role == "emergency_contact"
    assert c.relationship == "uncle"


def test_entity_classes_has_family_and_contact():
    assert "family" in ENTITY_CLASSES
    assert "contact" in ENTITY_CLASSES
    assert ENTITY_CLASSES["family"] is Family
    assert ENTITY_CLASSES["contact"] is Contact


def test_entity_classes_no_guardian():
    assert "guardian" not in ENTITY_CLASSES
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_domain.py -v`
Expected: FAIL — `Family` and `Contact` not defined, `guardian` still in ENTITY_CLASSES

- [ ] **Step 3: Add Family and Contact classes to domain.py**

In `backend/app/models/domain.py`, add after the `Address` class (before `Student`):

```python
class Family(BaseEntity):
    entity_type: str = "FAMILY"
    family_id: str = ""
    family_name: str = ""
    address: Optional[Address] = None
    primary_email: Optional[EmailStr] = None
    primary_phone: Optional[str] = None


class Contact(BaseEntity):
    entity_type: str = "CONTACT"
    contact_id: str = ""
    family_id: str = ""
    student_id: str = ""
    first_name: str = ""
    last_name: str = ""
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    relationship: Optional[str] = None
    role: str = ""
    clinic_name: Optional[str] = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_domain.py -v`
Expected: FAIL — `guardian` still in ENTITY_CLASSES (tests for removal will fail)

- [ ] **Step 5: Commit new entities**

```bash
git add backend/app/models/domain.py backend/tests/test_domain.py
git commit -m "feat: add Family and Contact domain entities"
```

---

### Task 2: Remove Guardian, EmergencyContact, MedicalContact and update Student, RegistrationApplication

**Files:**
- Modify: `backend/app/models/domain.py`
- Modify: `backend/tests/test_domain.py`

- [ ] **Step 1: Add tests for Student and RegistrationApplication changes**

Append to `backend/tests/test_domain.py`:

```python
from app.models.domain import Student, RegistrationApplication


def test_student_has_family_id():
    s = Student(student_id="S1", first_name="Alice", last_name="Smith", family_id="F1")
    assert s.family_id == "F1"


def test_student_no_guardian_ids():
    s = Student(student_id="S1", first_name="Alice", last_name="Smith")
    assert not hasattr(s, "guardian_ids") or "guardian_ids" not in s.model_fields


def test_registration_application_has_contacts():
    ra = RegistrationApplication(application_id="A1", school_year="2025-2026")
    assert hasattr(ra, "contacts")
    assert hasattr(ra, "family")
    assert ra.contacts == []
    assert ra.family is None


def test_registration_application_no_guardians():
    ra = RegistrationApplication(application_id="A1", school_year="2025-2026")
    assert "guardians" not in ra.model_fields
    assert "emergency_contacts" not in ra.model_fields
    assert "medical_contacts" not in ra.model_fields


def test_registration_application_no_program_fields():
    ra = RegistrationApplication(application_id="A1", school_year="2025-2026")
    assert "program_id" not in ra.model_fields
    assert "program_name" not in ra.model_fields
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd backend && python -m pytest tests/test_domain.py -v`
Expected: FAIL — Student still has `guardian_ids`, RegistrationApplication still has old fields

- [ ] **Step 3: Update domain.py — remove old entities, update Student and RegistrationApplication**

In `backend/app/models/domain.py`:

Remove the `Guardian` class entirely (lines 12-19).

Remove the `EmergencyContact` class entirely (lines 73-78).

Remove the `MedicalContact` class entirely (lines 81-86).

Update `Student` — remove `guardian_ids`, add `family_id`:

```python
class Student(BaseEntity):
    entity_type: str = "STUDENT"
    student_id: str = ""
    family_id: str = ""
    first_name: str = ""
    last_name: str = ""
    middle_name: Optional[str] = None
    preferred_name: Optional[str] = None
    dob: Optional[_dt.date] = None
    grade_level: Optional[str] = None
    email: Optional[EmailStr] = None
    gender: Optional[str] = None
    addresses: List[Address] = Field(default_factory=list)
```

Update `RegistrationApplication` — replace guardian/contact lists, remove program fields:

```python
class RegistrationApplication(BaseEntity):
    entity_type: str = "REGAPP"
    application_id: str = ""
    school_year: str = ""
    school_id: Optional[str] = None
    student: Optional[Student] = None
    family: Optional[Family] = None
    contacts: List[Contact] = Field(default_factory=list)
```

Update `ENTITY_CLASSES`:

```python
ENTITY_CLASSES: Dict[str, type[BaseEntity]] = {
    "tenant": Tenant,
    "program": Program,
    "student": Student,
    "family": Family,
    "contact": Contact,
    "enrollment": Enrollment,
    "attendance": Attendance,
    "registration_application": RegistrationApplication,
}
```

- [ ] **Step 4: Run all domain tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_domain.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/domain.py backend/tests/test_domain.py
git commit -m "feat: remove Guardian/EmergencyContact/MedicalContact, update Student and RegistrationApplication"
```

---

### Task 3: Update RawExtraction model

**Files:**
- Modify: `backend/app/models/extraction.py`

- [ ] **Step 1: Update RawExtraction**

In `backend/app/models/extraction.py`, replace the `guardians`, `emergency_contacts`, and `medical_contacts` fields in `RawExtraction`:

```python
class RawExtraction(BaseModel):
    """What the AI returns — dicts so extra fields aren't dropped by Pydantic validation."""
    tenant: Optional[dict[str, Any]] = None
    programs: list[dict[str, Any]] = Field(default_factory=list)
    students: list[dict[str, Any]] = Field(default_factory=list)
    families: list[dict[str, Any]] = Field(default_factory=list)
    contacts: list[dict[str, Any]] = Field(default_factory=list)
    enrollments: list[dict[str, Any]] = Field(default_factory=list)
    registration_applications: list[dict[str, Any]] = Field(default_factory=list)
```

- [ ] **Step 2: Verify no import errors**

Run: `cd backend && python -c "from app.models.extraction import RawExtraction; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/extraction.py
git commit -m "feat: update RawExtraction — replace guardians/emergency/medical with families and contacts"
```

---

### Task 4: Update mapper service

**Files:**
- Create: `backend/tests/test_mapper.py`
- Modify: `backend/app/services/mapper.py`

- [ ] **Step 1: Write mapper tests for new entity types**

Create `backend/tests/test_mapper.py`:

```python
"""Tests for mapper with Family and Contact entity types."""
from app.models.extraction import RawExtraction
from app.services.mapper import map_extraction


def test_map_family():
    raw = RawExtraction(
        families=[{
            "family_name": "Smith Household",
            "primary_email": "smith@example.com",
            "primary_phone": "(555) 111-2222",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    family_entities = [e for e in result.entities if e.entity_type == "FAMILY"]
    assert len(family_entities) == 1
    fam = family_entities[0]
    assert any(m.field_name == "family_name" and m.source == "base_model" for m in fam.field_mappings)
    assert any(m.field_name == "primary_email" for m in fam.field_mappings)


def test_map_contact_guardian():
    raw = RawExtraction(
        contacts=[{
            "first_name": "Jane",
            "last_name": "Smith",
            "role": "guardian",
            "family_id": "F1",
            "student_id": "S1",
            "email": "jane@example.com",
            "relationship": "mother",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    contact_entities = [e for e in result.entities if e.entity_type == "CONTACT"]
    assert len(contact_entities) == 1
    c = contact_entities[0]
    assert any(m.field_name == "role" and m.value == "guardian" for m in c.field_mappings)
    assert any(m.field_name == "student_id" for m in c.field_mappings)


def test_map_contact_medical():
    raw = RawExtraction(
        contacts=[{
            "first_name": "Dr. Lee",
            "last_name": "Park",
            "role": "medical_contact",
            "family_id": "F1",
            "student_id": "S1",
            "clinic_name": "Springfield Pediatrics",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    contact_entities = [e for e in result.entities if e.entity_type == "CONTACT"]
    assert len(contact_entities) == 1
    c = contact_entities[0]
    assert any(m.field_name == "clinic_name" and m.value == "Springfield Pediatrics" for m in c.field_mappings)


def test_map_no_guardian_entity_type():
    """Ensure old GUARDIAN entity type is never produced."""
    raw = RawExtraction(
        contacts=[{
            "first_name": "Jane",
            "last_name": "Smith",
            "role": "guardian",
            "family_id": "F1",
            "student_id": "S1",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    entity_types = {e.entity_type for e in result.entities}
    assert "GUARDIAN" not in entity_types
    assert "EMERGENCY_CONTACT" not in entity_types
    assert "MEDICAL_CONTACT" not in entity_types


def test_map_contact_custom_fields():
    """Extra fields on contact go to custom_fields."""
    raw = RawExtraction(
        contacts=[{
            "first_name": "Jane",
            "last_name": "Smith",
            "role": "guardian",
            "family_id": "F1",
            "student_id": "S1",
            "preferred_language": "Spanish",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    c = [e for e in result.entities if e.entity_type == "CONTACT"][0]
    assert any(m.field_name == "preferred_language" and m.source == "custom_field" for m in c.field_mappings)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_mapper.py -v`
Expected: FAIL — mapper still references old entity types

- [ ] **Step 3: Update mapper.py**

In `backend/app/services/mapper.py`:

Update imports (line 5-10) — remove old, keep what's needed:

```python
from app.models.domain import (
    ENTITY_CLASSES,
    BaseEntity,
)
```

Update `map_extraction` function — replace the entity_list_map and remove special-case handling:

```python
def map_extraction(raw: RawExtraction, tenant_id: str, filename: str, raw_text: str) -> ExtractionResult:
    """Map a RawExtraction into an ExtractionResult with field provenance."""
    entities: list[EntityResult] = []

    # Map tenant
    if raw.tenant:
        data, mappings = _map_entity(raw.tenant, ENTITY_CLASSES["tenant"])
        data.setdefault("tenant_id", tenant_id)
        entities.append(EntityResult(entity_type="TENANT", entity=data, field_mappings=mappings))

    # Map entity lists
    entity_list_map = {
        "program": raw.programs,
        "student": raw.students,
        "family": raw.families,
        "contact": raw.contacts,
        "enrollment": raw.enrollments,
        "registration_application": raw.registration_applications,
    }
    for entity_type, raw_list in entity_list_map.items():
        if raw_list:
            entities.extend(_map_entity_list(
                raw_list, entity_type, ENTITY_CLASSES[entity_type], tenant_id,
            ))

    # Consolidate multiple entities of the same type into one
    entities = _consolidate_entities(entities)

    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        entities=entities,
        raw_text=raw_text,
    )
```

This removes the special-case `EmergencyContact`/`MedicalContact` mapping (old lines 221-227) and the `"guardian"` entry, replacing them with `"family"` and `"contact"` in the standard path.

- [ ] **Step 4: Run mapper tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_mapper.py -v`
Expected: All PASS

- [ ] **Step 5: Run all backend tests to check nothing is broken**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/mapper.py backend/tests/test_mapper.py
git commit -m "feat: update mapper for family/contact entities, remove guardian/emergency/medical mapping"
```

---

### Task 5: Update frontend EntityCard colors and FinalizedPage sample data

**Files:**
- Modify: `frontend/src/components/EntityCard.tsx`
- Modify: `frontend/src/pages/FinalizedPage.tsx`

- [ ] **Step 1: Update TYPE_COLORS in EntityCard.tsx**

In `frontend/src/components/EntityCard.tsx`, replace the `TYPE_COLORS` object:

```typescript
const TYPE_COLORS: Record<string, string> = {
  TENANT: "#378ADD",
  PROGRAM: "#639922",
  STUDENT: "#EF9F27",
  FAMILY: "#D4537E",
  CONTACT: "#3B6D11",
  ENROLLMENT: "#993556",
  REGAPP: "#854F0B",
  ATTENDANCE: "#639922",
};
```

This removes `GUARDIAN`, `EMERGENCY_CONTACT`, `MEDICAL_CONTACT` and adds `FAMILY`, `CONTACT`.

- [ ] **Step 2: Update sample data in FinalizedPage.tsx**

In `frontend/src/pages/FinalizedPage.tsx`, in the `sampleValue` function, update the name-driven samples section:

Replace:
```typescript
  if (n === "guardian_id") return "GRD-00483";
```

With:
```typescript
  if (n === "family_id") return "FAM-00215";
```

Note: `contact_id` sample already exists on line 60 — no change needed for it.

Also add new name-driven samples after the existing `if (n === "relationship")` line:

```typescript
  if (n === "family_name") return "Smith Household";
  if (n === "role") return "guardian";
  if (n === "clinic_name") return "Springfield Pediatrics";
  if (n === "primary_email") return "smith@example.com";
  if (n === "primary_phone") return "(555) 234-5678";
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EntityCard.tsx frontend/src/pages/FinalizedPage.tsx
git commit -m "feat: update frontend for family/contact entities — colors and sample data"
```

---

### Task 6: Verify extractor prompt auto-updates

**Files:**
- No changes (verification only)

- [ ] **Step 1: Verify the AI extraction prompt includes Family and Contact schemas**

Run:
```bash
cd backend && python -c "
from app.services.extractor import SYSTEM_PROMPT
print(SYSTEM_PROMPT)
assert 'family' in SYSTEM_PROMPT.lower()
assert 'contact' in SYSTEM_PROMPT.lower()
assert 'guardian' not in SYSTEM_PROMPT.lower()
print('PASS: Prompt auto-updated correctly')
"
```

Expected: Prompt prints showing `family` and `contact` schemas. No `guardian`. Prints `PASS`.

- [ ] **Step 2: Run full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && npm run lint`
Expected: No errors
