# Implementation Plan: derived-template-model-sync

Source of truth: `openspec/changes/derived-template-model-sync/` (proposal, design, specs, tasks). Read `design.md` D1–D7 and both `specs/*/spec.md` before any task. Every scenario in the specs is a test.

Branch: `feat/derived-template-model-sync` (already created from `main`). Each task ends in one commit. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

**Verification rule for every task with tests (memory: "verify tests by mutation"):** after the tests pass, make the named mutation to the implementation, run the tests, confirm at least one fails, revert the mutation, run again, confirm green. Report the mutation and the failing test name. Watch for stale `__pycache__` faking a result.

**Karpathy overlay:** surgical changes only. Do not touch adjacent code, comments, or formatting. No new abstractions beyond what a task names.

## Environments and commands

| Where | Tests | Build/lint |
|---|---|---|
| `launchpad` | `cd launchpad && uv run --extra dev pytest backend/tests -q` (venv exists; `uv sync --extra dev` if deps missing) | — |
| `apexflow/backend` | `cd apexflow && uv run pytest backend/tests -q` | — |
| `apexflow/frontend` | `cd apexflow/frontend && npm test` (vitest) | `npm run build && npm run lint` |
| `launchpad/frontend` | none | `cd launchpad/frontend && npm run build && npm run lint` |

LaunchPad tests import `app.*` from `launchpad/backend`; check `launchpad/pyproject.toml`/`pytest.ini` for `pythonpath` before adding a test module (the existing `backend/tests/test_tenants_api.py` imports `from app.api import tenants`, so whatever makes that work applies).

---

## Task 1.1 — Move `merge_model_definition` to LaunchPad

**Files:**
- Create `launchpad/backend/app/model_merge.py`
- Create `launchpad/backend/tests/test_model_merge.py`
- Edit `apexflow/backend/tests/test_reseed_script.py` (remove the seven merge tests)

**Steps:**
1. Copy the function body and docstring of `merge_model_definition` from `scripts/apexflow-reseed-dev.py:117-157` verbatim into `launchpad/backend/app/model_merge.py`. Module docstring (3–4 lines): LaunchPad owns `base_model.json`, so it owns the rule for folding base fields into a tenant model; the dev reseed script imports this; Papermite's finalize has its own variant and is unrelated.
2. Move the seven tests `test_merge_model_definition_*` (lines 63–145 of `apexflow/backend/tests/test_reseed_script.py`) into `launchpad/backend/tests/test_model_merge.py`, importing `from app.model_merge import merge_model_definition` and replacing `reseed.merge_model_definition` with the direct name. Delete them from the apexflow file. Leave every other test there untouched.
3. Run both suites.

**Mutation:** in `model_merge.py` change `if f.get("required") and "default" not in f:` to `if False:`; `test_merge_model_definition_demotes_required_carried_field_without_default` must fail. Revert.

**Commit:** `refactor(launchpad): merge_model_definition moves to LaunchPad, which owns base_model.json`

## Task 1.2 — Reseed script imports the LaunchPad function

**Files:** `scripts/apexflow-reseed-dev.py`, `apexflow/backend/tests/test_reseed_script.py`

**Steps:**
1. In the script, delete the local `merge_model_definition` definition (lines 117–157). Where the constants are defined (near `BASE_MODEL_PATH`, line ~65), add:
   ```python
   LAUNCHPAD_MODEL_MERGE = REPO_ROOT / "launchpad" / "backend" / "app" / "model_merge.py"

   def _load_merge_model_definition():
       """LaunchPad owns the merge rule (launchpad/backend/app/model_merge.py).
       Loaded by file path: LaunchPad's package is also named `app`, which
       would collide with apexflow's `app` already on sys.path."""
       spec = importlib.util.spec_from_file_location("launchpad_model_merge", LAUNCHPAD_MODEL_MERGE)
       module = importlib.util.module_from_spec(spec)
       spec.loader.exec_module(module)
       return module.merge_model_definition

   merge_model_definition = _load_merge_model_definition()
   ```
   Add `import importlib.util` to the imports. Update the module docstring sentence that names `merge_model_definition` as a pure helper tested here (line ~52) to say it lives in LaunchPad.
2. In `test_reseed_script.py` add:
   ```python
   def test_merge_rule_is_launchpads():
       import importlib.util
       path = SCRIPT_PATH.parents[1] / "launchpad" / "backend" / "app" / "model_merge.py"
       spec = importlib.util.spec_from_file_location("lp_model_merge_check", path)
       mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
       assert reseed.merge_model_definition.__code__.co_filename == mod.merge_model_definition.__code__.co_filename
   ```
   and update the file docstring's mention of `merge_model_definition`.
3. `cd apexflow && uv run pytest backend/tests/test_reseed_script.py -q`; also `uv run python ../scripts/apexflow-reseed-dev.py --dry-run --models-only` from `apexflow/backend` must not error on import (it may fail later on DataCore connectivity; an import error is the failure to watch for).

**Mutation:** re-add a stub `def merge_model_definition(b, e): return {}` in the script after the loader; the new test must fail. Revert.

**Commit:** `refactor(scripts): reseed script imports LaunchPad's merge rule`

---

## Task 2.1 — apexflow `POST /{tenant_id}/model-preflight`

**File:** `apexflow/backend/app/api/designer.py`

Add after `validate_definition_route` (line ~352):

```python
class ModelPreflightRequest(BaseModel):
    models: dict[str, dict[str, Any]]


@router.post("/{tenant_id}/model-preflight")
def model_preflight_route(tenant_id: str, body: ModelPreflightRequest,
                          user: dict = Depends(require_staff_tenant)):
    """Read-only: `definition_health` of every PUBLISHED definition against
    the tenant's stored models (`health_before`) and against the stored
    models overlaid with `body.models` (`health_after`). LaunchPad's
    field-level model sync calls this before writing, so a sync that would
    make a live workflow stale or broken is refused rather than silently
    stalling new instances (engine.create_instance 409s on either).

    Same batched read pattern as `list_definitions`: parse every row, fetch
    the union of referenced models once. A row that does not parse reports
    "broken" for both, as the list route does.
    """
    token = user.get("_token")
    rows = [r for r in dc.list_entities(tenant_id, "workflow_definition", "", token)
            if r.get("status") == "published"]

    parsed: list[tuple[Any, Any, bool]] = []
    referenced: set[str] = set()
    for row in rows:
        try:
            machine, steps = defs.parse_machine_steps(row)
            referenced |= defs.referenced_entity_models(steps)
            parsed.append((machine, steps, True))
        except (ValidationError, ValueError, TypeError):
            parsed.append((None, None, False))

    stored = defs.fetch_models(tenant_id, referenced, token)
    proposed = {**stored, **body.models}

    out = []
    for row, (machine, steps, ok) in zip(rows, parsed):
        if ok:
            before = definition_health(machine, steps, stored)
            after = definition_health(machine, steps, proposed)
        else:
            before = after = "broken"
        out.append({
            "definition_id": row.get("definition_id"),
            "name": row.get("name"),
            "version": defs._as_int(row.get("version")),
            "health_before": before,
            "health_after": after,
        })
    return {"definitions": out}
```

`BaseModel`, `ValidationError`, `definition_health`, `defs`, `dc` are already imported in this file.

## Task 2.2 — Preflight tests

**File:** `apexflow/backend/tests/test_designer_api.py` (append a section `# --- model-preflight ---`).

Use `_seed_definition(fake_dc, definition_id=..., status="published", steps=..., machine=...)`, `fake_dc.set_model(TENANT, "student", {...})`, and `client.post(f"/api/workflows/{TENANT}/model-preflight", json={"models": {...}})`. Build steps with one unconditional form step whose `student_section` picks `first_name` required. Student model fields need full dicts: `{"name": "first_name", "type": "str", "required": True}`.

Tests:
1. `test_preflight_required_no_default_field_makes_published_stale` — stored student = `[first_name(required)]`; body student adds `{"name": "allergy_plan", "type": "str", "required": True}`; expect `health_before == "current"`, `health_after == "stale"`.
2. `test_preflight_optional_additions_keep_health` — body adds an optional field; before == after == "current".
3. `test_preflight_excludes_drafts` — one draft + one published; response has exactly the published `definition_id`.
4. `test_preflight_unparseable_row_reports_broken` — use `_seed_definition_with_raw_machine(..., raw_machine="not json", status="published")`; both fields `"broken"`.
5. `test_preflight_wrong_tenant_403` — override `require_authenticated_user` with `tenant_id: "other"` for this test (see how other 403 tests in this file do it, or set the override inline and restore); expect 403.
6. `test_preflight_models_fetch_is_batched` — seed two published definitions on `student`; count `fake_dc.get_model_definition` calls via a wrapper (see `test_list_definitions_datacore_read_count_is_flat_in_rows` for the pattern); expect 1.

**Mutations:** (a) swap overlay to `proposed = {**body.models, **stored}` → test 1 fails. (b) remove the `status == "published"` filter → test 3 fails.

**Commit:** `feat(apexflow): model-preflight reports published-definition health against proposed models`

---

## Task 3.1 — LaunchPad `apexflow_backend_url` setting

**Files:** `launchpad/backend/app/config.py`, `launchpad/backend/tests/test_config.py` (create if absent; check for an existing config test first).

In `Settings` add `apexflow_backend_url: str = _svc_url("apexflow-backend")`. pydantic-settings already maps env `LAUNCHPAD_APEXFLOW_BACKEND_URL` if the class has `model_config`/`env_prefix = "LAUNCHPAD_"`; **check the existing `Settings` class for its env prefix** and follow it (the CLAUDE.md names `LAUNCHPAD_DATACORE_AUTH_URL` as an override, so a prefix exists).

Test: `settings.apexflow_backend_url == "http://localhost:5910"` by default; with `monkeypatch.setenv("LAUNCHPAD_APEXFLOW_BACKEND_URL", "http://x:1")` a fresh `Settings()` reads it.

**Commit:** `feat(launchpad): apexflow backend URL setting`

## Task 3.2 — Field-level sync (no guard yet)

**File:** `launchpad/backend/app/api/tenants.py`, function `sync_default_model` (lines 201–237).

Rewrite to:

```python
class SyncDefaultsRequest(BaseModel):
    force: bool = False


def _normalize_fields(fields: list[dict]) -> list[dict]:
    return sorted(fields, key=lambda f: f["name"])


@router.post("/tenants/{tenant_id}/model/sync-defaults")
def sync_default_model(tenant_id: str, body: SyncDefaultsRequest | None = None,
                       user=Depends(require_role("admin")),
                       authorization: str = Header(...)):
    """Field-level, non-destructive sync of base_model.json into the tenant's
    models. Missing entity types are added whole. Existing types get the
    current base fields merged in (model_merge.merge_model_definition: base
    fields win, custom fields preserved, carried-forward required-no-default
    fields demoted). Only types whose merged definition differs are written,
    in one PUT. Before writing, apexflow's model-preflight is asked whether
    any published workflow would become stale/broken; see design D3/D4 and
    the base-model rule in the root CLAUDE.md.
    """
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    force = bool(body and body.force)
    base_model = json.loads(BASE_MODEL_PATH.read_text())

    resp = httpx.post(_datacore_url("/query"), json={
        "tenant_id": tenant_id, "table": "models",
        "sql": "SELECT entity_type, model_definition FROM data WHERE _status = 'active'",
    })
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    existing: dict[str, dict] = {}
    for r in resp.json().get("data", []):
        md = r.get("model_definition")
        if isinstance(md, str):
            md = json.loads(md)
        existing[r["entity_type"]] = md or {}

    to_write: dict[str, dict] = {}
    added_entities: list[str] = []
    changed: dict[str, dict] = {}
    for et, base_def in base_model.items():
        if et not in existing:
            to_write[et] = base_def
            added_entities.append(et)
            continue
        cur = existing[et]
        cur_base = cur.get("base_fields", []) or []
        cur_custom = cur.get("custom_fields", []) or []
        merged = merge_model_definition(base_def.get("base_fields", []), cur_base + cur_custom)
        if (_normalize_fields(merged["base_fields"]) == _normalize_fields(cur_base)
                and _normalize_fields(merged["custom_fields"]) == _normalize_fields(cur_custom)):
            continue
        before_names = {f["name"] for f in cur_base + cur_custom}
        added_fields = sorted(f["name"] for f in merged["base_fields"] if f["name"] not in before_names)
        required_before = {f["name"] for f in cur_base + cur_custom if f.get("required")}
        demoted = sorted(f["name"] for f in merged["custom_fields"]
                         if f["name"] in required_before and not f.get("required"))
        to_write[et] = merged
        changed[et] = {"added_fields": added_fields, "demoted_fields": demoted}

    report = {"added_entities": sorted(added_entities), "changed": changed, "workflows_at_risk": []}
    if not to_write:
        return report

    # (guard inserted by Task 3.3 here)

    put_resp = httpx.put(_datacore_url(f"/models/{tenant_id}"), json={
        "model_definition": to_write,
        "source_filename": "base_model.json",
        "created_by": user["name"],
    }, timeout=30.0)
    if put_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to sync model")
    return report
```

Imports to add: `from fastapi import Header` (extend the existing fastapi import), `from pydantic import BaseModel` if not already, `from app.model_merge import merge_model_definition`. The stored model_definition may carry `_source_filename`/`_created_by` keys; they are ignored because only `base_fields`/`custom_fields` are read. **Confirm what DataCore's `/query` returns for `model_definition` in the models table** (string or dict) by reading `datacore/src/datacore/api/routes.py` query handler or `store.list_models`; the code above handles both.

Note on demotion detection: `merge_model_definition` demotes only *custom* (carried-forward) fields, so comparing `required_before` against merged `custom_fields` is exact.

## Task 3.3 — Preflight guard

Insert at the marked spot in Task 3.2:

```python
    try:
        pf = httpx.post(
            f"{settings.apexflow_backend_url}/api/workflows/{tenant_id}/model-preflight",
            json={"models": to_write},
            headers={"Authorization": authorization},
            timeout=30.0,
        )
        pf_ok = pf.status_code == 200
    except httpx.HTTPError:
        pf_ok = False
    if pf_ok:
        rank = {"current": 0, "stale": 1, "broken": 2}
        report["workflows_at_risk"] = [
            d for d in pf.json().get("definitions", [])
            if rank.get(d.get("health_after"), 2) > rank.get(d.get("health_before"), 2)
        ]
        if report["workflows_at_risk"] and not force:
            raise HTTPException(status_code=409, detail={"reason": "workflows_at_risk", **report})
    else:
        if not force:
            raise HTTPException(status_code=502, detail="Could not evaluate workflow impact; retry or force")
        report["preflight"] = "unavailable"
```

`settings` is already imported in `tenants.py` (`from app.config import settings`).

## Task 3.4 — Sync tests

**File:** `launchpad/backend/tests/test_tenants_api.py`. Replace the three `test_sync_defaults_*` tests (lines ~90–140) with the set below. The `client` fixture overrides `get_current_user`; the route now also requires an `Authorization` header, so every request passes `headers={"Authorization": "Bearer t"}`.

Helpers in the test file:
- `_base_model()` → `json.loads(open(tenants.BASE_MODEL_PATH).read())`.
- `_stored(et, base_fields, custom_fields=())` → a fake `/query` row `{"entity_type": et, "model_definition": {"base_fields": [...], "custom_fields": [...]}}`.
- `_complete_rows()` → one stored row per base-model type whose base_fields equal the base model's and custom_fields empty.
- `fake_httpx(monkeypatch, *, rows, preflight=None, preflight_error=False)` that monkeypatches `tenants.httpx.post` to answer DataCore `/query` with `rows` and the apexflow `/model-preflight` URL with `preflight` (a dict → 200, or raise `tenants.httpx.ConnectError("x")` when `preflight_error`), records PUTs via `tenants.httpx.put`, and records preflight request bodies. Distinguish by URL substring.

Tests (one per spec scenario):
1. `test_sync_adds_eight_lagging_application_fields_and_keeps_custom` — `registration_application` stored without the eight fields (take the base model's list and drop those names) plus custom `packet_notes`; every other type complete; preflight returns `{"definitions": []}`. Assert one PUT, its `model_definition` keys == `{"registration_application"}`, `base_fields` names == base model's, `packet_notes` in `custom_fields`, response `changed["registration_application"]["added_fields"]` == the eight sorted.
2. `test_sync_noop_sends_no_put_and_no_preflight` — all complete; PUT and preflight both raise if called; response `{"added_entities": [], "changed": {}, "workflows_at_risk": []}`.
3. `test_sync_writes_only_changed_types` — student complete, registration lagging; PUT keys exclude `student`.
4. `test_sync_leaves_tenant_only_type_alone` — add stored `scholarship`; not in PUT, not in report.
5. `test_sync_reports_demoted_fields` — registration stored with custom `channel_started` `required: True` no default, and lagging one base field; `demoted_fields == ["channel_started"]`.
6. `test_sync_409_when_workflow_would_go_stale` — preflight returns one def `current → stale`; expect 409, `detail["reason"] == "workflows_at_risk"`, no PUT.
7. `test_sync_force_writes_despite_risk` — same with body `{"force": true}`; 200, PUT sent, `workflows_at_risk` has 1.
8. `test_sync_no_risk_when_health_unchanged` — preflight `stale → stale`; 200, PUT sent, `workflows_at_risk == []`.
9. `test_sync_502_when_preflight_unavailable` — `preflight_error=True`; 502; no PUT.
10. `test_sync_force_through_preflight_failure` — `preflight_error=True`, force; 200, PUT sent, `preflight == "unavailable"`.
11. `test_sync_forwards_authorization_to_preflight` — recorded preflight headers include `Authorization: Bearer t`.
12. `test_sync_tenant_mismatch_403` — keep the existing test, add the header.
13. `test_sync_adds_missing_entity_type_whole` — remove `lead` from stored; `added_entities == ["lead"]`, PUT contains `lead` equal to the base model's.

**Mutations:** (a) remove the "nothing changed → continue" comparison so every type is written → test 3 fails. (b) change `if report["workflows_at_risk"] and not force:` to `if False:` → test 6 fails.

**Commit (3.2+3.3+3.4 may be one commit):** `feat(launchpad): field-level model sync with a published-workflow guard`

---

## Task 4.1 — `syncDefaultModel` client

**File:** `launchpad/frontend/src/api/client.ts` lines 169–175.

```ts
export interface SyncReport {
  added_entities: string[];
  changed: Record<string, { added_fields: string[]; demoted_fields: string[] }>;
  workflows_at_risk: { definition_id: string; name: string; version: number; health_before: string; health_after: string }[];
  preflight?: "unavailable";
}
export type SyncResult = { ok: true; report: SyncReport } | { ok: false; refused: SyncReport };

export async function syncDefaultModel(tenantId: string, force = false): Promise<SyncResult> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model/sync-defaults`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (res.status === 409) {
    const body = await res.json();
    return { ok: false, refused: body.detail ?? body };
  }
  if (!res.ok) throw new Error("Failed to sync default entities");
  return { ok: true, report: await res.json() };
}
```
Check how `authFetch` merges headers before adding `Content-Type`.

## Task 4.2 — Settings page

**File:** `launchpad/frontend/src/pages/TenantSettingsPage.tsx`.

Replace `syncMessage: string | null` with `syncReport: SyncReport | null`, `syncRefused: SyncReport | null`, `syncError: string | null`. `handleSyncDefaults(force = false)`: call `syncDefaultModel(user.tenant_id, force)`; on `ok` set report, refresh model info/entities as today; on refused set `syncRefused`. Render below the buttons, same inline-style conventions as the file:
- added entities line; per changed type a line `type: added a, b; demoted c` (omit empty halves);
- "Model already up to date." when report is empty;
- when `syncRefused`: list `name v{version}: {before} → {after}` and a button "Sync anyway" calling `handleSyncDefaults(true)`;
- when `report.preflight === "unavailable"`: a line saying workflow impact could not be checked.

`cd launchpad/frontend && npm run build && npm run lint`.

**Commit:** `feat(launchpad): settings page shows the sync report and offers a forced sync`

---

## Task 5.1 — `missing_fields` on the templates route

**File:** `apexflow/backend/app/api/designer.py`, `templates_route` (line ~376). Add a helper above it:

```python
def _missing_fields(steps: list[StepDef], models: dict[str, Any]) -> dict[str, list[str]]:
    """Template section picks absent from the tenant's CURRENT model of that
    type (base or custom). Models the tenant lacks entirely are reported by
    `missing_models`, not here. Derived from the picks themselves, so it
    cannot drift from the template (same reasoning as `missing_models`)."""
    out: dict[str, set[str]] = {}
    for step in steps:
        if step.type != "form":
            continue
        for raw in step.config.get("sections", []) or []:
            section = SectionDef.model_validate(raw)
            model = models.get(section.entity_model)
            if model is None:
                continue
            have = {f["name"] for f in (model.get("base_fields") or []) + (model.get("custom_fields") or [])}
            missing = {pick.name for pick in section.fields if pick.name not in have}
            if missing:
                out.setdefault(section.entity_model, set()).update(missing)
    return {et: sorted(names) for et, names in sorted(out.items())}
```
Import `SectionDef` from `app.workflows.schema` (extend the existing import). In the route's loop add `"missing_fields": _missing_fields(steps, models),` beside `missing_models`.

Tests in `test_designer_api.py` next to the existing templates tests. Use the real enrollment template's picks (`_referenced_models_of`-style derivation; read picks from `template_catalog()` so the test never hardcodes a list that a template edit invalidates):
1. `test_missing_fields_reports_exact_lagging_fields` — seed every referenced model complete (all picks present) except drop `handbook_acknowledged` and `signature_date` from `registration_application`; expect exactly `{"registration_application": ["handbook_acknowledged", "signature_date"]}` for enrollment.
2. `test_missing_fields_custom_field_satisfies_pick` — same but `signature_date` present in `custom_fields`; only `handbook_acknowledged` reported.
3. `test_missing_fields_excludes_missing_models` — no `contact` model; `contact` in `missing_models`, not in `missing_fields`.
4. `test_missing_fields_empty_when_complete` — `{}` on every entry.
5. `test_missing_fields_always_present_and_sorted`.

**Mutation:** change `if pick.name not in have` to `if pick.name in have` → tests 1 and 4 fail.

**Commit:** `feat(apexflow): templates derive the fields a tenant's model lacks`

## Task 5.2 — Frontend type and normalizer

- `apexflow/frontend/src/types/designer.ts` after `missing_models`: `missing_fields: Record<string, string[]>;` with a 3-line doc comment mirroring the one above it.
- `apexflow/frontend/src/api/designer.ts` `listTemplates`: add `missing_fields: entry.missing_fields ?? {},` with the same deploy-skew reasoning (one sentence appended to the existing comment).

## Task 5.3 — Gallery and dialog

**Files:** `apexflow/frontend/src/pages/TemplatesPage.tsx`, `apexflow/frontend/src/i18n/translations.ts` (en block near line 453, zh block near line 966).

Create `apexflow/frontend/src/editor/templatePicks.ts`:
```ts
import type { WorkflowStepDef } from '../types/designer.ts';

/** Picks the tenant's model lacks, removed per section of the matching
 * entity model. Everything else (section ids, modes, repeat, step order,
 * machine) is untouched. Applying a template against an older model is an
 * explicit admin choice (design D6); this is the stripping it names. */
export function stripMissingPicks(steps: WorkflowStepDef[], missing: Record<string, string[]>): WorkflowStepDef[] {
  if (Object.keys(missing).length === 0) return steps;
  return steps.map((step) => {
    if (step.type !== 'form') return step;
    const sections = (step.config?.sections ?? []) as { entity_model: string; fields: { name: string }[] }[];
    return { ...step, config: { ...step.config, sections: sections.map((s) => {
      const drop = new Set(missing[s.entity_model] ?? []);
      return drop.size === 0 ? s : { ...s, fields: s.fields.filter((f) => !drop.has(f.name)) };
    }) } };
  });
}

export function countMissing(missing: Record<string, string[]>): number {
  return Object.values(missing).reduce((n, list) => n + list.length, 0);
}

export function describeMissing(missing: Record<string, string[]>): string {
  return Object.entries(missing).map(([model, fields]) => `${model}: ${fields.join(', ')}`).join('; ');
}
```
Check `WorkflowStepDef.config` typing in `types/designer.ts` and adjust the cast to match.

In `TemplatesPage.tsx`:
- card: `const needsSetup = tpl.missing_models.length > 0 || countMissing(tpl.missing_fields) > 0;` show the warning block when `needsSetup`; keep the existing models sentence when models missing; add a second sentence from `templates.missingFieldsCard` with `{fields}` = `describeMissing(...)` when fields missing.
- dialog: add a note from `templates.missingFieldsDialog` when fields missing.
- confirm button label: `countMissing(...) > 0 ? t('templates.useCreateWithout').replace('{n}', String(n)) : t('templates.useCreate')`.
- `submitUseTemplate`: `steps: stripMissingPicks(definition.steps, activeTemplate.missing_fields)`.

Strings (en / zh):
- `templates.missingFieldsCard`: `Your model is missing fields this template fills: {fields}.` / `您的模型缺少此模板需要的字段：{fields}。`
- `templates.missingFieldsDialog`: `This tenant's model lacks {fields}. Syncing the model in LaunchPad under Tenant Settings → Sync default entities adds them. Creating now omits these fields from the workflow.` / `此租户的模型缺少 {fields}。在 LaunchPad 的「租户设置 → 同步默认实体」中同步模型即可添加。现在创建将从工作流中省略这些字段。`
- `templates.useCreateWithout`: `Create without {n} fields` / `创建（省略 {n} 个字段）`

## Task 5.4 — Tests and build

`apexflow/frontend/src/editor/__tests__/templatePicks.test.ts` (vitest, mirror `stageOps.test.ts` imports): matching model stripped; other model untouched; `{}` returns the same reference; non-form step untouched; deep-equal structure otherwise; `countMissing`/`describeMissing` basics.

**Mutation:** in `stripMissingPicks` change `!drop.has(f.name)` to `drop.has(f.name)` → the stripping test fails.

`cd apexflow/frontend && npm test && npm run build && npm run lint`.

**Commit (5.2–5.4 together):** `feat(apexflow): gallery shows missing fields and creates without them on request`

---

## Task 6.1 — Base-model rule in `CLAUDE.md`

Append to the root `CLAUDE.md` Conventions list:

> - **Base-model evolution** (`launchpad/backend/app/data/base_model.json`): new base fields ship `required: false` or carry a `default`. A required field with no default re-versions every live workflow on that model: `definition_health` turns `stale`, and `create_instance` refuses new instances until an admin publishes a version that collects it. LaunchPad's sync-defaults reports affected workflows and refuses without `force`.

The sync endpoint docstring (Task 3.2) already points to it.

## Task 6.2 — Deployment docs

- `docs/deployment/provisioning.md`: in the `launchpad-api` secrets/env list add `LAUNCHPAD_APEXFLOW_BACKEND_URL=http://apexflow-api.flycast:5910` with one line on why (sync-defaults preflight). **Verify the exact internal hostname against `docs/deployment/architecture.md` line ~52 and how `admindash-api` is configured to reach apexflow** (search provisioning.md for `APEXFLOW`); mirror that value exactly.
- `docs/deployment/release-runbook.md`: one note under ordering: when a release includes both, release `apexflow-v*` before `launchpad-v*` (LaunchPad calls apexflow's preflight).

**Commit:** `docs: base-model evolution rule and LaunchPad→apexflow preflight wiring`

---

## Final

- Full suites: `cd launchpad && uv run --extra dev pytest backend/tests -q`; `cd apexflow && uv run pytest backend/tests -q`; `cd apexflow/frontend && npm test && npm run build && npm run lint`; `cd launchpad/frontend && npm run build && npm run lint`.
- `cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py --dry-run` imports cleanly.
- Then `superpowers:finishing-a-development-branch`.
