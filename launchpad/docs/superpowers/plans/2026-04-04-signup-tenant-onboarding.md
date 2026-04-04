# Signup, Tenant ID & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign signup with email domain gating, user-confirmed tenant IDs, optional default model onboarding, and papermite JWT integration.

**Architecture:** Multi-step signup with backend validation endpoints, deterministic tenant ID generation, base model provisioning via JSON file, and cross-module JWT auth for papermite integration. Roles normalized to `admin` across all modules.

**Tech Stack:** FastAPI, Pydantic, PyJWT, bcrypt, React, TypeScript, datacore (LanceDB wrapper)

**Spec:** `docs/superpowers/specs/2026-04-04-signup-tenant-onboarding-redesign.md`

---

## File Map

### Launchpad Backend
- Modify: `backend/app/api/auth.py` — add `check-email`, `suggest-ids` endpoints; modify `register`
- Modify: `backend/app/api/tenants.py` — add `use-default` model endpoint
- Create: `backend/app/data/base_model.json` — base model with all entity types
- Modify: `backend/tests/test_registry_store.py` — add tests for email domain lookup

### Launchpad Frontend
- Modify: `frontend/src/pages/SignupPage.tsx` — multi-step registration
- Modify: `frontend/src/pages/LoginPage.tsx` — copy change
- Modify: `frontend/src/pages/OnboardingPage.tsx` — two-option model setup + redirect fix
- Modify: `frontend/src/api/client.ts` — new API functions

### Papermite Backend
- Modify: `../papermite/backend/app/api/auth.py` — dual JWT, role normalization
- Modify: `../papermite/backend/app/config.py` — add launchpad JWT secret
- Modify: `../papermite/backend/tests/test_extract_api.py` — role fix
- Modify: `../papermite/test_user.json` — role fix

### Papermite Frontend
- Modify: `../papermite/frontend/src/App.tsx` — role normalization
- Modify: `../papermite/frontend/src/api/client.ts` — support external token
- Modify: `../papermite/frontend/src/pages/UploadPage.tsx` — read query params
- Modify: `../papermite/frontend/src/pages/FinalizedPage.tsx` — return_url redirect
- Modify: `../papermite/frontend/src/pages/ReviewPage.tsx` — forward return_url

### Other
- Modify: `../admindash/test_user.json` — role fix

---

## Task 1: Normalize roles across all modules

Replace `tenant_admin` with `admin` in papermite and admindash. This is a prerequisite for all other tasks.

**Files:**
- Modify: `../papermite/backend/app/api/auth.py:48-51`
- Modify: `../papermite/frontend/src/App.tsx:71,174`
- Modify: `../papermite/test_user.json:10`
- Modify: `../papermite/backend/tests/test_extract_api.py:19`
- Modify: `../admindash/test_user.json:9`

- [ ] **Step 1: Update papermite backend auth**

In `../papermite/backend/app/api/auth.py`, change `require_admin`:

```python
def require_admin(user: TestUser = Depends(get_current_user)) -> TestUser:
    """Verify the current user has admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requires admin role")
    return user
```

- [ ] **Step 2: Update papermite frontend**

In `../papermite/frontend/src/App.tsx`, replace both `tenant_admin` references:

Line 71 — change the role display text from `tenant_admin` to `admin`:
```tsx
<code style={{ color: "var(--success)" }}>admin</code>.
```

Line 174 — change the role check:
```typescript
if (user.role !== "admin") {
```

- [ ] **Step 3: Update test data files**

`../papermite/test_user.json` — change line 10:
```json
"role": "admin"
```

`../papermite/backend/tests/test_extract_api.py` — change line 19:
```python
role="admin",
```

`../admindash/test_user.json` — change line 9:
```json
"role": "admin"
```

- [ ] **Step 4: Run papermite tests**

Run: `cd ../papermite && python -m pytest backend/tests/ -v`
Expected: All tests pass with updated role.

- [ ] **Step 5: Commit**

```bash
git add ../papermite/backend/app/api/auth.py ../papermite/frontend/src/App.tsx ../papermite/test_user.json ../papermite/backend/tests/test_extract_api.py ../admindash/test_user.json
git commit -m "refactor: normalize tenant_admin to admin across all modules"
```

---

## Task 2: Backend — email domain check endpoint

Add `POST /api/register/check-email` to launchpad.

**Files:**
- Modify: `backend/app/api/auth.py`
- Modify: `backend/app/storage/registry_store.py`

- [ ] **Step 1: Add `get_users_by_email_domain` to registry store**

In `backend/app/storage/registry_store.py`, add this method to `RegistryStore`:

```python
def get_users_by_email_domain(self, domain: str) -> list[UserRecord]:
    """Return all users whose email matches the given domain."""
    results = self._store.query_global(REGISTRY_TABLE)
    users = []
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        email = row["data"].get("email", "")
        if email.split("@")[-1].lower() == domain.lower():
            users.append(UserRecord(**row["data"]))
    return users
```

- [ ] **Step 2: Write the check-email endpoint**

In `backend/app/api/auth.py`, add the common providers list and endpoint after the existing imports:

```python
COMMON_EMAIL_PROVIDERS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "protonmail.com", "aol.com", "mail.com", "zoho.com",
    "live.com", "msn.com", "ymail.com",
})

class CheckEmailRequest(BaseModel):
    email: str

class CheckEmailResponse(BaseModel):
    status: str  # "new_tenant" or "org_exists"
    admin_email_hint: str | None = None

def _mask_email(email: str) -> str:
    """Mask email for privacy: jane@acme.edu -> j***@acme.edu"""
    local, domain = email.split("@")
    return f"{local[0]}***@{domain}"

@router.post("/register/check-email")
def check_email(req: CheckEmailRequest, registry: RegistryStore = Depends(get_registry_store)):
    domain = req.email.split("@")[-1].lower()
    if domain in COMMON_EMAIL_PROVIDERS:
        return CheckEmailResponse(status="new_tenant")
    users = registry.get_users_by_email_domain(domain)
    admins = [u for u in users if u.role == "admin"]
    if admins:
        return CheckEmailResponse(
            status="org_exists",
            admin_email_hint=_mask_email(admins[0].email),
        )
    return CheckEmailResponse(status="new_tenant")
```

- [ ] **Step 3: Run backend and test manually**

Run: `cd backend && python -m uvicorn app.main:app --port 8001 --reload`

Test:
```bash
curl -s -X POST http://localhost:8001/api/register/check-email \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@brand-new.org"}' | python3 -m json.tool
```
Expected: `{ "status": "new_tenant", "admin_email_hint": null }`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/auth.py backend/app/storage/registry_store.py
git commit -m "feat: add check-email endpoint with domain gating"
```

---

## Task 3: Backend — tenant ID suggestion endpoint

Add `POST /api/register/suggest-ids` with deterministic slug generation and uniqueness checking.

**Files:**
- Modify: `backend/app/api/auth.py`

- [ ] **Step 1: Add the suggest-ids endpoint**

In `backend/app/api/auth.py`, add after the `check_email` endpoint:

```python
TENANT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,39}$")

class SuggestIdsRequest(BaseModel):
    email: str
    tenant_name: str

class SuggestIdsResponse(BaseModel):
    suggestions: list[str]

def _generate_slug_candidates(email: str, tenant_name: str) -> list[str]:
    """Generate up to 5 deterministic tenant ID candidates."""
    domain = email.split("@")[-1].lower()
    is_common = domain in COMMON_EMAIL_PROVIDERS
    words = re.sub(r"[^a-z0-9]+", " ", tenant_name.lower()).split()
    candidates = []

    # 1. Domain stem (skip for common providers)
    if not is_common:
        stem = domain.split(".")[0]
        if stem and TENANT_ID_PATTERN.match(stem):
            candidates.append(stem)

    # 2. First two words
    if len(words) >= 2:
        slug = f"{words[0]}-{words[1]}"
        if TENANT_ID_PATTERN.match(slug):
            candidates.append(slug)

    # 3. Initials
    if len(words) >= 2:
        initials = "-".join([words[0], "".join(w[0] for w in words[1:])])
        if TENANT_ID_PATTERN.match(initials):
            candidates.append(initials)

    # 4. Reversed key words (first two reversed)
    if len(words) >= 2:
        rev = f"{words[1]}-{words[0]}"
        if TENANT_ID_PATTERN.match(rev):
            candidates.append(rev)

    # 5. Full slug
    full = "-".join(words)
    if TENANT_ID_PATTERN.match(full) and full not in candidates:
        candidates.append(full)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique

@router.post("/register/suggest-ids")
def suggest_ids(req: SuggestIdsRequest, registry: RegistryStore = Depends(get_registry_store)):
    candidates = _generate_slug_candidates(req.email, req.tenant_name)
    available = [c for c in candidates if registry.get_onboarding(c) is None]
    return SuggestIdsResponse(suggestions=available)
```

- [ ] **Step 2: Test manually**

```bash
curl -s -X POST http://localhost:8001/api/register/suggest-ids \
  -H "Content-Type: application/json" \
  -d '{"email":"klee@acme.edu","tenant_name":"Acme Afterschool Program"}' | python3 -m json.tool
```
Expected: `{ "suggestions": ["acme", "acme-afterschool", "acme-ap", "afterschool-acme", "acme-afterschool-program"] }`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/auth.py
git commit -m "feat: add suggest-ids endpoint with deterministic slug generation"
```

---

## Task 4: Backend — modify register endpoint

Accept user-confirmed `tenant_id` instead of auto-generating.

**Files:**
- Modify: `backend/app/api/auth.py`

- [ ] **Step 1: Update RegisterRequest and register endpoint**

In `backend/app/api/auth.py`, modify `RegisterRequest` and the `register` function:

```python
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_name: str
    tenant_id: str
```

Replace the `register` function:

```python
@router.post("/register")
def register(req: RegisterRequest, registry: RegistryStore = Depends(get_registry_store)):
    if not TENANT_ID_PATTERN.match(req.tenant_id):
        raise HTTPException(status_code=422, detail="Invalid tenant ID format. Must be 3-40 lowercase alphanumeric characters and hyphens, starting with a letter.")
    if registry.get_onboarding(req.tenant_id) is not None:
        raise HTTPException(status_code=409, detail="Tenant ID already taken")
    if registry.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = registry.create_user(
        name=req.name, email=req.email, password=req.password,
        tenant_id=req.tenant_id, tenant_name=req.tenant_name, role="admin",
    )
    registry.create_onboarding(req.tenant_id)
    token = _create_token(user.user_id, user.email, user.tenant_id, user.role)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}
```

- [ ] **Step 2: Remove `_slugify` function**

Delete the `_slugify` function (it's no longer used):

```python
# DELETE this function entirely:
# def _slugify(name: str) -> str:
#     """Convert name to kebab-case tenant_id."""
#     slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
#     return slug or "tenant"
```

- [ ] **Step 3: Test manually**

```bash
curl -s -X POST http://localhost:8001/api/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@neworg.com","password":"pass123","tenant_name":"New Org","tenant_id":"new-org"}' | python3 -m json.tool
```
Expected: 200 with token and user object containing `tenant_id: "new-org"`.

Test validation:
```bash
curl -s -X POST http://localhost:8001/api/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"t@x.com","password":"p","tenant_name":"X","tenant_id":"AB"}' | python3 -m json.tool
```
Expected: 422 — invalid format (too short, uppercase).

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/auth.py
git commit -m "feat: accept user-confirmed tenant_id in register endpoint"
```

---

## Task 5: Backend — base model JSON and use-default endpoint

Create base model file and endpoint to provision it for a tenant.

**Files:**
- Create: `backend/app/data/base_model.json`
- Modify: `backend/app/api/tenants.py`

- [ ] **Step 1: Create base_model.json**

Create `backend/app/data/base_model.json`. This contains all entity types from papermite's domain model (`../papermite/backend/app/models/domain.py`) with base_fields populated and custom_fields empty.

```json
{
  "tenant": {
    "base_fields": [
      {"name": "name", "type": "str", "required": true},
      {"name": "address", "type": "str", "required": false},
      {"name": "phone", "type": "phone", "required": false},
      {"name": "email", "type": "email", "required": false},
      {"name": "website", "type": "str", "required": false}
    ],
    "custom_fields": []
  },
  "student": {
    "base_fields": [
      {"name": "student_id", "type": "str", "required": true},
      {"name": "first_name", "type": "str", "required": true},
      {"name": "last_name", "type": "str", "required": true},
      {"name": "middle_name", "type": "str", "required": false},
      {"name": "preferred_name", "type": "str", "required": false},
      {"name": "dob", "type": "date", "required": false},
      {"name": "grade_level", "type": "str", "required": false},
      {"name": "email", "type": "email", "required": false},
      {"name": "gender", "type": "selection", "required": false, "options": ["Male", "Female", "Non-binary", "Prefer not to say"]},
      {"name": "status", "type": "selection", "required": false, "options": ["Active", "Inactive", "Enrolled", "Withdrawn", "Graduated", "Waitlisted", "Suspended", "Transferred"]},
      {"name": "family_id", "type": "str", "required": true},
      {"name": "primary_address", "type": "str", "required": true},
      {"name": "mailing_address", "type": "str", "required": false}
    ],
    "custom_fields": []
  },
  "family": {
    "base_fields": [
      {"name": "family_id", "type": "str", "required": true},
      {"name": "family_name", "type": "str", "required": true},
      {"name": "primary_address", "type": "str", "required": true},
      {"name": "mailing_address", "type": "str", "required": false},
      {"name": "primary_phone", "type": "phone", "required": false},
      {"name": "primary_email", "type": "email", "required": false}
    ],
    "custom_fields": []
  },
  "contact": {
    "base_fields": [
      {"name": "contact_id", "type": "str", "required": true},
      {"name": "first_name", "type": "str", "required": true},
      {"name": "last_name", "type": "str", "required": true},
      {"name": "relationship", "type": "str", "required": true},
      {"name": "phone", "type": "phone", "required": false},
      {"name": "email", "type": "email", "required": false},
      {"name": "is_emergency", "type": "bool", "required": false},
      {"name": "is_authorized_pickup", "type": "bool", "required": false},
      {"name": "family_id", "type": "str", "required": true}
    ],
    "custom_fields": []
  },
  "program": {
    "base_fields": [
      {"name": "program_id", "type": "str", "required": true},
      {"name": "name", "type": "str", "required": true},
      {"name": "description", "type": "str", "required": false},
      {"name": "start_date", "type": "date", "required": false},
      {"name": "end_date", "type": "date", "required": false},
      {"name": "capacity", "type": "number", "required": false},
      {"name": "status", "type": "selection", "required": false, "options": ["Active", "Inactive", "Planned", "Completed"]}
    ],
    "custom_fields": []
  },
  "enrollment": {
    "base_fields": [
      {"name": "enrollment_id", "type": "str", "required": true},
      {"name": "student_id", "type": "str", "required": true},
      {"name": "program_id", "type": "str", "required": true},
      {"name": "enrollment_date", "type": "date", "required": true},
      {"name": "status", "type": "selection", "required": false, "options": ["Active", "Withdrawn", "Completed", "Waitlisted"]},
      {"name": "notes", "type": "str", "required": false}
    ],
    "custom_fields": []
  },
  "attendance": {
    "base_fields": [
      {"name": "attendance_id", "type": "str", "required": true},
      {"name": "student_id", "type": "str", "required": true},
      {"name": "program_id", "type": "str", "required": true},
      {"name": "date", "type": "date", "required": true},
      {"name": "status", "type": "selection", "required": true, "options": ["Present", "Absent", "Tardy", "Excused"]},
      {"name": "notes", "type": "str", "required": false}
    ],
    "custom_fields": []
  }
}
```

- [ ] **Step 2: Write the use-default endpoint**

In `backend/app/api/tenants.py`, add at the top with other imports:

```python
import json
from pathlib import Path
```

Add the endpoint after the existing `get_model` route:

```python
BASE_MODEL_PATH = Path(__file__).parent.parent / "data" / "base_model.json"

@router.post("/tenants/{tenant_id}/model/use-default")
def use_default_model(tenant_id: str, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    base_model = json.loads(BASE_MODEL_PATH.read_text())
    from datacore import Store
    from app.config import settings
    store = Store(data_dir=settings.datacore_store_path)
    for entity_type, model_def in base_model.items():
        store.put_model(tenant_id=tenant_id, entity_type=entity_type, model_definition=model_def)
    registry.mark_step_complete(tenant_id, "model_setup")
    return base_model
```

- [ ] **Step 3: Create the data directory**

```bash
mkdir -p backend/app/data
```

- [ ] **Step 4: Test manually**

```bash
curl -s -X POST http://localhost:8001/api/tenants/new-org/model/use-default \
  -H "Authorization: Bearer <token-for-new-org-admin>" | python3 -m json.tool
```
Expected: 200 with the full base model JSON. Onboarding step `model_setup` marked complete.

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/base_model.json backend/app/api/tenants.py
git commit -m "feat: add base model JSON and use-default endpoint"
```

---

## Task 6: Frontend — new API client functions

Add client functions for the new backend endpoints.

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add new API functions**

In `frontend/src/api/client.ts`, add after the existing exports:

```typescript
export async function checkEmail(email: string): Promise<{ status: string; admin_email_hint: string | null }> {
  const res = await fetch(`${BASE_URL}/register/check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Failed to check email");
  return res.json();
}

export async function suggestTenantIds(email: string, tenantName: string): Promise<{ suggestions: string[] }> {
  const res = await fetch(`${BASE_URL}/register/suggest-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, tenant_name: tenantName }),
  });
  if (!res.ok) throw new Error("Failed to suggest IDs");
  return res.json();
}

export async function useDefaultModel(tenantId: string): Promise<Record<string, unknown>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model/use-default`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to apply default model");
  return res.json();
}
```

- [ ] **Step 2: Update the `register` function signature**

Modify the existing `register` function to accept `tenant_id`:

```typescript
export async function register(name: string, email: string, password: string, tenant_name: string, tenant_id: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, tenant_name, tenant_id }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Registration failed");
  }
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add client functions for email check, suggest IDs, and default model"
```

---

## Task 7: Frontend — multi-step SignupPage

Rewrite SignupPage as a multi-step form: email check → org name + tenant ID → name/password → submit.

**Files:**
- Modify: `frontend/src/pages/SignupPage.tsx`

- [ ] **Step 1: Read current SignupPage**

Read `frontend/src/pages/SignupPage.tsx` to understand the current structure and props.

- [ ] **Step 2: Rewrite SignupPage**

Replace the contents of `frontend/src/pages/SignupPage.tsx` with:

```tsx
import { useState } from "react";
import type { User } from "../types/models";
import { checkEmail, suggestTenantIds, register } from "../api/client";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: User) => void;
  onSwitchToLogin: () => void;
}

type Step = "email" | "org" | "credentials";

export default function SignupPage({ onLogin, onSwitchToLogin }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [customId, setCustomId] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [orgExistsHint, setOrgExistsHint] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    setOrgExistsHint("");
    try {
      const result = await checkEmail(email.trim());
      if (result.status === "org_exists") {
        setOrgExistsHint(result.admin_email_hint || "your organization admin");
      } else {
        setStep("org");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await suggestTenantIds(email.trim(), orgName.trim());
      setSuggestions(result.suggestions);
      if (result.suggestions.length > 0) {
        setTenantId(result.suggestions[0]);
      }
      setStep("credentials");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate IDs");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalId = customId.trim() || tenantId;
    if (!name.trim() || !password.trim() || !finalId) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await register(name.trim(), email.trim(), password, orgName.trim(), finalId);
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-brand">Launchpad</h1>
          <p className="auth-subtitle">Set up your organization</p>
        </div>

        {step === "email" && (
          <form className="auth-form" onSubmit={handleEmailCheck}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">Work Email</label>
              <input id="email" className="auth-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@yourorg.com" autoFocus />
            </div>
            {orgExistsHint && (
              <div className="auth-error">
                Your organization already has an account. Contact your admin at {orgExistsHint} to get added.
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "org" && (
          <form className="auth-form" onSubmit={handleOrgSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="orgName">Organization Name</label>
              <input id="orgName" className="auth-input" type="text" value={orgName}
                onChange={e => setOrgName(e.target.value)} placeholder="Acme Afterschool Program" autoFocus />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Generating..." : "Continue"}
            </button>
            <button type="button" className="auth-link" onClick={() => setStep("email")}>Back</button>
          </form>
        )}

        {step === "credentials" && (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-field">
              <label className="auth-label">Organization ID</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {suggestions.map(s => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="radio" name="tenantId" value={s}
                      checked={tenantId === s && !customId}
                      onChange={() => { setTenantId(s); setCustomId(""); }} />
                    <code style={{ fontSize: 14 }}>{s}</code>
                  </label>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="radio" name="tenantId" checked={!!customId}
                    onChange={() => setCustomId(customId || " ")} />
                  <input className="auth-input" type="text" placeholder="Or type your own..."
                    value={customId} onChange={e => setCustomId(e.target.value)}
                    onFocus={() => setCustomId(customId || "")}
                    style={{ flex: 1, margin: 0 }} />
                </label>
              </div>
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="name">Your Name</label>
              <input id="name" className="auth-input" type="text" value={name}
                onChange={e => setName(e.target.value)} placeholder="Kenny Lee" />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="password">Password</label>
              <input id="password" className="auth-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Create a password" />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Account"}
            </button>
            <button type="button" className="auth-link" onClick={() => setStep("org")}>Back</button>
          </form>
        )}

        <div className="auth-footer">
          <span>Already have an account? </span>
          <button className="auth-link" onClick={onSwitchToLogin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SignupPage.tsx
git commit -m "feat: rewrite SignupPage as multi-step with email gating and tenant ID selection"
```

---

## Task 8: Frontend — LoginPage copy change

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx:55`

- [ ] **Step 1: Update the signup prompt text**

In `frontend/src/pages/LoginPage.tsx`, change line 55:

From:
```tsx
<span>Don't have an account? </span>
```

To:
```tsx
<span>Setting up a new organization? </span>
```

And change the button text on line 56:

From:
```tsx
<button className="auth-link" onClick={onSwitchToSignup}>Sign up</button>
```

To:
```tsx
<button className="auth-link" onClick={onSwitchToSignup}>Create your first admin account</button>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "feat: update login page copy for new-org signup flow"
```

---

## Task 9: Frontend — OnboardingPage two-option model setup and papermite redirect

**Files:**
- Modify: `frontend/src/pages/OnboardingPage.tsx`

- [ ] **Step 1: Add default model option and fix papermite redirect**

In `frontend/src/pages/OnboardingPage.tsx`, update the import to include `useDefaultModel` and `getStoredToken`:

```typescript
import { getTenantModel, getTenantProfile, updateTenantProfile, markOnboardingStep, useDefaultModel, getStoredToken } from "../api/client";
```

Replace the `handleModelSetup` function (line 44-47):

```typescript
const handleModelSetup = () => {
  const token = getStoredToken();
  const returnUrl = `${window.location.origin}?model_setup=complete`;
  window.location.href = `${papermiteUrl}/upload?tenant_id=${user.tenant_id}&token=${encodeURIComponent(token || "")}&return_url=${encodeURIComponent(returnUrl)}`;
};

const handleUseDefault = async () => {
  try {
    await useDefaultModel(user.tenant_id);
    const s = await markOnboardingStep(user.tenant_id, "model_setup");
    setStatus(s);
  } catch (err) {
    // silently handle — user can retry
  }
};
```

Note: `useDefaultModel` already marks the step complete on the backend, but `markOnboardingStep` is called to refresh the local status. If this causes a double-mark, remove the `markOnboardingStep` call and instead refetch status:

```typescript
const handleUseDefault = async () => {
  try {
    await useDefaultModel(user.tenant_id);
    // Refetch onboarding status since backend marked step complete
    const params = new URLSearchParams();
    const res = await import("../api/client").then(c => c.getOnboardingStatus(user.tenant_id));
    setStatus(res);
  } catch (err) {
    // silently handle — user can retry
  }
};
```

Actually, to keep it simple and avoid double-marking, import `getOnboardingStatus` and refetch:

```typescript
import { getTenantModel, getTenantProfile, updateTenantProfile, markOnboardingStep, useDefaultModel, getStoredToken, getOnboardingStatus } from "../api/client";
```

```typescript
const handleUseDefault = async () => {
  try {
    await useDefaultModel(user.tenant_id);
    const updatedStatus = await getOnboardingStatus(user.tenant_id);
    setStatus(updatedStatus);
  } catch (err) {
    // silently handle
  }
};
```

Replace the Step 1 card content (the section inside `{activeStep === 0 && (...)}`), replacing lines 72-86:

```tsx
{activeStep === 0 && (
  <div className="onboard__card">
    <h3>Set Up Your Data Model</h3>
    <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px" }}>
      Choose how to set up the data model for your organization.
    </p>
    {status.steps[0].completed ? (
      <>
        <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 16 }}>Model setup complete!</div>
        <button className="auth-submit" onClick={() => setActiveStep(1)}>Next</button>
      </>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button className="auth-submit" onClick={handleModelSetup}>
          Upload Document
        </button>
        <button className="auth-submit" onClick={handleUseDefault}
          style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}>
          Use Default Model
        </button>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
          You can customize the model later from Tenant Settings.
        </p>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Add `getOnboardingStatus` export if missing**

Check `frontend/src/api/client.ts` — `getOnboardingStatus` is already exported. Verify it's available. If not, it's already there at line 59-63.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/OnboardingPage.tsx
git commit -m "feat: add default model option and pass JWT to papermite redirect"
```

---

## Task 10: Papermite backend — dual JWT auth and config

**Files:**
- Modify: `../papermite/backend/app/config.py`
- Modify: `../papermite/backend/app/api/auth.py`

- [ ] **Step 1: Add launchpad JWT secret to config**

In `../papermite/backend/app/config.py`, add to the `Settings` class after `jwt_secret`:

```python
launchpad_jwt_secret: str = "neoapex-dev-secret-change-in-prod"
```

- [ ] **Step 2: Update get_current_user for dual JWT**

In `../papermite/backend/app/api/auth.py`, replace the `_decode_token` function and `get_current_user`:

```python
def _decode_token(token: str, secret: str) -> dict:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise e  # Let caller handle fallback


def get_current_user(authorization: str = Header(...)) -> TestUser:
    """Decode JWT from Authorization header. Tries papermite secret first, then launchpad secret."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]

    # Try papermite's own secret first
    try:
        payload = _decode_token(token, settings.jwt_secret)
        user = settings.find_user_by_email(payload["email"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.InvalidTokenError:
        pass

    # Try launchpad secret
    try:
        payload = _decode_token(token, settings.launchpad_jwt_secret)
        return TestUser(
            user_id=payload["user_id"],
            name=payload.get("name", payload["email"].split("@")[0]),
            email=payload["email"],
            password="",  # Not used for JWT-authenticated users
            tenant_id=payload["tenant_id"],
            tenant_name=payload.get("tenant_name", ""),
            role=payload["role"],
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

- [ ] **Step 3: Run papermite tests**

Run: `cd ../papermite && python -m pytest backend/tests/ -v`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add ../papermite/backend/app/config.py ../papermite/backend/app/api/auth.py
git commit -m "feat: add dual JWT auth to papermite for launchpad integration"
```

---

## Task 11: Papermite frontend — query params, external token, and return_url flow

**Files:**
- Modify: `../papermite/frontend/src/api/client.ts`
- Modify: `../papermite/frontend/src/App.tsx`
- Modify: `../papermite/frontend/src/pages/UploadPage.tsx`
- Modify: `../papermite/frontend/src/pages/ReviewPage.tsx`
- Modify: `../papermite/frontend/src/pages/FinalizedPage.tsx`

- [ ] **Step 1: Add external token support to papermite client**

In `../papermite/frontend/src/api/client.ts`, add a function to accept an external token:

```typescript
export function setExternalToken(token: string): void {
  storeToken(token);
}
```

This reuses the existing `storeToken` — the token goes into localStorage and `authFetch` picks it up automatically.

- [ ] **Step 2: Handle query params in App.tsx**

In `../papermite/frontend/src/App.tsx`, in the auth useEffect (around line 128-139), add query param handling BEFORE the existing token check:

```typescript
useEffect(() => {
  // Check for external token from launchpad
  const params = new URLSearchParams(window.location.search);
  const externalToken = params.get("token");
  if (externalToken) {
    storeToken(externalToken);
    // Clean token from URL but preserve other params
    params.delete("token");
    const remaining = params.toString();
    const newUrl = remaining
      ? `${window.location.pathname}?${remaining}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }

  // Existing auth check
  const token = getStoredToken();
  if (!token) { setAuthChecked(true); return; }
  getCurrentUser()
    .then(u => setUser(u))
    .catch(() => clearToken())
    .finally(() => setAuthChecked(true));
}, []);
```

Add `storeToken` to the imports from `../api/client`.

- [ ] **Step 3: Forward return_url and tenant_id through papermite pages**

In `../papermite/frontend/src/pages/UploadPage.tsx`, read the query params and forward them when navigating to review. Around line 47 where it navigates:

```typescript
// At the top of the component, read params:
const [searchParams] = useSearchParams();
const returnUrl = searchParams.get("return_url");
const tenantIdParam = searchParams.get("tenant_id");

// Use tenantIdParam to override the user's tenant_id if present:
const effectiveTenantId = tenantIdParam || user.tenant_id;
```

Update the navigate call (line 47) to forward params:

```typescript
const forwardParams = new URLSearchParams();
if (returnUrl) forwardParams.set("return_url", returnUrl);
const qs = forwardParams.toString();
navigate(`/review/${result.extraction_id}${qs ? `?${qs}` : ""}`);
```

Add `useSearchParams` import from `react-router-dom`.

- [ ] **Step 4: Forward return_url from ReviewPage to FinalizedPage**

In `../papermite/frontend/src/pages/ReviewPage.tsx`, around line 66-70 where `handleFinalize` navigates:

```typescript
const [searchParams] = useSearchParams();
const returnUrl = searchParams.get("return_url");
```

Update the navigate call:

```typescript
const forwardParams = new URLSearchParams();
if (returnUrl) forwardParams.set("return_url", returnUrl);
const qs = forwardParams.toString();
navigate(`/finalize/${extraction.extraction_id}${qs ? `?${qs}` : ""}`);
```

Add `useSearchParams` import from `react-router-dom`.

- [ ] **Step 5: Handle return_url in FinalizedPage after commit**

In `../papermite/frontend/src/pages/FinalizedPage.tsx`, read the return_url:

```typescript
const [searchParams] = useSearchParams();
const returnUrl = searchParams.get("return_url");
```

Update the `handleConfirm` success path (around line 191) — replace `navigate("/")` with:

```typescript
if (returnUrl) {
  window.location.href = returnUrl;
} else {
  navigate("/");
}
```

Also update `handleCancel` (around line 200) similarly:

```typescript
if (returnUrl) {
  window.location.href = returnUrl;
} else {
  navigate("/");
}
```

Add `useSearchParams` import from `react-router-dom`.

- [ ] **Step 6: Commit**

```bash
git add ../papermite/frontend/src/api/client.ts ../papermite/frontend/src/App.tsx ../papermite/frontend/src/pages/UploadPage.tsx ../papermite/frontend/src/pages/ReviewPage.tsx ../papermite/frontend/src/pages/FinalizedPage.tsx
git commit -m "feat: support external JWT, tenant_id, and return_url from launchpad"
```

---

## Task 12: End-to-end verification

- [ ] **Step 1: Start both backends**

```bash
cd backend && python -m uvicorn app.main:app --port 8001 --reload &
cd ../papermite/backend && python -m uvicorn app.main:app --port 8000 --reload &
```

- [ ] **Step 2: Start both frontends**

```bash
cd frontend && npm run dev &
cd ../papermite/frontend && npm run dev &
```

- [ ] **Step 3: Test full signup flow**

1. Go to `http://localhost:5175`
2. Click "Create your first admin account"
3. Enter a new email (e.g., `admin@newschool.org`) → should pass domain check
4. Enter org name → should see tenant ID suggestions
5. Pick an ID, enter name/password → should create account and redirect to onboarding

- [ ] **Step 4: Test default model onboarding**

1. On onboarding step 1, click "Use Default Model"
2. Should advance to step 2 (Tenant Details)
3. Should show the base model fields

- [ ] **Step 5: Test papermite redirect flow**

1. Register a new tenant
2. On onboarding step 1, click "Upload Document"
3. Should redirect to papermite with token in URL
4. Upload and finalize a document in papermite
5. Should redirect back to launchpad step 2

- [ ] **Step 6: Test email domain gating**

1. Try signing up with an email domain that already has an admin
2. Should see "Contact your admin" message
3. Try with gmail.com → should skip check and proceed

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: signup redesign with email gating, tenant ID selection, optional default model, and papermite JWT integration"
```
