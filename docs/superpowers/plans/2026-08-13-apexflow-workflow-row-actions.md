# ApexFlow Workflow Row Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `⋯` overflow menu on ApexFlow's workflows list with one row per lineage, a single `Open` button, and a detail drawer holding versions, facts, and a lifecycle ladder — and enforce one draft per lineage.

**Architecture:** All decision logic moves into two pure TypeScript modules (`utils/lineage.ts`, `utils/lifecycleLadder.ts`) that are unit-tested; the React layer becomes thin rendering over them. Draft creation moves off the browser's direct DataCore write onto a new `new_draft` action on ApexFlow's existing typed-action endpoint, which enforces the one-draft rule server-side.

**Tech Stack:** Python 3 / FastAPI / pytest (backend); React 19 + TypeScript + Vite + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-13-apexflow-workflow-row-actions-design.md`

## Global Constraints

- **No React component tests exist in ApexFlow.** `apexflow/frontend/vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/*.test.ts', 'src/**/__tests__/*.test.ts']` — `.tsx` is not matched and there is no jsdom or Testing Library dependency. Do **not** add component tests or new test tooling. React changes are verified by `npm run build` (which runs `tsc -b`), `npm run lint`, and a browser check.
- **Every i18n key must exist in both locales.** `src/i18n/translations.ts` exports `Record<Locale, ...>` for `'en-US' | 'zh-CN'`, and `src/i18n/__tests__/translations.test.ts` asserts identical key sets and no blank values. Adding a key to one locale only will fail that test. Removing a key requires removing it from both.
- **`machine` and `steps` are JSON-encoded STRINGS on the DataCore wire**, not nested objects. `entity_base_data(row)` preserves them as-is; do not re-encode or parse them in the new backend path.
- **`version` arrives flattened as a string.** Backend coerces with `defs._as_int`; frontend coerces with `asNumber` from `utils/numeric.ts`. Never do arithmetic on the raw value — `"1" + 1 === "11"` in JS.
- **`retired` is a legacy alias for `archived`.** Never string-compare either value. Backend uses `defs.is_archived(row)`; frontend uses `isArchived(status)` from `types/designer.ts`.
- **Verify tests by mutation.** For every test written, break the implementation it covers and confirm the test fails for the stated reason before moving on. A green suite that never bit is not evidence. Watch for stale `__pycache__` masking a change.
- **Commit after every task.**

---

### Task 1: Backend `new_draft` action

Adds the server-side one-draft rule. Nothing in the frontend uses it yet.

**Files:**
- Modify: `apexflow/backend/app/workflows/definitions.py` (add two functions after `delete_definition`, which ends at line 391)
- Modify: `apexflow/backend/app/api/definitions.py:45-72` (add one dispatch branch)
- Test: `apexflow/backend/tests/test_definitions_api.py` (append)

**Interfaces:**
- Consumes: existing `require_definition_row`, `is_archived`, `entity_base_data`, `_as_int`, `dc.dc_create`, `dc.list_entities` — all already imported in `definitions.py`.
- Produces: `defs.new_draft_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict` returning the created DataCore row. HTTP: `POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions` with body `{"action": "new_draft"}`.

- [ ] **Step 1: Write the failing tests**

Append to `apexflow/backend/tests/test_definitions_api.py`. The helpers `_seed_definition`, `act`, `client`, `fake_dc`, and `TENANT` already exist in this file.

```python
# --- new_draft ----------------------------------------------------------


def test_new_draft_creates_next_version_from_published(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="active")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 200
    row = resp.json()
    assert row["status"] == "draft"
    assert int(row["version"]) == 4
    assert row["definition_id"] == "enroll"
    # A brand-new row, not a mutation of the published one.
    assert row["entity_id"] != published


def test_new_draft_carries_lineage_status_forward(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="deprecated")

    row = act(client, published, "new_draft").json()

    assert row["lineage_status"] == "deprecated"


def test_new_draft_copies_authored_content(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", name="Enrollment",
                                 channel_access="family")

    row = act(client, published, "new_draft").json()

    assert row["name"] == "Enrollment"
    assert row["channel_access"] == "family"
    # machine/steps stay JSON-encoded strings across the copy.
    assert json.loads(row["machine"]) == _valid_machine()
    assert json.loads(row["steps"]) == _valid_steps()


def test_new_draft_refuses_when_a_draft_already_exists(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published")
    existing = _seed_definition(fake_dc, definition_id="enroll", version=4,
                                status="draft")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["reason"] == "draft_exists"
    assert detail["entity_id"] == existing


def test_new_draft_ignores_a_draft_in_another_lineage(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published")
    _seed_definition(fake_dc, definition_id="camp", version=1, status="draft")

    assert act(client, published, "new_draft").status_code == 200


def test_new_draft_refuses_on_an_archived_lineage(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="archived")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_archived"


def test_new_draft_refuses_on_a_retired_lineage(client, fake_dc):
    """`retired` is the legacy alias for `archived` and must gate identically."""
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="retired")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_archived"


def test_new_draft_refuses_on_a_draft_row(client, fake_dc):
    draft = _seed_definition(fake_dc, definition_id="enroll", version=1, status="draft")

    resp = act(client, draft, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_published"


def test_new_draft_refuses_on_a_superseded_row(client, fake_dc):
    superseded = _seed_definition(fake_dc, definition_id="enroll", version=1,
                                  status="superseded")

    resp = act(client, superseded, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_published"


def test_new_draft_404s_on_an_unknown_entity(client, fake_dc):
    assert act(client, "no-such-entity", "new_draft").status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apexflow && uv run pytest backend/tests/test_definitions_api.py -k new_draft -v
```

Expected: all FAIL with 400 `Unknown action: 'new_draft'` (the dispatcher's fallthrough), except the 404 test which may already pass incidentally — that is fine, it is a guard against regression.

- [ ] **Step 3: Add the service functions**

In `apexflow/backend/app/workflows/definitions.py`, immediately after `delete_definition` (ends line 391) and before the `# --- model-impact` comment:

```python
def get_draft_definition(tenant_id: str, lineage_definition_id: str,
                         token: str | None = None) -> dict | None:
    """The tenant's current draft row for one lineage, or None.

    Filtered in Python rather than via a SQL `where`, for the same reason
    `get_published_definition` is: on a new tenant those flattened columns may
    not be materialized yet, and a predicate naming one is a DuckDB binder
    error (400), not an empty result.
    """
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_definition_id)]
    rows = [r for r in rows if r.get("status") == "draft"]
    return rows[0] if rows else None


def new_draft_definition(tenant_id: str, entity_id: str,
                         token: str | None = None) -> dict:
    """Open the next draft version of a published lineage.

    AT MOST ONE DRAFT PER LINEAGE. This is not tidiness — it is what keeps
    `version` unique within a lineage. The version of a new draft is
    `published.version + 1`, and `publish_definition` only ever supersedes the
    PRIOR PUBLISHED row, so no superseded row can sit above the published one.
    Allow a second concurrent draft and both get the same number; once both are
    published in turn, `machine._pinned_definition_row` — which matches on
    `(definition_id, version)` and returns `rows[0]` — resolves every running
    instance's machine from whichever row `list_entities` happens to return
    first.

    This lives here rather than in the browser because the frontend previously
    created drafts with a direct generic `createEntity` write, bypassing this
    module entirely: a UI-only guard would be advisory, and two tabs open on the
    list would both see "no draft" and both create one.

    409 `not_published` on any other row (lifecycle reads the published row);
    409 `lineage_archived` because a copy would carry `archived` forward onto a
    fresh draft; 409 `draft_exists` carrying the existing draft's `entity_id`
    so the caller can navigate to it.
    """
    row = require_definition_row(tenant_id, entity_id, token)

    if row.get("status") != "published":
        raise HTTPException(409, {
            "reason": "not_published",
            "status": row.get("status"),
        })

    if is_archived(row):
        raise HTTPException(409, {
            "reason": "lineage_archived",
            "lineage_status": row.get("lineage_status"),
        })

    existing = get_draft_definition(tenant_id, row.get("definition_id"), token)
    if existing is not None:
        raise HTTPException(409, {
            "reason": "draft_exists",
            "entity_id": existing.get("entity_id"),
        })

    base = entity_base_data(row)
    base["status"] = "draft"
    base["version"] = _as_int(row.get("version")) + 1
    return dc.dc_create(tenant_id, "workflow_definition", base, token)
```

- [ ] **Step 4: Wire the route**

In `apexflow/backend/app/api/definitions.py`, add this branch after the `delete` branch (line 70) and before the `raise HTTPException(400, ...)`:

```python
    if body.action == "new_draft":
        return defs.new_draft_definition(tenant_id, entity_id, token)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apexflow && uv run pytest backend/tests/test_definitions_api.py -k new_draft -v
```

Expected: 10 passed.

- [ ] **Step 6: Verify the tests bite (mutation check)**

Per the global constraint. Run each mutation, confirm the named test fails, then revert it.

1. Change `base["version"] = _as_int(row.get("version")) + 1` to `... row.get("version")` → `test_new_draft_creates_next_version_from_published` must fail.
2. Delete the `existing is not None` block → `test_new_draft_refuses_when_a_draft_already_exists` must fail.
3. Change `is_archived(row)` to `row.get("lineage_status") == "archived"` → `test_new_draft_refuses_on_a_retired_lineage` must fail.
4. Drop the `status != "published"` guard → both `not_published` tests must fail.

If a mutation does not produce a failure, the test is not covering what it claims — fix the test. If nothing changes at all, check for stale `__pycache__`.

- [ ] **Step 7: Run the full backend suite**

```bash
cd apexflow && uv run pytest backend/tests/ -q
```

Expected: no new failures versus the pre-change baseline.

- [ ] **Step 8: Commit**

```bash
git add apexflow/backend/app/workflows/definitions.py apexflow/backend/app/api/definitions.py apexflow/backend/tests/test_definitions_api.py
git commit -m "feat(apexflow): new_draft action enforcing one draft per lineage"
```

---

### Task 2: Frontend lineage collapse

Pure module, no React. Turns the per-version list into one row per workflow.

**Files:**
- Create: `apexflow/frontend/src/utils/lineage.ts`
- Test: `apexflow/frontend/src/utils/__tests__/lineage.test.ts`

**Interfaces:**
- Consumes: `DefinitionListEntry`, `LineageStatus`, `ChannelAccess`, `DefinitionHealth` from `../types/designer.ts`.
- Produces:
  ```ts
  export interface LineageRow {
    definition_id: string;
    name: string;
    published: DefinitionListEntry | null;
    draft: DefinitionListEntry | null;
    lineage_status: LineageStatus;
    health: DefinitionHealth;
    channel_access: ChannelAccess;
    family_url?: string;
    open_instances: number;
  }
  export function collapseLineages(entries: DefinitionListEntry[]): LineageRow[];
  export function primaryEntityId(row: LineageRow): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `apexflow/frontend/src/utils/__tests__/lineage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collapseLineages, primaryEntityId } from '../lineage.ts';
import type { DefinitionListEntry } from '../../types/designer.ts';

function entry(over: Partial<DefinitionListEntry> = {}): DefinitionListEntry {
  return {
    entity_id: 'e1',
    definition_id: 'enroll',
    name: 'Enrollment',
    version: 1,
    status: 'draft',
    lineage_status: 'active',
    channel_access: 'staff_only',
    health: 'healthy',
    open_instances: 0,
    ...over,
  };
}

describe('collapseLineages', () => {
  it('collapses a published row and its draft into one lineage row', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
      entry({ entity_id: 'drf', version: 4, status: 'draft' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].published?.entity_id).toBe('pub');
    expect(rows[0].draft?.entity_id).toBe('drf');
  });

  it('reads lineage-level fields from the published row, not the draft', () => {
    // The draft's copy of lineage_status is written once at creation and never
    // updated, so it can be stale. The published row is authoritative.
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published',
              lineage_status: 'deprecated', channel_access: 'family' }),
      entry({ entity_id: 'drf', version: 4, status: 'draft',
              lineage_status: 'active', channel_access: 'staff_only' }),
    ]);

    expect(rows[0].lineage_status).toBe('deprecated');
    expect(rows[0].channel_access).toBe('family');
  });

  it('keeps a draft-only lineage, with no published row', () => {
    const rows = collapseLineages([entry({ entity_id: 'drf', version: 1, status: 'draft' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].published).toBeNull();
    expect(rows[0].draft?.entity_id).toBe('drf');
    expect(rows[0].lineage_status).toBe('active');
  });

  it('keeps an archived lineage', () => {
    // AdminDash's visibleWorkflows drops these; ApexFlow must not — the
    // archived lineage is the only place Unarchive is reachable.
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 5, status: 'published', lineage_status: 'archived' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].lineage_status).toBe('archived');
  });

  it('keeps a retired lineage under the legacy alias', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 5, status: 'published', lineage_status: 'retired' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].lineage_status).toBe('retired');
  });

  it('excludes superseded rows', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'old', version: 2, status: 'superseded' }),
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].published?.entity_id).toBe('pub');
  });

  it('drops a lineage that has only superseded rows', () => {
    expect(collapseLineages([entry({ status: 'superseded' })])).toEqual([]);
  });

  it('takes open_instances as the max across versions', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published', open_instances: 14 }),
      entry({ entity_id: 'drf', version: 4, status: 'draft', open_instances: 0 }),
    ]);

    expect(rows[0].open_instances).toBe(14);
  });

  it('separates distinct lineages and sorts them by name', () => {
    const rows = collapseLineages([
      entry({ entity_id: 'z', definition_id: 'zeta', name: 'Zeta', status: 'published' }),
      entry({ entity_id: 'a', definition_id: 'alpha', name: 'Alpha', status: 'published' }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('keeps the highest-versioned draft when a lineage somehow has two', () => {
    // The backend now forbids this, but rows predating that rule still exist.
    const rows = collapseLineages([
      entry({ entity_id: 'd4', version: 4, status: 'draft' }),
      entry({ entity_id: 'd5', version: 5, status: 'draft' }),
    ]);

    expect(rows[0].draft?.entity_id).toBe('d5');
  });
});

describe('primaryEntityId', () => {
  it('prefers the draft — it is what the author is working on', () => {
    const [row] = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
      entry({ entity_id: 'drf', version: 4, status: 'draft' }),
    ]);

    expect(primaryEntityId(row)).toBe('drf');
  });

  it('falls back to the published row when there is no draft', () => {
    const [row] = collapseLineages([
      entry({ entity_id: 'pub', version: 3, status: 'published' }),
    ]);

    expect(primaryEntityId(row)).toBe('pub');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apexflow/frontend && npx vitest run src/utils/__tests__/lineage.test.ts
```

Expected: FAIL — `Failed to resolve import "../lineage.ts"`.

- [ ] **Step 3: Write the implementation**

Create `apexflow/frontend/src/utils/lineage.ts`:

```ts
// Collapses the per-VERSION definition list into one row per workflow.
//
// `listDefinitions` returns a row per definition version, so a lineage with a
// published v3 and a draft v4 arrives as two entries. Rendering them as two
// table rows was the root of three separate usability problems, but it was
// also displaying something that can be WRONG: `lineage_status` is a property
// of the LINEAGE, not of a version. It is denormalized onto every row, the
// authoritative copy lives on the published row (which is what the backend's
// `_require_published_row` enforces), and a draft's copy is written once at
// creation and never updated. Reading it off the published row here is the
// point, not an implementation detail.
//
// Deliberately NOT a reuse of admindash's `visibleWorkflows`
// (admindash/frontend/src/utils/workflowData.ts), despite being the same
// grouping: that function drops archived and never-published lineages because
// AdminDash is an operations surface where neither has work to process. This is
// the authoring surface — archived lineages are where Unarchive lives, and a
// never-published draft is where Delete lives. Same shape, opposite retention
// rule.
import type {
  ChannelAccess,
  DefinitionHealth,
  DefinitionListEntry,
  LineageStatus,
} from '../types/designer.ts';

export interface LineageRow {
  definition_id: string;
  name: string;
  /** The live version, or null for a lineage that has never been published. */
  published: DefinitionListEntry | null;
  /** The open draft, or null. At most one, per the backend's `new_draft` rule. */
  draft: DefinitionListEntry | null;
  lineage_status: LineageStatus;
  health: DefinitionHealth;
  channel_access: ChannelAccess;
  family_url?: string;
  /** Max across versions — an instance pins to the version it started on. */
  open_instances: number;
}

/** The row whose lineage-level fields are authoritative: the published one
 * where it exists, else the draft (a never-published lineage has no published
 * copy to read from). */
function representative(
  published: DefinitionListEntry | null,
  draft: DefinitionListEntry | null,
): DefinitionListEntry {
  return (published ?? draft)!;
}

export function collapseLineages(entries: DefinitionListEntry[]): LineageRow[] {
  const byLineage = new Map<string, DefinitionListEntry[]>();
  for (const entry of entries) {
    // Superseded rows are historical: they carry no live action, and their
    // lineage fields are frozen at the moment they were superseded.
    if (entry.status !== 'draft' && entry.status !== 'published') continue;
    const rows = byLineage.get(entry.definition_id) ?? [];
    rows.push(entry);
    byLineage.set(entry.definition_id, rows);
  }

  const out: LineageRow[] = [];
  for (const [definitionId, rows] of byLineage) {
    const published = rows.find((r) => r.status === 'published') ?? null;
    // Highest version wins if a pre-`new_draft` lineage still has two drafts.
    const draft = rows
      .filter((r) => r.status === 'draft')
      .sort((a, b) => b.version - a.version)[0] ?? null;

    const rep = representative(published, draft);
    out.push({
      definition_id: definitionId,
      name: rep.name,
      published,
      draft,
      lineage_status: rep.lineage_status,
      health: rep.health,
      channel_access: rep.channel_access,
      family_url: rep.family_url,
      open_instances: Math.max(...rows.map((r) => r.open_instances), 0),
    });
  }

  return out.sort(
    (a, b) => (a.name || '').localeCompare(b.name || '')
      || a.definition_id.localeCompare(b.definition_id),
  );
}

/** What the table's single `Open` button opens. The draft wins: on an
 * authoring surface that is the version being worked on. The drawer remains
 * the way to reach the other version, and lists both explicitly. */
export function primaryEntityId(row: LineageRow): string {
  return (row.draft ?? row.published)!.entity_id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apexflow/frontend && npx vitest run src/utils/__tests__/lineage.test.ts
```

Expected: 12 passed.

- [ ] **Step 5: Verify the tests bite (mutation check)**

1. Change `representative` to `return (draft ?? published)!` → `reads lineage-level fields from the published row, not the draft` must fail.
2. Change the superseded filter to `if (entry.status === 'superseded') continue;` — behaviourally identical, so **no test should fail**; revert. Now instead delete the filter line entirely → `excludes superseded rows` and `drops a lineage that has only superseded rows` must fail.
3. Change `Math.max(...)` to `rep.open_instances` → `takes open_instances as the max across versions` must fail.
4. Change `primaryEntityId` to `(row.published ?? row.draft)!` → `prefers the draft` must fail.

- [ ] **Step 6: Commit**

```bash
git add apexflow/frontend/src/utils/lineage.ts apexflow/frontend/src/utils/__tests__/lineage.test.ts
git commit -m "feat(apexflow): collapse definition versions into one row per lineage"
```

---

### Task 3: Frontend lifecycle ladder model

Pure module. Produces the three rungs the drawer renders, including which action is legal and why a blocked one is blocked.

**Files:**
- Create: `apexflow/frontend/src/utils/lifecycleLadder.ts`
- Test: `apexflow/frontend/src/utils/__tests__/lifecycleLadder.test.ts`

**Interfaces:**
- Consumes: `LineageStatus`, `isArchived` from `../types/designer.ts`.
- Produces:
  ```ts
  export type RungKey = 'active' | 'deprecated' | 'archived';
  export type RungAction = 'deprecate' | 'reactivate' | 'archive' | 'unarchive';
  export interface LadderRung {
    key: RungKey;
    current: boolean;
    action: RungAction | null;
    blockedReasonKey: string | null;
  }
  export function lifecycleLadder(status: LineageStatus): LadderRung[];
  ```

- [ ] **Step 1: Write the failing test**

Create `apexflow/frontend/src/utils/__tests__/lifecycleLadder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lifecycleLadder, type RungKey } from '../lifecycleLadder.ts';

function rung(status: Parameters<typeof lifecycleLadder>[0], key: RungKey) {
  return lifecycleLadder(status).find((r) => r.key === key)!;
}

describe('lifecycleLadder', () => {
  it('always renders all three rungs in ladder order', () => {
    for (const status of ['active', 'deprecated', 'archived'] as const) {
      expect(lifecycleLadder(status).map((r) => r.key))
        .toEqual(['active', 'deprecated', 'archived']);
    }
  });

  it('marks exactly one rung current', () => {
    for (const status of ['active', 'deprecated', 'archived'] as const) {
      expect(lifecycleLadder(status).filter((r) => r.current)).toHaveLength(1);
    }
  });

  it('marks the rung matching the lineage status', () => {
    expect(rung('active', 'active').current).toBe(true);
    expect(rung('deprecated', 'deprecated').current).toBe(true);
    expect(rung('archived', 'archived').current).toBe(true);
  });

  it('treats the legacy `retired` alias as archived', () => {
    expect(rung('retired', 'archived').current).toBe(true);
    expect(rung('retired', 'deprecated').action).toBe('unarchive');
  });

  it('offers no action on the current rung', () => {
    expect(rung('active', 'active').action).toBeNull();
    expect(rung('deprecated', 'deprecated').action).toBeNull();
    expect(rung('archived', 'archived').action).toBeNull();
  });

  it('offers deprecate from active', () => {
    const r = rung('active', 'deprecated');
    expect(r.action).toBe('deprecate');
    expect(r.blockedReasonKey).toBeNull();
  });

  it('blocks archive from active, with a reason', () => {
    // The backend 409s `not_deprecated`: deprecating is the window in which
    // mid-flight work drains, so archive is reachable only from deprecated.
    const r = rung('active', 'archived');
    expect(r.action).toBe('archive');
    expect(r.blockedReasonKey).toBe('definitions.ladder.archiveNeedsDeprecated');
  });

  it('offers both reactivate and archive from deprecated, neither blocked', () => {
    expect(rung('deprecated', 'active')).toMatchObject({
      action: 'reactivate', blockedReasonKey: null,
    });
    expect(rung('deprecated', 'archived')).toMatchObject({
      action: 'archive', blockedReasonKey: null,
    });
  });

  it('offers unarchive from archived, landing on deprecated not active', () => {
    // unarchive returns the lineage to `deprecated`, never straight to active.
    expect(rung('archived', 'deprecated')).toMatchObject({
      action: 'unarchive', blockedReasonKey: null,
    });
  });

  it('blocks reactivate from archived, with a reason', () => {
    const r = rung('archived', 'active');
    expect(r.action).toBe('reactivate');
    expect(r.blockedReasonKey).toBe('definitions.ladder.reactivateNeedsUnarchive');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apexflow/frontend && npx vitest run src/utils/__tests__/lifecycleLadder.test.ts
```

Expected: FAIL — `Failed to resolve import "../lifecycleLadder.ts"`.

- [ ] **Step 3: Write the implementation**

Create `apexflow/frontend/src/utils/lifecycleLadder.ts`:

```ts
// The lineage lifecycle rendered as a ladder rather than a menu.
//
// `active --deprecate-> deprecated --archive-> archived`, reversed by
// `reactivate` / `unarchive`. The old `⋯` overflow menu could only list the
// actions legal RIGHT NOW, so on an active lineage "Archive" was not greyed
// out — it was absent, and nothing communicated that archiving existed or that
// deprecating is the window in which mid-flight work drains. A ladder renders
// all three rungs always, marks the current one, and shows an illegal move
// greyed WITH ITS REASON. A menu can only hide; a ladder can explain.
//
// `blockedReasonKey` mirrors the backend's own gates so the UI never fires an
// action the backend will refuse: `archive_definition` 409s `not_deprecated`
// from anything but `deprecated`, and there is no archived -> active edge at
// all (unarchive lands on `deprecated`).
import { isArchived } from '../types/designer.ts';
import type { LineageStatus } from '../types/designer.ts';

export type RungKey = 'active' | 'deprecated' | 'archived';
export type RungAction = 'deprecate' | 'reactivate' | 'archive' | 'unarchive';

export interface LadderRung {
  key: RungKey;
  /** The lineage is here now. Renders as a marker, never as a button. */
  current: boolean;
  /** The action that moves the lineage TO this rung. Null on the current rung. */
  action: RungAction | null;
  /** i18n key explaining why `action` is unavailable. Null when it is legal. */
  blockedReasonKey: string | null;
}

const ORDER: RungKey[] = ['active', 'deprecated', 'archived'];

/** Ladder position, collapsing the legacy `retired` alias onto `archived`. */
function positionOf(status: LineageStatus): RungKey {
  if (isArchived(status)) return 'archived';
  return status === 'deprecated' ? 'deprecated' : 'active';
}

export function lifecycleLadder(status: LineageStatus): LadderRung[] {
  const at = positionOf(status);

  return ORDER.map((key) => {
    if (key === at) return { key, current: true, action: null, blockedReasonKey: null };

    if (at === 'active') {
      if (key === 'deprecated') {
        return { key, current: false, action: 'deprecate', blockedReasonKey: null };
      }
      return {
        key,
        current: false,
        action: 'archive',
        blockedReasonKey: 'definitions.ladder.archiveNeedsDeprecated',
      };
    }

    if (at === 'deprecated') {
      return {
        key,
        current: false,
        action: key === 'active' ? 'reactivate' : 'archive',
        blockedReasonKey: null,
      };
    }

    // at === 'archived'
    if (key === 'deprecated') {
      return { key, current: false, action: 'unarchive', blockedReasonKey: null };
    }
    return {
      key,
      current: false,
      action: 'reactivate',
      blockedReasonKey: 'definitions.ladder.reactivateNeedsUnarchive',
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apexflow/frontend && npx vitest run src/utils/__tests__/lifecycleLadder.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Verify the tests bite (mutation check)**

1. Change `positionOf` to `status === 'archived' ? 'archived' : ...` (dropping `isArchived`) → `treats the legacy 'retired' alias as archived` must fail.
2. Set `blockedReasonKey: null` in the `at === 'active'` archive branch → `blocks archive from active, with a reason` must fail.
3. Swap the `at === 'archived'` branch so `deprecated` gets `reactivate` → `offers unarchive from archived` must fail.

- [ ] **Step 6: Commit**

```bash
git add apexflow/frontend/src/utils/lifecycleLadder.ts apexflow/frontend/src/utils/__tests__/lifecycleLadder.test.ts
git commit -m "feat(apexflow): lifecycle ladder model with blocked-move reasons"
```

---

### Task 4: API client `newDraft` + i18n keys

Everything the drawer needs that is not the drawer itself. Grouped here because the i18n parity test makes a partial key set a failing build, so keys land in one commit.

**Files:**
- Modify: `apexflow/frontend/src/types/designer.ts:246-247` (extend the action union)
- Modify: `apexflow/frontend/src/api/designer.ts` (append `newDraft`)
- Modify: `apexflow/frontend/src/i18n/translations.ts` (both locales)

**Interfaces:**
- Consumes: `defs.new_draft_definition` via the actions endpoint (Task 1); existing `lifecycleAction`, `ApiError`, `asNumber`.
- Produces: `newDraft(tenantId: string, entityId: string): Promise<DefinitionRow>`; i18n keys listed below.

- [ ] **Step 1: Extend the lifecycle action union**

In `apexflow/frontend/src/types/designer.ts`, replace lines 246-247:

```ts
export type DefinitionLifecycleAction =
  | 'publish' | 'deprecate' | 'reactivate' | 'archive' | 'unarchive' | 'delete'
  | 'new_draft';
```

- [ ] **Step 2: Add the API client function**

Append to `apexflow/frontend/src/api/designer.ts`:

```ts
/**
 * Open the next draft version of a published lineage —
 * `POST .../definitions/{entity_id}/actions` with `{action: "new_draft"}`.
 *
 * Replaces the old client-side draft copy, which called the generic
 * `createEntity` and so had to JSON-encode `machine`/`steps` itself and compute
 * the next version in the browser. Both now happen server-side, where the
 * one-draft-per-lineage rule can actually be enforced — two tabs open on the
 * list would otherwise both see "no draft" and both create one.
 *
 * 409 `{reason: "draft_exists", entity_id}` when the lineage already has a
 * draft; `{reason: "lineage_archived"}` on an archived lineage;
 * `{reason: "not_published"}` on any row that isn't the published one. All
 * surface as `ApiError` with the parsed body on `.body`.
 */
export function newDraft(tenantId: string, entityId: string): Promise<DefinitionRow> {
  return lifecycleAction(tenantId, entityId, 'new_draft');
}
```

- [ ] **Step 3: Add and remove i18n keys — `en-US`**

In `apexflow/frontend/src/i18n/translations.ts`, in the `'en-US'` block:

**Remove** these two keys (the `⋯` menu and its per-row label are gone):
```
'definitions.actions.moreFor'
'definitions.actions.openEditor'
```

**Add:**
```ts
    'definitions.actions.open': 'Open',
    'definitions.columns.live': 'Live',
    'definitions.draftChip': 'v{v} draft',
    'definitions.noPublished': '—',

    'definitions.drawer.versions': 'Versions',
    'definitions.drawer.facts': 'Facts',
    'definitions.drawer.lifecycle': 'Lifecycle',
    'definitions.drawer.publishedVersion': 'v{v} published',
    'definitions.drawer.draftVersion': 'v{v} draft',
    'definitions.drawer.live': 'live',
    'definitions.drawer.health': 'Health',
    'definitions.drawer.channel': 'Channel',
    'definitions.drawer.openItems': 'Open work items',
    'definitions.drawer.frozenItems': 'Frozen work items',
    'definitions.drawer.lifecycleAfterPublish':
      'Lifecycle begins at first publish — every lifecycle action targets the published version.',
    'definitions.drawer.newDraftBlockedArchived':
      'Unarchive this workflow before starting a new version.',

    'definitions.ladder.active': 'Active',
    'definitions.ladder.activeHint': 'Accepting new work items.',
    'definitions.ladder.deprecated': 'Deprecated',
    'definitions.ladder.deprecatedHint': 'Stops new work. In-flight work continues.',
    'definitions.ladder.archived': 'Archived',
    'definitions.ladder.archivedHint': 'Freezes whatever is still in flight.',
    'definitions.ladder.current': 'current',
    'definitions.ladder.archiveNeedsDeprecated': 'Available once deprecated.',
    'definitions.ladder.reactivateNeedsUnarchive': 'Unarchive first, then reactivate.',

    'definitions.newDraftDraftExists':
      'This workflow already has an open draft. Open or delete it first.',
    'definitions.newDraftArchived': "An archived workflow can't take a new draft.",
```

- [ ] **Step 4: Mirror every change in `zh-CN`**

Remove the same two keys and add the same key set in the `'zh-CN'` block:

```ts
    'definitions.actions.open': '打开',
    'definitions.columns.live': '当前版本',
    'definitions.draftChip': 'v{v} 草稿',
    'definitions.noPublished': '—',

    'definitions.drawer.versions': '版本',
    'definitions.drawer.facts': '概况',
    'definitions.drawer.lifecycle': '生命周期',
    'definitions.drawer.publishedVersion': 'v{v} 已发布',
    'definitions.drawer.draftVersion': 'v{v} 草稿',
    'definitions.drawer.live': '生效中',
    'definitions.drawer.health': '状态',
    'definitions.drawer.channel': '渠道',
    'definitions.drawer.openItems': '进行中的工作项',
    'definitions.drawer.frozenItems': '已冻结的工作项',
    'definitions.drawer.lifecycleAfterPublish': '首次发布后才有生命周期——所有生命周期操作都针对已发布版本。',
    'definitions.drawer.newDraftBlockedArchived': '请先取消归档，然后再新建版本。',

    'definitions.ladder.active': '启用中',
    'definitions.ladder.activeHint': '正在接收新的工作项。',
    'definitions.ladder.deprecated': '已停用',
    'definitions.ladder.deprecatedHint': '停止接收新工作，进行中的工作继续。',
    'definitions.ladder.archived': '已归档',
    'definitions.ladder.archivedHint': '冻结所有仍在进行中的工作。',
    'definitions.ladder.current': '当前',
    'definitions.ladder.archiveNeedsDeprecated': '停用后才可归档。',
    'definitions.ladder.reactivateNeedsUnarchive': '请先取消归档，再重新启用。',

    'definitions.newDraftDraftExists': '该工作流已有一个草稿，请先打开或删除它。',
    'definitions.newDraftArchived': '已归档的工作流无法新建草稿。',
```

- [ ] **Step 5: Run the i18n parity test**

```bash
cd apexflow/frontend && npx vitest run src/i18n/__tests__/translations.test.ts
```

Expected: 3 passed. A `missing`/`extra` mismatch means a key landed in one locale only.

- [ ] **Step 6: Verify the parity test bites (mutation check)**

Delete `'definitions.ladder.current'` from the `zh-CN` block only. Re-run — `has the same key set in every locale` must fail naming that key. Restore it.

- [ ] **Step 7: Commit**

```bash
git add apexflow/frontend/src/types/designer.ts apexflow/frontend/src/api/designer.ts apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): newDraft client + drawer/ladder translations"
```

---

### Task 5: The lineage drawer

**Files:**
- Create: `apexflow/frontend/src/components/LineageDrawer.tsx`
- Create: `apexflow/frontend/src/components/LineageDrawer.css`

**Interfaces:**
- Consumes: `LineageRow` (Task 2), `lifecycleLadder` / `LadderRung` / `RungAction` (Task 3), `newDraft` (Task 4), existing `Modal`, `Button`, `StatusBadge`, `useTranslation`.
- Produces:
  ```ts
  export interface LineageDrawerProps {
    row: LineageRow | null;
    onClose: () => void;
    onOpenEditor: (entityId: string) => void;
    onAction: (entityId: string, action: RungAction) => void;
    onDeleteDraft: (entry: DefinitionListEntry) => void;
    onNewDraft: (entityId: string) => void;
    busy?: boolean;
  }
  export default function LineageDrawer(props: LineageDrawerProps): JSX.Element | null;
  ```
  The drawer raises intent; `DefinitionsPage` (Task 6) owns confirmation modals, API calls, toasts, and reloading. This keeps every destructive confirm in one place, as it is today.

- [ ] **Step 1: Write the component**

Create `apexflow/frontend/src/components/LineageDrawer.tsx`:

```tsx
// One workflow lineage, whole.
//
// The list used to render a lineage as two rows — published and draft — with
// different action sets, so "the workflow" had no single place to act on. This
// drawer is that place: both versions listed together, the lineage-level facts
// once, and the lifecycle as a ladder.
//
// Chrome is the shared `Modal variant="drawer"`, which already existed here
// unused (`styles/modal.css`) and is what all six AdminDash drawers use. Open
// state is held by the caller rather than routed, matching them.
//
// Raises intent only: every confirm modal, API call, toast, and reload stays in
// DefinitionsPage, so destructive confirmation lives in exactly one place.
import { useTranslation } from '../hooks/useTranslation.ts';
import { isArchived } from '../types/designer.ts';
import type { DefinitionListEntry } from '../types/designer.ts';
import type { LineageRow } from '../utils/lineage.ts';
import { lifecycleLadder, type RungAction, type RungKey } from '../utils/lifecycleLadder.ts';
import { Modal } from './ui/Modal.tsx';
import { Button } from './ui/Button.tsx';
import StatusBadge from './StatusBadge.tsx';
import './LineageDrawer.css';

export interface LineageDrawerProps {
  row: LineageRow | null;
  onClose: () => void;
  onOpenEditor: (entityId: string) => void;
  onAction: (entityId: string, action: RungAction) => void;
  onDeleteDraft: (entry: DefinitionListEntry) => void;
  onNewDraft: (entityId: string) => void;
  busy?: boolean;
}

/** Label + hint i18n keys per rung, so the ladder reads as an explanation
 * rather than three bare verbs. */
const RUNG_TEXT: Record<RungKey, { label: string; hint: string }> = {
  active: { label: 'definitions.ladder.active', hint: 'definitions.ladder.activeHint' },
  deprecated: { label: 'definitions.ladder.deprecated', hint: 'definitions.ladder.deprecatedHint' },
  archived: { label: 'definitions.ladder.archived', hint: 'definitions.ladder.archivedHint' },
};

const ACTION_LABEL: Record<RungAction, string> = {
  deprecate: 'definitions.actions.deprecate',
  reactivate: 'definitions.actions.reactivate',
  archive: 'definitions.actions.retire',
  unarchive: 'definitions.actions.unarchive',
};

export default function LineageDrawer({
  row, onClose, onOpenEditor, onAction, onDeleteDraft, onNewDraft, busy = false,
}: LineageDrawerProps) {
  const { t } = useTranslation();
  if (!row) return null;

  /** `health` and `lineage_status` arrive as raw wire enums ("healthy",
   * "deprecated") which are not themselves user-facing copy. Same lookup
   * DefinitionsPage does, falling back to the raw value rather than to a
   * literal i18n key when a value isn't in the map. */
  const badgeLabel = (prefix: 'lineageStatus' | 'health', value: string): string => {
    const key = `definitions.${prefix}.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  const archived = isArchived(row.lineage_status);
  // Every lifecycle action targets the published row — `_require_published_row`
  // 409s on anything else — so a never-published lineage has no ladder at all.
  const lifecycleTarget = row.published?.entity_id ?? null;
  const rungs = lifecycleLadder(row.lineage_status);

  return (
    <Modal
      open
      onClose={onClose}
      variant="drawer"
      title={row.name}
      subtitle={row.definition_id}
    >
      <div className="lineage-drawer">

        <section className="lineage-drawer-section">
          <h3 className="lineage-drawer-heading">{t('definitions.drawer.versions')}</h3>

          {row.draft && (
            <div className="lineage-version-row">
              <StatusBadge
                status="draft"
                label={t('definitions.drawer.draftVersion').replace('{v}', String(row.draft.version))}
              />
              <div className="lineage-version-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDeleteDraft(row.draft!)}
                >
                  {t('definitions.actions.delete')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenEditor(row.draft!.entity_id)}
                >
                  {t('definitions.actions.open')}
                </Button>
              </div>
            </div>
          )}

          {row.published && (
            <div className="lineage-version-row">
              <span className="lineage-version-label">
                <StatusBadge
                  status="published"
                  label={t('definitions.drawer.publishedVersion')
                    .replace('{v}', String(row.published.version))}
                />
                <span className="lineage-version-note">{t('definitions.drawer.live')}</span>
              </span>
              <div className="lineage-version-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenEditor(row.published!.entity_id)}
                >
                  {t('definitions.actions.open')}
                </Button>
              </div>
            </div>
          )}

          {/* Hidden while a draft exists: discarding must be a deliberate act,
              not a side effect of clicking "New version". Hidden when archived
              because a copy would carry `archived` onto a fresh draft. */}
          {row.published && !row.draft && !archived && (
            <div className="lineage-drawer-newdraft">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onNewDraft(row.published!.entity_id)}
              >
                {t('definitions.actions.newDraft')}
              </Button>
            </div>
          )}
          {row.published && !row.draft && archived && (
            <p className="lineage-drawer-note">
              {t('definitions.drawer.newDraftBlockedArchived')}
            </p>
          )}
        </section>

        <section className="lineage-drawer-section">
          <h3 className="lineage-drawer-heading">{t('definitions.drawer.facts')}</h3>
          <dl className="lineage-facts">
            <dt>{t('definitions.drawer.health')}</dt>
            <dd><StatusBadge status={row.health} label={badgeLabel('health', row.health)} /></dd>

            <dt>{t('definitions.drawer.channel')}</dt>
            <dd>
              {t(row.channel_access === 'family'
                ? 'definitions.channel.family'
                : 'definitions.channel.staffOnly')}
              {row.family_url ? (
                <a
                  className="lineage-family-link"
                  href={row.family_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t('definitions.channel.familyLinkLabel')}
                >
                  ↗
                </a>
              ) : null}
            </dd>

            {/* An archived lineage's in-flight work is frozen, not open —
                calling it "open" would misdescribe what those items are. */}
            <dt>
              {t(archived ? 'definitions.drawer.frozenItems' : 'definitions.drawer.openItems')}
            </dt>
            <dd>{row.open_instances}</dd>
          </dl>
        </section>

        <section className="lineage-drawer-section">
          <h3 className="lineage-drawer-heading">{t('definitions.drawer.lifecycle')}</h3>

          {lifecycleTarget === null ? (
            <p className="lineage-drawer-note">
              {t('definitions.drawer.lifecycleAfterPublish')}
            </p>
          ) : (
            <ol className="lineage-ladder">
              {rungs.map((rung) => (
                <li
                  key={rung.key}
                  className={[
                    'lineage-rung',
                    rung.current ? 'is-current' : '',
                    rung.blockedReasonKey ? 'is-blocked' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="lineage-rung-text">
                    <b>{t(RUNG_TEXT[rung.key].label)}</b>
                    <small>
                      {rung.blockedReasonKey
                        ? t(rung.blockedReasonKey)
                        : t(RUNG_TEXT[rung.key].hint)}
                    </small>
                  </span>
                  {rung.current ? (
                    <span className="lineage-rung-current">{t('definitions.ladder.current')}</span>
                  ) : (
                    <Button
                      variant={rung.key === 'archived' ? 'danger' : 'secondary'}
                      size="sm"
                      disabled={busy || rung.blockedReasonKey !== null}
                      onClick={() => onAction(lifecycleTarget, rung.action!)}
                    >
                      {t(ACTION_LABEL[rung.action!])}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Write the stylesheet**

Create `apexflow/frontend/src/components/LineageDrawer.css`:

```css
/* Drawer chrome (overlay, slide-in, header, close) comes from the shared
   Modal `variant="drawer"`; everything here is the drawer's own content —
   same split as admindash's LeadDetailDrawer.css. */

.lineage-drawer-section { margin-bottom: var(--space-6); }
.lineage-drawer-section:last-child { margin-bottom: 0; }

.lineage-drawer-heading {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* --- Versions -------------------------------------------------------------- */

.lineage-version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.lineage-version-row:last-of-type { border-bottom: 0; }

.lineage-version-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.lineage-version-note {
  font-size: var(--text-xs);
  color: var(--ink-faint);
  font-style: italic;
}

.lineage-version-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: nowrap;
  white-space: nowrap;
}

.lineage-drawer-newdraft { margin-top: var(--space-3); }

.lineage-drawer-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  color: var(--ink-faint);
}

/* --- Facts ----------------------------------------------------------------- */

.lineage-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-5);
  margin: 0;
  font-size: var(--text-sm);
}

.lineage-facts dt { color: var(--ink-faint); }
.lineage-facts dd { margin: 0; font-weight: 600; }

.lineage-family-link {
  margin-left: var(--space-2);
  text-decoration: none;
}

/* --- Lifecycle ladder ------------------------------------------------------ */

.lineage-ladder {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.lineage-rung {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.lineage-rung:last-child { border-bottom: 0; }

/* The rung the lineage is on now. */
.lineage-rung.is-current {
  background: var(--surface-sunken);
  box-shadow: inset 3px 0 0 var(--accent);
}

/* A move the backend would refuse. Rendered, not hidden — the reason is the
   whole point of showing it. */
.lineage-rung.is-blocked { opacity: 0.6; }

.lineage-rung-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lineage-rung-text b { font-size: var(--text-sm); }

.lineage-rung-text small {
  font-size: var(--text-xs);
  color: var(--ink-faint);
}

.lineage-rung-current {
  font-size: var(--text-xs);
  color: var(--ink-faint);
  font-style: italic;
  white-space: nowrap;
}
```

- [ ] **Step 3: Verify it compiles**

The drawer has no consumer yet, so `tsc` is the check that its imports and props are coherent.

```bash
cd apexflow/frontend && npx tsc -b
```

Expected: exit 0. (`Button.tsx:19,50` and `Modal.tsx:47,180` export both named and default, so the named imports above resolve; `StatusBadge.tsx:22` is default-only.)

- [ ] **Step 4: Lint**

```bash
cd apexflow/frontend && npm run lint
```

Expected: no errors for `LineageDrawer.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apexflow/frontend/src/components/LineageDrawer.tsx apexflow/frontend/src/components/LineageDrawer.css
git commit -m "feat(apexflow): lineage drawer with versions, facts, lifecycle ladder"
```

---

### Task 6: Rewire the definitions page

Wires Tasks 2–5 into the page and deletes the overflow menu.

**Files:**
- Modify: `apexflow/frontend/src/pages/DefinitionsPage.tsx` (substantial rewrite of the columns, row actions, and handlers)
- Modify: `apexflow/frontend/src/pages/DefinitionsPage.css` (drop `.definitions-row-actions`)
- Delete: `apexflow/frontend/src/components/RowMenu.tsx`, `apexflow/frontend/src/components/RowMenu.css`

**Interfaces:**
- Consumes: `collapseLineages`, `primaryEntityId`, `LineageRow` (Task 2); `RungAction` (Task 3); `newDraft` (Task 4); `LineageDrawer` (Task 5).
- Produces: nothing downstream — this is the leaf.

- [ ] **Step 1: Delete the overflow menu**

`DefinitionsPage` is its only consumer, confirmed by grep.

```bash
cd /Users/kennylee/Development/NeoApex
git rm apexflow/frontend/src/components/RowMenu.tsx apexflow/frontend/src/components/RowMenu.css
```

- [ ] **Step 2: Replace the page's state, columns, and row actions**

In `apexflow/frontend/src/pages/DefinitionsPage.tsx`:

**a.** Drop the `RowMenu` import (line 48) and its `RowMenuItem` type usage. Add:

```tsx
import { collapseLineages, primaryEntityId, type LineageRow } from '../utils/lineage.ts';
import type { RungAction } from '../utils/lifecycleLadder.ts';
import { newDraft } from '../api/designer.ts';
import LineageDrawer from '../components/LineageDrawer.tsx';
```

Remove `createEntity` from the `../api/client.ts` import **only if** the "New workflow (blank draft)" flow no longer uses it — it does still use it (`submitNewWorkflow`), so keep that import.

**b.** Add drawer state alongside the existing state hooks:

```tsx
  const [drawerLineageId, setDrawerLineageId] = useState<string | null>(null);
```

Holding the `definition_id` rather than the `LineageRow` object means the drawer re-reads the freshly-collapsed row after every reload, instead of showing a snapshot captured before the action ran.

**c.** Replace `visibleRows` (lines 160-172) with the collapse:

```tsx
  const lineageRows = useMemo(() => collapseLineages(entries), [entries]);
```

**d.** Replace `lineageCount` (lines 174-177), `total`, and `pageRows` (179-183):

```tsx
  const lineageCount = lineageRows.length;
  const total = lineageRows.length;
  const pageRows = useMemo(
    () => lineageRows.slice((page - 1) * pageSize, page * pageSize),
    [lineageRows, page, pageSize],
  );

  const drawerRow = useMemo(
    () => lineageRows.find((r) => r.definition_id === drawerLineageId) ?? null,
    [lineageRows, drawerLineageId],
  );
```

**e.** Replace the whole `columns` array (lines 399-469) with:

```tsx
  const columns: Column<LineageRow>[] = [
    {
      key: 'name',
      label: 'Name',
      i18nKey: 'definitions.columns.name',
      primary: true,
      render: (row) => <span className="definitions-name">{row.name}</span>,
    },
    {
      key: 'definition_id',
      label: 'Workflow ID',
      i18nKey: 'definitions.columns.definitionId',
      render: (row) => <code className="definitions-lineage-id">{row.definition_id}</code>,
    },
    {
      // `status` (draft/published) is no longer a row property — a lineage can
      // be both at once — so it folds in here as a chip beside the live version.
      key: 'live',
      label: 'Live',
      i18nKey: 'definitions.columns.live',
      render: (row) => (
        <span className="definitions-live">
          {row.published ? `v${row.published.version}` : t('definitions.noPublished')}
          {row.draft ? (
            <StatusBadge
              status="draft"
              label={t('definitions.draftChip').replace('{v}', String(row.draft.version))}
            />
          ) : null}
        </span>
      ),
    },
    {
      key: 'lineage_status',
      label: 'Lineage',
      i18nKey: 'definitions.columns.lineageStatus',
      render: (row) => (
        <StatusBadge
          status={row.lineage_status}
          label={badgeLabel('lineageStatus', row.lineage_status)}
        />
      ),
    },
    {
      key: 'health',
      label: 'Health',
      i18nKey: 'definitions.columns.health',
      render: (row) => <StatusBadge status={row.health} label={badgeLabel('health', row.health)} />,
    },
    {
      key: 'open_instances',
      label: 'Open instances',
      i18nKey: 'definitions.columns.openInstances',
      numeric: true,
      render: (row) => <>{row.open_instances}</>,
    },
    {
      key: 'channel_access',
      label: 'Channel',
      i18nKey: 'definitions.columns.channel',
      render: (row) => (
        <span className="definitions-channel">
          {t(row.channel_access === 'family'
            ? 'definitions.channel.family'
            : 'definitions.channel.staffOnly')}
          {row.family_url ? (
            <a
              className="definitions-family-link"
              href={row.family_url}
              target="_blank"
              rel="noreferrer"
              aria-label={t('definitions.channel.familyLinkLabel')}
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          ) : null}
        </span>
      ),
    },
  ];
```

**f.** Replace the entire `rowActions` function (lines 471-552) with:

```tsx
  /**
   * Exactly one control per row, matching AdminDash's Students and Families
   * tables (row click opens a detail drawer; the row carries a single button).
   * Everything the old `⋯` menu held now lives in the drawer, where a blocked
   * lifecycle move can be shown WITH ITS REASON instead of silently omitted.
   */
  function rowActions(row: LineageRow) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => navigate(`/definitions/${primaryEntityId(row)}`)}
      >
        {t('definitions.actions.open')}
      </Button>
    );
  }
```

- [ ] **Step 3: Rewire the handlers**

**a.** Replace `handleNewDraft` (lines 278-308) — the bundle fetch and client-side copy are gone; the server does it now:

```tsx
  async function handleNewDraft(entityId: string) {
    setNewDraftBusyId(entityId);
    try {
      const created = await newDraft(tenantId, entityId);
      toast({
        message: t('definitions.newDraftToast').replace('{v}', String(created.version)),
        tone: 'success',
      });
      navigate(`/definitions/${created.entity_id}`);
    } catch (err) {
      // The two 409s the drawer's own gating should already prevent still
      // reach here from a stale view — a second tab that opened a draft since
      // this list loaded. Say which one it was rather than "try again".
      const reason =
        err instanceof ApiError
        && err.body
        && typeof err.body === 'object'
        && 'detail' in err.body
        && typeof (err.body as { detail?: unknown }).detail === 'object'
          ? ((err.body as { detail: { reason?: string } }).detail.reason)
          : undefined;
      const key =
        reason === 'draft_exists' ? 'definitions.newDraftDraftExists'
        : reason === 'lineage_archived' ? 'definitions.newDraftArchived'
        : 'definitions.newDraftError';
      toast({ message: t(key), tone: 'danger' });
      void load();
    } finally {
      setNewDraftBusyId(null);
    }
  }
```

**b.** Add a single dispatcher for the ladder's four actions. `deprecate`, `reactivate`, and `archive` keep their existing confirm modals; `unarchive` stays unconfirmed, as today.

```tsx
  function handleLadderAction(entityId: string, action: RungAction) {
    const entry = lineageRows.find((r) => r.published?.entity_id === entityId)?.published;
    if (!entry) return;
    if (action === 'archive') { setRetireTarget(entry); return; }
    if (action === 'unarchive') { void handleUnarchive(entry); return; }
    setLifecycleTarget({ entry, action });
  }
```

Widen `LifecycleTarget.action` (line 76) to accept the reactivate/deprecate pair only — it already does, since `DefinitionLifecycleAction` covers both.

**c.** After each successful mutation, `load()` already runs, and `drawerRow` recomputes from the reloaded `lineageRows`, so the drawer refreshes itself. **Add one line** to `confirmDelete`'s success path so deleting the last draft of a never-published lineage doesn't leave an orphaned drawer open:

```tsx
      if (!lineageRows.find((r) => r.definition_id === deleteTarget.definition_id)?.published) {
        setDrawerLineageId(null);
      }
```

- [ ] **Step 4: Mount the drawer and enable row click**

Add `onRowClick` to the `DataTable` (after `rowActions={rowActions}`, line 599):

```tsx
        onRowClick={(row) => setDrawerLineageId(row.definition_id)}
```

Change the `DataTable` generic from `DefinitionListEntry` to `LineageRow`, and update `rowKey` / `rowLabel`:

```tsx
      <DataTable<LineageRow>
        ...
        rowKey={(row) => row.definition_id}
        rowLabel={(row) => row.name}
```

Render the drawer just before the closing `</div>` of `.definitions-page`:

```tsx
      <LineageDrawer
        row={drawerRow}
        onClose={() => setDrawerLineageId(null)}
        onOpenEditor={(entityId) => navigate(`/definitions/${entityId}`)}
        onAction={handleLadderAction}
        onDeleteDraft={(entry) => setDeleteTarget(entry)}
        onNewDraft={(entityId) => void handleNewDraft(entityId)}
        busy={newDraftBusyId !== null || lifecycleBusy || retiring || deleting}
      />
```

- [ ] **Step 5: Drop the dead stylesheet rule**

Remove `.definitions-row-actions` (lines 26-36) from `apexflow/frontend/src/pages/DefinitionsPage.css` — a single button needs no flex row. Add:

```css
.definitions-live {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  white-space: nowrap;
}
```

- [ ] **Step 6: Typecheck, lint, and run the full frontend suite**

```bash
cd apexflow/frontend && npx tsc -b && npm run lint && npm run test
```

Expected: exit 0 on all three. `tsc` failing on a `DefinitionListEntry` vs `LineageRow` mismatch means a column or handler was missed in Step 2.

- [ ] **Step 7: Confirm the menu is fully gone**

```bash
cd /Users/kennylee/Development/NeoApex && grep -rn "RowMenu" apexflow/frontend/src ; echo "exit=$?"
```

Expected: no matches (`exit=1`).

- [ ] **Step 8: Build**

```bash
cd apexflow/frontend && npm run build
```

Expected: exit 0.

- [ ] **Step 9: Browser check**

Start the stack (`./start-services.sh`) and open `http://localhost:5900`. Confirm against a tenant that has a published workflow, a draft, and an archived one:

1. Each workflow occupies **one** row; a lineage with a draft shows the `v4 draft` chip beside its live version.
2. The row has exactly one `Open` button, and no `⋯` anywhere on the page.
3. `Open` on a lineage with a draft lands on the **draft's** editor.
4. Clicking the row body opens the drawer; clicking the `Open` button does **not** also open it (`DataTable`'s click handler ignores clicks inside `.data-table-actions`).
5. On an **active** lineage the ladder shows Active as current, Deprecate live, and Archive **greyed with "Available once deprecated"** — this is the behaviour the old menu could not express.
6. Deprecate → confirm → the drawer stays open and re-renders with Deprecated current, Archive now live.
7. Archive → confirm → the count relabels to "Frozen work items"; Unarchive is offered on the Deprecated rung and Reactivate is greyed.
8. With a draft present, `New version` is **absent**; delete the draft and it appears.
9. A never-published lineage shows "Lifecycle begins at first publish" instead of the ladder.
10. Switch language to 中文 and confirm no raw `definitions.*` keys render.

- [ ] **Step 10: Commit**

```bash
git add -A apexflow/frontend/src
git commit -m "feat(apexflow): lineage rows, Open button, and detail drawer replacing the overflow menu"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Lineage collapse, `utils/lineage.ts`, no `visibleWorkflows` reuse | 2 |
| §2 Table: row click, one `Open`, `RowMenu` deleted, Status folds into version cell | 6 |
| §2 Not copied: clickable counts, hiding archived | 6 (counts plain), 2 (archived retained + test) |
| §3 Drawer: Versions / Facts / Lifecycle ladder, Delete on draft lines, draft-only message | 5 |
| §3 Drawer state-driven not routed | 6 (`drawerLineageId` state) |
| §4 One draft per lineage, backend-enforced, `new_draft` on existing dispatcher | 1 |
| §4 UI: `New draft` hidden while a draft exists; hidden when archived | 5 |
| Testing: backend `new_draft` cases | 1 Step 1 |
| Testing: `lineage.ts` collapse cases | 2 Step 1 |
| Testing: mutation verification | 1/2/3/4, dedicated steps |

The spec's testing section named four backend cases and four collapse cases; this plan covers those plus the `retired` alias, the cross-lineage draft, the 404, `primaryEntityId`, and the whole ladder module. No spec requirement is unimplemented.

**Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to Task N". Every code step carries the actual code.

**Type consistency:** `LineageRow` is defined in Task 2 and consumed under that exact name in 5 and 6. `RungAction` is defined in Task 3 and used in 5's `onAction` and 6's `handleLadderAction`. `newDraft(tenantId, entityId)` is defined in Task 4 and called with that signature in 6. `blockedReasonKey` is spelled identically in 3 and 5. The i18n keys emitted by Task 3 (`definitions.ladder.archiveNeedsDeprecated`, `definitions.ladder.reactivateNeedsUnarchive`) are both added in Task 4.

**Defect caught during review:** Task 5's Facts section originally passed `label={row.health}`, which would have rendered the raw wire enum in the drawer while the table beside it showed a translated label. Fixed by giving the drawer the same `badgeLabel` lookup `DefinitionsPage` uses.

**Verified, not assumed:** `Button.tsx:19,50` and `Modal.tsx:47,180` export both named and default; `ButtonVariant` (`Button.tsx:4`) includes the `ghost` and `danger` variants the drawer uses; `StatusBadge.tsx:22` is default-only with `status`/`label` props.
