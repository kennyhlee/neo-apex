# Registration Phase 1 — Plan 2: Application Lifecycle Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the registration application lifecycle engine in enrollx-backend — status derivation with transition guards, the application-creation endpoint, the single typed-action endpoint (all 13 roadmap actions), approval side effects (family match-or-create, student, enrollment), capacity/waitlist, magic-link tokens, the `/internal/*` routes for familyhub, and Resend email with activity logging.

**Architecture:** Everything lives in `enrollx/backend/app/registration/` (a pure-Python engine package) plus two new route modules (`app/api/registration.py` for staff, `app/api/internal.py` for the familyhub private channel). enrollx persists nothing: every read/write goes through a structured DataCore client module (`registration/datacore.py`) that mirrors admindash's `leads.py` helpers. Status is derived at write time inside the action handlers and stored on the `registration_application` entity, so all reads (tracking UI, chatbot) are plain generic queries.

**Tech Stack:** Python 3.12, FastAPI, pydantic v2 / pydantic_settings, httpx (sync), stdlib `hmac`/`hashlib`/`base64` for magic links, pytest + FastAPI TestClient with `dependency_overrides`. No new dependencies.

## Global Constraints

- Base branch: wherever Plan 1 landed — `feat/registration-plan1-foundations` if it exists and is unmerged, else `main`. Work on branch `feat/registration-plan2-lifecycle`.
- Executors use `superpowers:subagent-driven-development` or `superpowers:executing-plans`; TDD; one commit per task.
- DataCore is the ONLY persistence layer — enrollx holds no state, no DB, no files.
- Backends: FastAPI + pydantic_settings, env prefix `ENROLLX_`; JWT validated via DataCore `GET /auth/me` (enrollx never sees the signing secret).
- Every authenticated enrollx route uses `require_staff_tenant` (tenant match + role in `{admin, staff}`) from Plan 1's `enrollx/backend/app/tenancy.py`.
- familyhub-backend is NOT touched in this plan and never gains generic query/entity routes; it consumes the `/internal/*` routes in Plan 5.
- Interface contracts live in `docs/superpowers/plans/2026-08-03-registration-phase1-roadmap.md` — statuses, action names, and the magic-link token format there are binding, as amended by the coordination updates baked into this plan (see "Binding cross-plan symbols" below).
- **DataCore service auth (resolved decision):** DataCore's `/api/entities/*` and `/api/query` routes have NO auth dependency — verified in `datacore/src/datacore/api/routes.py` (`register_routes` declares no `Depends`), and admindash's public lead intake (`admindash/backend/app/api/leads.py::public_intake`) already writes entities with `token=None`. DataCore is private-network-only in production (Fly) and localhost in dev; it trusts its callers by design. Therefore this plan adds **no DataCore auth change**: the enrollx DataCore client forwards the staff JWT in the `Authorization` header when one exists (audit parity with admindash) and sends no auth header on the parent/internal channel. Introducing a `DATACORE_INTERNAL_KEY` would be new suite-wide auth machinery every existing caller lacks — deliberately deferred as a suite hardening follow-up, not smuggled into this plan.
- **Test stub mechanism (the ONE mechanism, used everywhere):** `monkeypatch` replaces the functions of `app.registration.datacore` with an in-memory `FakeDataCore` (defined once in `enrollx/backend/tests/fakes.py`, Task 2). Engine code must ONLY reach DataCore through that module — never call `httpx` directly for entity/query work, and never call `dc_query` directly for engine reads (use `list_entities`/`get_entity`; the fake asserts on raw `dc_query` use). Each test file repeats the short `fake_dc`/`client` fixture block verbatim.
- New env vars (all with safe dev defaults so tests need no env): `ENROLLX_LINK_SECRET`, `ENROLLX_INTERNAL_KEY`, `ENROLLX_RESEND_API_KEY` (empty = log instead of send), `ENROLLX_EMAIL_FROM`, `ENROLLX_FAMILYHUB_URL`. The names `ENROLLX_FRONTEND_PUBLIC_URL`, `ENROLLX_STRIPE_REDIRECT_URL`, `ENROLLX_BALANCE_DUE_DAYS` are RESERVED by Plan 3 — do not define them here.
- Entity referencing convention (used by all tasks and Plans 3–5): child entities (`application_item`, `application_activity`, `payment`, `document`) store the application's DataCore **entity_id** in their `application_id` field (precedent: admindash `lead_activity.lead_id`). The application's own `application_id` base field holds the human `RA`-prefixed display id. All `item_id` action params are the item's **entity_id**.
- **Money is integer cents everywhere** — `payment.amount`, `payment_plan` block `amount_full` / `deposit_amount`, `record_offline_payment.amount`.
- Document uploads by parents are tagged `uploaded_by = "parent:{application entity_id}"` (staff uploads use the staff `user_id`). Plans 4–5 must follow this when creating `document` entities; this plan's `/internal/.../documents` route relies on it.
- No frontend changes in this plan, so the bilingual i18n rule is not triggered (email templates are v1 English per spec §3/§9).

### Binding cross-plan symbols (Plans 3 and 5 are already written against these exact names)

| Symbol | Where produced |
|---|---|
| `dc_create(tenant_id, entity_type, base_data, token=None)`, `dc_update(tenant_id, entity_type, entity_id, base_data, token=None)`, `dc_query(tenant_id, sql, token=None, table="entities")` | `app/registration/datacore.py` (Task 2) |
| `create_application_item(tenant_id, application_entity_id, item_fields, token=None)` | `app/registration/engine.py` (Task 7) |
| `settle_payment_item(tenant_id, application_entity_id, item_row, *, provider, kind, amount, currency="USD", provider_ref=None, recorded_by=None, actor="system", token=None)` | `app/registration/engine.py` (Task 7) |
| `make_link_token(tenant_id, application_id, token_version)`, `verify_link_token(token, token_version)` | `app/registration/tokens.py` (Task 5) |
| `send_application_email(tenant_id, application_entity_id, kind, to, subject, html, token=None)` | `app/registration/emails.py` (Task 8) |
| `require_internal_key` (FastAPI dependency) | `app/api/internal.py` (Task 14) |
| Parent plan choice stored at `draft_data.payment_plan_selection` | Tasks 10, 13 |

### Contract notes (deviations an executor must NOT "fix")

1. **`publish_config` path wrinkle:** the roadmap folds `publish_config` into the application action endpoint, so for that one action the `{application_id}` path segment carries the **registration_config entity_id**. Documented in Task 13; do not invent a separate route.
2. **No `withdraw` action:** `withdrawn` is a valid status and appears in the transition table, but the roadmap's action list contains no `withdraw` action, so nothing triggers it in this plan. Leave the transitions in place; a later plan adds the action.
3. **Magic-link tokens have no expiry timestamp:** the format is exactly urlsafe-b64 of `{tenant_id}.{application_id}.{signature}` — revocation is via `token_version` bump only. Do not add an expiry field.
4. **`draft_data` shape (produced contract for Plans 4–5):** a JSON object with optional top-level keys `student` (student form fields), `family` (family form fields), `forms` (map of `block_id` → raw form payload), `payment_plan_selection` (`{"plan": "pay_in_full" | "deposit"}`). `save_draft` merges top-level keys.
5. **`reject_item` on an approved application** rejects the item and sends the action-needed email but leaves application status `approved` (the spec's `pending_items` flip applies pre-approval; `approved → pending_items` is not a legal transition).
6. **Internal routes:** per coordination update, the roadmap's token-scoped `POST /internal/application-by-token/{token}/request-link` is DROPPED in favor of the token-less `POST /internal/registration/{tenant_id}/request-link`, and three routes are ADDED beyond the roadmap's four: the config bundle, the token-less request-link, and the documents listing (Task 14 has the full table).

---

### Task 0: Branch setup

- [ ] **Step 1:** From the repo root:

```bash
cd /Users/kennylee/Development/NeoApex
git fetch
git checkout feat/registration-plan1-foundations 2>/dev/null || git checkout main
git checkout -b feat/registration-plan2-lifecycle
```

- [ ] **Step 2:** Verify Plan 1's output exists: `ls enrollx/backend/app/tenancy.py enrollx/backend/app/api/entities.py` — both must exist. If not, STOP: Plan 1 has not landed on this branch.

---

### Task 1: Settings for links, internal key, and email

**Files:**
- Modify: `enrollx/backend/app/config.py`
- Test: `enrollx/backend/tests/test_registration_settings.py` (create)

**Interfaces:**
- Consumes: Plan 1's `Settings` class (env prefix `ENROLLX_`, fields `environment`, `datacore_url`, `papermite_backend_url`, `cors_allowed_origins`, `port`).
- Produces: `settings.link_secret` (env `ENROLLX_LINK_SECRET`), `settings.internal_key` (env `ENROLLX_INTERNAL_KEY`), `settings.resend_api_key` (env `ENROLLX_RESEND_API_KEY`, default `""`), `settings.email_from` (env `ENROLLX_EMAIL_FROM`), `settings.familyhub_url` (env `ENROLLX_FAMILYHUB_URL`, default `http://localhost:6000`) — consumed by Tasks 5, 8, 14 and by Plan 5's familyhub facade (which supplies the same internal key from `FAMILYHUB_ENROLLX_INTERNAL_KEY` on its side).

- [ ] **Step 1: Write failing test**

```python
# enrollx/backend/tests/test_registration_settings.py
"""New registration-related settings and their env overrides."""


def _clean(monkeypatch):
    for var in (
        "ENROLLX_LINK_SECRET",
        "ENROLLX_INTERNAL_KEY",
        "ENROLLX_RESEND_API_KEY",
        "ENROLLX_EMAIL_FROM",
        "ENROLLX_FAMILYHUB_URL",
    ):
        monkeypatch.delenv(var, raising=False)


def test_registration_settings_defaults(monkeypatch):
    _clean(monkeypatch)
    from app.config import Settings

    s = Settings()
    assert s.link_secret == "dev-link-secret-change-in-prod"
    assert s.internal_key == "dev-internal-key-change-in-prod"
    assert s.resend_api_key == ""
    assert s.email_from == "NeoApex Registration <registration@floatify.com>"
    assert s.familyhub_url == "http://localhost:6000"


def test_registration_settings_env_overrides(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("ENROLLX_LINK_SECRET", "s3cret")
    monkeypatch.setenv("ENROLLX_INTERNAL_KEY", "internal-k")
    monkeypatch.setenv("ENROLLX_RESEND_API_KEY", "re_123")
    monkeypatch.setenv("ENROLLX_EMAIL_FROM", "School <hi@school.org>")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_URL", "https://familyhub.floatify.com")
    from app.config import Settings

    s = Settings()
    assert s.link_secret == "s3cret"
    assert s.internal_key == "internal-k"
    assert s.resend_api_key == "re_123"
    assert s.email_from == "School <hi@school.org>"
    assert s.familyhub_url == "https://familyhub.floatify.com"
```

- [ ] **Step 2: Run it**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_settings.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'link_secret'`.

- [ ] **Step 3: Minimal implementation** — in `enrollx/backend/app/config.py`, inside `class Settings`, directly after the `port: int = 5910` line, add:

```python
    # Registration lifecycle (Plan 2)
    link_secret: str = "dev-link-secret-change-in-prod"
    internal_key: str = "dev-internal-key-change-in-prod"
    resend_api_key: str = ""
    email_from: str = "NeoApex Registration <registration@floatify.com>"
    familyhub_url: str = "http://localhost:6000"
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_settings.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/config.py enrollx/backend/tests/test_registration_settings.py
git commit -m "feat(enrollx): settings for magic links, internal key, and Resend email"
```

---

### Task 2: DataCore client module + FakeDataCore test stub

This task establishes the ONE DataCore stubbing mechanism used by every later test file.

**Files:**
- Create: `enrollx/backend/app/registration/__init__.py` (empty file)
- Create: `enrollx/backend/app/registration/datacore.py`
- Create: `enrollx/backend/tests/fakes.py`
- Test: `enrollx/backend/tests/test_registration_datacore.py` (create)

**Interfaces:**
- Consumes: `settings.datacore_url` (Plan 1). DataCore generic API: `POST /api/entities/{tenant}/{type}`, `PUT /api/entities/{tenant}/{type}/{id}`, `GET /api/entities/{tenant}/{type}/next-id`, `POST /api/query` (see `datacore/src/datacore/api/routes.py`).
- Produces (BINDING for Plans 3/5): `dc_create`, `dc_update`, `dc_query` — exact signatures in the code below. Plus engine conveniences `next_id`, `list_entities`, `get_entity`. `dc_create`/`dc_update` return DataCore's result dict (`{"entity_id", "entity_type", "base_data", ...}`); `dc_query`/`list_entities` return flattened rows.
- Test side: `tests/fakes.py` exports `FakeDataCore`, `install_fake_datacore(monkeypatch, fdc)`, `BLOCKS`, `seed_program_and_config(fdc, ...)`.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_registration_datacore.py
"""DataCore client: SQL construction, auth-header policy, error mapping.

Also self-tests FakeDataCore, the in-memory stub every other test file uses.
"""
import httpx
import pytest
from fastapi import HTTPException

from app.registration import datacore as dc
from tests.fakes import FakeDataCore


class DummyResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


@pytest.fixture
def capture(monkeypatch):
    captured = {}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        captured.update(method=method, url=url, json=json, headers=headers)
        return DummyResponse(captured.pop("_status", 200), captured.pop("_payload", {"data": []}))

    monkeypatch.setattr(httpx, "request", fake_request)
    return captured


def test_list_entities_builds_scoped_sql(capture):
    capture["_payload"] = {"data": [{"entity_id": "e1"}]}
    rows = dc.list_entities("acme", "registration_application", "program_id = 'PR1'")
    assert rows == [{"entity_id": "e1"}]
    assert capture["json"]["sql"] == (
        "SELECT * FROM data WHERE entity_type = 'registration_application' "
        "AND _status = 'active' AND program_id = 'PR1'"
    )
    assert capture["json"]["tenant_id"] == "acme"
    assert "Authorization" not in capture["headers"]


def test_token_is_forwarded_when_present(capture):
    dc.list_entities("acme", "program", token="Bearer xyz")
    assert capture["headers"]["Authorization"] == "Bearer xyz"


def test_dc_create_posts_and_raises_on_error(capture):
    capture["_status"] = 400
    capture["_payload"] = {"detail": "bad"}
    with pytest.raises(HTTPException) as exc:
        dc.dc_create("acme", "student", {"first_name": "A"})
    assert exc.value.status_code == 400


def test_unreachable_datacore_is_502(monkeypatch):
    def boom(*args, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "request", boom)
    with pytest.raises(HTTPException) as exc:
        dc.dc_query("acme", "SELECT 1")
    assert exc.value.status_code == 502


def test_next_id_returns_value(capture):
    capture["_payload"] = {"next_id": "AC-RA260001"}
    assert dc.next_id("acme", "registration_application") == "AC-RA260001"
    assert capture["url"].endswith("/api/entities/acme/registration_application/next-id")


# ── FakeDataCore self-tests ───────────────────────────────────────────────

def test_fake_create_assigns_id_field_and_is_queryable():
    fdc = FakeDataCore()
    created = fdc.dc_create("acme", "payment", {"amount": 100})
    assert created["base_data"]["payment_id"].startswith("TT-PA26")
    rows = fdc.list_entities("acme", "payment", f"entity_id = '{created['entity_id']}'")
    assert rows and rows[0]["amount"] == 100


def test_fake_where_parsing_and_tenant_scoping():
    fdc = FakeDataCore()
    fdc.dc_create("acme", "program", {"program_id": "PR1"})
    fdc.dc_create("globex", "program", {"program_id": "PR1"})
    assert len(fdc.list_entities("acme", "program", "program_id = 'PR1'")) == 1
    assert fdc.list_entities("acme", "program", "program_id = 'NOPE'") == []
    with pytest.raises(AssertionError):
        fdc.list_entities("acme", "program", "program_id LIKE 'x'")


def test_fake_update_replaces_base_data():
    fdc = FakeDataCore()
    created = fdc.dc_create("acme", "program", {"program_id": "PR1", "name": "Fall"})
    fdc.dc_update("acme", "program", created["entity_id"], {"program_id": "PR1", "capacity": 5})
    row = fdc.get_entity("acme", "program", created["entity_id"])
    assert row["capacity"] == 5
    assert "name" not in row
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_datacore.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration'`.

- [ ] **Step 3: Implement `datacore.py`** (also create the empty `enrollx/backend/app/registration/__init__.py`):

```python
# enrollx/backend/app/registration/datacore.py
"""Structured DataCore client for the registration engine.

DataCore's entity/query routes are unauthenticated by design (private-network
trust — see this plan's Global Constraints). `token` is forwarded when a staff
JWT is present, and omitted on the parent/internal channel.

Sync httpx (like admindash leads.py) so tests can monkeypatch httpx.request.
Engine code must reach DataCore ONLY through this module, and must use
list_entities/get_entity (not raw dc_query) for entity reads.

dc_create / dc_update / dc_query are BINDING names consumed by Plans 3 and 5.
"""
import httpx
from fastapi import HTTPException, status

from app.config import settings


def _request(method: str, path: str, token: str | None = None, json_body: dict | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    try:
        return httpx.request(
            method,
            f"{settings.datacore_url}{path}",
            json=json_body,
            headers=headers,
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "DataCore is unreachable")


def dc_create(tenant_id: str, entity_type: str, base_data: dict, token: str | None = None) -> dict:
    resp = _request("POST", f"/api/entities/{tenant_id}/{entity_type}", token,
                    {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore create failed: {resp.text}")
    return resp.json()


def dc_update(tenant_id: str, entity_type: str, entity_id: str, base_data: dict,
              token: str | None = None) -> dict:
    resp = _request("PUT", f"/api/entities/{tenant_id}/{entity_type}/{entity_id}", token,
                    {"base_data": base_data, "custom_fields": {}})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore update failed: {resp.text}")
    return resp.json()


def dc_query(tenant_id: str, sql: str, token: str | None = None, table: str = "entities") -> list[dict]:
    resp = _request("POST", "/api/query", token,
                    {"tenant_id": tenant_id, "table": table, "sql": sql})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore query failed: {resp.text}")
    return resp.json().get("data", [])


def next_id(tenant_id: str, entity_type: str, token: str | None = None) -> str:
    resp = _request("GET", f"/api/entities/{tenant_id}/{entity_type}/next-id", token)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"DataCore next-id failed: {resp.text}")
    return resp.json()["next_id"]


def list_entities(tenant_id: str, entity_type: str, where: str = "",
                  token: str | None = None) -> list[dict]:
    sql = f"SELECT * FROM data WHERE entity_type = '{entity_type}' AND _status = 'active'"
    if where:
        sql += f" AND {where}"
    return dc_query(tenant_id, sql, token)


def get_entity(tenant_id: str, entity_type: str, entity_id: str,
               token: str | None = None) -> dict | None:
    rows = list_entities(tenant_id, entity_type, f"entity_id = '{entity_id}'", token)
    return rows[0] if rows else None
```

- [ ] **Step 4: Implement `tests/fakes.py`**

```python
# enrollx/backend/tests/fakes.py
"""In-memory FakeDataCore — the ONE DataCore stub mechanism for this suite.

Usage in every test file that touches DataCore (repeat this fixture verbatim):

    from tests.fakes import FakeDataCore, install_fake_datacore

    @pytest.fixture
    def fake_dc(monkeypatch):
        fdc = FakeDataCore()
        install_fake_datacore(monkeypatch, fdc)
        return fdc

Rows are stored flattened (entity_id, entity_type + base_data fields), which
matches how DataCore's query endpoint returns entities.
"""
import json
import re
import uuid


class FakeDataCore:
    def __init__(self):
        self.rows: list[dict] = []
        self.seq = 0

    # ── same signatures as app.registration.datacore ─────────────────────
    def dc_create(self, tenant_id, entity_type, base_data, token=None):
        base = dict(base_data)
        id_field = f"{entity_type}_id"
        if not base.get(id_field):
            self.seq += 1
            base[id_field] = f"TT-{entity_type[:2].upper()}26{self.seq:04d}"
        entity_id = uuid.uuid4().hex[:12]
        self.rows.append({"entity_id": entity_id, "entity_type": entity_type,
                          "_tenant": tenant_id, **base})
        return {"entity_id": entity_id, "entity_type": entity_type, "base_data": base}

    def dc_update(self, tenant_id, entity_type, entity_id, base_data, token=None):
        for i, r in enumerate(self.rows):
            if (r["entity_id"] == entity_id and r["entity_type"] == entity_type
                    and r["_tenant"] == tenant_id):
                self.rows[i] = {"entity_id": entity_id, "entity_type": entity_type,
                                "_tenant": tenant_id, **dict(base_data)}
                return {"entity_id": entity_id, "entity_type": entity_type,
                        "base_data": dict(base_data)}
        raise AssertionError(f"update of unknown entity {entity_type}/{entity_id}")

    def next_id(self, tenant_id, entity_type, token=None):
        self.seq += 1
        return f"TT-{entity_type[:2].upper()}26{self.seq:04d}"

    def list_entities(self, tenant_id, entity_type, where="", token=None):
        out = [dict(r) for r in self.rows
               if r["entity_type"] == entity_type and r["_tenant"] == tenant_id]
        for field, value in self._parse_where(where):
            out = [r for r in out if str(r.get(field, "")) == value]
        return out

    def get_entity(self, tenant_id, entity_type, entity_id, token=None):
        rows = self.list_entities(tenant_id, entity_type, f"entity_id = '{entity_id}'")
        return rows[0] if rows else None

    @staticmethod
    def _no_raw_query(*args, **kwargs):
        raise AssertionError(
            "engine code must not call dc_query directly — use list_entities/get_entity")

    @staticmethod
    def _parse_where(where):
        if not where:
            return []
        pairs = []
        for part in re.split(r"\s+AND\s+", where, flags=re.IGNORECASE):
            m = re.fullmatch(r"(\w+)\s*=\s*'([^']*)'", part.strip())
            if not m:
                raise AssertionError(f"FakeDataCore cannot parse where clause: {part!r}")
            pairs.append((m.group(1), m.group(2)))
        return pairs

    # ── test conveniences ─────────────────────────────────────────────────
    def find(self, entity_type, **fields):
        return [r for r in self.rows if r["entity_type"] == entity_type
                and all(str(r.get(k, "")) == str(v) for k, v in fields.items())]


def install_fake_datacore(monkeypatch, fdc: FakeDataCore):
    from app.registration import datacore as dc

    for name in ("dc_create", "dc_update", "next_id", "list_entities", "get_entity"):
        monkeypatch.setattr(dc, name, getattr(fdc, name))
    monkeypatch.setattr(dc, "dc_query", fdc._no_raw_query)


# ── Shared seed data for endpoint tests ───────────────────────────────────
BLOCKS = [
    {"block_id": "b1", "type": "form", "title": "Student Info", "required": True,
     "blocking": True, "config": {"entity_type": "student"}},
    {"block_id": "b2", "type": "documents", "title": "Documents", "required": True,
     "blocking": True, "config": {"docs": [
         {"name": "Immunization Record", "sensitive": True, "blocking": True},
         {"name": "Report Card", "blocking": False, "due_days_after_approval": 14},
     ]}},
    {"block_id": "b3", "type": "payment_plan", "title": "Choose a Plan", "required": True,
     "blocking": True, "config": {"currency": "usd", "amount_full": 50000, "plans": [
         {"type": "pay_in_full"},
         {"type": "deposit", "deposit_amount": 10000}]}},
    {"block_id": "b4", "type": "payment", "title": "Payment", "required": True,
     "blocking": True, "config": {"collects": "deposit"}},
    {"block_id": "b5", "type": "message", "title": "Welcome", "required": False,
     "blocking": False, "config": {"body": "Hi"}},
    {"block_id": "b6", "type": "review", "title": "Review", "required": True,
     "blocking": False, "config": {}},
]
# Expected derived items from BLOCKS: 1 form + 2 documents + 1 payment = 4 items,
# of which 3 are blocking (Report Card is non-blocking, due 14 days post-approval).
# Note payment_plan amounts are INTEGER CENTS (binding contract with Plan 3).


def seed_program_and_config(fdc: FakeDataCore, tenant="acme", program_id="PR1", capacity=None):
    prog = {"program_id": program_id, "name": "Fall 2026 Afterschool"}
    if capacity is not None:
        prog["capacity"] = capacity
    fdc.dc_create(tenant, "program", prog)
    fdc.dc_create(tenant, "registration_config", {
        "config_id": "cfg1", "program_id": program_id, "version": 1,
        "status": "published", "blocks": json.dumps(BLOCKS)})
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_datacore.py -v`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/registration enrollx/backend/tests/fakes.py enrollx/backend/tests/test_registration_datacore.py
git commit -m "feat(enrollx): DataCore client module and FakeDataCore test stub"
```

---

### Task 3: Status vocabulary and transition guards

**Files:**
- Create: `enrollx/backend/app/registration/statuses.py`
- Test: `enrollx/backend/tests/test_registration_statuses.py` (create)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `APPLICATION_STATUSES: list[str]`, `ALLOWED_TRANSITIONS: dict[str, set[str]]`, `ITEM_STATUSES: list[str]`, `ITEM_TRANSITIONS: dict[str, set[str]]`, `assert_transition(current: str, target: str) -> None` (raises HTTPException 409 with the allowed list), `assert_item_transition(current: str, target: str) -> None` (same). Consumed by every action handler and by Plan 3's webhook.

- [ ] **Step 1: Write failing table-driven tests**

```python
# enrollx/backend/tests/test_registration_statuses.py
"""Table-driven transition matrices for application and item statuses."""
import pytest
from fastapi import HTTPException

from app.registration.statuses import (
    ALLOWED_TRANSITIONS,
    APPLICATION_STATUSES,
    ITEM_STATUSES,
    ITEM_TRANSITIONS,
    assert_item_transition,
    assert_transition,
)

APP_ALLOWED_PAIRS = {
    ("draft", "submitted"), ("draft", "waitlisted"), ("draft", "withdrawn"),
    ("submitted", "in_review"), ("submitted", "approved"), ("submitted", "declined"),
    ("submitted", "pending_items"), ("submitted", "withdrawn"),
    ("in_review", "approved"), ("in_review", "declined"),
    ("in_review", "pending_items"), ("in_review", "withdrawn"),
    ("pending_items", "in_review"), ("pending_items", "declined"),
    ("pending_items", "withdrawn"),
    ("waitlisted", "in_review"), ("waitlisted", "withdrawn"),
    ("approved", "enrolled"), ("approved", "withdrawn"),
}


@pytest.mark.parametrize("frm", APPLICATION_STATUSES)
@pytest.mark.parametrize("to", APPLICATION_STATUSES)
def test_application_transition_matrix(frm, to):
    if (frm, to) in APP_ALLOWED_PAIRS:
        assert_transition(frm, to)  # must not raise
    else:
        with pytest.raises(HTTPException) as exc:
            assert_transition(frm, to)
        assert exc.value.status_code == 409


def test_409_detail_lists_allowed_transitions():
    with pytest.raises(HTTPException) as exc:
        assert_transition("draft", "approved")
    assert exc.value.detail["allowed"] == sorted(ALLOWED_TRANSITIONS["draft"])


def test_every_status_has_a_transition_entry():
    assert set(ALLOWED_TRANSITIONS) == set(APPLICATION_STATUSES)
    assert set(ITEM_TRANSITIONS) == set(ITEM_STATUSES)


def test_unknown_status_is_409():
    with pytest.raises(HTTPException) as exc:
        assert_transition("bogus", "draft")
    assert exc.value.status_code == 409


ITEM_ALLOWED_PAIRS = {
    ("not_started", "in_progress"), ("not_started", "submitted"), ("not_started", "waived"),
    ("in_progress", "submitted"), ("in_progress", "waived"),
    ("submitted", "verified"), ("submitted", "rejected"), ("submitted", "waived"),
    ("rejected", "submitted"), ("rejected", "waived"),
}


@pytest.mark.parametrize("frm", ITEM_STATUSES)
@pytest.mark.parametrize("to", ITEM_STATUSES)
def test_item_transition_matrix(frm, to):
    if (frm, to) in ITEM_ALLOWED_PAIRS:
        assert_item_transition(frm, to)  # must not raise
    else:
        with pytest.raises(HTTPException) as exc:
            assert_item_transition(frm, to)
        assert exc.value.status_code == 409
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_statuses.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration.statuses'`.

- [ ] **Step 3: Implement `statuses.py`**

```python
# enrollx/backend/app/registration/statuses.py
"""Application/item status vocabulary and transition guards (spec section 5,
roadmap interface contracts). Status names are BINDING across all plans.

`withdrawn` transitions exist but no v1 action triggers them (roadmap has no
`withdraw` action yet — deliberate, see the plan's Contract notes).
"""
from fastapi import HTTPException

APPLICATION_STATUSES = [
    "draft", "submitted", "in_review", "pending_items", "approved",
    "enrolled", "waitlisted", "declined", "withdrawn",
]

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"submitted", "waitlisted", "withdrawn"},
    "submitted": {"in_review", "approved", "declined", "pending_items", "withdrawn"},
    "in_review": {"approved", "declined", "pending_items", "withdrawn"},
    "pending_items": {"in_review", "declined", "withdrawn"},
    "approved": {"enrolled", "withdrawn"},
    "waitlisted": {"in_review", "withdrawn"},
    "enrolled": set(),
    "declined": set(),
    "withdrawn": set(),
}

ITEM_STATUSES = ["not_started", "in_progress", "submitted", "verified", "rejected", "waived"]

ITEM_TRANSITIONS: dict[str, set[str]] = {
    "not_started": {"in_progress", "submitted", "waived"},
    "in_progress": {"submitted", "waived"},
    "submitted": {"verified", "rejected", "waived"},
    "rejected": {"submitted", "waived"},
    "verified": set(),
    "waived": set(),
}


def _assert(table: dict[str, set[str]], kind: str, current: str, target: str) -> None:
    allowed = table.get(current)
    if allowed is None:
        raise HTTPException(409, {"error": f"Unknown {kind} status '{current}'", "allowed": []})
    if target not in allowed:
        raise HTTPException(409, {
            "error": f"Cannot move {kind} from '{current}' to '{target}'",
            "allowed": sorted(allowed),
        })


def assert_transition(current: str, target: str) -> None:
    _assert(ALLOWED_TRANSITIONS, "application", current, target)


def assert_item_transition(current: str, target: str) -> None:
    _assert(ITEM_TRANSITIONS, "item", current, target)
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_statuses.py -v`
Expected: all pass (81 + 36 matrix cases + 3 extra tests).

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/statuses.py enrollx/backend/tests/test_registration_statuses.py
git commit -m "feat(enrollx): application and item status transition guard tables"
```

---

### Task 4: Item derivation and block-schema validation

**Files:**
- Create: `enrollx/backend/app/registration/items.py`
- Modify: `launchpad/backend/app/data/base_model.json` (add one field to `application_item`)
- Test: `enrollx/backend/tests/test_registration_items.py` (create)

**Interfaces:**
- Consumes: block schema from spec section 4 / `flow-runtime` `FlowBlock` (Plan 1); `BLOCKS` fixture (Task 2).
- Produces: `derive_items(blocks: list[dict]) -> list[dict]` — item field dicts WITHOUT `item_id`/`application_id` (engine adds those): keys `block_id, kind, title, status ("not_started"), blocking (bool)`, optional `due_days_after_approval (int)`. Derivation rule (roadmap): form → 1 form item; documents → 1 item per doc; payment_plan → NO item (plan choice lives at `draft_data.payment_plan_selection`); payment → 1 payment item; message/review → none. Also `validate_blocks(blocks) -> list[str]` (empty list = valid) used by `publish_config` (Task 13) and Plan 4's builder.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_registration_items.py
"""Item derivation from config blocks + publish-time block validation."""
from app.registration.items import derive_items, validate_blocks
from tests.fakes import BLOCKS


def test_derive_items_counts_and_kinds():
    items = derive_items(BLOCKS)
    assert [i["kind"] for i in items] == ["form", "document", "document", "payment"]
    assert all(i["status"] == "not_started" for i in items)
    assert all("item_id" not in i and "application_id" not in i for i in items)


def test_document_items_carry_doc_level_flags():
    items = derive_items(BLOCKS)
    report_card = next(i for i in items if i["title"] == "Report Card")
    assert report_card["blocking"] is False
    assert report_card["due_days_after_approval"] == 14
    immun = next(i for i in items if i["title"] == "Immunization Record")
    assert immun["blocking"] is True
    assert "due_days_after_approval" not in immun


def test_non_item_blocks_produce_nothing():
    items = derive_items(BLOCKS)
    assert {i["block_id"] for i in items} == {"b1", "b2", "b4"}  # no b3/b5/b6


def test_validate_blocks_accepts_the_fixture():
    assert validate_blocks(BLOCKS) == []


def test_validate_blocks_reports_specific_errors():
    errs = validate_blocks([
        {"block_id": "b1", "type": "documents", "title": "Docs", "config": {}},
        {"block_id": "b1", "type": "mystery", "title": ""},
        {"block_id": "b2", "type": "payment_plan", "title": "Plan",
         "config": {"plans": [{"type": "deposit"}]}},
    ])
    joined = "\n".join(errs)
    assert "config.docs" in joined
    assert "duplicate block_id" in joined
    assert "type must be one of" in joined
    assert "title is required" in joined
    assert "deposit_amount" in joined


def test_validate_blocks_review_must_be_last():
    errs = validate_blocks([
        {"block_id": "r", "type": "review", "title": "Review"},
        {"block_id": "m", "type": "message", "title": "Msg", "config": {"body": "x"}},
    ])
    assert any("review block must be last" in e for e in errs)


def test_validate_blocks_rejects_empty():
    assert validate_blocks([]) == ["blocks must be a non-empty array"]
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_items.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration.items'`.

- [ ] **Step 3: Implement `items.py`**

```python
# enrollx/backend/app/registration/items.py
"""Derive application_item field sets from a registration_config's blocks,
and validate block JSON at publish time.

Derivation (roadmap contract): form -> 1 form item; documents -> 1 item per
doc; payment_plan -> NO item (choice stored at draft_data.payment_plan_selection);
payment -> 1 payment item; message/review -> none.
"""

ALLOWED_BLOCK_TYPES = {"form", "documents", "payment_plan", "payment", "message", "review"}
PLAN_TYPES = {"pay_in_full", "deposit"}


def _item(block, kind, title, blocking, due_days):
    fields = {
        "block_id": block["block_id"],
        "kind": kind,
        "title": title,
        "status": "not_started",
        "blocking": bool(blocking),
    }
    if due_days is not None:
        fields["due_days_after_approval"] = int(due_days)
    return fields


def derive_items(blocks: list[dict]) -> list[dict]:
    items = []
    for block in blocks:
        btype = block.get("type")
        if btype == "form":
            items.append(_item(block, "form", block.get("title", "Form"),
                               block.get("blocking", True),
                               block.get("due_days_after_approval")))
        elif btype == "documents":
            for i, doc in enumerate(block.get("config", {}).get("docs", [])):
                items.append(_item(
                    block, "document",
                    doc.get("name", f"Document {i + 1}"),
                    doc.get("blocking", block.get("blocking", True)),
                    doc.get("due_days_after_approval", block.get("due_days_after_approval")),
                ))
        elif btype == "payment":
            items.append(_item(block, "payment", block.get("title", "Payment"),
                               block.get("blocking", True),
                               block.get("due_days_after_approval")))
        # payment_plan / message / review produce no items
    return items


def validate_blocks(blocks) -> list[str]:
    if not isinstance(blocks, list) or not blocks:
        return ["blocks must be a non-empty array"]
    errors: list[str] = []
    seen: set[str] = set()
    for i, b in enumerate(blocks):
        where = f"blocks[{i}]"
        if not isinstance(b, dict):
            errors.append(f"{where}: must be an object")
            continue
        bid = b.get("block_id")
        if not bid or not isinstance(bid, str):
            errors.append(f"{where}: block_id is required")
        elif bid in seen:
            errors.append(f"{where}: duplicate block_id '{bid}'")
        else:
            seen.add(bid)
        btype = b.get("type")
        if btype not in ALLOWED_BLOCK_TYPES:
            errors.append(f"{where}: type must be one of {sorted(ALLOWED_BLOCK_TYPES)}")
        if not b.get("title"):
            errors.append(f"{where}: title is required")
        cfg = b.get("config")
        if cfg is not None and not isinstance(cfg, dict):
            errors.append(f"{where}: config must be an object")
        cfg = cfg if isinstance(cfg, dict) else {}
        if btype == "documents":
            docs = cfg.get("docs")
            if not isinstance(docs, list) or not docs:
                errors.append(f"{where}: documents block needs config.docs (non-empty array)")
            else:
                for j, d in enumerate(docs):
                    if not isinstance(d, dict) or not d.get("name"):
                        errors.append(f"{where}.docs[{j}]: name is required")
        if btype == "payment_plan":
            plans = cfg.get("plans")
            if not isinstance(plans, list) or not plans:
                errors.append(f"{where}: payment_plan block needs config.plans (non-empty array)")
            else:
                # Plan 3 shape: amount_full is TOP-LEVEL config (int cents);
                # deposit_amount lives on the deposit plan object.
                if not isinstance(cfg.get("amount_full"), int):
                    errors.append(f"{where}: config.amount_full (integer cents) is required")
                for j, p in enumerate(plans):
                    pw = f"{where}.plans[{j}]"
                    if not isinstance(p, dict) or p.get("type") not in PLAN_TYPES:
                        errors.append(f"{pw}: type must be one of {sorted(PLAN_TYPES)}")
                        continue
                    if p["type"] == "deposit" and not isinstance(p.get("deposit_amount"), int):
                        errors.append(f"{pw}: deposit_amount (integer cents) is required")
        if btype == "review" and i != len(blocks) - 1:
            errors.append(f"{where}: review block must be last")
    return errors
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_items.py -v`
Expected: 7 passed.

- [ ] **Step 5: Add `due_days_after_approval` to the `application_item` model.** Open `launchpad/backend/app/data/base_model.json`, find the `application_item` entry Plan 1 seeded, and append to its base fields (mirroring the exact object shape of the neighbouring field definitions, e.g. `{"name": ..., "type": ..., "required": ...}`):

```json
{ "name": "due_days_after_approval", "type": "number", "required": false }
```

Rationale: items must remember their post-approval due-day count so `approve` can stamp `due_at` without re-reading the pinned config. Validate: `python3 -c "import json; d=json.load(open('launchpad/backend/app/data/base_model.json')); fields=[f['name'] for f in d['application_item']['base_fields']]; assert 'due_days_after_approval' in fields; print('ok')"` (adjust the key path only if the file's actual structure differs — inspect it first).

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/registration/items.py enrollx/backend/tests/test_registration_items.py launchpad/backend/app/data/base_model.json
git commit -m "feat(enrollx): item derivation from config blocks and publish-time validation"
```

---

### Task 5: Magic-link token module

**Files:**
- Create: `enrollx/backend/app/registration/tokens.py`
- Test: `enrollx/backend/tests/test_registration_tokens.py` (create)

**Interfaces:**
- Consumes: `settings.link_secret`, `settings.familyhub_url` (Task 1).
- Produces (BINDING for Plan 5): `make_link_token(tenant_id: str, application_id: str, token_version: int) -> str`, `verify_link_token(token: str, token_version: int) -> tuple[str, str]` (returns `(tenant_id, application_id)` or raises `TokenError`), plus `parse_link_token(token) -> tuple[str, str, str]` (no signature check — used to locate the application before its `token_version` is known) and `magic_link_url(token) -> str` (`{familyhub_url}/application/{token}`). `application_id` here is the application's **entity_id**. Token format (roadmap, exact): HMAC-SHA256 over `{tenant_id}.{application_id}.{token_version}` keyed by `ENROLLX_LINK_SECRET`; token = URL-safe base64 (padding stripped) of `{tenant_id}.{application_id}.{hex_signature}`.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_registration_tokens.py
"""Magic-link tokens: round-trip, revocation by token_version, tampering."""
import re

import pytest

from app.registration.tokens import (
    TokenError,
    magic_link_url,
    make_link_token,
    parse_link_token,
    verify_link_token,
)


def test_round_trip():
    tok = make_link_token("acme", "abc123def456", 1)
    assert verify_link_token(tok, 1) == ("acme", "abc123def456")


def test_token_is_urlsafe():
    tok = make_link_token("acme", "abc123def456", 1)
    assert re.fullmatch(r"[A-Za-z0-9_-]+", tok)


def test_bumped_token_version_revokes():
    tok = make_link_token("acme", "abc123def456", 1)
    with pytest.raises(TokenError):
        verify_link_token(tok, 2)


def test_tampered_signature_rejected():
    tok = make_link_token("acme", "abc123def456", 1)
    bad = tok[:-2] + ("AA" if not tok.endswith("AA") else "BB")
    with pytest.raises(TokenError):
        verify_link_token(bad, 1)


def test_garbage_token_rejected():
    with pytest.raises(TokenError):
        parse_link_token("!!!not-base64!!!")
    with pytest.raises(TokenError):
        verify_link_token("aGVsbG8", 1)  # decodes, but has no dot-separated parts


def test_parse_exposes_scope_without_verifying():
    tok = make_link_token("acme", "abc123def456", 7)
    tenant_id, application_id, sig = parse_link_token(tok)
    assert (tenant_id, application_id) == ("acme", "abc123def456")
    assert len(sig) == 64  # hex sha256


def test_magic_link_url_uses_familyhub_base():
    tok = make_link_token("acme", "abc123def456", 1)
    assert magic_link_url(tok) == f"http://localhost:6000/application/{tok}"
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration.tokens'`.

- [ ] **Step 3: Implement `tokens.py`**

```python
# enrollx/backend/app/registration/tokens.py
"""Magic-link tokens (roadmap contract, exact):

    signature = HMAC-SHA256(ENROLLX_LINK_SECRET, "{tenant}.{app_entity_id}.{token_version}")
    token     = urlsafe_b64("{tenant}.{app_entity_id}.{hex_signature}")  # padding stripped

No expiry field by design — revocation is bumping token_version on the
application entity. make_link_token / verify_link_token are BINDING names.
"""
import base64
import hashlib
import hmac

from app.config import settings


class TokenError(Exception):
    """Raised when a magic-link token is malformed, forged, or revoked."""


def _sign(tenant_id: str, application_id: str, token_version: int) -> str:
    msg = f"{tenant_id}.{application_id}.{int(token_version)}".encode()
    return hmac.new(settings.link_secret.encode(), msg, hashlib.sha256).hexdigest()


def make_link_token(tenant_id: str, application_id: str, token_version: int) -> str:
    raw = f"{tenant_id}.{application_id}.{_sign(tenant_id, application_id, token_version)}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def parse_link_token(token: str) -> tuple[str, str, str]:
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, application_id, sig = raw.split(".")
    except Exception as exc:
        raise TokenError("Malformed token") from exc
    return tenant_id, application_id, sig


def verify_link_token(token: str, token_version: int) -> tuple[str, str]:
    tenant_id, application_id, sig = parse_link_token(token)
    expected = _sign(tenant_id, application_id, token_version)
    if not hmac.compare_digest(sig, expected):
        raise TokenError("Invalid or revoked token")
    return tenant_id, application_id


def magic_link_url(token: str) -> str:
    return f"{settings.familyhub_url}/application/{token}"
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_tokens.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/tokens.py enrollx/backend/tests/test_registration_tokens.py
git commit -m "feat(enrollx): HMAC magic-link tokens with token_version revocation"
```

---

### Task 6: Family match-or-create (server-side port)

**Files:**
- Create: `enrollx/backend/app/registration/family.py`
- Test: `enrollx/backend/tests/test_registration_family.py` (create)

**Interfaces:**
- Consumes: `datacore.list_entities` / `datacore.dc_create` (Task 2). Ported logic: `admindash/frontend/src/utils/familyMatch.ts` (`normalizeSignature`, `signatureKey`, `matchFamily`) and the solo-create fallback of `familyPlan.ts`.
- Produces: `normalize_signature(fields: dict) -> dict` (keys `email, phone, name, address`), `signature_key(sig: dict) -> str` (`e:{email}` else `p:{digits}` else `na:{name}|{address}` else `""`), `match_family(sig, candidates) -> str | None` (entity_id), `match_or_create_family(tenant_id: str, family_fields: dict, token=None) -> str` (entity_id of matched or newly created family). Consumed by Task 12 (approve).

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_registration_family.py
"""Server-side family match-or-create (port of admindash familyMatch/familyPlan)."""
import pytest

from app.registration.family import (
    match_or_create_family,
    normalize_signature,
    signature_key,
)
from tests.fakes import FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_signature_normalization_and_key_priority():
    sig = normalize_signature({
        "primary_email": "  P@X.Com ",
        "primary_phone": "(555) 123-4567",
        "family_name": "  Lee   Family ",
        "primary_address": "1 Main St",
    })
    assert sig == {"email": "p@x.com", "phone": "5551234567",
                   "name": "lee family", "address": "1 main st"}
    assert signature_key(sig) == "e:p@x.com"
    assert signature_key({**sig, "email": ""}) == "p:5551234567"
    assert signature_key({**sig, "email": "", "phone": ""}) == "na:lee family|1 main st"
    assert signature_key({"email": "", "phone": "", "name": "x", "address": ""}) == ""


def test_matches_existing_family_by_email(fake_dc):
    fam = fake_dc.dc_create("acme", "family",
                            {"family_name": "Lee", "primary_email": "P@X.com"})
    fid = match_or_create_family("acme", {"primary_email": " p@x.com ",
                                          "family_name": "Lee Family"})
    assert fid == fam["entity_id"]
    assert len(fake_dc.find("family")) == 1  # no duplicate created


def test_matches_by_phone_digits(fake_dc):
    fam = fake_dc.dc_create("acme", "family",
                            {"family_name": "Ng", "primary_phone": "5551234567"})
    fid = match_or_create_family("acme", {"primary_phone": "(555) 123-4567"})
    assert fid == fam["entity_id"]


def test_creates_family_when_no_match(fake_dc):
    fid = match_or_create_family("acme", {
        "primary_email": "new@x.com", "family_name": "New Family",
        "primary_phone": "5550000000", "primary_address": "2 Oak Ave"})
    rows = fake_dc.find("family", primary_email="new@x.com")
    assert rows and rows[0]["entity_id"] == fid
    assert rows[0]["family_name"] == "New Family"


def test_no_signature_creates_solo_family(fake_dc):
    fake_dc.dc_create("acme", "family", {"family_name": "OnlyName"})
    fid = match_or_create_family("acme", {"family_name": "OnlyName"})
    # name-only has no dedupe key -> always a new family (familyPlan solo rule)
    assert len(fake_dc.find("family")) == 2
    assert fid


def test_family_name_fallback_when_missing(fake_dc):
    match_or_create_family("acme", {"primary_email": "solo@x.com"})
    rows = fake_dc.find("family", primary_email="solo@x.com")
    assert rows[0]["family_name"] == "solo@x.com"
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_family.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration.family'`.

- [ ] **Step 3: Implement `family.py`**

```python
# enrollx/backend/app/registration/family.py
"""Server-side port of admindash's familyMatch.ts / familyPlan.ts:
match an applicant's family against existing family entities by normalized
email -> phone -> name+address signature; create when no key or no match.
"""
import re

from app.registration import datacore as dc


def _text(v) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip()).lower()


def _digits(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def normalize_signature(fields: dict) -> dict:
    return {
        "email": _text(fields.get("primary_email")),
        "phone": _digits(fields.get("primary_phone")),
        "name": _text(fields.get("family_name")),
        "address": _text(fields.get("primary_address")),
    }


def signature_key(sig: dict) -> str:
    if sig["email"]:
        return f"e:{sig['email']}"
    if sig["phone"]:
        return f"p:{sig['phone']}"
    if sig["name"] and sig["address"]:
        return f"na:{sig['name']}|{sig['address']}"
    return ""


def match_family(sig: dict, candidates: list[dict]) -> str | None:
    key = signature_key(sig)
    if not key:
        return None
    for c in candidates:
        if signature_key(normalize_signature(c)) == key:
            return c["entity_id"]
    return None


def match_or_create_family(tenant_id: str, family_fields: dict, token=None) -> str:
    sig = normalize_signature(family_fields)
    candidates = dc.list_entities(tenant_id, "family", "", token)
    matched = match_family(sig, candidates)
    if matched:
        return matched
    base = {k: v for k, v in family_fields.items() if v not in (None, "")}
    if not base.get("family_name"):
        base["family_name"] = (family_fields.get("primary_email")
                               or family_fields.get("primary_phone") or "Family")
    created = dc.dc_create(tenant_id, "family", base, token)
    return created["entity_id"]
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_family.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/family.py enrollx/backend/tests/test_registration_family.py
git commit -m "feat(enrollx): server-side family match-or-create ported from admindash"
```

---

### Task 7: Engine core — fetch helpers, activity log, status writes, capacity, creation, payment settlement

**Files:**
- Create: `enrollx/backend/app/registration/engine.py`
- Test: `enrollx/backend/tests/test_registration_engine.py` (create)

**Interfaces:**
- Consumes: `datacore` (Task 2), `statuses.assert_transition` (Task 3), `items.derive_items` (Task 4).
- Produces (used by Tasks 9–14; `create_application_item` and `settle_payment_item` are BINDING for Plan 3):
  - `now_iso() -> str`
  - `entity_base_data(row: dict) -> dict` — rebuilds a full base_data dict from a flattened query row (PUT replaces base_data)
  - `log_activity(tenant_id, application_id, type_, from_value, to_value, actor, token=None) -> dict`
  - `get_application` / `require_application(tenant_id, entity_id, token=None)` (404) / `get_items(tenant_id, application_entity_id, token=None)`
  - `get_program(tenant_id, program_id, token=None)` (matches `program_id` field, falls back to entity_id)
  - `get_published_config(tenant_id, program_id, token=None)` / `get_config_for_application(tenant_id, app_row, token=None)` (pinned `config_version`)
  - `update_application(tenant_id, app_row, changes, token=None)`
  - `set_application_status(tenant_id, app_row, new_status, actor, token=None, extra_changes=None)` — guards + writes + logs
  - `capacity_state(tenant_id, program_id, token=None) -> {"capacity", "approved", "enrolled", "full"}` / `is_capacity_full(...) -> bool`
  - `blocking_items_complete(items) -> bool` (done = `submitted|verified|waived`)
  - `create_application_item(tenant_id, application_entity_id, item_fields, token=None) -> dict`
  - `create_application(tenant_id, program_id, school_year, channel, applicant_email, actor, token=None) -> {"application", "items"}` (404 if no published config)
  - `settle_payment_item(tenant_id, application_entity_id, item_row, *, provider, kind, amount, currency="USD", provider_ref=None, recorded_by=None, actor="system", token=None) -> {"payment", "item"}`

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_registration_engine.py
"""Engine core: creation with item derivation, capacity boundary, status
writes with activity logging, payment settlement."""
import pytest
from fastapi import HTTPException

from app.registration import engine
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_create_application_derives_items_and_logs(fake_dc):
    seed_program_and_config(fake_dc)
    result = engine.create_application("acme", "PR1", "2026-2027", "admin",
                                       "parent@example.com", actor="u1")
    app_bd = result["application"]["base_data"]
    assert app_bd["status"] == "draft"
    assert app_bd["config_version"] == 1
    assert app_bd["token_version"] == 1
    assert app_bd["channel_started"] == "admin"
    assert app_bd["applicant_email"] == "parent@example.com"
    assert app_bd["application_id"] == app_bd["registration_application_id"]
    assert len(result["items"]) == 4
    eid = result["application"]["entity_id"]
    items = fake_dc.find("application_item", application_id=eid)
    assert len(items) == 4
    assert all(i["status"] == "not_started" for i in items)
    acts = fake_dc.find("application_activity", application_id=eid)
    assert [a["type"] for a in acts] == ["status_change"]
    assert acts[0]["to_value"] == "draft"


def test_create_application_404_without_published_config(fake_dc):
    with pytest.raises(HTTPException) as exc:
        engine.create_application("acme", "PRX", "2026-2027", "admin", None, actor="u1")
    assert exc.value.status_code == 404


def test_capacity_boundary(fake_dc):
    seed_program_and_config(fake_dc, capacity=2)
    fake_dc.dc_create("acme", "registration_application",
                      {"application_id": "A1", "program_id": "PR1", "status": "approved"})
    fake_dc.dc_create("acme", "enrollment",
                      {"program_id": "PR1", "student_id": "s1", "status": "active"})
    state = engine.capacity_state("acme", "PR1")
    assert state == {"capacity": 2, "approved": 1, "enrolled": 1, "full": True}
    assert engine.is_capacity_full("acme", "PR1") is True


def test_capacity_open_below_limit_and_without_capacity(fake_dc):
    seed_program_and_config(fake_dc, capacity=5)
    assert engine.is_capacity_full("acme", "PR1") is False
    seed_program_and_config(fake_dc, program_id="PR2")  # no capacity field
    assert engine.is_capacity_full("acme", "PR2") is False


def test_set_application_status_guards_and_logs(fake_dc):
    created = fake_dc.dc_create("acme", "registration_application",
                                {"application_id": "A1", "program_id": "PR1",
                                 "status": "draft", "school_year": "2026-2027"})
    row = fake_dc.get_entity("acme", "registration_application", created["entity_id"])
    with pytest.raises(HTTPException) as exc:
        engine.set_application_status("acme", row, "approved", actor="u1")
    assert exc.value.status_code == 409
    engine.set_application_status("acme", row, "submitted", actor="u1",
                                  extra_changes={"submitted_at": engine.now_iso()})
    updated = fake_dc.get_entity("acme", "registration_application", created["entity_id"])
    assert updated["status"] == "submitted"
    assert updated["submitted_at"]
    assert updated["school_year"] == "2026-2027"  # untouched fields preserved
    acts = fake_dc.find("application_activity", application_id=created["entity_id"])
    assert acts and acts[-1]["from_value"] == "draft" and acts[-1]["to_value"] == "submitted"


def test_blocking_items_complete_table():
    cases = [
        ([], True),
        ([{"blocking": True, "status": "submitted"}], True),
        ([{"blocking": True, "status": "verified"}], True),
        ([{"blocking": True, "status": "waived"}], True),
        ([{"blocking": True, "status": "not_started"}], False),
        ([{"blocking": True, "status": "rejected"}], False),
        ([{"blocking": False, "status": "not_started"}], True),
        ([{"blocking": True, "status": "submitted"},
          {"blocking": True, "status": "in_progress"}], False),
    ]
    for items, expected in cases:
        assert engine.blocking_items_complete(items) is expected, items


def test_settle_payment_item(fake_dc):
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "program_id": "PR1", "status": "submitted"})
    item = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "not_started", "blocking": True})
    item_row = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    result = engine.settle_payment_item(
        "acme", app["entity_id"], item_row, provider="offline", kind="full",
        amount=50000, recorded_by="u1", actor="u1")
    pay = fake_dc.find("payment", application_id=app["entity_id"])[0]
    assert pay["amount"] == 50000 and pay["provider"] == "offline"
    assert pay["status"] == "paid" and pay["recorded_by"] == "u1"
    updated_item = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    assert updated_item["status"] == "verified"
    assert updated_item["payload_ref"] == result["payment"]["entity_id"]
    acts = fake_dc.find("application_activity", application_id=app["entity_id"])
    assert any(a["type"] == "item_change" for a in acts)


def test_settle_payment_item_rejects_non_payment_and_double_pay(fake_dc):
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "program_id": "PR1", "status": "submitted"})
    form = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b1",
        "kind": "form", "title": "Form", "status": "submitted", "blocking": True})
    with pytest.raises(HTTPException) as exc:
        engine.settle_payment_item("acme", app["entity_id"],
                                   fake_dc.get_entity("acme", "application_item", form["entity_id"]),
                                   provider="offline", kind="full", amount=1)
    assert exc.value.status_code == 400
    paid = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i2", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "verified", "blocking": True})
    with pytest.raises(HTTPException) as exc:
        engine.settle_payment_item("acme", app["entity_id"],
                                   fake_dc.get_entity("acme", "application_item", paid["entity_id"]),
                                   provider="offline", kind="full", amount=1)
    assert exc.value.status_code == 409
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration.engine'`.

- [ ] **Step 3: Implement `engine.py`**

```python
# enrollx/backend/app/registration/engine.py
"""Registration lifecycle engine: fetch helpers, activity logging, guarded
status writes, capacity state, application/item creation, payment settlement.

All DataCore IO goes through app.registration.datacore (list_entities /
get_entity for reads — never raw dc_query).
"""
import json
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.registration import datacore as dc
from app.registration.items import derive_items
from app.registration.statuses import assert_transition

SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector", "_tenant"}
ITEM_DONE_STATUSES = {"submitted", "verified", "waived"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def entity_base_data(row: dict) -> dict:
    """Rebuild a full base_data dict from a flattened query row. DataCore PUT
    REPLACES base_data, so every update must carry all fields (precedent:
    admindash leads.py _lead_base_data)."""
    return {k: v for k, v in row.items()
            if k not in SYSTEM_COLS and not k.startswith("_") and v is not None}


def log_activity(tenant_id, application_id, type_, from_value, to_value, actor, token=None):
    return dc.dc_create(tenant_id, "application_activity", {
        "activity_id": uuid.uuid4().hex[:12],
        "application_id": application_id,
        "type": type_,
        "from_value": from_value or "",
        "to_value": to_value or "",
        "actor": actor,
        "at": now_iso(),
    }, token)


def get_application(tenant_id, entity_id, token=None):
    return dc.get_entity(tenant_id, "registration_application", entity_id, token)


def require_application(tenant_id, entity_id, token=None) -> dict:
    row = get_application(tenant_id, entity_id, token)
    if row is None:
        raise HTTPException(404, "Application not found")
    return row


def get_items(tenant_id, application_entity_id, token=None) -> list[dict]:
    return dc.list_entities(tenant_id, "application_item",
                            f"application_id = '{application_entity_id}'", token)


def get_program(tenant_id, program_id, token=None):
    rows = dc.list_entities(tenant_id, "program", f"program_id = '{program_id}'", token)
    if not rows:
        rows = dc.list_entities(tenant_id, "program", f"entity_id = '{program_id}'", token)
    return rows[0] if rows else None


def get_published_config(tenant_id, program_id, token=None):
    rows = dc.list_entities(tenant_id, "registration_config",
                            f"program_id = '{program_id}' AND status = 'published'", token)
    return rows[0] if rows else None


def get_config_for_application(tenant_id, app_row, token=None):
    """The config version pinned at application start; archived versions keep
    _status active (only their `status` field says 'archived'), so they remain
    queryable."""
    rows = dc.list_entities(tenant_id, "registration_config",
                            f"program_id = '{app_row.get('program_id', '')}'", token)
    want = int(app_row.get("config_version") or 0)
    for r in rows:
        if int(r.get("version") or 0) == want:
            return r
    return get_published_config(tenant_id, app_row.get("program_id", ""), token)


def update_application(tenant_id, app_row, changes, token=None):
    base = entity_base_data(app_row)
    base.update(changes)
    return dc.dc_update(tenant_id, "registration_application", app_row["entity_id"], base, token)


def set_application_status(tenant_id, app_row, new_status, actor, token=None, extra_changes=None):
    current = app_row.get("status", "draft")
    assert_transition(current, new_status)
    changes = {"status": new_status}
    if extra_changes:
        changes.update(extra_changes)
    result = update_application(tenant_id, app_row, changes, token)
    log_activity(tenant_id, app_row["entity_id"], "status_change", current, new_status,
                 actor, token)
    return result


def capacity_state(tenant_id, program_id, token=None) -> dict:
    program = get_program(tenant_id, program_id, token)
    capacity = (program or {}).get("capacity")
    approved = dc.list_entities(tenant_id, "registration_application",
                                f"program_id = '{program_id}' AND status = 'approved'", token)
    enrollments = dc.list_entities(tenant_id, "enrollment",
                                   f"program_id = '{program_id}' AND status = 'active'", token)
    full = capacity is not None and len(approved) + len(enrollments) >= int(capacity)
    return {"capacity": int(capacity) if capacity is not None else None,
            "approved": len(approved), "enrolled": len(enrollments), "full": full}


def is_capacity_full(tenant_id, program_id, token=None) -> bool:
    return capacity_state(tenant_id, program_id, token)["full"]


def blocking_items_complete(items) -> bool:
    return all((not i.get("blocking")) or i.get("status") in ITEM_DONE_STATUSES
               for i in items)


def create_application_item(tenant_id, application_entity_id, item_fields, token=None) -> dict:
    """Create one application_item. BINDING name — Plan 3 uses this to create
    the non-blocking balance-due item for deposit plans."""
    base = {"item_id": uuid.uuid4().hex[:12],
            "application_id": application_entity_id,
            "status": "not_started",
            **dict(item_fields)}
    return dc.dc_create(tenant_id, "application_item", base, token)


def create_application(tenant_id, program_id, school_year, channel, applicant_email,
                       actor, token=None) -> dict:
    config = get_published_config(tenant_id, program_id, token)
    if config is None:
        raise HTTPException(404, f"No published registration config for program '{program_id}'")
    app_id = dc.next_id(tenant_id, "registration_application", token)
    base = {
        "application_id": app_id,
        # Pre-set DataCore's auto-ID field so create doesn't mint a second id
        # (DataCore auto-assigns "{entity_type}_id" when absent).
        "registration_application_id": app_id,
        "program_id": program_id,
        "school_year": school_year,
        "status": "draft",
        "config_version": int(config.get("version") or 1),
        "channel_started": channel,
        "token_version": 1,
        "draft_data": "{}",
    }
    if applicant_email:
        base["applicant_email"] = applicant_email
    created = dc.dc_create(tenant_id, "registration_application", base, token)
    app_entity_id = created["entity_id"]
    blocks = json.loads(config.get("blocks") or "[]")
    items = [create_application_item(tenant_id, app_entity_id, fields, token)
             for fields in derive_items(blocks)]
    log_activity(tenant_id, app_entity_id, "status_change", "", "draft", actor, token)
    return {"application": created, "items": items}


def settle_payment_item(tenant_id, application_entity_id, item_row, *, provider, kind,
                        amount, currency="USD", provider_ref=None, recorded_by=None,
                        actor="system", token=None) -> dict:
    """Write a payment entity and mark the payment item paid.

    BINDING name — Plan 3's Stripe webhook calls this with provider='stripe'
    and provider_ref=<checkout session id>. `amount` is INTEGER CENTS.
    The item goes straight to 'verified': the payment record is the
    verification evidence (deliberate bypass of the submitted->verified path).
    """
    if item_row.get("kind") != "payment":
        raise HTTPException(400, "settle_payment_item targets a payment item")
    if item_row.get("status") in {"verified", "waived"}:
        raise HTTPException(409, f"Payment item is already {item_row.get('status')}")
    payment_base = {
        "application_id": application_entity_id,
        "item_id": item_row["entity_id"],
        "kind": kind,
        "amount": int(amount),
        "currency": currency,
        "status": "paid",
        "provider": provider,
        "paid_at": now_iso(),
    }
    if provider_ref:
        payment_base["provider_ref"] = provider_ref
    if recorded_by:
        payment_base["recorded_by"] = recorded_by
    payment = dc.dc_create(tenant_id, "payment", payment_base, token)
    item_base = entity_base_data(item_row)
    item_base["status"] = "verified"
    item_base["completed_by"] = actor
    item_base["payload_ref"] = payment["entity_id"]
    item = dc.dc_update(tenant_id, "application_item", item_row["entity_id"], item_base, token)
    log_activity(tenant_id, application_entity_id, "item_change",
                 item_row.get("status", "not_started"),
                 f"{item_row.get('title', 'Payment')}:paid:{provider}", actor, token)
    return {"payment": payment, "item": item}
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_engine.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/engine.py enrollx/backend/tests/test_registration_engine.py
git commit -m "feat(enrollx): lifecycle engine core with capacity, creation, and payment settlement"
```

---

### Task 8: Email module (Resend)

**Files:**
- Create: `enrollx/backend/app/registration/emails.py`
- Test: `enrollx/backend/tests/test_registration_emails.py` (create)

**Interfaces:**
- Consumes: `settings.resend_api_key` / `settings.email_from` (Task 1), `engine.log_activity` (Task 7).
- Produces: `send_email(to, subject, html) -> str` (returns `"sent" | "logged" | "failed"`; `"logged"` when `ENROLLX_RESEND_API_KEY` is unset — dev/test mode); BINDING `send_application_email(tenant_id, application_entity_id, kind, to, subject, html, token=None) -> str` (sends AND writes an `application_activity` of type `email_sent` with `to_value = "{kind}:{to}:{outcome}"`); v1 templates, each returning `(subject, html)`: `magic_link_email(program_label, link)`, `submission_receipt_email(program_label, application_display_id)`, `status_change_email(program_label, new_status)`, `action_needed_email(program_label, item_title, reason)`. Email failures NEVER raise — actions must not fail because Resend is down.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_registration_emails.py
"""Resend email: key-unset logging mode, real POST shape, activity logging."""
import httpx
import pytest

from app.config import settings
from app.registration import emails
from tests.fakes import FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_send_email_logs_when_key_unset(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "")
    hit = {}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: hit.setdefault("called", True))
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "logged"
    assert "called" not in hit


def test_send_email_posts_to_resend(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "re_key")
    captured = {}

    class R:
        status_code = 200

    def fake_post(url, headers=None, json=None, timeout=None):
        captured.update(url=url, headers=headers, json=json)
        return R()

    monkeypatch.setattr(httpx, "post", fake_post)
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "sent"
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_key"
    assert captured["json"]["from"] == settings.email_from
    assert captured["json"]["to"] == ["p@x.com"]
    assert captured["json"]["subject"] == "Hi"
    assert captured["json"]["html"] == "<p>hi</p>"


def test_send_email_failure_is_swallowed(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "re_key")

    class R:
        status_code = 422
        text = "bad"

    monkeypatch.setattr(httpx, "post", lambda *a, **k: R())
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "failed"

    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "post", boom)
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "failed"


def test_send_application_email_logs_activity(fake_dc, monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "")
    outcome = emails.send_application_email("acme", "app-eid-1", "magic_link",
                                            "p@x.com", "Subject", "<p>x</p>")
    assert outcome == "logged"
    acts = fake_dc.find("application_activity", application_id="app-eid-1")
    assert len(acts) == 1
    assert acts[0]["type"] == "email_sent"
    assert acts[0]["to_value"] == "magic_link:p@x.com:logged"


def test_templates_return_subject_and_html():
    for subject, html in (
        emails.magic_link_email("Fall 2026", "https://x/application/tok"),
        emails.submission_receipt_email("Fall 2026", "AC-RA260001"),
        emails.status_change_email("Fall 2026", "approved"),
        emails.action_needed_email("Fall 2026", "Immunization Record", "blurry scan"),
    ):
        assert isinstance(subject, str) and subject
        assert isinstance(html, str) and html.startswith("<")
    _, html = emails.magic_link_email("Fall 2026", "https://x/application/tok")
    assert "https://x/application/tok" in html
    _, html = emails.action_needed_email("Fall 2026", "Immunization Record", "blurry scan")
    assert "Immunization Record" in html and "blurry scan" in html
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_emails.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.registration.emails'`.

- [ ] **Step 3: Implement `emails.py`**

```python
# enrollx/backend/app/registration/emails.py
"""Resend email delivery (spec section 9, v1 templates).

When ENROLLX_RESEND_API_KEY is unset (dev/test), messages are logged instead
of sent. Every application-scoped send is recorded as an application_activity
of type email_sent. Failures never raise — lifecycle actions must not break
because email is down.
"""
import logging

import httpx

from app.config import settings
from app.registration.engine import log_activity

logger = logging.getLogger("enrollx.emails")

RESEND_URL = "https://api.resend.com/emails"


def send_email(to: str, subject: str, html: str) -> str:
    """Returns 'sent', 'logged' (no API key configured), or 'failed'."""
    if not settings.resend_api_key:
        logger.info("EMAIL (logged, ENROLLX_RESEND_API_KEY unset): to=%s subject=%r",
                    to, subject)
        return "logged"
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to],
                  "subject": subject, "html": html},
            timeout=15.0,
        )
    except httpx.RequestError:
        logger.warning("EMAIL failed (Resend unreachable): to=%s subject=%r", to, subject)
        return "failed"
    if resp.status_code >= 400:
        logger.warning("EMAIL failed (%s): to=%s subject=%r body=%s",
                       resp.status_code, to, subject, getattr(resp, "text", ""))
        return "failed"
    return "sent"


def send_application_email(tenant_id, application_entity_id, kind, to, subject, html,
                           token=None) -> str:
    """BINDING name (Plans 3/5). Send + log as application_activity email_sent."""
    outcome = send_email(to, subject, html)
    log_activity(tenant_id, application_entity_id, "email_sent", "",
                 f"{kind}:{to}:{outcome}", "system", token)
    return outcome


# ── v1 templates ──────────────────────────────────────────────────────────

def magic_link_email(program_label: str, link: str) -> tuple[str, str]:
    return (
        f"Your registration link — {program_label}",
        f"<p>Use this link to continue your registration for {program_label} "
        f"and to check its status any time:</p>"
        f'<p><a href="{link}">{link}</a></p>'
        f"<p>Keep this email — the link is your access to the application.</p>",
    )


def submission_receipt_email(program_label: str, application_display_id: str) -> tuple[str, str]:
    return (
        f"Application received — {program_label}",
        f"<p>We received your application ({application_display_id}) for "
        f"{program_label}. We will email you when its status changes.</p>",
    )


def status_change_email(program_label: str, new_status: str) -> tuple[str, str]:
    label = new_status.replace("_", " ")
    return (
        f"Application update — {program_label}",
        f"<p>Your application for {program_label} is now: <strong>{label}</strong>.</p>"
        f"<p>Open your registration link for details and any remaining steps.</p>",
    )


def action_needed_email(program_label: str, item_title: str, reason: str) -> tuple[str, str]:
    why = f" Reason: {reason}" if reason else ""
    return (
        f"Action needed — {program_label}",
        f"<p>An item on your application needs attention: "
        f"<strong>{item_title}</strong>.{why}</p>"
        f"<p>Open your registration link to fix it.</p>",
    )
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_registration_emails.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/emails.py enrollx/backend/tests/test_registration_emails.py
git commit -m "feat(enrollx): Resend email module with log-instead-of-send dev mode"
```

---

### Task 9: Application creation endpoint

**Files:**
- Create: `enrollx/backend/app/api/registration.py`
- Modify: `enrollx/backend/app/main.py`
- Test: `enrollx/backend/tests/test_applications_api.py` (create)

**Interfaces:**
- Consumes: `require_staff_tenant` (Plan 1 `app/tenancy.py`), `engine.create_application` (Task 7).
- Produces (roadmap contract): `POST /api/registration/{tenant_id}/applications` body `{program_id, school_year, channel: "parent"|"admin", applicant_email?}` → `201 {"application": <entity>, "items": [<entity>, ...]}`. Also the module-level `router` that Task 10 extends with the actions route.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_applications_api.py
"""POST /api/registration/{tenant}/applications — staff creation endpoint."""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


BODY = {"program_id": "PR1", "school_year": "2026-2027",
        "channel": "admin", "applicant_email": "parent@example.com"}


def test_create_application_201_with_items(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json=BODY)
    assert resp.status_code == 201
    data = resp.json()
    assert data["application"]["base_data"]["status"] == "draft"
    assert data["application"]["base_data"]["channel_started"] == "admin"
    assert len(data["items"]) == 4
    kinds = sorted(i["base_data"]["kind"] for i in data["items"])
    assert kinds == ["document", "document", "form", "payment"]


def test_create_application_404_without_config(client, fake_dc):
    resp = client.post("/api/registration/acme/applications",
                       json={**BODY, "program_id": "PRX"})
    assert resp.status_code == 404


def test_create_application_validates_channel(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications",
                       json={**BODY, "channel": "carrier-pigeon"})
    assert resp.status_code == 422


def test_create_application_requires_auth(fake_dc):
    resp = TestClient(app).post("/api/registration/acme/applications", json=BODY)
    assert resp.status_code == 401


def test_create_application_cross_tenant_403(client, fake_dc):
    resp = client.post("/api/registration/globex/applications", json=BODY)
    assert resp.status_code == 403


def test_create_application_parent_role_403(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "p1", "tenant_id": "acme", "role": "parent", "_token": "Bearer x"}
    try:
        resp = TestClient(app).post("/api/registration/acme/applications", json=BODY)
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_applications_api.py -v`
Expected: FAIL — 404s (route does not exist yet).

- [ ] **Step 3: Implement the route module**

```python
# enrollx/backend/app/api/registration.py
"""Registration lifecycle routes: application creation + the single typed
action endpoint (the action route is added in the next task)."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.registration import engine
from app.tenancy import require_staff_tenant

router = APIRouter()


class ApplicationCreate(BaseModel):
    program_id: str
    school_year: str
    channel: Literal["parent", "admin"]
    applicant_email: str | None = None


@router.post("/registration/{tenant_id}/applications", status_code=201)
def create_application(tenant_id: str, body: ApplicationCreate,
                       user=Depends(require_staff_tenant)):
    return engine.create_application(
        tenant_id, body.program_id, body.school_year, body.channel,
        body.applicant_email, actor=user.get("user_id", "staff"),
        token=user.get("_token"))
```

- [ ] **Step 4: Mount the router.** In `enrollx/backend/app/main.py`: extend the api import line to include `registration` (`from app.api import auth, entities, health, query, registration`) and add after the existing `include_router` lines:

```python
app.include_router(registration.router, prefix="/api", tags=["registration"])
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_applications_api.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/api/registration.py enrollx/backend/app/main.py enrollx/backend/tests/test_applications_api.py
git commit -m "feat(enrollx): staff application creation endpoint with derived items"
```

---

### Task 10: Action endpoint — dispatcher + runtime actions (save_draft, complete_item, submit)

**Files:**
- Create: `enrollx/backend/app/registration/actions.py`
- Modify: `enrollx/backend/app/api/registration.py`
- Test: `enrollx/backend/tests/test_actions_runtime.py` (create)

**Interfaces:**
- Consumes: `engine` (Task 7), `emails` (Task 8), `statuses.assert_item_transition` (Task 3).
- Produces (roadmap contract): `POST /api/registration/{tenant_id}/applications/{application_id}/actions` body `{"action": <name>, ...params}`. This task delivers the dispatcher (`perform_action(tenant_id, application_entity_id, action, params, actor, token=None)`, `ALL_ACTIONS`, `PARENT_ACTIONS = {"save_draft", "complete_item", "submit"}` — BINDING, Plan 5 imports `PARENT_ACTIONS` and `perform_action`) plus the three runtime handlers. Unknown action → 400 listing `ALL_ACTIONS`; not-yet-implemented actions raise `NotImplementedError` until Tasks 11–13 replace them.
- Action params (contract for Plans 4–5): `save_draft {draft_data: object}` (top-level merge into the application's `draft_data` JSON; allowed in `draft` and `pending_items`); `complete_item {item_id (entity_id), payload_ref?}` (item → `submitted`, sets `completed_by`; allowed while application is `draft, submitted, in_review, pending_items, approved`; a `pending_items` application with no remaining `rejected` items returns to `in_review`); `submit {}` (requires all blocking items in `submitted|verified|waived`, else 409 with the incomplete titles; capacity full → `waitlisted` else `submitted`; stamps `submitted_at`; emails receipt or waitlist notice to `applicant_email`).

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_actions_runtime.py
"""Runtime actions: save_draft, complete_item, submit (incl. capacity)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def create_application(client, fake_dc, capacity=None):
    seed_program_and_config(fake_dc, capacity=capacity)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    return resp.json()


def act(client, app_eid, action, **params):
    return client.post(f"/api/registration/acme/applications/{app_eid}/actions",
                       json={"action": action, **params})


def complete_all_blocking(client, created):
    eid = created["application"]["entity_id"]
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            assert act(client, eid, "complete_item",
                       item_id=item["entity_id"]).status_code == 200


def test_unknown_action_is_400(client, fake_dc):
    created = create_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "explode")
    assert resp.status_code == 400
    assert "save_draft" in str(resp.json()["detail"])


def test_unknown_application_is_404(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = act(client, "nope", "save_draft", draft_data={})
    assert resp.status_code == 404


def test_save_draft_merges_top_level_keys(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "save_draft",
               draft_data={"student": {"first_name": "Mia"}}).status_code == 200
    assert act(client, eid, "save_draft",
               draft_data={"payment_plan_selection": {"plan": "deposit"}}).status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    draft = json.loads(row["draft_data"])
    assert draft["student"] == {"first_name": "Mia"}
    assert draft["payment_plan_selection"] == {"plan": "deposit"}


def test_save_draft_rejects_non_object(client, fake_dc):
    created = create_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "save_draft", draft_data=[1])
    assert resp.status_code == 400


def test_complete_item_sets_submitted_and_actor(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    item = created["items"][0]
    resp = act(client, eid, "complete_item", item_id=item["entity_id"], payload_ref="form:b1")
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    assert row["status"] == "submitted"
    assert row["completed_by"] == "u1"
    assert row["payload_ref"] == "form:b1"


def test_complete_item_of_other_application_404(client, fake_dc):
    a = create_application(client, fake_dc)
    other = fake_dc.dc_create("acme", "application_item", {
        "item_id": "x", "application_id": "other-app", "block_id": "b1",
        "kind": "form", "title": "F", "status": "not_started", "blocking": True})
    resp = act(client, a["application"]["entity_id"], "complete_item",
               item_id=other["entity_id"])
    assert resp.status_code == 404


def test_submit_blocked_until_blocking_items_done(client, fake_dc):
    created = create_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "submit")
    assert resp.status_code == 409
    assert "Student Info" in str(resp.json()["detail"])


def test_submit_happy_path_emails_and_logs(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    complete_all_blocking(client, created)
    resp = act(client, eid, "submit")
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "submitted"
    assert row["submitted_at"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "status_change" and a["to_value"] == "submitted" for a in acts)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("submission_receipt:")
               for a in acts)


def test_submit_waitlists_when_program_full(client, fake_dc):
    created = create_application(client, fake_dc, capacity=1)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A9", "program_id": "PR1", "status": "approved"})
    complete_all_blocking(client, created)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "submit").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "waitlisted"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("status_change:")
               for a in acts)


def test_double_submit_409(client, fake_dc):
    created = create_application(client, fake_dc)
    complete_all_blocking(client, created)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "submit").status_code == 200
    assert act(client, eid, "submit").status_code == 409
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_runtime.py -v`
Expected: FAIL — 404s (actions route missing) after `ModuleNotFoundError` is resolved by creating the files below.

- [ ] **Step 3: Implement `actions.py` (dispatcher + runtime handlers)**

```python
# enrollx/backend/app/registration/actions.py
"""The single typed-action dispatcher behind
POST /api/registration/{tenant}/applications/{application_id}/actions.

PARENT_ACTIONS and perform_action are BINDING names — Plan 5's familyhub
facade calls them via the /internal token routes.
"""
import json

from fastapi import HTTPException

from app.registration import datacore as dc
from app.registration import emails, engine
from app.registration.statuses import assert_item_transition

PARENT_ACTIONS = {"save_draft", "complete_item", "submit"}

ALL_ACTIONS = {
    "save_draft", "complete_item", "submit", "approve", "decline",
    "request_changes", "verify_item", "reject_item", "waive_item",
    "record_offline_payment", "promote_waitlist", "publish_config", "resend_link",
}

COMPLETE_ITEM_APP_STATUSES = {"draft", "submitted", "in_review", "pending_items", "approved"}


def perform_action(tenant_id, application_entity_id, action, params, actor, token=None):
    if action not in ALL_ACTIONS:
        raise HTTPException(
            400, f"Unknown action '{action}'. Allowed: {sorted(ALL_ACTIONS)}")
    return _HANDLERS[action](tenant_id, application_entity_id, params, actor, token)


# ── shared helpers ────────────────────────────────────────────────────────

def _require_item(tenant_id, application_entity_id, params, token):
    item_id = params.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    item = dc.get_entity(tenant_id, "application_item", item_id, token)
    if not item or item.get("application_id") != application_entity_id:
        raise HTTPException(404, "Item not found on this application")
    return item


def _update_item(tenant_id, item_row, changes, actor, token):
    base = engine.entity_base_data(item_row)
    base.update(changes)
    updated = dc.dc_update(tenant_id, "application_item", item_row["entity_id"], base, token)
    engine.log_activity(
        tenant_id, item_row.get("application_id", ""), "item_change",
        item_row.get("status", "not_started"),
        f"{item_row.get('title', 'item')}:{changes.get('status', '?')}", actor, token)
    return updated


def _maybe_enroll(tenant_id, application_entity_id, actor, token):
    """approved -> enrolled once every item is verified or waived."""
    app_row = engine.get_application(tenant_id, application_entity_id, token)
    if not app_row or app_row.get("status") != "approved":
        return None
    items = engine.get_items(tenant_id, application_entity_id, token)
    if all(i.get("status") in {"verified", "waived"} for i in items):
        return engine.set_application_status(tenant_id, app_row, "enrolled", actor, token)
    return None


def _program_label(app_row):
    return str(app_row.get("program_id", ""))


# ── runtime handlers ──────────────────────────────────────────────────────

def _save_draft(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    status = app_row.get("status", "draft")
    if status not in {"draft", "pending_items"}:
        raise HTTPException(409, {"error": f"save_draft not allowed in status '{status}'",
                                  "allowed": ["draft", "pending_items"]})
    patch = params.get("draft_data")
    if not isinstance(patch, dict):
        raise HTTPException(400, "draft_data must be a JSON object")
    draft = json.loads(app_row.get("draft_data") or "{}")
    draft.update(patch)
    updated = engine.update_application(tenant_id, app_row,
                                        {"draft_data": json.dumps(draft)}, token)
    return {"application": updated}


def _complete_item(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    status = app_row.get("status", "draft")
    if status not in COMPLETE_ITEM_APP_STATUSES:
        raise HTTPException(409, {"error": f"complete_item not allowed in status '{status}'",
                                  "allowed": sorted(COMPLETE_ITEM_APP_STATUSES)})
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "submitted")
    changes = {"status": "submitted", "completed_by": actor}
    if params.get("payload_ref"):
        changes["payload_ref"] = str(params["payload_ref"])
    updated_item = _update_item(tenant_id, item, changes, actor, token)
    result = {"item": updated_item}
    if status == "pending_items":
        items = engine.get_items(tenant_id, application_entity_id, token)
        if not any(i.get("status") == "rejected" for i in items):
            result["application"] = engine.set_application_status(
                tenant_id, app_row, "in_review", actor, token)
    return result


def _submit(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    items = engine.get_items(tenant_id, application_entity_id, token)
    incomplete = [i.get("title", "?") for i in items
                  if i.get("blocking") and i.get("status") not in engine.ITEM_DONE_STATUSES]
    if incomplete:
        raise HTTPException(409, {"error": "Blocking items incomplete", "items": incomplete})
    full = engine.is_capacity_full(tenant_id, app_row.get("program_id", ""), token)
    target = "waitlisted" if full else "submitted"
    updated = engine.set_application_status(
        tenant_id, app_row, target, actor, token,
        extra_changes={"submitted_at": engine.now_iso()})
    email = app_row.get("applicant_email")
    if email:
        if target == "submitted":
            subject, html = emails.submission_receipt_email(
                _program_label(app_row), app_row.get("application_id", ""))
            kind = "submission_receipt"
        else:
            subject, html = emails.status_change_email(_program_label(app_row), "waitlisted")
            kind = "status_change"
        emails.send_application_email(tenant_id, application_entity_id, kind,
                                      email, subject, html, token)
    return {"application": updated}


def _not_implemented(name):
    def handler(tenant_id, application_entity_id, params, actor, token):
        raise NotImplementedError(f"action '{name}' arrives in a later task")
    return handler


_HANDLERS = {
    "save_draft": _save_draft,
    "complete_item": _complete_item,
    "submit": _submit,
    # Replaced in Tasks 11-13:
    "approve": _not_implemented("approve"),
    "decline": _not_implemented("decline"),
    "request_changes": _not_implemented("request_changes"),
    "verify_item": _not_implemented("verify_item"),
    "reject_item": _not_implemented("reject_item"),
    "waive_item": _not_implemented("waive_item"),
    "record_offline_payment": _not_implemented("record_offline_payment"),
    "promote_waitlist": _not_implemented("promote_waitlist"),
    "publish_config": _not_implemented("publish_config"),
    "resend_link": _not_implemented("resend_link"),
}
```

- [ ] **Step 4: Add the route.** In `enrollx/backend/app/api/registration.py`, add to the imports `from pydantic import BaseModel, ConfigDict` (replacing the bare `BaseModel` import) and `from app.registration.actions import perform_action`, then append:

```python
class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


@router.post("/registration/{tenant_id}/applications/{application_id}/actions")
def application_action(tenant_id: str, application_id: str, body: ActionRequest,
                       user=Depends(require_staff_tenant)):
    params = body.model_dump(exclude={"action"})
    return perform_action(tenant_id, application_id, body.action, params,
                          actor=user.get("user_id", "staff"), token=user.get("_token"))
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_runtime.py backend/tests/test_applications_api.py -v`
Expected: all pass (11 + 6).

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/registration/actions.py enrollx/backend/app/api/registration.py enrollx/backend/tests/test_actions_runtime.py
git commit -m "feat(enrollx): action endpoint with save_draft, complete_item, submit and capacity waitlisting"
```

---

### Task 11: Review actions (verify_item, reject_item, waive_item, request_changes, decline, promote_waitlist, resend_link, record_offline_payment)

**Files:**
- Modify: `enrollx/backend/app/registration/actions.py`
- Test: `enrollx/backend/tests/test_actions_review.py` (create)

**Interfaces:**
- Consumes: Task 10's dispatcher, `engine.settle_payment_item` (Task 7), `tokens` (Task 5), `emails` (Task 8).
- Produces action params (contract for Plans 3–5): `verify_item {item_id}` (submitted → verified; may derive `enrolled`); `reject_item {item_id, reason?}` (item → rejected; application `submitted|in_review` → `pending_items`; action-needed email); `waive_item {item_id}` (any non-final item → waived; may derive `enrolled`); `request_changes {note?}` (→ `pending_items`, optional `note` activity, action-needed email); `decline {}` (→ `declined`, stamps `decided_at`, status-change email); `promote_waitlist {}` (`waitlisted` → `in_review`); `resend_link {}` (issues token from current `token_version`, emails it, returns `{"link": ...}`; 400 without `applicant_email`); `record_offline_payment {item_id, amount (int cents), currency?, kind?}` → `engine.settle_payment_item(provider="offline", ...)`.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_actions_review.py
"""Staff review actions on the single action endpoint."""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def act(client, app_eid, action, **params):
    return client.post(f"/api/registration/acme/applications/{app_eid}/actions",
                       json={"action": action, **params})


def submitted_application(client, fake_dc, capacity=None):
    seed_program_and_config(fake_dc, capacity=capacity)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    created = resp.json()
    eid = created["application"]["entity_id"]
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    act(client, eid, "submit")
    return created


def item_by_title(created, title):
    return next(i for i in created["items"] if i["base_data"]["title"] == title)


def test_verify_item_requires_submitted_state(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    report_card = item_by_title(created, "Report Card")  # non-blocking, not_started
    assert act(client, eid, "verify_item", item_id=report_card["entity_id"]).status_code == 409


def test_verify_item_happy(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    form = item_by_title(created, "Student Info")
    assert act(client, eid, "verify_item", item_id=form["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "application_item", form["entity_id"])["status"] == "verified"


def test_reject_item_flips_to_pending_items_and_emails(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    doc = item_by_title(created, "Immunization Record")
    resp = act(client, eid, "reject_item", item_id=doc["entity_id"], reason="blurry scan")
    assert resp.status_code == 200
    assert fake_dc.get_entity("acme", "application_item", doc["entity_id"])["status"] == "rejected"
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "pending_items"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("action_needed:")
               for a in acts)


def test_complete_rejected_item_returns_to_in_review(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    doc = item_by_title(created, "Immunization Record")
    act(client, eid, "reject_item", item_id=doc["entity_id"])
    assert act(client, eid, "complete_item", item_id=doc["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "in_review"


def test_waive_item(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    report_card = item_by_title(created, "Report Card")
    assert act(client, eid, "waive_item", item_id=report_card["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "application_item",
                              report_card["entity_id"])["status"] == "waived"


def test_request_changes_with_note(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = act(client, eid, "request_changes", note="please redo the form")
    assert resp.status_code == 200
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "pending_items"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "note" and a["to_value"] == "please redo the form" for a in acts)


def test_decline_stamps_decided_at_and_emails(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "decline").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "declined"
    assert row["decided_at"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("status_change:")
               for a in acts)


def test_promote_waitlist(client, fake_dc):
    created = submitted_application(client, fake_dc, capacity=0)  # forces waitlisted
    eid = created["application"]["entity_id"]
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "waitlisted"
    assert act(client, eid, "promote_waitlist").status_code == 200
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "in_review"


def test_resend_link_returns_link_and_logs(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = act(client, eid, "resend_link")
    assert resp.status_code == 200
    assert "/application/" in resp.json()["link"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("magic_link:")
               for a in acts)


def test_resend_link_400_without_email(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin"})
    eid = resp.json()["application"]["entity_id"]
    assert act(client, eid, "resend_link").status_code == 400


def test_record_offline_payment(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    payment_item = item_by_title(created, "Payment")
    resp = act(client, eid, "record_offline_payment",
               item_id=payment_item["entity_id"], amount=10000, kind="deposit")
    assert resp.status_code == 200
    pay = fake_dc.find("payment", application_id=eid)[0]
    assert pay["provider"] == "offline" and pay["amount"] == 10000
    assert pay["recorded_by"] == "u1" and pay["kind"] == "deposit"
    assert fake_dc.get_entity("acme", "application_item",
                              payment_item["entity_id"])["status"] == "verified"


def test_record_offline_payment_requires_int_amount_and_payment_item(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    payment_item = item_by_title(created, "Payment")
    form_item = item_by_title(created, "Student Info")
    assert act(client, eid, "record_offline_payment",
               item_id=payment_item["entity_id"], amount="100.50").status_code == 400
    assert act(client, eid, "record_offline_payment",
               item_id=form_item["entity_id"], amount=100).status_code == 400
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_review.py -v`
Expected: FAIL — 500s from `NotImplementedError` placeholders.

- [ ] **Step 3: Implement the handlers.** In `enrollx/backend/app/registration/actions.py`, add `from app.registration import tokens` to the imports, add the functions below, and replace the corresponding `_not_implemented(...)` entries in `_HANDLERS` with them (leave `approve` and `publish_config` as placeholders for Tasks 12–13):

```python
def _verify_item(tenant_id, application_entity_id, params, actor, token):
    engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "verified")
    updated_item = _update_item(tenant_id, item, {"status": "verified"}, actor, token)
    result = {"item": updated_item}
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    if enrolled:
        result["application"] = enrolled
    return result


def _reject_item(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "rejected")
    updated_item = _update_item(tenant_id, item, {"status": "rejected"}, actor, token)
    result = {"item": updated_item}
    if app_row.get("status") in {"submitted", "in_review"}:
        result["application"] = engine.set_application_status(
            tenant_id, app_row, "pending_items", actor, token)
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.action_needed_email(
            _program_label(app_row), item.get("title", "item"),
            str(params.get("reason", "")))
        emails.send_application_email(tenant_id, application_entity_id, "action_needed",
                                      email, subject, html, token)
    return result


def _waive_item(tenant_id, application_entity_id, params, actor, token):
    engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    assert_item_transition(item.get("status", "not_started"), "waived")
    updated_item = _update_item(tenant_id, item, {"status": "waived"}, actor, token)
    result = {"item": updated_item}
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    if enrolled:
        result["application"] = enrolled
    return result


def _request_changes(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    updated = engine.set_application_status(tenant_id, app_row, "pending_items", actor, token)
    note = str(params.get("note", "")).strip()
    if note:
        engine.log_activity(tenant_id, application_entity_id, "note", "", note, actor, token)
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.action_needed_email(
            _program_label(app_row), "Application changes requested", note)
        emails.send_application_email(tenant_id, application_entity_id, "action_needed",
                                      email, subject, html, token)
    return {"application": updated}


def _decline(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    updated = engine.set_application_status(
        tenant_id, app_row, "declined", actor, token,
        extra_changes={"decided_at": engine.now_iso()})
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.status_change_email(_program_label(app_row), "declined")
        emails.send_application_email(tenant_id, application_entity_id, "status_change",
                                      email, subject, html, token)
    return {"application": updated}


def _promote_waitlist(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    updated = engine.set_application_status(tenant_id, app_row, "in_review", actor, token)
    return {"application": updated}


def _resend_link(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    email = app_row.get("applicant_email")
    if not email:
        raise HTTPException(400, "Application has no applicant_email to send the link to")
    link_token = tokens.make_link_token(tenant_id, application_entity_id,
                                        int(app_row.get("token_version") or 1))
    link = tokens.magic_link_url(link_token)
    subject, html = emails.magic_link_email(_program_label(app_row), link)
    emails.send_application_email(tenant_id, application_entity_id, "magic_link",
                                  email, subject, html, token)
    return {"link": link}


def _record_offline_payment(tenant_id, application_entity_id, params, actor, token):
    engine.require_application(tenant_id, application_entity_id, token)
    item = _require_item(tenant_id, application_entity_id, params, token)
    amount = params.get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool):
        raise HTTPException(400, "amount is required as integer cents")
    result = engine.settle_payment_item(
        tenant_id, application_entity_id, item,
        provider="offline", kind=str(params.get("kind", "offline")),
        amount=amount, currency=str(params.get("currency", "USD")),
        recorded_by=actor, actor=actor, token=token)
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    if enrolled:
        result["application"] = enrolled
    return result
```

Then update `_HANDLERS`:

```python
_HANDLERS = {
    "save_draft": _save_draft,
    "complete_item": _complete_item,
    "submit": _submit,
    "verify_item": _verify_item,
    "reject_item": _reject_item,
    "waive_item": _waive_item,
    "request_changes": _request_changes,
    "decline": _decline,
    "promote_waitlist": _promote_waitlist,
    "resend_link": _resend_link,
    "record_offline_payment": _record_offline_payment,
    # Replaced in Tasks 12-13:
    "approve": _not_implemented("approve"),
    "publish_config": _not_implemented("publish_config"),
}
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_review.py backend/tests/test_actions_runtime.py -v`
Expected: all pass (13 + 11).

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/actions.py enrollx/backend/tests/test_actions_review.py
git commit -m "feat(enrollx): review actions incl. offline payment recording and link resend"
```

---

### Task 12: Approve action with side effects (family match-or-create, student, enrollment, due dates, enrolled derivation)

**Files:**
- Modify: `enrollx/backend/app/registration/actions.py`
- Test: `enrollx/backend/tests/test_actions_approve.py` (create)

**Interfaces:**
- Consumes: `family.match_or_create_family` (Task 6), `engine` (Task 7), `emails` (Task 8), the `draft_data` shape contract (`student` / `family` top-level keys).
- Produces: `approve {}` — allowed from `submitted | in_review`. Side effects in order: (1) match-or-create family from `draft_data.family` (+ `applicant_email` as `primary_email` fallback); (2) create `student` entity (`first_name`/`last_name` + all other draft student fields, `family_id`, `status: "Enrolled"`); (3) create `enrollment` entity (`student_id` = student entity_id, `program_id`, `enrollment_date` = today, `status: "active"`); (4) stamp `due_at = now + due_days_after_approval` on unfinished items carrying that field; (5) application → `approved` with `family_id`, `student_id`, `decided_at`; (6) status-change email; (7) derive `enrolled` if every item is already `verified|waived`. Returns `{"application", "family_id", "student_id", "enrollment_id"}`.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_actions_approve.py
"""Approve: family match-or-create, student + enrollment creation, due dates,
enrolled derivation."""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def act(client, app_eid, action, **params):
    return client.post(f"/api/registration/acme/applications/{app_eid}/actions",
                       json={"action": action, **params})


DRAFT = {
    "student": {"first_name": "Mia", "last_name": "Lee", "grade_level": "3"},
    "family": {"family_name": "Lee Family", "primary_email": "parent@example.com",
               "primary_phone": "5551234567", "primary_address": "1 Main St"},
}


def submitted_application(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    created = resp.json()
    eid = created["application"]["entity_id"]
    act(client, eid, "save_draft", draft_data=DRAFT)
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    act(client, eid, "submit")
    return created


def test_approve_only_from_submitted_or_in_review(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin"})
    eid = resp.json()["application"]["entity_id"]
    assert act(client, eid, "approve").status_code == 409  # still draft


def test_approve_creates_family_student_enrollment(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = act(client, eid, "approve")
    assert resp.status_code == 200
    data = resp.json()
    fam = fake_dc.find("family", primary_email="parent@example.com")
    assert len(fam) == 1 and fam[0]["entity_id"] == data["family_id"]
    student = fake_dc.find("student", first_name="Mia")[0]
    assert student["entity_id"] == data["student_id"]
    assert student["family_id"] == data["family_id"]
    assert student["status"] == "Enrolled"
    assert student["grade_level"] == "3"
    enrollment = fake_dc.find("enrollment", student_id=data["student_id"])[0]
    assert enrollment["program_id"] == "PR1" and enrollment["status"] == "active"
    assert enrollment["entity_id"] == data["enrollment_id"]
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "approved"
    assert row["family_id"] == data["family_id"]
    assert row["student_id"] == data["student_id"]
    assert row["decided_at"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("status_change:")
               for a in acts)


def test_approve_matches_existing_family(client, fake_dc):
    existing = fake_dc.dc_create("acme", "family", {
        "family_name": "Lee", "primary_email": "PARENT@example.com"})
    created = submitted_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "approve")
    assert resp.json()["family_id"] == existing["entity_id"]
    assert len(fake_dc.find("family")) == 1


def test_approve_stamps_due_dates_on_unfinished_items(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    act(client, eid, "approve")
    items = fake_dc.find("application_item", application_id=eid)
    report_card = next(i for i in items if i["title"] == "Report Card")
    assert report_card["due_at"]  # 14 days after approval
    form = next(i for i in items if i["title"] == "Student Info")
    assert not form.get("due_at")


def test_enrolled_derivation_after_all_items_closed(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    act(client, eid, "approve")
    items = fake_dc.find("application_item", application_id=eid)
    last = None
    for item in items:
        if item["status"] == "submitted":
            last = act(client, eid, "verify_item", item_id=item["entity_id"])
        elif item["status"] not in {"verified", "waived"}:
            last = act(client, eid, "waive_item", item_id=item["entity_id"])
        assert last.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "enrolled"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["from_value"] == "approved" and a["to_value"] == "enrolled" for a in acts)
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_approve.py -v`
Expected: FAIL — 500 `NotImplementedError: action 'approve' ...`.

- [ ] **Step 3: Implement `_approve`.** In `actions.py`, add imports `from datetime import datetime, timedelta, timezone` and `from app.registration.family import match_or_create_family`, add the handler, and set `"approve": _approve` in `_HANDLERS`:

```python
def _approve(tenant_id, application_entity_id, params, actor, token):
    app_row = engine.require_application(tenant_id, application_entity_id, token)
    status = app_row.get("status", "draft")
    if status not in {"submitted", "in_review"}:
        raise HTTPException(409, {"error": f"approve not allowed in status '{status}'",
                                  "allowed": ["submitted", "in_review"]})
    draft = json.loads(app_row.get("draft_data") or "{}")

    # 1. Family: match-or-create from draft family fields (+ applicant email fallback)
    family_fields = dict(draft.get("family") or {})
    if app_row.get("applicant_email") and not family_fields.get("primary_email"):
        family_fields["primary_email"] = app_row["applicant_email"]
    family_id = match_or_create_family(tenant_id, family_fields, token)

    # 2. Student
    student_fields = dict(draft.get("student") or {})
    student_base = {
        "first_name": student_fields.pop("first_name", ""),
        "last_name": student_fields.pop("last_name", ""),
        "family_id": family_id,
        "status": "Enrolled",
    }
    for k, v in student_fields.items():
        if v not in (None, ""):
            student_base.setdefault(k, v)
    student = dc.dc_create(tenant_id, "student", student_base, token)

    # 3. Enrollment
    enrollment = dc.dc_create(tenant_id, "enrollment", {
        "student_id": student["entity_id"],
        "program_id": app_row.get("program_id", ""),
        "enrollment_date": engine.now_iso()[:10],
        "status": "active",
    }, token)

    # 4. Start due-date clocks on unfinished post-approval items
    now = datetime.now(timezone.utc)
    for item in engine.get_items(tenant_id, application_entity_id, token):
        days = item.get("due_days_after_approval")
        if days and not item.get("due_at") and item.get("status") not in {"verified", "waived"}:
            base = engine.entity_base_data(item)
            base["due_at"] = (now + timedelta(days=int(days))).isoformat()
            dc.dc_update(tenant_id, "application_item", item["entity_id"], base, token)

    # 5. Status write with decision fields
    updated = engine.set_application_status(
        tenant_id, app_row, "approved", actor, token,
        extra_changes={"family_id": family_id, "student_id": student["entity_id"],
                       "decided_at": engine.now_iso()})

    # 6. Notify
    email = app_row.get("applicant_email")
    if email:
        subject, html = emails.status_change_email(_program_label(app_row), "approved")
        emails.send_application_email(tenant_id, application_entity_id, "status_change",
                                      email, subject, html, token)

    # 7. Straight to enrolled if nothing remains open
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    return {"application": enrolled or updated,
            "family_id": family_id,
            "student_id": student["entity_id"],
            "enrollment_id": enrollment["entity_id"]}
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_approve.py backend/tests/test_actions_review.py -v`
Expected: all pass (5 + 13).

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/actions.py enrollx/backend/tests/test_actions_approve.py
git commit -m "feat(enrollx): approve action with family/student/enrollment side effects"
```

---

### Task 13: publish_config action

**Files:**
- Modify: `enrollx/backend/app/registration/actions.py`
- Test: `enrollx/backend/tests/test_actions_config.py` (create)

**Interfaces:**
- Consumes: `items.validate_blocks` (Task 4), `engine` (Task 7).
- Produces: `publish_config {}` via the action endpoint, where **the `{application_id}` path segment carries the registration_config entity_id** (contract note 1 — the roadmap folds config publishing into the single action endpoint; Plan 4's builder calls it this way). Behavior: 404 unknown config; 409 already published; 422 with `details` when `validate_blocks` fails or `blocks` is not JSON; on success archives any currently published config for the same program (sets its `status` to `archived` — the entity row stays `_status=active`), sets this config `status=published` and `version = (highest previously published version for the program) + 1` (first publish = 1). Returns `{"config": <updated entity>}`. No application activity is written (configs are not applications).

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_actions_config.py
"""publish_config: block validation, version bump, prior-version archival."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import BLOCKS, FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def publish(client, config_eid):
    # Path quirk (binding): the application_id segment carries the config entity_id.
    return client.post(f"/api/registration/acme/applications/{config_eid}/actions",
                       json={"action": "publish_config"})


def draft_config(fake_dc, blocks=BLOCKS, program_id="PR1", version=1):
    return fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-d", "program_id": program_id, "version": version,
        "status": "draft", "blocks": json.dumps(blocks)})


def test_publish_first_config(client, fake_dc):
    cfg = draft_config(fake_dc)
    resp = publish(client, cfg["entity_id"])
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_config", cfg["entity_id"])
    assert row["status"] == "published"
    assert row["version"] == 1


def test_publish_archives_prior_and_bumps_version(client, fake_dc):
    old = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-old", "program_id": "PR1", "version": 3,
        "status": "published", "blocks": json.dumps(BLOCKS)})
    new = draft_config(fake_dc)
    assert publish(client, new["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "registration_config",
                              old["entity_id"])["status"] == "archived"
    assert fake_dc.get_entity("acme", "registration_config",
                              new["entity_id"])["version"] == 4


def test_publish_unknown_config_404(client, fake_dc):
    assert publish(client, "missing").status_code == 404


def test_publish_already_published_409(client, fake_dc):
    cfg = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "c", "program_id": "PR1", "version": 1,
        "status": "published", "blocks": json.dumps(BLOCKS)})
    assert publish(client, cfg["entity_id"]).status_code == 409


def test_publish_invalid_blocks_422(client, fake_dc):
    bad = draft_config(fake_dc, blocks=[{"block_id": "b1", "type": "mystery", "title": ""}])
    resp = publish(client, bad["entity_id"])
    assert resp.status_code == 422
    assert resp.json()["detail"]["details"]


def test_publish_unparseable_blocks_422(client, fake_dc):
    cfg = fake_dc.dc_create("acme", "registration_config", {
        "config_id": "c", "program_id": "PR1", "version": 1,
        "status": "draft", "blocks": "not-json"})
    assert publish(client, cfg["entity_id"]).status_code == 422
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_config.py -v`
Expected: FAIL — 500 `NotImplementedError: action 'publish_config' ...`.

- [ ] **Step 3: Implement `_publish_config`.** In `actions.py`, add `from app.registration.items import validate_blocks` to the imports, add the handler, and set `"publish_config": _publish_config` in `_HANDLERS` (removing the last `_not_implemented` placeholder):

```python
def _publish_config(tenant_id, config_entity_id, params, actor, token):
    """Path quirk (BINDING, contract note 1): for this action the
    {application_id} path segment carries the registration_config entity_id."""
    cfg = dc.get_entity(tenant_id, "registration_config", config_entity_id, token)
    if not cfg:
        raise HTTPException(404, "registration_config not found")
    if cfg.get("status") == "published":
        raise HTTPException(409, "Config is already published")
    try:
        blocks = json.loads(cfg.get("blocks") or "[]")
    except json.JSONDecodeError:
        raise HTTPException(422, {"error": "blocks is not valid JSON", "details": ["blocks"]})
    errors = validate_blocks(blocks)
    if errors:
        raise HTTPException(422, {"error": "Invalid blocks", "details": errors})

    program_id = cfg.get("program_id", "")
    prior = dc.list_entities(tenant_id, "registration_config",
                             f"program_id = '{program_id}' AND status = 'published'", token)
    max_version = 0
    for p in prior:
        max_version = max(max_version, int(p.get("version") or 0))
        p_base = engine.entity_base_data(p)
        p_base["status"] = "archived"
        dc.dc_update(tenant_id, "registration_config", p["entity_id"], p_base, token)

    base = engine.entity_base_data(cfg)
    base["status"] = "published"
    base["version"] = max_version + 1
    updated = dc.dc_update(tenant_id, "registration_config", cfg["entity_id"], base, token)
    return {"config": updated}
```

- [ ] **Step 4: Run to pass** — and confirm no placeholder handlers remain:

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_actions_config.py -v && grep -c "_not_implemented" backend/app/registration/actions.py`
Expected: 6 passed; the grep prints `1` at most (only the now-unused factory definition — delete the factory too and expect `0`).

- [ ] **Step 5: Commit**

```bash
git add enrollx/backend/app/registration/actions.py enrollx/backend/tests/test_actions_config.py
git commit -m "feat(enrollx): publish_config action with block validation and version bump"
```

---

### Task 14: Internal routes for familyhub (X-Internal-Key)

**Files:**
- Create: `enrollx/backend/app/api/internal.py`
- Modify: `enrollx/backend/app/main.py`
- Test: `enrollx/backend/tests/test_internal_api.py` (create)

**Interfaces:**
- Consumes: `settings.internal_key` (Task 1), `tokens` (Task 5), `engine` (Task 7), `emails` (Task 8), `actions.PARENT_ACTIONS` / `actions.perform_action` (Task 10).
- Produces (BINDING for Plan 5 — all guarded by the `require_internal_key` dependency, header `X-Internal-Key` == `ENROLLX_INTERNAL_KEY`, constant-time compare, 401 on miss; NO JWT on these routes). Per coordination update this is the roadmap's four routes MINUS the token-scoped request-link PLUS three additions:

| Route | Response |
|---|---|
| `POST /internal/registration/{tenant_id}/{program_id}/start` body `{school_year, applicant_email}` | `201 {"application": <entity>, "items": [...], "token": <raw magic-link token>, "link": <familyhub URL>}` — creates a parent-channel application, emails the magic link |
| `GET /internal/registration/{tenant_id}/{program_id}/config` | `200 {"config": <published config entity>, "program": <program entity>, "capacity": {"capacity", "approved", "enrolled", "full"}}`; 404 if program or published config missing |
| `POST /internal/registration/{tenant_id}/request-link` body `{email, program_id?}` | ALWAYS `200 {}` (no account enumeration); when the normalized email matches `applicant_email` on non-`declined`/`withdrawn` applications (optionally filtered by `program_id`), re-sends each magic link |
| `GET /internal/application-by-token/{token}` | `200 {"application", "items", "config"}` (config = version pinned by the application); 401 invalid/revoked token |
| `POST /internal/application-by-token/{token}/actions` body `{"action", ...params}` | parent-permitted subset ONLY (`save_draft, complete_item, submit`); other action names → 403; result = `perform_action(...)` with `actor="parent"`, no DataCore token |
| `GET /internal/application-by-token/{token}/documents` | `200 {"documents": [{"entity_id", "document_id", "filename", "uploaded_by", "item_id"}]}` — the application's `document` entities, EXCLUDING sensitive documents not uploaded by this parent (`uploaded_by != "parent:{app entity_id}"`) |

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_internal_api.py
"""familyhub-facing internal routes: X-Internal-Key guard, magic-link scope,
parent action subset, revocation, documents filtering."""
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.registration import tokens
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config

KEY = {"X-Internal-Key": "dev-internal-key-change-in-prod"}


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    monkeypatch.setattr(settings, "internal_key", "dev-internal-key-change-in-prod")
    return fdc


@pytest.fixture
def client(fake_dc):
    return TestClient(app)


def start(client, email="parent@example.com"):
    return client.post("/internal/registration/acme/PR1/start", headers=KEY,
                       json={"school_year": "2026-2027", "applicant_email": email})


def test_all_internal_routes_require_key(client, fake_dc):
    seed_program_and_config(fake_dc)
    assert client.post("/internal/registration/acme/PR1/start",
                       json={"school_year": "x", "applicant_email": "a@b.c"}).status_code == 401
    assert client.get("/internal/registration/acme/PR1/config").status_code == 401
    assert client.post("/internal/registration/acme/request-link",
                       json={"email": "a@b.c"}).status_code == 401
    assert client.get("/internal/application-by-token/abc").status_code == 401
    assert client.post("/internal/application-by-token/abc/actions",
                       json={"action": "submit"}).status_code == 401
    assert client.get("/internal/application-by-token/abc/documents").status_code == 401
    bad = {"X-Internal-Key": "wrong"}
    assert client.get("/internal/registration/acme/PR1/config",
                      headers=bad).status_code == 401


def test_start_creates_parent_application_with_token(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = start(client)
    assert resp.status_code == 201
    data = resp.json()
    assert data["application"]["base_data"]["channel_started"] == "parent"
    assert data["application"]["base_data"]["applicant_email"] == "parent@example.com"
    assert len(data["items"]) == 4
    assert data["token"] and data["link"].endswith(data["token"])
    eid = data["application"]["entity_id"]
    assert tokens.verify_link_token(data["token"], 1) == ("acme", eid)
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("magic_link:")
               for a in acts)


def test_config_bundle_includes_capacity_state(client, fake_dc):
    seed_program_and_config(fake_dc, capacity=10)
    resp = client.get("/internal/registration/acme/PR1/config", headers=KEY)
    assert resp.status_code == 200
    data = resp.json()
    assert data["config"]["config_id"] == "cfg1"
    assert data["program"]["program_id"] == "PR1"
    assert data["capacity"] == {"capacity": 10, "approved": 0, "enrolled": 0, "full": False}
    assert client.get("/internal/registration/acme/NOPE/config",
                      headers=KEY).status_code == 404


def test_application_by_token_bundle(client, fake_dc):
    seed_program_and_config(fake_dc)
    tok = start(client).json()["token"]
    resp = client.get(f"/internal/application-by-token/{tok}", headers=KEY)
    assert resp.status_code == 200
    data = resp.json()
    assert data["application"]["status"] == "draft"
    assert len(data["items"]) == 4
    assert data["config"]["version"] == 1


def test_revoked_token_is_401(client, fake_dc):
    seed_program_and_config(fake_dc)
    data = start(client).json()
    eid = data["application"]["entity_id"]
    row = fake_dc.get_entity("acme", "registration_application", eid)
    base = {k: v for k, v in row.items()
            if k not in {"entity_id", "entity_type", "_tenant"} and v is not None}
    base["token_version"] = 2
    fake_dc.dc_update("acme", "registration_application", eid, base)
    resp = client.get(f"/internal/application-by-token/{data['token']}", headers=KEY)
    assert resp.status_code == 401


def test_parent_action_subset_enforced(client, fake_dc):
    seed_program_and_config(fake_dc)
    tok = start(client).json()["token"]
    for forbidden in ("approve", "decline", "verify_item", "record_offline_payment",
                      "publish_config", "promote_waitlist"):
        resp = client.post(f"/internal/application-by-token/{tok}/actions",
                           headers=KEY, json={"action": forbidden})
        assert resp.status_code == 403, forbidden


def test_parent_can_complete_and_submit(client, fake_dc):
    seed_program_and_config(fake_dc)
    data = start(client).json()
    tok = data["token"]
    eid = data["application"]["entity_id"]
    assert client.post(f"/internal/application-by-token/{tok}/actions", headers=KEY,
                       json={"action": "save_draft",
                             "draft_data": {"student": {"first_name": "Mia"}}}
                       ).status_code == 200
    for item in data["items"]:
        if item["base_data"]["blocking"]:
            assert client.post(f"/internal/application-by-token/{tok}/actions", headers=KEY,
                               json={"action": "complete_item",
                                     "item_id": item["entity_id"]}).status_code == 200
    assert client.post(f"/internal/application-by-token/{tok}/actions", headers=KEY,
                       json={"action": "submit"}).status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "submitted"
    items = fake_dc.find("application_item", application_id=eid)
    assert all(i["completed_by"] == "parent" for i in items if i["status"] == "submitted")


def test_request_link_always_200_and_sends_only_on_match(client, fake_dc):
    seed_program_and_config(fake_dc)
    eid = start(client).json()["application"]["entity_id"]
    before = len([a for a in fake_dc.find("application_activity", application_id=eid)
                  if a["type"] == "email_sent"])
    resp = client.post("/internal/registration/acme/request-link", headers=KEY,
                       json={"email": "stranger@example.com"})
    assert resp.status_code == 200 and resp.json() == {}
    after_miss = len([a for a in fake_dc.find("application_activity", application_id=eid)
                      if a["type"] == "email_sent"])
    assert after_miss == before
    resp = client.post("/internal/registration/acme/request-link", headers=KEY,
                       json={"email": "  PARENT@example.com ", "program_id": "PR1"})
    assert resp.status_code == 200 and resp.json() == {}
    after_hit = len([a for a in fake_dc.find("application_activity", application_id=eid)
                     if a["type"] == "email_sent"])
    assert after_hit == before + 1


def test_documents_route_filters_sensitive_foreign_uploads(client, fake_dc):
    seed_program_and_config(fake_dc)
    started = start(client).json()
    eid = started["application"]["entity_id"]
    tok = started["token"]
    fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc", "filename": "own-upload.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k1",
        "sensitive": True, "uploaded_by": f"parent:{eid}", "uploaded_at": "2026-08-03"})
    fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc2", "filename": "staff-medical.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k2",
        "sensitive": True, "uploaded_by": "u1", "uploaded_at": "2026-08-03"})
    fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc3", "filename": "staff-plain.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k3",
        "sensitive": False, "uploaded_by": "u1", "uploaded_at": "2026-08-03"})
    resp = client.get(f"/internal/application-by-token/{tok}/documents", headers=KEY)
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    names = sorted(d["filename"] for d in docs)
    assert names == ["own-upload.pdf", "staff-plain.pdf"]
    assert set(docs[0]) == {"entity_id", "document_id", "filename", "uploaded_by", "item_id"}
```

- [ ] **Step 2: Run them**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_internal_api.py -v`
Expected: FAIL — 404s (routes do not exist).

- [ ] **Step 3: Implement `app/api/internal.py`**

```python
# enrollx/backend/app/api/internal.py
"""Private-network routes for familyhub-backend (Plan 5).

Auth: X-Internal-Key header equal to ENROLLX_INTERNAL_KEY (constant-time
compare). No JWT here — these routes are reachable only over the private
network, and every application-scoped route re-validates the magic-link
token against the application's token_version.

Parents may only save_draft / complete_item / submit (PARENT_ACTIONS).
"""
import hmac as hmac_mod

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict

from app.config import settings
from app.registration import emails, engine, tokens
from app.registration.actions import PARENT_ACTIONS, perform_action

NON_RESENDABLE_STATUSES = {"declined", "withdrawn"}


def require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    """BINDING dependency name (Plan 5 tests reference it)."""
    if not x_internal_key or not hmac_mod.compare_digest(
            x_internal_key, settings.internal_key):
        raise HTTPException(401, "Invalid internal key")


router = APIRouter(dependencies=[Depends(require_internal_key)])


class StartRequest(BaseModel):
    school_year: str
    applicant_email: str


class InternalActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


class RequestLinkRequest(BaseModel):
    email: str
    program_id: str | None = None


def _resolve_token(token: str) -> tuple[str, dict]:
    try:
        tenant_id, app_entity_id, _sig = tokens.parse_link_token(token)
    except tokens.TokenError:
        raise HTTPException(401, "Invalid link")
    app_row = engine.get_application(tenant_id, app_entity_id)
    if not app_row:
        raise HTTPException(401, "Invalid link")
    try:
        tokens.verify_link_token(token, int(app_row.get("token_version") or 1))
    except tokens.TokenError:
        raise HTTPException(401, "Invalid link")
    return tenant_id, app_row


def _send_magic_link(tenant_id, app_row):
    link_token = tokens.make_link_token(tenant_id, app_row["entity_id"],
                                        int(app_row.get("token_version") or 1))
    link = tokens.magic_link_url(link_token)
    subject, html = emails.magic_link_email(str(app_row.get("program_id", "")), link)
    emails.send_application_email(tenant_id, app_row["entity_id"], "magic_link",
                                  app_row.get("applicant_email", ""), subject, html)
    return link_token, link


@router.post("/internal/registration/{tenant_id}/{program_id}/start", status_code=201)
def start_application(tenant_id: str, program_id: str, body: StartRequest):
    result = engine.create_application(tenant_id, program_id, body.school_year,
                                       "parent", body.applicant_email, actor="parent")
    app_row = engine.require_application(tenant_id, result["application"]["entity_id"])
    link_token, link = _send_magic_link(tenant_id, app_row)
    return {**result, "token": link_token, "link": link}


@router.get("/internal/registration/{tenant_id}/{program_id}/config")
def public_config(tenant_id: str, program_id: str):
    program = engine.get_program(tenant_id, program_id)
    config = engine.get_published_config(tenant_id, program_id)
    if not program or not config:
        raise HTTPException(404, "Program is not open for registration")
    return {"config": config, "program": program,
            "capacity": engine.capacity_state(tenant_id, program_id)}


@router.post("/internal/registration/{tenant_id}/request-link")
def request_link(tenant_id: str, body: RequestLinkRequest):
    """Token-less lost-link recovery. Always 200 {} — never disclose matches."""
    wanted = body.email.strip().lower()
    from app.registration import datacore as dc

    apps = dc.list_entities(tenant_id, "registration_application", "")
    for app_row in apps:
        if str(app_row.get("applicant_email", "")).strip().lower() != wanted:
            continue
        if body.program_id and app_row.get("program_id") != body.program_id:
            continue
        if app_row.get("status") in NON_RESENDABLE_STATUSES:
            continue
        _send_magic_link(tenant_id, app_row)
    return {}


@router.get("/internal/application-by-token/{token}")
def application_by_token(token: str):
    tenant_id, app_row = _resolve_token(token)
    return {
        "application": app_row,
        "items": engine.get_items(tenant_id, app_row["entity_id"]),
        "config": engine.get_config_for_application(tenant_id, app_row),
    }


@router.post("/internal/application-by-token/{token}/actions")
def action_by_token(token: str, body: InternalActionRequest):
    tenant_id, app_row = _resolve_token(token)
    if body.action not in PARENT_ACTIONS:
        raise HTTPException(
            403, f"Action '{body.action}' is not permitted on the parent channel")
    params = body.model_dump(exclude={"action"})
    return perform_action(tenant_id, app_row["entity_id"], body.action, params,
                          actor="parent", token=None)


@router.get("/internal/application-by-token/{token}/documents")
def documents_by_token(token: str):
    tenant_id, app_row = _resolve_token(token)
    from app.registration import datacore as dc

    eid = app_row["entity_id"]
    own_tag = f"parent:{eid}"
    docs = dc.list_entities(tenant_id, "document", f"application_id = '{eid}'")
    visible = [d for d in docs
               if d.get("uploaded_by") == own_tag or not d.get("sensitive")]
    return {"documents": [{
        "entity_id": d["entity_id"],
        "document_id": d.get("document_id", ""),
        "filename": d.get("filename", ""),
        "uploaded_by": d.get("uploaded_by", ""),
        "item_id": d.get("item_id", ""),
    } for d in visible]}
```

- [ ] **Step 4: Mount the router.** In `enrollx/backend/app/main.py`: extend the api import to include `internal` and add (NO `/api` prefix — the paths already start with `/internal`):

```python
app.include_router(internal.router, tags=["internal"])
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_internal_api.py -v`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/api/internal.py enrollx/backend/app/main.py enrollx/backend/tests/test_internal_api.py
git commit -m "feat(enrollx): internal familyhub routes with X-Internal-Key and magic-link scoping"
```

---

### Task 15: Full-suite verification

- [ ] **Step 1:** Run every affected suite:

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/datacore && uv run python -m pytest tests/ -v
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
```

Expected: everything green (admindash/datacore/familyhub are untouched by this plan except `launchpad/backend/app/data/base_model.json`; if launchpad has a test suite — `ls launchpad/backend/tests` — run it too). Fix regressions before proceeding; do not skip.

- [ ] **Step 2:** Grep hygiene — no leftover placeholders or raw-query violations:

```bash
cd /Users/kennylee/Development/NeoApex
grep -rn "_not_implemented\|NotImplementedError" enrollx/backend/app/registration/actions.py || echo clean
grep -rn "dc_query(" enrollx/backend/app/registration/engine.py enrollx/backend/app/registration/actions.py enrollx/backend/app/api/internal.py || echo clean
```

Expected: both print `clean`.

- [ ] **Step 3:** Boot smoke test: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run uvicorn app.main:app --app-dir backend --port 5910` in the background, then:

```bash
curl -s localhost:5910/api/health
curl -s -X POST localhost:5910/internal/registration/acme/PR1/start -H 'Content-Type: application/json' -d '{"school_year":"2026-2027","applicant_email":"a@b.c"}'
```

Expected: health returns `{"status":"ok","service":"enrollx-backend"}`; the start call returns `401 Invalid internal key` JSON (proving the guard is live without needing DataCore running). Kill the server after.

- [ ] **Step 4: Final commit** of any stragglers (`git status` must end clean), then report completion with the list of commits. Do NOT merge or push — the coordinator handles integration.
