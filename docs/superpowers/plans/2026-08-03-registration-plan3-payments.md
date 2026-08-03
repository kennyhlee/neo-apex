# Registration Phase 1 — Plan 3: Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each tenant online payments through their own Stripe account: Stripe Connect (Standard) onboarding stored on the tenant entity, Checkout Sessions created on the connected account for the application's chosen plan (full / deposit / balance), an idempotent webhook that settles the payment item through Plan 2's lifecycle engine and emails a receipt, a deposit→balance follow-up obligation, and an enrollx PaymentsSettingsPage.

**Architecture:** All payment state is mirrored into `payment` entities in DataCore — enrollx-backend persists nothing and never reports from Stripe queries. Checkout has two entry channels: a staff route guarded by `require_staff_tenant`, and an internal parent route guarded by `X-Internal-Key` + magic-link token (the familyhub facade calls it in Plan 5, per the roadmap's internal-auth contract). The webhook is unauthenticated by nature: it trusts only the Stripe signature, maps the event to a tenant, verifies the connected-account id against the tenant entity **before any write**, and no-ops on replay by looking for an existing `payment` entity with the same `provider_ref`. Item/status mutation goes through Plan 2's engine functions, never raw entity writes. The Connect state is HMAC-signed with `ENROLLX_LINK_SECRET` so the unauthenticated OAuth callback cannot be forged.

**Tech Stack:** Python 3.12 + FastAPI + pydantic_settings + httpx + `stripe` (stripe-python) + pytest (backend); React 19 + TypeScript + Vite, native fetch, CSS variables (frontend). DataCore is the only persistence layer.

## Global Constraints

- Executors use `superpowers:subagent-driven-development` or `superpowers:executing-plans`; TDD; one commit per task.
- Base branch: `docs/registration-flow-design` if it still exists unmerged, else `main`. Work on branch **`feat/registration-plan3-payments`** (Task 0 creates it on top of the branch where Plan 2's code landed — see Task 0).
- DataCore is the ONLY service that persists anything. enrollx-backend holds no state.
- Every authenticated enrollx route enforces tenant match AND role in `{admin, staff}` via `require_staff_tenant` (Plan 1). The webhook and the OAuth callback are deliberately unauthenticated (signature / signed-state verified instead). The internal checkout route uses Plan 2's `X-Internal-Key` guard, never JWT.
- **Tests must NEVER hit Stripe's network or DataCore's network.** Stripe: monkeypatch the `stripe` module's functions (the `fake_stripe` fixture is repeated in full in every test file that needs it). DataCore: monkeypatch the `dc_*` helper functions at the importing module's namespace.
- Frontend: native Fetch, CSS variables only (no raw hex outside theme.css), new user-facing strings in BOTH `en-US` and `zh-CN` in `enrollx/frontend/src/i18n/translations.ts`.
- Money amounts are **integer cents** everywhere (config `amount_full` / `deposit_amount`, Stripe `unit_amount`, `payment.amount`). Currency is a lowercase ISO code, default `usd`.
- Git remotes use SSH. Do not push or open PRs from this plan; stop after the final verification task.

**New environment variables introduced by this plan** (all read by `enrollx/backend/app/config.py`, prefix `ENROLLX_`):

| Env var | Settings field | Default | Purpose |
|---|---|---|---|
| `ENROLLX_STRIPE_CLIENT_ID` | `stripe_client_id` | `""` | Connect OAuth client id (`ca_…`) |
| `ENROLLX_STRIPE_SECRET_KEY` | `stripe_secret_key` | `""` | Platform secret key (`sk_…`) used for the OAuth code exchange and for creating sessions on connected accounts |
| `ENROLLX_STRIPE_WEBHOOK_SECRET` | `stripe_webhook_secret` | `""` | Webhook signing secret (`whsec_…`) |
| `ENROLLX_STRIPE_REDIRECT_URL` | `stripe_redirect_url` | `http://localhost:5910/api/stripe/connect/callback` | OAuth redirect URI registered in the Stripe Connect settings |
| `ENROLLX_FAMILYHUB_PUBLIC_URL` | `familyhub_public_url` | `http://localhost:6000` | Base URL for parent success/cancel URLs and hub links in email |
| `ENROLLX_FRONTEND_PUBLIC_URL` | `frontend_public_url` | `http://localhost:5900` | Base URL for staff success/cancel URLs and the OAuth-callback redirect target |
| `ENROLLX_BALANCE_DUE_DAYS` | `balance_due_days` | `30` | Days until the balance item's `due_at` after a deposit is paid |

**Consumed env vars that Plan 2 already defined** (do not redefine): `ENROLLX_LINK_SECRET` (`settings.link_secret`), `ENROLLX_INTERNAL_KEY` (`settings.internal_key`), `ENROLLX_RESEND_API_KEY`.

## Consumed interfaces (produced by Plans 1–2)

Route names below are binding contracts from `docs/superpowers/plans/2026-08-03-registration-phase1-roadmap.md`. Python symbol names are the expected names of Plan 2's outputs; **Task 0 verifies every one of them against the real code before anything else is written**.

- Plan 1: `require_staff_tenant(tenant_id, user)` in `enrollx/backend/app/tenancy.py`; `require_authenticated_user` in `enrollx/backend/app/auth.py`; generic proxies `POST /api/query`, entity POST/PUT.
- Plan 2 engine: `settle_payment_item(tenant_id, application_id, item_id, *, kind, amount, currency, provider, provider_ref, recorded_by, token) -> dict` (writes the `payment` entity, marks the `application_item` paid/verified, logs `application_activity`, re-derives application status — the same function `record_offline_payment` uses) and `create_application_item(tenant_id, application_id, *, block_id, kind, title, blocking, due_at, token) -> dict` (the item-creation path used when deriving items from a published config).
- Plan 2 DataCore helpers: `dc_query(tenant, sql, token, table="entities") -> list[dict]`, `dc_create(tenant, entity_type, base_data, token) -> dict`, `dc_update(tenant, entity_type, entity_id, base_data, token) -> dict`.
- Plan 2 internal auth: `require_internal_key` FastAPI dependency (asserts header `X-Internal-Key == settings.internal_key`).
- Plan 2 magic links: `verify_link_token(token) -> tuple[str, str]` (returns `(tenant_id, application_id)`, raises `HTTPException` on invalid/revoked) and `make_link_token(tenant_id, application_id, token_version) -> str`.
- Plan 2 email: `send_application_email(tenant_id, application_id, to, subject, html, token) -> None` (sends via Resend, logs `application_activity(type='email_sent')`, no-ops without an API key).

**Data contracts this plan relies on** (Plans 4–5 must honor them; they are additions layered on the roadmap):

- The `payment_plan` block's `config` is `{"currency": "usd", "amount_full": <int cents>, "plans": [{"type": "pay_in_full"} , {"type": "deposit", "deposit_amount": <int cents>}]}`.
- The application's chosen plan is stored in `registration_application.draft_data` (JSON string) under key `"payment_plan_selection"` with value `"pay_in_full"` or `"deposit"`.
- Checkout Session metadata is `{tenant_id, application_id, item_id, kind}` where `kind ∈ {full, deposit, balance}`.
- The balance obligation item is identified by `title == "Balance payment"` (constant `BALANCE_ITEM_TITLE`).

---

### Task 0: Branch setup and Plan 2 interface discovery (hard gate)

**Files:**
- None created (read-only verification), except the branch.

**Interfaces:**
- Consumes: everything in "Consumed interfaces" above.
- Produces: a verified symbol map used by all later tasks.

- [ ] **Step 1: Branch.** Plan 2's code must already be on the branch you start from. Run:

```bash
cd /Users/kennylee/Development/NeoApex
git fetch
git checkout feat/registration-plan2-lifecycle 2>/dev/null || git checkout docs/registration-flow-design 2>/dev/null || git checkout main
git log --oneline -5   # confirm Plan 2 commits (lifecycle engine / action endpoint) are present
git checkout -b feat/registration-plan3-payments
```

If `git log` shows no Plan 2 commits on any of those branches, STOP and report — this plan cannot run before Plan 2.

- [ ] **Step 2: Verify every consumed symbol exists.** Run each command and record the actual module + name:

```bash
cd /Users/kennylee/Development/NeoApex/enrollx
grep -rn "def dc_query\|def dc_create\|def dc_update" backend/app/
grep -rn "def settle_payment_item\|def create_application_item" backend/app/
grep -rn "def require_internal_key" backend/app/
grep -rn "def verify_link_token\|def make_link_token" backend/app/
grep -rn "def send_application_email" backend/app/
grep -rn "link_secret\|internal_key" backend/app/config.py
grep -rn "include_router" backend/app/main.py
```

- [ ] **Step 3: Reconcile names.** For each symbol found under a different name or module, use the ACTUAL name/module consistently in every code block of this plan (a mechanical rename — semantics are fixed by this plan). Exactly two symbols may legitimately be missing, with prescribed remedies:
  - If `settle_payment_item` does not exist: locate the code implementing the `record_offline_payment` action (grep `record_offline_payment` in `backend/app/`), extract its body into `settle_payment_item` with the exact signature above in the same module, and make the action handler call it. Run the FULL enrollx suite (`uv run pytest backend/tests/ -v`) — all green before continuing. Commit separately: `git add enrollx/backend && git commit -m "refactor(enrollx): extract settle_payment_item from record_offline_payment action"`.
  - If `create_application_item` does not exist: locate the item-derivation loop in the application-creation path, extract the single-item creation into `create_application_item` with the exact signature above, same procedure and a separate `refactor(enrollx)` commit.

- [ ] **Step 4: Baseline.** Run `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/ -v` — expected: all PASS before any Plan 3 code is written.

---

### Task 1: Stripe dependency + settings

**Files:**
- Modify: `enrollx/pyproject.toml` (via `uv add`)
- Modify: `enrollx/backend/app/config.py`
- Create: `enrollx/backend/tests/test_payments_config.py`

**Interfaces:**
- Produces: `settings.stripe_client_id`, `settings.stripe_secret_key`, `settings.stripe_webhook_secret`, `settings.stripe_redirect_url`, `settings.familyhub_public_url`, `settings.frontend_public_url`, `settings.balance_due_days` — consumed by every later task.

- [ ] **Step 1: Write failing test**

```python
# enrollx/backend/tests/test_payments_config.py
"""Payment settings defaults."""
from app.config import Settings


def test_payment_settings_defaults(monkeypatch):
    for var in (
        "ENROLLX_STRIPE_CLIENT_ID",
        "ENROLLX_STRIPE_SECRET_KEY",
        "ENROLLX_STRIPE_WEBHOOK_SECRET",
        "ENROLLX_STRIPE_REDIRECT_URL",
        "ENROLLX_FAMILYHUB_PUBLIC_URL",
        "ENROLLX_FRONTEND_PUBLIC_URL",
        "ENROLLX_BALANCE_DUE_DAYS",
    ):
        monkeypatch.delenv(var, raising=False)
    s = Settings()
    assert s.stripe_client_id == ""
    assert s.stripe_secret_key == ""
    assert s.stripe_webhook_secret == ""
    assert s.stripe_redirect_url == "http://localhost:5910/api/stripe/connect/callback"
    assert s.familyhub_public_url == "http://localhost:6000"
    assert s.frontend_public_url == "http://localhost:5900"
    assert s.balance_due_days == 30


def test_payment_settings_env_override(monkeypatch):
    monkeypatch.setenv("ENROLLX_STRIPE_CLIENT_ID", "ca_live_x")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_PUBLIC_URL", "https://familyhub.floatify.com")
    monkeypatch.setenv("ENROLLX_BALANCE_DUE_DAYS", "14")
    s = Settings()
    assert s.stripe_client_id == "ca_live_x"
    assert s.familyhub_public_url == "https://familyhub.floatify.com"
    assert s.balance_due_days == 14


def test_stripe_importable():
    import stripe  # noqa: F401  — dependency added by this plan
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_payments_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'stripe_client_id'` (and/or `ModuleNotFoundError: No module named 'stripe'`).

- [ ] **Step 3: Add the dependency**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv add "stripe>=12"`
Expected: `uv.lock` and `pyproject.toml` updated, exit 0.

- [ ] **Step 4: Add settings fields.** In `enrollx/backend/app/config.py`, inside the `Settings` class, immediately after the existing field declarations (before the `@model_validator`), add:

```python
    # ── Stripe Connect / payments (Plan 3) ─────────────────────────────
    stripe_client_id: str = ""       # ENROLLX_STRIPE_CLIENT_ID (ca_...)
    stripe_secret_key: str = ""      # ENROLLX_STRIPE_SECRET_KEY (sk_...)
    stripe_webhook_secret: str = ""  # ENROLLX_STRIPE_WEBHOOK_SECRET (whsec_...)
    stripe_redirect_url: str = "http://localhost:5910/api/stripe/connect/callback"
    familyhub_public_url: str = "http://localhost:6000"
    frontend_public_url: str = "http://localhost:5900"
    balance_due_days: int = 30
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_payments_config.py -v`
Expected: 3 PASS. Then the full suite: `uv run pytest backend/tests/ -v` — all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/pyproject.toml enrollx/uv.lock enrollx/backend/app/config.py enrollx/backend/tests/test_payments_config.py
git commit -m "chore(enrollx): add stripe dependency and payment settings"
```

---

### Task 2: Signed OAuth state + tenant lookup helpers

**Files:**
- Create: `enrollx/backend/app/stripe_state.py`
- Create: `enrollx/backend/app/tenant_lookup.py`
- Create: `enrollx/backend/tests/test_stripe_state.py`

**Interfaces:**
- Consumes: `settings.link_secret` (Plan 2), `dc_query` (Plan 2, per Task 0 map).
- Produces: `make_state(tenant_id) -> str`, `verify_state(state) -> str | None` (returns tenant_id or None); `get_tenant_entity(tenant_id, token) -> dict | None`, `entity_base_data(row) -> dict` — consumed by Tasks 3–6.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_stripe_state.py
"""Signed Connect OAuth state: roundtrip, tamper, expiry."""
import base64
import time

import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def link_secret(monkeypatch):
    monkeypatch.setattr(settings, "link_secret", "test-link-secret", raising=False)


def test_state_roundtrip():
    from app.stripe_state import make_state, verify_state

    state = make_state("acme")
    assert verify_state(state) == "acme"


def test_state_rejects_tampered_tenant():
    from app.stripe_state import make_state, verify_state

    state = make_state("acme")
    padded = state + "=" * (-len(state) % 4)
    raw = base64.urlsafe_b64decode(padded.encode()).decode()
    tampered_raw = raw.replace("acme", "globex", 1)
    tampered = base64.urlsafe_b64encode(tampered_raw.encode()).decode().rstrip("=")
    assert verify_state(tampered) is None


def test_state_rejects_garbage():
    from app.stripe_state import verify_state

    assert verify_state("not-a-state") is None
    assert verify_state("") is None


def test_state_expires():
    from app.stripe_state import STATE_TTL_SECONDS, _sign, verify_state

    issued = int(time.time()) - STATE_TTL_SECONDS - 1
    raw = f"acme.{issued}.{_sign('acme', issued)}"
    stale = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    assert verify_state(stale) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_stripe_state.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.stripe_state'`.

- [ ] **Step 3: Implement `stripe_state.py`**

```python
# enrollx/backend/app/stripe_state.py
"""Signed OAuth `state` for Stripe Connect onboarding.

The state ties the Stripe redirect back to the tenant that initiated it and
expires, so the unauthenticated callback cannot be forged or replayed later.
Format: base64url("{tenant_id}.{issued_epoch}.{hex hmac-sha256}").
Signed with the same server secret as magic links (ENROLLX_LINK_SECRET).
"""
import base64
import hashlib
import hmac
import time

from app.config import settings

STATE_TTL_SECONDS = 15 * 60


def _sign(tenant_id: str, issued: int) -> str:
    msg = f"{tenant_id}.{issued}".encode()
    return hmac.new(settings.link_secret.encode(), msg, hashlib.sha256).hexdigest()


def make_state(tenant_id: str) -> str:
    issued = int(time.time())
    raw = f"{tenant_id}.{issued}.{_sign(tenant_id, issued)}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def verify_state(state: str) -> str | None:
    """Return the tenant_id if the state is authentic and fresh, else None."""
    try:
        padded = state + "=" * (-len(state) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, issued_s, sig = raw.rsplit(".", 2)
        issued = int(issued_s)
    except Exception:
        return None
    if not hmac.compare_digest(sig, _sign(tenant_id, issued)):
        return None
    if time.time() - issued > STATE_TTL_SECONDS:
        return None
    return tenant_id
```

- [ ] **Step 4: Implement `tenant_lookup.py`** (adjust the `dc_query` import to the Task 0 map):

```python
# enrollx/backend/app/tenant_lookup.py
"""Read/prepare the tenant entity row (holds stripe_account_id)."""
from app.datacore import dc_query

# Flattened-row columns that are NOT base_data (mirrors admindash leads.py).
_SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector"}


def entity_base_data(row: dict) -> dict:
    """Flattened entity row -> base_data dict for a full-replace PUT."""
    return {
        k: v
        for k, v in row.items()
        if k not in _SYSTEM_COLS and not k.startswith("_") and v is not None
    }


def get_tenant_entity(tenant_id: str, token: str | None) -> dict | None:
    safe = tenant_id.replace("'", "''")
    rows = dc_query(
        tenant_id,
        "SELECT * FROM data WHERE entity_type = 'tenant' "
        f"AND entity_id = '{safe}' AND _status = 'active'",
        token,
    )
    return rows[0] if rows else None
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_stripe_state.py -v`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/backend/app/stripe_state.py enrollx/backend/app/tenant_lookup.py enrollx/backend/tests/test_stripe_state.py
git commit -m "feat(enrollx): signed Stripe Connect state and tenant lookup helpers"
```

---

### Task 3: Stripe Connect onboarding routes

**Files:**
- Create: `enrollx/backend/app/api/stripe_connect.py`
- Modify: `enrollx/backend/app/main.py` (mount router)
- Modify: `launchpad/backend/app/data/base_model.json` (add `stripe_account_id` to the `tenant` entity so the generic update is model-valid)
- Create: `enrollx/backend/tests/test_stripe_connect.py`

**Interfaces:**
- Consumes: `require_staff_tenant` (Plan 1), `dc_update` (Plan 2, Task 0 map), `make_state`/`verify_state`, `get_tenant_entity`/`entity_base_data` (Task 2).
- Produces: `GET /api/stripe/{tenant_id}/connect-link` → `200 {"url": "<connect.stripe.com authorize URL>"}` (staff-only); `GET /api/stripe/connect/callback?code&state` → `303` redirect to `{frontend_public_url}/settings/payments?stripe_connected=1` on success or `?stripe_error=<denied|bad_state|exchange_failed|no_tenant>` on failure. Stores `stripe_account_id` in the tenant entity's base_data. Consumed by Task 4 (connected-account lookup) and Task 8 (frontend).

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_stripe_connect.py
"""Stripe Connect onboarding: link generation and OAuth callback."""
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
import stripe
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.config import settings
from app.main import app
from app.stripe_state import make_state


# --- fake stripe fixture (repeated in every stripe-touching test file) ----
@pytest.fixture
def fake_stripe(monkeypatch):
    """Replace every stripe network call with in-memory fakes.

    No test may ever hit Stripe's network. `calls` records kwargs so tests
    can assert on what would have been sent.
    """
    calls = {"session_create": [], "oauth_token": []}

    def fake_session_create(**kwargs):
        calls["session_create"].append(kwargs)
        return SimpleNamespace(
            id="cs_test_abc123",
            url="https://checkout.stripe.com/c/pay/cs_test_abc123",
        )

    def fake_oauth_token(**kwargs):
        calls["oauth_token"].append(kwargs)
        return {"stripe_user_id": "acct_test_789", "livemode": False}

    monkeypatch.setattr(stripe.checkout.Session, "create", fake_session_create)
    monkeypatch.setattr(stripe.OAuth, "token", fake_oauth_token)
    return calls
# --------------------------------------------------------------------------


TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "_status": "active",
}


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}

    return f


@pytest.fixture
def stripe_settings(monkeypatch):
    monkeypatch.setattr(settings, "link_secret", "test-link-secret", raising=False)
    monkeypatch.setattr(settings, "stripe_client_id", "ca_test_123")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")


@pytest.fixture
def as_user(stripe_settings):
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)

    yield _as
    app.dependency_overrides.clear()


def test_connect_link_requires_auth(stripe_settings):
    resp = TestClient(app).get("/api/stripe/acme/connect-link")
    assert resp.status_code == 401


def test_connect_link_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").get("/api/stripe/globex/connect-link")
    assert resp.status_code == 403


def test_connect_link_parent_role_403(as_user):
    resp = as_user(role="parent").get("/api/stripe/acme/connect-link")
    assert resp.status_code == 403


def test_connect_link_contains_client_id_and_state(as_user):
    resp = as_user().get("/api/stripe/acme/connect-link")
    assert resp.status_code == 200
    url = resp.json()["url"]
    parsed = urlparse(url)
    assert parsed.netloc == "connect.stripe.com"
    qs = parse_qs(parsed.query)
    assert qs["client_id"] == ["ca_test_123"]
    assert qs["response_type"] == ["code"]
    assert qs["scope"] == ["read_write"]
    assert qs["redirect_uri"] == [settings.stripe_redirect_url]
    assert qs["state"][0]  # non-empty signed state


def test_connect_link_503_when_unconfigured(as_user, monkeypatch):
    monkeypatch.setattr(settings, "stripe_client_id", "")
    resp = as_user().get("/api/stripe/acme/connect-link")
    assert resp.status_code == 503


def test_callback_success_stores_account_and_redirects(
    stripe_settings, fake_stripe, monkeypatch
):
    updates = []
    monkeypatch.setattr(
        "app.api.stripe_connect.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_connect.dc_update",
        lambda tenant, etype, eid, base, tok: updates.append((tenant, etype, eid, base)) or base,
    )
    client = TestClient(app, follow_redirects=False)
    state = make_state("acme")
    resp = client.get(f"/api/stripe/connect/callback?code=ac_xyz&state={state}")
    assert resp.status_code == 303
    assert resp.headers["location"] == (
        f"{settings.frontend_public_url}/settings/payments?stripe_connected=1"
    )
    assert fake_stripe["oauth_token"][0]["code"] == "ac_xyz"
    assert updates == [("acme", "tenant", "acme", pytest.approx(updates[0][3]))]
    assert updates[0][3]["stripe_account_id"] == "acct_test_789"
    assert updates[0][3]["name"] == "Acme Afterschool"  # existing base_data preserved


def test_callback_bad_state_redirects_with_error(stripe_settings, fake_stripe):
    client = TestClient(app, follow_redirects=False)
    resp = client.get("/api/stripe/connect/callback?code=ac_xyz&state=forged")
    assert resp.status_code == 303
    assert "stripe_error=bad_state" in resp.headers["location"]
    assert fake_stripe["oauth_token"] == []  # never exchanged


def test_callback_user_denied_redirects_with_error(stripe_settings, fake_stripe):
    client = TestClient(app, follow_redirects=False)
    resp = client.get("/api/stripe/connect/callback?error=access_denied")
    assert resp.status_code == 303
    assert "stripe_error=denied" in resp.headers["location"]


def test_callback_exchange_failure_redirects_with_error(stripe_settings, monkeypatch):
    def boom(**kwargs):
        raise stripe.StripeError("nope")

    monkeypatch.setattr(stripe.OAuth, "token", boom)
    client = TestClient(app, follow_redirects=False)
    state = make_state("acme")
    resp = client.get(f"/api/stripe/connect/callback?code=ac_xyz&state={state}")
    assert resp.status_code == 303
    assert "stripe_error=exchange_failed" in resp.headers["location"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_stripe_connect.py -v`
Expected: FAIL — 404s on `/api/stripe/...` (router not mounted) / `ModuleNotFoundError: app.api.stripe_connect`.

- [ ] **Step 3: Implement `api/stripe_connect.py`** (adjust `dc_update` import to the Task 0 map):

```python
# enrollx/backend/app/api/stripe_connect.py
"""Stripe Connect (Standard) onboarding.

Staff request a connect link; Stripe redirects the browser back to the
unauthenticated callback, which verifies the signed state, exchanges the
code, and stores stripe_account_id on the tenant entity in DataCore.
"""
from urllib.parse import urlencode

import stripe
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.config import settings
from app.datacore import dc_update
from app.stripe_state import make_state, verify_state
from app.tenancy import require_staff_tenant
from app.tenant_lookup import entity_base_data, get_tenant_entity

router = APIRouter()


@router.get("/stripe/{tenant_id}/connect-link")
def connect_link(tenant_id: str, user=Depends(require_staff_tenant)):
    if not settings.stripe_client_id:
        raise HTTPException(
            503, "Stripe Connect is not configured (ENROLLX_STRIPE_CLIENT_ID)"
        )
    params = urlencode(
        {
            "response_type": "code",
            "client_id": settings.stripe_client_id,
            "scope": "read_write",
            "redirect_uri": settings.stripe_redirect_url,
            "state": make_state(tenant_id),
        }
    )
    return {"url": f"https://connect.stripe.com/oauth/authorize?{params}"}


@router.get("/stripe/connect/callback")
def connect_callback(
    code: str | None = None, state: str | None = None, error: str | None = None
):
    settings_page = f"{settings.frontend_public_url}/settings/payments"
    if error or not code or not state:
        return RedirectResponse(f"{settings_page}?stripe_error=denied", status_code=303)

    tenant_id = verify_state(state)
    if tenant_id is None:
        return RedirectResponse(f"{settings_page}?stripe_error=bad_state", status_code=303)

    try:
        resp = stripe.OAuth.token(
            grant_type="authorization_code",
            code=code,
            api_key=settings.stripe_secret_key,
        )
    except stripe.StripeError:
        return RedirectResponse(
            f"{settings_page}?stripe_error=exchange_failed", status_code=303
        )

    account_id = str(resp["stripe_user_id"])
    row = get_tenant_entity(tenant_id, None)
    if row is None:
        return RedirectResponse(f"{settings_page}?stripe_error=no_tenant", status_code=303)

    base = entity_base_data(row)
    base["stripe_account_id"] = account_id
    dc_update(tenant_id, "tenant", tenant_id, base, None)
    return RedirectResponse(f"{settings_page}?stripe_connected=1", status_code=303)
```

- [ ] **Step 4: Mount the router.** In `enrollx/backend/app/main.py`, add to the imports `stripe_connect` (alongside the existing `from app.api import ...` names) and after the existing `include_router` lines add:

```python
app.include_router(stripe_connect.router, prefix="/api", tags=["stripe"])
```

- [ ] **Step 5: Model field.** In `launchpad/backend/app/data/base_model.json`, find the `tenant` entity definition and append to its base fields (matching the file's exact field-object convention, same as Plan 1 Task 8 did): `{"name": "stripe_account_id", "type": "str", "required": false}`. Validate: `python3 -c "import json; d=json.load(open('/Users/kennylee/Development/NeoApex/launchpad/backend/app/data/base_model.json')); print([f['name'] for f in d['tenant']['base_fields']])"` — expect `stripe_account_id` in the list (adjust the key path to the file's actual structure if `base_fields` is nested differently — inspect the file first).

- [ ] **Step 6: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_stripe_connect.py -v`
Expected: 9 PASS. Then the full suite: `uv run pytest backend/tests/ -v` — all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/backend launchpad/backend/app/data/base_model.json
git commit -m "feat(enrollx): Stripe Connect onboarding routes storing stripe_account_id on tenant"
```

---

### Task 4: Checkout service (plan-derived amounts, connected-account sessions)

**Files:**
- Create: `enrollx/backend/app/checkout_service.py`
- Create: `enrollx/backend/tests/test_checkout_service.py`

**Interfaces:**
- Consumes: `dc_query` (Plan 2, Task 0 map), `get_tenant_entity` (Task 2), `settings.stripe_secret_key`.
- Produces: `create_checkout_session(tenant_id, application_id, item_id, success_url, cancel_url, token) -> dict` (`{"checkout_url", "session_id", "kind", "amount", "currency"}`), plus helpers `get_application`, `get_payment_plan_block`, consumed by Tasks 5–7. Amount/kind derivation rules are in the module docstring and are binding for Plans 4–5.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_checkout_service.py
"""Checkout session creation: plan-derived amounts on the connected account."""
import json
from types import SimpleNamespace

import pytest
import stripe
from fastapi import HTTPException

from app.config import settings


# --- fake stripe fixture (repeated in every stripe-touching test file) ----
@pytest.fixture
def fake_stripe(monkeypatch):
    """Replace every stripe network call with in-memory fakes.

    No test may ever hit Stripe's network. `calls` records kwargs so tests
    can assert on what would have been sent.
    """
    calls = {"session_create": [], "oauth_token": []}

    def fake_session_create(**kwargs):
        calls["session_create"].append(kwargs)
        return SimpleNamespace(
            id="cs_test_abc123",
            url="https://checkout.stripe.com/c/pay/cs_test_abc123",
        )

    def fake_oauth_token(**kwargs):
        calls["oauth_token"].append(kwargs)
        return {"stripe_user_id": "acct_test_789", "livemode": False}

    monkeypatch.setattr(stripe.checkout.Session, "create", fake_session_create)
    monkeypatch.setattr(stripe.OAuth, "token", fake_oauth_token)
    return calls
# --------------------------------------------------------------------------


BLOCKS = json.dumps(
    [
        {
            "block_id": "b-plan",
            "type": "payment_plan",
            "title": "Payment plan",
            "required": True,
            "blocking": True,
            "config": {
                "currency": "usd",
                "amount_full": 50000,
                "plans": [
                    {"type": "pay_in_full"},
                    {"type": "deposit", "deposit_amount": 10000},
                ],
            },
        },
        {
            "block_id": "b-pay",
            "type": "payment",
            "title": "Payment",
            "required": True,
            "blocking": True,
            "config": {"collects": "derived"},
        },
    ]
)


def application_row(selection="pay_in_full", status="submitted"):
    return {
        "entity_id": "RA260001",
        "entity_type": "registration_application",
        "program_id": "PR26001",
        "config_version": 3,
        "status": status,
        "applicant_email": "parent@example.com",
        "token_version": 1,
        "draft_data": json.dumps({"payment_plan_selection": selection}),
        "_status": "active",
    }


CONFIG_ROW = {"entity_id": "RC26001", "program_id": "PR26001", "version": 3, "blocks": BLOCKS}
ITEM_ROW = {
    "entity_id": "AI260007",
    "application_id": "RA260001",
    "kind": "payment",
    "block_id": "b-pay",
    "title": "Payment",
    "status": "not_started",
    "blocking": True,
}
TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "stripe_account_id": "acct_test_789",
}


def make_fake_dc_query(rows_by_marker):
    """Dispatch canned rows by a substring of the SQL text."""

    def fake(tenant, sql, token, table="entities"):
        for marker, rows in rows_by_marker.items():
            if marker in sql:
                return [dict(r) for r in rows]
        return []

    return fake


@pytest.fixture
def wire(monkeypatch):
    """Wire canned DataCore rows + connected tenant + stripe key."""
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")

    def _wire(application, deposit_paid=False, tenant=TENANT_ROW, item=ITEM_ROW):
        rows = {
            "entity_type = 'registration_application'": [application],
            "entity_type = 'registration_config'": [CONFIG_ROW],
            "entity_type = 'application_item'": [item] if item else [],
            "entity_type = 'payment'": (
                [{"entity_id": "PY260001", "kind": "deposit", "status": "paid"}]
                if deposit_paid
                else []
            ),
        }
        monkeypatch.setattr("app.checkout_service.dc_query", make_fake_dc_query(rows))
        monkeypatch.setattr(
            "app.checkout_service.get_tenant_entity",
            lambda t, tok: dict(tenant) if tenant else None,
        )

    return _wire


def create(item_id=None):
    from app.checkout_service import create_checkout_session

    return create_checkout_session(
        "acme",
        "RA260001",
        item_id,
        success_url="https://x/success",
        cancel_url="https://x/cancel",
        token=None,
    )


def test_pay_in_full_charges_amount_full(wire, fake_stripe):
    wire(application_row("pay_in_full"))
    out = create()
    assert out == {
        "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_abc123",
        "session_id": "cs_test_abc123",
        "kind": "full",
        "amount": 50000,
        "currency": "usd",
    }
    sent = fake_stripe["session_create"][0]
    assert sent["stripe_account"] == "acct_test_789"
    assert sent["api_key"] == "sk_test_123"
    assert sent["mode"] == "payment"
    assert sent["line_items"][0]["price_data"]["unit_amount"] == 50000
    assert sent["metadata"] == {
        "tenant_id": "acme",
        "application_id": "RA260001",
        "item_id": "AI260007",
        "kind": "full",
    }
    assert sent["success_url"] == "https://x/success"
    assert sent["cancel_url"] == "https://x/cancel"


def test_deposit_plan_first_payment_is_deposit(wire, fake_stripe):
    wire(application_row("deposit"))
    out = create()
    assert out["kind"] == "deposit"
    assert out["amount"] == 10000


def test_deposit_plan_second_payment_is_balance(wire, fake_stripe):
    wire(application_row("deposit"), deposit_paid=True)
    out = create()
    assert out["kind"] == "balance"
    assert out["amount"] == 40000


def test_tenant_not_connected_409(wire, fake_stripe):
    wire(application_row(), tenant={"entity_id": "acme", "name": "Acme"})
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409
    assert fake_stripe["session_create"] == []


def test_no_open_payment_item_409(wire, fake_stripe):
    wire(application_row(), item=None)
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409


def test_declined_application_409(wire, fake_stripe):
    wire(application_row(status="declined"))
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409


def test_unknown_application_404(wire, fake_stripe, monkeypatch):
    wire(application_row())
    monkeypatch.setattr(
        "app.checkout_service.dc_query", make_fake_dc_query({})
    )
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 404


def test_unconfigured_stripe_503(wire, fake_stripe, monkeypatch):
    wire(application_row())
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 503
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_checkout_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.checkout_service'`.

- [ ] **Step 3: Implement `checkout_service.py`** (adjust the `dc_query` import to the Task 0 map):

```python
# enrollx/backend/app/checkout_service.py
"""Creates Stripe Checkout Sessions on the tenant's connected account.

Amount derivation (binding contract for Plans 4-5):
- the chosen plan lives in registration_application.draft_data (JSON string)
  under "payment_plan_selection": "pay_in_full" | "deposit"
- the payment_plan block config carries integer-cent amounts:
  {"currency": "usd", "amount_full": 50000,
   "plans": [{"type": "pay_in_full"}, {"type": "deposit", "deposit_amount": 10000}]}
- pay_in_full                              -> charge amount_full        (kind "full")
- deposit chosen, no paid deposit yet      -> charge deposit_amount     (kind "deposit")
- deposit chosen, deposit already paid     -> charge the remainder      (kind "balance")
"""
import json
from dataclasses import dataclass

import stripe
from fastapi import HTTPException

from app.config import settings
from app.datacore import dc_query
from app.tenant_lookup import get_tenant_entity


@dataclass
class CheckoutContext:
    application: dict
    item: dict
    kind: str      # full | deposit | balance
    amount: int    # integer cents
    currency: str  # lowercase ISO code


def _q(value: str) -> str:
    """Double single quotes for safe SQL string literals."""
    return value.replace("'", "''")


def get_application(tenant_id: str, application_id: str, token: str | None) -> dict | None:
    rows = dc_query(
        tenant_id,
        "SELECT * FROM data WHERE entity_type = 'registration_application' "
        f"AND entity_id = '{_q(application_id)}' AND _status = 'active'",
        token,
    )
    return rows[0] if rows else None


def get_payment_plan_block(tenant_id: str, application: dict, token: str | None) -> dict:
    program_id = str(application.get("program_id") or "")
    version = int(application.get("config_version") or 0)
    rows = dc_query(
        tenant_id,
        "SELECT * FROM data WHERE entity_type = 'registration_config' "
        f"AND program_id = '{_q(program_id)}' AND version = {version}",
        token,
    )
    if not rows:
        raise HTTPException(409, "No registration config found for this application")
    blocks = rows[0].get("blocks")
    if isinstance(blocks, str):
        try:
            blocks = json.loads(blocks)
        except ValueError:
            blocks = []
    for block in blocks or []:
        if block.get("type") == "payment_plan":
            return block
    raise HTTPException(409, "This registration flow has no payment_plan block")


def _plan_selection(application: dict, plans: dict) -> str:
    draft = application.get("draft_data")
    if isinstance(draft, str) and draft:
        try:
            draft = json.loads(draft)
        except ValueError:
            draft = {}
    if not isinstance(draft, dict):
        draft = {}
    selection = draft.get("payment_plan_selection")
    if not selection and len(plans) == 1:
        selection = next(iter(plans))
    if selection not in plans:
        raise HTTPException(409, "No valid payment plan selected on this application")
    return str(selection)


def _open_payment_item(
    tenant_id: str, application_id: str, item_id: str | None, token: str | None
) -> dict:
    where = (
        "entity_type = 'application_item' "
        f"AND application_id = '{_q(application_id)}' "
        "AND kind = 'payment' AND _status = 'active'"
    )
    if item_id:
        where += f" AND entity_id = '{_q(item_id)}'"
    rows = dc_query(tenant_id, f"SELECT * FROM data WHERE {where}", token)
    open_items = [r for r in rows if r.get("status") not in ("verified", "waived")]
    if not open_items:
        raise HTTPException(409, "No open payment item on this application")
    return open_items[0]


def _deposit_already_paid(tenant_id: str, application_id: str, token: str | None) -> bool:
    rows = dc_query(
        tenant_id,
        "SELECT entity_id FROM data WHERE entity_type = 'payment' "
        f"AND application_id = '{_q(application_id)}' "
        "AND kind = 'deposit' AND status = 'paid' AND _status = 'active'",
        token,
    )
    return bool(rows)


def build_checkout_context(
    tenant_id: str, application_id: str, item_id: str | None, token: str | None
) -> CheckoutContext:
    application = get_application(tenant_id, application_id, token)
    if application is None:
        raise HTTPException(404, "Application not found")
    if application.get("status") in ("declined", "withdrawn"):
        raise HTTPException(
            409, f"Cannot take payment on a {application['status']} application"
        )

    block = get_payment_plan_block(tenant_id, application, token)
    cfg = block.get("config") or {}
    currency = str(cfg.get("currency") or "usd").lower()
    amount_full = int(cfg.get("amount_full") or 0)
    if amount_full <= 0:
        raise HTTPException(409, "payment_plan block has no amount_full configured")
    plans = {str(p.get("type")): p for p in (cfg.get("plans") or []) if p.get("type")}
    selection = _plan_selection(application, plans)
    item = _open_payment_item(tenant_id, application_id, item_id, token)

    if selection == "deposit":
        deposit_amount = int(plans["deposit"].get("deposit_amount") or 0)
        if deposit_amount <= 0 or deposit_amount >= amount_full:
            raise HTTPException(409, "deposit plan has an invalid deposit_amount")
        if _deposit_already_paid(tenant_id, application_id, token):
            kind, amount = "balance", amount_full - deposit_amount
        else:
            kind, amount = "deposit", deposit_amount
    else:
        kind, amount = "full", amount_full

    return CheckoutContext(application, item, kind, amount, currency)


def create_checkout_session(
    tenant_id: str,
    application_id: str,
    item_id: str | None,
    success_url: str,
    cancel_url: str,
    token: str | None,
) -> dict:
    if not settings.stripe_secret_key:
        raise HTTPException(503, "Stripe is not configured (ENROLLX_STRIPE_SECRET_KEY)")

    tenant_row = get_tenant_entity(tenant_id, token)
    account_id = (tenant_row or {}).get("stripe_account_id")
    if not account_id:
        raise HTTPException(409, "Tenant has not connected a Stripe account")

    ctx = build_checkout_context(tenant_id, application_id, item_id, token)
    label = {"full": "Program fee", "deposit": "Deposit", "balance": "Balance"}[ctx.kind]
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": ctx.currency,
                    "unit_amount": ctx.amount,
                    "product_data": {"name": f"{label} — application {application_id}"},
                },
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "tenant_id": tenant_id,
            "application_id": application_id,
            "item_id": str(ctx.item["entity_id"]),
            "kind": ctx.kind,
        },
        api_key=settings.stripe_secret_key,
        stripe_account=str(account_id),
    )
    return {
        "checkout_url": session.url,
        "session_id": session.id,
        "kind": ctx.kind,
        "amount": ctx.amount,
        "currency": ctx.currency,
    }
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_checkout_service.py -v`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/backend/app/checkout_service.py enrollx/backend/tests/test_checkout_service.py
git commit -m "feat(enrollx): checkout session service with plan-derived amounts on connected accounts"
```

---

### Task 5: Checkout routes — staff (JWT) and parent (internal, token-scoped)

**Files:**
- Create: `enrollx/backend/app/api/checkout.py`
- Modify: `enrollx/backend/app/main.py` (mount both routers)
- Create: `enrollx/backend/tests/test_checkout_routes.py`

**Interfaces:**
- Consumes: `create_checkout_session` (Task 4), `require_staff_tenant` (Plan 1), `require_internal_key` + `verify_link_token` (Plan 2, Task 0 map), `settings.frontend_public_url` / `settings.familyhub_public_url`.
- Produces (roadmap contracts): `POST /api/registration/{tenant_id}/applications/{application_id}/checkout` body `{"item_id"?: str}` → `200 {"checkout_url", "session_id", "kind", "amount", "currency"}` (staff success/cancel URLs point at the enrollx frontend application page). `POST /internal/application-by-token/{token}/checkout` body `{"item_id"?: str}`, header `X-Internal-Key` → same response (parent success/cancel URLs point at the familyhub hub page for that token). Plan 5's familyhub facade consumes the internal route.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_checkout_routes.py
"""Checkout route guards and success/cancel URL construction."""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.config import settings
from app.main import app


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}

    return f


@pytest.fixture
def captured(monkeypatch):
    """Capture create_checkout_session calls at the route module's namespace."""
    calls = []

    def fake_create(tenant_id, application_id, item_id, success_url, cancel_url, token):
        calls.append(
            {
                "tenant_id": tenant_id,
                "application_id": application_id,
                "item_id": item_id,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "token": token,
            }
        )
        return {
            "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_abc123",
            "session_id": "cs_test_abc123",
            "kind": "full",
            "amount": 50000,
            "currency": "usd",
        }

    monkeypatch.setattr("app.api.checkout.create_checkout_session", fake_create)
    return calls


@pytest.fixture
def as_user():
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)

    yield _as
    app.dependency_overrides.clear()


def test_staff_checkout_requires_auth(captured):
    resp = TestClient(app).post(
        "/api/registration/acme/applications/RA260001/checkout", json={}
    )
    assert resp.status_code == 401


def test_staff_checkout_cross_tenant_403(captured, as_user):
    resp = as_user(tenant="acme").post(
        "/api/registration/globex/applications/RA260001/checkout", json={}
    )
    assert resp.status_code == 403
    assert captured == []


def test_staff_checkout_parent_role_403(captured, as_user):
    resp = as_user(role="parent").post(
        "/api/registration/acme/applications/RA260001/checkout", json={}
    )
    assert resp.status_code == 403


def test_staff_checkout_urls_point_at_enrollx_frontend(captured, as_user):
    resp = as_user().post(
        "/api/registration/acme/applications/RA260001/checkout",
        json={"item_id": "AI260007"},
    )
    assert resp.status_code == 200
    assert resp.json()["session_id"] == "cs_test_abc123"
    call = captured[0]
    base = f"{settings.frontend_public_url}/applications/RA260001"
    assert call["success_url"] == f"{base}?payment=success"
    assert call["cancel_url"] == f"{base}?payment=cancelled"
    assert call["item_id"] == "AI260007"
    assert call["token"] == "Bearer x"


def test_internal_checkout_requires_internal_key(captured, monkeypatch):
    monkeypatch.setattr(settings, "internal_key", "test-internal-key", raising=False)
    resp = TestClient(app).post(
        "/internal/application-by-token/tok123/checkout", json={}
    )
    assert resp.status_code in (401, 403)
    assert captured == []


def test_internal_checkout_urls_point_at_familyhub(captured, monkeypatch):
    monkeypatch.setattr(settings, "internal_key", "test-internal-key", raising=False)
    monkeypatch.setattr(
        "app.api.checkout.verify_link_token", lambda tok: ("acme", "RA260001")
    )
    resp = TestClient(app).post(
        "/internal/application-by-token/tok123/checkout",
        json={},
        headers={"X-Internal-Key": "test-internal-key"},
    )
    assert resp.status_code == 200
    call = captured[0]
    assert call["tenant_id"] == "acme"
    assert call["application_id"] == "RA260001"
    base = f"{settings.familyhub_public_url}/application/tok123"
    assert call["success_url"] == f"{base}?payment=success"
    assert call["cancel_url"] == f"{base}?payment=cancelled"
    assert call["token"] is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_checkout_routes.py -v`
Expected: FAIL — 404s (routes not mounted).

- [ ] **Step 3: Implement `api/checkout.py`** (adjust `require_internal_key` / `verify_link_token` imports to the Task 0 map):

```python
# enrollx/backend/app/api/checkout.py
"""Checkout session routes.

Staff channel: JWT + tenant + role via require_staff_tenant.
Parent channel: internal route for the familyhub facade — X-Internal-Key
over the private network plus the magic-link token (roadmap contract).
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.checkout_service import create_checkout_session
from app.config import settings
from app.internal_auth import require_internal_key
from app.links import verify_link_token
from app.tenancy import require_staff_tenant

router = APIRouter()
internal_router = APIRouter()


class CheckoutRequest(BaseModel):
    item_id: str | None = None


@router.post("/registration/{tenant_id}/applications/{application_id}/checkout")
def staff_checkout(
    tenant_id: str,
    application_id: str,
    body: CheckoutRequest,
    user=Depends(require_staff_tenant),
):
    base = f"{settings.frontend_public_url}/applications/{application_id}"
    return create_checkout_session(
        tenant_id,
        application_id,
        body.item_id,
        success_url=f"{base}?payment=success",
        cancel_url=f"{base}?payment=cancelled",
        token=user["_token"],
    )


@internal_router.post("/application-by-token/{token}/checkout")
def parent_checkout(
    token: str, body: CheckoutRequest, _key=Depends(require_internal_key)
):
    tenant_id, application_id = verify_link_token(token)
    base = f"{settings.familyhub_public_url}/application/{token}"
    return create_checkout_session(
        tenant_id,
        application_id,
        body.item_id,
        success_url=f"{base}?payment=success",
        cancel_url=f"{base}?payment=cancelled",
        token=None,
    )
```

- [ ] **Step 4: Mount.** In `enrollx/backend/app/main.py` add `checkout` to the api imports and, after the existing `include_router` lines (Plan 2 already mounts its own `/internal` router — keep it; multiple routers may share the prefix):

```python
app.include_router(checkout.router, prefix="/api", tags=["checkout"])
app.include_router(checkout.internal_router, prefix="/internal", tags=["internal"])
```

- [ ] **Step 5: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_checkout_routes.py -v`
Expected: 6 PASS. Then the full suite: `uv run pytest backend/tests/ -v` — all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/backend
git commit -m "feat(enrollx): staff and internal parent checkout routes"
```

---

### Task 6: Stripe webhook — signature, tenant mapping, idempotency, settlement, receipt

**Files:**
- Create: `enrollx/backend/app/payment_emails.py`
- Create: `enrollx/backend/app/api/stripe_webhook.py`
- Modify: `enrollx/backend/app/main.py` (mount router)
- Create: `enrollx/backend/tests/test_stripe_webhook.py`

**Interfaces:**
- Consumes: `settle_payment_item`, `send_application_email`, `dc_query` (Plan 2, Task 0 map), `get_tenant_entity` (Task 2), `get_application` (Task 4), `settings.stripe_webhook_secret`.
- Produces: `POST /api/webhooks/stripe` (unauthenticated; Stripe-signature verified) → `200 {"received": true, ...}`; `payment_receipt_html(tenant_name, kind, amount_cents, currency, application_id) -> str`; `balance_reminder_html(tenant_name, balance_cents, currency, due_date, hub_url) -> str` (used in Task 7).

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_stripe_webhook.py
"""Webhook: signature check, tenant/account mapping, idempotency, settlement."""
import json

import pytest
import stripe
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "stripe_account_id": "acct_test_789",
}

APPLICATION_ROW = {
    "entity_id": "RA260001",
    "program_id": "PR26001",
    "config_version": 3,
    "status": "submitted",
    "applicant_email": "parent@example.com",
    "token_version": 1,
}


def completed_event(kind="full", account="acct_test_789", session_id="cs_test_abc123"):
    return {
        "id": "evt_test_1",
        "type": "checkout.session.completed",
        "account": account,
        "data": {
            "object": {
                "id": session_id,
                "amount_total": 50000,
                "currency": "usd",
                "payment_status": "paid",
                "metadata": {
                    "tenant_id": "acme",
                    "application_id": "RA260001",
                    "item_id": "AI260007",
                    "kind": kind,
                },
            }
        },
    }


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def webhook_env(monkeypatch):
    """Stub every collaborator; return the recorders."""
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    rec = {"settled": [], "emails": [], "balance_items": [], "dedupe_rows": []}

    monkeypatch.setattr(
        "app.api.stripe_webhook.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_application", lambda t, a, tok: dict(APPLICATION_ROW)
    )

    def fake_dc_query(tenant, sql, token, table="entities"):
        if "provider_ref" in sql:
            return list(rec["dedupe_rows"])
        if "Balance payment" in sql:
            return list(rec["balance_items"])
        return []

    monkeypatch.setattr("app.api.stripe_webhook.dc_query", fake_dc_query)

    def fake_settle(tenant_id, application_id, item_id, **kwargs):
        rec["settled"].append({"tenant_id": tenant_id, "application_id": application_id,
                               "item_id": item_id, **kwargs})
        return {"entity_id": "PY260001", "status": "paid"}

    monkeypatch.setattr("app.api.stripe_webhook.settle_payment_item", fake_settle)
    monkeypatch.setattr(
        "app.api.stripe_webhook.send_application_email",
        lambda tenant_id, application_id, to, subject, html, token: rec["emails"].append(
            {"to": to, "subject": subject, "html": html}
        ),
    )
    # Task 7 collaborators — stubbed as no-ops until Task 7 wires them.
    monkeypatch.setattr(
        "app.api.stripe_webhook.create_application_item",
        lambda *a, **k: rec.setdefault("created_items", []).append(k) or {"entity_id": "AI260099"},
        raising=False,
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.make_link_token", lambda t, a, v: "tok_parent", raising=False
    )
    return rec


def stub_event(monkeypatch, event):
    monkeypatch.setattr(
        stripe.Webhook, "construct_event", lambda payload, sig, secret: event
    )


def post(client, body=None):
    return client.post(
        "/api/webhooks/stripe",
        content=json.dumps(body or {}),
        headers={"stripe-signature": "t=1,v1=sig", "content-type": "application/json"},
    )


def test_bad_signature_400(client, webhook_env, monkeypatch):
    def raise_bad(payload, sig, secret):
        raise stripe.SignatureVerificationError("bad sig", "t=1,v1=sig")

    monkeypatch.setattr(stripe.Webhook, "construct_event", raise_bad)
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []


def test_unconfigured_secret_503(client, webhook_env, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "")
    resp = post(client)
    assert resp.status_code == 503


def test_other_event_types_ignored(client, webhook_env, monkeypatch):
    stub_event(monkeypatch, {"type": "payment_intent.succeeded", "data": {"object": {}}})
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert webhook_env["settled"] == []


def test_account_mismatch_400_and_no_writes(client, webhook_env, monkeypatch):
    stub_event(monkeypatch, completed_event(account="acct_attacker"))
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []


def test_duplicate_event_noops(client, webhook_env, monkeypatch):
    webhook_env["dedupe_rows"].append({"entity_id": "PY260001"})
    stub_event(monkeypatch, completed_event())
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["duplicate"] is True
    assert webhook_env["settled"] == []
    assert webhook_env["emails"] == []


def test_completed_session_settles_and_sends_receipt(client, webhook_env, monkeypatch):
    stub_event(monkeypatch, completed_event(kind="full"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is True
    settled = webhook_env["settled"][0]
    assert settled["tenant_id"] == "acme"
    assert settled["application_id"] == "RA260001"
    assert settled["item_id"] == "AI260007"
    assert settled["kind"] == "full"
    assert settled["amount"] == 50000
    assert settled["currency"] == "usd"
    assert settled["provider"] == "stripe"
    assert settled["provider_ref"] == "cs_test_abc123"
    assert settled["recorded_by"] == "stripe:webhook"
    receipt = webhook_env["emails"][0]
    assert receipt["to"] == "parent@example.com"
    assert "50" in receipt["html"] or "500.00" in receipt["html"]


def test_missing_metadata_400(client, webhook_env, monkeypatch):
    event = completed_event()
    event["data"]["object"]["metadata"] = {}
    stub_event(monkeypatch, event)
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_stripe_webhook.py -v`
Expected: FAIL — 404 (route not mounted) / `ModuleNotFoundError: app.api.stripe_webhook`.

- [ ] **Step 3: Implement `payment_emails.py`**

```python
# enrollx/backend/app/payment_emails.py
"""Payment email templates. Emails are English-only in v1 (spec §3: platform
sender with the tenant's display name; per-tenant branding is Phase 2)."""


def _fmt(amount_cents: int, currency: str) -> str:
    return f"{amount_cents / 100:,.2f} {currency.upper()}"


def payment_receipt_html(
    tenant_name: str, kind: str, amount_cents: int, currency: str, application_id: str
) -> str:
    label = {
        "full": "payment in full",
        "deposit": "deposit",
        "balance": "balance payment",
    }.get(kind, "payment")
    return (
        f"<p>Thank you — we received your {label} of "
        f"<strong>{_fmt(amount_cents, currency)}</strong> for application "
        f"{application_id} at {tenant_name}.</p>"
        "<p>You can check your application status any time from your "
        "registration link.</p>"
    )


def balance_reminder_html(
    tenant_name: str, balance_cents: int, currency: str, due_date: str, hub_url: str
) -> str:
    return (
        f"<p>Your deposit for {tenant_name} is confirmed. The remaining balance of "
        f"<strong>{_fmt(balance_cents, currency)}</strong> is due by "
        f"<strong>{due_date}</strong>.</p>"
        f'<p><a href="{hub_url}">Pay the balance or view your application</a>.</p>'
    )
```

- [ ] **Step 4: Implement `api/stripe_webhook.py`** (adjust the Plan 2 imports — `dc_query`, `settle_payment_item`, `create_application_item`, `make_link_token`, `send_application_email` — to the Task 0 map). `create_application_item`, `make_link_token`, and `_ensure_balance_obligation` are imported/defined now but only wired in Task 7's step; this task ships the file WITHOUT the deposit branch (the `# Task 7 inserts the deposit branch here` marker line below is replaced in Task 7):

```python
# enrollx/backend/app/api/stripe_webhook.py
"""Stripe webhook: checkout.session.completed -> settle the payment item.

Trust chain: the Stripe signature authenticates the payload; the metadata
names the tenant; the tenant's stored stripe_account_id must equal the
event's connected-account id before ANY write. Idempotency: a payment
entity with provider_ref == the session id means this session was already
processed — no-op on replay.
"""
import logging

import stripe
from fastapi import APIRouter, HTTPException, Request

from app.checkout_service import get_application, get_payment_plan_block
from app.config import settings
from app.datacore import dc_query
from app.emails import send_application_email
from app.engine import create_application_item, settle_payment_item
from app.links import make_link_token
from app.payment_emails import balance_reminder_html, payment_receipt_html
from app.tenant_lookup import get_tenant_entity

logger = logging.getLogger("enrollx.stripe_webhook")

router = APIRouter()

BALANCE_ITEM_TITLE = "Balance payment"


def _q(value: str) -> str:
    return value.replace("'", "''")


def _already_processed(tenant_id: str, session_id: str) -> bool:
    rows = dc_query(
        tenant_id,
        "SELECT entity_id FROM data WHERE entity_type = 'payment' "
        f"AND provider_ref = '{_q(session_id)}' AND _status = 'active'",
        None,
    )
    return bool(rows)


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Stripe webhook secret is not configured")

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Invalid Stripe webhook signature")

    if event["type"] != "checkout.session.completed":
        return {"received": True, "handled": False}

    session = event["data"]["object"]
    meta = session.get("metadata") or {}
    tenant_id = meta.get("tenant_id")
    application_id = meta.get("application_id")
    item_id = meta.get("item_id")
    kind = meta.get("kind") or "full"
    if not tenant_id or not application_id or not item_id:
        raise HTTPException(400, "Session metadata missing tenant/application/item")

    # Connected account must map to exactly this tenant before any write.
    tenant_row = get_tenant_entity(tenant_id, None)
    if tenant_row is None or tenant_row.get("stripe_account_id") != event.get("account"):
        raise HTTPException(400, "Connected account does not match tenant")

    session_id = str(session["id"])
    if _already_processed(tenant_id, session_id):
        return {"received": True, "duplicate": True}

    amount = int(session.get("amount_total") or 0)
    currency = str(session.get("currency") or "usd").lower()
    payment = settle_payment_item(
        tenant_id,
        application_id,
        item_id,
        kind=kind,
        amount=amount,
        currency=currency,
        provider="stripe",
        provider_ref=session_id,
        recorded_by="stripe:webhook",
        token=None,
    )

    tenant_name = str(tenant_row.get("name") or tenant_id)
    application = get_application(tenant_id, application_id, None)
    email = (application or {}).get("applicant_email")
    if email:
        try:
            send_application_email(
                tenant_id,
                application_id,
                email,
                f"Payment received — {tenant_name}",
                payment_receipt_html(tenant_name, kind, amount, currency, application_id),
                None,
            )
        except Exception:
            logger.exception("payment receipt email failed (application %s)", application_id)

    # Task 7 inserts the deposit branch here

    return {
        "received": True,
        "handled": True,
        "payment_id": payment.get("entity_id"),
    }
```

- [ ] **Step 5: Mount.** In `enrollx/backend/app/main.py` add `stripe_webhook` to the api imports and:

```python
app.include_router(stripe_webhook.router, prefix="/api", tags=["webhooks"])
```

- [ ] **Step 6: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_stripe_webhook.py -v`
Expected: 8 PASS. Then the full suite: `uv run pytest backend/tests/ -v` — all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/backend
git commit -m "feat(enrollx): idempotent Stripe webhook settling payment items with receipt email"
```

---

### Task 7: Deposit → balance obligation + reminder email

**Files:**
- Modify: `enrollx/backend/app/api/stripe_webhook.py`
- Create: `enrollx/backend/tests/test_balance_obligation.py`

**Interfaces:**
- Consumes: `create_application_item`, `make_link_token` (Plan 2, Task 0 map), `get_payment_plan_block` (Task 4), `balance_reminder_html` (Task 6), `settings.balance_due_days`, `settings.familyhub_public_url`.
- Produces: when a `kind == "deposit"` payment settles, exactly one non-blocking `application_item` titled `Balance payment` (kind `payment`, `blocking=False`, `due_at = now + balance_due_days`) is created and a balance-reminder email is sent with the parent hub link. No pending `payment` entity is written — money entities record settlements only; the outstanding balance is represented by the unpaid item, exactly like the primary payment item before it is paid.

- [ ] **Step 1: Write failing tests**

```python
# enrollx/backend/tests/test_balance_obligation.py
"""Deposit settlement creates the balance item + reminder exactly once."""
import json
from datetime import datetime, timedelta, timezone

import pytest
import stripe
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "stripe_account_id": "acct_test_789",
}

APPLICATION_ROW = {
    "entity_id": "RA260001",
    "program_id": "PR26001",
    "config_version": 3,
    "status": "submitted",
    "applicant_email": "parent@example.com",
    "token_version": 1,
}

PLAN_BLOCK = {
    "block_id": "b-plan",
    "type": "payment_plan",
    "title": "Payment plan",
    "required": True,
    "blocking": True,
    "config": {
        "currency": "usd",
        "amount_full": 50000,
        "plans": [
            {"type": "pay_in_full"},
            {"type": "deposit", "deposit_amount": 10000},
        ],
    },
}


def deposit_event():
    return {
        "id": "evt_test_2",
        "type": "checkout.session.completed",
        "account": "acct_test_789",
        "data": {
            "object": {
                "id": "cs_test_dep1",
                "amount_total": 10000,
                "currency": "usd",
                "payment_status": "paid",
                "metadata": {
                    "tenant_id": "acme",
                    "application_id": "RA260001",
                    "item_id": "AI260007",
                    "kind": "deposit",
                },
            }
        },
    }


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def webhook_env(monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(settings, "balance_due_days", 30)
    rec = {"settled": [], "emails": [], "created_items": [], "balance_items": []}

    monkeypatch.setattr(
        "app.api.stripe_webhook.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_application", lambda t, a, tok: dict(APPLICATION_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_payment_plan_block",
        lambda t, application, tok: json.loads(json.dumps(PLAN_BLOCK)),
    )

    def fake_dc_query(tenant, sql, token, table="entities"):
        if "provider_ref" in sql:
            return []
        if "Balance payment" in sql:
            return list(rec["balance_items"])
        return []

    monkeypatch.setattr("app.api.stripe_webhook.dc_query", fake_dc_query)
    monkeypatch.setattr(
        "app.api.stripe_webhook.settle_payment_item",
        lambda *a, **k: rec["settled"].append(k) or {"entity_id": "PY260002"},
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.send_application_email",
        lambda tenant_id, application_id, to, subject, html, token: rec["emails"].append(
            {"to": to, "subject": subject, "html": html}
        ),
    )

    def fake_create_item(tenant_id, application_id, **kwargs):
        rec["created_items"].append(
            {"tenant_id": tenant_id, "application_id": application_id, **kwargs}
        )
        return {"entity_id": "AI260099"}

    monkeypatch.setattr("app.api.stripe_webhook.create_application_item", fake_create_item)
    monkeypatch.setattr(
        "app.api.stripe_webhook.make_link_token", lambda t, a, v: "tok_parent"
    )
    return rec


def post_deposit(client, monkeypatch):
    monkeypatch.setattr(
        stripe.Webhook, "construct_event", lambda payload, sig, secret: deposit_event()
    )
    return client.post(
        "/api/webhooks/stripe",
        content="{}",
        headers={"stripe-signature": "t=1,v1=sig", "content-type": "application/json"},
    )


def test_deposit_creates_nonblocking_balance_item(client, webhook_env, monkeypatch):
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    item = webhook_env["created_items"][0]
    assert item["kind"] == "payment"
    assert item["title"] == "Balance payment"
    assert item["blocking"] is False
    assert item["block_id"] == "b-plan"
    due = datetime.fromisoformat(item["due_at"])
    expected = datetime.now(timezone.utc) + timedelta(days=30)
    assert abs((due - expected).total_seconds()) < 120


def test_deposit_sends_balance_reminder_with_hub_link(client, webhook_env, monkeypatch):
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    # emails[0] is the receipt; emails[1] is the balance reminder
    assert len(webhook_env["emails"]) == 2
    reminder = webhook_env["emails"][1]
    assert reminder["to"] == "parent@example.com"
    assert f"{settings.familyhub_public_url}/application/tok_parent" in reminder["html"]
    assert "400.00" in reminder["html"]  # 50000 - 10000 cents


def test_existing_balance_item_is_not_duplicated(client, webhook_env, monkeypatch):
    webhook_env["balance_items"].append({"entity_id": "AI260099"})
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    assert webhook_env["created_items"] == []
    assert len(webhook_env["emails"]) == 1  # receipt only


def test_full_payment_creates_no_balance_item(client, webhook_env, monkeypatch):
    event = deposit_event()
    event["data"]["object"]["metadata"]["kind"] = "full"
    event["data"]["object"]["amount_total"] = 50000
    monkeypatch.setattr(
        stripe.Webhook, "construct_event", lambda payload, sig, secret: event
    )
    resp = client.post(
        "/api/webhooks/stripe",
        content="{}",
        headers={"stripe-signature": "t=1,v1=sig", "content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert webhook_env["created_items"] == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_balance_obligation.py -v`
Expected: FAIL — balance tests fail (no items created, only 1 email) because the deposit branch does not exist yet.

- [ ] **Step 3: Implement.** In `enrollx/backend/app/api/stripe_webhook.py`:

(a) Add to the imports at the top of the file:

```python
from datetime import datetime, timedelta, timezone
```

(b) Add this function after `_already_processed`:

```python
def _ensure_balance_obligation(
    tenant_id: str, tenant_name: str, application: dict
) -> None:
    """After a deposit settles: create the non-blocking balance item once,
    and email the balance reminder with the parent hub link."""
    application_id = str(application["entity_id"])
    existing = dc_query(
        tenant_id,
        "SELECT entity_id FROM data WHERE entity_type = 'application_item' "
        f"AND application_id = '{_q(application_id)}' "
        f"AND title = '{BALANCE_ITEM_TITLE}' AND _status = 'active'",
        None,
    )
    if existing:
        return

    block = get_payment_plan_block(tenant_id, application, None)
    cfg = block.get("config") or {}
    amount_full = int(cfg.get("amount_full") or 0)
    plans = {str(p.get("type")): p for p in (cfg.get("plans") or []) if p.get("type")}
    deposit_amount = int((plans.get("deposit") or {}).get("deposit_amount") or 0)
    balance = amount_full - deposit_amount
    if balance <= 0:
        return

    due_dt = datetime.now(timezone.utc) + timedelta(days=settings.balance_due_days)
    create_application_item(
        tenant_id,
        application_id,
        block_id=str(block.get("block_id") or "payment_plan"),
        kind="payment",
        title=BALANCE_ITEM_TITLE,
        blocking=False,
        due_at=due_dt.isoformat(),
        token=None,
    )

    email = application.get("applicant_email")
    if not email:
        return
    link_token = make_link_token(
        tenant_id, application_id, int(application.get("token_version") or 1)
    )
    hub_url = f"{settings.familyhub_public_url}/application/{link_token}"
    try:
        send_application_email(
            tenant_id,
            application_id,
            email,
            f"Balance due — {tenant_name}",
            balance_reminder_html(
                tenant_name,
                balance,
                str(cfg.get("currency") or "usd"),
                due_dt.date().isoformat(),
                hub_url,
            ),
            None,
        )
    except Exception:
        logger.exception("balance reminder email failed (application %s)", application_id)
```

(c) Replace the line `# Task 7 inserts the deposit branch here` in the webhook handler with:

```python
    if kind == "deposit" and application is not None:
        _ensure_balance_obligation(tenant_id, tenant_name, application)
```

- [ ] **Step 4: Run to pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/test_balance_obligation.py backend/tests/test_stripe_webhook.py -v`
Expected: 12 PASS (both files). Then the full suite: `uv run pytest backend/tests/ -v` — all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/backend
git commit -m "feat(enrollx): deposit settlement creates balance obligation and reminder email"
```

---

### Task 8: enrollx frontend — PaymentsSettingsPage

**Files:**
- Create: `enrollx/frontend/src/api/payments.ts`
- Create: `enrollx/frontend/src/pages/PaymentsSettingsPage.tsx`
- Create: `enrollx/frontend/src/pages/PaymentsSettingsPage.css`
- Modify: `enrollx/frontend/src/App.tsx` (route)
- Modify: `enrollx/frontend/src/pages/HomePage.tsx` (nav link — or the shared shell/nav component if Plan 4 has since added one; put the link wherever authenticated navigation lives)
- Modify: `enrollx/frontend/src/i18n/translations.ts` (both locales)

**Interfaces:**
- Consumes: `GET /api/stripe/{tenant_id}/connect-link` (Task 3), generic `POST /api/query` (Plan 1), `useAuth()` (user has `tenant_id: string` — the `TestUser` shape), `useTranslation()` (`t(key)`), `Button` UI component, API URL constant from `src/config.ts`.
- Produces: `/settings/payments` route showing connect state; connect button that redirects the browser to Stripe; handles `?stripe_connected=1` / `?stripe_error=…` callback params.

- [ ] **Step 1: Check the config export.** Open `enrollx/frontend/src/config.ts` and note the exported backend URL constant (Plan 1 renamed admindash's `ADMINDASH_API_URL`; expected name `ENROLLX_API_URL`). Use the actual exported name in the import below — this is the only permitted name substitution in this task.

- [ ] **Step 2: `src/api/payments.ts`**

```ts
import { ENROLLX_API_URL } from '../config.ts';

const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Double single quotes so a value is safe inside a SQL string literal. */
function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export async function fetchStripeConnectLink(tenantId: string): Promise<string> {
  const resp = await fetch(
    `${ENROLLX_API_URL}/api/stripe/${encodeURIComponent(tenantId)}/connect-link`,
    { headers: authHeaders() },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).url as string;
}

/** Connect state via the generic query endpoint — no bespoke status route. */
export async function fetchStripeAccountId(tenantId: string): Promise<string | null> {
  const sql =
    `SELECT stripe_account_id FROM data WHERE entity_type = 'tenant' ` +
    `AND entity_id = '${escapeSql(tenantId)}' AND _status = 'active'`;
  const resp = await fetch(`${ENROLLX_API_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant_id: tenantId, table: 'entities', sql }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const row = (data.data ?? [])[0] as Record<string, unknown> | undefined;
  const acct = row?.stripe_account_id;
  return typeof acct === 'string' && acct.length > 0 ? acct : null;
}
```

- [ ] **Step 3: `src/pages/PaymentsSettingsPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTranslation } from '../hooks/useTranslation.ts';
import Button from '../components/ui/Button.tsx';
import { fetchStripeAccountId, fetchStripeConnectLink } from '../api/payments.ts';
import './PaymentsSettingsPage.css';

export default function PaymentsSettingsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const tenantId = user?.tenant_id ?? '';

  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const justConnected = params.get('stripe_connected') === '1';
  const callbackError = params.get('stripe_error');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      setAccountId(await fetchStripeAccountId(tenantId));
    } catch {
      setError(t('payments.loadError'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onConnect = async () => {
    setRedirecting(true);
    setError(null);
    try {
      window.location.href = await fetchStripeConnectLink(tenantId);
    } catch {
      setError(t('payments.linkError'));
      setRedirecting(false);
    }
  };

  return (
    <main className="payments-settings">
      <h1>{t('payments.title')}</h1>
      <p className="payments-settings__intro">{t('payments.intro')}</p>

      {justConnected && (
        <div className="payments-settings__banner payments-settings__banner--ok" role="status">
          {t('payments.justConnected')}
        </div>
      )}
      {callbackError && (
        <div className="payments-settings__banner payments-settings__banner--error" role="alert">
          {t('payments.callbackError')}
        </div>
      )}
      {error && (
        <div className="payments-settings__banner payments-settings__banner--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="payments-settings__loading">{t('payments.loading')}</p>
      ) : accountId ? (
        <section className="payments-settings__card">
          <h2>{t('payments.connectedTitle')}</h2>
          <p>{t('payments.connectedBody')}</p>
          <p className="payments-settings__account">
            {t('payments.accountLabel')}: <code>{accountId}</code>
          </p>
        </section>
      ) : (
        <section className="payments-settings__card">
          <h2>{t('payments.notConnectedTitle')}</h2>
          <p>{t('payments.notConnectedBody')}</p>
          <Button variant="primary" onClick={onConnect} disabled={redirecting || !tenantId}>
            {redirecting ? t('payments.redirecting') : t('payments.connectButton')}
          </Button>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: `src/pages/PaymentsSettingsPage.css`** (tokens only — no raw hex; the token names exist in the theme.css copied from admindash in Plan 1):

```css
.payments-settings {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-6, 24px) var(--space-4, 16px);
}

.payments-settings__intro {
  color: var(--text-secondary);
  margin-bottom: var(--space-4, 16px);
}

.payments-settings__banner {
  border-radius: var(--radius-md, 8px);
  padding: var(--space-3, 12px) var(--space-4, 16px);
  margin-bottom: var(--space-4, 16px);
  border: 1px solid var(--border-color, currentColor);
}

.payments-settings__banner--ok {
  color: var(--color-success, var(--text-primary));
  background: var(--bg-card);
}

.payments-settings__banner--error {
  color: var(--color-danger, var(--text-primary));
  background: var(--bg-card);
}

.payments-settings__card {
  background: var(--bg-card);
  border: 1px solid var(--border-color, currentColor);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-5, 20px);
}

.payments-settings__card h2 {
  margin-top: 0;
}

.payments-settings__account code {
  color: var(--accent-ink, var(--text-primary));
}

.payments-settings__loading {
  color: var(--text-secondary);
}
```

If `npm run build` later fails on a missing token name, replace that token with one that exists in `enrollx/frontend/src/styles/theme.css` (inspect the file) — keep the fallback values.

- [ ] **Step 5: Route + nav.** In `enrollx/frontend/src/App.tsx` (Plan 1's minimal router: unauthenticated → LoginPage, authenticated → HomePage):
  - Add the import: `import PaymentsSettingsPage from './pages/PaymentsSettingsPage.tsx';`
  - Add an authenticated route alongside the HomePage route, matching the file's existing routing style. If it uses `<Routes>`: `<Route path="/settings/payments" element={<PaymentsSettingsPage />} />` (guarded the same way the HomePage route is guarded).

  In the authenticated shell/nav (HomePage if Plan 4 has not yet added a Navbar; the Navbar if it has), add a link using the file's existing link mechanism (`<Link to="/settings/payments">{t('nav.payments')}</Link>` with react-router's `Link`, or an anchor styled like its neighbors).

- [ ] **Step 6: i18n.** In `enrollx/frontend/src/i18n/translations.ts` add to the `'en-US'` object:

```ts
    // Payments settings
    'nav.payments': 'Payments',
    'payments.title': 'Payments',
    'payments.intro':
      "Connect your school's Stripe account to collect registration payments online. Funds settle directly to your Stripe account.",
    'payments.loading': 'Checking connection status…',
    'payments.loadError': 'Could not load your Stripe connection status.',
    'payments.linkError': 'Could not start Stripe onboarding. Please try again.',
    'payments.justConnected': 'Stripe account connected.',
    'payments.callbackError': 'Stripe connection did not complete. Please try again.',
    'payments.connectedTitle': 'Stripe is connected',
    'payments.connectedBody': 'Online payments are enabled for this school.',
    'payments.accountLabel': 'Connected account',
    'payments.notConnectedTitle': 'No Stripe account connected',
    'payments.notConnectedBody':
      'Online payments are disabled until you connect a Stripe account.',
    'payments.connectButton': 'Connect with Stripe',
    'payments.redirecting': 'Redirecting to Stripe…',
```

and to the `'zh-CN'` object:

```ts
    // Payments settings
    'nav.payments': '支付',
    'payments.title': '支付设置',
    'payments.intro':
      '连接学校的 Stripe 账户,即可在线收取报名费用。款项将直接结算到您的 Stripe 账户。',
    'payments.loading': '正在检查连接状态…',
    'payments.loadError': '无法加载 Stripe 连接状态。',
    'payments.linkError': '无法启动 Stripe 连接流程,请重试。',
    'payments.justConnected': 'Stripe 账户已连接。',
    'payments.callbackError': 'Stripe 连接未完成,请重试。',
    'payments.connectedTitle': 'Stripe 已连接',
    'payments.connectedBody': '本校已启用在线支付。',
    'payments.accountLabel': '已连接账户',
    'payments.notConnectedTitle': '尚未连接 Stripe 账户',
    'payments.notConnectedBody': '连接 Stripe 账户后才能启用在线支付。',
    'payments.connectButton': '连接 Stripe',
    'payments.redirecting': '正在跳转到 Stripe…',
```

- [ ] **Step 7: Build (this is the test for this task)**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build`
Expected: TypeScript check + Vite build succeed. Then `npm run lint` if an eslint config exists — expect clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add enrollx/frontend
git commit -m "feat(enrollx): payments settings page with Stripe Connect onboarding UI"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run every affected suite:**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build
python3 -c "import json; json.load(open('/Users/kennylee/Development/NeoApex/launchpad/backend/app/data/base_model.json')); print('base_model.json OK')"
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
```

Expected: everything green (`admindash` is untouched by this plan — a failure there means an accidental cross-module edit; investigate before proceeding). Fix regressions; do not skip and do not weaken tests.

- [ ] **Step 2: Boot smoke test.** Start only the enrollx backend and confirm the new surface exists, then kill it:

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run uvicorn app.main:app --app-dir backend --port 5910 &
sleep 3
curl -s localhost:5910/api/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:5910/api/stripe/acme/connect-link   # expect 401 (auth required), NOT 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:5910/api/webhooks/stripe    # expect 503 (secret unset) or 400, NOT 404
kill %1
```

- [ ] **Step 3:** Commit any stragglers on `feat/registration-plan3-payments`, then report completion with `git log --oneline main..HEAD` (or `docs/registration-flow-design..HEAD`). Do not push, merge, or open a PR — integration is decided outside this plan.
