# AdminDash Home "Needs you today" + `/attention` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the AdminDash home page's "Needs you today" as a cross-workflow review with four bounded count cards, rename "Enrollment pipeline" to "Lead pipeline", and add a `/attention` route holding the full list.

**Architecture:** One pure module (`utils/attentionData.ts`) holds SQL builders and classification with no React and no network, exercised directly by vitest. A hook (`hooks/useAttention.ts`) runs four queries through `Promise.allSettled` and feeds the pure builder. Home renders each bucket's `.length`; `/attention` renders the same bucket's rows — one fetch, one grouping, so counts and list cannot disagree. One additive backend field in apexflow makes per-item ages attributable.

**Tech Stack:** React 19 + TypeScript + Vite, vitest (node environment), React Router v7, FastAPI + pytest (apexflow).

**Spec:** `docs/superpowers/specs/2026-08-11-admindash-home-attention-design.md`

## Global Constraints

- **Never use `SELECT *`** in these queries. The flattened table includes a 1024-float `vector` column, which `/api/query` returns (unlike `/api/query/readonly`, which pops it). Select explicit columns only.
- **`at` must be quoted as `"at"`** in SQL. It is a DuckDB reserved keyword; the bare identifier 400s with `Parser Error`. Precedent and rationale: `utils/workflowData.ts::activitySql`.
- **Never use `_created_at` or `_updated_at` as a creation time.** `store.py:378-388` rebuilds the row on every write, so on an active row they are both last-modified. All ages come from `due_at`, `workflow_activity."at"`, or `opened_at`.
- **Every scalar from `/api/query` arrives as a string.** `"false"` is truthy in JS. Use `asBool` / `asNumber` from `utils/workflowData.ts`.
- **SQL literals are escaped by doubling single quotes**, same rule as `workflowData.ts::escapeSqlLiteral`.
- **New user-facing strings go in `src/i18n/translations.ts` for BOTH `en-US` and `zh-CN`.** A missing key renders the raw key string on screen with no warning. `src/i18n/__tests__/translations.test.ts` fails if the locales drift.
- **Test baselines to hold:** apexflow 553 (becomes 555), admindash pytest 201, admindash vitest 94, familyhub 89, datacore 354, flow-runtime 59.
- **`admindash npm run lint` has 5 pre-existing errors** (DynamicForm, AuthContext, DashboardContext, ModelContext). Do not fix them. Do notice if a 6th appears.
- **Branch:** work continues on `feat/item-status-typing`. Do **not** rebase onto `main` — main lacks the ApexFlow Plan 3 merge this depends on.

---

## File Structure

| File | Responsibility |
|---|---|
| `apexflow/backend/app/workflows/engine.py` | *Modify.* `_log_activity` gains `item_entity_id`; `_update_item` passes it. |
| `apexflow/backend/tests/test_items.py` | *Modify.* Two tests pinning the new field. |
| `admindash/frontend/src/utils/attentionData.ts` | *Create.* SQL builders + pure classification. No React, no network. |
| `admindash/frontend/src/utils/__tests__/attentionData.test.ts` | *Create.* vitest coverage of the above. |
| `admindash/frontend/src/hooks/useAttention.ts` | *Create.* Fetch orchestration, `Promise.allSettled`, per-section failure flags. |
| `admindash/frontend/src/pages/HomePage.tsx` | *Modify.* Queue section + pipeline title. |
| `admindash/frontend/src/pages/AttentionPage.tsx` | *Create.* The full list. |
| `admindash/frontend/src/pages/AttentionPage.css` | *Create.* Row/chip styling. |
| `admindash/frontend/src/App.tsx` | *Modify.* One route. |
| `admindash/frontend/src/i18n/translations.ts` | *Modify.* New keys in both locales. |

---

## Task 1: apexflow — attribute `item_change` activity to its item

`workflow_activity` rows of type `item_change` record `instance_id` but not which item changed, so two items in flight on one instance report the same timestamp. This makes per-item waiting time underivable. The field is additive; pre-existing rows read as absent.

**Files:**
- Modify: `apexflow/backend/app/workflows/engine.py:119-133` and `:400-409`
- Test: `apexflow/backend/tests/test_items.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `workflow_activity` rows of type `item_change` carry `item_id` holding the **`workflow_item`'s DataCore `entity_id`**. Task 2's `submittedItemsSql` joins on it.

- [ ] **Step 1: Write the failing tests**

Append to `apexflow/backend/tests/test_items.py`:

```python
def test_item_change_activity_records_which_item_changed(fake_dc):
    """Two items on one instance must be distinguishable in the activity log —
    the AdminDash attention queue derives per-item waiting time from this."""
    instance_row, items = _setup(fake_dc)
    item_eid = items["form_staff"]["entity_id"]

    engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")

    activities = fake_dc.find("workflow_activity", instance_id=instance_row["entity_id"],
                              type="item_change")
    assert len(activities) == 1
    assert activities[0]["item_id"] == item_eid


def test_state_change_activity_carries_no_item_id(fake_dc):
    """Only item_change is item-scoped. A state_change belongs to the
    instance, and must not claim an item."""
    instance_row, _items = _setup(fake_dc)

    activities = fake_dc.find("workflow_activity", instance_id=instance_row["entity_id"],
                              type="state_change")
    assert activities
    assert all(not a.get("item_id") for a in activities)
```

- [ ] **Step 2: Run the tests to verify the first one fails**

```bash
cd /Users/kennylee/Development/NeoApex/apexflow && uv run pytest backend/tests/test_items.py -k "item_change_activity_records or state_change_activity_carries" -v
```

Expected: `test_item_change_activity_records_which_item_changed` FAILS with `KeyError: 'item_id'`. `test_state_change_activity_carries_no_item_id` PASSES already (the field simply doesn't exist yet) — that is correct, it is a regression guard.

- [ ] **Step 3: Add the parameter to `_log_activity`**

In `apexflow/backend/app/workflows/engine.py`, replace lines 119-133:

```python
def _log_activity(tenant_id: str, instance_entity_id: str, type_: str, from_value: str,
                   to_value: str, actor: str, token: str | None, now: datetime,
                   item_entity_id: str = "") -> dict:
    """`item_entity_id` is set only for `item_change` — it carries the
    `workflow_item`'s DataCore entity_id, symmetric with `instance_id` above,
    which likewise holds an entity_id rather than a business id (convention
    documented at admindash `utils/workflowData.ts:148`). Without it, two
    items changing on one instance are indistinguishable in the log, so no
    consumer can say how long a specific item has been waiting."""
    activity_id = dc.next_id(tenant_id, "workflow_activity", token)
    return dc.dc_create(tenant_id, "workflow_activity", {
        "activity_id": activity_id,
        "workflow_activity_id": activity_id,
        "instance_id": instance_entity_id,
        "item_id": item_entity_id,
        "type": type_,
        "from_value": from_value or "",
        "to_value": to_value or "",
        "actor": actor,
        "at": now.isoformat(),
    }, token)
```

- [ ] **Step 4: Pass it from `_update_item`**

In the same file, in `_update_item` (around line 407), replace the `_log_activity` call:

```python
    _log_activity(tenant_id, instance_row.get("entity_id"), "item_change",
                 old_status, changes.get("status", old_status), actor, token, now,
                 item_entity_id=item_row["entity_id"])
```

Leave `machine.py`'s own `_log_activity` (line 191) untouched — it only writes `state_change` and `note`, neither of which is item-scoped.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/kennylee/Development/NeoApex/apexflow && uv run pytest backend/tests/test_items.py -k "item_change_activity_records or state_change_activity_carries" -v
```

Expected: both PASS.

- [ ] **Step 6: Run the full apexflow suite**

```bash
cd /Users/kennylee/Development/NeoApex/apexflow && uv run pytest backend/tests/ -q
```

Expected: 555 passed (553 baseline + 2).

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add apexflow/backend/app/workflows/engine.py apexflow/backend/tests/test_items.py
git commit -m "feat(apexflow): attribute item_change activity to its item

Two items in flight on one instance previously reported identical
timestamps, so no consumer could say how long a specific item had been
waiting. Additive: pre-existing rows read as absent."
```

---

## Task 2: `attentionData.ts` — types and SQL builders

**Files:**
- Create: `admindash/frontend/src/utils/attentionData.ts`
- Test: `admindash/frontend/src/utils/__tests__/attentionData.test.ts`

**Interfaces:**
- Consumes: `parseMachineStates`, `asNumber` from `./workflowData.ts`; `ITEM_DONE_STATUSES` from `@neoapex/flow-runtime`.
- Produces: `BucketKey`, `DefinitionRow`, `ItemAttentionRow`, `InstanceSilenceRow`, and four builders — `publishedDefinitionsSql()`, `submittedItemsSql()`, `overdueItemsSql(nowIso)`, `instanceSilenceSql()`.

- [ ] **Step 1: Write the failing tests**

Create `admindash/frontend/src/utils/__tests__/attentionData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  publishedDefinitionsSql,
  publishedMachineSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
} from '../attentionData.ts';

describe('SQL builders', () => {
  const all = [
    publishedDefinitionsSql(),
    publishedMachineSql('enrollment'),
    submittedItemsSql(),
    overdueItemsSql('2026-08-11T00:00:00.000Z'),
    instanceSilenceSql(),
  ];

  it('never selects star, which would return the 1024-float vector column', () => {
    for (const sql of all) expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('quotes the reserved keyword `at`', () => {
    // Non-vacuous: the three builders that touch the activity timestamp must
    // all quote it, and the one that doesn't touch it must not mention it.
    for (const sql of [submittedItemsSql(), overdueItemsSql('x'), instanceSilenceSql()]) {
      expect(sql).toContain('MAX(a."at")');
    }
    expect(publishedDefinitionsSql()).not.toContain('"at"');
  });

  it('scopes the published-machine lookup to one lineage and escapes it', () => {
    expect(publishedMachineSql("en'rol")).toContain("definition_id = 'en''rol'");
    expect(publishedMachineSql('enrollment')).toContain("status = 'published'");
  });

  it('scopes every table reference to active rows', () => {
    for (const sql of all) expect(sql).toContain("_status = 'active'");
  });

  it('published definitions reads only the three columns needed', () => {
    const sql = publishedDefinitionsSql();
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain('definition_id');
    expect(sql).toContain('machine');
    expect(sql).not.toContain('vector');
  });

  it('submitted items join activity on the item, not just the instance', () => {
    const sql = submittedItemsSql();
    expect(sql).toContain("i.status = 'submitted'");
    expect(sql).toContain('a.item_id = i.entity_id');
  });

  it('overdue excludes every done status so a submitted item is not double counted', () => {
    const sql = overdueItemsSql('2026-08-11T00:00:00.000Z');
    expect(sql).toContain("'submitted'");
    expect(sql).toContain("'verified'");
    expect(sql).toContain("'waived'");
    expect(sql).toContain('NOT IN');
    expect(sql).toContain("i.due_at < '2026-08-11T00:00:00.000Z'");
  });

  it('escapes a quote in the injected timestamp', () => {
    expect(overdueItemsSql("2026'; DROP")).toContain("2026''; DROP");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx vitest run src/utils/__tests__/attentionData.test.ts
```

Expected: FAIL — `Failed to resolve import "../attentionData.ts"`.

- [ ] **Step 3: Create the module with types and builders**

Create `admindash/frontend/src/utils/attentionData.ts`:

```ts
import { ITEM_DONE_STATUSES } from '@neoapex/flow-runtime';

/**
 * Pure logic for the AdminDash attention queue — no network, no React, so
 * vitest exercises it directly under the node environment (same shape as
 * `workflowData.ts`, which this module sits beside and reuses).
 *
 * Two properties this module exists to guarantee:
 *
 * 1. Home's counts and `/attention`'s rows come from ONE grouping, so they
 *    cannot disagree. Home renders `.length`; the page renders the rows.
 * 2. No age is ever derived from `_created_at`. DataCore rebuilds the row on
 *    every write with `_created_at = now` (`store.py:378-388`), so on an
 *    active row it means last-modified. Ages come from `due_at`, from
 *    `workflow_activity."at"`, or not at all.
 *
 * SQL notes: `SELECT *` is banned here — the flattened table carries a
 * 1024-float `vector` column and `/api/query` returns it (unlike
 * `/api/query/readonly`, which pops it). `at` is quoted because it is a
 * DuckDB reserved keyword.
 */

export type BucketKey = 'overdue' | 'review' | 'stalled';

/** A `workflow_definition` row, published, as `publishedDefinitionsSql`
 * returns it. `machine` arrives JSON-ENCODED (DataCore flattens scalars to
 * strings); `parseMachineStates` tolerates both that and a parsed object. */
export interface DefinitionRow {
  definition_id?: string;
  name?: string;
  machine?: unknown;
  [key: string]: unknown;
}

/** One flagged `workflow_item`, already joined to its instance.
 * `last_item_change` is null for items last touched before apexflow began
 * writing `item_id` — the age is then omitted, never guessed. */
export interface ItemAttentionRow {
  item_entity_id?: string;
  title?: string;
  due_at?: string | null;
  instance_entity_id?: string;
  definition_id?: string;
  state?: string;
  applicant_email?: string;
  last_item_change?: string | null;
  [key: string]: unknown;
}

/** One instance with the timestamp of its most recent activity of any type. */
export interface InstanceSilenceRow {
  instance_entity_id?: string;
  definition_id?: string;
  state?: string;
  applicant_email?: string;
  last_activity?: string | null;
  [key: string]: unknown;
}

/** Doubled single quotes, same rule as `workflowData.ts::escapeSqlLiteral` —
 * reimplemented rather than imported so each module stays a leaf. */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Every published definition in the lineage set, with the machine JSON the
 * terminal-state index is built from. Retired lineages are INCLUDED:
 * `lineage_status = 'retired'` stops new instances, but the ones already in
 * flight are still real work. */
export function publishedDefinitionsSql(): string {
  return (
    `SELECT definition_id, name, machine FROM data ` +
    `WHERE entity_type = 'workflow_definition' AND _status = 'active' ` +
    `AND status = 'published'`
  );
}

/**
 * The `machine` of one lineage's published row, for the instance drawer.
 *
 * Keyed on `status = 'published'` rather than on a version number: an
 * attention row carries no `definition_version`, and guessing one (`1`) breaks
 * the moment a lineage is republished. `WorkflowPipelinePage` reaches the same
 * row via `pinnedDefinitionSql` only because it already holds the published
 * version from the definitions list.
 */
export function publishedMachineSql(definitionId: string): string {
  return (
    `SELECT machine FROM data WHERE entity_type = 'workflow_definition' ` +
    `AND _status = 'active' AND status = 'published' ` +
    `AND definition_id = '${escapeSqlLiteral(definitionId)}'`
  );
}

/** Shared SELECT list for both item buckets. Eight columns, the last an
 * aggregate — hence `GROUP BY 1..7`. */
const ITEM_SELECT =
  `SELECT i.entity_id AS item_entity_id, i.title AS title, i.due_at AS due_at, ` +
  `i.instance_id AS instance_entity_id, inst.definition_id AS definition_id, ` +
  `inst.state AS state, inst.applicant_email AS applicant_email, ` +
  `MAX(a."at") AS last_item_change`;

/** The item -> instance -> activity join. `a.item_id = i.entity_id` is what
 * makes the age per-ITEM rather than per-instance (Task 1). The column
 * resolves even on a tenant where no activity row has ever carried it: the
 * flattened table is the union of every entity type's columns, and
 * `workflow_item` rows supply `item_id`. Unattributed rows simply return
 * `last_item_change: null`. */
const ITEM_JOIN =
  ` FROM data i ` +
  `JOIN data inst ON inst.entity_id = i.instance_id ` +
  `AND inst.entity_type = 'workflow_instance' AND inst._status = 'active' ` +
  `LEFT JOIN data a ON a.instance_id = inst.entity_id ` +
  `AND a.entity_type = 'workflow_activity' AND a._status = 'active' ` +
  `AND a.type = 'item_change' AND a.item_id = i.entity_id`;

const ITEM_GROUP = ` GROUP BY 1, 2, 3, 4, 5, 6, 7`;

/** Items a family has sent in that staff must verify or reject. */
export function submittedItemsSql(): string {
  return (
    ITEM_SELECT + ITEM_JOIN +
    ` WHERE i.entity_type = 'workflow_item' AND i._status = 'active' ` +
    `AND i.status = 'submitted'` + ITEM_GROUP
  );
}

/**
 * Items past their due date that are not yet done.
 *
 * A `submitted` item is DONE for this rule — `ITEM_DONE_STATUSES` is
 * `{submitted, verified, waived}`. The family met the deadline and the item
 * already appears under Awaiting review; counting it as overdue too would
 * report one item as both a family failure and a staff backlog.
 *
 * The status list is derived from the generated vocabulary rather than
 * re-spelled, so it cannot drift from apexflow's `ItemStatus` enum.
 */
export function overdueItemsSql(nowIso: string): string {
  const done = ITEM_DONE_STATUSES.map((s) => `'${escapeSqlLiteral(s)}'`).join(', ');
  return (
    ITEM_SELECT + ITEM_JOIN +
    ` WHERE i.entity_type = 'workflow_item' AND i._status = 'active' ` +
    `AND i.due_at IS NOT NULL AND i.due_at <> '' ` +
    `AND i.due_at < '${escapeSqlLiteral(nowIso)}' ` +
    `AND i.status NOT IN (${done})` + ITEM_GROUP
  );
}

/**
 * Every active instance with the timestamp of its most recent activity of any
 * type. The silence threshold is applied in TypeScript, not here, so the same
 * rows can answer "how quiet is the quietest" without a second query.
 *
 * Every instance receives a `state_change` at creation
 * (apexflow `engine.py:255`), so `last_activity` is null only for genuinely
 * malformed data — never for a brand-new instance.
 */
export function instanceSilenceSql(): string {
  return (
    `SELECT inst.entity_id AS instance_entity_id, inst.definition_id AS definition_id, ` +
    `inst.state AS state, inst.applicant_email AS applicant_email, ` +
    `MAX(a."at") AS last_activity ` +
    `FROM data inst ` +
    `LEFT JOIN data a ON a.instance_id = inst.entity_id ` +
    `AND a.entity_type = 'workflow_activity' AND a._status = 'active' ` +
    `WHERE inst.entity_type = 'workflow_instance' AND inst._status = 'active' ` +
    `GROUP BY 1, 2, 3, 4`
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx vitest run src/utils/__tests__/attentionData.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the SQL against live DataCore**

DataCore must be running (`./start-services.sh`). This catches Binder/Parser errors that no unit test can.

```bash
cd /Users/kennylee/Development/NeoApex
curl -s -m 8 -X POST http://localhost:5800/api/query -H 'Content-Type: application/json' \
  -d '{"tenant_id":"acme","table":"entities","sql":"SELECT i.entity_id AS item_entity_id, i.title AS title, i.due_at AS due_at, i.instance_id AS instance_entity_id, inst.definition_id AS definition_id, inst.state AS state, inst.applicant_email AS applicant_email, MAX(a.\"at\") AS last_item_change FROM data i JOIN data inst ON inst.entity_id = i.instance_id AND inst.entity_type = '"'"'workflow_instance'"'"' AND inst._status = '"'"'active'"'"' LEFT JOIN data a ON a.instance_id = inst.entity_id AND a.entity_type = '"'"'workflow_activity'"'"' AND a._status = '"'"'active'"'"' AND a.type = '"'"'item_change'"'"' AND a.item_id = i.entity_id WHERE i.entity_type = '"'"'workflow_item'"'"' AND i._status = '"'"'active'"'"' AND i.status = '"'"'submitted'"'"' GROUP BY 1, 2, 3, 4, 5, 6, 7"}' | head -c 400
```

Expected: a JSON `{"data":[...]}` with rows, **not** a 400. If it 400s with `Binder Error` or `Parser Error`, the builder is wrong — fix before continuing.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/utils/attentionData.ts admindash/frontend/src/utils/__tests__/attentionData.test.ts
git commit -m "feat(admindash): attention SQL builders

Four queries feeding the home queue and /attention. No SELECT *, which
would return the 1024-float vector column; done statuses derived from the
generated vocabulary so overdue cannot double-count a submitted item."
```

---

## Task 3: `attentionData.ts` — classification

**Files:**
- Modify: `admindash/frontend/src/utils/attentionData.ts`
- Test: `admindash/frontend/src/utils/__tests__/attentionData.test.ts`

**Interfaces:**
- Consumes: Task 2's row types; `parseMachineStates` from `./workflowData.ts`; `Lead` from `../types/models.ts`.
- Produces: `AttentionRow`, `LeadAttention`, `AttentionResult`, `AttentionInput`, `definitionIndex()`, `buildAttention()`, `bucketRows()`, `STALLED_DAYS`.

- [ ] **Step 1: Write the failing tests**

Extend the **existing** import at the top of `admindash/frontend/src/utils/__tests__/attentionData.test.ts` with the new names — do not add a second `import` from the same module, which `no-duplicate-imports` flags:

```ts
import {
  publishedDefinitionsSql,
  publishedMachineSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
  definitionIndex,
  buildAttention,
  bucketRows,
  type AttentionInput,
} from '../attentionData.ts';
```

Then append:

```ts
const DAY = 86_400_000;
const NOW = Date.parse('2026-08-11T12:00:00.000Z');

/** `machine` arrives JSON-encoded from DataCore — encoded here too, so the
 * test exercises the real wire shape rather than a convenient object. */
const DEFS = [
  {
    definition_id: 'enrollment',
    name: 'Registration 2026',
    machine: JSON.stringify({
      states: [
        { state_id: 'draft', name: 'Draft', kind: 'initial' },
        { state_id: 'review', name: 'In review', kind: 'active' },
        { state_id: 'done', name: 'Enrolled', kind: 'terminal' },
      ],
      transitions: [],
    }),
  },
  {
    definition_id: 'signup',
    name: 'Afterschool Signup',
    machine: JSON.stringify({
      // `done` is ACTIVE here — the same state id means different things in
      // different definitions, so terminality must be resolved per definition.
      states: [
        { state_id: 'open', name: 'Open', kind: 'initial' },
        { state_id: 'done', name: 'Still going', kind: 'active' },
      ],
      transitions: [],
    }),
  },
];

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    definitions: DEFS,
    submitted: [],
    overdue: [],
    silence: [],
    leads: [],
    leadStages: ['New', 'Contacted', 'Enrolled'],
    nowMs: NOW,
    stalledDays: 7,
    ...over,
  };
}

describe('definitionIndex', () => {
  it('resolves terminality per definition, not globally', () => {
    const idx = definitionIndex(DEFS);
    expect(idx.get('enrollment')!.terminal.has('done')).toBe(true);
    expect(idx.get('signup')!.terminal.has('done')).toBe(false);
  });

  it('falls back to the id when a definition has no name', () => {
    const idx = definitionIndex([{ definition_id: 'x', machine: '{}' }]);
    expect(idx.get('x')!.name).toBe('x');
  });

  it('treats an unparseable machine as having no terminal states', () => {
    const idx = definitionIndex([{ definition_id: 'x', name: 'X', machine: 'not json' }]);
    expect(idx.get('x')!.terminal.size).toBe(0);
  });
});

describe('buildAttention', () => {
  const submittedRow = {
    item_entity_id: 'it1',
    title: 'Immunization Record',
    instance_entity_id: 'in1',
    definition_id: 'enrollment',
    state: 'review',
    applicant_email: 'chen@example.com',
    last_item_change: new Date(NOW - 4 * DAY).toISOString(),
  };

  it('flags a submitted item and dates it from the item_change activity', () => {
    const rows = bucketRows(buildAttention(input({ submitted: [submittedRow] })), 'review');
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowName).toBe('Registration 2026');
    expect(rows[0].itemTitle).toBe('Immunization Record');
    expect(rows[0].ageMs).toBe(4 * DAY);
  });

  it('omits the age when the item_change predates item attribution', () => {
    const rows = bucketRows(
      buildAttention(input({ submitted: [{ ...submittedRow, last_item_change: null }] })),
      'review',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ageMs).toBeNull();
  });

  it('drops a row whose instance sits in a terminal state', () => {
    const rows = bucketRows(
      buildAttention(input({ submitted: [{ ...submittedRow, state: 'done' }] })),
      'review',
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps a row in a state that is terminal only in ANOTHER definition', () => {
    const rows = bucketRows(
      buildAttention(input({
        submitted: [{ ...submittedRow, definition_id: 'signup', state: 'done' }],
      })),
      'review',
    );
    expect(rows).toHaveLength(1);
  });

  it('dates an overdue item from due_at, needing no activity row', () => {
    const rows = bucketRows(
      buildAttention(input({
        overdue: [{
          item_entity_id: 'it2', title: 'Proof of address',
          instance_entity_id: 'in2', definition_id: 'enrollment', state: 'review',
          due_at: new Date(NOW - 9 * DAY).toISOString(), last_item_change: null,
        }],
      })),
      'overdue',
    );
    expect(rows[0].ageMs).toBe(9 * DAY);
  });

  it('flags an instance silent past the threshold and ignores a fresh one', () => {
    const result = buildAttention(input({
      silence: [
        { instance_entity_id: 'a', definition_id: 'enrollment', state: 'review',
          last_activity: new Date(NOW - 8 * DAY).toISOString() },
        { instance_entity_id: 'b', definition_id: 'enrollment', state: 'review',
          last_activity: new Date(NOW - 2 * DAY).toISOString() },
      ],
    }));
    const rows = bucketRows(result, 'stalled');
    expect(rows).toHaveLength(1);
    expect(rows[0].instanceEntityId).toBe('a');
  });

  it('sorts most urgent first, with unknown ages last', () => {
    const mk = (id: string, days: number | null) => ({
      item_entity_id: id, title: 't', instance_entity_id: id,
      definition_id: 'enrollment', state: 'review',
      last_item_change: days === null ? null : new Date(NOW - days * DAY).toISOString(),
    });
    const rows = bucketRows(
      buildAttention(input({ submitted: [mk('a', 2), mk('b', null), mk('c', 9)] })),
      'review',
    );
    expect(rows.map((r) => r.instanceEntityId)).toEqual(['c', 'a', 'b']);
  });

  it('partitions every row into exactly one bucket, so counts sum to the total', () => {
    // The property Home depends on: a card's number IS the length of the list
    // /attention renders for that bucket, because both call bucketRows on the
    // same result. If a row ever landed in two buckets or none, this breaks.
    const result = buildAttention(input({
      submitted: [{ item_entity_id: 's1', title: 'a', instance_entity_id: 'i1',
        definition_id: 'enrollment', state: 'review',
        last_item_change: new Date(NOW - DAY).toISOString() }],
      overdue: [{ item_entity_id: 'o1', title: 'b', instance_entity_id: 'i2',
        definition_id: 'enrollment', state: 'review',
        due_at: new Date(NOW - 3 * DAY).toISOString() }],
      silence: [{ instance_entity_id: 'i3', definition_id: 'enrollment', state: 'review',
        last_activity: new Date(NOW - 30 * DAY).toISOString() }],
    }));
    const summed = (['overdue', 'review', 'stalled'] as const)
      .reduce((n, b) => n + bucketRows(result, b).length, 0);
    expect(summed).toBe(result.rows.length);
    expect(summed).toBe(3);
  });

  it('counts a lead that is both first-stage and unreachable exactly once', () => {
    const { leads } = buildAttention(input({
      leads: [
        { stage: 'New', email: '', phone: '' },
        { stage: 'New', email: 'a@b.c', phone: '' },
        { stage: 'Contacted', email: '', phone: '' },
        { stage: 'Contacted', email: 'x@y.z', phone: '1' },
        { stage: 'New', email: '', phone: '', converted_family_id: 'fam1' },
      ] as never,
    }));
    expect(leads.total).toBe(3);
    expect(leads.neverContacted).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx vitest run src/utils/__tests__/attentionData.test.ts
```

Expected: FAIL — `definitionIndex is not a function` (or an import resolution error).

- [ ] **Step 3: Implement the classification**

Append to `admindash/frontend/src/utils/attentionData.ts`:

```ts
import { parseMachineStates } from './workflowData.ts';
import type { Lead } from '../types/models.ts';

/** Days of silence before an instance counts as stalled. Beside
 * `HomePage.tsx`'s existing `STALE_DAYS`, and named for the same reason. */
export const STALLED_DAYS = 7;

/** One row on `/attention`; Home renders only the count of each bucket. */
export interface AttentionRow {
  /** Stable React key. Bucket-prefixed because one item can legitimately
   * appear in two buckets across a fetch. */
  key: string;
  bucket: BucketKey;
  instanceEntityId: string;
  definitionId: string;
  workflowName: string;
  applicant: string;
  /** Empty for `stalled` rows, which are instance-scoped. */
  itemTitle: string;
  /** Milliseconds: lateness for `overdue`, waiting time for `review`,
   * silence for `stalled`. **null means not derivable** — render nothing,
   * never zero and never "today". */
  ageMs: number | null;
}

export interface LeadAttention {
  /** Union, not sum — a lead that is both first-stage and unreachable is one
   * piece of work, not two. */
  total: number;
  neverContacted: number;
  unreachable: number;
}

export interface AttentionResult {
  rows: AttentionRow[];
  leads: LeadAttention;
}

export interface AttentionInput {
  definitions: DefinitionRow[];
  submitted: ItemAttentionRow[];
  overdue: ItemAttentionRow[];
  silence: InstanceSilenceRow[];
  leads: Lead[];
  leadStages: string[];
  /** Injected, never `Date.now()` inside — otherwise nothing here is testable. */
  nowMs: number;
  stalledDays: number;
}

export interface DefinitionEntry {
  name: string;
  terminal: Set<string>;
}

/**
 * definition_id -> display name + terminal state ids.
 *
 * Terminality is resolved PER DEFINITION because a state id is only unique
 * within its own machine: `done` is terminal in enrollment and active in
 * signup. Filtering client-side (rather than in SQL) avoids a compound
 * `NOT IN` over `(definition_id, state)` pairs, and volumes are small.
 */
export function definitionIndex(rows: DefinitionRow[]): Map<string, DefinitionEntry> {
  const index = new Map<string, DefinitionEntry>();
  for (const row of rows) {
    const id = String(row.definition_id ?? '');
    if (!id) continue;
    const states = parseMachineStates(row.machine);
    index.set(id, {
      name: String(row.name ?? '') || id,
      terminal: new Set(states.filter((s) => s.kind === 'terminal').map((s) => s.state_id)),
    });
  }
  return index;
}

/** ISO string -> epoch ms, or null for absent/unparseable. */
function parseIso(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Most urgent first; unknown age always last, since an absent age is not a
 * claim that the work is new. */
function byUrgency(a: AttentionRow, b: AttentionRow): number {
  if (a.ageMs === null && b.ageMs === null) return 0;
  if (a.ageMs === null) return 1;
  if (b.ageMs === null) return -1;
  return b.ageMs - a.ageMs;
}

export function leadAttention(leads: Lead[], stages: string[]): LeadAttention {
  const first = stages[0];
  const open = leads.filter((l) => !l.converted_family_id);
  const isNew = (l: Lead) => !!first && l.stage === first;
  const isUnreachable = (l: Lead) => !l.email && !l.phone;
  return {
    total: open.filter((l) => isNew(l) || isUnreachable(l)).length,
    neverContacted: open.filter(isNew).length,
    unreachable: open.filter(isUnreachable).length,
  };
}

/**
 * The single grouping both surfaces read. Home renders each bucket's length;
 * `/attention` renders its rows. Because a count is never computed separately
 * from the list it summarizes, the two cannot disagree.
 */
export function buildAttention(input: AttentionInput): AttentionResult {
  const index = definitionIndex(input.definitions);
  const nameOf = (id: string) => index.get(id)?.name ?? id;
  const isTerminal = (id: string, state: string) =>
    index.get(id)?.terminal.has(state) ?? false;

  const rows: AttentionRow[] = [];

  const pushItem = (row: ItemAttentionRow, bucket: BucketKey, ageMs: number | null) => {
    const definitionId = String(row.definition_id ?? '');
    if (isTerminal(definitionId, String(row.state ?? ''))) return;
    rows.push({
      key: `${bucket}:${String(row.item_entity_id ?? '')}`,
      bucket,
      instanceEntityId: String(row.instance_entity_id ?? ''),
      definitionId,
      workflowName: nameOf(definitionId),
      applicant: String(row.applicant_email ?? ''),
      itemTitle: String(row.title ?? ''),
      ageMs,
    });
  };

  for (const row of input.overdue) {
    // due_at is a durable base-data field, so lateness needs no activity row.
    const due = parseIso(row.due_at);
    pushItem(row, 'overdue', due === null ? null : input.nowMs - due);
  }

  for (const row of input.submitted) {
    // The only age that depends on apexflow carrying item_id.
    const changed = parseIso(row.last_item_change);
    pushItem(row, 'review', changed === null ? null : input.nowMs - changed);
  }

  const threshold = input.stalledDays * 86_400_000;
  for (const row of input.silence) {
    const definitionId = String(row.definition_id ?? '');
    if (isTerminal(definitionId, String(row.state ?? ''))) continue;
    const last = parseIso(row.last_activity);
    // Every instance gets a state_change at creation (apexflow engine.py:255),
    // so a null here is malformed data, not a new instance. Judging it silent
    // would be a guess, so it is skipped.
    if (last === null) continue;
    const age = input.nowMs - last;
    if (age < threshold) continue;
    rows.push({
      key: `stalled:${String(row.instance_entity_id ?? '')}`,
      bucket: 'stalled',
      instanceEntityId: String(row.instance_entity_id ?? ''),
      definitionId,
      workflowName: nameOf(definitionId),
      applicant: String(row.applicant_email ?? ''),
      itemTitle: '',
      ageMs: age,
    });
  }

  rows.sort(byUrgency);
  return { rows, leads: leadAttention(input.leads, input.leadStages) };
}

export function bucketRows(result: AttentionResult, bucket: BucketKey): AttentionRow[] {
  return result.rows.filter((r) => r.bucket === bucket);
}

/**
 * A millisecond age as whole days, floored, never below 1.
 *
 * A row only reaches a bucket by qualifying for it, so it represents at least
 * a day's worth of waiting; rendering "0 days" would read as "no problem" on
 * the one surface whose whole job is to say otherwise. Shared by Home's card
 * detail lines and `/attention`'s rows so the two can never round differently.
 */
export function ageDays(ms: number): number {
  return Math.max(1, Math.floor(ms / 86_400_000));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx vitest run src/utils/__tests__/attentionData.test.ts
```

Expected: PASS.

- [ ] **Step 5: Prove the tests bite**

A green suite has meant nothing here before. Break the code, confirm the test catches it, then restore.

Temporarily change `byUrgency`'s null handling to `if (a.ageMs === null) return -1;` and rerun. Expected: the sort test FAILS with `['b','c','a']`. Restore it.

Then temporarily change `isTerminal` to always return `false` and rerun. Expected: the terminal-state test FAILS. Restore it.

- [ ] **Step 6: Run the full vitest suite and typecheck**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run test && npx tsc -b
```

Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/utils/attentionData.ts admindash/frontend/src/utils/__tests__/attentionData.test.ts
git commit -m "feat(admindash): attention classification

One grouping feeds both Home's counts and /attention's rows, so they cannot
disagree. Terminality resolves per definition — a state id is unique only
within its own machine. An underivable age renders as nothing, never zero."
```

---

## Task 4: `useAttention` hook

**Files:**
- Create: `admindash/frontend/src/hooks/useAttention.ts`

**Interfaces:**
- Consumes: Task 2/3's builders and `buildAttention`; `postQuery`, `listLeads` from `../api/client.ts`; `settledSection` from `../utils/workflowData.ts`; `leadStages` from `../utils/leadModel.ts`; `useModel` from `../contexts/ModelContext.tsx`.
- Produces: `useAttention(tenant)` returning `{ result, loaded, failed, reload }` where `failed` is `Record<'definitions'|'submitted'|'overdue'|'silence'|'leads', boolean>`.

- [ ] **Step 1: Create the hook**

Create `admindash/frontend/src/hooks/useAttention.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { postQuery, listLeads } from '../api/client.ts';
import { settledSection } from '../utils/workflowData.ts';
import { leadStages } from '../utils/leadModel.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import {
  publishedDefinitionsSql,
  submittedItemsSql,
  overdueItemsSql,
  instanceSilenceSql,
  buildAttention,
  STALLED_DAYS,
  type AttentionResult,
  type DefinitionRow,
  type ItemAttentionRow,
  type InstanceSilenceRow,
} from '../utils/attentionData.ts';
import type { Lead } from '../types/models.ts';

export interface AttentionFailures {
  definitions: boolean;
  submitted: boolean;
  overdue: boolean;
  silence: boolean;
  leads: boolean;
}

const NO_FAILURES: AttentionFailures = {
  definitions: false, submitted: false, overdue: false, silence: false, leads: false,
};

export interface AttentionState {
  result: AttentionResult | null;
  loaded: boolean;
  failed: AttentionFailures;
  reload: () => void;
}

/**
 * The one fetch behind both the Home queue and `/attention`.
 *
 * Every section is settled independently. The drawer's live-gate finding
 * (`workflowData.ts:257`) was that a single rejecting query threw before any
 * `setState` ran, so three healthy sections rendered their empty copy. Here
 * the same failure hides one card and leaves the rest correct.
 */
export function useAttention(tenant: string): AttentionState {
  const { getModel, getCachedModel } = useModel();
  const [result, setResult] = useState<AttentionResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<AttentionFailures>(NO_FAILURES);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;

    async function load() {
      setLoaded(false);
      // The lead model supplies the stage vocabulary; a failure degrades the
      // lead bucket to "no stages", not the whole page.
      await getModel(tenant, 'lead').catch(() => undefined);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const [defs, submitted, overdue, silence, leads] = await Promise.allSettled([
        postQuery(tenant, 'entities', publishedDefinitionsSql()),
        postQuery(tenant, 'entities', submittedItemsSql()),
        postQuery(tenant, 'entities', overdueItemsSql(nowIso)),
        postQuery(tenant, 'entities', instanceSilenceSql()),
        listLeads(tenant),
      ]);

      if (cancelled) return;

      const d = settledSection(defs, { data: [], total: 0 });
      const s = settledSection(submitted, { data: [], total: 0 });
      const o = settledSection(overdue, { data: [], total: 0 });
      const q = settledSection(silence, { data: [], total: 0 });
      const l = settledSection(leads, [] as Lead[]);

      setFailed({
        definitions: d.failed, submitted: s.failed,
        overdue: o.failed, silence: q.failed, leads: l.failed,
      });

      setResult(buildAttention({
        definitions: d.data.data as unknown as DefinitionRow[],
        submitted: s.data.data as unknown as ItemAttentionRow[],
        overdue: o.data.data as unknown as ItemAttentionRow[],
        silence: q.data.data as unknown as InstanceSilenceRow[],
        leads: l.data,
        leadStages: leadStages(getCachedModel('lead')),
        nowMs,
        stalledDays: STALLED_DAYS,
      }));
      setLoaded(true);
    }

    void load();
    return () => { cancelled = true; };
  }, [tenant, nonce, getModel, getCachedModel]);

  return { result, loaded, failed, reload };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b
```

Expected: no errors. If `listLeads`'s return type does not match `Lead[]`, adjust the `settledSection` fallback's type argument rather than casting.

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/hooks/useAttention.ts
git commit -m "feat(admindash): useAttention hook

Five independently-settled fetches feeding one grouping. A single failing
query hides its own card rather than blanking the section."
```

---

## Task 5: Home page — the four cards and the Lead pipeline rename

**Files:**
- Modify: `admindash/frontend/src/pages/HomePage.tsx:99-253` (queue + lead fetch) and `:386-395` (pipeline heading)
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `useAttention` from Task 4; `bucketRows` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the translation keys**

In `src/i18n/translations.ts`, in the **`en-US`** table, change `today.pipeline` and add the new keys beside the existing `today.*` block:

```ts
    'today.pipeline': 'Lead pipeline',
    'today.overdue': 'Overdue',
    'today.overdueAction': 'Open',
    'today.overdueDetail': 'worst is {n} days late',
    'today.overdueDetailOne': 'worst is 1 day late',
    'today.review': 'Awaiting your review',
    'today.reviewAction': 'Review',
    'today.reviewDetail': 'oldest waiting {n} days',
    'today.reviewDetailOne': 'oldest waiting 1 day',
    'today.stalled': 'Nothing is moving',
    'today.stalledAction': 'Open',
    'today.stalledDetail': 'quiet for {n} days',
    'today.stalledDetailOne': 'quiet for 1 day',
    'today.inquiries': 'Inquiries to follow up',
    'today.inquiriesAction': 'Open leads',
    'today.inquiriesDetail': '{n} never contacted',
    'today.seeAll': 'See all {n}',
    'today.queuePartial': 'Some counts could not be loaded.',
```

In the **`zh-CN`** table, add the matching keys:

```ts
    'today.pipeline': '线索漏斗',
    'today.overdue': '已逾期',
    'today.overdueAction': '打开',
    'today.overdueDetail': '最久逾期 {n} 天',
    'today.overdueDetailOne': '最久逾期 1 天',
    'today.review': '等待您审核',
    'today.reviewAction': '审核',
    'today.reviewDetail': '最久已等 {n} 天',
    'today.reviewDetailOne': '最久已等 1 天',
    'today.stalled': '没有进展',
    'today.stalledAction': '打开',
    'today.stalledDetail': '已静默 {n} 天',
    'today.stalledDetailOne': '已静默 1 天',
    'today.inquiries': '待跟进咨询',
    'today.inquiriesAction': '打开线索',
    'today.inquiriesDetail': '{n} 个尚未联系',
    'today.seeAll': '查看全部 {n}',
    'today.queuePartial': '部分统计无法加载。',
```

Also update the existing `zh-CN` `today.pipeline` value if one is already present — there must be exactly one entry per key per locale.

**Delete the old queue's keys from BOTH locales.** Verified before planning: these are referenced only by `HomePage.tsx`, nowhere else in `src/`, so Task 5 leaves every one of them dead. Remove all fourteen:

```
today.unassignedLeads        today.unassignedLeadsAction
today.staleLeads             today.staleLeadsAction
today.unreachableLeads       today.unreachableLeadsAction
today.unreachableLeadsDetail today.readyToEnroll
today.readyToEnrollAction    today.readyToEnrollDetail
today.oldestWaiting          today.oldestWaitingOne
today.longestWaiting         today.longestWaitingOne
```

Keep `today.needsYou`, `today.allClear`, `today.allClearBody`, `today.viewAll`, `today.noStages` and everything under `today.thisWeek` / `today.inquiryLink` — those sections are untouched. After the edit, confirm nothing references a deleted key:

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
grep -rn "today.unassignedLeads\|today.staleLeads\|today.unreachableLeads\|today.readyToEnroll\|today.oldestWaiting\|today.longestWaiting" src/
```

Expected: no output.

- [ ] **Step 2: Run the translations test**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx vitest run src/i18n/__tests__/translations.test.ts
```

Expected: PASS. A failure here names exactly which key is missing from which locale.

- [ ] **Step 3: Replace the queue in HomePage**

In `src/pages/HomePage.tsx`:

Add the imports:

```ts
import { useAttention } from '../hooks/useAttention.ts';
import { ageDays, bucketRows } from '../utils/attentionData.ts';
```

`ageDays` is imported rather than defined here: a helper declared in the
component body is a new identity every render, which
`react-hooks/exhaustive-deps` flags when a `useMemo` references it — and lint
must stay at exactly 5 errors. It also keeps Home and `/attention` rounding
identically.

Call the hook beside the existing state (after `const { getModel, getCachedModel } = useModel();`):

```ts
  const attention = useAttention(tenant);
```

Replace the entire `queue` `useMemo` (lines 169-253, from `const queue = useMemo<QueueItem[]>(() => {` through its closing `}, [leads, leadsLoaded, stages, navigate, t]);`) with:

```ts
  /** "1 day" and "4 days" need different strings; there is no plural support. */
  const days = useCallback(
    (n: number, oneKey: string, manyKey: string) =>
      (n === 1 ? t(oneKey) : t(manyKey)).replace('{n}', String(n)),
    [t],
  );

  const queue = useMemo<QueueItem[]>(() => {
    const result = attention.result;
    if (!result) return [];

    /** The largest age in a bucket, or null when no row in it has one. */
    const worst = (bucket: 'overdue' | 'review' | 'stalled'): number | null => {
      const ages = bucketRows(result, bucket)
        .map((r) => r.ageMs)
        .filter((a): a is number => a !== null);
      return ages.length ? Math.max(...ages) : null;
    };

    const detail = (bucket: 'overdue' | 'review' | 'stalled', one: string, many: string) => {
      const ms = worst(bucket);
      if (ms === null) return undefined;
      return days(ageDays(ms), one, many);
    };

    const items: QueueItem[] = [
      {
        key: 'overdue',
        count: bucketRows(result, 'overdue').length,
        label: t('today.overdue'),
        detail: detail('overdue', 'today.overdueDetailOne', 'today.overdueDetail'),
        action: t('today.overdueAction'),
        // A missed deadline is a genuine fault, which is what `danger` is
        // reserved for — see the tone comment in HomePage.css.
        tone: 'danger',
        onAct: () => navigate('/attention?bucket=overdue'),
      },
      {
        key: 'review',
        count: bucketRows(result, 'review').length,
        label: t('today.review'),
        detail: detail('review', 'today.reviewDetailOne', 'today.reviewDetail'),
        action: t('today.reviewAction'),
        // Deliberately not `danger`: a queue of work awaiting review is
        // routine backlog, not a fault. Red stays meaningful that way.
        tone: 'attn',
        onAct: () => navigate('/attention?bucket=review'),
      },
      {
        key: 'stalled',
        count: bucketRows(result, 'stalled').length,
        label: t('today.stalled'),
        detail: detail('stalled', 'today.stalledDetailOne', 'today.stalledDetail'),
        action: t('today.stalledAction'),
        tone: 'attn',
        onAct: () => navigate('/attention?bucket=stalled'),
      },
      {
        key: 'inquiries',
        count: result.leads.total,
        label: t('today.inquiries'),
        detail: result.leads.neverContacted
          ? t('today.inquiriesDetail').replace('{n}', String(result.leads.neverContacted))
          : undefined,
        action: t('today.inquiriesAction'),
        tone: 'ok',
        onAct: () => navigate('/leads'),
      },
    ];

    return items.filter((i) => i.count > 0);
  }, [attention.result, navigate, t, days]);
```

Delete the now-unused `daysSince` helper (lines 52-57) and the `STALE_DAYS` constant (line 26) — nothing references them once the old queue is gone. Keep the `leads` / `leadsLoaded` state and its fetch: the Lead pipeline section below still uses them.

- [ ] **Step 4: Swap the queue's loading gate and add the section link**

In the "Needs you today" section, replace `!leadsLoaded` with `!attention.loaded` in the skeleton condition, and give the section a header with the See-all link. Replace the section's opening through its `<h2>`:

```tsx
        <section className="today-section" aria-labelledby="today-queue-h">
          <div className="today-section-head">
            <h2 className="today-section-title" id="today-queue-h">
              {t('today.needsYou')}
            </h2>
            {queue.length > 0 && (
              <button
                type="button"
                className="btn btn-link"
                onClick={() => navigate('/attention')}
              >
                {t('today.seeAll').replace(
                  '{n}',
                  String(queue.reduce((n, i) => n + i.count, 0)),
                )}
              </button>
            )}
          </div>

          {!attention.loaded ? (
```

Immediately after the skeleton/all-clear/grid block closes and before `</section>`, add the partial-failure notice:

```tsx
          {attention.loaded && Object.values(attention.failed).some(Boolean) && (
            <p className="today-muted" role="status">
              {t('today.queuePartial')}{' '}
              <button type="button" className="btn btn-link" onClick={attention.reload}>
                {t('common.retry')}
              </button>
            </p>
          )}
```

- [ ] **Step 5: Verify the pipeline heading**

The heading already reads `{t('today.pipeline')}` (line ~390), so Step 1's string change renames it to "Lead pipeline" with no JSX edit. Confirm by grep:

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && grep -n "today.pipeline" src/pages/HomePage.tsx src/i18n/translations.ts
```

Expected: one usage in `HomePage.tsx`, one entry per locale in `translations.ts`, both reading "Lead pipeline" / the zh-CN equivalent.

- [ ] **Step 6: Build, typecheck, lint**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build && npm run lint
```

Expected: build clean. Lint reports **exactly 5** pre-existing errors (DynamicForm, AuthContext, DashboardContext, ModelContext). A 6th means this task introduced it.

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/pages/HomePage.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): home queue reviews workflows, pipeline renamed

Needs you today now counts overdue items, items awaiting staff review, and
stalled instances across every published workflow, plus one lead bucket.
Enrollment pipeline becomes Lead pipeline — same data, honest name."
```

---

## Task 6: `/attention` page and route

**Files:**
- Create: `admindash/frontend/src/pages/AttentionPage.tsx`
- Create: `admindash/frontend/src/pages/AttentionPage.css`
- Modify: `admindash/frontend/src/App.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `useAttention` (Task 4); `bucketRows`, `ageDays`, `publishedMachineSql`, `AttentionRow`, `BucketKey` (Tasks 2-3); `WorkflowInstanceDrawer`; `instanceSql` and `InstanceRow` from `workflowData.ts`.
- Produces: route `/attention`, honouring `?bucket=overdue|review|stalled`.

- [ ] **Step 1: Add the translation keys**

`en-US`:

```ts
    'attention.title': 'Needs you today',
    'attention.subtitle': '{n} across your workflows',
    'attention.all': 'All',
    'attention.empty': 'Nothing needs your attention right now.',
    'attention.groupEmpty': 'Nothing in this group.',
    'attention.noApplicant': 'No email on file',
    'attention.reviewWhat': '{title} — submitted, needs verifying',
    'attention.overdueWhat': '{title} — past its due date',
    'attention.stalledWhat': 'No activity',
    'attention.daysLate': '{n}d late',
    'attention.daysWaiting': '{n}d',
    'attention.ageUnknown': '—',
    'attention.loadError': 'Some rows could not be loaded.',
```

`zh-CN`:

```ts
    'attention.title': '今日待办',
    'attention.subtitle': '共 {n} 项',
    'attention.all': '全部',
    'attention.empty': '目前没有需要处理的事项。',
    'attention.groupEmpty': '该分组为空。',
    'attention.noApplicant': '未登记邮箱',
    'attention.reviewWhat': '{title} — 已提交，待审核',
    'attention.overdueWhat': '{title} — 已过期',
    'attention.stalledWhat': '无活动',
    'attention.daysLate': '逾期 {n} 天',
    'attention.daysWaiting': '{n} 天',
    'attention.ageUnknown': '—',
    'attention.loadError': '部分条目无法加载。',
```

- [ ] **Step 2: Run the translations test**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx vitest run src/i18n/__tests__/translations.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create the page**

Create `src/pages/AttentionPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { postQuery } from '../api/client.ts';
import { useAttention } from '../hooks/useAttention.ts';
import {
  ageDays,
  bucketRows,
  publishedMachineSql,
  type AttentionRow,
  type BucketKey,
} from '../utils/attentionData.ts';
import { instanceSql, type InstanceRow } from '../utils/workflowData.ts';
import Button from '../components/ui/Button.tsx';
import WorkflowInstanceDrawer from '../components/WorkflowInstanceDrawer.tsx';
import './AttentionPage.css';

interface AttentionPageProps {
  tenant: string;
}

const BUCKETS: { key: BucketKey; label: string; what: string }[] = [
  { key: 'overdue', label: 'today.overdue', what: 'attention.overdueWhat' },
  { key: 'review', label: 'today.review', what: 'attention.reviewWhat' },
  { key: 'stalled', label: 'today.stalled', what: 'attention.stalledWhat' },
];

/**
 * The full list behind the Home page's counts (`/attention`).
 *
 * Reads the SAME grouping Home renders counts from (`useAttention`), so a
 * card's number is always the length of the list this page shows for that
 * bucket. `?bucket=` selects a group; absent, every group renders.
 *
 * Clicking a row opens `WorkflowInstanceDrawer`, which already performs
 * verify / reject / waive per item — staff act without leaving the list. The
 * drawer needs the full instance row and the pinned machine, neither of which
 * the attention grouping carries (it holds only what a row displays), so both
 * are fetched on demand for the clicked instance.
 */
export default function AttentionPage({ tenant }: AttentionPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const attention = useAttention(tenant);

  const [openInstance, setOpenInstance] = useState<InstanceRow | null>(null);
  const [openMachine, setOpenMachine] = useState<unknown>(null);

  const selected = params.get('bucket') as BucketKey | null;
  const shown = useMemo(
    () => BUCKETS.filter((b) => !selected || b.key === selected),
    [selected],
  );

  const total = attention.result?.rows.length ?? 0;

  function countOf(bucket: BucketKey): number {
    return attention.result ? bucketRows(attention.result, bucket).length : 0;
  }

  function selectBucket(bucket: BucketKey | null) {
    if (bucket) setParams({ bucket });
    else setParams({});
  }

  async function openRow(row: AttentionRow) {
    // The drawer needs the full instance row and the lineage's published
    // machine. The machine is fetched by `status = 'published'`, not by a
    // version number — an attention row carries no `definition_version`, and
    // assuming `1` would silently break on the first republish.
    const [instances, defs] = await Promise.all([
      postQuery(tenant, 'entities', instanceSql(row.definitionId)),
      postQuery(tenant, 'entities', publishedMachineSql(row.definitionId)),
    ]).catch(() => [null, null] as const);
    if (!instances) return;
    const match = (instances.data as unknown as InstanceRow[])
      .find((i) => i.entity_id === row.instanceEntityId);
    if (!match) return;
    setOpenMachine(defs?.data[0]?.machine ?? null);
    setOpenInstance(match);
  }

  function renderRow(row: AttentionRow, whatKey: string) {
    const what = whatKey === 'attention.stalledWhat'
      ? t(whatKey)
      : t(whatKey).replace('{title}', row.itemTitle);
    const age = row.ageMs === null
      ? t('attention.ageUnknown')
      : (row.bucket === 'overdue' ? t('attention.daysLate') : t('attention.daysWaiting'))
          .replace('{n}', String(ageDays(row.ageMs)));

    return (
      <button
        key={row.key}
        type="button"
        className="attention-row"
        onClick={() => void openRow(row)}
      >
        <span className="attention-row-text">
          <strong>
            {row.applicant || t('attention.noApplicant')}
            <span className="attention-wf">{row.workflowName}</span>
          </strong>
          <small>{what}</small>
        </span>
        <span className={`attention-age${row.bucket === 'overdue' ? ' is-late' : ''}`}>
          {age}
        </span>
      </button>
    );
  }

  return (
    <div className="attention-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('attention.title')}
          <span className="page-subtitle">
            {t('attention.subtitle').replace('{n}', String(total))}
          </span>
        </h1>
        <div className="page-header-actions">
          <Button variant="secondary" onClick={() => navigate('/home')}>
            {t('nav.home')}
          </Button>
        </div>
      </header>

      {attention.loaded && Object.values(attention.failed).some(Boolean) && (
        <div className="student-error" role="alert">
          <span>{t('attention.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={attention.reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <div className="attention-chips">
        <button
          type="button"
          className={`attention-chip${selected ? '' : ' is-on'}`}
          onClick={() => selectBucket(null)}
        >
          {t('attention.all')} {total}
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`attention-chip${selected === b.key ? ' is-on' : ''}`}
            onClick={() => selectBucket(b.key)}
          >
            {t(b.label)} {countOf(b.key)}
          </button>
        ))}
      </div>

      {!attention.loaded ? (
        <p className="today-muted">{t('common.loading')}</p>
      ) : total === 0 ? (
        <div className="today-clear">
          <strong>{t('today.allClear')}</strong>
          <span>{t('attention.empty')}</span>
        </div>
      ) : (
        shown.map((b) => {
          const rows = attention.result ? bucketRows(attention.result, b.key) : [];
          return (
            <section key={b.key} className="attention-group" aria-labelledby={`grp-${b.key}`}>
              <h2 className="attention-group-title" id={`grp-${b.key}`}>
                {t(b.label)} <span>{rows.length}</span>
              </h2>
              {rows.length === 0 ? (
                <p className="today-muted">{t('attention.groupEmpty')}</p>
              ) : (
                rows.map((row) => renderRow(row, b.what))
              )}
            </section>
          );
        })
      )}

      {openInstance && (
        <WorkflowInstanceDrawer
          tenant={tenant}
          instance={openInstance}
          definition={openMachine}
          onClose={() => setOpenInstance(null)}
          onChanged={attention.reload}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the stylesheet**

Create `src/pages/AttentionPage.css`:

```css
.attention-page { padding: var(--space-5); max-width: 980px; margin: 0 auto; }

.attention-chips { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }

.attention-chip {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--border-primary);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}
.attention-chip.is-on {
  background: var(--accent-ink);
  border-color: var(--accent-ink);
  color: #fff;
}

.attention-group { margin-bottom: var(--space-5); }
.attention-group-title {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}
.attention-group-title span { color: var(--text-tertiary); }

.attention-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  text-align: left;
  padding: var(--space-3);
  margin-bottom: var(--space-2);
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--card-r);
  cursor: pointer;
}
.attention-row:hover { border-color: var(--accent); }

.attention-row-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.attention-row-text strong {
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.attention-row-text small {
  font-size: var(--text-xs); color: var(--text-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.attention-wf {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 1px var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
}

.attention-age {
  flex: none;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--attn);
  font-variant-numeric: tabular-nums;
}
.attention-age.is-late { color: var(--danger); }

/* The workflow chip is the first thing to go when the row can't hold it —
   the applicant, what is needed, and the age all survive. */
@media (max-width: 640px) {
  .attention-page { padding: var(--space-3); }
  .attention-wf { display: none; }
}
```

- [ ] **Step 5: Register the route**

In `src/App.tsx`, add the import beside the other page imports:

```ts
import AttentionPage from './pages/AttentionPage.tsx';
```

and the route immediately after the `/home` route (line ~65):

```tsx
                      <Route path="/attention" element={<AttentionPage tenant={tenant} />} />
```

- [ ] **Step 6: Build, typecheck, lint**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build && npm run lint
```

Expected: build clean; lint still reports exactly 5 pre-existing errors.

- [ ] **Step 7: Verify in the browser**

Start the services if they are not running (`./start-services.sh`), then sign in to `http://localhost:5600` as the `acme` tenant — it has 17 instances, 34 items and 50 activity rows.

Check, in order:
1. Home's "Needs you today" shows count cards, and the pipeline section reads **"Lead pipeline"**.
2. Clicking a card lands on `/attention?bucket=…` with that group selected and **the same count** shown on the chip.
3. Clicking a row opens the instance drawer with items, documents and activity populated.
4. Narrow the window below 640px: cards go 2-up, the workflow chip disappears from rows, nothing overflows horizontally.
5. Switch to zh-CN via the language switcher: no raw `today.*` or `attention.*` key strings appear on screen.

Fix anything that fails before committing.

- [ ] **Step 8: Run every suite**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run test
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -q
cd /Users/kennylee/Development/NeoApex/apexflow && uv run pytest backend/tests/ -q
```

Expected: admindash vitest above the 94 baseline, admindash pytest 201, apexflow 555.

- [ ] **Step 9: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/pages/AttentionPage.tsx admindash/frontend/src/pages/AttentionPage.css admindash/frontend/src/App.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): /attention lists what the home cards count

The cross-definition instance view AdminDash lacked. Rows open the existing
instance drawer, so staff verify/reject/waive without leaving the list."
```

---

## Task 7: Log the follow-ups the spec identified

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md`

- [ ] **Step 1: Append the three entries**

Add, continuing the file's existing numbering (the last entry is #28, so these are #29-31):

```markdown
29. **`lead` has no durable creation timestamp.** Lead staleness cannot be
    computed honestly: `_created_at` is reset on every write, and
    `lead_activity` records stage transitions with no timestamp of its own.
    The home page's "Inquiries to follow up" bucket is therefore state-based
    only, and the previous "stale > 7 days" bucket was dropped rather than
    carried forward wrong. Fix: write a `created_at` base-data field at lead
    creation.

30. **`_created_at` means last-modified, not created.** `store.py:378-388`'s
    `put_entity` rebuilds the row on every write with `_created_at = now`.
    Verified against live `acme` data: `workflow_item` rows at `_version: 3`
    have `_created_at == _updated_at`. Platform-wide, not page-specific — any
    consumer treating it as a creation time is wrong. The old home-page queue
    was one such consumer.

31. **`/api/query` applies no row cap.** `unified_routes.py:55` calls
    `QueryEngine.query` with no `limit`, unlike `/api/query/readonly`, which
    caps at 200. Fine at current volumes (tens of rows per tenant); a real
    limit belongs there before a large tenant arrives.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md
git commit -m "docs: log follow-ups 29-31 from the attention-queue work"
```

---

## Verification Summary

| Check | Command | Expected |
|---|---|---|
| apexflow | `cd apexflow && uv run pytest backend/tests/ -q` | 555 passed |
| admindash backend | `cd admindash && uv run pytest backend/tests/ -q` | 201 passed |
| admindash vitest | `cd admindash/frontend && npm run test` | above 94 baseline |
| admindash build | `cd admindash/frontend && npm run build` | clean |
| admindash lint | `cd admindash/frontend && npm run lint` | exactly 5 pre-existing errors |
| familyhub | `cd familyhub && uv run pytest backend/tests/ -q` | 89 passed |
| datacore | `cd datacore && uv run python -m pytest tests/ -q` | 354 passed |
| Browser gate | Task 6 Step 7 | all five checks pass |
