# ApexFlow Plan 3 — Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AdminDash gains generic workflow tracking (definitions list, per-definition pipeline with columns from the pinned machine's states, instance detail with items/activity/documents/allowed actions) and staff-assisted entry; FamilyHub's parent runtime generalizes from registration-era blocks to workflow instances rendered by flow-runtime's StepRenderer — closing the Plan 1/2 follow-ups assigned to this phase (blocks-compiler gap, deprecated-lineage friendly page, PARENT_ACTIONS derivation, validate-422 hijack, lost-update CAS precondition).

**Architecture:** admindash-backend adds thin proxies to apexflow-backend following its existing papermite-proxy pattern (plain `def` + sync httpx, threadpooled by FastAPI); tracking reads go through the existing generic `/api/query` proxy with `_status = 'active'` scoping. apexflow-backend grows a minimal allowed-actions read surface (promoting the private `_allowed_actions` the 409 path already uses), enriches the internal config bundle with models + lineage_status, derives token-upload sensitivity server-side, and adopts a DataCore compare-and-swap precondition (`expected_version`) on instance/item writes. flow-runtime's StepRenderer widens from `mode: 'preview'` to `'preview' | 'family' | 'staff'` with optional items/callback props; FamilyHub's facade reshapes the apexflow config/instance bundles instead of shipping `blocks: []`, and the registration-era block renderer is retired once nothing consumes it.

**Tech Stack:** FastAPI + Uvicorn + pydantic_settings (backends), React 19 + TypeScript + Vite, native Fetch, LanceDB via DataCore only, pytest + respx (admindash) / monkeypatched-seam fakes (apexflow, familyhub), no frontend test framework beyond vitest-node for pure utils (admindash) — verification is build+lint + backend contract tests + a coordinator-run browser gate.

## Global Constraints

- **Interface map governs.** Task 0 regenerates the interface map FROM SOURCE (`docs/superpowers/plans/2026-08-06-apexflow-plan3-interface-map.md`). Where this plan's code conflicts with the map, the map wins; implementers mark such fixes `# ADJUST(bindings)` in code review notes, as in Plans 1–2.
- **Identifier convention (spec §3, verbatim):** wherever an API payload, token, or filter says `instance_id`, it means the DataCore **entity_id**, not the WI-prefixed display id. `workflow_item.instance_id` and `workflow_activity.instance_id` hold the parent instance's entity_id (`apexflow/backend/app/workflows/engine.py:12-16`).
- **Ports (services.json, verify at Task 0):** admindash 5600/5610, familyhub 5620/5630, datacore 5800, apexflow 5900/5910. No hard-coded port/URL literal may be written without citing `services.json`/config source file:line in the interface map's config-facts table (Plan 1 follow-up item 24 discipline).
- **All raw SQL reads against DataCore's `data` table MUST filter `_status = 'active'`** — DataCore archives the prior version on every write (`datacore/src/datacore/store.py:344-355`), so `_status='active'` is the latest-only filter; without it every historical `_version` row comes back (Plan 2 follow-up item 17).
- **No fourth copy of the SQL shape guard.** admindash reads reuse its existing `/api/query` proxy; no new query surface is added anywhere.
- **admindash proxy routes are plain `def`, never `async def` with sync httpx** — the open item-15 event-loop debt (`admindash/backend/app/api/entities.py:11-37`) must not grow. New routes follow `admindash/backend/app/api/extract.py:63-79` / `leads.py`'s shape.
- **admindash routes needing tenant scoping use `require_tenant_match` (`admindash/backend/app/tenancy.py:290`)**, which binds the `{tenant_id}` path param — every new proxy route is shaped `/api/workflows/{tenant_id}/...`.
- **i18n: every new UI string lands in BOTH `en-US` and `zh-CN`** — admindash's `src/i18n/__tests__/translations.test.ts` fails on key-set drift; familyhub/apexflow follow the same two-locale convention.
- **flow-runtime stays raw-TS** (`main`/`types` → `src/index.ts`, no build step); any package.json change must preserve `file:` resolution for familyhub, apexflow, and (new) admindash.
- **familyhub keeps its no-staff-surface property:** token always a URL path segment on the facade, no JWT anywhere, 4xx relayed verbatim / ≥500 masked (`familyhub/backend/app/relay.py:25-48`), anti-enumeration request-link.
- **TDD throughout:** every behavioral change starts with a failing test; frontends without a test framework verify via `npm run build` + `npm run lint` (+ `npx tsc --noEmit` for flow-runtime) plus the Task 15 browser gate.
- **Commits:** one per task minimum, `feat(scope):`/`fix(scope):`/`refactor(scope):` conventional style as in Plans 1–2.
- **Branch:** `feat/apexflow-plan3-channels` off `docs/registration-flow-design`; merged back with `--no-ff` at Task 16.

---

### Task 0: Interface map regeneration (from source, with config-facts table)

**Files:**
- Create: `docs/superpowers/plans/2026-08-06-apexflow-plan3-interface-map.md`

**Interfaces:**
- Consumes: the repo on disk (never cached descriptions), `docs/superpowers/plans/2026-08-06-apexflow-plan2-interface-map.md` as a structural template only.
- Produces: the authoritative binding map every later task cites. Sections required below.

- [ ] **Step 1: Write the map with these sections, every signature copied verbatim with file:line:**

1. **apexflow-backend surface** — all routes in `api/{designer,definitions,instances,documents,internal,entities,query,auth_proxy}.py` (method/path/handler/auth/request model/response keys); `machine.py`'s `_allowed_actions` (`:331`), `execute_action` (`:511`), `build_eval_context` (`:226`), `run_system_transitions` (`:450`), the two 409 raise sites (`:431`, `:443`) and wire shape `{"detail": {"allowed": [...]}}`; `engine.py` signatures (`create_instance:159`, `save_draft:276`, `complete_item:435`, `verify_item:497`, `reject_item:514`, `waive_item:524`, `_update_item:369`, `_write_state` in machine.py:294); `internal.py`'s route table, `workflow_config` (`:273-290`), `_capacity_summary` (`:249-270`), `_require_family_channel_definition` (`:162-175`), `BLOCKED_TOKEN_ACTIONS` (`:90`); `definitions.py` service helpers `fetch_models`/`referenced_entity_models` (`app/workflows/definitions.py:53,:67`) and `parse_machine_steps` (`:46-47`).
2. **DataCore write/version surface** — `store.put_entity` (`store.py:307-386`) with the archive-then-insert flow and `_get_max_version` (`:150`); route `update_entity` (`api/routes.py:294-308`); confirm flattened `/api/query` rows carry `_version`/`_status` and that `_status='active'` is latest-only; DataCore test-suite fixture pattern for store-level tests (name the file/fixtures used by existing `put_entity` tests).
3. **apexflow DataCore client** — `workflows/datacore.py`: `dc_update` (`:92-110`), `list_entities`, `get_entity`, `dc_query`; `tests/fakes.py`'s `FakeDataCore` (`dc_update` signature, `_store_row` stringification, `install_fake_datacore:218-224`).
4. **flow-runtime** — `StepRenderer.tsx` props (`:477-492`), the exact **draft key scheme** SectionRenderer reads/writes (verbatim code: how a field value is keyed in `WorkflowDraft`, incl. repeat sections) and how that maps (or fails to map) onto `engine.save_draft`'s `section_answers` shape (`engine.py:276-355`: dict per section_id, list for repeat sections); `evaluateCondition` (`:139`); `index.ts` exports; the `available_in` caller-side-filter contract (`:509-514`) and PreviewPane's filter precedent (`apexflow/frontend/src/editor/PreviewPane.tsx:101-104`, empty = NO state).
5. **familyhub backend** — full route table, `upstream.py` seam, `relay.py` conventions, `ratelimit` decorators, `PARENT_ACTIONS` (`api/application.py:54`) and guard (`:75-86`), `_config_bundle_from_apexflow` (`api/registration.py:47-61`), `_application_view_from_instance` (`:115-126`), `_school_year_for_date` (`:102-112`), test fixture pattern (`FakeHTTP` copies, autouse fixtures).
6. **familyhub frontend** — `facade.ts` exports + `RawHubBundle`/`RawConfigBundle` mismatch note, `types/registration.ts`, page structure (RegisterPage phases `:38`, HubPage OUTSTANDING/TERMINAL `:62-63`), i18n key namespaces.
7. **admindash backend** — `Settings` (config.py:8-56), papermite proxy shapes (`extract.py:18-79`), `require_tenant_match` (tenancy.py:290), `assert_query_tenant_match`/`assert_sql_is_safe_read` (`:299,:311`), main.py mounts (`:34-42`), respx test pattern (`test_extract.py`, `test_entities.py`, `test_leads.py` responder), the open sync-httpx-in-async items (entities.py:18, query.py:34) — confirm current status on the branch.
8. **admindash frontend** — Navbar `navItems` (`Navbar.tsx:81-87`) + `icons` map (`:18-46`), App.tsx route table, `client.ts` exports (`postQuery:24-36`), LeadPage board (`stages:40`, `byStage:68`, `renderColumn:87-98`, `stageTone` in `utils/tone.ts:96-102`), LeadDetailDrawer structure, DataTable/Modal/Button/StatusBadge/ViewChips props, `useTablePreferences` key builder, vitest config limits (node env, `.test.ts` only), translations guard test.
9. **Configuration-facts table** (MANDATORY — Plan 1 item 24 / Plan 2 item 18 discipline): every port, URL, env var, localStorage/sessionStorage key, and services.json entry ANY task below touches, each with file:line verified on disk: services.json entries for all six services; `ADMINDASH_` env prefix + `datacore_url`/`papermite_backend_url` defaults; `APEXFLOW_` prefix + `datacore_url`/`familyhub_base_url`/`link_secret`/`internal_key` defaults + `MIN_SECRET_LENGTH`; `FAMILYHUB_` prefix + `apexflow_url`/`apexflow_internal_key` defaults; frontend `VITE_*` overrides; `neoapex_token` / `preferredLanguage` / `admindash_table_prefs_*` keys; `start-services.sh` port vars.
10. **Cross-cutting notes** — anything discovered that contradicts this plan's task text (list explicitly, so implementers apply `# ADJUST(bindings)`).

- [ ] **Step 2: Independently re-verify the config-facts table** (re-read each cited file:line fresh; do not trust the first pass).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-06-apexflow-plan3-interface-map.md
git commit -m "docs(apexflow): Plan 3 interface map — channels bindings + config-facts table"
```

---

### Task 1: DataCore `expected_version` compare-and-swap precondition

**Files:**
- Modify: `datacore/src/datacore/store.py` (put_entity, ~:307)
- Modify: `datacore/src/datacore/api/routes.py` (update_entity, ~:294)
- Test: `datacore/tests/test_store.py` (or the existing put_entity test module the map names — `# ADJUST(bindings)`)
- Test: `datacore/tests/test_entities_api.py` (or equivalent route-test module — `# ADJUST(bindings)`)

**Interfaces:**
- Consumes: `store.put_entity(tenant_id, entity_type, entity_id, base_data, custom_fields=None, change_id=None)` (`store.py:307-315`), `_get_max_version(table, where)` (`:150-154`), route `update_entity` (`routes.py:294-308`) catching `ValueError → 400`.
- Produces: `class VersionConflictError(Exception)` with `.expected: int` and `.actual: int` attributes (module-level in `store.py`); `put_entity(..., expected_version: int | None = None)`; route `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}?expected_version=N` returning **409** `{"detail": {"error": "version_conflict", "expected": N, "actual": M}}` on mismatch. `expected_version=None` (absent) keeps today's last-write-wins behavior exactly — the param is strictly opt-in.

- [ ] **Step 1: Write the failing store-level tests**

```python
def test_put_entity_with_matching_expected_version_succeeds(store_fixture):
    store = store_fixture
    store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                     base_data={"first_name": "A"})  # version 1
    result = store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                              base_data={"first_name": "B"}, expected_version=1)
    assert result["_version"] == 2


def test_put_entity_with_stale_expected_version_raises_conflict(store_fixture):
    store = store_fixture
    store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                     base_data={"first_name": "A"})  # version 1
    store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                     base_data={"first_name": "B"})  # version 2
    with pytest.raises(VersionConflictError) as exc:
        store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                         base_data={"first_name": "C"}, expected_version=1)
    assert exc.value.expected == 1
    assert exc.value.actual == 2
    # And the losing write must not have landed:
    row = store.get_active_entity("t1", "student", "e1")
    assert row["base_data"]["first_name"] == "B"


def test_put_entity_without_expected_version_keeps_last_write_wins(store_fixture):
    store = store_fixture
    store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                     base_data={"first_name": "A"})
    result = store.put_entity(tenant_id="t1", entity_type="student", entity_id="e1",
                              base_data={"first_name": "C"})  # no precondition
    assert result["_version"] == 2
```

Adapt the fixture name to the module's existing store fixture (`# ADJUST(bindings)` per map §2). Note: `expected_version=1` against a brand-new entity (current max 0) must also conflict — add `test_put_entity_expected_version_on_missing_entity_conflicts` asserting `actual == 0`.

- [ ] **Step 2: Run tests to verify they fail** — `cd datacore && uv run python -m pytest tests/<module> -k expected_version -v` → FAIL (`VersionConflictError` undefined / unexpected keyword).

- [ ] **Step 3: Implement in `store.py`**

```python
class VersionConflictError(Exception):
    """expected_version precondition failed on put_entity."""
    def __init__(self, expected: int, actual: int):
        self.expected = expected
        self.actual = actual
        super().__init__(f"version conflict: expected {expected}, found {actual}")
```

In `put_entity`, add the keyword-only param `expected_version: int | None = None` and, immediately after `current_version = self._get_max_version(table, where)` (`store.py:341`):

```python
        if expected_version is not None and current_version != expected_version:
            raise VersionConflictError(expected_version, current_version)
```

(The check sits BEFORE the archive/delete block at `:344-355`, so a conflicting write mutates nothing.)

- [ ] **Step 4: Run store tests** → PASS.

- [ ] **Step 5: Write the failing route test** (respx-free — datacore route tests use its own TestClient pattern per map §2):

```python
def test_update_entity_stale_expected_version_returns_409(client, seeded_entity):
    # seeded_entity is at _version 2 after one update
    resp = client.put(
        "/api/entities/t1/student/e1?expected_version=1",
        json={"base_data": {"first_name": "C"}},
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail == {"error": "version_conflict", "expected": 1, "actual": 2}
```

- [ ] **Step 6: Implement the route change** in `routes.py`:

```python
    @app.put("/api/entities/{tenant_id}/{entity_type}/{entity_id}")
    def update_entity(
        tenant_id: str, entity_type: str, entity_id: str, body: CreateEntityRequest,
        expected_version: int | None = Query(None),
    ):
        try:
            result = store.put_entity(
                tenant_id=tenant_id, entity_type=entity_type, entity_id=entity_id,
                base_data=dict(body.base_data), custom_fields=body.custom_fields,
                expected_version=expected_version,
            )
        except VersionConflictError as e:
            raise HTTPException(status_code=409, detail={
                "error": "version_conflict", "expected": e.expected, "actual": e.actual,
            })
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return result
```

(Import `Query` from fastapi and `VersionConflictError` from the store module; match the file's existing import style.)

- [ ] **Step 7: Run the full datacore suite** — `cd datacore && uv run python -m pytest tests/ -v` → all pass (346 baseline + new).

- [ ] **Step 8: Commit**

```bash
git add datacore/src/datacore/store.py datacore/src/datacore/api/routes.py datacore/tests/
git commit -m "feat(datacore): opt-in expected_version CAS precondition on entity update (409 version_conflict)"
```

---

### Task 2: apexflow adopts the CAS precondition on instance/item writes

**Files:**
- Modify: `apexflow/backend/app/workflows/datacore.py` (dc_update, ~:92)
- Modify: `apexflow/backend/app/workflows/engine.py` (`_update_item` ~:369, `save_draft` ~:276)
- Modify: `apexflow/backend/app/workflows/machine.py` (`_write_state` ~:294)
- Modify: `apexflow/backend/tests/fakes.py` (FakeDataCore version emulation)
- Test: `apexflow/backend/tests/test_concurrency.py` (new)

**Interfaces:**
- Consumes: Task 1's `?expected_version=N` query param and 409 `{"detail": {"error": "version_conflict", ...}}`; flattened rows carrying `_version` (string-typed after DataCore flattening — coerce with `int(...)`).
- Produces: `dc_update(tenant_id, entity_type, entity_id, base_data, token=None, custom_fields=None, expected_version: int | None = None)`; a module-level helper in `engine.py`:

```python
def row_version(row: dict) -> int | None:
    """The _version a previously-read flattened row carries, or None.

    DataCore flattens all scalars to strings; tolerate int or str."""
    raw = row.get("_version")
    try:
        return int(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None
```

Every write that round-trips a previously-read `workflow_instance` or `workflow_item` row passes `expected_version=row_version(row)`; a 409 from DataCore propagates as `HTTPException(409, {"error": "conflict", "entity_type": ..., "entity_id": ...})` so both channels surface "changed elsewhere — reload".

- [ ] **Step 1: Extend `FakeDataCore` to emulate versioning.** In `tests/fakes.py`: store an integer `_version` per row starting at 1, bump on every `dc_update`; `dc_update` gains `expected_version: int | None = None` and raises `HTTPException(409, {"error": "version_conflict", "expected": expected_version, "actual": current})` on mismatch. Include `_version` (as **string**, matching `_store_row` stringification) in flattened reads. `# ADJUST(bindings)`: match the map's exact `_store_row`/`dc_update` shapes.

- [ ] **Step 2: Write failing tests** in `tests/test_concurrency.py`:

```python
def test_dc_update_passes_expected_version_as_query_param(monkeypatch):
    """Unit: the real dc_update appends ?expected_version=N."""
    captured = {}
    def fake_request(method, url, **kwargs):
        captured["url"] = url
        class R: status_code = 200
        R.json = staticmethod(lambda: {})
        return R()
    monkeypatch.setattr("app.workflows.datacore.httpx.request", fake_request)
    from app.workflows import datacore as dc
    dc.dc_update("t1", "workflow_instance", "e1", {"state": "draft"}, expected_version=4)
    assert "expected_version=4" in captured["url"]


def test_state_write_conflict_propagates_409(fake_dc, client_with_staff):
    """A stale instance row loses the race: execute_action surfaces 409 conflict."""
    # Arrange: seed a published definition + instance via the standard helpers
    # (# ADJUST(bindings): reuse test_machine.py's seeding helpers per map §1),
    # then bump the instance row behind the engine's back to simulate the race:
    fake_dc.force_bump_version("t1", "workflow_instance", instance_eid)
    resp = client_with_staff.post(
        f"/api/workflows/t1/instances/{instance_eid}/actions",
        json={"action": "submit"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "conflict"


def test_item_write_conflict_propagates_409(fake_dc, client_with_staff):
    # same shape via complete_item with a force-bumped workflow_item row
    ...
```

Add `FakeDataCore.force_bump_version(tenant, entity_type, entity_id)` as a test-only helper. Concrete seeding/assert details follow `tests/test_actions_api.py`'s existing arrange sections (`# ADJUST(bindings)`).

- [ ] **Step 3: Run to verify failure** — `cd apexflow/backend && uv run python -m pytest tests/test_concurrency.py -v` → FAIL.

- [ ] **Step 4: Implement.**

`datacore.py` — extend `dc_update`:

```python
def dc_update(tenant_id: str, entity_type: str, entity_id: str, base_data: dict,
              token: str | None = None, custom_fields: dict | None = None,
              expected_version: int | None = None) -> dict:
    ...
    path = f"/api/entities/{tenant_id}/{entity_type}/{entity_id}"
    if expected_version is not None:
        path += f"?expected_version={int(expected_version)}"
    resp = _request("PUT", path, token,
                    {"base_data": base_data, "custom_fields": custom_fields or {}})
    if resp.status_code == 409:
        raise HTTPException(409, {"error": "conflict",
                                  "entity_type": entity_type, "entity_id": entity_id})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, f"DataCore update failed: {resp.text}")
    return resp.json()
```

`engine.py` — add `row_version` (above); pass `expected_version=row_version(item_row)` in `_update_item`'s `dc.dc_update` call (`engine.py:372`) and `expected_version=row_version(instance_row)` in `save_draft`'s instance write. `machine.py` — `_write_state` (`:294`) passes `expected_version=row_version(ctx.instance)`. Any other `dc.dc_update` on `workflow_instance`/`workflow_item` rows found during implementation (`primitives.py`'s `set_entity_field` with `ref == "instance"`, `start_due_clocks`'s item write at `primitives.py:554-574`, `cancel_instance`'s write) gets the same treatment — grep `dc_update` across `app/workflows/` and cover each site; entity-model commits (`commit_sections` creating students/families) are NOT preconditioned (they create, not round-trip).

**Intra-transition sequencing hazard (must be handled, and tested):** a transition's effects may themselves write the instance row (`set_context`, `set_entity_field` with `ref == "instance"`) BEFORE `_write_state` runs. Each instance-row write bumps `_version`, so every subsequent preconditioned write inside the same action must use the REFRESHED row's version, not the stale `ctx.instance` from action start — i.e., any helper that writes the instance row must re-assign `ctx.instance` to the write's result (or re-fetch) before the next write. Add a dedicated test: a transition whose effects include `set_context` followed by the state write must succeed (no false 409 from the engine's own sequential writes).

- [ ] **Step 5: Run the new tests** → PASS. **Step 6: Full apexflow suite** — `uv run python -m pytest tests/ -v` → 462 baseline + new all green (fakes change must not break existing tests — `_version` is additive).

- [ ] **Step 7: Commit**

```bash
git add apexflow/backend datacore  # (datacore only if bindings fixes were needed)
git commit -m "feat(apexflow): CAS expected_version on instance/item writes — 409 conflict instead of lost update"
```

---

### Task 3: apexflow allowed-actions surface (staff GET + token-bundle field)

**Files:**
- Modify: `apexflow/backend/app/workflows/machine.py` (promote `_allowed_actions` → `allowed_actions`, ~:331, call sites :431, :443)
- Modify: `apexflow/backend/app/api/instances.py` (new GET route)
- Modify: `apexflow/backend/app/api/internal.py` (`instance_by_token` ~:314-327)
- Test: `apexflow/backend/tests/test_actions_api.py`, `apexflow/backend/tests/test_internal_api.py`

**Interfaces:**
- Consumes: `machine.build_eval_context(tenant_id, instance_row, *, actor, token=None, now=None)` (`machine.py:226`); `_allowed_actions(ctx) -> list[str]` (`:331`) — guard-passing non-system transitions for the actor in declaration order, then item built-ins (`_ITEM_BUILTINS_ALL` staff / `_ITEM_BUILTINS_FAMILY` family), `[]` in terminal states.
- Produces:
  - `machine.allowed_actions(ctx: EvalContext) -> list[str]` (public; the two 409 sites and all tests reference the new name — keep NO alias).
  - `GET /api/workflows/{tenant_id}/instances/{instance_entity_id}/allowed-actions` (staff, `require_staff_tenant`) → `200 {"state": <str>, "allowed": [<str>, ...]}` — the same list the 409 advertises, actor = the calling staff user. 404 if instance not found.
  - `GET /internal/instance-by-token/{token}` response gains `"allowed": [<str>, ...]` (family-actor list; unchanged keys otherwise).

- [ ] **Step 1: Failing tests.**

In `test_actions_api.py` (reuse its existing seeding — a published enrollment-style definition + instance):

```python
def test_allowed_actions_route_matches_409_advertisement(client_staff, seeded_instance):
    eid = seeded_instance["entity_id"]
    ok = client_staff.get(f"/api/workflows/{TENANT}/instances/{eid}/allowed-actions")
    assert ok.status_code == 200
    body = ok.json()
    assert body["state"] == "draft"
    bogus = client_staff.post(f"/api/workflows/{TENANT}/instances/{eid}/actions",
                              json={"action": "definitely_not_an_action"})
    assert bogus.status_code == 409
    assert bogus.json()["detail"]["allowed"] == body["allowed"]


def test_allowed_actions_route_404_on_unknown_instance(client_staff):
    resp = client_staff.get(f"/api/workflows/{TENANT}/instances/nope/allowed-actions")
    assert resp.status_code == 404
```

In `test_internal_api.py`:

```python
def test_instance_by_token_includes_family_allowed_actions(client, token_fixture):
    resp = client.get(f"/internal/instance-by-token/{token_fixture}",
                      headers=INTERNAL_HEADERS)
    assert resp.status_code == 200
    allowed = resp.json()["allowed"]
    assert "save_draft" in allowed and "complete_item" in allowed
    assert "verify_item" not in allowed  # staff-only built-ins never appear for family
```

(`# ADJUST(bindings)`: fixture/constant names per the map's test-pattern section.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Rename `_allowed_actions` → `allowed_actions` in `machine.py` (update `:431`, `:443`, and any test referencing the underscore name). New route in `instances.py` (placed BEFORE any conflicting catch-all; mirrors `instance_action_route`'s arrange):

```python
@router.get("/{tenant_id}/instances/{instance_entity_id}/allowed-actions")
def allowed_actions_route(tenant_id: str, instance_entity_id: str,
                          user: dict = Depends(require_staff_tenant)):
    token = user.get("_token")
    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_entity_id, token)
    if instance_row is None:
        raise HTTPException(404, "workflow_instance not found")
    ctx = machine.build_eval_context(tenant_id, instance_row,
                                     actor=user.get("user_id", "staff"), token=token)
    return {"state": ctx.instance.get("state"), "allowed": machine.allowed_actions(ctx)}
```

In `internal.py`'s `instance_by_token`, add `"allowed": machine.allowed_actions(ctx)` to the returned dict (the family actor is already on `ctx`).

**Additional scope (Task 0 finding — payload_ref has NO write path):** `engine.complete_item` 409s documents-kind items whose `payload_ref` is empty (`{"reason": "payload_ref_missing"}`), but nothing in production ever writes `payload_ref` to an item — document-item completion is unreachable through either channel. Fix here: `machine._run_item_builtin` threads `params.get("payload_ref")` through to `engine.complete_item(..., payload_ref=...)`; for documents-kind items, `complete_item` validates the supplied `payload_ref` references a `document` row of THIS instance (`application_id == instance entity_id` — spec §4's "payload_ref must reference a document uploaded to this instance"; 409 `{"reason": "payload_ref_invalid"}` otherwise) and writes it onto the item together with the status change. Non-documents kinds ignore the param. TDD: failing test first — complete a documents item with a valid uploaded document's id → status submitted + payload_ref stored; with a document id belonging to a DIFFERENT instance → 409; with none → existing 409 unchanged.

- [ ] **Step 4: Run new tests → PASS. Step 5: full apexflow suite green. Step 6: Commit** — `feat(apexflow): promote allowed_actions; staff allowed-actions GET; token bundle advertises family actions`.

---

### Task 4: apexflow internal config bundle enrichment + server-derived document sensitivity

**Files:**
- Modify: `apexflow/backend/app/api/internal.py` (`workflow_config` ~:273-290; `create_document_by_token` ~:383-403; `TokenCreateDocumentRequest` ~:111)
- Test: `apexflow/backend/tests/test_internal_api.py`

**Interfaces:**
- Consumes: `defs.fetch_models` / `referenced_entity_models` (`app/workflows/definitions.py:53,:67`); pinned-steps access as `instance_by_token` already does via `ctx.definition["steps"]`; step documents config shape `config.docs: [{name, description, sensitive, blocking, ...}]` (spec §3); items carry `step_id` and, for documents kind, `title` = the doc's `name` (`engine.py:105-144`).
- Produces:
  - `GET /internal/workflows/{tenant_id}/{definition_id}/config` response gains two keys: `"models": {<entity_model>: {"base_fields": [...], "custom_fields": [...]}, ...}` (every model referenced by the published steps) and `"lineage_status": "active" | "deprecated" | "retired"`. Existing keys (`definition`, `tenant`, `capacity`) unchanged. The route continues to 404 only for missing/staff-only lineages — a deprecated/retired lineage still returns its bundle (the friendly-closed page needs it; instance creation stays 409-guarded by the engine).
  - `POST /internal/instance-by-token/{token}/documents`: the client-supplied `sensitive` field is REMOVED from `TokenCreateDocumentRequest`; the server derives it from the pinned definition — resolve the target item (`body.item_id`), its `step_id`, the step's `config.docs` entry whose `name` equals the item's `title`; use that doc's `sensitive` (default `False` when the item/step/doc can't be resolved, e.g. `item_id=None` free uploads).

- [ ] **Step 1: Failing tests.**

```python
def test_workflow_config_includes_models_and_lineage_status(client, seeded_family_definition):
    resp = client.get(f"/internal/workflows/{TENANT}/enrollment/config", headers=INTERNAL_HEADERS)
    body = resp.json()
    assert body["lineage_status"] == "active"
    assert "student" in body["models"]
    assert any(f["name"] == "first_name" for f in body["models"]["student"]["base_fields"])


def test_workflow_config_returns_bundle_for_deprecated_lineage(client, deprecated_family_definition):
    resp = client.get(f"/internal/workflows/{TENANT}/enrollment/config", headers=INTERNAL_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["lineage_status"] == "deprecated"


def test_token_document_sensitive_derived_from_definition_not_client(client, token_with_sensitive_doc_item):
    token, item_eid = token_with_sensitive_doc_item  # item bound to a sensitive doc step entry
    resp = client.post(f"/internal/instance-by-token/{token}/documents",
                       headers=INTERNAL_HEADERS,
                       json={"item_id": item_eid, "filename": "shots.pdf",
                             "content_type": "application/pdf", "size": 100,
                             "sensitive": False})  # client lies; extra key ignored
    assert resp.status_code == 201
    # the DataCore create call must have carried sensitive=True
    assert fake_documents_upstream.last_create["sensitive"] is True
```

(`# ADJUST(bindings)`: the documents upstream in internal-api tests is faked via the module's existing pattern — reuse it; the enrollment template's `documents` step has a sensitive immunization entry per `templates/enrollment.py`.)

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — in `workflow_config`, after `parse_machine_steps`:

```python
    referenced = defs.referenced_entity_models(steps)
    models = defs.fetch_models(tenant_id, referenced)   # ADJUST(bindings): exact helper name/signature per map §1
    ...
    return {
        "definition": {...unchanged...},
        "models": models,
        "lineage_status": row.get("lineage_status", "active"),
        "tenant": {...}, "capacity": ...,
    }
```

For sensitivity: drop `sensitive` from `TokenCreateDocumentRequest` (extra="ignore" already drops stray client keys); in `create_document_by_token`, resolve `sensitive` via a small helper `_derived_sensitive(ctx_or_rows, item_id) -> bool` implementing the item→step→doc lookup above, and send that value to DataCore.

- [ ] **Step 4: Run new tests → PASS. Step 5: full suite green** (existing token-upload tests asserting `sensitive: False` passthrough must be updated to the derived semantics — that change is the point). **Step 6: Commit** — `feat(apexflow): config bundle carries models+lineage_status; token uploads derive sensitivity from the pinned definition`.

---

### Task 5: flow-runtime — StepRenderer runtime generalization

**Files:**
- Modify: `flow-runtime/src/StepRenderer.tsx`
- Modify: `flow-runtime/src/types.ts` (new view types)
- Modify: `flow-runtime/src/index.ts` (export additions)
- Verify: `cd flow-runtime && npx tsc --noEmit`; `cd apexflow/frontend && npm run build` (PreviewPane must compile unchanged)

**Interfaces:**
- Consumes: existing `StepRendererProps` (`StepRenderer.tsx:477-492`), `WorkflowStepDef`/`WorkflowSectionDef` (`types.ts:198-220`), `evaluateCondition` (`:139`), the caller-side `available_in` filter contract (`:509-514` — unchanged: StepRenderer still never reads `available_in`).
- Produces (verbatim, these exact names — Tasks 7 and 12 import them):

```ts
// types.ts additions
export interface WorkflowItemView {
  entity_id: string;
  step_id: string;
  kind: 'form' | 'documents' | 'message-ack';
  title: string;
  status: string;          // not_started | in_progress | submitted | verified | rejected | waived
  blocking: boolean;
}
export interface InstanceDocumentView {
  document_id: string;
  filename: string;
  item_id?: string;
}
```

```ts
// StepRenderer.tsx — widened props (existing fields unchanged)
export type StepRendererMode = 'preview' | 'family' | 'staff';
export interface StepRendererProps {
  steps: WorkflowStepDef[];
  models: Record<string, ModelFieldSource>;
  mode: StepRendererMode;
  draft: WorkflowDraft;
  onDraftChange: (next: WorkflowDraft) => void;
  /** Runtime modes only: one item per applicable step (matched by step_id). */
  items?: WorkflowItemView[];
  /** Mark a step's item done. Host wires this to the complete_item action. */
  onCompleteItem?: (itemEntityId: string) => Promise<void>;
  /** documents steps, runtime modes: upload a file against the step's item. */
  onUploadDocument?: (itemEntityId: string, file: File) => Promise<void>;
  /** Already-uploaded documents, shown on documents steps. */
  documents?: InstanceDocumentView[];
}
```

Behavior:
- `mode === 'preview'` (or `items` undefined): rendering identical to today — zero visual/behavioral change for PreviewPane.
- Runtime modes with `items`: each rendered step looks up its item (`items.find(i => i.step_id === step.step_id)`); shows a status chip (reuse the existing `fr-` class family; map `submitted|verified|waived` → done tone); `form`/`message-ack` steps render a "Mark complete" / "Acknowledge" button calling `onCompleteItem(item.entity_id)` (disabled while pending, hidden when status is done-tier); `documents` steps render a file `<input>` per doc calling `onUploadDocument` plus the `documents` list filtered by `item_id`.
- `mode === 'staff'` differences from `'family'`: none inside StepRenderer v1 (staff-only verify/reject/waive live in the AdminDash detail drawer, not the renderer) — the mode value exists so hosts can style/extend and so the type is honest about who's mounting it.
- Export `StepRendererMode`, `WorkflowItemView`, `InstanceDocumentView` from `index.ts`.

- [ ] **Step 1:** Implement types + props + rendering as specified. Keep the `void mode;` escape removed; keep all existing preview-path code intact (guard the new UI behind `items !== undefined`).
- [ ] **Step 2:** `cd flow-runtime && npx tsc --noEmit` → clean.
- [ ] **Step 3:** `cd apexflow/frontend && npm run build && npm run lint` → clean (PreviewPane unchanged — `mode="preview"` still type-checks).
- [ ] **Step 4: Commit** — `feat(flow-runtime): StepRenderer runtime modes (family/staff) with item status + complete/upload affordances`.

---

### Task 6: familyhub facade generalization (bundle reshape, instance routes, PARENT_ACTIONS removal)

**Files:**
- Modify: `familyhub/backend/app/api/registration.py` → rename to `familyhub/backend/app/api/workflows.py`
- Modify: `familyhub/backend/app/api/application.py` → rename to `familyhub/backend/app/api/instance.py`
- Modify: `familyhub/backend/app/api/documents.py` (route prefix only)
- Modify: `familyhub/backend/app/main.py` (mounts)
- Test: `familyhub/backend/tests/test_registration_routes.py` → `test_workflow_routes.py`, `test_application_routes.py` → `test_instance_routes.py`, `test_document_routes.py`

**Interfaces:**
- Consumes: Task 3's `allowed` field and Task 4's `models`/`lineage_status` on the internal responses; `upstream.call_upstream`/`apexflow`/`apexflow_headers` (`upstream.py:15-44`); `relay`/`upstream_unavailable` (`relay.py`); rate limiters (`ratelimit.py:55-65`).
- Produces (the facade's new wire contract — Task 7 consumes exactly this):

| Method | Path | Returns |
|---|---|---|
| GET | `/api/workflows/{tenant_id}/{definition_id}` | `{definition: {definition_id, name, version, machine, steps}, models, tenant, capacity, lineage_status}` — apexflow's config bundle relayed with NO `blocks` reshaping (the `_config_bundle_from_apexflow` compiler-placeholder is deleted) |
| POST | `/api/workflows/{tenant_id}/{definition_id}/start` | `{instance, items, token, link, hub_url: "/application/{token}"}` (rate-limited; `state` no longer renamed to `status` — `_application_view_from_instance` is deleted) |
| GET | `/api/instance/{token}` | apexflow's `{instance, items, definition, allowed}` relayed verbatim |
| PUT | `/api/instance/{token}` | action dispatch — **no local allowlist**: body must be a JSON object with a string `action`; everything else is relayed to apexflow, which is the authority (its `BLOCKED_TOKEN_ACTIONS` 403 and actor checks relay back verbatim via the existing 4xx-verbatim convention) |
| POST | `/api/instance/request-link` | `{}` always (unchanged semantics) |
| POST | `/api/instance/{token}/documents` | unchanged behavior (no `sensitive` field — apexflow now derives it) |
| GET | `/api/instance/{token}/documents/{document_id}/url` | unchanged |

`PARENT_ACTIONS` and its guard are deleted (Plan 1 follow-up item 7: the hand-synced list is replaced by apexflow's authoritative actor checks). The old `/api/registration/*` and `/api/application/*` paths are gone (dev-only surface; the frontend migrates in Task 7 — same branch, no compat shims).

- [ ] **Step 1: Failing tests.** Rewrite the route tests against the new contract; the essential new cases:

```python
def test_workflow_bundle_relays_models_and_lineage_status(...):
    fake.add("GET", "/internal/workflows/acme/enrollment/config", FakeResponse(200, {
        "definition": {"definition_id": "enrollment", "name": "Enrollment", "version": 2,
                        "machine": {"states": [], "transitions": []}, "steps": []},
        "models": {"student": {"base_fields": [], "custom_fields": []}},
        "tenant": {"tenant_id": "acme", "name": "Acme"},
        "capacity": {"capacity": None, "admitted": 0, "full": False},
        "lineage_status": "deprecated",
    }))
    resp = client.get("/api/workflows/acme/enrollment")
    assert resp.status_code == 200
    body = resp.json()
    assert body["lineage_status"] == "deprecated"
    assert "blocks" not in json.dumps(body)          # the placeholder is gone
    assert body["models"]["student"] == {"base_fields": [], "custom_fields": []}


def test_instance_put_relays_any_action_and_apexflow_403s_stand(...):
    fake.add("POST", "/internal/instance-by-token/tok123/actions", FakeResponse(403, {
        "detail": "Action 'verify_item' is not permitted on the family channel"}))
    resp = client.put("/api/instance/tok123", json={"action": "verify_item"})
    assert resp.status_code == 403                    # relayed verbatim, not locally decided


def test_instance_put_still_rejects_non_string_action_locally(...):
    resp = client.put("/api/instance/tok123", json={"action": 7})
    assert resp.status_code == 400
    assert fake.calls == []                           # no upstream call for malformed input
```

Plus mechanical renames of the existing 40+ facade tests to the new paths (start/rate-limit/school-year/404-passthrough/500-masking/uniform-401/documents tests all keep their semantics).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — rename modules, update `main.py` mounts (`from app.api import health, workflows, instance, documents`), delete `_config_bundle_from_apexflow`, `_application_view_from_instance`, `PARENT_ACTIONS` + guard (keep the "body must be an object with string action" 400). Keep `_school_year_for_date` and the start route's context threading unchanged. `documents.py`: paths `/application/{token}/documents...` → `/instance/{token}/documents...`.
- [ ] **Step 4: Full familyhub backend suite** — `cd familyhub/backend && uv run python -m pytest tests/ -v` → green (66 baseline reshaped + new).
- [ ] **Step 5: Commit** — `feat(familyhub): facade generalizes to workflow/instance bundles; PARENT_ACTIONS allowlist retired in favor of apexflow authority`.

---

### Task 7: familyhub frontend generalization (StepRenderer runtime, closed page, hub)

**Files:**
- Modify: `familyhub/frontend/src/api/facade.ts`
- Modify: `familyhub/frontend/src/types/registration.ts` → `familyhub/frontend/src/types/workflow.ts`
- Modify: `familyhub/frontend/src/pages/RegisterPage.tsx`
- Modify: `familyhub/frontend/src/pages/HubPage.tsx`
- Modify: `familyhub/frontend/src/pages/LandingPage.tsx` (smoke import swap)
- Modify: `familyhub/frontend/src/i18n/translations.ts`
- Verify: `cd familyhub/frontend && npm run build && npm run lint`

**Interfaces:**
- Consumes: Task 6's facade contract; Task 5's `StepRenderer` runtime props (`mode: 'family'`, `items`, `onCompleteItem`, `onUploadDocument`, `documents`); `evaluateCondition` stays internal to StepRenderer; PreviewPane's `available_in` filter precedent (empty list ⇒ no state).
- Produces:

```ts
// types/workflow.ts (replaces types/registration.ts)
export interface WorkflowDefinitionView {
  definition_id: string; name: string; version: number;
  machine: { states: { state_id: string; name: string; kind: string }[]; transitions: unknown[] };
  steps: WorkflowStepDef[];                    // re-export type from flow-runtime
}
export interface WorkflowBundle {
  definition: WorkflowDefinitionView;
  models: Record<string, ModelFieldSource>;
  tenant: TenantSummary;                        // {tenant_id, name} — carried over
  capacity: CapacityState;                      // {capacity, admitted, full} — carried over
  lineage_status: 'active' | 'deprecated' | 'retired';
}
export interface InstanceBundle {
  instance: EntityRecord;                       // carries state, draft_data, definition_id, ...
  items: EntityRecord[];
  definition: WorkflowDefinitionView;
  allowed: string[];
}
```

```ts
// facade.ts — renamed/reshaped exports (FacadeError, jsonOrThrow retained)
export async function fetchWorkflowBundle(tenantId: string, definitionId: string): Promise<WorkflowBundle>
export async function startWorkflow(tenantId: string, definitionId: string, applicantEmail: string): Promise<StartResponse>
export async function fetchInstance(token: string): Promise<InstanceBundle>
export const saveDraft = (token: string, sectionAnswers: Record<string, unknown>) => putAction(token, { action: 'save_draft', section_answers: sectionAnswers })
export const completeItem = (token: string, itemId: string) => putAction(token, { action: 'complete_item', item_id: itemId })
export const runAction = (token: string, action: string) => putAction(token, { action })
// requestLink / createDocumentSlot / uploadDocumentFile / decodeToken / getDocumentUrl: paths → /api/instance/..., otherwise unchanged
```

**Draft mapping:** the StepRenderer `WorkflowDraft` key scheme must be converted to `save_draft`'s `section_answers` (dict keyed by `section_id`, dict of fields per non-repeat section, list-of-dicts for repeat sections — `engine.py:276-355`). Implement `draftToSectionAnswers(steps, draft)` and `sectionAnswersToDraft(steps, saved)` in `facade.ts` per the map's §4 key-scheme finding (`# ADJUST(bindings)` — if the schemes already coincide, these are identity functions with tests-by-build only).

**RegisterPage flow:**
1. Load `fetchWorkflowBundle`. If `lineage_status !== 'active'` → new phase `'closed'`: friendly page (`t('register.closedTitle')`, `t('register.closedBody')` — "This workflow is no longer accepting new submissions. Already started? Use your emailed link.") with a link to `/request-link`. This closes Plan 1 follow-up item 21's family half.
2. Email capture → `startWorkflow`; on `FacadeError` 409, read the relayed body's `detail.reason` (`lineage_not_active` → `'closed'` phase; `definition_stale`/`definition_broken` → `t('register.startUnavailable')`; capacity-style 409 from the machine → existing waitlist copy). `FacadeError` must therefore carry the parsed body: extend it with `readonly body: unknown`.
3. Running phase: `steps = bundle.definition.steps.filter(s => s.available_in.includes(state))` (empty ⇒ none — PreviewPane precedent); mount:

```tsx
<StepRenderer
  steps={visibleSteps}
  models={bundle.models}
  mode="family"
  draft={draft}
  onDraftChange={handleDraftChange /* debounced saveDraft(token, draftToSectionAnswers(...)) */}
  items={itemViews}
  onCompleteItem={(itemEid) => completeItem(token, itemEid).then(refresh)}
  onUploadDocument={(itemEid, file) => uploadDocumentFile(token, itemEid, file).then(refresh)}
  documents={documentViews}
/>
```
4. Submit affordance: render action buttons from `instance.allowed` filtered to non-item actions (`allowed.filter(a => !['save_draft','complete_item'].includes(a))`), each calling `runAction` then refreshing — this is the "family-permitted actions" surface, now derived, never hand-listed.

**HubPage:** swap `fetchApplication` → `fetchInstance`; item checklist logic stays (statuses unchanged); replace `app.status` reads with `instance.state` and derive the display label from `definition.machine.states` (`states.find(s => s.state_id === state)?.name ?? state`); action buttons from `allowed` (same filter as above) replacing the hardcoded submit gate; DELETE the payment-block lookup (`paymentBlockId`, `paymentAmountFor`, `formatCents` imports). Continue-form link unchanged.

- [ ] **Step 1:** Implement types + facade. **Step 2:** RegisterPage. **Step 3:** HubPage + LandingPage smoke-import swap (`WorkflowStepDef` replaces `RegistrationConfigDef`). **Step 4:** i18n — add `register.closedTitle/closedBody/startUnavailable`, `hub.state`, and any new keys to BOTH locales.
- [ ] **Step 5:** `cd familyhub/frontend && npm run build && npm run lint` → clean.
- [ ] **Step 6: Commit** — `feat(familyhub): parent runtime renders workflow steps via StepRenderer; deprecated-lineage friendly page; derived action affordances`.

---

### Task 8: retire the registration-era block runtime

**Files:**
- Delete: `flow-runtime/src/FlowRenderer.tsx`, `flow-runtime/src/blocks/` (all six), payment-era exports in `flow-runtime/src/blockConfig.ts` + `flow-runtime/src/money.ts`
- Modify: `flow-runtime/src/index.ts`, `flow-runtime/src/types.ts`, `flow-runtime/src/blockConfig.ts`
- Verify: flow-runtime typecheck + all three consumer builds

**Interfaces:**
- Consumes: Task 7 having removed familyhub's last `FlowRenderer`/`FlowBlock`/payment imports (`RegisterPage.tsx:3` was the only `FlowRenderer` mount repo-wide).
- Produces: `index.ts` no longer exports `FlowRenderer`, `FlowRendererProps`, `formFields`, `docsOf`, `plansOf`, `planAmounts`, `messageBody`, `resolvePlanKind`, `paymentAmountFor`, `formatCents`; `types.ts` drops `FlowBlock`, `BlockType`, `RegistrationConfigDef`, `PaymentPlanKind`, `PaymentPlanOption` (KEEP `ApplicationItem`/`ApplicationStatus`/`ItemStatus`/`DONE_ITEM_STATUSES`/`FlowField`/`RequiredDoc`/`ModelFieldSource` and everything the workflow path uses — verify each drop by grepping ALL of `familyhub/frontend`, `apexflow/frontend`, `admindash/frontend` first; anything still imported stays and is noted in the task report).

- [ ] **Step 1:** Grep-audit every candidate export across the three frontends; delete only zero-consumer symbols. **Step 2:** Delete files, prune `index.ts`/`types.ts`/`blockConfig.ts`. **Step 3:** `npx tsc --noEmit` (flow-runtime), `npm run build && npm run lint` in familyhub/frontend AND apexflow/frontend. **Step 4: Commit** — `refactor(flow-runtime): retire registration-era block renderer and payment-era exports`.

---

### Task 9: admindash backend — apexflow proxy module

**Files:**
- Modify: `admindash/backend/app/config.py` (~:16)
- Create: `admindash/backend/app/api/workflows.py`
- Modify: `admindash/backend/app/main.py` (~:34-42)
- Test: `admindash/backend/tests/test_workflows_proxy.py` (new)
- Modify: `admindash/backend/README.md` (endpoint table), `admindash/CLAUDE.md` (proxy surface prose)

**Interfaces:**
- Consumes: `require_tenant_match` (`tenancy.py:290`), `user["_token"]` (`auth.py:55`), settings env prefix `ADMINDASH_` (`config.py:10`); apexflow upstream routes (Tasks 3's GET included).
- Produces: `Settings.apexflow_backend_url: str = "http://localhost:5910"` (env `ADMINDASH_APEXFLOW_BACKEND_URL`; port cite `services.json:13` — re-verify via map §9). Router mounted as `app.include_router(workflows.router, prefix="/api", tags=["workflows"])`. Routes (ALL plain `def`; shared helper below):

```python
# admindash/backend/app/api/workflows.py
"""Thin staff proxies to apexflow-backend (papermite-proxy pattern, extract.py:63-79).

Plain `def` routes: FastAPI threadpools them, so sync httpx cannot block the
event loop (the open item-15 debt in entities.py must not grow)."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import settings
from app.tenancy import require_tenant_match

router = APIRouter()


def _relay(method: str, path: str, token: str, json_body: dict | None = None) -> Response:
    try:
        resp = httpx.request(method, f"{settings.apexflow_backend_url}{path}",
                             json=json_body, headers={"Authorization": token}, timeout=30.0)
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ApexFlow is unreachable")
    return Response(content=resp.content, status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/json"))


@router.get("/workflows/{tenant_id}/definitions")
def list_definitions(tenant_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay("GET", f"/api/workflows/{tenant_id}/definitions", user["_token"])


@router.get("/workflows/{tenant_id}/definitions/{entity_id}/bundle")
def definition_bundle(tenant_id: str, entity_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay("GET", f"/api/workflows/{tenant_id}/definitions/{entity_id}/bundle", user["_token"])


@router.post("/workflows/{tenant_id}/definitions/{definition_id}/instances")
async def create_instance(tenant_id: str, definition_id: str, request: Request,
                          user=Depends(require_tenant_match)) -> Response:
    # async ONLY to read the body; the forward itself is offloaded via a
    # thread — see step 3. Body relayed verbatim (channel/context/email).
    ...


@router.get("/workflows/{tenant_id}/instances/{instance_entity_id}/allowed-actions")
def allowed_actions(tenant_id: str, instance_entity_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay("GET", f"/api/workflows/{tenant_id}/instances/{instance_entity_id}/allowed-actions", user["_token"])


@router.post("/workflows/{tenant_id}/instances/{instance_entity_id}/actions")
async def instance_action(tenant_id: str, instance_entity_id: str, request: Request,
                          user=Depends(require_tenant_match)) -> Response: ...


@router.post("/workflows/{tenant_id}/documents")
async def create_document(tenant_id: str, request: Request,
                          user=Depends(require_tenant_match)) -> Response:
    # → apexflow POST /api/documents/{tenant_id}  (201 relayed via the returned
    # Response's own status_code — no decorator status override)
    ...


@router.get("/workflows/{tenant_id}/documents/{document_id}/url")
def document_url(tenant_id: str, document_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay("GET", f"/api/documents/{tenant_id}/{document_id}/url", user["_token"])
```

For the three body-forwarding routes: since reading a request body requires `async def`, they MUST NOT call sync httpx inline — use `content = await request.body()` then `from starlette.concurrency import run_in_threadpool` → `resp = await run_in_threadpool(_relay_bytes, method, path, token, content, content_type)` where `_relay_bytes` is the sync sibling of `_relay` forwarding raw bytes + Content-Type. This keeps the no-new-event-loop-debt constraint while relaying bodies verbatim.

- [ ] **Step 1: Failing respx tests** (pattern: `test_extract.py` / `test_entities.py`):

```python
BASE = "http://localhost:5910"

def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"user_id": "u1", "tenant_id": "t1", "role": "admin"}))

@respx.mock
def test_list_definitions_proxies_with_caller_token(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/t1/definitions").mock(
        return_value=httpx.Response(200, json={"definitions": []}))
    resp = client.get("/api/workflows/t1/definitions", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"

@respx.mock
def test_tenant_mismatch_403_without_upstream_call(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/OTHER/definitions").mock(
        return_value=httpx.Response(200, json={"definitions": []}))
    resp = client.get("/api/workflows/OTHER/definitions", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 403
    assert not route.called

@respx.mock
def test_instance_action_relays_body_and_409_verbatim(client):
    _stub_auth(respx)
    respx.post(f"{BASE}/api/workflows/t1/instances/i1/actions").mock(
        return_value=httpx.Response(409, json={"detail": {"allowed": ["approve"]}}))
    resp = client.post("/api/workflows/t1/instances/i1/actions",
                       headers={"Authorization": "Bearer good"},
                       json={"action": "bogus"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["allowed"] == ["approve"]

@respx.mock
def test_apexflow_unreachable_502(client):
    _stub_auth(respx)
    respx.get(f"{BASE}/api/workflows/t1/definitions").mock(side_effect=httpx.ConnectError("refused"))
    resp = client.get("/api/workflows/t1/definitions", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "ApexFlow is unreachable"
```

Plus one test per remaining route (bundle, create-instance 201, allowed-actions, documents create/url) asserting path + method + token forwarding.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** as specified. **Step 4:** `cd admindash && uv run pytest backend/tests/ -v` → green (183 baseline + new). **Step 5:** Update README endpoint table + CLAUDE.md proxy prose. **Step 6: Commit** — `feat(admindash): apexflow workflow proxies (definitions, instances, actions, documents)`.

---

### Task 10: admindash frontend — Workflows area (definitions list + pipeline board)

**Files:**
- Modify: `admindash/frontend/src/App.tsx` (routes), `admindash/frontend/src/components/Navbar.tsx` (navItems + icon)
- Create: `admindash/frontend/src/api/workflows.ts`
- Create: `admindash/frontend/src/utils/workflowData.ts` + `admindash/frontend/src/utils/__tests__/workflowData.test.ts`
- Create: `admindash/frontend/src/pages/WorkflowsPage.tsx` (+ `.css`), `admindash/frontend/src/pages/WorkflowPipelinePage.tsx` (+ `.css`)
- Modify: `admindash/frontend/src/i18n/translations.ts` (both locales)
- Verify: `npm run build && npm run lint && npm test` in `admindash/frontend`

**Interfaces:**
- Consumes: Task 9's proxy routes; existing `postQuery` (`client.ts:24-36`), `escapeSql` (`:255`), `DataTable`, `ViewChips`-style tones via `stageTone` (`utils/tone.ts:96-102`), LeadPage board CSS classes (`LeadPage.css:25-134`) as the styling template; `useTablePreferences`.
- Produces:

```ts
// api/workflows.ts  (fetch pattern of client.ts; API_BASE + authHeaders reused via import or local copy per client.ts conventions)
export interface DefinitionListEntry {
  entity_id: string; definition_id: string; name: string; version: number;
  status: string; lineage_status: string; channel_access: string;
  health: string; open_instances: number; family_url?: string; parse_error?: string;
}
export async function listWorkflowDefinitions(tenantId: string): Promise<{ definitions: DefinitionListEntry[] }>
export async function getDefinitionBundle(tenantId: string, entityId: string): Promise<DefinitionBundle>  // {definition:{...machine,steps}, models, health, errors}
export async function createWorkflowInstance(tenantId: string, definitionId: string, body: { context: Record<string, unknown>; channel: 'staff'; applicant_email?: string }): Promise<{ instance: Record<string, unknown>; items: Record<string, unknown>[] }>
export async function getAllowedActions(tenantId: string, instanceEntityId: string): Promise<{ state: string; allowed: string[] }>
export async function postInstanceAction(tenantId: string, instanceEntityId: string, body: { action: string; [k: string]: unknown }): Promise<Record<string, unknown>>
// non-OK: parse the JSON body and throw a WorkflowApiError{status, body} (port apexflow/frontend/src/api/designer.ts:33-54's ApiError pattern — admindash's bare Error(`HTTP n`) loses the 409 allowed list we need)
```

```ts
// utils/workflowData.ts — pure, vitest-testable (node env, .test.ts)
export interface MachineStateView { state_id: string; name: string; kind: string }
export function parseMachineStates(machineJson: unknown): MachineStateView[]
  // tolerates: object already parsed, JSON string, invalid → []
export function instancesByState(states: MachineStateView[], rows: InstanceRow[]): { columns: { state: MachineStateView; rows: InstanceRow[] }[]; orphans: InstanceRow[] }
export function instanceSql(definitionId: string): string
  // `SELECT * FROM data WHERE entity_type = 'workflow_instance' AND _status = 'active' AND definition_id = '<escaped>' ORDER BY _created_at DESC`
export function pinnedDefinitionSql(definitionId: string, version: number | string): string
  // `SELECT * FROM data WHERE entity_type = 'workflow_definition' AND _status = 'active' AND definition_id = '<escaped>' AND version = '<escaped>'`
  // NOTE: DataCore flattens numerics to strings — compare as string (map §2).
export function asNumber(v: unknown): number   // port of designer.ts:56-77's coercion
```

**WorkflowsPage** (`/workflows`): fetches `listWorkflowDefinitions`; DataTable with columns name / version / status / lineage_status / health (StatusBadge) / open_instances / channel_access; row click → `/workflows/{definition_id}` (pass the row via nav state, re-fetch on load). Empty state + `workflows.title` heading.

**WorkflowPipelinePage** (`/workflows/:definitionId`): loads the definitions list (find the lineage's published row for its `machine`), `postQuery(instanceSql(...))` for ALL the lineage's active instances (board fetches whole set, LeadPage precedent `LeadPage.tsx:42-44`); columns = `parseMachineStates(publishedRow.machine)` in declaration order, tone via `stageTone(i, states.length)`; each card shows applicant_email / instance display id / opened_at + a `channel_started` chip; orphan column for instances in states the machine no longer declares (mirrors LeadPage's `otherLeads`, incl. instances pinned to older versions with renamed states); card click opens the Task 11 drawer. A "Start staff entry" primary button → Task 12's route. Instances pinned to non-published versions still appear (they're rows of the same lineage — the board columns come from the PUBLISHED machine; the orphan bucket absorbs mismatches).

**Nav/i18n:** `{ to: '/workflows', label: t('nav.workflows'), icon: 'workflows' }` + SVG in the `icons` map; keys `nav.workflows`, `workflows.title`, `workflows.empty`, `workflows.columnEmpty`, `workflows.otherStates`, `workflows.startEntry`, `workflows.openInstances`, ... in BOTH locales.

- [ ] **Step 1: Failing vitest tests** for `workflowData.ts` (parseMachineStates: object/string/garbage; instancesByState: grouping + orphans; instanceSql/pinnedDefinitionSql: exact strings incl. `_status = 'active'` and escaping of `'` in ids). Run `npm test` → FAIL.
- [ ] **Step 2:** Implement utils → tests PASS.
- [ ] **Step 3:** Implement api/workflows.ts, pages, nav, routes (`/workflows`, `/workflows/:definitionId` inside the authed shell), i18n (both locales — run `npm test` again for the translations guard).
- [ ] **Step 4:** `npm run build && npm run lint` → clean (5 pre-existing lint errors in untouched files are the known baseline; ZERO new errors).
- [ ] **Step 5: Commit** — `feat(admindash): Workflows area — definitions list + per-definition pipeline board from the pinned machine`.

---

### Task 11: admindash frontend — instance detail drawer with actions

**Files:**
- Create: `admindash/frontend/src/components/WorkflowInstanceDrawer.tsx` (+ CSS additions in `WorkflowPipelinePage.css`)
- Modify: `admindash/frontend/src/pages/WorkflowPipelinePage.tsx` (mount drawer)
- Modify: `admindash/frontend/src/utils/workflowData.ts` (+ tests) — detail SQL builders
- Modify: `admindash/frontend/src/i18n/translations.ts`
- Verify: build + lint + vitest

**Interfaces:**
- Consumes: `Modal variant="drawer"` (`ui/Modal.tsx`), LeadDetailDrawer's structure (`LeadDetailDrawer.tsx:21-140`) as the template; `postQuery`; Task 9's `getAllowedActions`/`postInstanceAction` + document url proxy; `WorkflowApiError` for 409 bodies.
- Produces: `WorkflowInstanceDrawer({ tenant, instance, definition, onClose, onChanged })` rendering, in order:
  1. Instance facts `<dl>`: state (label from machine states), display `instance_id`, channel_started, applicant_email, opened_at/closed_at, definition_version.
  2. **Items checklist** — rows from `SELECT * FROM data WHERE entity_type = 'workflow_item' AND _status = 'active' AND instance_id = '<instance entity_id>'` (new `itemsSql(instanceEntityId)` util; `instance_id` = entity_id per the identifier convention); each row: title, kind, StatusBadge, and per-item staff buttons **verify / reject / waive** (shown per current status: verify for `submitted`/`in_progress`, waive unless `verified`, reject always) calling `postInstanceAction(tenant, eid, { action: 'verify_item' | 'reject_item' | 'waive_item', item_id: item.entity_id })`.
  3. **Documents** — `documentsSql(instanceEntityId)`: `... entity_type = 'document' AND _status = 'active' AND application_id = '<instance entity_id>'` (DataCore's fixed field name, `apexflow documents.py:74`); filename + uploaded_by + a download link via the document-url proxy.
  4. **Activity feed** — `activitySql(instanceEntityId)` ordered by `at` ascending; render like LeadDetailDrawer's list: `state_change` → `from_value → to_value`, `item_change` → same with item context, `email_sent`/`note` → `to_value` text, timestamp from `at`.
  5. **Actions bar** — `getAllowedActions` on open; transition actions = `allowed` minus the five item built-ins; each renders a Button firing `postInstanceAction({action})`; `cancel_instance` (always offered on non-terminal instances — engine built-in) styled `danger` behind a confirm Modal (LeadDetailDrawer's stage-confirm pattern). On ANY action: success → refetch everything + `onChanged()`; 409 → toast the refreshed allowed list ("State changed — actions refreshed"), refetch; the CAS 409 `{"error": "conflict"}` → toast `t('workflows.conflictRetry')` and refetch.

- [ ] **Step 1: Failing vitest tests** for the new SQL builders + an `actionButtonsFor(allowed: string[], items…)` pure helper (item-builtin filtering, verify/waive visibility per status). **Step 2:** implement utils → PASS. **Step 3:** implement drawer + wire into pipeline page + i18n both locales. **Step 4:** build + lint + `npm test` clean. **Step 5: Commit** — `feat(admindash): workflow instance drawer — items, documents, activity, advertised actions`.

---

### Task 12: admindash frontend — staff-assisted entry

**Files:**
- Create: `admindash/frontend/src/pages/StaffEntryPage.tsx` (+ `.css`)
- Modify: `admindash/frontend/src/App.tsx` (route `/workflows/:definitionId/new`), `admindash/frontend/package.json` (add `"@neoapex/flow-runtime": "file:../../flow-runtime"`), `admindash/frontend/src/i18n/translations.ts`
- Verify: build + lint + vitest; `npm install` for the file: link

**Interfaces:**
- Consumes: Task 5's `StepRenderer` (`mode="staff"`, items props), Task 9's `createWorkflowInstance`/`postInstanceAction`/`getAllowedActions`, Task 10's `getDefinitionBundle` (models + steps + machine), `defaultSchoolYear` (flow-runtime — still exported; verify at Task 8's audit), Task 7's `draftToSectionAnswers` equivalent — **implement the same converter in `utils/workflowData.ts`** (or import from flow-runtime if Task 7 hoisted it there; `# ADJUST(bindings)` per map §4 — hoisting into flow-runtime is PREFERRED if both channels need it: one converter, two consumers).
- Produces: route `/workflows/:definitionId/new` — flow: load definitions list → published row → `getDefinitionBundle(entity_id)`; context form (`school_year` defaulted via `defaultSchoolYear()`, optional applicant email); "Start" → `createWorkflowInstance(tenant, definition_id, { context, channel: 'staff', applicant_email? })`; then mount:

```tsx
<StepRenderer
  steps={steps.filter(s => s.available_in.includes(state))}
  models={bundle.models}
  mode="staff"
  draft={draft}
  onDraftChange={onDraftChange /* debounced postInstanceAction save_draft with section_answers */}
  items={itemViews}
  onCompleteItem={(itemEid) => postInstanceAction(tenant, instanceEid, { action: 'complete_item', item_id: itemEid }).then(refresh)}
  onUploadDocument={uploadViaDocumentsProxy}
  documents={documentViews}
/>
```

plus an actions bar identical in behavior to Task 11's (from `getAllowedActions`, refreshed after every action — after `submit` the state changes and the step filter re-renders). A "View in pipeline" link back to `/workflows/{definition_id}`. Upload path: `createDocument` proxy (POST `/api/workflows/{tenant}/documents` with `{instance_id, item_id, filename, content_type, size}`) → returned presign upload → then `complete_item` with `payload_ref` (`# ADJUST(bindings)`: mirror familyhub's `uploadDocumentFile` two-phase flow per map §6; if R2 creds are absent in dev the upload leg is exercised only manually, per the browser-gate scope).

- [ ] **Step 1:** package.json link + `npm install`; smoke-import compile. **Step 2:** implement page/route/i18n (both locales). **Step 3:** build + lint + `npm test` clean. **Step 4: Commit** — `feat(admindash): staff-assisted workflow entry mounting flow-runtime in staff mode`.

---

### Task 13: designer validate-422 hijack fix (Plan 2 follow-up item 8)

**Files:**
- Modify: `apexflow/frontend/src/editor/draftStore.ts` (~:258-272, `runValidate`/`extractParseError` seam)
- Modify: `apexflow/frontend/src/pages/EditorPage.tsx` (~:60-65)
- Verify: `cd apexflow/frontend && npm run build && npm run lint`

**Interfaces:**
- Consumes: `runValidate` (`draftStore.ts:258-272`), `extractParseError` (`:128-139`), `setParseError`, EditorPage's full-page parse-error branch (`EditorPage.tsx:60-65`).
- Produces: on a background-validate 422 `parse_error`, the store first checks whether the CURRENT in-memory `machine`/`steps` round-trip (`JSON.parse(JSON.stringify(...))` succeeds and both are non-null objects — a `localStateParses(): boolean` helper). If local state parses: set a NEW `staleParseWarning: string | null` store field instead of `parseError`; EditorPage renders it as a dismissable inline banner ("The saved copy of this draft failed to parse — your current edits look valid and will overwrite it on next save.") above the editor, NOT the full-page replacement. If local state does NOT parse (true corruption): today's full-page path, unchanged. Banner clears on next successful autosave/validate.

- [ ] **Step 1:** Implement (store field + helper + banner; i18n keys both locales). **Step 2:** build + lint clean. **Step 3: Commit** — `fix(apexflow): background-validate parse errors show a banner when local state is valid, not a full-page hijack`.

---

### Task 14: full-suite gate + docs

**Files:**
- Modify: `CLAUDE.md` (admindash/familyhub descriptions if their surfaces changed), `admindash/backend/README.md` (verify Task 9 did it)

- [ ] **Step 1: Run every suite; record results verbatim in the task report:**

```bash
cd datacore && uv run python -m pytest tests/ -v
cd apexflow/backend && uv run python -m pytest tests/ -v
cd familyhub/backend && uv run python -m pytest tests/ -v
cd launchpad/backend && uv run python -m pytest tests/ -v
cd admindash && uv run pytest backend/tests/ -v
cd papermite && uv run python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -v   # 2 pre-existing failures are the known baseline
cd apexflow/frontend && npm run build && npm run lint
cd familyhub/frontend && npm run build && npm run lint
cd admindash/frontend && npm run build && npm run lint && npm test
cd flow-runtime && npx tsc --noEmit
bash -n start-services.sh
```

Expected: all green except papermite's two confirmed-pre-existing failures and admindash frontend lint's 5 pre-existing errors in untouched files — anything else is a regression to fix before proceeding.

- [ ] **Step 2: Commit** any doc/gate fixes — `chore(apexflow): plan-3 full-suite gate`.

---

### Task 15: browser gate (coordinator-run, claude-in-chrome)

Coordinator (not a subagent) runs this, per Plans 1–2.

- [ ] **Step 1: Start services** — DataCore 5800, apexflow-backend 5910, apexflow-frontend 5900, admindash-backend 5610, admindash-frontend 5600, familyhub-backend 5630, familyhub-frontend 5620 (`./start-services.sh` or targeted uvicorn/vite with `TRUST_ALL_IPS=1`, `APEXFLOW_LINK_SECRET`/`APEXFLOW_INTERNAL_KEY` dev values ≥32 chars, `FAMILYHUB_APEXFLOW_INTERNAL_KEY` matching). Reseed if needed (`scripts/apexflow-reseed-dev.py`).
- [ ] **Step 2: Staff channel click-through** — login `jane@acme.edu`/`admin123` (tenant `acme`) on admindash 5600 → Workflows nav → definitions list shows Enrollment published/active/current → pipeline board renders the machine's states as columns → Start staff entry → fill sections (student/family/contacts/application) → autosave → complete items → submit → instance appears in the `submitted` column → open drawer → verify items → approve via advertised action → state advances (auto-advance to enrolled once post-approval items verify) → activity feed shows the state changes.
- [ ] **Step 3: Family channel click-through** — familyhub 5620 `/w/acme/enrollment` → email capture → start → StepRenderer renders real sections (no `blocks: []`) → fill → autosave → complete → submit → hub page shows state + checklist + derived actions; deprecate the lineage in the apexflow designer → family URL now shows the friendly closed page (not the email form); reactivate afterward.
- [ ] **Step 4: Direct DataCore verification** — for at least one staff-created and one family-created instance: `POST http://localhost:5800/api/query` (`table: "entities"`) with `_status = 'active'` filters; confirm `workflow_instance.state`, committed `student`/`family`/`contact`/`registration_application` rows post-approval, `workflow_activity` trail, and `subject_refs` ids. **DEDUPE discipline: any query WITHOUT `_status='active'` must dedupe by max `_version` per entity_id.**
- [ ] **Step 5: CAS spot-check** — two rapid conflicting actions on one instance (browser + curl) → second gets the 409 conflict toast, no lost update (instance row consistent by direct query).
- [ ] **Step 6:** Document-upload legs remain manual-deferred while `DATACORE_R2_*` is absent (Plan 1 follow-up checklist carries forward). Record every gate result in `progress.md`; file defects as fix-wave items, re-run the affected leg after fixes.

---

### Task 16: follow-ups doc, final whole-branch review, fix wave, merge

- [ ] **Step 1:** Write `docs/superpowers/plans/2026-08-06-apexflow-plan3-followups.md` — same structure as Plans 1–2: fixed-during-gate, deferred items (carry forward the untouched transfers: TRUST_ALL_IPS checklist, R2 seam, referrer-policy/log scrubbing, admindash entities.py/query.py sync-httpx debt status, pagination posture of the new board), accepted minors, process notes (config-facts table outcome).
- [ ] **Step 2:** Final whole-branch review by the most capable model (fresh subagent, whole `git diff docs/registration-flow-design...HEAD`), adversarial: contract drift between Tasks 3/4's response shapes and Tasks 6/7/9-12's consumers; CAS coverage completeness (every instance/item dc_update site); tenant-isolation on every new admindash route; the deleted-exports audit from Task 8.
- [ ] **Step 3:** ONE fix wave for Important+ findings (TDD; scoped re-review of fixes). Minors → follow-ups doc.
- [ ] **Step 4:** Merge:

```bash
git checkout docs/registration-flow-design
git merge --no-ff feat/apexflow-plan3-channels -m "merge: apexflow Plan 3 — channels (AdminDash tracking + staff entry, FamilyHub workflow runtime, CAS preconditions)"
```

---

## Self-Review (performed at authoring time)

1. **Spec coverage** — §6 AdminDash tracking (Tasks 9–11), staff entry (Task 12), pipeline columns from pinned machine (Task 10), allowed actions from the 409-advertised list (Tasks 3, 11), FamilyHub public start URL + hub + family-permitted actions (Tasks 6–7), §11-item-3 browser click-through both channels with document upload deferred (Task 15). Follow-up inputs: blocks compiler gap → Tasks 4–7 (steps+models bundle instead of a block compiler — the compiler concept is retired with the blocks themselves, Task 8); deprecated-lineage friendly page → Tasks 4+7; validate-422 hijack → Task 13; PARENT_ACTIONS derivation → Tasks 3+6+7 (derived `allowed`, allowlist deleted); CAS precondition → Tasks 1–2.
2. **Placeholder scan** — the deliberate deferrals are all `# ADJUST(bindings)` pointers into the Task 0 map (draft key scheme, datacore test fixtures, seeding helpers), which is this process's established mechanism, not a TBD.
3. **Type consistency** — `allowed_actions` (Tasks 3/6/7/9/11/12), `WorkflowItemView`/`InstanceDocumentView`/`StepRendererMode` (Tasks 5/7/12), `expected_version`/`row_version`/`VersionConflictError` (Tasks 1/2), facade paths `/api/workflows/...`+`/api/instance/...` (Tasks 6/7), proxy paths `/api/workflows/{tenant_id}/...` (Tasks 9/10/11/12) — names checked consistent across tasks.
