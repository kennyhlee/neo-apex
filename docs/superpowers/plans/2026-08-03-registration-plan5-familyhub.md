# Registration Phase 1 — Plan 5: FamilyHub Family Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the family-facing channel: the familyhub-backend token-scoped facade (public config bundle, start, hub bundle, parent actions, request-link, checkout, document upload/download) and the familyhub-frontend parent surface (RegisterPage runtime, HubPage status hub, RequestLinkPage), ending with an end-to-end smoke runbook across both channels.

**Architecture:**

familyhub is the ONLY service parents touch. Its backend is a narrow facade: the magic-link token in the URL path is the only credential; every lifecycle read/write is proxied to enrollx-backend's internal API over the private network with the `X-Internal-Key` shared secret; document presigning is proxied to DataCore's blob API after enrollx-based authorization. familyhub persists nothing and can query nothing generically.

```
Parent (phone) ── familyhub-frontend (6000)
                       │ fetch
                       ▼
              familyhub-backend (6010)  ← token in path, NO JWT
                │                │
   X-Internal-Key                │ blob presign proxy
                ▼                ▼
      enrollx-backend (5910)   DataCore (5800)
      /internal/* lifecycle    /api/documents/* (R2)
```

**Design decision — public config bundle comes from an enrollx internal route, not a direct DataCore query.** `GET /api/registration/{tenant_id}/{program_id}` is implemented by calling a new enrollx internal route (`GET /internal/registration/{tenant_id}/{program_id}/config`, added in Task 2) rather than a familyhub-side server-constructed DataCore query. Justification: (a) DataCore's query endpoint requires a JWT, and familyhub must never hold staff credentials or any DataCore query capability — the whole point of the facade (spec §3) is that compromising the public surface yields token-scoped access only; (b) enrollx already owns the "load the published config for a program" logic (its `/internal/.../start` route derives items from it) and the capacity/is-full computation (Plan 2's waitlist check), so putting the read next to that code avoids duplicating registration semantics in a second service; (c) familyhub then needs exactly two secrets total: the internal key and nothing else. The same reasoning drives the two other small internal routes Task 2 adds (documents listing for download authorization, tenant-scoped request-link for the lost-link flow).

**Contract gap this plan bridges (flagged, deliberate):** the roadmap's internal request-link route is token-scoped (`POST /internal/application-by-token/{token}/request-link`), but the facade's `POST /api/application/request-link` takes `{tenant_id, program_id?, email}` with NO token — that is the lost-link flow, where the parent by definition has no working token. Only enrollx can look up applications by email, so Task 2 adds `POST /internal/registration/{tenant_id}/request-link` (email match → re-send link, reusing Plan 2's resend machinery). The facade route additions for documents (`POST /api/application/{token}/documents`, `GET /api/application/{token}/documents/{document_id}/url`) are pre-authorized by spec §8 (familyhub proxies presign for parents), and `POST /api/application/{token}/checkout` exposes Plan 3's parent payment path (spec §7 parent path; the hub's "pay" affordance is dead weight without it).

**Tech Stack:** Python 3.12 + FastAPI + pydantic_settings + httpx + pytest/TestClient (backend); React 19 + TypeScript + Vite + react-router-dom v7 + native fetch (frontend); `@neoapex/ui-tokens` + `@neoapex/flow-runtime` (file: deps); custom i18n hook (en-US, zh-CN) copied from admindash by Plan 1. No new heavy dependencies anywhere — the rate limiter is stdlib-only.

## Global Constraints

- **Branch:** `git checkout main && git pull` then `git checkout -b feat/registration-plan5-familyhub`. (Roadmap base branch `docs/registration-flow-design` applies only if it is still unmerged — check with `git branch -a`; Plans 1–4 landing means `main` is expected.) Commit per task with the exact messages given.
- **HARD SECURITY CONSTRAINTS (from spec §3 — violating any of these fails the plan):**
  - familyhub-backend has NO JWT handling anywhere: no `auth.py`, no `Authorization` header parsing, no login route, no DataCore `/auth/me` calls.
  - familyhub-backend has NO generic query route, NO generic entity route, NO staff route. The token in the URL path is the only credential.
  - Parent writes go ONLY through enrollx internal actions, and the facade rejects any action outside `{save_draft, complete_item, submit}` with 403 BEFORE proxying (enrollx enforces it again — defense in depth, not a substitute).
  - `POST /api/application/request-link` returns 200 with an identical body whether or not the email matched anything (no account enumeration).
  - Parents may fetch download URLs ONLY for documents where `uploaded_by == "parent:{application_id}"` of the token's own application.
- **Env vars (all optional in dev, prefix `FAMILYHUB_`):** `FAMILYHUB_ENROLLX_URL` (default `http://localhost:5910`), `FAMILYHUB_DATACORE_URL` (default `http://localhost:5800`), `FAMILYHUB_ENROLLX_INTERNAL_KEY` (must equal enrollx's `ENROLLX_INTERNAL_KEY`; required non-empty in production), `FAMILYHUB_CORS_ALLOWED_ORIGINS`.
- **TDD for every backend task:** write the failing test, run it and see it fail, implement, run it and see it pass, then run the service's FULL suite. All upstream HTTP (enrollx, DataCore) is stubbed by monkeypatching `httpx.request` at the single seam `app.upstream.call_upstream` uses — the `FakeHTTP` fixture is repeated in full in every test file so each file stands alone.
- **Frontend verification:** familyhub has no test framework (same as admindash). Every frontend task is verified by `npm run build` (tsc + vite) + `npm run lint` + the explicit manual smoke steps listed in the task.
- **Frontend conventions (admindash CLAUDE.md rules apply):** native fetch, CSS variables only (no raw hex outside theme.css), every form control has a bound `htmlFor`/`id` label, interactive elements are `<button>`/`<a>` (never `div onClick`), never `outline: none` without a replacement, every new user-facing string added to BOTH `en-US` and `zh-CN` in the translations file. Mobile-first: base styles target ~375px-wide phones; widen with `@media (min-width: 720px)`.
- **DEFAULT-AND-VERIFY convention:** Plans 2–4 landed real code whose exact identifier names this plan cannot see. Lines marked `# ADJUST(bindings)` ship with the roadmap-contract default and MUST be checked against `docs/superpowers/plans/2026-08-03-registration-plan5-bindings.md` (produced by Task 1). If the recorded actual name differs, change ONLY the marked line to match. Nothing else in a code block may be altered. There are no other degrees of freedom in this plan.

---

### Task 0: Branch setup

- [ ] **Step 1:** From the repo root:

```bash
cd /Users/kennylee/Development/NeoApex
git checkout main && git pull
git checkout -b feat/registration-plan5-familyhub
```

- [ ] **Step 2:** Sanity-check that Plans 1–4 actually landed (all four must exist; STOP and report if any is missing):

```bash
ls familyhub/backend/app/main.py familyhub/frontend/package.json \
   enrollx/backend/app/main.py flow-runtime/src/FlowRenderer.tsx
grep -rln "application-by-token" enrollx/backend/app
```

---

### Task 1: Bindings file — record the exact names Plans 2–4 produced

Every `ADJUST(bindings)` line in later tasks resolves against this file. This task writes it and commits it to the branch so each subsequent (possibly fresh-context) subagent can read it.

**Files:**
- Create: `docs/superpowers/plans/2026-08-03-registration-plan5-bindings.md`

**Interfaces:**
- Produces: the bindings table consumed by Tasks 2–10.

- [ ] **Step 1:** Run each discovery command and paste the answers into the file using this exact template (fill every `→` line with what the code actually says; quote the relevant line of source next to each answer):

```markdown
# Plan 5 bindings — actual names from Plans 1–4 code

## enrollx internal API (grep -rn "internal" enrollx/backend/app/api/ ; open the module)
- Internal router module path → 
- X-Internal-Key dependency name + import path → 
- Dev-mode default value of ENROLLX_INTERNAL_KEY (from enrollx config.py) → 
- Exact path of internal start route → 
- start response JSON keys (from its handler/tests; which key holds the magic-link token?) → 
- Exact path + response keys of internal application-by-token GET (bundle keys: application/items/config? are entities base_data-wrapped?) → 
- Exact path of internal actions route; JSON param names for save_draft (draft data key), complete_item (item id key, payload_ref key), submit → 
- Exact path of internal checkout route (grep -rn "checkout" enrollx/backend/app) + response key holding the Stripe URL → 
- Existing request-link internal route path + body → 
- Helper enrollx internal routes use to READ entities from DataCore without a user JWT (function name, module, signature) → 
- Helper/loader used by start to fetch the published registration_config for a program → 
- Capacity/is-full helper from Plan 2's waitlist check (name, module, signature) → 
- Existing internal-route test file path + the fixture block it uses to stub DataCore → 

## DataCore blob API (open datacore/src/datacore/api/document_routes.py)
- Does POST /api/documents/{tenant_id} require an auth dependency? → 
- Accepted body fields → 
- `uploaded_by`: **already bound, do not re-decide.** DataCore requires the field and cannot verify it, so this facade MUST derive it — `parent:{application entity_id}` for a parent upload — and MUST NOT accept it from the client. Confirm only that DataCore still requires it (roadmap, DataCore blob API). → 
- 201 response keys → 
- GET /api/documents/{tenant_id}/{document_id}/url auth + response keys → 

## flow-runtime (open flow-runtime/src/FlowRenderer.tsx and its use in enrollx-frontend)
- Full FlowRendererProps interface (verbatim) → 
- enrollx-frontend file that mounts FlowRenderer for staff-assisted entry (path) → 
- Callback props and their exact signatures (save, complete item, submit, upload) → 

## familyhub frontend scaffold (Plan 1)
- config.ts exported API-base constant name → 
- translations file path + export shape → 
- App.tsx current route structure → 
- theme.css present? which token names for card bg / text / accent (--bg-card, --text-primary, --accent-ink expected) → 

## entities
- program entity name field key in base_model.json (name vs program_name) → 
```

Discovery commands (run all; augment with reading the files they point at):

```bash
cd /Users/kennylee/Development/NeoApex
grep -rn "X-Internal-Key\|internal_key" enrollx/backend/app | head -30
grep -rn "application-by-token\|request-link\|checkout" enrollx/backend/app/api | head -40
grep -rn "registration_config\|capacity" enrollx/backend/app | head -40
grep -rn "def \|Depends\|BaseModel" datacore/src/datacore/api/document_routes.py | head -30
sed -n '1,80p' flow-runtime/src/FlowRenderer.tsx
grep -rn "FlowRenderer" enrollx/frontend/src | head
grep -n "API_URL\|svcUrl" familyhub/frontend/src/config.ts
ls familyhub/frontend/src/i18n familyhub/frontend/src/hooks
python3 -c "import json; d=json.load(open('launchpad/backend/app/data/base_model.json')); import sys; print([f for f in d['program'].get('base_fields', d['program'].get('fields', []))])"
```

- [ ] **Step 2:** If any of these is MISSING from the enrollx code (not merely differently named): internal start / application-by-token GET / actions / request-link / checkout routes, or the X-Internal-Key guard — STOP and report to the human; Plans 2–3 did not deliver their contract and this plan cannot proceed on that route.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-03-registration-plan5-bindings.md
git commit -m "docs(registration): plan-5 bindings — actual interface names from plans 1-4"
```

---

### Task 2: enrollx internal additions — public config bundle, documents list, tenant-scoped request-link

Three small internal routes in enrollx-backend (guarded by the SAME `X-Internal-Key` dependency Plan 2 built), so that familyhub never needs DataCore query access. All three live in the same module as Plan 2's existing internal routes.

**Files:**
- Modify: the enrollx internal router module recorded in bindings (e.g. `enrollx/backend/app/api/internal.py`)
- Create: `enrollx/backend/tests/test_internal_plan5_routes.py`

**Interfaces:**
- Consumes: Plan 2's `require_internal_key` dependency, its no-JWT DataCore read helper, its published-config loader, its capacity helper, its request-link/resend machinery (all named in bindings).
- Produces:
  - `GET /internal/registration/{tenant_id}/{program_id}/config` → `200 {"config": {...registration_config...}, "program": {"program_id", "name", "capacity", "is_full"}}`; `404 {"detail": ...}` if no published config or no such program. No caller identity — this is public data (a published flow) served over the private network.
  - `GET /internal/application-by-token/{token}/documents` → `200 {"documents": [<document entities>]}` for the token's application; token errors identical to Plan 2's application-by-token GET.
  - `POST /internal/registration/{tenant_id}/request-link` body `{"email": str, "program_id": str|null}` → `200 {"sent": <n>}` after re-sending magic links for every non-terminal application in the tenant whose `applicant_email` matches (case-insensitive); `200 {"sent": 0}` when nothing matches. Never 404 — the facade's constant-200 contract starts here.

- [ ] **Step 1 (conditional skip check):** If bindings show Plan 2/3 ALREADY provides an equivalent route (same semantics, any path) for any of the three, reuse that route (record its path in the bindings file under a `## Task 2 outcomes` heading) and skip building the duplicate. Build only what is missing. The steps below assume all three are missing.

- [ ] **Step 2: Write failing tests.** Open the existing internal-route test file named in bindings and copy its DataCore-stubbing fixture block VERBATIM into the new test file (that fixture is Plan 2's established seam; do not invent a new one). Then add these tests, adapting only the stub-seeding calls to that fixture's API:

```python
# enrollx/backend/tests/test_internal_plan5_routes.py
"""Plan 5 internal routes: public config bundle, documents list, tenant request-link.

The DataCore-stubbing fixture block below must be copied verbatim from the
existing internal-route test file (see bindings: 'Existing internal-route
test file'). The tests then only seed data through that fixture.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

# <<< PASTE Plan 2's DataCore stub fixture block here, verbatim >>>

INTERNAL_HEADERS = {"X-Internal-Key": "test-internal-key"}  # ADJUST(bindings): dev/test key value used by the existing internal tests


def test_config_bundle_requires_internal_key(client):
    resp = client.get("/internal/registration/acme/PR0001/config")
    assert resp.status_code in (401, 403)


def test_config_bundle_returns_published_config_and_program(client):
    # Seed via the pasted fixture: program PR0001 (name "Fall 2026", capacity 20)
    # and a PUBLISHED registration_config for PR0001.
    resp = client.get("/internal/registration/acme/PR0001/config", headers=INTERNAL_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["config"]["status"] == "published"
    assert body["program"]["name"] == "Fall 2026"
    assert body["program"]["is_full"] in (True, False)


def test_config_bundle_404_when_no_published_config(client):
    # Seed program PR0002 with only a DRAFT config.
    resp = client.get("/internal/registration/acme/PR0002/config", headers=INTERNAL_HEADERS)
    assert resp.status_code == 404


def test_documents_list_is_scoped_to_the_tokens_application(client):
    # Seed: application RA260001 with a valid token TOKEN_A (mint it exactly the
    # way the existing application-by-token tests mint theirs), plus document
    # entities DC0001 (application_id RA260001) and DC0002 (application_id RA260099).
    resp = client.get(f"/internal/application-by-token/{TOKEN_A}/documents", headers=INTERNAL_HEADERS)
    assert resp.status_code == 200
    ids = {d.get("base_data", d).get("document_id") for d in resp.json()["documents"]}
    assert ids == {"DC0001"}


def test_documents_list_rejects_bad_token(client):
    resp = client.get("/internal/application-by-token/not-a-real-token/documents", headers=INTERNAL_HEADERS)
    assert resp.status_code in (400, 401, 404)


def test_request_link_matching_email_sends_and_reports_count(client):
    # Seed: application RA260001, applicant_email parent@example.com, status draft.
    resp = client.post(
        "/internal/registration/acme/request-link",
        json={"email": "Parent@Example.com", "program_id": None},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["sent"] == 1


def test_request_link_no_match_is_still_200(client):
    resp = client.post(
        "/internal/registration/acme/request-link",
        json={"email": "nobody@example.com", "program_id": None},
        headers=INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["sent"] == 0
```

- [ ] **Step 3:** Run and watch them fail (404s on the new paths):

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_internal_plan5_routes.py -v
```

- [ ] **Step 4: Implement.** Append to the internal router module. The skeleton below is complete except for the four `ADJUST(bindings)` import/call lines, which must be re-pointed at Plan 2's real helpers (each does exactly what its comment says — the existing `/start` and application-by-token handlers already contain working examples of every one of these calls; mirror those handlers line-for-line where marked REUSE):

```python
# --- Plan 5 additions: familyhub-facing internal routes ---------------------
from fastapi import HTTPException

from app.registration.store import read_entities  # ADJUST(bindings): the no-JWT DataCore read helper
from app.registration.config_loader import load_published_config  # ADJUST(bindings): the loader /start uses
from app.registration.capacity import program_is_full  # ADJUST(bindings): Plan 2's waitlist/capacity helper
from app.registration.links import send_magic_link  # ADJUST(bindings): Plan 2's resend machinery


def _data(entity: dict) -> dict:
    inner = entity.get("base_data") if isinstance(entity, dict) else None
    return inner if isinstance(inner, dict) else (entity or {})


@router.get("/internal/registration/{tenant_id}/{program_id}/config")
def internal_config_bundle(tenant_id: str, program_id: str, _=Depends(require_internal_key)):
    config = load_published_config(tenant_id, program_id)  # ADJUST(bindings): call shape
    if config is None:
        raise HTTPException(status_code=404, detail="No published registration flow for this program")
    programs = read_entities(tenant_id, "program", {"program_id": program_id})  # ADJUST(bindings): call shape
    if not programs:
        raise HTTPException(status_code=404, detail="No such program")
    p = _data(programs[0])
    return {
        "config": config,
        "program": {
            "program_id": program_id,
            "name": p.get("name", ""),
            "capacity": p.get("capacity"),
            "is_full": program_is_full(tenant_id, program_id),  # ADJUST(bindings): call shape
        },
    }


@router.get("/internal/application-by-token/{token}/documents")
def internal_documents_for_token(token: str, _=Depends(require_internal_key)):
    # REUSE: resolve + validate the token EXACTLY as the existing
    # GET /internal/application-by-token/{token} handler does (copy its
    # token-resolution lines verbatim, yielding tenant_id + application_id,
    # with the same error responses on bad/expired/revoked tokens).
    tenant_id, application_id = _resolve_token_or_raise(token)  # ADJUST(bindings): the reused lines
    documents = read_entities(tenant_id, "document", {"application_id": application_id})  # ADJUST(bindings): call shape
    return {"documents": documents}


@router.post("/internal/registration/{tenant_id}/request-link")
def internal_request_link(tenant_id: str, body: dict, _=Depends(require_internal_key)):
    email = str(body.get("email", "")).strip().lower()
    program_id = body.get("program_id")
    if not email:
        return {"sent": 0}
    apps = read_entities(tenant_id, "registration_application", {})  # ADJUST(bindings): call shape
    sent = 0
    for app_entity in apps:
        a = _data(app_entity)
        if str(a.get("applicant_email", "")).strip().lower() != email:
            continue
        if program_id and a.get("program_id") != program_id:
            continue
        if a.get("status") in ("declined", "withdrawn"):
            continue
        send_magic_link(tenant_id, a)  # ADJUST(bindings): the same call resend_link uses
        sent += 1
    return {"sent": sent}
```

- [ ] **Step 5:** Run the new tests, then the FULL enrollx suite:

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/ -v
```

Expected: all PASS.

- [ ] **Step 6:** Append a `## Task 2 outcomes` section to the bindings file recording the three final route paths and response keys exactly as implemented, then commit:

```bash
git add enrollx/backend docs/superpowers/plans/2026-08-03-registration-plan5-bindings.md
git commit -m "feat(enrollx): internal config-bundle, documents-list, and tenant request-link routes for familyhub"
```

---

### Task 3: familyhub backend plumbing — settings, upstream seam, token parser, rate limiter

**Files:**
- Modify: `familyhub/backend/app/config.py`
- Create: `familyhub/backend/app/upstream.py`
- Create: `familyhub/backend/app/tokenutil.py`
- Create: `familyhub/backend/app/ratelimit.py`
- Create: `familyhub/backend/tests/test_ratelimit.py`
- Create: `familyhub/backend/tests/test_tokenutil.py`

**Interfaces:**
- Consumes: Plan 1's `familyhub/backend/app/config.py` (fields `enrollx_url`, `datacore_url` already exist).
- Produces: `settings.enrollx_internal_key`; `call_upstream(method, url, *, json_body, content, headers) -> httpx.Response` (502 on connection error) — the single monkeypatch seam for ALL tests; `parse_token(token) -> (tenant_id, application_id)`; `limit_start` / `limit_request_link` FastAPI dependencies (10 requests/IP/60s → 429).

- [ ] **Step 1: Write failing tests**

```python
# familyhub/backend/tests/test_ratelimit.py
"""In-memory per-IP throttling: 10 per rolling 60s window, then 429."""
import pytest
from fastapi import HTTPException

from app.ratelimit import RateLimiter


def test_allows_up_to_max_within_window():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0 + i)  # no raise


def test_eleventh_request_in_window_is_429():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0 + i)
    with pytest.raises(HTTPException) as exc:
        rl.check("1.2.3.4", now=110.0)
    assert exc.value.status_code == 429


def test_window_slides():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0 + i)
    rl.check("1.2.3.4", now=161.0)  # first hit (t=100) has aged out -> allowed


def test_ips_are_independent():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0)
    rl.check("5.6.7.8", now=100.0)  # different key, no raise
```

```python
# familyhub/backend/tests/test_tokenutil.py
"""Token PARSING only — familyhub never verifies signatures (enrollx does)."""
import base64

import pytest
from fastapi import HTTPException

from app.tokenutil import parse_token


def make_token(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def test_parses_tenant_and_application():
    token = make_token("acme.RA260001.fakesignature")
    assert parse_token(token) == ("acme", "RA260001")


def test_signature_may_itself_contain_dots():
    token = make_token("acme.RA260001.sig.with.dots")
    assert parse_token(token) == ("acme", "RA260001")


def test_malformed_token_is_400():
    with pytest.raises(HTTPException) as exc:
        parse_token("!!!not-base64!!!")
    assert exc.value.status_code == 400


def test_token_without_three_parts_is_400():
    with pytest.raises(HTTPException):
        parse_token(make_token("no-dots-here"))
```

- [ ] **Step 2:** Run and watch them fail (module not found):

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/test_ratelimit.py backend/tests/test_tokenutil.py -v
```

- [ ] **Step 3: Implement `config.py`.** Diff against the existing file first (`git diff` nothing yet — just read it); Plan 1 created it with `enrollx_url`/`datacore_url`. Add `enrollx_internal_key` and the production check, preserving any field a later plan may have added. Target content:

```python
# familyhub/backend/app/config.py
"""Configuration for familyhub backend service."""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FAMILYHUB_", case_sensitive=False)

    environment: str = "development"
    enrollx_url: str = "http://localhost:5910"
    datacore_url: str = "http://localhost:5800"
    # Must equal enrollx's ENROLLX_INTERNAL_KEY. Dev default below must match
    # enrollx's dev default:
    enrollx_internal_key: str = "dev-internal-key"  # ADJUST(bindings): enrollx dev default
    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 6010

    @model_validator(mode="after")
    def parse_and_validate(self):
        raw = self.cors_allowed_origins
        if isinstance(raw, str):
            origins = [o.strip() for o in raw.split(",") if o.strip()]
        elif raw is None:
            origins = []
        else:
            origins = list(raw)

        if self.environment == "production":
            if not origins:
                raise ValueError(
                    "FAMILYHUB_CORS_ALLOWED_ORIGINS is required in production and must not be empty"
                )
            if "*" in origins:
                raise ValueError(
                    "wildcard '*' in FAMILYHUB_CORS_ALLOWED_ORIGINS is not permitted in production"
                )
            if not self.enrollx_internal_key or self.enrollx_internal_key == "dev-internal-key":
                raise ValueError(
                    "FAMILYHUB_ENROLLX_INTERNAL_KEY must be set to a real secret in production"
                )
        elif not origins:
            origins = ["http://localhost:6000"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self


settings = Settings()
```

- [ ] **Step 4: Implement `upstream.py`**

```python
# familyhub/backend/app/upstream.py
"""Outbound HTTP to enrollx (internal API) and DataCore (blob API).

Every upstream call in this service goes through call_upstream so tests can
monkeypatch ONE seam: app.upstream.httpx.request.
"""
from typing import Optional

import httpx
from fastapi import HTTPException, status

from app.config import settings


def call_upstream(
    method: str,
    url: str,
    *,
    json_body: Optional[dict] = None,
    content: Optional[bytes] = None,
    headers: Optional[dict] = None,
) -> httpx.Response:
    try:
        return httpx.request(
            method,
            url,
            json=json_body,
            content=content,
            headers=headers or {},
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream service unreachable",
        )


def internal_headers() -> dict:
    return {"X-Internal-Key": settings.enrollx_internal_key}


def enrollx(path: str) -> str:
    return f"{settings.enrollx_url}{path}"


def datacore(path: str) -> str:
    return f"{settings.datacore_url}{path}"
```

- [ ] **Step 5: Implement `tokenutil.py`**

```python
# familyhub/backend/app/tokenutil.py
"""Decode (NOT verify) magic-link tokens.

Token format (roadmap contract): URL-safe base64 of
"{tenant_id}.{application_id}.{signature}". familyhub only ever decodes to
learn which tenant/application to address AFTER enrollx has already
verified the signature via an internal application-by-token call. Never
call parse_token on a token that enrollx has not just validated.
"""
import base64

from fastapi import HTTPException, status


def parse_token(token: str) -> tuple[str, str]:
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, application_id, _signature = raw.split(".", 2)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Malformed token")
    if not tenant_id or not application_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Malformed token")
    return tenant_id, application_id
```

- [ ] **Step 6: Implement `ratelimit.py`**

```python
# familyhub/backend/app/ratelimit.py
"""Minimal in-memory per-IP throttling for the two unauthenticated
"spendy" routes (start + request-link). Deliberately simple: stdlib only,
per-process state (fine for the beta single-instance deploy; a shared
store is a documented follow-up if familyhub ever scales out).
"""
import time
from collections import deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = {}

    def check(self, key: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        q = self._hits.setdefault(key, deque())
        cutoff = now - self.window_seconds
        while q and q[0] <= cutoff:
            q.popleft()
        if len(q) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests; please wait a minute and try again",
            )
        q.append(now)


start_limiter = RateLimiter(max_requests=10, window_seconds=60.0)
request_link_limiter = RateLimiter(max_requests=10, window_seconds=60.0)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def limit_start(request: Request) -> None:
    start_limiter.check(_client_ip(request))


def limit_request_link(request: Request) -> None:
    request_link_limiter.check(_client_ip(request))
```

- [ ] **Step 7:** Run new tests + full familyhub suite:

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
```

Expected: all PASS (health test from Plan 1 still green).

- [ ] **Step 8: Commit**

```bash
git add familyhub/backend
git commit -m "feat(familyhub): settings, upstream seam, token parser, in-memory rate limiter"
```

---

### Task 4: Facade — public registration routes (config bundle + start)

**Files:**
- Create: `familyhub/backend/app/api/registration.py`
- Modify: `familyhub/backend/app/main.py`
- Create: `familyhub/backend/tests/test_registration_routes.py`

**Interfaces:**
- Consumes: `GET /internal/registration/{tenant_id}/{program_id}/config` and `POST /internal/registration/{tenant_id}/{program_id}/start` (enrollx, X-Internal-Key), `limit_start`, `call_upstream`.
- Produces: `GET /api/registration/{tenant_id}/{program_id}` (pass-through of the bundle) and `POST /api/registration/{tenant_id}/{program_id}/start` body `{"applicant_email": str}` → enrollx's start response plus `"hub_url": "/application/{token}"`. Consumed by RegisterPage (Task 8).

- [ ] **Step 1: Write failing tests**

```python
# familyhub/backend/tests/test_registration_routes.py
"""Public registration facade: config bundle + start (rate limited)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import request_link_limiter, start_limiter


class FakeResponse:
    def __init__(self, status_code, json_body=None, content=None, content_type="application/json"):
        self.status_code = status_code
        self._json = json_body
        self.content = content if content is not None else json.dumps(json_body or {}).encode()
        self.headers = {"content-type": content_type}

    def json(self):
        if self._json is None:
            return json.loads(self.content.decode())
        return self._json


class FakeHTTP:
    """Route table keyed by (METHOD, url substring). Records every call."""

    def __init__(self):
        self.routes = {}
        self.calls = []

    def add(self, method, url_part, response):
        self.routes[(method.upper(), url_part)] = response

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method.upper(), "url": url, **kwargs})
        for (m, part), resp in self.routes.items():
            if m == method.upper() and part in url:
                return resp
        raise AssertionError(f"Unexpected upstream call: {method} {url}")


@pytest.fixture
def fake_http(monkeypatch):
    fake = FakeHTTP()
    monkeypatch.setattr("app.upstream.httpx.request", fake.request)
    return fake


@pytest.fixture(autouse=True)
def internal_key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "enrollx_internal_key", "test-internal-key")


@pytest.fixture(autouse=True)
def reset_rate_limits():
    start_limiter._hits.clear()
    request_link_limiter._hits.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


BUNDLE = {
    "config": {"config_id": "RC0001", "program_id": "PR0001", "version": 1,
               "status": "published", "blocks": []},
    "program": {"program_id": "PR0001", "name": "Fall 2026", "capacity": 20, "is_full": False},
}


def test_config_bundle_passthrough(client, fake_http):
    fake_http.add("GET", "/internal/registration/acme/PR0001/config", FakeResponse(200, BUNDLE))
    resp = client.get("/api/registration/acme/PR0001")
    assert resp.status_code == 200
    assert resp.json()["program"]["name"] == "Fall 2026"
    # internal key was attached
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_config_bundle_404_passthrough(client, fake_http):
    fake_http.add("GET", "/internal/registration/acme/NOPE/config",
                  FakeResponse(404, {"detail": "No published registration flow for this program"}))
    resp = client.get("/api/registration/acme/NOPE")
    assert resp.status_code == 404


def test_start_returns_token_and_hub_url(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(201, {"application": {"base_data": {"application_id": "RA260001"}},
                                     "token": "tok123"}))
    resp = client.post("/api/registration/acme/PR0001/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"] == "tok123"
    assert body["hub_url"] == "/application/tok123"


def test_start_rejects_junk_email(client, fake_http):
    resp = client.post("/api/registration/acme/PR0001/start", json={"applicant_email": "junk"})
    assert resp.status_code == 422
    assert fake_http.calls == []  # never reached enrollx


def test_start_passes_through_upstream_errors(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(404, {"detail": "No such program"}))
    resp = client.post("/api/registration/acme/PR0001/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 404


def test_start_is_rate_limited_per_ip(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(201, {"token": "tok123"}))
    for _ in range(10):
        ok = client.post("/api/registration/acme/PR0001/start",
                         json={"applicant_email": "parent@example.com"})
        assert ok.status_code == 201
    throttled = client.post("/api/registration/acme/PR0001/start",
                            json={"applicant_email": "parent@example.com"})
    assert throttled.status_code == 429
```

- [ ] **Step 2:** Run and watch them fail (404 — routes not mounted):

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/test_registration_routes.py -v
```

- [ ] **Step 3: Implement `app/api/registration.py`**

```python
# familyhub/backend/app/api/registration.py
"""Public registration facade routes.

No credential at all on these two routes — the config bundle is public
data and start creates a draft + issues the magic link. start is rate
limited per IP because it sends email.
"""
from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.ratelimit import limit_start
from app.upstream import call_upstream, enrollx, internal_headers

router = APIRouter()


def _passthrough(resp) -> Response:
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


@router.get("/registration/{tenant_id}/{program_id}")
def get_registration_bundle(tenant_id: str, program_id: str) -> Response:
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/registration/{tenant_id}/{program_id}/config"),
        headers=internal_headers(),
    )
    return _passthrough(resp)


class StartBody(BaseModel):
    applicant_email: str

    @field_validator("applicant_email")
    @classmethod
    def basic_email_shape(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 6 or "@" not in v or "." not in v.rsplit("@", 1)[-1]:
            raise ValueError("invalid email address")
        return v


@router.post("/registration/{tenant_id}/{program_id}/start", dependencies=[Depends(limit_start)])
def start_registration(tenant_id: str, program_id: str, body: StartBody) -> Response:
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/registration/{tenant_id}/{program_id}/start"),
        json_body={"applicant_email": body.applicant_email},
        headers=internal_headers(),
    )
    if resp.status_code >= 400:
        return _passthrough(resp)
    data = resp.json()
    token = data.get("token", "")  # ADJUST(bindings): key holding the magic-link token in the start response
    data["hub_url"] = f"/application/{token}"
    return JSONResponse(data, status_code=resp.status_code)
```

- [ ] **Step 4: Mount in `main.py`** — replace the file with:

```python
# familyhub/backend/app/main.py
"""FastAPI application entry point for familyhub backend.

familyhub is the public, parent-facing facade. HARD CONSTRAINTS (spec §3):
- No JWT auth anywhere in this service.
- No generic query/entity routes. Ever.
- The only credential is the magic-link token in the URL path, validated
  by enrollx over the private network on every request that uses it.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, registration
from app.config import settings

app = FastAPI(
    title="FamilyHub Backend",
    description="Family-facing channel: registration runtime and parent hub",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(registration.router, prefix="/api", tags=["registration"])
```

(Tasks 5 and 6 each add exactly one more `include_router` line; nothing else in this file changes again.)

- [ ] **Step 5:** Run new tests + full familyhub suite — all PASS:

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add familyhub/backend
git commit -m "feat(familyhub): public config-bundle and rate-limited start facade routes"
```

---

### Task 5: Facade — application routes (hub bundle, allowlisted actions, request-link, checkout)

**Files:**
- Create: `familyhub/backend/app/api/application.py`
- Modify: `familyhub/backend/app/main.py` (one `include_router` line)
- Create: `familyhub/backend/tests/test_application_routes.py`

**Interfaces:**
- Consumes (enrollx internal, X-Internal-Key): `GET /internal/application-by-token/{token}`, `POST /internal/application-by-token/{token}/actions`, `POST /internal/registration/{tenant_id}/request-link` (Task 2), `POST /internal/application-by-token/{token}/checkout` (Plan 3 — exact path per bindings).
- Produces: `GET /api/application/{token}`, `PUT /api/application/{token}` (allowlist `save_draft|complete_item|submit`, 403 otherwise BEFORE any upstream call), `POST /api/application/request-link` (constant 200), `POST /api/application/{token}/checkout`. Consumed by HubPage/RegisterPage/RequestLinkPage.

- [ ] **Step 1: Write failing tests**

```python
# familyhub/backend/tests/test_application_routes.py
"""Token-scoped application facade: hub bundle, action allowlist,
constant-200 request-link, checkout."""
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import request_link_limiter, start_limiter


class FakeResponse:
    def __init__(self, status_code, json_body=None, content=None, content_type="application/json"):
        self.status_code = status_code
        self._json = json_body
        self.content = content if content is not None else json.dumps(json_body or {}).encode()
        self.headers = {"content-type": content_type}

    def json(self):
        if self._json is None:
            return json.loads(self.content.decode())
        return self._json


class FakeHTTP:
    """Route table keyed by (METHOD, url substring). Records every call."""

    def __init__(self):
        self.routes = {}
        self.calls = []

    def add(self, method, url_part, response):
        self.routes[(method.upper(), url_part)] = response

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method.upper(), "url": url, **kwargs})
        for (m, part), resp in self.routes.items():
            if m == method.upper() and part in url:
                return resp
        raise AssertionError(f"Unexpected upstream call: {method} {url}")


@pytest.fixture
def fake_http(monkeypatch):
    fake = FakeHTTP()
    monkeypatch.setattr("app.upstream.httpx.request", fake.request)
    return fake


@pytest.fixture(autouse=True)
def internal_key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "enrollx_internal_key", "test-internal-key")


@pytest.fixture(autouse=True)
def reset_rate_limits():
    start_limiter._hits.clear()
    request_link_limiter._hits.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


TOKEN = "tok123"
HUB_BUNDLE = {
    "application": {"base_data": {"application_id": "RA260001", "status": "submitted"}},
    "items": [],
    "config": {"config_id": "RC0001", "blocks": []},
}


def test_hub_bundle_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}", FakeResponse(200, HUB_BUNDLE))
    resp = client.get(f"/api/application/{TOKEN}")
    assert resp.status_code == 200
    assert resp.json()["application"]["base_data"]["application_id"] == "RA260001"
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_hub_bundle_expired_token_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(404, {"detail": "Invalid or expired link"}))
    resp = client.get(f"/api/application/{TOKEN}")
    assert resp.status_code == 404


def test_allowed_parent_action_is_proxied(client, fake_http):
    fake_http.add("POST", f"/internal/application-by-token/{TOKEN}/actions",
                  FakeResponse(200, {"status": "draft"}))
    resp = client.put(f"/api/application/{TOKEN}",
                      json={"action": "save_draft", "draft_data": {"child_name": "Mei"}})
    assert resp.status_code == 200
    sent = fake_http.calls[0]["json"]
    assert sent["action"] == "save_draft"


@pytest.mark.parametrize("action", [
    "approve", "decline", "request_changes", "verify_item", "reject_item",
    "waive_item", "record_offline_payment", "promote_waitlist",
    "publish_config", "resend_link", "delete_everything", "", None,
])
def test_staff_or_unknown_actions_are_403_before_any_proxying(client, fake_http, action):
    resp = client.put(f"/api/application/{TOKEN}", json={"action": action})
    assert resp.status_code == 403
    assert fake_http.calls == []  # THE critical assertion: nothing reached enrollx


def test_non_object_body_is_400(client, fake_http):
    resp = client.put(f"/api/application/{TOKEN}", json=["not", "a", "dict"])
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_request_link_match_and_no_match_are_indistinguishable(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/request-link", FakeResponse(200, {"sent": 1}))
    matched = client.post("/api/application/request-link",
                          json={"tenant_id": "acme", "email": "parent@example.com"})
    fake_http.routes.clear()
    fake_http.add("POST", "/internal/registration/acme/request-link", FakeResponse(200, {"sent": 0}))
    unmatched = client.post("/api/application/request-link",
                            json={"tenant_id": "acme", "email": "stranger@example.com"})
    assert matched.status_code == unmatched.status_code == 200
    assert matched.json() == unmatched.json() == {"status": "ok"}


def test_request_link_upstream_error_is_still_200(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/request-link",
                  FakeResponse(500, {"detail": "boom"}))
    resp = client.post("/api/application/request-link",
                       json={"tenant_id": "acme", "email": "parent@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_request_link_is_rate_limited(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/request-link", FakeResponse(200, {"sent": 0}))
    for _ in range(10):
        assert client.post("/api/application/request-link",
                           json={"tenant_id": "acme", "email": "p@example.com"}).status_code == 200
    throttled = client.post("/api/application/request-link",
                            json={"tenant_id": "acme", "email": "p@example.com"})
    assert throttled.status_code == 429


def test_checkout_passthrough(client, fake_http):
    fake_http.add("POST", f"/internal/application-by-token/{TOKEN}/checkout",
                  FakeResponse(200, {"checkout_url": "https://checkout.stripe.com/c/pay/cs_test"}))
    resp = client.post(f"/api/application/{TOKEN}/checkout")
    assert resp.status_code == 200
    assert "checkout_url" in resp.json()
```

- [ ] **Step 2:** Run and watch them fail:

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/test_application_routes.py -v
```

- [ ] **Step 3: Implement `app/api/application.py`**

```python
# familyhub/backend/app/api/application.py
"""Token-scoped application facade.

Every write is proxied to enrollx's internal API. The facade enforces the
parent action allowlist BEFORE proxying — enrollx enforces it again on the
internal route (defense in depth, per spec §2.1).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.ratelimit import limit_request_link
from app.upstream import call_upstream, enrollx, internal_headers

router = APIRouter()

PARENT_ACTIONS = {"save_draft", "complete_item", "submit"}


def _passthrough(resp) -> Response:
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


@router.get("/application/{token}")
def get_application(token: str) -> Response:
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/application-by-token/{token}"),
        headers=internal_headers(),
    )
    return _passthrough(resp)


@router.put("/application/{token}")
async def put_application(token: str, request: Request) -> Response:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body must be JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body must be a JSON object")
    action = payload.get("action")
    if action not in PARENT_ACTIONS:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Action not permitted via the family channel. "
                   "Allowed: complete_item, save_draft, submit",
        )
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/application-by-token/{token}/actions"),
        json_body=payload,
        headers=internal_headers(),
    )
    return _passthrough(resp)


class RequestLinkBody(BaseModel):
    tenant_id: str
    email: str
    program_id: Optional[str] = None


@router.post("/application/request-link", dependencies=[Depends(limit_request_link)])
def request_link(body: RequestLinkBody) -> dict:
    # Constant response: the caller must never learn whether the email
    # matched an application (no account enumeration). Upstream failures
    # are logged server-side by enrollx; the parent still sees "ok".
    call_upstream(
        "POST",
        enrollx(f"/internal/registration/{body.tenant_id}/request-link"),
        json_body={"email": body.email, "program_id": body.program_id},
        headers=internal_headers(),
    )
    return {"status": "ok"}


@router.post("/application/{token}/checkout")
def start_checkout(token: str) -> Response:
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/application-by-token/{token}/checkout"),  # ADJUST(bindings): Plan 3's internal checkout path
        headers=internal_headers(),
    )
    return _passthrough(resp)
```

Note on route ordering: `/application/request-link` is registered before FastAPI would need to disambiguate it from `/application/{token}` — they are different methods/paths (`POST .../request-link` vs `GET/PUT .../{token}`), and `POST /application/{token}/checkout` has an extra segment, so there is no conflict; keep the routes in the order shown anyway.

- [ ] **Step 4:** In `main.py`, add `application` to the `from app.api import ...` line and append:

```python
app.include_router(application.router, prefix="/api", tags=["application"])
```

- [ ] **Step 5:** Run new tests + full familyhub suite — all PASS:

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add familyhub/backend
git commit -m "feat(familyhub): hub bundle, allowlisted parent actions, constant-200 request-link, checkout facade"
```

---

### Task 6: Facade — token-scoped document routes

**Files:**
- Create: `familyhub/backend/app/api/documents.py`
- Modify: `familyhub/backend/app/main.py` (one `include_router` line)
- Create: `familyhub/backend/tests/test_document_routes.py`

**Interfaces:**
- Consumes: `GET /internal/application-by-token/{token}` + `GET /internal/application-by-token/{token}/documents` (enrollx); `POST /api/documents/{tenant_id}` + `GET /api/documents/{tenant_id}/{document_id}/url` (DataCore blob API, roadmap contract); `parse_token`.
- Produces: `POST /api/application/{token}/documents` body `{item_id?, filename, content_type, size}` → DataCore's `201 {document_id, upload_url, storage_key}` passed through; `GET /api/application/{token}/documents/{document_id}/url` → `200 {download_url}` ONLY for documents with `uploaded_by == "parent:{application_id}"`. Consumed by the upload affordances in Tasks 8–9.

- [ ] **Step 1: Write failing tests**

```python
# familyhub/backend/tests/test_document_routes.py
"""Token-scoped document facade: upload slots + download URLs.

Parents may fetch download URLs ONLY for documents they uploaded
(uploaded_by == "parent:{application_id}") on their own application.
"""
import base64
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import request_link_limiter, start_limiter


class FakeResponse:
    def __init__(self, status_code, json_body=None, content=None, content_type="application/json"):
        self.status_code = status_code
        self._json = json_body
        self.content = content if content is not None else json.dumps(json_body or {}).encode()
        self.headers = {"content-type": content_type}

    def json(self):
        if self._json is None:
            return json.loads(self.content.decode())
        return self._json


class FakeHTTP:
    """Route table keyed by (METHOD, url substring). Records every call."""

    def __init__(self):
        self.routes = {}
        self.calls = []

    def add(self, method, url_part, response):
        self.routes[(method.upper(), url_part)] = response

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method.upper(), "url": url, **kwargs})
        for (m, part), resp in self.routes.items():
            if m == method.upper() and part in url:
                return resp
        raise AssertionError(f"Unexpected upstream call: {method} {url}")


@pytest.fixture
def fake_http(monkeypatch):
    fake = FakeHTTP()
    monkeypatch.setattr("app.upstream.httpx.request", fake.request)
    return fake


@pytest.fixture(autouse=True)
def internal_key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "enrollx_internal_key", "test-internal-key")


@pytest.fixture(autouse=True)
def reset_rate_limits():
    start_limiter._hits.clear()
    request_link_limiter._hits.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


# Real-format token: urlsafe-b64("acme.RA260001.<sig>") — facade decodes it
# for tenant/application only AFTER enrollx validates via internal GET.
TOKEN = base64.urlsafe_b64encode(b"acme.RA260001.fakesignature").decode().rstrip("=")

HUB_BUNDLE = {
    "application": {"base_data": {"application_id": "RA260001", "status": "pending_items"}},
    "items": [
        {"base_data": {"item_id": "AI0001", "application_id": "RA260001",
                       "block_id": "b-docs", "kind": "document",
                       "title": "Immunization record", "status": "not_started"}},
        {"base_data": {"item_id": "AI0002", "application_id": "RA260001",
                       "block_id": "b-form", "kind": "form",
                       "title": "Student information", "status": "verified"}},
    ],
    "config": {
        "config_id": "RC0001", "program_id": "PR0001", "version": 1, "status": "published",
        "blocks": [
            {"block_id": "b-docs", "type": "documents", "title": "Documents",
             "required": True, "blocking": True,
             "config": {"docs": [{"name": "Immunization record", "sensitive": True,
                                  "blocking": True}]}},
        ],
    },
}

DOCUMENTS = {
    "documents": [
        {"base_data": {"document_id": "DC0001", "application_id": "RA260001",
                       "uploaded_by": "parent:RA260001", "filename": "shots.pdf",
                       "storage_key": "acme/RA260001/DC0001/shots.pdf"}},
        {"base_data": {"document_id": "DC0002", "application_id": "RA260001",
                       "uploaded_by": "U42", "filename": "staff-scan.pdf",
                       "storage_key": "acme/RA260001/DC0002/staff-scan.pdf"}},
    ]
}


def _arm_token(fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}/documents", FakeResponse(200, DOCUMENTS))
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}", FakeResponse(200, HUB_BUNDLE))


def test_upload_slot_created_with_parent_uploader_and_derived_sensitive(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("POST", "/api/documents/acme",
                  FakeResponse(201, {"document_id": "DC0003",
                                     "upload_url": "https://r2.example/put",
                                     "storage_key": "acme/RA260001/DC0003/shots.pdf"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": "AI0001", "filename": "shots.pdf",
                             "content_type": "application/pdf", "size": 12345})
    assert resp.status_code == 201
    assert resp.json()["upload_url"] == "https://r2.example/put"
    datacore_call = [c for c in fake_http.calls if "/api/documents/acme" in c["url"]][0]
    sent = datacore_call["json"]
    assert sent["uploaded_by"] == "parent:RA260001"
    assert sent["sensitive"] is True  # derived from the config's docs block
    assert sent["application_id"] == "RA260001"


def test_upload_rejects_non_document_item(client, fake_http):
    _arm_token(fake_http)
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": "AI0002", "filename": "x.pdf",
                             "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 400


def test_upload_rejects_disallowed_content_type(client, fake_http):
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.exe", "content_type": "application/x-msdownload",
                             "size": 10})
    assert resp.status_code == 415
    assert fake_http.calls == []


def test_upload_rejects_oversize(client, fake_http):
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 21 * 1024 * 1024})
    assert resp.status_code == 413
    assert fake_http.calls == []


def test_upload_with_invalid_token_is_rejected(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(404, {"detail": "Invalid or expired link"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 404
    # DataCore must never have been called
    assert all("/api/documents/" not in c["url"] for c in fake_http.calls)


def test_download_own_document(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("GET", "/api/documents/acme/DC0001/url",
                  FakeResponse(200, {"download_url": "https://r2.example/get"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://r2.example/get"


def test_download_staff_uploaded_document_is_403(client, fake_http):
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0002/url")
    assert resp.status_code == 403
    assert all("/api/documents/acme/DC0002" not in c["url"] for c in fake_http.calls)


def test_download_unknown_document_is_404(client, fake_http):
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/DC9999/url")
    assert resp.status_code == 404
```

- [ ] **Step 2:** Run and watch them fail:

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/test_document_routes.py -v
```

- [ ] **Step 3: Implement `app/api/documents.py`**

```python
# familyhub/backend/app/api/documents.py
"""Token-scoped document facade (spec §8: familyhub proxies presign for parents).

Authorization order for every route:
1. enrollx validates the token (internal application-by-token GET) — the
   ONLY signature check; parse_token is used afterwards purely to learn
   tenant/application for the DataCore path.
2. Facade checks (item kind on upload; uploaded_by ownership on download).
3. Only then is DataCore's blob API called.
"""
import json as jsonlib
from typing import Optional

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel

from app.tokenutil import parse_token
from app.upstream import call_upstream, datacore, enrollx, internal_headers

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_SIZE_BYTES = 20 * 1024 * 1024


def _passthrough(resp) -> Response:
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


def _data(entity) -> dict:
    if not isinstance(entity, dict):
        return {}
    inner = entity.get("base_data")
    return inner if isinstance(inner, dict) else entity


def _load_bundle(token: str) -> dict:
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/application-by-token/{token}"),
        headers=internal_headers(),
    )
    if resp.status_code != 200:
        code = resp.status_code if resp.status_code in (400, 401, 403, 404, 410) \
            else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(code, detail="Invalid or expired link")
    return resp.json()


def _sensitive_for(config: dict, item_data: dict) -> bool:
    """Look up the doc definition matching this item in the config's
    documents block. Default False if anything is missing — DataCore's
    sensitive gate is a restriction on staff-side viewing; the parent-only
    ownership rule below is what protects parents' own documents."""
    blocks = (config or {}).get("blocks", [])
    if isinstance(blocks, str):
        try:
            blocks = jsonlib.loads(blocks)
        except (ValueError, TypeError):
            return False
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        if block.get("block_id") != item_data.get("block_id"):
            continue
        for doc in (block.get("config") or {}).get("docs", []) or []:
            if isinstance(doc, dict) and doc.get("name") == item_data.get("title"):
                return bool(doc.get("sensitive", False))
    return False


class CreateDocumentBody(BaseModel):
    item_id: Optional[str] = None
    filename: str
    content_type: str
    size: int


@router.post("/application/{token}/documents")
def create_document(token: str, body: CreateDocumentBody) -> Response:
    if body.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Accepted types: pdf, jpeg, png, heic, docx",
        )
    if body.size <= 0 or body.size > MAX_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File must be between 1 byte and 20 MB",
        )
    bundle = _load_bundle(token)
    tenant_id, application_id = parse_token(token)

    sensitive = False
    if body.item_id is not None:
        item = next(
            (i for i in bundle.get("items", []) if _data(i).get("item_id") == body.item_id),
            None,
        )
        if item is None or _data(item).get("kind") != "document":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="item_id does not name a document item of this application",
            )
        sensitive = _sensitive_for(bundle.get("config", {}), _data(item))

    resp = call_upstream(
        "POST",
        datacore(f"/api/documents/{tenant_id}"),
        json_body={
            "application_id": application_id,
            "item_id": body.item_id,
            "filename": body.filename,
            "content_type": body.content_type,
            "size": body.size,
            "sensitive": sensitive,
            # Derived here, never taken from `body` — see the roadmap's blob
            # API contract. `application_id` comes from the signed token, so
            # this value is as trustworthy as the token itself.
            "uploaded_by": f"parent:{application_id}",
        },
    )
    return _passthrough(resp)


@router.get("/application/{token}/documents/{document_id}/url")
def get_document_url(token: str, document_id: str) -> Response:
    _load_bundle(token)  # validates signature/expiry/revocation via enrollx
    tenant_id, application_id = parse_token(token)

    resp = call_upstream(
        "GET",
        enrollx(f"/internal/application-by-token/{token}/documents"),
        headers=internal_headers(),
    )
    if resp.status_code != 200:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Could not list application documents")
    documents = resp.json().get("documents", [])
    doc = next((d for d in documents if _data(d).get("document_id") == document_id), None)
    if doc is None:
        # Covers unknown ids AND other applications' ids: the list is
        # already scoped to the token's application by enrollx.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such document on this application")
    if _data(doc).get("uploaded_by") != f"parent:{application_id}":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Parents may only view documents they uploaded themselves",
        )
    dresp = call_upstream("GET", datacore(f"/api/documents/{tenant_id}/{document_id}/url"))
    return _passthrough(dresp)
```

**Note (bindings check):** if the bindings file says DataCore's blob routes carry an auth dependency (they should not, per the roadmap contract, which defines no auth header for the private-network blob API), STOP and report — do not invent a service credential for familyhub.

- [ ] **Step 4:** In `main.py`, add `documents` to the `from app.api import ...` line and append:

```python
app.include_router(documents.router, prefix="/api", tags=["documents"])
```

- [ ] **Step 5:** Run new tests + FULL familyhub suite — all PASS:

```bash
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add familyhub/backend
git commit -m "feat(familyhub): token-scoped document upload slots and ownership-gated download URLs"
```

---

### Task 7: Frontend — facade API client, types, i18n strings

**Files:**
- Create: `familyhub/frontend/src/types/registration.ts`
- Create: `familyhub/frontend/src/api/facade.ts`
- Modify: `familyhub/frontend/src/i18n/translations.ts` (path per bindings — Plan 1 copied admindash's i18n in)

**Interfaces:**
- Consumes: every facade route from Tasks 4–6; `RegistrationConfigDef` from `@neoapex/flow-runtime`; the API-base constant from `src/config.ts`.
- Produces: `fetchRegistrationBundle`, `startRegistration`, `fetchApplication`, `saveDraft`, `completeItem`, `submitApplication`, `requestLink`, `createDocumentSlot`, `uploadDocumentFile`, `getDocumentUrl`, `startCheckout`, `decodeToken`, `entityData` + the types — consumed by Tasks 8–10.

- [ ] **Step 1: `src/types/registration.ts`**

```ts
import type { RegistrationConfigDef } from '@neoapex/flow-runtime';

/** DataCore entities arrive base_data-wrapped; tolerate both shapes. */
export interface EntityRecord {
  base_data?: Record<string, unknown>;
  [key: string]: unknown;
}

export function entityData(e: EntityRecord | undefined | null): Record<string, unknown> {
  if (!e || typeof e !== 'object') return {};
  const inner = e.base_data;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : (e as Record<string, unknown>);
}

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'in_review' | 'pending_items' | 'approved'
  | 'enrolled' | 'waitlisted' | 'declined' | 'withdrawn';

export type ItemStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'verified' | 'rejected' | 'waived';

export interface ProgramSummary {
  program_id: string;
  name: string;
  capacity?: number | null;
  is_full: boolean;
}

export interface RegistrationBundle {
  config: RegistrationConfigDef;
  program: ProgramSummary;
}

export interface StartResponse {
  token: string;
  hub_url: string;
  application?: EntityRecord;
}

export interface HubBundle {
  application: EntityRecord;
  items: EntityRecord[];
  config: RegistrationConfigDef;
}

export interface DocumentSlot {
  document_id: string;
  upload_url: string;
  storage_key?: string;
}
```

- [ ] **Step 2: `src/api/facade.ts`**

```ts
import { FAMILYHUB_API_URL } from '../config.ts'; // ADJUST(bindings): exported constant name in Plan 1's config.ts
import type {
  DocumentSlot,
  HubBundle,
  RegistrationBundle,
  StartResponse,
} from '../types/registration.ts';

const API_BASE = FAMILYHUB_API_URL;

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

export async function fetchRegistrationBundle(
  tenantId: string,
  programId: string,
): Promise<RegistrationBundle> {
  const resp = await fetch(`${API_BASE}/api/registration/${tenantId}/${programId}`);
  return jsonOrThrow<RegistrationBundle>(resp);
}

export async function startRegistration(
  tenantId: string,
  programId: string,
  applicantEmail: string,
): Promise<StartResponse> {
  const resp = await fetch(`${API_BASE}/api/registration/${tenantId}/${programId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicant_email: applicantEmail }),
  });
  return jsonOrThrow<StartResponse>(resp);
}

export async function fetchApplication(token: string): Promise<HubBundle> {
  const resp = await fetch(`${API_BASE}/api/application/${token}`);
  return jsonOrThrow<HubBundle>(resp);
}

async function putAction(
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/api/application/${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<Record<string, unknown>>(resp);
}

// ADJUST(bindings): the three param key names below (draft_data, item_id,
// payload_ref) must match the enrollx internal actions route's params.
export const saveDraft = (token: string, draftData: Record<string, unknown>) =>
  putAction(token, { action: 'save_draft', draft_data: draftData });

export const completeItem = (token: string, itemId: string, payloadRef?: string) =>
  putAction(token, {
    action: 'complete_item',
    item_id: itemId,
    ...(payloadRef ? { payload_ref: payloadRef } : {}),
  });

export const submitApplication = (token: string) => putAction(token, { action: 'submit' });

export async function requestLink(
  tenantId: string,
  email: string,
  programId?: string,
): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/application/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, email, program_id: programId ?? null }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function createDocumentSlot(
  token: string,
  meta: { item_id?: string; filename: string; content_type: string; size: number },
): Promise<DocumentSlot> {
  const resp = await fetch(`${API_BASE}/api/application/${token}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  return jsonOrThrow<DocumentSlot>(resp);
}

/** Full parent upload flow: slot -> R2 PUT -> complete_item. */
export async function uploadDocumentFile(
  token: string,
  itemId: string,
  file: File,
): Promise<string> {
  const contentType = file.type || 'application/pdf';
  const slot = await createDocumentSlot(token, {
    item_id: itemId,
    filename: file.name,
    content_type: contentType,
    size: file.size,
  });
  const put = await fetch(slot.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed: HTTP ${put.status}`);
  await completeItem(token, itemId, slot.document_id);
  return slot.document_id;
}

export async function getDocumentUrl(token: string, documentId: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/api/application/${token}/documents/${documentId}/url`);
  const body = await jsonOrThrow<{ download_url: string }>(resp);
  return body.download_url;
}

export async function startCheckout(token: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/api/application/${token}/checkout`, { method: 'POST' });
  const body = await jsonOrThrow<{ checkout_url: string }>(resp); // ADJUST(bindings): response key holding the Stripe URL
  return body.checkout_url;
}

/** Decode (NOT verify) the token to learn tenant/application for links. */
export function decodeToken(token: string): { tenantId: string; applicationId: string } | null {
  try {
    const padded = token + '='.repeat((4 - (token.length % 4)) % 4);
    const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const [tenantId, applicationId] = raw.split('.');
    if (!tenantId || !applicationId) return null;
    return { tenantId, applicationId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: i18n strings.** Open familyhub's translations file (bindings). Append EVERY key below to the `en-US` object and EVERY key to the `zh-CN` object (the file follows admindash's `Record<Locale, Record<string, string>>` shape):

```ts
    // en-US additions — registration runtime
    'register.loading': 'Loading registration…',
    'register.notFound': 'This registration link is not available. Check the address with your school.',
    'register.programFull': 'This program is currently full. You can still apply — you will be placed on the waitlist.',
    'register.emailLabel': 'Your email',
    'register.emailHelp': 'We will send you a private link to continue and track this application.',
    'register.start': 'Start application',
    'register.startError': 'Could not start the application. Please try again.',
    'register.invalidEmail': 'Please enter a valid email address.',
    'register.linkSent': 'A private link has been sent to your email. Save it — it is how you return to this application from any device.',
    'register.openHub': 'View application status',

    // Parent hub
    'hub.title': 'Your application',
    'hub.loading': 'Loading your application…',
    'hub.invalidLink': 'This link is invalid or has expired.',
    'hub.requestNewLink': 'Request a new link',
    'hub.checklist': 'Requirements',
    'hub.outstanding': 'Still needed from you',
    'hub.nothingOutstanding': 'Nothing is needed from you right now.',
    'hub.upload': 'Upload',
    'hub.uploading': 'Uploading…',
    'hub.uploadFailed': 'Upload failed. Please try again.',
    'hub.viewDocument': 'View',
    'hub.continueForm': 'Continue form',
    'hub.payNow': 'Pay now',
    'hub.payError': 'Could not start payment. Please try again.',
    'hub.submit': 'Submit application',
    'hub.submitError': 'Could not submit. Complete all required steps and try again.',
    'hub.blocking': 'Required before review',
    'hub.contactSchool': 'Questions? Contact your school directly.',

    // Application statuses
    'status.draft': 'Draft',
    'status.submitted': 'Submitted',
    'status.in_review': 'In review',
    'status.pending_items': 'Action needed',
    'status.approved': 'Approved',
    'status.enrolled': 'Enrolled',
    'status.waitlisted': 'Waitlisted',
    'status.declined': 'Declined',
    'status.withdrawn': 'Withdrawn',
    'statusBanner.draft': 'Your application is a draft — submit it once every required step is complete.',
    'statusBanner.submitted': 'Your application has been submitted and is waiting for review.',
    'statusBanner.in_review': 'The school is reviewing your application.',
    'statusBanner.pending_items': 'The school needs something more from you — see the list below.',
    'statusBanner.approved': 'Congratulations — your application is approved! Finish any remaining items below.',
    'statusBanner.enrolled': 'Enrollment complete. Welcome!',
    'statusBanner.waitlisted': 'The program is currently full. You are on the waitlist and will be contacted if a spot opens.',
    'statusBanner.declined': 'This application was not accepted. Contact the school if you have questions.',
    'statusBanner.withdrawn': 'This application has been withdrawn.',

    // Item statuses
    'itemStatus.not_started': 'Not started',
    'itemStatus.in_progress': 'In progress',
    'itemStatus.submitted': 'Submitted',
    'itemStatus.verified': 'Verified',
    'itemStatus.rejected': 'Needs attention',
    'itemStatus.waived': 'Waived',

    // Request link
    'requestLink.title': 'Get your application link',
    'requestLink.body': 'Enter the email you used to register. If it matches an application, we will email you a fresh link.',
    'requestLink.emailLabel': 'Email',
    'requestLink.tenantLabel': 'School code',
    'requestLink.send': 'Send link',
    'requestLink.sent': 'If that email matches an application, a link is on its way.',
    'requestLink.error': 'Something went wrong. Please try again.',

    // Shared
    'common.retry': 'Retry',
```

```ts
    // zh-CN additions — registration runtime
    'register.loading': '正在加载注册信息…',
    'register.notFound': '该注册链接不可用。请与学校核对网址。',
    'register.programFull': '该项目目前已满员。您仍可提交申请，将进入候补名单。',
    'register.emailLabel': '您的邮箱',
    'register.emailHelp': '我们会向您发送一个专属链接，用于继续填写和跟踪此申请。',
    'register.start': '开始申请',
    'register.startError': '无法开始申请，请重试。',
    'register.invalidEmail': '请输入有效的邮箱地址。',
    'register.linkSent': '专属链接已发送到您的邮箱。请妥善保存，您可在任何设备上通过它返回此申请。',
    'register.openHub': '查看申请状态',

    // Parent hub
    'hub.title': '您的申请',
    'hub.loading': '正在加载您的申请…',
    'hub.invalidLink': '该链接无效或已过期。',
    'hub.requestNewLink': '获取新链接',
    'hub.checklist': '申请项目',
    'hub.outstanding': '待您完成',
    'hub.nothingOutstanding': '目前无需您进行任何操作。',
    'hub.upload': '上传',
    'hub.uploading': '上传中…',
    'hub.uploadFailed': '上传失败，请重试。',
    'hub.viewDocument': '查看',
    'hub.continueForm': '继续填写',
    'hub.payNow': '立即支付',
    'hub.payError': '无法发起支付，请重试。',
    'hub.submit': '提交申请',
    'hub.submitError': '无法提交。请完成所有必填步骤后重试。',
    'hub.blocking': '审核前必须完成',
    'hub.contactSchool': '如有疑问，请直接联系学校。',

    // Application statuses
    'status.draft': '草稿',
    'status.submitted': '已提交',
    'status.in_review': '审核中',
    'status.pending_items': '需补充材料',
    'status.approved': '已录取',
    'status.enrolled': '已入学',
    'status.waitlisted': '候补中',
    'status.declined': '未录取',
    'status.withdrawn': '已撤回',
    'statusBanner.draft': '您的申请尚为草稿，完成所有必填步骤后请提交。',
    'statusBanner.submitted': '您的申请已提交，正在等待审核。',
    'statusBanner.in_review': '学校正在审核您的申请。',
    'statusBanner.pending_items': '学校需要您补充材料，请查看下方列表。',
    'statusBanner.approved': '恭喜，您的申请已通过！请完成下方剩余事项。',
    'statusBanner.enrolled': '入学手续已完成，欢迎加入！',
    'statusBanner.waitlisted': '该项目目前已满员。您已进入候补名单，如有名额我们会与您联系。',
    'statusBanner.declined': '该申请未被录取。如有疑问请联系学校。',
    'statusBanner.withdrawn': '该申请已撤回。',

    // Item statuses
    'itemStatus.not_started': '未开始',
    'itemStatus.in_progress': '进行中',
    'itemStatus.submitted': '已提交',
    'itemStatus.verified': '已核验',
    'itemStatus.rejected': '需重新处理',
    'itemStatus.waived': '已豁免',

    // Request link
    'requestLink.title': '找回申请链接',
    'requestLink.body': '请输入注册时使用的邮箱。如果与某个申请匹配，我们会向您发送新的链接。',
    'requestLink.emailLabel': '邮箱',
    'requestLink.tenantLabel': '学校代码',
    'requestLink.send': '发送链接',
    'requestLink.sent': '如果该邮箱与申请匹配，链接已发送。',
    'requestLink.error': '出现问题，请重试。',

    // Shared
    'common.retry': '重试',
```

- [ ] **Step 4:** Verify: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add familyhub/frontend/src
git commit -m "feat(familyhub): facade API client, registration types, en/zh strings"
```

---

### Task 8: Frontend — RegisterPage (email capture → start → FlowRenderer mode='parent')

**Files:**
- Create: `familyhub/frontend/src/pages/RegisterPage.tsx`
- Create: `familyhub/frontend/src/pages/RegisterPage.css`

**Interfaces:**
- Consumes: `fetchRegistrationBundle`, `startRegistration`, `fetchApplication`, `saveDraft`, `completeItem`, `submitApplication`, `uploadDocumentFile` (Task 7); `FlowRenderer` mode `'parent'` from `@neoapex/flow-runtime` (Plan 4's real renderer).
- Produces: route component for `/register/:tenantId/:programId`, resumable via `?token=` (the hub's "Continue form" link target).

- [ ] **Step 1 (binding step — do this BEFORE writing the JSX):** Read the FlowRendererProps interface and the enrollx-frontend staff-entry wiring recorded in bindings. The `<FlowRenderer …>` element below carries the roadmap-guaranteed props (`config`, `mode`) plus callback props under the names this plan expects; rename/reshape ONLY those callback props to Plan 4's actual interface, keeping each one bound to the same facade function. Every facade function the renderer could need already exists in Task 7 — no new fetch code may be written here.

- [ ] **Step 2: `RegisterPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FlowRenderer } from '@neoapex/flow-runtime';
import {
  completeItem,
  fetchApplication,
  fetchRegistrationBundle,
  saveDraft,
  startRegistration,
  submitApplication,
  uploadDocumentFile,
} from '../api/facade.ts';
import type { HubBundle, RegistrationBundle } from '../types/registration.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './RegisterPage.css';

type Phase = 'loading' | 'email' | 'running' | 'notFound';

export default function RegisterPage() {
  const { tenantId = '', programId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('loading');
  const [bundle, setBundle] = useState<RegistrationBundle | null>(null);
  const [hub, setHub] = useState<HubBundle | null>(null);
  const [token, setToken] = useState<string>(searchParams.get('token') ?? '');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  // Load the public config bundle (program name, capacity state, blocks).
  useEffect(() => {
    let cancelled = false;
    fetchRegistrationBundle(tenantId, programId)
      .then((b) => {
        if (cancelled) return;
        setBundle(b);
        setPhase(token ? 'loading' : 'email');
      })
      .catch(() => {
        if (!cancelled) setPhase('notFound');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, programId]);

  // Resume path: ?token= present -> load the application and run.
  useEffect(() => {
    if (!token || !bundle) return;
    let cancelled = false;
    fetchApplication(token)
      .then((h) => {
        if (cancelled) return;
        setHub(h);
        setPhase('running');
      })
      .catch(() => {
        if (!cancelled) setPhase('notFound');
      });
    return () => {
      cancelled = true;
    };
  }, [token, bundle]);

  const refreshHub = useCallback(async () => {
    if (!token) return;
    setHub(await fetchApplication(token));
  }, [token]);

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (value.length < 6 || !value.includes('@')) {
      setFormError(t('register.invalidEmail'));
      return;
    }
    setFormError(null);
    try {
      const started = await startRegistration(tenantId, programId, value);
      setToken(started.token);
      setLinkSent(true);
      const h = await fetchApplication(started.token);
      setHub(h);
      setPhase('running');
    } catch {
      setFormError(t('register.startError'));
    }
  }

  if (phase === 'loading') {
    return <div className="register-page"><p className="register-status">{t('register.loading')}</p></div>;
  }

  if (phase === 'notFound' || !bundle) {
    return (
      <div className="register-page">
        <p className="register-status" role="alert">{t('register.notFound')}</p>
        <Link className="register-link" to="/request-link">{t('hub.requestNewLink')}</Link>
      </div>
    );
  }

  if (phase === 'email') {
    return (
      <div className="register-page">
        <header className="register-header">
          <h1>{bundle.program.name}</h1>
          {bundle.program.is_full && (
            <p className="register-full-notice" role="status">{t('register.programFull')}</p>
          )}
        </header>
        <form className="register-email-form" onSubmit={onStart} noValidate>
          {formError && (
            <p className="register-error" role="alert">{formError}</p>
          )}
          <label htmlFor="applicant-email">{t('register.emailLabel')}</label>
          <input
            id="applicant-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="register-help">{t('register.emailHelp')}</p>
          <button type="submit" className="register-primary">{t('register.start')}</button>
        </form>
      </div>
    );
  }

  // phase === 'running'
  return (
    <div className="register-page">
      <header className="register-header">
        <h1>{bundle.program.name}</h1>
        {linkSent && (
          <p className="register-link-sent" role="status">{t('register.linkSent')}</p>
        )}
      </header>
      {hub && (
        <FlowRenderer
          config={hub.config}
          mode="parent"
          /* ADJUST(bindings): the props below must be renamed/reshaped to
             Plan 4's actual FlowRendererProps. Mirror the staff-entry
             wiring in enrollx-frontend, swapping its JWT-backed client
             calls for these facade calls. Do not add fetch logic here. */
          application={hub.application}
          items={hub.items}
          onSaveDraft={async (data: Record<string, unknown>) => {
            await saveDraft(token, data);
          }}
          onCompleteItem={async (itemId: string, payloadRef?: string) => {
            await completeItem(token, itemId, payloadRef);
            await refreshHub();
          }}
          onUploadDocument={async (itemId: string, file: File) => {
            await uploadDocumentFile(token, itemId, file);
            await refreshHub();
          }}
          onSubmit={async () => {
            await submitApplication(token);
            navigate(`/application/${token}`);
          }}
        />
      )}
      <p className="register-hub-link">
        <Link className="register-link" to={`/application/${token}`}>{t('register.openHub')}</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 3: `RegisterPage.css`** (mobile-first; tokens only — token names per bindings; the admindash-derived theme exposes `--bg-card`, `--text-primary`, `--text-secondary`, `--accent`, `--accent-ink`, `--border-color`):

```css
.register-page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-4, 16px);
}

.register-header h1 {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin: 0 0 var(--space-2, 8px);
}

.register-status {
  color: var(--text-secondary);
  padding: var(--space-4, 16px) 0;
}

.register-full-notice,
.register-link-sent {
  background: var(--bg-card);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: var(--space-3, 12px);
  color: var(--text-primary);
}

.register-error {
  color: var(--color-danger, #b3261e);
  margin: 0 0 var(--space-2, 8px);
}

.register-email-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  margin-top: var(--space-4, 16px);
}

.register-email-form label {
  color: var(--text-primary);
  font-weight: 600;
}

.register-email-form input {
  font-size: 1rem;          /* >=16px prevents iOS zoom-on-focus */
  min-height: 44px;         /* touch target */
  padding: 0 var(--space-3, 12px);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.register-help {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
}

.register-primary {
  min-height: 48px;
  border: none;
  border-radius: 8px;
  background: var(--accent-ink);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}

.register-link {
  color: var(--accent-ink);
}

.register-hub-link {
  margin-top: var(--space-4, 16px);
}

@media (min-width: 720px) {
  .register-page {
    padding: var(--space-6, 24px);
  }
  .register-header h1 {
    font-size: 1.75rem;
  }
}
```

(If lint flags the raw `#fff`/`#b3261e` fallbacks against the token-only rule and familyhub's theme.css already defines equivalents, replace them with the theme tokens named in bindings — that is the only permitted change.)

- [ ] **Step 4:** Verify: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build && npm run lint` — clean. (Route is added in Task 10; the build must still pass now.)

- [ ] **Step 5: Commit**

```bash
git add familyhub/frontend/src/pages/RegisterPage.tsx familyhub/frontend/src/pages/RegisterPage.css
git commit -m "feat(familyhub): parent registration runtime page (email capture -> FlowRenderer)"
```

---

### Task 9: Frontend — HubPage (parent status hub)

**Files:**
- Create: `familyhub/frontend/src/pages/HubPage.tsx`
- Create: `familyhub/frontend/src/pages/HubPage.css`

**Interfaces:**
- Consumes: `fetchApplication`, `submitApplication`, `uploadDocumentFile`, `getDocumentUrl`, `startCheckout`, `decodeToken`, `entityData` (Task 7).
- Produces: route component for `/application/:token` — status banner (all 9 statuses), item checklist with per-item status/tone, outstanding-actions list, upload/complete/pay affordances, terminal (withdrawn/declined) rendering.

- [ ] **Step 1: `HubPage.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  decodeToken,
  fetchApplication,
  getDocumentUrl,
  startCheckout,
  submitApplication,
  uploadDocumentFile,
} from '../api/facade.ts';
import {
  entityData,
  type ApplicationStatus,
  type HubBundle,
  type ItemStatus,
} from '../types/registration.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './HubPage.css';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  draft: 'info',
  submitted: 'info',
  in_review: 'info',
  pending_items: 'warning',
  approved: 'success',
  enrolled: 'success',
  waitlisted: 'warning',
  declined: 'danger',
  withdrawn: 'danger',
};

const ITEM_TONE: Record<ItemStatus, Tone> = {
  not_started: 'warning',
  in_progress: 'warning',
  submitted: 'info',
  verified: 'success',
  rejected: 'danger',
  waived: 'info',
};

const OUTSTANDING: ItemStatus[] = ['not_started', 'in_progress', 'rejected'];
const TERMINAL: ApplicationStatus[] = ['declined', 'withdrawn'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.docx';

function asStatus(value: unknown): ApplicationStatus {
  const all: ApplicationStatus[] = ['draft', 'submitted', 'in_review', 'pending_items',
    'approved', 'enrolled', 'waitlisted', 'declined', 'withdrawn'];
  return all.includes(value as ApplicationStatus) ? (value as ApplicationStatus) : 'draft';
}

function asItemStatus(value: unknown): ItemStatus {
  const all: ItemStatus[] = ['not_started', 'in_progress', 'submitted', 'verified',
    'rejected', 'waived'];
  return all.includes(value as ItemStatus) ? (value as ItemStatus) : 'not_started';
}

export default function HubPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const [hub, setHub] = useState<HubBundle | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    try {
      setHub(await fetchApplication(token));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (invalid) {
    return (
      <div className="hub-page">
        <p className="hub-banner tone-danger" role="alert">{t('hub.invalidLink')}</p>
        <Link className="hub-link" to="/request-link">{t('hub.requestNewLink')}</Link>
      </div>
    );
  }

  if (!hub) {
    return <div className="hub-page"><p className="hub-loading">{t('hub.loading')}</p></div>;
  }

  const app = entityData(hub.application);
  const status = asStatus(app.status);
  const terminal = TERMINAL.includes(status);
  const decoded = decodeToken(token);
  const items = hub.items ?? [];
  const outstanding = items.filter((i) =>
    OUTSTANDING.includes(asItemStatus(entityData(i).status)),
  );

  async function onUpload(itemId: string, file: File | null) {
    if (!file) return;
    setBusyItem(itemId);
    setActionError(null);
    try {
      await uploadDocumentFile(token, itemId, file);
      await load();
    } catch {
      setActionError(t('hub.uploadFailed'));
    } finally {
      setBusyItem(null);
    }
  }

  async function onPay(itemId: string) {
    setBusyItem(itemId);
    setActionError(null);
    try {
      window.location.href = await startCheckout(token);
    } catch {
      setActionError(t('hub.payError'));
      setBusyItem(null);
    }
  }

  async function onViewDocument(documentId: string) {
    try {
      const url = await getDocumentUrl(token, documentId);
      window.open(url, '_blank', 'noopener');
    } catch {
      setActionError(t('hub.uploadFailed'));
    }
  }

  async function onSubmit() {
    setActionError(null);
    try {
      await submitApplication(token);
      await load();
    } catch {
      setActionError(t('hub.submitError'));
    }
  }

  function affordance(item: Record<string, unknown>) {
    const itemStatus = asItemStatus(item.status);
    const itemId = String(item.item_id ?? '');
    const kind = String(item.kind ?? '');
    const documentId = typeof item.payload_ref === 'string' ? item.payload_ref : '';

    if (kind === 'document' && documentId && !OUTSTANDING.includes(itemStatus)) {
      return (
        <button type="button" className="hub-action secondary" onClick={() => onViewDocument(documentId)}>
          {t('hub.viewDocument')}
        </button>
      );
    }
    if (terminal || !OUTSTANDING.includes(itemStatus)) return null;

    if (kind === 'document') {
      return (
        <>
          <button
            type="button"
            className="hub-action"
            disabled={busyItem === itemId}
            onClick={() => fileInputs.current[itemId]?.click()}
          >
            {busyItem === itemId ? t('hub.uploading') : t('hub.upload')}
          </button>
          <input
            ref={(el) => { fileInputs.current[itemId] = el; }}
            type="file"
            accept={ACCEPT}
            className="hub-file-input"
            aria-label={`${t('hub.upload')}: ${String(item.title ?? '')}`}
            onChange={(e) => onUpload(itemId, e.target.files?.[0] ?? null)}
          />
        </>
      );
    }
    if (kind === 'form' && decoded) {
      return (
        <Link
          className="hub-action link"
          to={`/register/${decoded.tenantId}/${String(app.program_id ?? '')}?token=${token}`}
        >
          {t('hub.continueForm')}
        </Link>
      );
    }
    if (kind === 'payment') {
      return (
        <button
          type="button"
          className="hub-action"
          disabled={busyItem === itemId}
          onClick={() => onPay(itemId)}
        >
          {t('hub.payNow')}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="hub-page">
      <h1 className="hub-title">{t('hub.title')}</h1>

      <section
        className={`hub-banner tone-${STATUS_TONE[status]}`}
        role="status"
        aria-live="polite"
      >
        <span className={`hub-status-chip tone-${STATUS_TONE[status]}`}>
          {t(`status.${status}`)}
        </span>
        <p>{t(`statusBanner.${status}`)}</p>
        {status === 'declined' && <p className="hub-contact">{t('hub.contactSchool')}</p>}
      </section>

      {actionError && <p className="hub-error" role="alert">{actionError}</p>}

      {!terminal && (
        <section className="hub-outstanding">
          <h2>{t('hub.outstanding')}</h2>
          {outstanding.length === 0 ? (
            <p className="hub-muted">{t('hub.nothingOutstanding')}</p>
          ) : (
            <ul>
              {outstanding.map((i) => {
                const d = entityData(i);
                return (
                  <li key={String(d.item_id)}>
                    <span>{String(d.title ?? '')}</span>
                    {Boolean(d.blocking) && (
                      <span className="hub-blocking">{t('hub.blocking')}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {status === 'draft' && (
            <button type="button" className="hub-submit" onClick={onSubmit}>
              {t('hub.submit')}
            </button>
          )}
        </section>
      )}

      <section className="hub-checklist">
        <h2>{t('hub.checklist')}</h2>
        <ul>
          {items.map((i) => {
            const d = entityData(i);
            const itemStatus = asItemStatus(d.status);
            return (
              <li key={String(d.item_id)} className="hub-item">
                <div className="hub-item-main">
                  <span className="hub-item-title">{String(d.title ?? '')}</span>
                  <span className={`hub-item-chip tone-${ITEM_TONE[itemStatus]}`}>
                    {t(`itemStatus.${itemStatus}`)}
                  </span>
                </div>
                <div className="hub-item-actions">{affordance(d)}</div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: `HubPage.css`**

```css
.hub-page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-4, 16px);
}

.hub-title {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin: 0 0 var(--space-3, 12px);
}

.hub-loading,
.hub-muted {
  color: var(--text-secondary);
}

.hub-banner {
  border-radius: 10px;
  padding: var(--space-4, 16px);
  margin-bottom: var(--space-4, 16px);
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
}

.hub-banner p { margin: var(--space-2, 8px) 0 0; }

.hub-banner.tone-success { border-color: var(--color-success, #2e7d32); }
.hub-banner.tone-warning { border-color: var(--color-warning, #b26a00); }
.hub-banner.tone-danger  { border-color: var(--color-danger, #b3261e); }
.hub-banner.tone-info    { border-color: var(--accent); }

.hub-status-chip {
  display: inline-block;
  font-size: 0.8125rem;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid currentColor;
}

.hub-status-chip.tone-success { color: var(--color-success, #2e7d32); }
.hub-status-chip.tone-warning { color: var(--color-warning, #b26a00); }
.hub-status-chip.tone-danger  { color: var(--color-danger, #b3261e); }
.hub-status-chip.tone-info    { color: var(--accent-ink); }

.hub-item-chip {
  font-size: 0.8125rem;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}

.hub-item-chip.tone-success { color: var(--color-success, #2e7d32); }
.hub-item-chip.tone-warning { color: var(--color-warning, #b26a00); }
.hub-item-chip.tone-danger  { color: var(--color-danger, #b3261e); }
.hub-item-chip.tone-info    { color: var(--accent-ink); }

.hub-error {
  color: var(--color-danger, #b3261e);
}

.hub-outstanding,
.hub-checklist {
  margin-bottom: var(--space-5, 20px);
}

.hub-outstanding h2,
.hub-checklist h2 {
  font-size: 1.05rem;
  color: var(--text-primary);
  margin: 0 0 var(--space-2, 8px);
}

.hub-outstanding ul,
.hub-checklist ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hub-outstanding li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2, 8px);
  padding: var(--space-2, 8px) 0;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.hub-blocking {
  color: var(--color-warning, #b26a00);
  font-size: 0.8125rem;
  white-space: nowrap;
}

.hub-item {
  padding: var(--space-3, 12px) 0;
  border-bottom: 1px solid var(--border-color);
}

.hub-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2, 8px);
}

.hub-item-title { color: var(--text-primary); }

.hub-item-actions {
  margin-top: var(--space-2, 8px);
  display: flex;
  gap: var(--space-2, 8px);
}

.hub-action {
  min-height: 44px;
  padding: 0 var(--space-4, 16px);
  border-radius: 8px;
  border: none;
  background: var(--accent-ink);
  color: #fff;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.hub-action.secondary,
.hub-action.link {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent-ink);
}

.hub-action:disabled { opacity: 0.6; cursor: default; }

.hub-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.hub-submit {
  margin-top: var(--space-3, 12px);
  min-height: 48px;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: var(--accent-ink);
  color: #fff;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
}

.hub-link { color: var(--accent-ink); }
.hub-contact { color: var(--text-secondary); }

@media (min-width: 720px) {
  .hub-page { padding: var(--space-6, 24px); }
  .hub-title { font-size: 1.75rem; }
  .hub-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .hub-item-main { flex: 1; }
  .hub-item-actions { margin-top: 0; }
  .hub-submit { width: auto; padding: 0 var(--space-6, 24px); }
}
```

(Same fallback-token rule as Task 8 Step 3 applies.)

- [ ] **Step 3:** Verify: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build && npm run lint` — clean.

- [ ] **Step 4: Commit**

```bash
git add familyhub/frontend/src/pages/HubPage.tsx familyhub/frontend/src/pages/HubPage.css
git commit -m "feat(familyhub): parent hub page with status banner, checklist, and affordances"
```

---

### Task 10: Frontend — RequestLinkPage + routing

**Files:**
- Create: `familyhub/frontend/src/pages/RequestLinkPage.tsx`
- Create: `familyhub/frontend/src/pages/RequestLinkPage.css`
- Modify: `familyhub/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `requestLink` (Task 7); Plan 1's `LandingPage`.
- Produces: routes `/register/:tenantId/:programId`, `/application/:token`, `/request-link` (with `?tenant=`/`?program=` prefill).

- [ ] **Step 1: `RequestLinkPage.tsx`**

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { requestLink } from '../api/facade.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './RequestLinkPage.css';

export default function RequestLinkPage() {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const prefillTenant = searchParams.get('tenant') ?? '';
  const prefillProgram = searchParams.get('program') ?? undefined;

  const [tenantId, setTenantId] = useState(prefillTenant);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await requestLink(tenantId.trim(), email.trim(), prefillProgram);
      setSent(true); // Always "sent" — the API never reveals a match either way.
    } catch {
      setError(t('requestLink.error'));
    }
  }

  if (sent) {
    return (
      <div className="request-link-page">
        <h1>{t('requestLink.title')}</h1>
        <p className="request-link-sent" role="status">{t('requestLink.sent')}</p>
      </div>
    );
  }

  return (
    <div className="request-link-page">
      <h1>{t('requestLink.title')}</h1>
      <p className="request-link-body">{t('requestLink.body')}</p>
      <form onSubmit={onSubmit} noValidate>
        {error && <p className="request-link-error" role="alert">{error}</p>}
        {!prefillTenant && (
          <>
            <label htmlFor="rl-tenant">{t('requestLink.tenantLabel')}</label>
            <input
              id="rl-tenant"
              type="text"
              required
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
          </>
        )}
        <label htmlFor="rl-email">{t('requestLink.emailLabel')}</label>
        <input
          id="rl-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="request-link-primary" disabled={!tenantId.trim() || !email.trim()}>
          {t('requestLink.send')}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: `RequestLinkPage.css`**

```css
.request-link-page {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--space-4, 16px);
}

.request-link-page h1 {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin: 0 0 var(--space-2, 8px);
}

.request-link-body { color: var(--text-secondary); }

.request-link-page form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  margin-top: var(--space-3, 12px);
}

.request-link-page label {
  color: var(--text-primary);
  font-weight: 600;
}

.request-link-page input {
  font-size: 1rem;
  min-height: 44px;
  padding: 0 var(--space-3, 12px);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.request-link-primary {
  min-height: 48px;
  border: none;
  border-radius: 8px;
  background: var(--accent-ink);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}

.request-link-primary:disabled { opacity: 0.6; cursor: default; }

.request-link-sent {
  background: var(--bg-card);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: var(--space-3, 12px);
  color: var(--text-primary);
}

.request-link-error { color: var(--color-danger, #b3261e); }
```

- [ ] **Step 3: `App.tsx`** — replace with (keep any provider wrappers Plan 1's version has around `<Routes>`; there is no AuthProvider in familyhub and none may be added):

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.tsx';
import RegisterPage from './pages/RegisterPage.tsx';
import HubPage from './pages/HubPage.tsx';
import RequestLinkPage from './pages/RequestLinkPage.tsx';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register/:tenantId/:programId" element={<RegisterPage />} />
        <Route path="/application/:token" element={<HubPage />} />
        <Route path="/request-link" element={<RequestLinkPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4:** Verify: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build && npm run lint` — clean.

- [ ] **Step 5: Manual smoke (backend stubbed only by the real dev stack):**
  1. `./start-services.sh` from the repo root (starts everything incl. familyhub 6000/6010).
  2. Open `http://localhost:6000/request-link` — form renders; submit any tenant/email → "link is on its way" message regardless of match; check the Network tab shows a single POST returning 200.
  3. Open `http://localhost:6000/application/garbage-token` — invalid-link message + "Request a new link" link.
  4. Open `http://localhost:6000/register/acme/PR9999` (nonexistent) — "not available" message, no crash.
  5. DevTools → device toolbar → iPhone SE (375px): repeat 2–4; no horizontal scroll, touch targets comfortably tappable.
  6. Switch language via the language control (or `localStorage.setItem('preferredLanguage','zh-CN')` + reload) — all three pages render Chinese strings, no raw keys.

- [ ] **Step 6: Commit**

```bash
git add familyhub/frontend/src
git commit -m "feat(familyhub): request-link page and family-channel routes"
```

---

### Task 11: Frontend + backend full verification pass

- [ ] **Step 1:** Run everything this plan touched:

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build && npm run lint
```

Expected: all green. Fix regressions before proceeding — do not skip and do not weaken tests.

- [ ] **Step 2:** Negative-surface audit (the facade's hard constraints, verified mechanically):

```bash
cd /Users/kennylee/Development/NeoApex
# No JWT/auth surface in familyhub-backend:
grep -rn "Authorization\|auth/me\|jwt\|Bearer" familyhub/backend/app && echo "FAIL: auth surface found" || echo "OK"
# No generic query/entity routes:
grep -rn "api/query\|/entities/" familyhub/backend/app && echo "FAIL: generic route found" || echo "OK"
# Allowlist present:
grep -n "PARENT_ACTIONS" familyhub/backend/app/api/application.py
```

The first two greps MUST print `OK` (the only tolerated match is the word "authorization" inside comments/docstrings — if a match is a comment, keep it; if it is code, remove the code).

- [ ] **Step 3: Commit** any stragglers:

```bash
git add -A && git commit -m "test(familyhub): full-suite verification pass for plan 5" || echo "nothing to commit"
```

---

### Task 12: End-to-end smoke runbook (both channels, real dev stack)

This is a RUNBOOK task: execute it against the live dev stack and record pass/fail per step in the task report. It requires DataCore R2 credentials (`DATACORE_R2_*`) and Resend/Stripe test keys to be present in the shell env (`source ~/.zshrc`); if Stripe test keys are absent, mark the pay step "skipped: no Stripe test key" rather than failing the runbook.

- [ ] **Step 1 — boot and health:**

```bash
cd /Users/kennylee/Development/NeoApex
source ~/.zshrc
./start-services.sh
sleep 5
curl -s localhost:5800/api/health ; echo
curl -s localhost:5910/api/health ; echo   # enrollx
curl -s localhost:6010/api/health ; echo   # familyhub
```

All three return `{"status":"ok",...}`.

- [ ] **Step 2 — variables (fill from your dev environment; `acme` and the credentials are EXAMPLES — use a real dev tenant and a real staff login for it, e.g. one created earlier via LaunchPad):**

```bash
export ENROLLX=http://localhost:5910
export FAMILYHUB=http://localhost:6010
export TENANT=acme
export STAFF_EMAIL=admin@acme.test
export STAFF_PASS=changeme
JWT=$(curl -s $ENROLLX/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PASS\"}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("token"))')
echo "JWT: ${JWT:0:20}..."
```

(If the login body key is `username` rather than `email` in this stack, use that — check `enrollx/backend/app/api/auth.py`.)

- [ ] **Step 3 — staff creates a program and publishes a flow (enrollx UI):** open `http://localhost:5900`, log in as the staff user, create a program "Fall 2026 Smoke" with capacity 20, open the Flow Builder for it, add at least: one `form` block (student fields), one `documents` block containing a doc named "Immunization record" with `sensitive: true`, a `review` block, and publish. Record the program's id (visible in the UI/URL) as:

```bash
export PROGRAM=PR0001   # replace with the real id
```

- [ ] **Step 4 — parent fetches the public bundle and starts (familyhub facade, curl):**

```bash
curl -s $FAMILYHUB/api/registration/$TENANT/$PROGRAM | python3 -m json.tool
START=$(curl -s $FAMILYHUB/api/registration/$TENANT/$PROGRAM/start \
  -H 'Content-Type: application/json' \
  -d '{"applicant_email": "smoke-parent@example.com"}')
echo "$START" | python3 -m json.tool
export PTOKEN=$(echo "$START" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
```

Expect: bundle shows the published config + program name + `is_full: false`; start returns 201-family JSON with `token` and `hub_url`.

- [ ] **Step 5 — parent works the application (curl):**

```bash
# Hub bundle
curl -s $FAMILYHUB/api/application/$PTOKEN | python3 -m json.tool
# Note the form item's item_id from the output, then:
export FORM_ITEM=AI0001   # replace with the real id
export DOC_ITEM=AI0002    # replace with the document item's real id

# Save draft + complete the form item
curl -s -X PUT $FAMILYHUB/api/application/$PTOKEN -H 'Content-Type: application/json' \
  -d '{"action":"save_draft","draft_data":{"student_first_name":"Mei","student_last_name":"Smoke"}}'
curl -s -X PUT $FAMILYHUB/api/application/$PTOKEN -H 'Content-Type: application/json' \
  -d "{\"action\":\"complete_item\",\"item_id\":\"$FORM_ITEM\"}"

# Guard check: a staff action through the facade MUST 403
curl -s -o /dev/null -w "%{http_code}\n" -X PUT $FAMILYHUB/api/application/$PTOKEN \
  -H 'Content-Type: application/json' -d '{"action":"approve"}'   # expect 403

# Document upload: slot -> R2 PUT -> complete
printf '%%PDF-1.4 smoke' > /tmp/smoke.pdf
SLOT=$(curl -s $FAMILYHUB/api/application/$PTOKEN/documents -H 'Content-Type: application/json' \
  -d "{\"item_id\":\"$DOC_ITEM\",\"filename\":\"smoke.pdf\",\"content_type\":\"application/pdf\",\"size\":$(wc -c < /tmp/smoke.pdf)}")
echo "$SLOT" | python3 -m json.tool
UPLOAD_URL=$(echo "$SLOT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["upload_url"])')
DOC_ID=$(echo "$SLOT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["document_id"])')
curl -s -X PUT "$UPLOAD_URL" -H 'Content-Type: application/pdf' --data-binary @/tmp/smoke.pdf -o /dev/null -w "%{http_code}\n"   # expect 200
curl -s -X PUT $FAMILYHUB/api/application/$PTOKEN -H 'Content-Type: application/json' \
  -d "{\"action\":\"complete_item\",\"item_id\":\"$DOC_ITEM\",\"payload_ref\":\"$DOC_ID\"}"

# Parent can fetch their own document's download URL
curl -s $FAMILYHUB/api/application/$PTOKEN/documents/$DOC_ID/url | python3 -m json.tool

# Submit
curl -s -X PUT $FAMILYHUB/api/application/$PTOKEN -H 'Content-Type: application/json' -d '{"action":"submit"}'
curl -s $FAMILYHUB/api/application/$PTOKEN | python3 -c 'import sys,json;print(json.load(sys.stdin)["application"])'
```

Expect: status is now `submitted` (or `waitlisted` if you filled the program), the approve attempt returned 403, and the download URL fetch returned a signed R2 GET URL.

- [ ] **Step 6 — staff approves (enrollx, JWT):** get the application id from Step 5's output as `export APP_ID=RA26...`, then:

```bash
curl -s -X POST $ENROLLX/api/registration/$TENANT/applications/$APP_ID/actions \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"action":"approve"}' | python3 -m json.tool
```

(Or click Approve on the application detail page at `http://localhost:5900`.)

- [ ] **Step 7 — parent sees Approved (browser):** open `http://localhost:6000/application/$PTOKEN` (echo the URL: `echo http://localhost:6000/application/$PTOKEN`). Expect the green **Approved** banner, the form + document items showing their statuses, and any post-approval items listed under "Still needed from you". In device-toolbar mobile view, confirm layout holds. If a payment item exists and Stripe test keys are configured, tap **Pay now** → Stripe test checkout loads (card 4242 4242 4242 4242) → after redirect the payment item shows paid; otherwise record "skipped: no Stripe test key".

- [ ] **Step 8 — lost-link flow (browser + curl):**

```bash
curl -s -o /dev/null -w "%{http_code}\n" $FAMILYHUB/api/application/request-link \
  -H 'Content-Type: application/json' \
  -d "{\"tenant_id\":\"$TENANT\",\"email\":\"smoke-parent@example.com\"}"   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" $FAMILYHUB/api/application/request-link \
  -H 'Content-Type: application/json' \
  -d "{\"tenant_id\":\"$TENANT\",\"email\":\"never-registered@example.com\"}"   # expect 200, same body
```

Then in the browser: `http://localhost:6000/request-link?tenant=$TENANT` → submit the parent email → constant confirmation message. If Resend is configured with a test inbox, confirm the email arrives and its link opens the hub.

- [ ] **Step 9 — full registration in the browser (the real happy path):** open `http://localhost:6000/register/$TENANT/$PROGRAM` in a fresh private window, enter a NEW email, complete the whole flow through the FlowRenderer (form, document photo/pdf upload, submit), land on the hub, then approve it from enrollx and refresh the hub to see Approved. This is the acceptance gate for the plan.

- [ ] **Step 10 — record results + final commit:** append a `## E2E smoke results (date)` section listing pass/fail/skipped per step to the bindings file, kill the dev services, and commit:

```bash
git add docs/superpowers/plans/2026-08-03-registration-plan5-bindings.md
git commit -m "docs(registration): plan-5 e2e smoke results"
```

Report completion with the full commit list and any deviations recorded in the bindings file.
