# Hardening Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Plan 3 "blocking-ish" follow-ups as *verifiable true statements*: live-test the documents seam with real R2 credentials, land the missing FamilyHub documents-LIST facade, fix the concurrency/correctness debt (admindash sync-httpx, DataCore put_entity read window, pinned-steps draft conversion, token item_id guard), and bring apexflow/familyhub to deployable posture (IP allowlist, secret validators, Referrer-Policy, log scrubbing, Fly + deploy.yml artifacts).

**Architecture:** Tasks 1–10 are code changes executed by subagents (TDD, one commit per task minimum). The live-verification phase (R2 provisioning, browser-gate upload legs, failed-boot demos, log greps) is coordinator-run after the code lands, because it needs claude-in-chrome, the seeded local LanceDB data, and real credentials. Work happens on branch `feat/hardening-wave` in the MAIN working tree (not a worktree) — live verification requires the seeded `datacore/data/lancedb` tenants and `start-services.sh` harness that live only in this checkout.

**Tech Stack:** FastAPI + Uvicorn + pydantic_settings (backends), React 19 + TS + Vite (frontends), LanceDB (DataCore), pytest + respx + TestClient (backend tests), Fly.io + Cloudflare (deploy).

## Global Constraints

- **Scope guard (verbatim from the wave goal):** "nothing else rides along — no template work, no designer features. If a fix reveals something bigger (e.g., the DataCore write-ordering change gets risky), it gets parked with a written ruling rather than expanding the wave."
- Test baselines at wave start (must not regress): datacore **352**, apexflow backend **483**, familyhub backend **74**, admindash backend **194**, admindash frontend vitest **92**. Frontend `npm run build` and `npm run lint` clean for apexflow/familyhub/admindash frontends and `workflow-forms`.
- Suite commands: `cd datacore && uv run python -m pytest tests/ -q`; `cd apexflow && uv run pytest backend/tests/ -q`; `cd familyhub && uv run pytest backend/tests/ -q`; `cd admindash && uv run pytest backend/tests/ -q`; `cd admindash/frontend && npx vitest run`.
- Frontend rules: native Fetch (no axios), CSS variables, no global state lib.
- Config facts (verified this wave — trust these over memory):
  | Fact | Value |
  |---|---|
  | Ports | datacore 5800, apexflow-be 5910, apexflow-fe 5900, familyhub-be 5630, familyhub-fe 5620, admindash-be 5610, admindash-fe 5600 |
  | apexflow env prefix / familyhub env prefix | `APEXFLOW_` / `FAMILYHUB_` |
  | Dev secrets (apexflow `config.py:19-20`) | `DEV_LINK_SECRET = "dev-link-secret-change-in-prod"`, `DEV_INTERNAL_KEY = "dev-internal-key-change-in-prod"`, `MIN_SECRET_LENGTH = 32` |
  | apexflow health route | `GET /health` (NO `/api` prefix — `main.py:52`, deliberate) |
  | familyhub health route | `GET /api/health` |
  | R2 env vars (bare `os.environ`, datacore only) | `DATACORE_R2_ENDPOINT`, `DATACORE_R2_ACCESS_KEY_ID`, `DATACORE_R2_SECRET_ACCESS_KEY`, `DATACORE_R2_BUCKET`, `DATACORE_R2_URL_TTL_SECONDS` (default 900) |
  | New Fly apps | `apexflow-api` (5910, public + flycast), `familyhub-api` (5630, public) |
  | DataCore internal URL in prod | `http://datacore.flycast:5800` |
  | apexflow internal URL in prod (for familyhub) | `http://apexflow-api.flycast:5910` |
  | Seeded staff login | `jane@acme.edu` / `admin123`, tenant `acme` |
  | Seed/repair script | `cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py --models-only` (default mode WIPES document rows — never run bare mid-verification) |
  | Enrollment template docs step | available only in state `approved`; single doc `Immunization Record`, `sensitive: True` |
- Never fix findings in the controller session; subagents implement, reviewers gate.
- Commits: conventional prefixes (`fix:`, `feat:`, `test:`, `chore:`, `docs:`), one task may make several commits.

---

### Task 1: FamilyHub token-scoped documents-LIST facade route (backend)

**Files:**
- Modify: `familyhub/backend/app/api/documents.py` (add one route after `get_document_url` at `:102-113`)
- Test: `familyhub/backend/tests/test_document_routes.py` (append a `# --- list ---` block)

**Interfaces:**
- Consumes: apexflow `GET /internal/instance-by-token/{token}/documents` (`apexflow/backend/app/api/internal.py:381-395`) — already implemented, filtered (hides other uploaders' sensitive docs), and tested upstream; returns a JSON list of `{entity_id, document_id, filename, uploaded_by, item_id}`.
- Produces: `GET /api/instance/{token}/documents` on familyhub-backend, relaying the upstream body/status via the module's existing `_relay` policy (4xx verbatim, ≥500 masked to fixed 502). Task 2's frontend calls this.

- [ ] **Step 1: Read the existing module.** Read `familyhub/backend/app/api/documents.py` in full. The new route MUST mirror `get_document_url` (`:102-113`) exactly in structure: same token shape pre-check, same upstream call helper, same `_relay`. Read `familyhub/backend/tests/test_document_routes.py` to reuse its fixture/respx idioms.

- [ ] **Step 2: Write the failing tests** (adapt helper names to what the test file actually uses — e.g. its existing upstream-stub fixture and token constants):

```python
# --- list ---

@respx.mock
def test_list_documents_proxies_to_apexflow_internal(client):
    route = respx.get(
        f"{APEXFLOW}/internal/instance-by-token/{GOOD_TOKEN}/documents"
    ).mock(return_value=httpx.Response(200, json=[
        {"entity_id": "d-1", "document_id": "d-1", "filename": "form.pdf",
         "uploaded_by": "family:app-1", "item_id": "it-1"},
    ]))
    resp = client.get(f"/api/instance/{GOOD_TOKEN}/documents")
    assert resp.status_code == 200
    body = resp.json()
    assert [d["document_id"] for d in body] == ["d-1"]
    assert route.called

@respx.mock
def test_list_documents_upstream_401_passes_through(client):
    respx.get(
        f"{APEXFLOW}/internal/instance-by-token/{GOOD_TOKEN}/documents"
    ).mock(return_value=httpx.Response(401, json={"detail": "Invalid link"}))
    resp = client.get(f"/api/instance/{GOOD_TOKEN}/documents")
    assert resp.status_code == 401

@respx.mock
def test_list_documents_upstream_500_masked_to_502(client):
    respx.get(
        f"{APEXFLOW}/internal/instance-by-token/{GOOD_TOKEN}/documents"
    ).mock(return_value=httpx.Response(500, text="secret traceback"))
    resp = client.get(f"/api/instance/{GOOD_TOKEN}/documents")
    assert resp.status_code == 502
    assert "secret traceback" not in resp.text

def test_list_documents_malformed_token_no_upstream_call(client):
    # mirror the existing malformed-token tests at test_document_routes.py:220-227
    with respx.mock:
        resp = client.get("/api/instance/not-a-token/documents")
        assert resp.status_code == 401
        assert not respx.calls
```

- [ ] **Step 3: Run to verify failure.** `cd familyhub && uv run pytest backend/tests/test_document_routes.py -q` — the four new tests fail (404 route-not-found).

- [ ] **Step 4: Implement the route**, mirroring `get_document_url`'s exact helper usage:

```python
@router.get("/instance/{token}/documents")
def list_documents(token: str) -> Response:
    """Token-scoped list of this instance's visible documents.

    Pure relay: apexflow's internal route already scopes to the instance
    and hides other uploaders' sensitive documents.
    """
    parse_token(token)  # same shape-check-then-401 the sibling routes use
    resp = call_upstream("GET", f"/internal/instance-by-token/{token}/documents")
    return _relay(resp)
```
(Use whatever the sibling route actually calls for token pre-check/upstream — match it verbatim; do not invent new helpers.)

- [ ] **Step 5: Run the whole familyhub suite.** `cd familyhub && uv run pytest backend/tests/ -q` — 78 passing (74 + 4).

- [ ] **Step 6: Commit.** `git add familyhub/backend && git commit -m "feat(familyhub): token-scoped documents-LIST facade route"`

---

### Task 2: FamilyHub runtime renders real uploaded-documents rows

**Files:**
- Modify: `familyhub/frontend/src/api/facade.ts` (add `listDocuments`)
- Modify: `familyhub/frontend/src/pages/RegisterPage.tsx` (`documents={[]}` at `:464` and its apology comment at `:459-463`)

**Interfaces:**
- Consumes: Task 1's `GET /api/instance/{token}/documents` → `InstanceDocumentView[]` (`workflow-forms/src/types.ts:123-127`: `{document_id, filename, item_id?}`; wire rows are a superset — extra keys are fine).
- Produces: `listDocuments(token: string): Promise<InstanceDocumentView[]>` in facade.ts; RegisterPage state `documents` passed to StepRenderer.

- [ ] **Step 1: Add the API function** to `facade.ts`, matching the file's existing fetch/error idiom (read neighbors like `getDocumentUrl`/`fetchInstance` first and copy their shape):

```ts
export async function listDocuments(token: string): Promise<InstanceDocumentView[]> {
  const resp = await fetch(
    `${API_BASE}/api/instance/${encodeURIComponent(token)}/documents`,
  );
  if (!resp.ok) throw await toApiError(resp);
  return resp.json();
}
```

- [ ] **Step 2: Wire RegisterPage.** Add `const [documents, setDocuments] = useState<InstanceDocumentView[]>([]);`. Load them whenever the instance loads (same effect that calls `fetchInstance`, or a sibling effect keyed on `[token, instance]`), and refresh after a successful upload (`uploadDocumentFile` resolution at `facade.ts:220-240` — refresh where the upload's completion already refetches instance state). Failures to list must NOT break the page: `.catch(() => setDocuments([]))`. Replace `documents={[]}` at `:464` with `documents={documents}` and delete the now-false comment at `:459-463`.

- [ ] **Step 3: Verify build + lint.** `cd familyhub/frontend && npm run build && npm run lint` — clean. (No vitest exists in familyhub/frontend; the rendered sublist is verified in the live phase, Task L2.)

- [ ] **Step 4: Commit.** `git commit -m "feat(familyhub): runtime 'already uploaded' sublist renders real document rows"`

---

### Task 3: Token document-create rejects foreign item_id

**Files:**
- Modify: `apexflow/backend/app/api/internal.py` (`create_document_by_token`, insert guard between `:429` and `:431`)
- Test: `apexflow/backend/tests/test_internal_api.py` (append to the `# --- documents ---` block at `:515`)

**Interfaces:**
- Consumes: `ctx.items` from `machine.build_eval_context` (each item row has `entity_id`).
- Produces: 400 `{"detail": {"error": "item_id does not belong to this instance"}}` on a non-member non-null `item_id`. `item_id: None` (ad-hoc upload) stays allowed.

- [ ] **Step 1: Write the failing tests** (reuse the file's existing fixtures — `fake_documents_upstream`, the good-token fixture — copying the setup of `test_create_document_by_token_ignores_client_supplied_uploaded_by` at `:540`):

```python
def test_create_document_by_token_rejects_foreign_item_id(client, ...):
    resp = client.post(
        f"/internal/instance-by-token/{token}/documents",
        headers=INTERNAL_HEADERS,
        json={"filename": "x.pdf", "content_type": "application/pdf",
              "size": 123, "item_id": "item-of-some-other-instance"},
    )
    assert resp.status_code == 400
    assert "item_id" in str(resp.json()["detail"])

def test_create_document_by_token_allows_null_item_id(client, ...):
    # ad-hoc upload with no item binding still 201s
    resp = client.post(
        f"/internal/instance-by-token/{token}/documents",
        headers=INTERNAL_HEADERS,
        json={"filename": "x.pdf", "content_type": "application/pdf", "size": 123},
    )
    assert resp.status_code == 201
```

- [ ] **Step 2: Run to verify failure** (`cd apexflow && uv run pytest backend/tests/test_internal_api.py -q` — foreign-item test gets 201, fails).

- [ ] **Step 3: Implement the guard** in `create_document_by_token` right after `ctx` is built (`:429`):

```python
if body.item_id is not None and not any(
    item.get("entity_id") == body.item_id for item in ctx.items
):
    raise HTTPException(
        status_code=400,
        detail={"error": "item_id does not belong to this instance"},
    )
```

- [ ] **Step 4: Run suite** — `cd apexflow && uv run pytest backend/tests/ -q`, 485 passing. Check no existing test posted a foreign `item_id` expecting success (the `sensitive-defaults-false-when-item-unresolvable` test at `:589` uses an unresolvable item — if it now 400s, that test's *intent* is the sensitive-derivation fallback: keep the derivation test by pointing it at the STAFF path or a null item_id, and note the change in the commit message. Do not weaken the new guard.)

- [ ] **Step 5: Commit.** `git commit -m "fix(apexflow): token document create rejects item_id not on the instance"`

---

### Task 4: Family resume converts drafts against pinned steps

**Files:**
- Modify: `familyhub/frontend/src/pages/RegisterPage.tsx` (`:218-222` hydration, `:283-293` autosave, and the steps source for conversion only)
- Test: `apexflow/backend/tests/test_engine.py` or the file holding `save_draft` tests (locate `save_draft` tests first; add the republish regression there)

**Interfaces:**
- Consumes: `instance.definition.steps` — the instance's PINNED steps, already returned by `GET /internal/instance-by-token/{token}` (`internal.py:353`) and typed at `familyhub/frontend/src/types/workflow.ts:143-151`; converters `draftToSectionAnswers` / `sectionAnswersToDraft` (`workflow-forms/src/sectionAnswers.ts:42-67`, `:81-104`) which take a steps array.
- Produces: autosave payloads keyed by the pinned definition's section ids, so `save_draft`'s pinned-steps validation (`engine.py:323-332`) can never 400 on a republish rename. Rendering (`visibleSteps` at `:403`) is NOT in scope — only the conversion arrays change.

- [ ] **Step 1: Write the failing backend regression test** — this encodes the goal line "republish, then autosave the old instance, expect 200" at the engine level, proving the pinned contract end-to-end (find the existing `save_draft` tests and copy their fixture setup; use the fake DataCore + template seeding idiom the suite already has):

```python
def test_save_draft_after_republish_rename_still_accepts_pinned_sections(...):
    # 1. publish v1 with a form section 'guardians'; start an instance (pins v1)
    # 2. republish v2 renaming the section to 'contacts'
    # 3. save_draft on the v1 instance with section_answers keyed 'guardians'
    # -> 200, because validation resolves the PINNED (v1) steps
    ...
    resp = save_draft_via_route_or_engine(instance, {"guardians": {...}})
    assert resp.status_code == 200
```
Flesh this out against the suite's real helpers — the test must build a real two-version lineage (publish → new draft → publish) using the same definition-authoring helpers the designer tests use. If the engine already passes (it validates pinned steps at `engine.py:323`), this test will pass immediately once correctly constructed — that is FINE and expected; it pins the server half of the contract. Verify it FAILS if you flip `_pinned_steps` to published steps locally (do not commit that flip) — note in the report that you did this mutation check.

- [ ] **Step 2: Fix the frontend conversion.** In RegisterPage, introduce `const conversionSteps = instance?.definition?.steps ?? bundle.definition.steps;` and use `conversionSteps` in BOTH the hydration effect (`:218-222`, `sectionAnswersToDraft`) and the autosave debounce (`:283-293`, `draftToSectionAnswers`). Update the comment at `:283-285` to say conversion uses the instance's pinned steps. Leave `visibleSteps`/rendering on the bundle (changing what renders is out of scope; if pinned and published drift, the pinned conversion at minimum stops the 400s — the render-drift question is parked, see exit-gate rulings).

- [ ] **Step 3: Run** `cd apexflow && uv run pytest backend/tests/ -q` (486) and `cd familyhub/frontend && npm run build && npm run lint` — clean.

- [ ] **Step 4: Commit.** `git commit -m "fix(familyhub): convert resume drafts against the instance's pinned steps"`

---

### Task 5: admindash entities.py/query.py go async + regression tests

**Files:**
- Modify: `admindash/backend/app/api/entities.py:18-27` (`_proxy_to_datacore`), `admindash/backend/app/api/query.py:34-42`
- Test: `admindash/backend/tests/test_entities.py`, `admindash/backend/tests/test_query.py`

**Interfaces:**
- Consumes: the fixed reference implementation in `apexflow/backend/app/api/entities.py:48-56` and `apexflow/backend/app/api/query.py:57-65` (awaited `httpx.AsyncClient`), and the regression-test shapes in `apexflow/backend/tests/test_entities_api.py:227-286` and `test_query_api.py:179-229`.
- Produces: no route signature changes; same 502 detail string `"DataCore is unreachable"`.

- [ ] **Step 1: Write the four failing-or-proving tests.** Port BOTH shapes into each admindash test file. admindash has no auth dependency-override fixture — every test stubs `/auth/me` via the file's `_stub_auth` helper (`test_entities.py:6-9`). The concurrency tests must therefore stub auth too. Port of the entities pair (query pair is identical modulo route/payload):

```python
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

DATACORE = "http://localhost:5800"

@respx.mock
def test_create_entity_returns_502_when_datacore_unreachable(client):
    _stub_auth(respx)
    respx.post(f"{DATACORE}/api/entities/t1/student").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    resp = client.post(
        "/api/entities/t1/student",
        headers={"Authorization": "Bearer good"},
        json={"base_data": {"name": "S"}, "custom_fields": {}},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "DataCore is unreachable"

@respx.mock
def test_concurrent_creates_are_not_serialized_by_the_proxy(client):
    """Regression: the proxy must not hold Uvicorn's event loop for the
    full DataCore round-trip (apexflow Plan 2 gate defect, admindash half)."""
    _stub_auth(respx)
    per_request_delay = 0.2
    concurrency = 6

    async def slow_handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(per_request_delay)
        return httpx.Response(200, json={"entity_id": "s_slow"})

    respx.post(f"{DATACORE}/api/entities/t1/student").mock(side_effect=slow_handler)

    def do_request() -> int:
        return client.post(
            "/api/entities/t1/student",
            headers={"Authorization": "Bearer good"},
            json={"base_data": {"name": "S"}, "custom_fields": {}},
        ).status_code

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        statuses = list(pool.map(lambda _: do_request(), range(concurrency)))
    elapsed = time.monotonic() - started

    assert statuses == [200] * concurrency
    assert elapsed < per_request_delay * (concurrency / 2), (
        f"proxy calls appear serialized: {elapsed:.2f}s for {concurrency}"
    )
```
Adapt the entities route path/payload to whatever `test_entities.py` already exercises (match an existing passing create test's URL and body exactly — including its tenant id and auth-stub tenant). For `test_query.py`: route `POST /api/query`, mocked upstream `respx.post(f"{DATACORE}/api/query")` returning `{"data": [], "total": 0}`, request body matching an existing passing query test (its tenant guard must pass).

- [ ] **Step 2: Run to verify state.** `cd admindash && uv run pytest backend/tests/test_entities.py backend/tests/test_query.py -q`. The 502 tests may already pass (the sync code has a 502 handler); the two concurrency tests MUST FAIL against the sync implementation (serialized ≈1.2s). If a concurrency test passes pre-fix, its threshold or mock is wrong — fix the test, don't proceed.

- [ ] **Step 3: Port the fix.** Replace the sync calls with apexflow's exact shape:

```python
# entities.py _proxy_to_datacore body
try:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            method,
            f"{settings.datacore_url}{path}",
            content=body,
            headers={"Content-Type": content_type, "Authorization": token},
        )
except httpx.RequestError:
    raise HTTPException(status_code=502, detail="DataCore is unreachable")
```
Same transformation for `query.py:34-42` (`client.post(...)` awaited). Update each module's docstring to note the port from apexflow (mirror apexflow's docstring style, `entities.py:1-27`).

- [ ] **Step 4: Run the full admindash suite.** `cd admindash && uv run pytest backend/tests/ -q` — 198 passing (194 + 4).

- [ ] **Step 5: Commit.** `git commit -m "fix(admindash): awaited AsyncClient in entities/query proxies + serialization regression tests"`

---

### Task 6: DataCore put_entity — close the no-active-row read window

**Files:**
- Modify: `datacore/src/datacore/store.py` (`put_entity` `:316-403`, `get_active_entity` `:410-429`)
- Test: `datacore/tests/test_store_entities.py`

**Decision (the wave's written ruling):** CLOSE the window with **embed-first, insert-before-archive** ordering rather than a client retry convention. Rationale: (a) the current ordering's crash window between delete and insert loses the entity's active row *permanently*; insert-first degrades to a transient two-active-rows state that max-`_version` semantics already tolerate; (b) the Plan 3 gate observed the zero-row window live twice — it's real under single-user use already. Residual: a reader can transiently see TWO active rows; `get_active_entity` is hardened to pick max `_version`; raw `/api/query` clients already carry the "dedupe by max `_version`" discipline (gate doc `2026-08-06-apexflow-plan3-channels.md:947`). `put_model` (`store.py:197-205`) has the same pattern but is deliberately NOT changed (scope guard) — parked in the exit-gate rulings.

**Interfaces:**
- Consumes: existing `_get_max_version`, `VersionConflictError` CAS check (unchanged, still first).
- Produces: same public signature and end-state (one active row at `_version = prev + 1`, previous rows archived). `get_active_entity` returns the max-`_version` active row if several exist.

- [ ] **Step 1: Read `put_entity` in full** (`store.py:316-403`) and `get_active_entity` (`:410-429`). Note the exact field names (`_status`, `_version`, `_updated_at`) and the embedder call site.

- [ ] **Step 2: Write the failing repro test.** This is the Plan 3 live repro ("reads racing the designer's reactivate returned zero rows") made deterministic: block inside the embedder (which today runs INSIDE the zero-active window at `:379-385`) and read concurrently.

```python
import threading

def test_reader_never_sees_zero_active_rows_during_put_entity(store):
    store.put_entity("t1", "widget", {"entity_id": "w1", "name": "v1"})

    gate = threading.Event()
    release = threading.Event()
    real_embed = store.embedder.embed

    def blocking_embed(*args, **kwargs):
        gate.set()          # signal: put_entity has reached the embed step
        release.wait(5)     # hold it there while the reader looks
        return real_embed(*args, **kwargs)

    store.embedder.embed = blocking_embed
    try:
        writer = threading.Thread(
            target=lambda: store.put_entity(
                "t1", "widget", {"entity_id": "w1", "name": "v2"}
            )
        )
        writer.start()
        assert gate.wait(5)
        seen = store.get_active_entity("t1", "widget", "w1")
        release.set()
        writer.join(10)
    finally:
        store.embedder.embed = real_embed
        release.set()

    assert seen is not None, "reader saw ZERO active rows mid-update"
    # after the dust settles: exactly one active row, at the new version
    final = store.get_active_entity("t1", "widget", "w1")
    assert final["name"] == "v2"
```
Adapt constructor/fixture/method names to the real test file idioms (`test_store_entities.py:39-65` shows the fixture and how `put_entity` is invoked there; `store.embedder` attribute name per `store.py:379-385`). Under the CURRENT ordering the embed happens after the delete, so `seen` is `None` → test FAILS. Run and confirm the failure.

- [ ] **Step 3: Reorder `put_entity`.** Target shape (adapt to real local names; CAS check stays exactly where it is):

```python
new_version = current_version + 1
now = ...

# 1. Embed BEFORE any table mutation (was inside the window).
vector = self.embedder.embed(...)

# 2. Insert the NEW active row first.
record = {..., "_version": new_version, "_status": "active", ...}
table.add([record])

# 3. Archive the PREVIOUS active rows (never the one just inserted).
stale = f"{where} AND _status = 'active' AND _version < {new_version}"
active_rows = table.search().where(stale).to_list()
if active_rows:
    table.delete(stale)
    for row in active_rows:
        row["_status"] = "archived"
        row["_updated_at"] = now
    table.add(active_rows)

self._trim_entity_versions(...)
```

- [ ] **Step 4: Harden `get_active_entity`** to return the max-`_version` row when more than one active row matches (transient two-active window): sort matches by `int(row["_version"])` descending and take the first. Add a direct test:

```python
def test_get_active_entity_prefers_max_version_when_two_actives_exist(store):
    # simulate the transient insert-before-archive window (or a crash inside it)
    ...insert v1 active and v2 active rows directly via the table...
    row = store.get_active_entity("t1", "widget", "w1")
    assert int(row["_version"]) == 2
```

- [ ] **Step 5: Run the full datacore suite.** `cd datacore && uv run python -m pytest tests/ -q` — 354 passing (352 + 2). Pay attention to `test_entity_new_version_archives_previous` (`:39-65`) and the CAS tests (`:367-418`) — they assert end-states and must still pass unmodified. If any existing test asserts the OLD intermediate ordering, stop and re-read it — end-state assertions must not be weakened.

- [ ] **Step 6: Commit.** `git commit -m "fix(datacore): put_entity inserts new active row before archiving old (closes no-active-row read window)"`

---

### Task 7: Config validators — familyhub secret length, TRUST_ALL_IPS production refusal (both services)

**Files:**
- Modify: `familyhub/backend/app/config.py` (add `MIN_SECRET_LENGTH`, dedicated `validate_production_secrets`), `apexflow/backend/app/config.py` (extend `validate_production_secrets` at `:92-118`)
- Test: `familyhub/backend/tests/test_config.py`, `apexflow/backend/tests/test_config.py` (create or extend — check for existing config tests first and extend in place)

**Interfaces:**
- Produces: in `environment == "production"`, both services refuse to construct Settings when (a) a secret equals its dev default, (b) `len(secret) < 32`, or (c) `os.environ.get("TRUST_ALL_IPS") == "1"`. familyhub gains `MIN_SECRET_LENGTH = 32` and a named `validate_production_secrets` model_validator (move the existing check out of `parse_and_validate_cors:46-49`; keep the dev-default literal in ONE module constant `DEV_INTERNAL_KEY = "dev-internal-key-change-in-prod"` referenced by both the field default at `:22` and the validator).

- [ ] **Step 1: Write the failing tests** (pydantic Settings can be constructed directly with kwargs; use `monkeypatch` for `TRUST_ALL_IPS`):

```python
import pytest
from app.config import Settings, DEV_INTERNAL_KEY

VALID = dict(
    environment="production",
    cors_allowed_origins="https://familyhub.example.com",
    apexflow_internal_key="x" * 32,
)

def test_production_boot_ok_with_real_secrets():
    Settings(**VALID)

def test_production_refuses_dev_default_internal_key():
    with pytest.raises(Exception, match="FAMILYHUB_APEXFLOW_INTERNAL_KEY"):
        Settings(**{**VALID, "apexflow_internal_key": DEV_INTERNAL_KEY})

def test_production_refuses_short_internal_key():
    with pytest.raises(Exception, match="32"):
        Settings(**{**VALID, "apexflow_internal_key": "short"})

def test_production_refuses_trust_all_ips(monkeypatch):
    monkeypatch.setenv("TRUST_ALL_IPS", "1")
    with pytest.raises(Exception, match="TRUST_ALL_IPS"):
        Settings(**VALID)

def test_development_allows_dev_defaults(monkeypatch):
    monkeypatch.setenv("TRUST_ALL_IPS", "1")
    Settings(environment="development")
```
Mirror the same five shapes for apexflow (`APEXFLOW_LINK_SECRET`/`APEXFLOW_INTERNAL_KEY` both ≥32 non-default — those two checks already exist at `config.py:104-117`; only the TRUST_ALL_IPS refusal and its test are new there). NOTE: familyhub/apexflow conftest autouse fixtures set `TRUST_ALL_IPS=1` — the new tests must `monkeypatch.delenv("TRUST_ALL_IPS", raising=False)` where its absence is assumed.

- [ ] **Step 2: Run to verify failures**, then implement. familyhub validator:

```python
MIN_SECRET_LENGTH = 32
DEV_INTERNAL_KEY = "dev-internal-key-change-in-prod"

@model_validator(mode="after")
def validate_production_secrets(self) -> "Settings":
    if self.environment != "production":
        return self
    if os.environ.get("TRUST_ALL_IPS") == "1":
        raise ValueError(
            "TRUST_ALL_IPS=1 must never be set in production: it disables "
            "the Cloudflare IP allowlist AND collapses rate-limit keying."
        )
    key = self.apexflow_internal_key
    if not key or key == DEV_INTERNAL_KEY:
        raise ValueError(
            "FAMILYHUB_APEXFLOW_INTERNAL_KEY must be set to a real secret in production"
        )
    if len(key) < MIN_SECRET_LENGTH:
        raise ValueError(
            f"FAMILYHUB_APEXFLOW_INTERNAL_KEY must be at least {MIN_SECRET_LENGTH} chars"
        )
    return self
```
Remove the old inline check from `parse_and_validate_cors:46-49`. In apexflow's existing `validate_production_secrets`, add the same `TRUST_ALL_IPS` refusal as its first production check.

- [ ] **Step 3: Run both suites** (`familyhub` 83 = 78 + 5; `apexflow` 486 + its new tests). Confirm zero collection-time explosions from the autouse `TRUST_ALL_IPS` fixture interacting with module-scope `settings = Settings()` (the validators only fire for `environment == "production"`, so dev/test construction is unaffected).

- [ ] **Step 4: Commit.** `git commit -m "feat(config): familyhub secret-length floor + TRUST_ALL_IPS production refusal in both services"`

---

### Task 8: apexflow Cloudflare IP-allowlist middleware (fifth copy)

**Files:**
- Create: `apexflow/backend/app/middleware/__init__.py`, `apexflow/backend/app/middleware/cloudflare_ip.py`
- Modify: `apexflow/backend/app/main.py` (mount), `start-services.sh:241-246` (add `TRUST_ALL_IPS=1` to the apexflow-backend line), `apexflow/backend/tests/conftest.py` (autouse bypass), and the "copies" docstrings in ALL five `cloudflare_ip.py` files
- Test: `apexflow/backend/tests/test_cloudflare_ip.py`

**Interfaces:**
- Consumes: `familyhub/backend/app/middleware/cloudflare_ip.py` as the byte-source (the freshest copy, docstring at `:15-19`).
- Produces: apexflow 403s non-Cloudflare/non-Fly source IPs; `GET /health` stays exempt (Fly health checks); `TRUST_ALL_IPS=1` bypasses for dev.

- [ ] **Step 1: Copy the middleware** from familyhub verbatim into `apexflow/backend/app/middleware/cloudflare_ip.py` with exactly two edits: (a) `_EXEMPT_PATHS = frozenset({"/health"})` — apexflow's health route has NO `/api` prefix (`main.py:52`); copying `/api/health` unchanged would 403 Fly's health checks and fail every deploy; (b) the docstring's copy-count sentence. Update the docstring in ALL FIVE copies (launchpad, papermite, admindash, familyhub, apexflow) to say five copies and list them — this also closes Plan 5 follow-up #9 ("still says three").

- [ ] **Step 2: Mount it** in `apexflow/backend/app/main.py` exactly as familyhub does (`familyhub/backend/app/main.py:23-26`), after CORS: `app.add_middleware(CloudflareIPMiddleware)` (the env-var OR inside the middleware handles `TRUST_ALL_IPS`).

- [ ] **Step 3: Dev harness + test bypass.** `start-services.sh` apexflow-backend line (`:244`): prefix with `TRUST_ALL_IPS=1` matching the familyhub line at `:250`. `apexflow/backend/tests/conftest.py`: add the autouse fixture copied from `familyhub/backend/tests/conftest.py:15`:

```python
@pytest.fixture(autouse=True)
def _bypass_cloudflare_middleware(monkeypatch):
    monkeypatch.setenv("TRUST_ALL_IPS", "1")
```
CAUTION: apexflow builds `app` and `settings` at import time — the middleware reads `TRUST_ALL_IPS` at REQUEST time (the OR in `__init__` is at mount time). If mounting at import beats the fixture, follow whatever familyhub/papermite do to make their suites pass (their conftests solve the identical problem; `familyhub/backend/tests/conftest.py:6-16` is the working reference — note it sets the env var BEFORE the app import inside the client fixture).

- [ ] **Step 4: Write tests** — copy the shape of familyhub's middleware tests if a `test_cloudflare_ip.py` exists there; otherwise minimal:

```python
def test_untrusted_ip_403(client_without_bypass):
    resp = client_without_bypass.get("/api/definitions/acme")
    assert resp.status_code == 403

def test_health_exempt(client_without_bypass):
    assert client_without_bypass.get("/health").status_code == 200

def test_trust_all_ips_bypasses(client):  # normal client, fixture sets the var
    ...
```
(TestClient's `request.client.host` is `"testclient"` → untrusted; build `client_without_bypass` by clearing `TRUST_ALL_IPS` and re-importing/re-instantiating the app the same way familyhub's middleware tests do.)

- [ ] **Step 5: Run the apexflow suite** (`cd apexflow && uv run pytest backend/tests/ -q`) — prior count + new middleware tests, zero regressions. Also `bash -n start-services.sh`.

- [ ] **Step 6: Commit.** `git commit -m "feat(apexflow): Cloudflare IP-allowlist middleware (fifth copy), /health exempt"`

---

### Task 9: Referrer-Policy + access-log token scrubbing (apexflow + familyhub)

**Files:**
- Create: `apexflow/backend/app/middleware/security_headers.py`, `familyhub/backend/app/middleware/security_headers.py` (twin copies, cross-referenced docstrings)
- Modify: both `main.py` files (mount + install log filter)
- Test: `apexflow/backend/tests/test_security_headers.py`, `familyhub/backend/tests/test_security_headers.py`

**Interfaces:**
- Produces: `Referrer-Policy: no-referrer` on EVERY response from both services (magic-link tokens live in URL paths — `no-referrer`, not the frontends' `strict-origin-when-cross-origin`, per Plan 5 follow-up #7). A `logging.Filter` on the `uvicorn.access` logger rewrites token path segments to `[token]` before the line is emitted.

- [ ] **Step 1: Write the failing tests** (per service; same file shape):

```python
def test_referrer_policy_on_every_response(client):
    assert client.get("/api/health").headers["Referrer-Policy"] == "no-referrer"
    # any 404 also carries it (middleware wraps all responses)
    assert client.get("/api/nope").headers["Referrer-Policy"] == "no-referrer"

def test_access_log_filter_scrubs_token_paths():
    from app.middleware.security_headers import AccessLogTokenScrubFilter
    import logging
    f = AccessLogTokenScrubFilter()
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:1", "GET", "/api/instance/eyJhbGciOi.secretpart/documents", "1.1", 200),
        None,
    )
    assert f.filter(rec) is True
    assert "secretpart" not in rec.getMessage()
    assert "[token]" in rec.getMessage()

def test_access_log_filter_scrubs_query_token():
    ...same, args path "/w/acme/enrollment?token=abc.def.ghi" -> "?token=[token]"...

def test_access_log_filter_leaves_plain_paths_alone():
    ...args path "/api/health" unchanged...
```
(apexflow's variant asserts on `/health` and scrubs `/internal/instance-by-token/{token}` paths.)

- [ ] **Step 2: Implement** one module, twin-copied (like `cloudflare_ip.py`), docstring noting the twin:

```python
"""Referrer-Policy + access-log token scrubbing.

Magic-link tokens travel in URL paths by design (roadmap Plans 1-3), so:
- every response carries `Referrer-Policy: no-referrer`
- uvicorn's access log has the token path segment replaced with [token]

Twin copies: apexflow/backend and familyhub/backend. Keep in sync.
"""
import logging
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_TOKEN_IN_PATH = re.compile(
    r"(/(?:api/instance|internal/instance-by-token)/)[^/\s?\"]+"
)
_TOKEN_IN_QUERY = re.compile(r"(\btoken=)[^&\s\"]+")


class SecurityHeadersMiddleware:
    """Pure-ASGI: adds Referrer-Policy to every HTTP response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.append((b"referrer-policy", b"no-referrer"))
            await send(message)

        await self.app(scope, receive, send_with_header)


def _scrub(value: str) -> str:
    value = _TOKEN_IN_PATH.sub(r"\1[token]", value)
    return _TOKEN_IN_QUERY.sub(r"\1[token]", value)


class AccessLogTokenScrubFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            record.args = tuple(
                _scrub(a) if isinstance(a, str) else a for a in record.args
            )
        return True


def install_access_log_scrubber() -> None:
    logging.getLogger("uvicorn.access").addFilter(AccessLogTokenScrubFilter())
```
Mount in each `main.py`: `app.add_middleware(SecurityHeadersMiddleware)` (outermost is fine) and call `install_access_log_scrubber()` at module import. Idempotency: guard against double-adding the filter (check `any(isinstance(f, AccessLogTokenScrubFilter) for f in logger.filters)`).

- [ ] **Step 3: Run both suites** — new counts recorded, zero regressions.

- [ ] **Step 4: Commit.** `git commit -m "feat(security): Referrer-Policy no-referrer + access-log token scrubbing on apexflow/familyhub"`

---

### Task 10: Deploy artifacts — Fly + deploy.yml entries for apexflow-api and familyhub-api

**Files:**
- Create: `apexflow/fly.toml`, `apexflow/Dockerfile`, `familyhub/fly.toml`, `familyhub/Dockerfile`
- Modify: `.github/workflows/deploy.yml` (choice list `:12-16`, tag regex `:49`, two new jobs), `deploy/suite-manifest.json` (`:15-20`), `docs/deployment/architecture.md` (topology additions), `docs/deployment/release-runbook.md` (tag examples)

**Interfaces:**
- Consumes: `launchpad/Dockerfile` as the Dockerfile template (python:3.11-slim + uv, both `apexflow/pyproject.toml:36-37` and `familyhub/pyproject.toml:37-38` already build `backend/app` wheels); `papermite/fly.toml` for apexflow's dual shape (public `[http_service]` + internal `[[services]]` flycast TCP, because familyhub and admindash call apexflow server-to-server); `launchpad/fly.toml` for familyhub's simple shape; `deploy-admindash-api` job (`deploy.yml:263`) as the job template.
- Produces: release tags `apexflow-v*` and `familyhub-v*` dispatch Fly deploys gated by the `production` environment; GitHub secrets `FLY_API_TOKEN_APEXFLOW` / `FLY_API_TOKEN_FAMILYHUB` (created in the live phase, Task L3).

- [ ] **Step 1: Dockerfiles.** Copy `launchpad/Dockerfile`, adjust module dir and port (apexflow 5910, familyhub 5630). Keep the non-root user, `uv sync --frozen --no-dev`, and CMD shape (`uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port <port>`).

- [ ] **Step 2: fly.tomls.** apexflow (papermite dual shape), with a header comment listing required secrets:

```toml
# apexflow-api — staff workflow designer/engine API.
# Secrets (flyctl secrets set -a apexflow-api):
#   ENVIRONMENT=production
#   CORS_ALLOWED_ORIGINS=https://apexflow.floatify.com
#   APEXFLOW_DATACORE_URL=http://datacore.flycast:5800
#   APEXFLOW_LINK_SECRET=<32+ chars>
#   APEXFLOW_INTERNAL_KEY=<32+ chars>
#   APEXFLOW_FAMILYHUB_BASE_URL=https://familyhub.floatify.com
#   APEXFLOW_RESEND_API_KEY=<optional>
# NEVER set TRUST_ALL_IPS here — production boot refuses it (config.py).
app = "apexflow-api"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "5910"

[http_service]
  internal_port = 5910
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/health"

# Internal flycast listener so familyhub-api/admindash-api reach us privately.
[[services]]
  protocol = "tcp"
  internal_port = 5910
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

  [[services.ports]]
    port = 5910

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```
familyhub: same minus the `[[services]]` block, `app = "familyhub-api"`, port 5630, check path `/api/health`, secrets header naming `FAMILYHUB_DATACORE_URL`, `FAMILYHUB_APEXFLOW_URL=http://apexflow-api.flycast:5910`, `FAMILYHUB_APEXFLOW_INTERNAL_KEY` (must equal apexflow's `APEXFLOW_INTERNAL_KEY`), `CORS_ALLOWED_ORIGINS`. Verify the exact settings field names against each service's `config.py` (env prefix `APEXFLOW_`/`FAMILYHUB_` + field name) before writing the comments — the comment block is the deploy runbook and must be exact.

- [ ] **Step 3: deploy.yml.** Add `apexflow` and `familyhub` to the workflow_dispatch choice list (`:12-16`) and the tag regex (`:49`): `^(datacore|launchpad|papermite|admindash|apexflow|familyhub)-v(.+)$`. Add `deploy-apexflow-api` and `deploy-familyhub-api` jobs copied from `deploy-admindash-api` (`:263-302`): same `production` environment gate, `flyctl deploy --config <module>/fly.toml --dockerfile <module>/Dockerfile` idiom (match the existing job's exact steps), secrets `FLY_API_TOKEN_APEXFLOW` / `FLY_API_TOKEN_FAMILYHUB`. NO frontend jobs for these modules in this wave (backends only, per the wave goal; frontends parked in the exit-gate rulings).

- [ ] **Step 4: suite-manifest + docs.** Add both modules to `deploy/suite-manifest.json` with `"version": null` (never deployed — match the file's existing schema exactly; read it first). In `docs/deployment/architecture.md` add the two apps to the topology (apexflow-api public+flycast behind Cloudflare, familyhub-api public behind Cloudflare, datacore unchanged private); in `release-runbook.md` add the two tag prefixes to the examples list.

- [ ] **Step 5: Validate.** `python3 -c "import tomllib; tomllib.load(open('apexflow/fly.toml','rb')); tomllib.load(open('familyhub/fly.toml','rb'))"`; YAML-check deploy.yml (`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"`); `python3 -m json.tool deploy/suite-manifest.json >/dev/null`; `docker build` is NOT required locally (no docker daemon assumption) — Dockerfile correctness is proven at first deploy (Task L3).

- [ ] **Step 6: Commit.** `git commit -m "feat(deploy): Fly + deploy.yml entries for apexflow-api and familyhub-api"`

---

## Live-verification phase (coordinator-run — NOT subagent tasks)

These are executed by the session coordinator after Tasks 1–10 merge to the wave branch, because they need claude-in-chrome, real credentials, and the seeded local data. Each leg's evidence (commands + output) is captured in the ledger.

### Task L1: R2 provisioning + credentials

- [ ] Create a Cloudflare R2 bucket (`neoapex-documents` or similar) and an R2 API token scoped to it. Preferred path: claude-in-chrome against `dash.cloudflare.com` in the user's logged-in Chrome (this is the wave's stated requirement — real credentials). If the dashboard session is unavailable, STOP this leg and surface to the user with exactly what's needed (bucket + token with Object Read & Write) — do not fake it with MinIO/localstack; the goal says real.
- [ ] Append the five `export DATACORE_R2_*` lines to `~/.zshrc` (values from the token; endpoint `https://<account_id>.r2.cloudflarestorage.com`). `start-services.sh` slurps `^export ` lines from there (`start-services.sh:12-18`).
- [ ] Restart DataCore (the boto3 client is `lru_cache`d — creds are read on first presign, cached for process lifetime).
- [ ] Smoke: presign + PUT + GET a 1-byte object via a direct `POST http://localhost:5800/api/documents/acme` + `curl -T` + download-url fetch. This proves the creds before involving the full stack.

### Task L2: Live documents-seam verification (the three-box checklist + wave lines)

Preconditions: services up via `./start-services.sh`; reseed ONLY with `--models-only` if the template needs repair. Get an instance to state `approved` on the staff channel (documents step only materializes there): login `jane@acme.edu`/`admin123` → staff entry → complete → submit → approve.

- [ ] **Staff upload E2E** (browser, AdminDash 5600): upload a PDF against the Immunization Record item → presign via `POST /api/workflows/acme/documents` → PUT to R2 → `complete_item` with `payload_ref` → item lands `submitted` with `payload_ref` stored (verify via `POST http://localhost:5800/api/query` on `workflow_item`; dedupe discipline: filter `_status='active'`).
- [ ] **uploaded_by staff**: the document row's `uploaded_by` equals jane's `user_id` (`u-001`) — DataCore query.
- [ ] **Family upload E2E** (browser, FamilyHub 5620): family-start a SECOND instance (`/w/acme/enrollment`), advance it to `approved` via staff channel, then upload via the token route → item `submitted`, `payload_ref` stored, `uploaded_by = family:{instance_entity_id}`, `sensitive = true` on the row (server-derived, Immunization Record).
- [ ] **Sensitive doc hidden from family**: on the family instance, STAFF uploads the Immunization Record (sensitive) → `GET /api/instance/{token}/documents` does NOT list it and its `document_id` via the token url route 403s. A staff ad-hoc upload with NO `item_id` (sensitive derives False) on the same instance IS listed and downloadable via the token route. (No template changes — the non-sensitive case uses an ad-hoc upload deliberately.)
- [ ] **Cross-instance 404**: fetch instance A's `document_id` through instance B's token url route → 404.
- [ ] **Documents-LIST facade live**: the family runtime's "already uploaded" sublist shows the real uploaded row(s) (Task 2's wiring) — screenshot into the ledger evidence.
- [ ] **Drawer download link**: staff drawer document download via the url proxy opens the R2 object.

### Task L3: Deploy-posture live proofs

- [ ] **Failed-boot demos (both services)**: `cd apexflow/backend && APEXFLOW_ENVIRONMENT=production APEXFLOW_CORS_ALLOWED_ORIGINS=https://x.example uv run uvicorn app.main:app --port 5911` → process refuses to start (dev-default secrets); same with a 20-char secret; same with `TRUST_ALL_IPS=1` and otherwise-valid secrets. Mirror for familyhub (`FAMILYHUB_*`, port 5631). Capture the tracebacks.
- [ ] **TRUST_ALL_IPS provably absent from prod**: `grep -ri TRUST_ALL_IPS */fly.toml .github/workflows/` → only comments/refusals; `fly secrets list -a datacore|launchpad-api|papermite-api|admindash-api` → no TRUST_ALL_IPS row; plus the new validators refuse it structurally (Task 7).
- [ ] **Referrer-Policy live**: `curl -sI localhost:5910/health` and `curl -sI localhost:5630/api/health` both show `referrer-policy: no-referrer`.
- [ ] **Log scrub live**: hit `GET /api/instance/{real-token}` on familyhub, then `grep instance .logs/familyhub-backend.log | tail` shows `[token]`, not the token; same for an apexflow `/internal/instance-by-token/` line in `.logs/apexflow-backend.log`.
- [ ] **Fly apps + first deploy**: `fly apps create apexflow-api && fly apps create familyhub-api`; set secrets per the fly.toml headers (generate 48-char random secrets; `FAMILYHUB_APEXFLOW_INTERNAL_KEY` = apexflow's `APEXFLOW_INTERNAL_KEY`); `fly tokens create deploy -a <app>` → `gh secret set FLY_API_TOKEN_APEXFLOW` / `..._FAMILYHUB`; deploy via `flyctl deploy` locally for the first bring-up (the release-tag path is for subsequent releases); verify `/health` (apexflow) and `/api/health` (familyhub) respond 200 from a Cloudflare-fronted hostname and 403 direct-to-Fly (allowlist active). Cloudflare DNS (`api.apexflow.floatify.com`, `api.familyhub.floatify.com` CNAME → Fly, proxied, + `fly certs add`): attempt via claude-in-chrome on the Cloudflare dashboard; if unavailable, park with a written ruling naming the two DNS records needed.

### Task L4: Exit gate

- [ ] All suites at new baselines, recorded: datacore, apexflow, familyhub, admindash backends; admindash vitest; `npm run build && npm run lint` for admindash/apexflow/familyhub frontends + workflow-forms build.
- [ ] Re-run of the affected browser-gate legs = Task L2's two channel upload flows (that IS the re-run, for real this time).
- [ ] Update `docs/superpowers/plans/2026-08-06-apexflow-plan3-followups.md`: mark items 1, 2 (all three boxes), 3, 4, 5, 11, and 10b's first two bullets CLOSED with commit hashes; note where each live proof lives. Add the closed items' canonical deploy entries to `docs/deployment/follow-ups.md` where they were missing.
- [ ] Record the wave's parked rulings (in the follow-ups doc, new section):
  1. Staff `get_document_url` is tenant-scoped, not instance-scoped (`documents.py:132-141`) — deliberate for staff (any staff member may service any instance in their tenant); asymmetry with the family rule documented, not changed.
  2. Staff `create_document` doesn't validate `instance_id`/`item_id` membership (acknowledged in its docstring) — parked; staff is trusted within tenant; revisit if staff roles narrow.
  3. `derived_document_sensitive` fails open to `False` on unresolvable items (`shared.py:132-144`) — parked with note: combined with the item_id guard (Task 3) the family path can no longer hit it with a foreign id; the staff no-item_id path remains fail-open by design (ad-hoc uploads).
  4. `put_model` retains archive-then-insert (`store.py:197-205`) — same window as put_entity, far lower concurrency exposure (model edits are rare admin ops); park.
  5. apexflow/familyhub FRONTEND deploys (Workers, `_headers`, wrangler) — out of wave scope (goal names backends only).
  6. RegisterPage still RENDERS from the published bundle while converting against pinned steps — rendering drift on republish is a UX question for a future plan.
- [ ] Final commit of docs + ledger cleanup.

---

## Self-Review notes

- Every goal line maps to a task: staff/family live uploads + payload_ref (L1/L2), sensitive/cross-instance/list live (L2), LIST facade + real rows (1, 2, L2), uploaded_by live (L2), TRUST_ALL_IPS/Fly/deploy.yml/validators/failed-boot (7, 8, 10, L3), Referrer-Policy + scrubbed logs (9, L3), admindash async + two test shapes (5), put_entity decided+tested (6), pinned-steps republish test (4), item_id guard (3), exit gate (L4).
- Task 3 note about test `:589` is a genuine interaction — the implementer instruction says preserve the derivation test's intent without weakening the guard.
- Type consistency: `listDocuments` (Task 2) consumes Task 1's route; Task L2 exercises both. `DEV_INTERNAL_KEY` constant name used consistently in Task 7 for familyhub (apexflow already has its own constants).
