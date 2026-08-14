# Error Boundaries + Template Model Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two classes of silent failure — a render throw that blanks the whole page with no explanation, and a workflow template that only reveals its missing-model prerequisite as a publish-time validation error.

**Architecture:** A per-app `ErrorBoundary` class component wrapping routed main content (nav survives, so the user can navigate away). Template prerequisites are *derived* server-side from each template's own steps via the existing `referenced_entity_models`, diffed against the tenant's models in the already-tenant-scoped `/templates` route, and surfaced as `missing_models` per catalog entry.

**Tech Stack:** Python 3 / FastAPI / pytest; React 19 + TypeScript + Vite + vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-error-boundary-and-template-prereqs-design.md`

## Global Constraints

- **No component testing exists in any of these frontends.** All three run `vitest` with `environment: 'node'` and `include: ['src/**/*.test.ts', ...]` — `.tsx` is never matched, and there is no jsdom or Testing Library dependency. **Do not add component tests, jsdom, Testing Library, or change vitest config.** React work is verified by `tsc -b`, `npm run lint`, `npm run build`, and stated manual checks.
- **Every i18n key must exist in both `en-US` and `zh-CN`.** apexflow and admindash have a parity test (`src/i18n/__tests__/translations.test.ts`) asserting identical key sets and no blank values. **familyhub has no such test** — its parity must be checked by hand.
- **`fetch_models` returns `None`** for a model the tenant never set up (`definitions.py:84-85` — `{et: dc.get_model_definition(...)}`). That `None` is the signal to diff on. Never treat a missing model as an error at catalog time.
- **Do not union `STANDARD_BUNDLE_MODELS`** into the prerequisite check. A standard model the tenant lacks is just as missing, and this is a per-template question.
- **Verify tests by mutation.** For every test written, break the implementation it covers and confirm the test fails for the stated reason. Watch for stale `__pycache__` masking a change.
- **Commit after every task.**

## Deviation from the spec, deliberate

The spec proposed "a pure helper for the badge/copy decision, so the logic is testable." **Do not build one.** The actual logic is `missing_models.length > 0` and a `.join(', ')`; a module plus test file for that is ceremony, not coverage. The condition renders inline. This is recorded here rather than silently dropped.

---

### Task 1: Backend — `missing_models` on the templates route

**Files:**
- Modify: `apexflow/backend/app/api/designer.py:298-306` (`templates_route`)
- Test: `apexflow/backend/tests/test_designer_api.py` (append to the `--- GET .../templates` section, which begins at line 609)

**Interfaces:**
- Consumes (all already imported in `designer.py:40-47`): `template_catalog`, `defs.referenced_entity_models`, `defs.fetch_models`, `StepDef`, `require_staff_tenant`.
- Produces: `GET /api/workflows/{tenant_id}/templates` → `{"templates": [{..., "missing_models": ["enrollment"]}]}`. Every entry carries the key; `[]` when nothing is missing.

- [ ] **Step 1: Write the failing tests**

Append to `apexflow/backend/tests/test_designer_api.py`. The `client` and `fake_dc` fixtures and `TENANT` already exist in this file. `fake_dc.set_model(tenant_id, entity_type, definition)` (`fakes.py:296-298`) seeds a tenant model — no existing test uses it, so you are its first caller.

```python
def _model(*field_names):
    """Minimal model definition — only presence matters to this route."""
    return {
        "base_fields": [{"name": n, "type": "str", "required": False} for n in field_names],
        "custom_fields": [],
    }


def _entry_by_id(templates, template_id):
    return next(t for t in templates if t["template_id"] == template_id)


def _referenced_models_of(template_id):
    """The entity models a shipped template's sections actually name —
    derived the same way the route does, so these tests never hardcode a
    model list that a template edit could silently invalidate."""
    from app.templates.catalog import template_catalog
    from app.workflows import definitions as defs
    from app.workflows.schema import StepDef

    entry = _entry_by_id(template_catalog(), template_id)
    steps = [StepDef.model_validate(s) for s in entry["definition"]["steps"]]
    return defs.referenced_entity_models(steps)


def test_templates_report_missing_models_when_tenant_has_none(client, fake_dc):
    resp = client.get(f"/api/workflows/{TENANT}/templates")
    assert resp.status_code == 200

    for entry in resp.json()["templates"]:
        expected = sorted(_referenced_models_of(entry["template_id"]))
        assert entry["missing_models"] == expected


def test_templates_report_no_missing_models_when_tenant_has_all(client, fake_dc):
    from app.templates.catalog import template_catalog

    for entry in template_catalog():
        for et in _referenced_models_of(entry["template_id"]):
            fake_dc.set_model(TENANT, et, _model("first_name"))

    resp = client.get(f"/api/workflows/{TENANT}/templates")

    for entry in resp.json()["templates"]:
        assert entry["missing_models"] == []


def test_templates_report_only_the_models_the_tenant_lacks(client, fake_dc):
    """Seed every referenced model except one, and only that one is reported."""
    from app.templates.catalog import template_catalog

    target = template_catalog()[0]["template_id"]
    referenced = sorted(_referenced_models_of(target))
    assert referenced, "this test needs a template that references at least one model"
    withheld = referenced[0]

    for entry in template_catalog():
        for et in _referenced_models_of(entry["template_id"]):
            if et != withheld:
                fake_dc.set_model(TENANT, et, _model("first_name"))

    resp = client.get(f"/api/workflows/{TENANT}/templates")
    entry = _entry_by_id(resp.json()["templates"], target)

    assert entry["missing_models"] == [withheld]


def test_missing_models_is_present_on_every_entry(client, fake_dc):
    """The key is never absent — the frontend reads it unconditionally."""
    for entry in client.get(f"/api/workflows/{TENANT}/templates").json()["templates"]:
        assert "missing_models" in entry
        assert isinstance(entry["missing_models"], list)


def test_missing_models_is_sorted(client, fake_dc):
    """Order must be stable so the rendered copy doesn't reshuffle between
    requests — `fetch_models` iterates a set, which has no stable order."""
    for entry in client.get(f"/api/workflows/{TENANT}/templates").json()["templates"]:
        assert entry["missing_models"] == sorted(entry["missing_models"])


def test_templates_route_still_serves_the_whole_catalog(client, fake_dc):
    """`missing_models` is additive — the existing payload must be intact."""
    from app.templates.catalog import template_catalog

    templates = client.get(f"/api/workflows/{TENANT}/templates").json()["templates"]
    expected = template_catalog()

    assert [t["template_id"] for t in templates] == [e["template_id"] for e in expected]
    for got, want in zip(templates, expected):
        assert got["name"] == want["name"]
        assert got["description"] == want["description"]
        assert got["definition"]["steps"] == want["definition"]["steps"]
        assert got["definition"]["machine"] == want["definition"]["machine"]
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apexflow && uv run pytest backend/tests/test_designer_api.py -k "missing_models or templates_report or whole_catalog" -v
```

Expected: the `missing_models` tests FAIL with `KeyError: 'missing_models'`. `test_templates_route_still_serves_the_whole_catalog` should already PASS — it is a regression guard for the existing payload.

- [ ] **Step 3: Implement**

Replace `templates_route` (`apexflow/backend/app/api/designer.py:298-306`) with:

```python
@router.get("/{tenant_id}/templates")
def templates_route(tenant_id: str, user: dict = Depends(require_staff_tenant)):
    """Shipped workflow template catalog for the designer's template gallery
    (Task 6), each entry annotated with `missing_models` for THIS tenant.

    The catalog itself is platform-wide, but the annotation is not: a
    template binds sections to entity models (`signup`'s `signup_section` ->
    `enrollment`), and a tenant that has not set that model up can apply the
    template and only discover the problem at publish, as
    `section '...' references unknown entity model '...'` — an error that
    reads like an authoring mistake rather than a missing prerequisite.

    DERIVED, never declared. `referenced_entity_models` reads the models
    straight off the template's own form sections, so this can never drift
    out of sync with the steps the way a hand-maintained `required_models`
    field on each `catalog_entry()` would.

    `fetch_models` yields `None` for a model the tenant never set up
    (`definitions.py:84-85`), which is exactly the diff signal. Sorted so the
    rendered copy is stable — `referenced_entity_models` returns a set.

    `STANDARD_BUNDLE_MODELS` is deliberately NOT unioned in here: that
    constant exists to give the section-editor's picker a full menu, whereas
    this asks a per-template question, and a standard model the tenant lacks
    is just as missing as any other.
    """
    token = user.get("_token")

    entries = []
    for entry in template_catalog():
        steps = [StepDef.model_validate(s) for s in entry["definition"]["steps"]]
        models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps), token)
        entries.append({
            **entry,
            "missing_models": sorted(et for et, model in models.items() if model is None),
        })

    return {"templates": entries}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apexflow && uv run pytest backend/tests/test_designer_api.py -k "missing_models or templates_report or whole_catalog" -v
```

Expected: 6 passed.

- [ ] **Step 5: Verify the tests bite (mutation check)**

Run each mutation, confirm the named test fails, then revert.

1. Change the comprehension to `if model is not None` → `test_templates_report_missing_models_when_tenant_has_none` and `..._only_the_models_the_tenant_lacks` must fail.
2. Drop the `sorted(...)`, leaving a bare generator wrapped in `list(...)` → `test_missing_models_is_sorted` must fail (it may pass by luck on a one-element set; if so, note that in your report and rely on mutation 1 for coverage of that path).
3. Remove `"missing_models"` from the dict entirely → `test_missing_models_is_present_on_every_entry` must fail.
4. Replace `entry` spread with `{"template_id": entry["template_id"], "missing_models": [...]}` → `test_templates_route_still_serves_the_whole_catalog` must fail.

- [ ] **Step 6: Full backend suite**

```bash
cd apexflow && uv run pytest backend/tests/ -q
```

Expected: no new failures against the pre-change baseline.

- [ ] **Step 7: Commit**

```bash
git add apexflow/backend/app/api/designer.py apexflow/backend/tests/test_designer_api.py
git commit -m "feat(apexflow): report per-tenant missing models on the template catalog"
```

---

### Task 2: Frontend — template prerequisite warning

**Files:**
- Modify: `apexflow/frontend/src/types/designer.ts:291-296` (`TemplateCatalogEntry`)
- Modify: `apexflow/frontend/src/pages/TemplatesPage.tsx` (card at `:174-193`, apply dialog at `:197+`)
- Modify: `apexflow/frontend/src/pages/TemplatesPage.css`
- Modify: `apexflow/frontend/src/i18n/translations.ts` (both locales)

**Interfaces:**
- Consumes: `missing_models: string[]` from Task 1.
- Produces: nothing downstream.

- [ ] **Step 1: Extend the type**

In `apexflow/frontend/src/types/designer.ts`, add to `TemplateCatalogEntry` (currently `:291-296`):

```ts
export interface TemplateCatalogEntry {
  template_id: string;
  name: string;
  description: string;
  definition: TemplateDefinition;
  /** Entity models this template's sections reference that THIS tenant does
   * not have (`api/designer.py`'s `templates_route`). Non-empty means the
   * template can be applied but not published until the models exist —
   * launchpad's "Sync default entities" provisions the shipped ones. */
  missing_models: string[];
}
```

- [ ] **Step 2: Add i18n keys — both locales**

In `apexflow/frontend/src/i18n/translations.ts`, add near the other `templates.*` keys.

`en-US`:
```ts
    'templates.missingModelsBadge': 'Needs setup',
    'templates.missingModelsCard':
      'Needs {models} — this tenant does not have {count, one: that model, other: those models} yet.',
    'templates.missingModelsDialog':
      'This template collects data into {models}, which this tenant does not have yet. You can still create the workflow and author it now, but it cannot be published until the {count, one: model exists, other: models exist}. An administrator can add {count, one: it, other: them} in LaunchPad under Tenant Settings → Sync default entities.',
```

`zh-CN`:
```ts
    'templates.missingModelsBadge': '需要配置',
    'templates.missingModelsCard': '需要 {models}——此租户尚未配置。',
    'templates.missingModelsDialog':
      '此模板会将数据写入 {models}，但此租户尚未配置。您仍可以创建并编辑该工作流，但在配置完成前无法发布。管理员可在 LaunchPad 的「租户设置 → 同步默认实体」中添加。',
```

**STOP — the `en-US` strings above are deliberately wrong.** `t()` in this codebase is a pure lookup: `(key) => translations[locale]?.[key] ?? key` (`hooks/useTranslation.ts:28-29`). It does no interpolation at all — callers do their own `.replace()`. ICU syntax would render literally to users as `{count, one: that model, other: those models}`. Use these count-neutral strings instead:

```ts
    'templates.missingModelsCard': 'Needs {models}, which this tenant does not have yet.',
    'templates.missingModelsDialog':
      'This template collects data into {models}, which this tenant does not have yet. You can still create the workflow and author it now, but it cannot be published until those models exist. An administrator can add them in LaunchPad under Tenant Settings → Sync default entities.',
```

Use the count-neutral versions. The ICU variants above are shown only so you recognise and avoid that trap.

- [ ] **Step 3: Render the warning on the card**

In `apexflow/frontend/src/pages/TemplatesPage.tsx`, inside the `<article className="template-card">` (currently `:176-192`), after the `<dl className="template-card-counts">` block and before the `<Button>`:

```tsx
              {tpl.missing_models.length > 0 && (
                <p className="template-card-warning" role="note">
                  <strong>{t('templates.missingModelsBadge')}</strong>{' '}
                  {t('templates.missingModelsCard').replace(
                    '{models}',
                    tpl.missing_models.join(', '),
                  )}
                </p>
              )}
```

- [ ] **Step 4: Explain it in the apply dialog**

In the same file, inside the `<Modal>` body (the dialog opened by `openUseModal`), above the existing name field:

```tsx
        {activeTemplate && activeTemplate.missing_models.length > 0 && (
          <p className="templates-dialog-warning" role="note">
            {t('templates.missingModelsDialog').replace(
              '{models}',
              activeTemplate.missing_models.join(', '),
            )}
          </p>
        )}
```

`Use template` stays enabled — applying creates a valid draft that merely cannot publish yet, which is a legitimate state.

- [ ] **Step 5: Style it**

Append to `apexflow/frontend/src/pages/TemplatesPage.css`:

```css
/* A template whose sections bind to entity models this tenant hasn't set
   up. Advisory, not blocking — the draft is valid, it just can't publish
   until the models exist. Toned as a warning rather than an error for
   exactly that reason. */
.template-card-warning,
.templates-dialog-warning {
  margin: var(--space-3) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--attn);
  border-radius: var(--radius-md);
  background: var(--attn-tint);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.templates-dialog-warning {
  margin: 0 0 var(--space-4);
}
```

`--attn` and `--attn-tint` are confirmed present in `apexflow/frontend/src/styles/theme.css` — use them as written.

- [ ] **Step 6: Verify**

```bash
cd apexflow/frontend && npx tsc -b && npm run lint && npm run test && npm run build
```

Expected: all clean. `tsc` will fail if any code path builds a `TemplateCatalogEntry` without `missing_models` — check the test/fixture sites it names.

- [ ] **Step 7: Manual check**

The apexflow stack may be running locally (frontend `:5901`, backend `:5911`). If it is, open the Templates gallery: with an unsynced tenant, the "Program Signup" card should carry the warning naming `enrollment`, and the apply dialog should explain it while leaving the button enabled. If you cannot run the stack, say so plainly and list what went unverified. **Do not claim to have run it if you did not.**

- [ ] **Step 8: Commit**

```bash
git add apexflow/frontend/src
git commit -m "feat(apexflow): warn when a template needs entity models the tenant lacks"
```

---

### Task 3: ErrorBoundary — apexflow

Establishes the component; Task 4 ports it.

**Files:**
- Create: `apexflow/frontend/src/components/ErrorBoundary.tsx`
- Create: `apexflow/frontend/src/components/ErrorBoundary.css`
- Modify: `apexflow/frontend/src/App.tsx`
- Modify: `apexflow/frontend/src/i18n/translations.ts` (both locales)

**Interfaces:**
- Produces, for Task 4 to port: `ErrorBoundary` (default export) and `RoutedErrorBoundary` (named export) from `components/ErrorBoundary.tsx`.

- [ ] **Step 1: Write the component**

Create `apexflow/frontend/src/components/ErrorBoundary.tsx`:

```tsx
// Catches render errors below it and shows them, instead of letting React
// unmount the whole root.
//
// Why this exists: there was no boundary anywhere in this app, so ANY throw
// during render produced a blank white page with no in-app indication of
// what happened. A duplicate-React bug (fixed in 7861f80) hid behind that
// for an entire debugging session — the error was in the browser console the
// whole time and nothing surfaced it.
//
// Deliberately a CLASS component: `getDerivedStateFromError` has no hook
// equivalent, and React offers no functional error-boundary API.
//
// It renders the error text on purpose. This is an internal staff tool
// behind auth, and the message IS the diagnosis. FamilyHub's copy of this
// component deliberately does NOT — its users are parents.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { Button } from './ui/Button.tsx';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this clears a caught error. Pass the current location so
   * navigating away recovers, instead of leaving a sticky error panel that
   * outlives the route that produced it. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/** The visible panel. Split out as a function component so it can use
 * hooks — the boundary itself cannot, being a class. */
function ErrorPanel({ error, componentStack }: { error: Error; componentStack: string | null }) {
  const { t } = useTranslation();
  const details = `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\n${componentStack ?? ''}`;

  return (
    <div className="error-boundary" role="alert">
      <h2 className="error-boundary-title">{t('errorBoundary.title')}</h2>
      <p className="error-boundary-body">{t('errorBoundary.body')}</p>

      <pre className="error-boundary-message">{error.message || error.name}</pre>

      {componentStack ? (
        <details className="error-boundary-details">
          <summary>{t('errorBoundary.showStack')}</summary>
          <pre>{componentStack}</pre>
        </details>
      ) : null}

      <div className="error-boundary-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(details)}
        >
          {t('errorBoundary.copy')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept: the console is still where a developer looks first, and this
    // preserves the stack React would otherwise swallow once caught.
    console.error('Unhandled render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: null });
    }
  }

  render() {
    if (this.state.error) {
      return <ErrorPanel error={this.state.error} componentStack={this.state.componentStack} />;
    }
    return this.props.children;
  }
}

/** `ErrorBoundary` wired to the router, so navigating away clears the error.
 * Must be rendered INSIDE the router — `useLocation` throws otherwise. */
export function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
```

- [ ] **Step 2: Write the stylesheet**

Create `apexflow/frontend/src/components/ErrorBoundary.css`:

```css
.error-boundary {
  max-width: 720px;
  margin: var(--space-8) auto;
  padding: var(--space-6);
  border: 1px solid var(--danger);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.error-boundary-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-lg);
}

.error-boundary-body {
  margin: 0 0 var(--space-4);
  color: var(--ink-faint);
}

/* The message is the payload — wrap it rather than clipping, and keep it
   selectable so it can be pasted into a bug report. */
.error-boundary-message {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.error-boundary-details {
  margin-bottom: var(--space-4);
  font-size: var(--text-xs);
}

.error-boundary-details pre {
  margin: var(--space-2) 0 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.error-boundary-actions {
  display: flex;
  gap: var(--space-2);
}
```

Every custom property used here is confirmed present in `apexflow/frontend/src/styles/theme.css` — use them as written. (Task 4 must re-check them against admindash's and familyhub's own stylesheets, which are separate.)

- [ ] **Step 3: Add i18n keys — both locales**

`en-US`:
```ts
    'errorBoundary.title': 'Something broke on this screen',
    'errorBoundary.body':
      'The page stopped rendering. The error is below — copy it into a bug report, or reload to try again.',
    'errorBoundary.showStack': 'Component stack',
    'errorBoundary.copy': 'Copy details',
    'errorBoundary.reload': 'Reload',
```

`zh-CN`:
```ts
    'errorBoundary.title': '此页面出现故障',
    'errorBoundary.body': '页面渲染中断。错误信息如下——可复制并提交问题报告，或重新加载重试。',
    'errorBoundary.showStack': '组件堆栈',
    'errorBoundary.copy': '复制详情',
    'errorBoundary.reload': '重新加载',
```

- [ ] **Step 4: Wire it into the app shell**

In `apexflow/frontend/src/App.tsx`, import it and wrap the inner `<Routes>` — the one inside `<main className="app-main">`, **not** the outer route table. `AppNav` must stay outside the boundary so a crash leaves the user able to navigate away.

```tsx
import { RoutedErrorBoundary } from './components/ErrorBoundary.tsx';
```

```tsx
              <main className="app-main" id="main-content" tabIndex={-1}>
                <RoutedErrorBoundary>
                  <Routes>
                    <Route path="/" element={<DefinitionsPage />} />
                    <Route path="/definitions/:entityId" element={<EditorPage />} />
                    <Route path="/templates" element={<TemplatesPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </RoutedErrorBoundary>
              </main>
```

`RoutedErrorBoundary` calls `useLocation`, so it must sit inside the router. It does here — this `<main>` is already rendered within the route tree.

- [ ] **Step 5: Verify it compiles and passes**

```bash
cd apexflow/frontend && npx tsc -b && npm run lint && npm run test && npm run build
```

Expected: all clean, i18n parity test green.

- [ ] **Step 6: Prove the boundary actually catches (manual, required)**

A boundary that doesn't catch is worse than none. **This cannot be automated here** — there is no jsdom or Testing Library, and adding either is out of scope per the Global Constraints. Do this by hand:

1. Temporarily add `throw new Error('boundary smoke test');` at the top of `DefinitionsPage`'s component body.
2. `npm run dev`, load the app.
3. Confirm: the nav is still visible, the error panel shows `boundary smoke test`, and the component stack expands.
4. Navigate to Templates via the nav and confirm the error clears (the `resetKey` path).
5. **Remove the throw.** Re-run `npx tsc -b && npm run build` to confirm the tree is clean.

Record in your report exactly what you observed at each of steps 3-4. If you could not run the dev server, say so plainly and list what went unverified rather than claiming a pass.

- [ ] **Step 7: Commit**

```bash
git add apexflow/frontend/src
git commit -m "feat(apexflow): error boundary around routed content"
```

---

### Task 4: ErrorBoundary — admindash and familyhub

**Files:**
- Create: `admindash/frontend/src/components/ErrorBoundary.tsx`, `.css`
- Create: `familyhub/frontend/src/components/ErrorBoundary.tsx`, `.css`
- Modify: `admindash/frontend/src/App.tsx`, `familyhub/frontend/src/App.tsx`
- Modify: both apps' `src/i18n/translations.ts`

**Interfaces:**
- Consumes: the component from Task 3, ported.

- [ ] **Step 1: Port to admindash**

Copy Task 3's `ErrorBoundary.tsx` and `.css` into `admindash/frontend/src/components/`, adjusting only:
- the import of `Button` to admindash's own `./ui/Button.tsx` — **check whether it is a default or named export in this app and match it**;
- the import of `useTranslation` to admindash's own hook path;
- any theme custom property that doesn't exist in admindash's stylesheets.

Add the same five i18n keys to both locales in `admindash/frontend/src/i18n/translations.ts`.

Wire it in `admindash/frontend/src/App.tsx` around the inner `<Routes>` inside `<main className="app-main">` (`:64-65`), leaving `<Navbar />` (`:62`) outside.

- [ ] **Step 2: Port to familyhub — parent-facing variant**

FamilyHub's users are parents. **This variant must not show the error message, the stack, or a copy button** — a stack trace mid-registration is alarming and useless to them. Replace `ErrorPanel`'s body with:

```tsx
function ErrorPanel() {
  const { t } = useTranslation();
  return (
    <div className="error-boundary" role="alert">
      <h2 className="error-boundary-title">{t('errorBoundary.title')}</h2>
      <p className="error-boundary-body">{t('errorBoundary.body')}</p>
      <div className="error-boundary-actions">
        <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  );
}
```

Keep `componentDidCatch`'s `console.error` — it costs the parent nothing and is how a developer diagnoses a report. Drop the `componentStack` state, since nothing renders it.

familyhub i18n keys:

`en-US`:
```ts
    'errorBoundary.title': 'Something went wrong',
    'errorBoundary.body':
      "Sorry — this page didn't load properly. Please try again. If it keeps happening, contact your school and let them know what you were doing.",
    'errorBoundary.reload': 'Try again',
```

`zh-CN`:
```ts
    'errorBoundary.title': '出现问题',
    'errorBoundary.body': '抱歉，此页面未能正常加载。请重试。如果问题持续出现，请联系学校并说明您当时的操作。',
    'errorBoundary.reload': '重试',
```

Wire it in `familyhub/frontend/src/App.tsx` around the `<Routes>` inside `<main className="app-main">` (`:16-17`).

**familyhub has no i18n parity test** — verify by hand that both locales received all three keys and that no key exists in one locale only.

- [ ] **Step 3: Verify both**

```bash
cd admindash/frontend && npx tsc -b && npm run test && npm run build
cd ../../familyhub/frontend && npx tsc -b && npm run test && npm run build
```

Expected: clean. Note that `npm run lint` in both apps reports **5 pre-existing errors** (`set-state-in-effect` in `DynamicForm.tsx`/`AuthContext.tsx`, `react-refresh/only-export-components` in three context files). Those are unrelated to this work and present on `main` — confirm the count is still exactly 5 and that none names a file you touched.

- [ ] **Step 4: Prove each boundary catches (manual, required)**

Repeat Task 3 Step 6's throw-and-observe for **each** app. For familyhub, additionally confirm the panel shows **no** error text, **no** stack, and **no** copy button — only the apology and "Try again". Remove both throws afterward and re-run the builds.

Record what you observed per app. If you could not run a dev server for one of them, say which and what went unverified.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src familyhub/frontend/src
git commit -m "feat(admindash,familyhub): error boundary around routed content"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Per-app `ErrorBoundary`, class component, not shared | 3, 4 |
| Wraps routed main content; nav survives | 3 Step 4; 4 Steps 1-2 |
| Renders error text in staff apps | 3 Step 1 |
| familyhub: apology only, no stack | 4 Step 2 |
| Reset on navigation | 3 Step 1 (`RoutedErrorBoundary`, `componentDidUpdate`) |
| `missing_models` derived via `referenced_entity_models` | 1 Step 3 |
| No `STANDARD_BUNDLE_MODELS` union | 1 Step 3 (stated in docstring) |
| Gallery warns, does not block | 2 Steps 3-4 |
| Points at launchpad Sync default entities | 2 Step 2 (dialog copy) |
| Backend tests: has-all / lacks-one / all-missing / key always present | 1 Step 1 |
| Mutation verification | 1 Step 5 |
| No component tests invented | Global Constraints; 3 Step 6 and 4 Step 4 are manual by design |

The spec proposed a pure frontend helper for the badge decision; the plan explicitly drops it as ceremony and says so under "Deviation from the spec, deliberate" — the only intentional divergence.

**Placeholder scan:** No `TBD`/`TODO`/"handle errors appropriately"/"similar to Task N". Task 4 references Task 3's component by path and states exactly which parts change, rather than saying "same as Task 3".

**Type consistency:** `missing_models: string[]` is defined in Task 1's response shape and Task 2's `TemplateCatalogEntry`, and read as `.length`/`.join` in Task 2 Steps 3-4. `ErrorBoundary` (default) and `RoutedErrorBoundary` (named) are defined in Task 3 Step 1 and imported under those exact names in Task 3 Step 4 and Task 4 Step 1. `resetKey` is spelled identically in the props interface, `componentDidUpdate`, and `RoutedErrorBoundary`.

**Trap flagged inline:** Task 2 Step 2 deliberately shows ICU plural syntax and then tells the implementer not to use it, because `t()` here is a plain `.replace()` — that mistake would otherwise render literal `{count, one: …}` text to users.
