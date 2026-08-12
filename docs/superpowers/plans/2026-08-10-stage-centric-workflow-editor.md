# Stage-Centric Workflow Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ApexFlow designer's Machine tab and Steps tab with a single stage-centric editor that reads and writes the existing `workflow_definition.machine`/`steps` JSON unchanged.

**Architecture:** A pure, fully-tested translation layer (`src/editor/stage/`) converts a machine + steps into a `StageModel` and back. Every group of transitions remembers the transitions it came from, so a definition opened and saved with no edits produces a byte-equivalent machine. React components render only the `StageModel`; they never touch `MachineDef` directly. Classification of a group into "a move on a stage" vs "an exit in the Exits panel" is **presentational only** — both write back through the same code path, so a misclassification can never corrupt a machine.

**Tech Stack:** React 19 + TypeScript 5.9 + Vite 8, vitest 3.2 (added to apexflow/frontend by Task 2), Python 3 + pytest for the backend template work.

## Global Constraints

- **No engine, schema, or validator changes.** Nothing under `apexflow/backend/app/workflows/` may be modified. If a task appears to need one, stop and write a ruling into `docs/superpowers/rulings/` rather than widening the engine.
- **Do not modify** `apexflow/backend/app/templates/enrollment.py` or `apexflow/backend/app/templates/signup.py` machine/steps content. They are the round-trip fixtures; changing them to make a test pass invalidates the test.
- **Round-trip is the top correctness property.** `writeMachine(readStageModel(m, steps))` must equal `m` for both shipped templates. Any transition that does not fit a group renders as an explicit move on its stage — never silently dropped.
- **Suite baselines — every task must leave these at or above:** workflow-forms **59** · apexflow backend **584** · familyhub **89** · admindash backend **201** · datacore **354** · admindash vitest **94** · apexflow vitest **0 before Task 2, then never lower than the previous task left it**.
- **`cd workflow-forms && npm ci` FIRST**, before any frontend build. A green local build without this does not prove CI.
- **Every test-adding step is followed by a mutation step**: break the implementation in a stated way, prove the named test fails, revert, prove green. A green suite has meant nothing in this repo four separate times.
- **Clear `__pycache__` and vitest's cache between mutation runs.** A same-byte-length Python mutation inside one second produced a false green during Task 1 because the `.pyc` `(mtime, size)` check did not invalidate. Use `find . -name __pycache__ -type d -not -path "./.venv/*" -exec rm -rf {} +` for Python and `npx vitest run --no-cache` for TS.
- **Two locales.** Every new i18n key must be added to BOTH `'en-US'` and `'zh-CN'` in `apexflow/frontend/src/i18n/translations.ts`. Task 2 adds the parity test that enforces this.
- **Do not touch the AdminDash home page.** It has no spec.
- **Do not fix admindash's 5 pre-existing lint errors** (DynamicForm, AuthContext, DashboardContext, ModelContext). Report if a 6th appears.
- **Follow-ups 25–28** in `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md` stay logged, not fixed, unless a task touches that code anyway.
- **Settled decisions — do not relitigate:** design center is an admin adapting a template; cross-cutting exits get a separate Exits panel authored as one rule; guards/effects render as plain language with an escape hatch to the existing `GuardEffectComposer`; the Machine tab is replaced outright; from-scratch is supported but not optimized and never a blank canvas; crowd-sourced templates are deferred.
- **Three amendments to the design spec, ruled in `docs/superpowers/rulings/2026-08-10-stage-model-coverage-signup.md`, are binding:**
  - **A.** `kind: "terminal"` is derived from *having no outgoing move*, **not** from being last on the spine.
  - **B.** Exit grouping keys on `(action, target, actor, guards, effects)` — everything except `from`.
  - **C.** The phrase-allowlist test is written **before** the phrase set.

---

## File Structure

| File | Responsibility |
|---|---|
| `apexflow/backend/app/templates/signup.py` | The second template. **Landed (Task 1).** |
| `apexflow/backend/app/templates/catalog.py` | The shipped-template list. **Landed (Task 1).** |
| `apexflow/frontend/vitest.config.ts` | Test runner config (Task 2) |
| `apexflow/frontend/src/i18n/__tests__/translations.test.ts` | Locale-parity guard (Task 2) |
| `apexflow/frontend/src/editor/stage/types.ts` | `StageModel` and its parts. No logic. (Task 3) |
| `apexflow/frontend/src/editor/stage/spine.ts` | Stage ordering + finish-stage derivation (Task 3) |
| `apexflow/frontend/src/editor/stage/read.ts` | `machine` + `steps` → `StageModel` (Task 3) |
| `apexflow/frontend/src/editor/stage/write.ts` | `StageModel` → `machine` (Task 4) |
| `apexflow/frontend/src/editor/stage/phrases.ts` | Primitive → plain-language sentence, plus the raw-only allowlist (Task 5) |
| `apexflow/frontend/src/editor/StageEditor.tsx` | The one editor surface. Replaces MachineEditor + the Steps tab. (Task 6) |
| `apexflow/frontend/src/editor/StageCard.tsx` | One stage: name, steps in it, moves out of it (Task 7) |
| `apexflow/frontend/src/editor/MoveRow.tsx` | One move, plain language + "Edit as advanced" (Task 8) |
| `apexflow/frontend/src/editor/ExitsPanel.tsx` | Cross-cutting exits, authored as rules (Task 9) |
| `apexflow/frontend/src/editor/StepEditor.tsx` | Gains a `stageId` prop so a stage card can host its own steps (Task 7) |
| `apexflow/frontend/src/editor/MachineEditor.tsx` | **Deleted** (Task 10) |
| `apexflow/frontend/src/editor/TransitionPanel.tsx` | **Deleted** (Task 10) |
| `apexflow/frontend/src/editor/GuardEffectComposer.tsx` | Kept unchanged — it is the escape hatch |

---

## Task 1: The signup template and the coverage ruling — **LANDED**

Committed as `6b4fa73` before this plan was written, because the design's own Risks section requires the coverage test to precede editor code. Recorded here so the plan is a complete account of the work.

**Files:**
- Created: `apexflow/backend/app/templates/signup.py`
- Created: `apexflow/backend/app/templates/catalog.py`
- Created: `apexflow/backend/tests/test_signup_template.py`
- Created: `docs/superpowers/rulings/2026-08-10-stage-model-coverage-signup.md`
- Modified: `apexflow/backend/app/templates/enrollment.py` (`template_catalog()` → `catalog_entry()`)
- Modified: `apexflow/backend/app/api/designer.py:42`, `scripts/apexflow-reseed-dev.py`
- Modified: `apexflow/backend/tests/test_enrollment_template.py`, `tests/test_designer_api.py`, `tests/test_reseed_script.py`
- Modified: `apexflow/frontend/src/types/designer.ts` (stale doc comment)

**Interfaces:**
- Produces: `app.templates.signup.build_machine() -> dict`, `build_steps() -> list[dict]`, `catalog_entry() -> dict`, `seed_signup_template(tenant_id, *, token=None) -> dict`, `DEFINITION_ID = "signup"`.
- Produces: `app.templates.catalog.template_catalog() -> list[dict]` — now two entries.
- Produces: `app.templates.enrollment.catalog_entry() -> dict` (replaces `template_catalog()`).

- [x] **Step 1:** Signup template written, seeds cleanly, publishes with zero validator errors — verified live against `acme`, `acme-afterschool`, `ruskin`, `afterschool-abc`, and seeded into `acme` (`entity_id=6162cc4d3929`).
- [x] **Step 2:** `template_catalog()` returns two entries.
- [x] **Step 3:** Coverage ruling written, naming specific transitions.
- [x] **Step 4:** Ten mutations run with `__pycache__` cleared, each predicted to break a named test, each confirmed.
- [x] **Step 5:** apexflow backend 553 → 584.

**Verdict carried forward:** the stage model covers signup. Decision 3 stands — the Machine tab is replaced outright, no escape hatch. Amendments A, B, and C above are the price.

---

## Task 2: A test runner for apexflow/frontend

The round-trip property cannot be pinned without one. `apexflow/frontend/package.json` has no `test` script and no vitest; admindash's frontend already has both, so this is a port, not an invention. This task adds nothing to the editor — its whole deliverable is that later tasks have somewhere to put a failing test.

**Files:**
- Create: `apexflow/frontend/vitest.config.ts`
- Create: `apexflow/frontend/src/i18n/__tests__/translations.test.ts`
- Modify: `apexflow/frontend/package.json` (scripts + devDependency)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` in `apexflow/frontend` runs vitest over `src/**/*.test.ts` and `src/**/__tests__/*.test.ts` in a `node` environment. Later tasks add `.test.ts` files under `src/editor/stage/__tests__/`.

- [ ] **Step 1: Add vitest as a devDependency**

```bash
cd apexflow/frontend && npm install --save-dev vitest@^3.2.7
```

- [ ] **Step 2: Add the test scripts**

In `apexflow/frontend/package.json`, inside `"scripts"`, after `"lint"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 3: Add the vitest config**

Create `apexflow/frontend/vitest.config.ts` — identical to `admindash/frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write the locale-parity test**

This is not filler. `translations.ts` carries 578 keys across two locales and nothing checks that a key added to one was added to the other; every task below adds keys. Create `apexflow/frontend/src/i18n/__tests__/translations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { translations, type Locale } from '../translations.ts';

const LOCALES = Object.keys(translations) as Locale[];

describe('translations', () => {
  it('ships more than one locale', () => {
    expect(LOCALES.length).toBeGreaterThan(1);
  });

  it('has the same key set in every locale', () => {
    const reference = LOCALES[0];
    const referenceKeys = Object.keys(translations[reference]).sort();
    for (const locale of LOCALES.slice(1)) {
      const keys = Object.keys(translations[locale]).sort();
      const missing = referenceKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !referenceKeys.includes(k));
      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] });
    }
  });

  it('has no blank values', () => {
    const blank: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(translations[locale])) {
        if (value.trim() === '') blank.push(`${locale}:${key}`);
      }
    }
    expect(blank).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `cd apexflow/frontend && npm test`
Expected: PASS, 3 tests.

- [ ] **Step 6: Mutation — prove the parity test bites**

Delete the line `'nav.language': 'Language',` from the `'en-US'` block of `src/i18n/translations.ts`.
Run: `cd apexflow/frontend && npx vitest run --no-cache`
Expected: FAIL — `has the same key set in every locale`, reporting `extra: ['nav.language']` for `zh-CN`.
Restore the line. Run again. Expected: PASS, 3 tests.

- [ ] **Step 7: Verify the build and lint are unaffected**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint`
Expected: build succeeds, lint reports 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apexflow/frontend/package.json apexflow/frontend/package-lock.json \
        apexflow/frontend/vitest.config.ts \
        apexflow/frontend/src/i18n/__tests__/translations.test.ts
git commit -m "test(apexflow): add vitest and a locale-parity guard

The stage editor's round-trip property is the design's stated single most
important correctness property, and apexflow/frontend had nowhere to run a
test. Ported from admindash/frontend, which already runs vitest over 94
tests with the same config.

The parity test is not filler: translations.ts carries 578 keys across
en-US and zh-CN with nothing checking they agree, and every task in the
stage-editor plan adds keys."
```

---

## Task 3: Read a machine into a StageModel

Pure functions, no React. This task ends with the model and the read direction fully tested; the write direction and the round-trip are Task 4.

**Files:**
- Create: `apexflow/frontend/src/editor/stage/types.ts`
- Create: `apexflow/frontend/src/editor/stage/spine.ts`
- Create: `apexflow/frontend/src/editor/stage/read.ts`
- Create: `apexflow/frontend/src/editor/stage/__tests__/fixtures.ts`
- Create: `apexflow/frontend/src/editor/stage/__tests__/spine.test.ts`
- Create: `apexflow/frontend/src/editor/stage/__tests__/read.test.ts`

**Interfaces:**
- Consumes: `MachineDef`, `StateDef`, `TransitionDef`, `GuardRef`, `EffectRef`, `WorkflowStepDef` from `../../types/designer.ts`.
- Produces, for Tasks 4 and 6–9:
  - `type Who = 'family' | 'staff' | 'both' | 'automatic'`
  - `interface MoveMember { transition_id: string; from: string; actor: TransitionDef['actor']; roleGuard: GuardRef | null; order: number }`
  - `interface MoveGroup { key: string; action: string; to: string; who: Who; guards: GuardRef[]; effects: EffectRef[]; members: MoveMember[] }`
  - `interface Stage { stage_id: string; name: string; kind: StateDef['kind']; depth: number; step_ids: string[] }`
  - `interface StageModel { stages: Stage[]; groups: MoveGroup[]; finishStageId: string | null }`
  - `function stageDepths(machine: MachineDef): Record<string, number>`
  - `function finishStageId(machine: MachineDef): string | null`
  - `function orderStages(machine: MachineDef): { ordered: StateDef[]; depths: Record<string, number> }`
  - `function readStageModel(machine: MachineDef, steps: WorkflowStepDef[]): StageModel`
  - `function isExitGroup(group: MoveGroup, model: StageModel): boolean`

- [ ] **Step 1: Write the model types**

Create `apexflow/frontend/src/editor/stage/types.ts`:

```ts
// The stage model — a lossless view of `workflow_definition.machine` in the
// vocabulary a registrar uses. Nothing here is stored; every field maps back
// onto a `MachineDef` (see ./write.ts).
//
// The load-bearing idea is `MoveMember`: a group remembers the exact
// transitions it was read from, including their declaration order and the
// `actor_role` guard that was folded into `who`. That is what makes
// round-tripping possible — the write path reproduces an untouched
// transition rather than re-deriving it.
import type { EffectRef, GuardRef, StateDef, TransitionDef } from '../../types/designer.ts';

/**
 * "Who can do it". `'both'` means a family/staff PAIR of transitions —
 * `TransitionDef.actor` is single-valued, so "a family or staff member may
 * withdraw" is two rows in the machine and one control in the editor.
 * `'automatic'` maps to `actor: 'system'`.
 */
export type Who = 'family' | 'staff' | 'both' | 'automatic';

/**
 * One authored transition, remembered as it was read.
 *
 * `roleGuard` is the `actor_role` guard that was absorbed into the group's
 * `who`, or `null` if the transition carried none. It must be re-emitted
 * verbatim: adding an `actor_role` guard to a transition that was authored
 * WITHOUT one turns a structurally-unguarded transition into a guarded one,
 * which changes how `validate.py`'s `_unguarded_branch_errors` reads its
 * whole `(from, action)` group.
 *
 * `order` is the transition's index in the original `machine.transitions`
 * array. `_unguarded_branch_errors` requires an unguarded transition to be
 * declared LAST within its `(from, action)` group, so order is semantic,
 * not cosmetic.
 */
export interface MoveMember {
  transition_id: string;
  from: string;
  actor: TransitionDef['actor'];
  roleGuard: GuardRef | null;
  order: number;
}

/**
 * A set of transitions identical apart from their source stage — the
 * grouping key is `(action, to, who, guards, effects)`, i.e. everything
 * except `from` (design ruling, Amendment B).
 *
 * Keying on `(action, to)` alone is not enough and this is measured, not
 * theoretical: signup's eight `drop` transitions all share an action and a
 * target, but only the one leaving `confirmed` may carry
 * `set_entity_field{ref: "enrollment", field: "status", value: "Withdrawn"}`
 * — the other three stages have no committed enrollment row and
 * `_effect_set_entity_field` raises 409. Under the looser key they collapse
 * into one card that cannot represent both shapes, and the round-trip fails.
 */
export interface MoveGroup {
  /** Stable within one read. Not persisted; used as a React key and for
   * lookups between the panel and the model. */
  key: string;
  action: string;
  to: string;
  who: Who;
  /** Guards with the absorbed `actor_role` removed. */
  guards: GuardRef[];
  effects: EffectRef[];
  /** One per (from, actor) pair. Never empty. */
  members: MoveMember[];
}

export interface Stage {
  stage_id: string;
  name: string;
  /** Still written to the machine, still never picked by the author. */
  kind: StateDef['kind'];
  /** Shortest-path distance from the initial stage. Drives spine order. */
  depth: number;
  /** Steps whose `available_in` contains this stage, in definition order. */
  step_ids: string[];
}

export interface StageModel {
  /** Spine order: by depth, then original declaration order. */
  stages: Stage[];
  groups: MoveGroup[];
  /** The terminal stage forward progress ends at, or `null` if the machine
   * has no terminal stage. Presentational only — see `isExitGroup`. */
  finishStageId: string | null;
}
```

- [ ] **Step 2: Write the failing spine test**

Create `apexflow/frontend/src/editor/stage/__tests__/fixtures.ts` — hand-transcribed from the two shipped templates so the tests do not depend on a running backend. Transcribe **exactly** from `apexflow/backend/app/templates/signup.py::_states`/`_transitions` and `enrollment.py::_states`/`_transitions`; a paraphrase makes the round-trip test meaningless. Both templates go in now: Task 3's spine test needs enrollment (it is the machine where naive BFS ordering strands `withdrawn` mid-spine) and Task 4's round-trip test needs both.

First the signup half:

```ts
// Hand-transcribed from apexflow/backend/app/templates/signup.py. Kept in
// sync by tests/test_signup_template.py's shape assertions on the Python
// side and by round-trip.test.ts's own counts on this side.
import type { MachineDef, WorkflowStepDef } from '../../../types/designer.ts';

const familyRole = { primitive: 'actor_role', params: { roles: ['family'] } };
const staffRole = { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } };

const formComplete = {
  primitive: 'items_in_status',
  params: { step_ids: ['signup_form'], status: ['submitted', 'verified'], quantifier: 'all' },
};
const capacity = {
  primitive: 'capacity_available',
  params: {
    count_states: ['offered', 'confirmed'],
    capacity_field: 'capacity',
    scope_context_key: 'program_id',
  },
};
const confirmEffects = [
  {
    primitive: 'commit_sections',
    params: { section_ids: ['family_section', 'student_section', 'signup_section'] },
  },
  { primitive: 'set_entity_field', params: { ref: 'enrollment', field: 'status', value: 'Active' } },
  { primitive: 'send_email', params: { template: 'signup_confirmed' } },
];

function dropPair(from: string) {
  const effects =
    from === 'confirmed'
      ? [
          {
            primitive: 'set_entity_field',
            params: { ref: 'enrollment', field: 'status', value: 'Withdrawn' },
          },
        ]
      : [];
  return [
    {
      transition_id: `t_drop_${from}_family`,
      from,
      to: 'dropped',
      action: 'drop',
      actor: 'family' as const,
      guards: [familyRole],
      effects: [...effects],
    },
    {
      transition_id: `t_drop_${from}_staff`,
      from,
      to: 'dropped',
      action: 'drop',
      actor: 'staff' as const,
      guards: [staffRole],
      effects: [...effects],
    },
  ];
}

export const SIGNUP_MACHINE: MachineDef = {
  states: [
    { state_id: 'draft', name: 'Draft', kind: 'initial' },
    { state_id: 'waitlisted', name: 'Waitlisted', kind: 'active' },
    { state_id: 'offered', name: 'Spot Offered', kind: 'active' },
    { state_id: 'confirmed', name: 'Confirmed', kind: 'active' },
    { state_id: 'completed', name: 'Completed', kind: 'terminal' },
    { state_id: 'dropped', name: 'Dropped', kind: 'terminal' },
  ],
  transitions: [
    {
      transition_id: 't_submit_confirmed',
      from: 'draft',
      to: 'confirmed',
      action: 'submit',
      actor: 'family',
      guards: [capacity, formComplete],
      effects: confirmEffects,
    },
    {
      transition_id: 't_submit_waitlisted',
      from: 'draft',
      to: 'waitlisted',
      action: 'submit',
      actor: 'family',
      guards: [formComplete],
      effects: [{ primitive: 'send_email', params: { template: 'signup_waitlisted' } }],
    },
    ...dropPair('draft'),
    {
      transition_id: 't_offer_spot',
      from: 'waitlisted',
      to: 'offered',
      action: 'offer_spot',
      actor: 'staff',
      guards: [],
      effects: [
        { primitive: 'issue_link', params: {} },
        { primitive: 'send_email', params: { template: 'signup_offer' } },
      ],
    },
    ...dropPair('waitlisted'),
    {
      transition_id: 't_accept_offer',
      from: 'offered',
      to: 'confirmed',
      action: 'accept_offer',
      actor: 'family',
      guards: [formComplete],
      effects: confirmEffects,
    },
    {
      transition_id: 't_decline_offer',
      from: 'offered',
      to: 'waitlisted',
      action: 'decline_offer',
      actor: 'family',
      guards: [],
      effects: [],
    },
    {
      transition_id: 't_rescind_offer',
      from: 'offered',
      to: 'waitlisted',
      action: 'rescind_offer',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'signup_offer_expired' } }],
    },
    ...dropPair('offered'),
    {
      transition_id: 't_complete_program',
      from: 'confirmed',
      to: 'completed',
      action: 'complete_program',
      actor: 'staff',
      guards: [],
      effects: [
        {
          primitive: 'set_entity_field',
          params: { ref: 'enrollment', field: 'status', value: 'Completed' },
        },
      ],
    },
    ...dropPair('confirmed'),
  ],
};

export const SIGNUP_STEPS: WorkflowStepDef[] = [
  {
    step_id: 'welcome',
    type: 'message',
    title: 'Welcome',
    required: false,
    blocking: false,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { body: 'Fill in the form below to sign up for a program.' },
  },
  {
    step_id: 'signup_form',
    type: 'form',
    title: 'Signup Details',
    required: true,
    blocking: true,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { sections: [] },
  },
  {
    step_id: 'waitlist_notice',
    type: 'message',
    title: "You're on the Waitlist",
    required: false,
    blocking: false,
    available_in: ['waitlisted'],
    show_if: null,
    review: null,
    config: { body: "This program is full. We'll contact you as soon as a spot opens." },
  },
  {
    step_id: 'offer_notice',
    type: 'message',
    title: 'A Spot Is Open',
    required: false,
    blocking: false,
    available_in: ['offered'],
    show_if: null,
    review: null,
    config: { body: 'A spot has opened up. Accept below to confirm your place.' },
  },
  {
    step_id: 'confirmation_notice',
    type: 'message',
    title: "You're Signed Up",
    required: false,
    blocking: false,
    available_in: ['confirmed'],
    show_if: null,
    review: null,
    config: { body: "Your signup is confirmed. We'll see you on the start date." },
  },
];
```

Then the enrollment half, appended to the same file (it reuses `familyRole`/`staffRole` from above):

```ts
// Hand-transcribed from apexflow/backend/app/templates/enrollment.py.
const appFormComplete = {
  primitive: 'items_in_status',
  params: { step_ids: ['application_form'], status: ['submitted', 'verified'], quantifier: 'all' },
};
const approveEffects = [
  {
    primitive: 'commit_sections',
    params: {
      section_ids: ['family_section', 'student_section', 'contacts_section', 'application_section'],
    },
  },
  { primitive: 'set_entity_field', params: { ref: 'student', field: 'status', value: 'Enrolled' } },
  { primitive: 'start_due_clocks', params: { step_ids: ['documents'] } },
  { primitive: 'send_email', params: { template: 'approved' } },
];

function withdrawPair(from: string) {
  return [
    {
      transition_id: `t_withdraw_${from}_family`,
      from,
      to: 'withdrawn',
      action: 'withdraw',
      actor: 'family' as const,
      guards: [familyRole],
      effects: [],
    },
    {
      transition_id: `t_withdraw_${from}_staff`,
      from,
      to: 'withdrawn',
      action: 'withdraw',
      actor: 'staff' as const,
      guards: [staffRole],
      effects: [],
    },
  ];
}

export const ENROLLMENT_MACHINE: MachineDef = {
  states: [
    { state_id: 'draft', name: 'Draft', kind: 'initial' },
    { state_id: 'submitted', name: 'Submitted', kind: 'active' },
    { state_id: 'in_review', name: 'In Review', kind: 'active' },
    { state_id: 'pending_items', name: 'Pending Items', kind: 'active' },
    { state_id: 'approved', name: 'Approved', kind: 'active' },
    { state_id: 'enrolled', name: 'Enrolled', kind: 'terminal' },
    { state_id: 'waitlisted', name: 'Waitlisted', kind: 'active' },
    { state_id: 'declined', name: 'Declined', kind: 'terminal' },
    { state_id: 'withdrawn', name: 'Withdrawn', kind: 'terminal' },
  ],
  transitions: [
    {
      transition_id: 't_submit_submitted',
      from: 'draft',
      to: 'submitted',
      action: 'submit',
      actor: 'family',
      guards: [
        {
          primitive: 'capacity_available',
          params: {
            count_states: ['approved', 'enrolled'],
            capacity_field: 'capacity',
            scope_context_key: 'school_year',
          },
        },
        appFormComplete,
      ],
      effects: [],
    },
    {
      transition_id: 't_submit_waitlisted',
      from: 'draft',
      to: 'waitlisted',
      action: 'submit',
      actor: 'family',
      guards: [appFormComplete],
      effects: [{ primitive: 'send_email', params: { template: 'waitlisted' } }],
    },
    ...withdrawPair('draft'),
    {
      transition_id: 't_route_to_review',
      from: 'submitted',
      to: 'in_review',
      action: 'route_to_review',
      actor: 'system',
      guards: [],
      effects: [],
    },
    ...withdrawPair('submitted'),
    {
      transition_id: 't_promote_waitlist',
      from: 'waitlisted',
      to: 'in_review',
      action: 'promote_waitlist',
      actor: 'staff',
      guards: [],
      effects: [],
    },
    ...withdrawPair('waitlisted'),
    {
      transition_id: 't_approve',
      from: 'in_review',
      to: 'approved',
      action: 'approve',
      actor: 'staff',
      guards: [],
      effects: approveEffects,
    },
    {
      transition_id: 't_decline_review',
      from: 'in_review',
      to: 'declined',
      action: 'decline',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'declined' } }],
    },
    {
      transition_id: 't_request_changes',
      from: 'in_review',
      to: 'pending_items',
      action: 'request_changes',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'changes_requested' } }],
    },
    {
      transition_id: 't_flag_pending_items',
      from: 'in_review',
      to: 'pending_items',
      action: 'flag_pending_items',
      actor: 'system',
      guards: [
        {
          primitive: 'items_in_status',
          params: { step_ids: ['application_form'], status: 'rejected', quantifier: 'any' },
        },
      ],
      effects: [],
    },
    ...withdrawPair('in_review'),
    {
      transition_id: 't_decline_pending',
      from: 'pending_items',
      to: 'declined',
      action: 'decline',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'declined' } }],
    },
    {
      transition_id: 't_resubmit',
      from: 'pending_items',
      to: 'in_review',
      action: 'resubmit',
      actor: 'family',
      guards: [appFormComplete],
      effects: [],
    },
    ...withdrawPair('pending_items'),
    {
      transition_id: 't_finalize_enrollment',
      from: 'approved',
      to: 'enrolled',
      action: 'finalize_enrollment',
      actor: 'system',
      guards: [
        {
          primitive: 'items_in_status',
          params: { step_ids: ['documents'], status: ['verified', 'waived'], quantifier: 'all' },
        },
      ],
      effects: [],
    },
    ...withdrawPair('approved'),
  ],
};

export const ENROLLMENT_STEPS: WorkflowStepDef[] = [
  {
    step_id: 'welcome',
    type: 'message',
    title: 'Welcome',
    required: false,
    blocking: false,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { body: 'Welcome!' },
  },
  {
    step_id: 'application_form',
    type: 'form',
    title: 'Application Details',
    required: true,
    blocking: true,
    available_in: ['draft', 'pending_items'],
    show_if: null,
    review: 'staff',
    config: { sections: [] },
  },
  {
    step_id: 'documents',
    type: 'documents',
    title: 'Required Documents',
    required: true,
    blocking: true,
    available_in: ['approved'],
    show_if: null,
    review: null,
    config: { docs: [] },
  },
  {
    step_id: 'review_notice',
    type: 'message',
    title: 'Application Under Review',
    required: false,
    blocking: false,
    available_in: ['in_review', 'pending_items', 'approved'],
    show_if: null,
    review: null,
    config: { body: 'Thanks for applying!' },
  },
];
```

Create `apexflow/frontend/src/editor/stage/__tests__/spine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { finishStageId, orderStages, stageDepths } from '../spine.ts';
import { ENROLLMENT_MACHINE, SIGNUP_MACHINE } from './fixtures.ts';

describe('stageDepths', () => {
  it('measures BFS distance from the initial stage', () => {
    expect(stageDepths(SIGNUP_MACHINE)).toEqual({
      draft: 0,
      waitlisted: 1,
      confirmed: 1,
      dropped: 1,
      offered: 2,
      completed: 2,
    });
  });

  it('gives an unreachable stage a depth beyond every reachable one', () => {
    const machine = {
      states: [
        ...SIGNUP_MACHINE.states,
        { state_id: 'orphan', name: 'Orphan', kind: 'active' as const },
      ],
      transitions: SIGNUP_MACHINE.transitions,
    };
    expect(stageDepths(machine).orphan).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('orderStages', () => {
  it('orders signup along the spine, exits last', () => {
    const { ordered } = orderStages(SIGNUP_MACHINE);
    expect(ordered.map((s) => s.state_id)).toEqual([
      'draft',
      'waitlisted',
      'confirmed',
      'offered',
      'completed',
      'dropped',
    ]);
  });

  it('does not strand an exit target in the middle of the spine', () => {
    // `withdrawn` is one hop from `draft`, so pure BFS order puts it third
    // of nine — between `waitlisted` and `in_review`. It is an exit target,
    // not a step along the way, so it sorts after the finish.
    const { ordered } = orderStages(ENROLLMENT_MACHINE);
    expect(ordered.map((s) => s.state_id)).toEqual([
      'draft',
      'submitted',
      'waitlisted',
      'in_review',
      'pending_items',
      'approved',
      'enrolled',
      'withdrawn',
      'declined',
    ]);
  });

  it('sorts an unreachable stage after the reachable spine but before the exits', () => {
    const machine = {
      states: [
        ...SIGNUP_MACHINE.states,
        { state_id: 'orphan', name: 'Orphan', kind: 'active' as const },
      ],
      transitions: SIGNUP_MACHINE.transitions,
    };
    const ids = orderStages(machine).ordered.map((s) => s.state_id);
    expect(ids.indexOf('orphan')).toBeGreaterThan(ids.indexOf('completed'));
    expect(ids.indexOf('orphan')).toBeLessThan(ids.indexOf('dropped'));
  });

  it('returns declaration order when there is no initial stage', () => {
    const machine = {
      states: SIGNUP_MACHINE.states.map((s) =>
        s.kind === 'initial' ? { ...s, kind: 'active' as const } : s,
      ),
      transitions: SIGNUP_MACHINE.transitions,
    };
    const { ordered } = orderStages(machine);
    expect(ordered.map((s) => s.state_id)).toEqual(SIGNUP_MACHINE.states.map((s) => s.state_id));
  });
});

describe('finishStageId', () => {
  it('is the deepest terminal stage, not the first one declared', () => {
    expect(finishStageId(SIGNUP_MACHINE)).toBe('completed');
  });

  it('breaks a depth tie by declaration order', () => {
    const machine = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' as const },
        { state_id: 'y', name: 'Y', kind: 'terminal' as const },
        { state_id: 'z', name: 'Z', kind: 'terminal' as const },
      ],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'y', action: 'go', actor: 'staff' as const, guards: [], effects: [] },
        { transition_id: 't2', from: 'a', to: 'z', action: 'stop', actor: 'staff' as const, guards: [], effects: [] },
      ],
    };
    expect(finishStageId(machine)).toBe('y');
  });

  it('is null when nothing is terminal', () => {
    const machine = {
      states: [{ state_id: 'a', name: 'A', kind: 'initial' as const }],
      transitions: [],
    };
    expect(finishStageId(machine)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: FAIL — `Failed to resolve import "../spine.ts"`.

- [ ] **Step 4: Implement the spine**

Create `apexflow/frontend/src/editor/stage/spine.ts`:

```ts
// Stage ordering. The design says stage order is read "from the transition
// graph"; this is that, made specific.
//
// Order is BFS distance from the initial stage, ties broken by declaration
// order — with one correction. Pure BFS puts an exit target wherever its
// shortest inbound edge lands it, which for enrollment means `withdrawn`
// (one hop from `draft`) renders THIRD of nine stages, between `waitlisted`
// and `in_review`. An exit target is where a workflow stops, not a step
// along the way, so every terminal stage except the finish sorts after the
// finish.
//
// NOTE: ordering is PRESENTATIONAL. `write.ts` never consults it. A machine
// whose graph confuses this function still round-trips exactly; it just
// renders its stages in a less helpful order.
import type { MachineDef, StateDef } from '../../types/designer.ts';

/** Sorts after every reachable stage; unreachable stages keep declaration
 * order among themselves. */
const UNREACHABLE = Number.MAX_SAFE_INTEGER;

export function stageDepths(machine: MachineDef): Record<string, number> {
  const declared = new Set(machine.states.map((s) => s.state_id));
  const depths: Record<string, number> = {};
  for (const state of machine.states) depths[state.state_id] = UNREACHABLE;

  const initial = machine.states.find((s) => s.kind === 'initial');
  // No initial stage is a validation error the rail already reports. Leave
  // every depth UNREACHABLE rather than inventing a root, so the editor
  // still renders something the author can fix.
  if (!initial) return depths;

  const adjacency = new Map<string, string[]>();
  for (const t of machine.transitions) {
    const next = adjacency.get(t.from) ?? [];
    next.push(t.to);
    adjacency.set(t.from, next);
  }

  depths[initial.state_id] = 0;
  const queue = [initial.state_id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (!declared.has(next)) continue; // dangling `to` — the validator's problem
      if (depths[next] !== UNREACHABLE) continue;
      depths[next] = depths[current] + 1;
      queue.push(next);
    }
  }
  return depths;
}

/**
 * The terminal stage forward progress ends at: the DEEPEST terminal stage,
 * ties broken by declaration order.
 *
 * Measured against both shipped templates: enrollment's terminals are
 * `enrolled` (depth 4), `declined` (3), and `withdrawn` (1) — the finish is
 * `enrolled`. Signup's are `completed` (2) and `dropped` (1) — the finish is
 * `completed`. Taking the first-declared terminal instead would happen to be
 * right for both and would break the moment an author reorders the states.
 */
export function finishStageId(machine: MachineDef): string | null {
  const depths = stageDepths(machine);
  const declaredIndex = new Map(machine.states.map((s, i) => [s.state_id, i]));
  const terminals = machine.states.filter((s) => s.kind === 'terminal');
  if (terminals.length === 0) return null;
  let best = terminals[0];
  for (const candidate of terminals.slice(1)) {
    const deeper = depths[candidate.state_id] > depths[best.state_id];
    const tied = depths[candidate.state_id] === depths[best.state_id];
    const earlier =
      (declaredIndex.get(candidate.state_id) ?? 0) < (declaredIndex.get(best.state_id) ?? 0);
    if (deeper || (tied && earlier)) best = candidate;
  }
  return best.state_id;
}

export function orderStages(machine: MachineDef): {
  ordered: StateDef[];
  depths: Record<string, number>;
} {
  const depths = stageDepths(machine);
  const finish = finishStageId(machine);
  const declaredIndex = new Map(machine.states.map((s, i) => [s.state_id, i]));

  /** 0 = on the spine, 1 = an exit target. */
  const rank = (s: StateDef) => (s.kind === 'terminal' && s.state_id !== finish ? 1 : 0);

  const ordered = [...machine.states].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byDepth = depths[a.state_id] - depths[b.state_id];
    if (byDepth !== 0) return byDepth;
    return (declaredIndex.get(a.state_id) ?? 0) - (declaredIndex.get(b.state_id) ?? 0);
  });
  return { ordered, depths };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS, 9 tests.

> The two order expectations above are not hand-derived — they were computed by running this exact algorithm over `enrollment.build_machine()` and `signup.build_machine()`. A hand-derived spine order was wrong for both templates on the first attempt, which is how the exit-target demotion was found.

- [ ] **Step 6: Mutation — prove the spine tests bite**

Run `npx vitest run --no-cache src/editor/stage` after each, then revert.

1. In `spine.ts`, remove the exit demotion: `const rank = () => 0;`
   Expected: FAIL — `does not strand an exit target in the middle of the spine` (`withdrawn` moves to index 2) **and** `orders signup along the spine, exits last`.
2. In `stageDepths`, change `depths[next] = depths[current] + 1` to `depths[next] = 1`.
   Expected: FAIL — `measures BFS distance from the initial stage` (`offered` and `completed` become 1).
3. In `finishStageId`, return the last-declared terminal instead of the deepest: replace the loop and `return best.state_id;` with `return terminals[terminals.length - 1].state_id;`.
   Expected: FAIL — `does not strand an exit target in the middle of the spine` (the finish becomes `withdrawn`, so `enrolled` and `declined` are demoted instead), `orders signup along the spine, exits last`, `is the deepest terminal stage, not the first one declared`, and `breaks a depth tie by declaration order`.

   > Do **not** use `const deeper = false;` as the mutation here. It leaves `terminals[0]` as the answer, and both shipped templates happen to declare their finish stage first — so it passes, and would have been recorded as a bite that never happened.

Revert all three. Run again. Expected: PASS, 9 tests.

- [ ] **Step 7: Write the failing read test**

Create `apexflow/frontend/src/editor/stage/__tests__/read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isExitGroup, readStageModel } from '../read.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from './fixtures.ts';

const model = () => readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);

describe('readStageModel — stages', () => {
  it('reads every state as a stage, in spine order', () => {
    expect(model().stages.map((s) => s.stage_id)).toEqual([
      'draft',
      'waitlisted',
      'confirmed',
      'offered',
      'completed',
      'dropped',
    ]);
  });

  it('puts each step in every stage its available_in names', () => {
    const stages = Object.fromEntries(model().stages.map((s) => [s.stage_id, s.step_ids]));
    expect(stages.draft).toEqual(['welcome', 'signup_form']);
    expect(stages.waitlisted).toEqual(['waitlist_notice']);
    expect(stages.completed).toEqual([]);
  });
});

describe('readStageModel — grouping', () => {
  it('collapses the eight drop transitions into TWO groups, not one', () => {
    const drops = model().groups.filter((g) => g.action === 'drop');
    expect(drops).toHaveLength(2);
    const bySize = [...drops].sort((a, b) => b.members.length - a.members.length);
    expect(bySize[0].members.map((m) => m.from).sort()).toEqual([
      'draft',
      'draft',
      'offered',
      'offered',
      'waitlisted',
      'waitlisted',
    ]);
    expect(bySize[0].effects).toEqual([]);
    expect(bySize[1].members.map((m) => m.from)).toEqual(['confirmed', 'confirmed']);
    expect(bySize[1].effects).toEqual([
      { primitive: 'set_entity_field', params: { ref: 'enrollment', field: 'status', value: 'Withdrawn' } },
    ]);
  });

  it('folds a family/staff pair into one group with who="both"', () => {
    const drops = model().groups.filter((g) => g.action === 'drop');
    expect(drops.every((g) => g.who === 'both')).toBe(true);
  });

  it('absorbs the actor_role guard into who and hides it from guards', () => {
    const drop = model().groups.find((g) => g.action === 'drop') as NonNullable<
      ReturnType<typeof model>['groups'][number]
    >;
    expect(drop.guards).toEqual([]);
    expect(drop.members.map((m) => m.roleGuard?.params)).toEqual(
      expect.arrayContaining([{ roles: ['family'] }, { roles: ['staff', 'admin'] }]),
    );
  });

  it('leaves roleGuard null on a transition that never carried one', () => {
    const offer = model().groups.find((g) => g.action === 'offer_spot');
    expect(offer?.who).toBe('staff');
    expect(offer?.members).toHaveLength(1);
    expect(offer?.members[0].roleGuard).toBeNull();
  });

  it('keeps two actions sharing one edge apart', () => {
    const back = model().groups.filter((g) => g.to === 'waitlisted' && g.members[0].from === 'offered');
    expect(back.map((g) => g.action).sort()).toEqual(['decline_offer', 'rescind_offer']);
  });

  it('does not merge the two submit branches — different targets', () => {
    const submits = model().groups.filter((g) => g.action === 'submit');
    expect(submits.map((g) => g.to).sort()).toEqual(['confirmed', 'waitlisted']);
  });

  it('records each member’s original declaration index', () => {
    const orders = model()
      .groups.flatMap((g) => g.members.map((m) => m.order))
      .sort((a, b) => a - b);
    expect(orders).toEqual(SIGNUP_MACHINE.transitions.map((_, i) => i));
  });

  it('accounts for every transition exactly once', () => {
    const ids = model().groups.flatMap((g) => g.members.map((m) => m.transition_id));
    expect(ids.sort()).toEqual(SIGNUP_MACHINE.transitions.map((t) => t.transition_id).sort());
  });
});

describe('isExitGroup', () => {
  it('treats a group landing on a non-finish terminal as an exit', () => {
    const m = model();
    const drops = m.groups.filter((g) => g.action === 'drop');
    expect(drops.every((g) => isExitGroup(g, m))).toBe(true);
  });

  it('does not treat the move onto the finish stage as an exit', () => {
    const m = model();
    const complete = m.groups.find((g) => g.action === 'complete_program');
    expect(complete && isExitGroup(complete, m)).toBe(false);
  });

  it('does not treat a backward move onto an active stage as an exit', () => {
    const m = model();
    const decline = m.groups.find((g) => g.action === 'decline_offer');
    expect(decline && isExitGroup(decline, m)).toBe(false);
  });
});
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage/__tests__/read.test.ts`
Expected: FAIL — `Failed to resolve import "../read.ts"`.

- [ ] **Step 9: Implement the read path**

Create `apexflow/frontend/src/editor/stage/read.ts`:

```ts
// machine + steps -> StageModel. Pure; no React, no fetch.
//
// Grouping key: (action, to, who, guards-without-actor_role, effects) —
// everything except `from` (design ruling, Amendment B). Two transitions
// join a group only when they are indistinguishable apart from where they
// leave from, which is exactly the condition under which one Exits-panel
// card can faithfully re-emit both.
import type { GuardRef, MachineDef, TransitionDef, WorkflowStepDef } from '../../types/designer.ts';
import type { MoveGroup, MoveMember, Stage, StageModel, Who } from './types.ts';
import { finishStageId, orderStages } from './spine.ts';

/** Stable, order-insensitive-per-key JSON for use in a grouping key. Params
 * are authored objects whose key order is whatever the backend serialized;
 * two params dicts with the same content must produce the same key. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function splitActorRole(guards: GuardRef[]): { roleGuard: GuardRef | null; rest: GuardRef[] } {
  const idx = guards.findIndex((g) => g.primitive === 'actor_role');
  if (idx === -1) return { roleGuard: null, rest: guards };
  return {
    roleGuard: guards[idx],
    // Only the FIRST actor_role is absorbed. A transition carrying two is
    // pathological; the second stays in `rest` and renders as an ordinary
    // guard rather than being dropped.
    rest: [...guards.slice(0, idx), ...guards.slice(idx + 1)],
  };
}

function whoForActor(actor: TransitionDef['actor']): Who {
  return actor === 'system' ? 'automatic' : actor;
}

/** Two members merge into `who: 'both'` only when they are a family/staff
 * pair from the SAME stage — that is the shape `_withdraw_pair`/`_drop_pair`
 * emit, and the only shape one "Who can do it" control can re-emit. */
function foldWho(members: MoveMember[]): Who {
  const actors = new Set(members.map((m) => m.actor));
  if (actors.size === 1) return whoForActor(members[0].actor);
  if (actors.size === 2 && actors.has('family') && actors.has('staff')) return 'both';
  // Anything else (e.g. system mixed with family) cannot be one control.
  // Callers never build this — `groupKey` includes the actor set, so a mixed
  // set can only arise from a hand-edited machine. Report the first actor
  // and let each member keep its own; `write.ts` writes `member.actor`, not
  // `group.who`, so nothing is lost.
  return whoForActor(members[0].actor);
}

/**
 * The grouping key. Note what is IN it: the actor set is folded to
 * "family+staff pair or not", so a `_drop_pair` joins, while a lone staff
 * transition does not join a family one from a different stage.
 */
function groupKey(t: TransitionDef, rest: GuardRef[]): string {
  const actorClass = t.actor === 'system' ? 'system' : 'human';
  return [
    t.action,
    t.to,
    actorClass,
    stableJson(rest),
    stableJson(t.effects),
  ].join(' ');
}

export function readStageModel(machine: MachineDef, steps: WorkflowStepDef[]): StageModel {
  const { ordered, depths } = orderStages(machine);

  const stages: Stage[] = ordered.map((state) => ({
    stage_id: state.state_id,
    name: state.name,
    kind: state.kind,
    depth: depths[state.state_id],
    step_ids: steps
      .filter((step) => step.available_in.includes(state.state_id))
      .map((step) => step.step_id),
  }));

  const byKey = new Map<string, MoveGroup>();
  machine.transitions.forEach((t, order) => {
    const { roleGuard, rest } = splitActorRole(t.guards);
    const key = groupKey(t, rest);
    const member: MoveMember = {
      transition_id: t.transition_id,
      from: t.from,
      actor: t.actor,
      roleGuard,
      order,
    };
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push(member);
      existing.who = foldWho(existing.members);
      return;
    }
    byKey.set(key, {
      key,
      action: t.action,
      to: t.to,
      who: whoForActor(t.actor),
      guards: rest,
      effects: t.effects,
      members: [member],
    });
  });

  // Groups in first-member declaration order, so the panels read in the same
  // order the machine declares.
  const groups = [...byKey.values()].sort(
    (a, b) => Math.min(...a.members.map((m) => m.order)) - Math.min(...b.members.map((m) => m.order)),
  );

  return { stages, groups, finishStageId: finishStageId(machine) };
}

/**
 * An exit is a group landing on a TERMINAL stage that is not the finish.
 *
 * Purely presentational: it decides whether a group renders in the Exits
 * panel or as a move on its stage. Both surfaces edit the same `MoveGroup`
 * and both write back through `writeMachine`, so getting this wrong makes
 * the editor less readable, never incorrect.
 */
export function isExitGroup(group: MoveGroup, model: StageModel): boolean {
  const target = model.stages.find((s) => s.stage_id === group.to);
  if (!target || target.kind !== 'terminal') return false;
  return target.stage_id !== model.finishStageId;
}
```

- [ ] **Step 10: Run the tests**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS, 22 tests (9 spine + 13 read).

- [ ] **Step 11: Mutation — prove the grouping key bites**

This is the mutation that matters most in the whole plan. In `read.ts`, change `groupKey`'s return to drop the effects:

```ts
  return [t.action, t.to, actorClass, stableJson(rest)].join(' ');
```

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: FAIL — `collapses the eight drop transitions into TWO groups, not one` (received 1).

Second mutation, on `splitActorRole`: make it always return `{ roleGuard: null, rest: guards }`.
Expected: FAIL — `absorbs the actor_role guard into who and hides it from guards` **and** `folds a family/staff pair into one group with who="both"`.

Third mutation, on `isExitGroup`: change the last line to `return true;`.
Expected: FAIL — `does not treat the move onto the finish stage as an exit`.

Revert all three. Run again. Expected: PASS, 22 tests.

- [ ] **Step 12: Typecheck, lint, commit**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`
Expected: build succeeds, 0 lint errors, 25 tests pass (3 i18n + 22 stage).

```bash
git add apexflow/frontend/src/editor/stage
git commit -m "feat(apexflow): read a machine into a stage model

Pure translation layer, no UI. Groups transitions on (action, target, who,
guards, effects) — everything except \`from\` — which is the ruling's
Amendment B. The looser (action, target) key the design originally
specified collapses signup's eight drop transitions into one card that
cannot represent their two distinct effect shapes; the test that catches
that is the first thing in read.test.ts."
```

---

## Task 4: Write a StageModel back to a machine, and pin the round trip

**Files:**
- Create: `apexflow/frontend/src/editor/stage/write.ts`
- Create: `apexflow/frontend/src/editor/stage/__tests__/roundTrip.test.ts`
- Create: `apexflow/frontend/src/editor/stage/__tests__/write.test.ts`

**Interfaces:**
- Consumes: `StageModel`, `MoveGroup`, `MoveMember` from `./types.ts`; `readStageModel` from `./read.ts`.
- Produces: `function writeMachine(model: StageModel): MachineDef`, `function roleGuardFor(actor: TransitionDef['actor']): GuardRef`, `function actorsFor(who: Who): TransitionDef['actor'][]`, and `const NEW_ORDER: number` — used by Tasks 8 and 9 when the author changes "Who can do it" or an exit's scope.

- [ ] **Step 1: Confirm the fixtures are in place**

`ENROLLMENT_MACHINE` and `ENROLLMENT_STEPS` were added to `__tests__/fixtures.ts` in Task 3 Step 2, because Task 3's spine test needs enrollment. Verify before continuing:

Run: `cd apexflow/frontend && grep -c "ENROLLMENT_MACHINE\|SIGNUP_MACHINE" src/editor/stage/__tests__/fixtures.ts`
Expected: at least 2 (one `export const` each). If enrollment is missing, add it from Task 3 Step 2 now — the round-trip test below is meaningless without the real template.

<details>
<summary>Reference: the enrollment fixture, as added in Task 3</summary>

```ts
// Hand-transcribed from apexflow/backend/app/templates/enrollment.py.
const appFormComplete = {
  primitive: 'items_in_status',
  params: { step_ids: ['application_form'], status: ['submitted', 'verified'], quantifier: 'all' },
};
const approveEffects = [
  {
    primitive: 'commit_sections',
    params: {
      section_ids: ['family_section', 'student_section', 'contacts_section', 'application_section'],
    },
  },
  { primitive: 'set_entity_field', params: { ref: 'student', field: 'status', value: 'Enrolled' } },
  { primitive: 'start_due_clocks', params: { step_ids: ['documents'] } },
  { primitive: 'send_email', params: { template: 'approved' } },
];

function withdrawPair(from: string) {
  return [
    {
      transition_id: `t_withdraw_${from}_family`,
      from,
      to: 'withdrawn',
      action: 'withdraw',
      actor: 'family' as const,
      guards: [familyRole],
      effects: [],
    },
    {
      transition_id: `t_withdraw_${from}_staff`,
      from,
      to: 'withdrawn',
      action: 'withdraw',
      actor: 'staff' as const,
      guards: [staffRole],
      effects: [],
    },
  ];
}

export const ENROLLMENT_MACHINE: MachineDef = {
  states: [
    { state_id: 'draft', name: 'Draft', kind: 'initial' },
    { state_id: 'submitted', name: 'Submitted', kind: 'active' },
    { state_id: 'in_review', name: 'In Review', kind: 'active' },
    { state_id: 'pending_items', name: 'Pending Items', kind: 'active' },
    { state_id: 'approved', name: 'Approved', kind: 'active' },
    { state_id: 'enrolled', name: 'Enrolled', kind: 'terminal' },
    { state_id: 'waitlisted', name: 'Waitlisted', kind: 'active' },
    { state_id: 'declined', name: 'Declined', kind: 'terminal' },
    { state_id: 'withdrawn', name: 'Withdrawn', kind: 'terminal' },
  ],
  transitions: [
    {
      transition_id: 't_submit_submitted',
      from: 'draft',
      to: 'submitted',
      action: 'submit',
      actor: 'family',
      guards: [
        {
          primitive: 'capacity_available',
          params: {
            count_states: ['approved', 'enrolled'],
            capacity_field: 'capacity',
            scope_context_key: 'school_year',
          },
        },
        appFormComplete,
      ],
      effects: [],
    },
    {
      transition_id: 't_submit_waitlisted',
      from: 'draft',
      to: 'waitlisted',
      action: 'submit',
      actor: 'family',
      guards: [appFormComplete],
      effects: [{ primitive: 'send_email', params: { template: 'waitlisted' } }],
    },
    ...withdrawPair('draft'),
    {
      transition_id: 't_route_to_review',
      from: 'submitted',
      to: 'in_review',
      action: 'route_to_review',
      actor: 'system',
      guards: [],
      effects: [],
    },
    ...withdrawPair('submitted'),
    {
      transition_id: 't_promote_waitlist',
      from: 'waitlisted',
      to: 'in_review',
      action: 'promote_waitlist',
      actor: 'staff',
      guards: [],
      effects: [],
    },
    ...withdrawPair('waitlisted'),
    {
      transition_id: 't_approve',
      from: 'in_review',
      to: 'approved',
      action: 'approve',
      actor: 'staff',
      guards: [],
      effects: approveEffects,
    },
    {
      transition_id: 't_decline_review',
      from: 'in_review',
      to: 'declined',
      action: 'decline',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'declined' } }],
    },
    {
      transition_id: 't_request_changes',
      from: 'in_review',
      to: 'pending_items',
      action: 'request_changes',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'changes_requested' } }],
    },
    {
      transition_id: 't_flag_pending_items',
      from: 'in_review',
      to: 'pending_items',
      action: 'flag_pending_items',
      actor: 'system',
      guards: [
        {
          primitive: 'items_in_status',
          params: { step_ids: ['application_form'], status: 'rejected', quantifier: 'any' },
        },
      ],
      effects: [],
    },
    ...withdrawPair('in_review'),
    {
      transition_id: 't_decline_pending',
      from: 'pending_items',
      to: 'declined',
      action: 'decline',
      actor: 'staff',
      guards: [],
      effects: [{ primitive: 'send_email', params: { template: 'declined' } }],
    },
    {
      transition_id: 't_resubmit',
      from: 'pending_items',
      to: 'in_review',
      action: 'resubmit',
      actor: 'family',
      guards: [appFormComplete],
      effects: [],
    },
    ...withdrawPair('pending_items'),
    {
      transition_id: 't_finalize_enrollment',
      from: 'approved',
      to: 'enrolled',
      action: 'finalize_enrollment',
      actor: 'system',
      guards: [
        {
          primitive: 'items_in_status',
          params: { step_ids: ['documents'], status: ['verified', 'waived'], quantifier: 'all' },
        },
      ],
      effects: [],
    },
    ...withdrawPair('approved'),
  ],
};

export const ENROLLMENT_STEPS: WorkflowStepDef[] = [
  {
    step_id: 'welcome',
    type: 'message',
    title: 'Welcome',
    required: false,
    blocking: false,
    available_in: ['draft'],
    show_if: null,
    review: null,
    config: { body: 'Welcome!' },
  },
  {
    step_id: 'application_form',
    type: 'form',
    title: 'Application Details',
    required: true,
    blocking: true,
    available_in: ['draft', 'pending_items'],
    show_if: null,
    review: 'staff',
    config: { sections: [] },
  },
  {
    step_id: 'documents',
    type: 'documents',
    title: 'Required Documents',
    required: true,
    blocking: true,
    available_in: ['approved'],
    show_if: null,
    review: null,
    config: { docs: [] },
  },
  {
    step_id: 'review_notice',
    type: 'message',
    title: 'Application Under Review',
    required: false,
    blocking: false,
    available_in: ['in_review', 'pending_items', 'approved'],
    show_if: null,
    review: null,
    config: { body: 'Thanks for applying!' },
  },
];
```

</details>

- [ ] **Step 2: Write the failing round-trip test**

Create `apexflow/frontend/src/editor/stage/__tests__/roundTrip.test.ts`:

```ts
// THE test. The design calls round-tripping "the single most important
// correctness property in the whole feature", and this is where it is
// pinned: open a real shipped definition, change nothing, save, and the
// machine that comes back must be the machine that went in.
import { describe, expect, it } from 'vitest';
import { readStageModel } from '../read.ts';
import { writeMachine } from '../write.ts';
import {
  ENROLLMENT_MACHINE,
  ENROLLMENT_STEPS,
  SIGNUP_MACHINE,
  SIGNUP_STEPS,
} from './fixtures.ts';
import type { MachineDef, WorkflowStepDef } from '../../../types/designer.ts';

const TEMPLATES: [string, MachineDef, WorkflowStepDef[]][] = [
  ['enrollment', ENROLLMENT_MACHINE, ENROLLMENT_STEPS],
  ['signup', SIGNUP_MACHINE, SIGNUP_STEPS],
];

describe.each(TEMPLATES)('round trip: %s', (_name, machine, steps) => {
  const out = () => writeMachine(readStageModel(machine, steps));

  it('produces an identical machine', () => {
    expect(out()).toEqual(machine);
  });

  it('preserves transition declaration order exactly', () => {
    expect(out().transitions.map((t) => t.transition_id)).toEqual(
      machine.transitions.map((t) => t.transition_id),
    );
  });

  it('loses no transition and invents none', () => {
    expect(out().transitions).toHaveLength(machine.transitions.length);
  });

  it('preserves every guard list, including the actor_role guards', () => {
    const before = machine.transitions.map((t) => [t.transition_id, t.guards] as const);
    const after = out().transitions.map((t) => [t.transition_id, t.guards] as const);
    expect(after).toEqual(before);
  });

  it('preserves every effect list', () => {
    const before = machine.transitions.map((t) => [t.transition_id, t.effects] as const);
    const after = out().transitions.map((t) => [t.transition_id, t.effects] as const);
    expect(after).toEqual(before);
  });

  it('preserves state ids, names, and kinds', () => {
    expect(out().states).toEqual(machine.states);
  });

  it('is idempotent under a second pass', () => {
    expect(writeMachine(readStageModel(out(), steps))).toEqual(machine);
  });
});

describe('round trip: hand-authored irregularities', () => {
  // The design's fallback rule: "any transition that does not fit a group
  // renders as an explicit move on its stage, never silently dropped."
  it('keeps a lone irregular transition that matches no other', () => {
    const machine: MachineDef = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' },
        { state_id: 'b', name: 'B', kind: 'active' },
        { state_id: 'z', name: 'Z', kind: 'terminal' },
      ],
      transitions: [
        { transition_id: 't1', from: 'a', to: 'b', action: 'go', actor: 'staff', guards: [], effects: [] },
        {
          transition_id: 't2',
          from: 'a',
          to: 'z',
          action: 'quit',
          actor: 'staff',
          guards: [{ primitive: 'date_window', params: { end: '2026-12-31' } }],
          effects: [],
        },
        { transition_id: 't3', from: 'b', to: 'z', action: 'quit', actor: 'staff', guards: [], effects: [] },
      ],
    };
    const model = readStageModel(machine, []);
    // t2 and t3 share (action, to) but differ in guards — two groups, not one.
    expect(model.groups.filter((g) => g.action === 'quit')).toHaveLength(2);
    expect(writeMachine(model)).toEqual(machine);
  });

  it('round-trips a transition whose actor_role does not match its actor', () => {
    const machine: MachineDef = {
      states: [
        { state_id: 'a', name: 'A', kind: 'initial' },
        { state_id: 'z', name: 'Z', kind: 'terminal' },
      ],
      transitions: [
        {
          transition_id: 't1',
          from: 'a',
          to: 'z',
          action: 'odd',
          actor: 'staff',
          guards: [{ primitive: 'actor_role', params: { roles: ['family'] } }],
          effects: [],
        },
      ],
    };
    expect(writeMachine(readStageModel(machine, []))).toEqual(machine);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage/__tests__/roundTrip.test.ts`
Expected: FAIL — `Failed to resolve import "../write.ts"`.

- [ ] **Step 4: Implement the write path**

Create `apexflow/frontend/src/editor/stage/write.ts`:

```ts
// StageModel -> machine.
//
// The contract this file exists to keep: a group that was READ and not
// edited must be written back exactly as it was found. That is why members
// carry `transition_id`, `actor`, `roleGuard`, and `order` — the write path
// reproduces those rather than re-deriving them from `group.who`, which
// would silently normalise a hand-authored machine on first save.
//
// Declaration order is semantic, not cosmetic: `validate.py`'s
// `_unguarded_branch_errors` requires an unguarded transition to be declared
// LAST within its (from, action) group. Members keep their original `order`;
// anything the editor added carries `order: NEW_ORDER` and lands after every
// pre-existing transition.
import type { GuardRef, MachineDef, StateDef, TransitionDef } from '../../types/designer.ts';
import type { MoveGroup, MoveMember, StageModel, Who } from './types.ts';

/** Members the editor created this session sort after everything read from
 * disk. `Number.MAX_SAFE_INTEGER` (not Infinity) so it survives
 * JSON.stringify in any debugging path. */
export const NEW_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * The `actor_role` guard a given actor gets when the editor CREATES a
 * transition. Matches what both shipped templates author
 * (`_withdraw_pair`, `_drop_pair`) exactly, so an exit added in the editor
 * is indistinguishable from one written by hand.
 *
 * Only ever called for a NEW member, or when the author changes "Who can do
 * it" on a member that already had a roleGuard. A member read with
 * `roleGuard: null` keeps null — see this module's contract.
 */
export function roleGuardFor(actor: TransitionDef['actor']): GuardRef {
  if (actor === 'family') return { primitive: 'actor_role', params: { roles: ['family'] } };
  return { primitive: 'actor_role', params: { roles: ['staff', 'admin'] } };
}

/** The actors a `who` expands to. `'both'` is the family/staff pair. */
export function actorsFor(who: Who): TransitionDef['actor'][] {
  if (who === 'both') return ['family', 'staff'];
  if (who === 'automatic') return ['system'];
  return [who];
}

function memberToTransition(group: MoveGroup, member: MoveMember): TransitionDef {
  // Re-insert the absorbed actor_role guard at position 0, which is where
  // both shipped templates put it and where `splitActorRole` found it.
  const guards = member.roleGuard ? [member.roleGuard, ...group.guards] : [...group.guards];
  return {
    transition_id: member.transition_id,
    from: member.from,
    to: group.to,
    action: group.action,
    actor: member.actor,
    guards,
    effects: [...group.effects],
  };
}

export function writeMachine(model: StageModel): MachineDef {
  const states: StateDef[] = model.stages.map((stage) => ({
    state_id: stage.stage_id,
    name: stage.name,
    kind: stage.kind,
  }));

  const rows: { order: number; seq: number; transition: TransitionDef }[] = [];
  let seq = 0;
  for (const group of model.groups) {
    for (const member of group.members) {
      rows.push({ order: member.order, seq: seq++, transition: memberToTransition(group, member) });
    }
  }
  rows.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.seq - b.seq));

  return { states, transitions: rows.map((r) => r.transition) };
}
```

> **Note on `states` order:** `readStageModel` sorts stages into spine order, so `writeMachine` writes them in spine order rather than the order they were declared in. For both shipped templates spine order equals declaration order, which is why `preserves state ids, names, and kinds` passes. If a future fixture disagrees, the fix is to carry the original index on `Stage` and sort by it here — **not** to weaken the assertion.

- [ ] **Step 5: Run the round-trip test**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS. If `preserves state ids, names, and kinds` fails for enrollment, apply the note above (add `declaredIndex: number` to `Stage`, set it in `readStageModel`, sort by it in `writeMachine`) and re-run — do not relax the test.

- [ ] **Step 6: Mutation — prove the round-trip test bites**

Each of these is a plausible implementation slip. Run `npx vitest run --no-cache src/editor/stage` after each, then revert.

1. In `write.ts`, drop the roleGuard: `const guards = [...group.guards];`
   Expected: FAIL — `preserves every guard list, including the actor_role guards`, for both templates.
2. In `write.ts`, ignore declaration order: replace the `rows.sort(...)` line with `rows.sort((a, b) => a.seq - b.seq);`
   Expected: FAIL — `preserves transition declaration order exactly`, for both templates.
3. In `write.ts`, derive the actor from the group instead of the member: in `memberToTransition`, use `actor: actorsFor(group.who)[0]`.
   Expected: FAIL — `produces an identical machine` (every staff half of every pair becomes `family`).
4. In `write.ts`, always emit a roleGuard: `const guards = [roleGuardFor(member.actor), ...group.guards];`
   Expected: FAIL — `round trip: enrollment > produces an identical machine` (`t_route_to_review` and `t_promote_waitlist` gain a guard they never had).

Revert all four. Run again. Expected: PASS.

- [ ] **Step 7: Write the write-path unit test**

Create `apexflow/frontend/src/editor/stage/__tests__/write.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { actorsFor, NEW_ORDER, roleGuardFor, writeMachine } from '../write.ts';
import type { StageModel } from '../types.ts';

describe('roleGuardFor', () => {
  it('writes exactly what the shipped templates write', () => {
    expect(roleGuardFor('family')).toEqual({ primitive: 'actor_role', params: { roles: ['family'] } });
    expect(roleGuardFor('staff')).toEqual({
      primitive: 'actor_role',
      params: { roles: ['staff', 'admin'] },
    });
  });
});

describe('actorsFor', () => {
  it('expands "both" to the family/staff pair', () => {
    expect(actorsFor('both')).toEqual(['family', 'staff']);
  });
  it('maps "automatic" to the system actor', () => {
    expect(actorsFor('automatic')).toEqual(['system']);
  });
});

describe('writeMachine', () => {
  const model: StageModel = {
    stages: [
      { stage_id: 'a', name: 'A', kind: 'initial', depth: 0, step_ids: [] },
      { stage_id: 'z', name: 'Z', kind: 'terminal', depth: 1, step_ids: [] },
    ],
    finishStageId: 'z',
    groups: [
      {
        key: 'k-new',
        action: 'finish',
        to: 'z',
        who: 'staff',
        guards: [],
        effects: [],
        members: [
          { transition_id: 't_new', from: 'a', actor: 'staff', roleGuard: null, order: NEW_ORDER },
        ],
      },
      {
        key: 'k-old',
        action: 'start',
        to: 'z',
        who: 'family',
        guards: [],
        effects: [],
        members: [{ transition_id: 't_old', from: 'a', actor: 'family', roleGuard: null, order: 0 }],
      },
    ],
  };

  it('places a newly added transition after every pre-existing one', () => {
    expect(writeMachine(model).transitions.map((t) => t.transition_id)).toEqual(['t_old', 't_new']);
  });

  it('writes stages back as states in model order', () => {
    expect(writeMachine(model).states).toEqual([
      { state_id: 'a', name: 'A', kind: 'initial' },
      { state_id: 'z', name: 'Z', kind: 'terminal' },
    ]);
  });
});
```

- [ ] **Step 8: Run it**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS.

- [ ] **Step 9: Mutation — prove the ordering test bites**

In `write.ts`, set `export const NEW_ORDER = -1;`
Expected: FAIL — `places a newly added transition after every pre-existing one`.
Revert. Expected: PASS.

- [ ] **Step 10: Build, lint, commit**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`

```bash
git add apexflow/frontend/src/editor/stage
git commit -m "feat(apexflow): write a stage model back to a machine, round-trip pinned

Opening either shipped definition and saving it with no edits now produces
an identical machine — asserted transition-by-transition, guard-by-guard,
and in declaration order, over the REAL enrollment and signup templates
rather than a toy fixture. Declaration order is part of the assertion
because validate.py's _unguarded_branch_errors reads it.

Four mutations verified: dropping the absorbed actor_role, ignoring
declaration order, taking the actor from the group instead of the member,
and always emitting an actor_role. Each breaks a named test."
```

---

## Task 5: Plain-language phrases, allowlist test first

Amendment C: the test comes before the table, so the phrase set is completed by making a failing test pass rather than by inspection.

**Files:**
- Create: `apexflow/frontend/src/editor/stage/phrases.ts`
- Create: `apexflow/frontend/src/editor/stage/__tests__/phrases.test.ts`
- Modify: `apexflow/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `PrimitivesCatalog`, `GuardRef`, `EffectRef` from `../../types/designer.ts`; `useTranslation`'s `t` function is **not** used here — `describePrimitive` takes `t` as a parameter so this module stays pure and testable.
- Produces:
  - `const RAW_ONLY: readonly string[]` — primitives deliberately shown raw.
  - `const ABSORBED: readonly string[]` — primitives that never render at all because another control owns them (`actor_role`).
  - `function phraseKey(primitive: string): string | null` — the i18n key, or `null` for raw-only/absorbed.
  - `function describePrimitive(ref: GuardRef | EffectRef, t: (k: string) => string): string` — the sentence, or a raw fallback `"primitive(param=value, …)"`.

- [ ] **Step 1: Write the failing coverage test**

Create `apexflow/frontend/src/editor/stage/__tests__/phrases.test.ts`:

```ts
// The maintenance guard the design asks for: "a test asserting that every
// member of GUARDS/EFFECTS either has a phrase or appears on an explicit
// raw-only allowlist — so a primitive added later fails the suite rather
// than quietly degrading in front of an admin."
//
// The primitive list is transcribed from
// apexflow/backend/app/workflows/primitives.py's GUARDS/EFFECTS registry
// keys. A primitive added there without a phrase here fails this file.
import { describe, expect, it } from 'vitest';
import { ABSORBED, describePrimitive, phraseKey, RAW_ONLY } from '../phrases.ts';
import { translations } from '../../../i18n/translations.ts';

const GUARDS = [
  'all_blocking_items_complete',
  'items_in_status',
  'capacity_available',
  'data_condition',
  'date_window',
  'actor_role',
] as const;

const EFFECTS = [
  'commit_sections',
  'set_entity_field',
  'send_email',
  'issue_link',
  'start_due_clocks',
  'set_context',
] as const;

const ALL = [...GUARDS, ...EFFECTS];

describe('phrase coverage', () => {
  it.each(ALL)('%s has a phrase, or is explicitly raw-only or absorbed', (primitive) => {
    const key = phraseKey(primitive);
    const accounted = key !== null || RAW_ONLY.includes(primitive) || ABSORBED.includes(primitive);
    expect({ primitive, accounted }).toEqual({ primitive, accounted: true });
  });

  it.each(ALL)('%s’s phrase key exists in every locale', (primitive) => {
    const key = phraseKey(primitive);
    if (key === null) return;
    for (const locale of Object.keys(translations)) {
      expect({ locale, key, present: key in translations[locale as keyof typeof translations] }).toEqual({
        locale,
        key,
        present: true,
      });
    }
  });

  it('absorbs actor_role rather than phrasing it', () => {
    expect(ABSORBED).toContain('actor_role');
    expect(phraseKey('actor_role')).toBeNull();
  });
});

describe('describePrimitive', () => {
  const t = (k: string) => translations['en-US'][k] ?? k;

  it('renders a known guard as a sentence', () => {
    expect(describePrimitive({ primitive: 'capacity_available', params: {} }, t)).toBe(
      'only if there is space',
    );
  });

  it('renders a known effect as a sentence', () => {
    expect(describePrimitive({ primitive: 'send_email', params: { template: 'approved' } }, t)).toBe(
      'emails the family',
    );
  });

  it('falls back to the raw primitive and its params, never hiding it', () => {
    const out = describePrimitive(
      { primitive: 'made_up_primitive', params: { a: 1, b: 'x' } },
      t,
    );
    expect(out).toContain('made_up_primitive');
    expect(out).toContain('a=1');
    expect(out).toContain('b=x');
  });

  it('renders a raw-only primitive raw even though it is known', () => {
    for (const primitive of RAW_ONLY) {
      expect(describePrimitive({ primitive, params: {} }, t)).toContain(primitive);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage/__tests__/phrases.test.ts`
Expected: FAIL — `Failed to resolve import "../phrases.ts"`.

- [ ] **Step 3: Add the i18n keys**

In `apexflow/frontend/src/i18n/translations.ts`, add to the `'en-US'` block (after the existing `editor.machine.*` keys):

```ts
    // Stage editor — plain-language primitive phrases
    'editor.phrase.all_blocking_items_complete': 'only if every required step is done',
    'editor.phrase.items_in_status': 'only if the required items are complete',
    'editor.phrase.capacity_available': 'only if there is space',
    'editor.phrase.date_window': 'only during the enrolment window',
    'editor.phrase.commit_sections': 'creates the records from the form',
    'editor.phrase.set_entity_field': 'records the decision on the application',
    'editor.phrase.send_email': 'emails the family',
    'editor.phrase.issue_link': 'sends the family a link',
    'editor.phrase.start_due_clocks': 'starts the document due dates',
    'editor.phrase.set_context': 'records a note on the application',
```

and to the `'zh-CN'` block:

```ts
    // Stage editor — plain-language primitive phrases
    'editor.phrase.all_blocking_items_complete': '仅当所有必填步骤已完成',
    'editor.phrase.items_in_status': '仅当所需项目已完成',
    'editor.phrase.capacity_available': '仅当尚有名额',
    'editor.phrase.date_window': '仅在报名时间段内',
    'editor.phrase.commit_sections': '根据表单创建记录',
    'editor.phrase.set_entity_field': '将决定记录到申请上',
    'editor.phrase.send_email': '向家长发送邮件',
    'editor.phrase.issue_link': '向家长发送链接',
    'editor.phrase.start_due_clocks': '开始计算材料截止日期',
    'editor.phrase.set_context': '在申请上记录一条备注',
```

- [ ] **Step 4: Implement the phrase table**

Create `apexflow/frontend/src/editor/stage/phrases.ts`:

```ts
// Plain-language rendering of guard/effect primitives.
//
// Design decision this file implements: "Anything without a phrase renders
// as its raw primitive name with its params" — degraded, never hidden and
// never dropped. `phrases.test.ts` fails if a primitive is added to the
// backend registry without being accounted for here, which is the whole
// point of the allowlist.
//
// `t` is a parameter rather than a `useTranslation()` call so this module is
// pure and testable without React.
import type { EffectRef, GuardRef } from '../../types/designer.ts';

/**
 * Primitives another control owns entirely, so they must NOT render as a
 * guard at all. `actor_role` is folded into "Who can do it" by
 * `read.ts`'s `splitActorRole`; showing it again would let an author edit
 * two things that must agree.
 */
export const ABSORBED: readonly string[] = ['actor_role'];

/**
 * Primitives deliberately shown raw. `data_condition` wraps an arbitrary
 * condition expression — a fixed sentence would either lie about what it
 * tests or say nothing, so it shows its shape and offers "Edit as advanced".
 */
export const RAW_ONLY: readonly string[] = ['data_condition'];

const PHRASED: readonly string[] = [
  'all_blocking_items_complete',
  'items_in_status',
  'capacity_available',
  'date_window',
  'commit_sections',
  'set_entity_field',
  'send_email',
  'issue_link',
  'start_due_clocks',
  'set_context',
];

export function phraseKey(primitive: string): string | null {
  if (!PHRASED.includes(primitive)) return null;
  return `editor.phrase.${primitive}`;
}

function renderParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '';
  const rendered = entries
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  return `(${rendered})`;
}

export function describePrimitive(ref: GuardRef | EffectRef, t: (key: string) => string): string {
  const key = phraseKey(ref.primitive);
  if (key === null) return `${ref.primitive}${renderParams(ref.params)}`;
  return t(key);
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS.

- [ ] **Step 6: Mutation — prove the allowlist bites**

1. Add `'sends_an_sms'` to the `GUARDS` array in `phrases.test.ts` (simulating a primitive landing in the backend registry).
   Expected: FAIL — `sends_an_sms has a phrase, or is explicitly raw-only or absorbed`.
   Remove it again.
2. Delete `'editor.phrase.issue_link'` from the `'zh-CN'` block of `translations.ts`.
   Expected: FAIL — `issue_link's phrase key exists in every locale` **and** the Task 2 parity test.
   Restore it.
3. In `phrases.ts`, change `ABSORBED` to `[]`.
   Expected: FAIL — `absorbs actor_role rather than phrasing it`.
   Revert.

Run again. Expected: PASS.

- [ ] **Step 7: Build, lint, commit**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`

```bash
git add apexflow/frontend/src/editor/stage apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): plain-language primitive phrases, allowlist-guarded

The test came first, per the coverage ruling's Amendment C. Adding a
primitive to the backend GUARDS/EFFECTS registry without accounting for it
here now fails the suite instead of quietly degrading to raw in front of an
admin. issue_link, which signup's offer_spot uses, was one of the six the
design's phrase table missed."
```

---

## Task 6: The StageEditor shell

Replaces the Steps and Machine tabs with one surface. This task renders stages as read-only cards and wires the model into `EditorPage`; editing lands in Tasks 7–9.

**Files:**
- Create: `apexflow/frontend/src/editor/StageEditor.tsx`
- Modify: `apexflow/frontend/src/pages/EditorPage.tsx`
- Modify: `apexflow/frontend/src/i18n/translations.ts`
- Modify: `apexflow/frontend/src/editor/editor.css`

**Interfaces:**
- Consumes: `readStageModel`, `writeMachine`, `isExitGroup` from `./stage/`; `useDraftStore`'s `machine`, `steps`, `setMachine`, `setSteps`, `models`, `readOnly`, `validation.errors`.
- Produces: `<StageEditor tenantId machine steps models errors readOnly onMachineChange onStepsChange />`, consumed by `EditorPage`. Tasks 7–9 add child components under it.

- [ ] **Step 1: Add the i18n keys**

Add to both locale blocks in `translations.ts`:

```ts
    // Stage editor
    'editor.tabs.stages': 'Stages',        // zh-CN: '阶段'
    'editor.stages.heading': 'Stages',     // zh-CN: '阶段'
    'editor.stages.startsHere': 'Starts here',   // zh-CN: '从这里开始'
    'editor.stages.finishes': 'Finished',        // zh-CN: '已完成'
    'editor.stages.stepCount': '{n} step(s)',    // zh-CN: '{n} 个步骤'
    'editor.stages.moveCount': '{n} move(s) out',// zh-CN: '{n} 个流转'
    'editor.stages.empty': 'This workflow has no stages yet.', // zh-CN: '此工作流尚无阶段。'
    'editor.stages.errorCount': '{n} issue(s) to fix — see Validation', // zh-CN: '有 {n} 个问题待修复 — 见校验'
    'editor.exits.heading': 'Exits',       // zh-CN: '退出'
    'editor.exits.empty': 'No exits yet.', // zh-CN: '尚无退出。'
    'editor.exits.expansion': 'expands to {t} transition(s) · {s} stage(s) × {a} actor(s)',
    // zh-CN: '展开为 {t} 个转换 · {s} 个阶段 × {a} 个操作者'
```

- [ ] **Step 2: Write the StageEditor shell**

Create `apexflow/frontend/src/editor/StageEditor.tsx`:

```tsx
// The one authoring surface. Replaces MachineEditor (the Machine tab) and
// the Steps tab: a stage is a state, the steps that happen in it are shown
// inside it, and the moves out of it are shown beneath it. Cross-cutting
// exits live in their own panel because authoring them per stage is what
// produced twelve copy-pasted withdraw transitions in the enrollment
// template.
//
// This component owns NO machine knowledge. It reads a StageModel, renders
// it, and writes edits back through `writeMachine` — so the round-trip
// property proved in stage/__tests__/roundTrip.test.ts covers every edit
// this UI can make.
import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { readStageModel, isExitGroup } from './stage/read.ts';
import type { MoveGroup } from './stage/types.ts';
import type {
  EntityModelsMap,
  MachineDef,
  WorkflowStepDef,
} from '../types/designer.ts';
import './editor.css';

interface StageEditorProps {
  tenantId: string;
  machine: MachineDef;
  steps: WorkflowStepDef[];
  models: EntityModelsMap;
  errors: string[];
  readOnly: boolean;
  onMachineChange: (next: MachineDef) => void;
  onStepsChange: (next: WorkflowStepDef[]) => void;
}

export default function StageEditor({
  machine,
  steps,
  errors,
  onMachineChange,
}: StageEditorProps) {
  const { t } = useTranslation();
  const model = useMemo(() => readStageModel(machine, steps), [machine, steps]);

  const exits = model.groups.filter((g) => isExitGroup(g, model));
  const movesByStage = new Map<string, MoveGroup[]>();
  for (const group of model.groups) {
    if (isExitGroup(group, model)) continue;
    for (const member of group.members) {
      const list = movesByStage.get(member.from) ?? [];
      if (!list.includes(group)) list.push(group);
      movesByStage.set(member.from, list);
    }
  }

  return (
    <div className="stage-editor">
      <section className="stage-list">
        <h3>{t('editor.stages.heading')}</h3>
        {model.stages.length === 0 && <p className="stage-empty">{t('editor.stages.empty')}</p>}
        <ol className="stage-cards">
          {model.stages.map((stage) => (
            <li key={stage.stage_id} className="stage-card">
              <header className="stage-card-header">
                <span className="stage-card-name">{stage.name || stage.stage_id}</span>
                {stage.kind === 'initial' && (
                  <span className="stage-card-role">{t('editor.stages.startsHere')}</span>
                )}
                {stage.kind === 'terminal' && (
                  <span className="stage-card-role">{t('editor.stages.finishes')}</span>
                )}
              </header>
              <p className="stage-card-counts">
                {t('editor.stages.stepCount').replace('{n}', String(stage.step_ids.length))}
                {' · '}
                {t('editor.stages.moveCount').replace(
                  '{n}',
                  String((movesByStage.get(stage.stage_id) ?? []).length),
                )}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="stage-exits">
        <h3>{t('editor.exits.heading')}</h3>
        {exits.length === 0 && <p className="stage-empty">{t('editor.exits.empty')}</p>}
        <ul className="stage-exit-cards">
          {exits.map((exit) => {
            const stages = new Set(exit.members.map((m) => m.from)).size;
            const actors = new Set(exit.members.map((m) => m.actor)).size;
            return (
              <li key={exit.key} className="stage-exit-card">
                <span className="stage-exit-action">{exit.action}</span>
                <span className="stage-exit-expansion">
                  {t('editor.exits.expansion')
                    .replace('{t}', String(exit.members.length))
                    .replace('{s}', String(stages))
                    .replace('{a}', String(actors))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {errors.length > 0 && (
        <p className="stage-editor-error-count" role="status">
          {t('editor.stages.errorCount').replace('{n}', String(errors.length))}
        </p>
      )}
    </div>
  );
}
```

> `readOnly` is destructured but not yet used in this task — Task 7 passes it to `StageCard`. To keep `npm run lint` at zero errors in the meantime, leave `readOnly` **out** of the destructure here and add it back in Task 7. The prop stays on the interface either way, since `EditorPage` already passes it.

- [ ] **Step 3: Wire it into EditorPage**

In `apexflow/frontend/src/pages/EditorPage.tsx`:

Replace the import of `MachineEditor` (line 12) with:

```tsx
import StageEditor from '../editor/StageEditor.tsx';
```

Replace the tab type (line 20):

```tsx
type EditorTab = 'stages' | 'preview';
```

Replace the initial tab state (line 30):

```tsx
  const [tab, setTab] = useState<EditorTab>('stages');
```

Replace the three tab buttons (lines 188–216) with two:

```tsx
      <div className="editor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'stages'}
          className={`editor-tab${tab === 'stages' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('stages')}
        >
          {t('editor.tabs.stages')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={`editor-tab${tab === 'preview' ? ' editor-tab-active' : ''}`}
          onClick={() => setTab('preview')}
        >
          {t('editor.tabs.preview')}
        </button>
      </div>
```

Replace the two tab panels (lines 220–240) with one:

```tsx
          {tab === 'stages' && (
            <StageEditor
              tenantId={tenantId}
              machine={store.machine}
              steps={store.steps}
              models={store.models}
              errors={store.validation.errors}
              readOnly={store.readOnly}
              onMachineChange={store.setMachine}
              onStepsChange={store.setSteps}
            />
          )}
```

Leave the `preview` panel and the validation rail exactly as they are.

- [ ] **Step 4: Add the CSS**

Append to `apexflow/frontend/src/editor/editor.css`:

```css
/* --- Stage editor ------------------------------------------------------ */
.stage-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 1.5rem);
}
.stage-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}
.stage-card {
  border: 1px solid var(--color-border, #d7d7dc);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-4, 1rem);
  background: var(--color-surface, #fff);
}
.stage-card-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2, 0.5rem);
}
.stage-card-name {
  font-weight: 600;
}
.stage-card-role {
  font-size: 0.8125rem;
  color: var(--color-text-muted, #6b6b76);
}
.stage-card-counts {
  margin: var(--space-2, 0.5rem) 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted, #6b6b76);
}
.stage-empty {
  color: var(--color-text-muted, #6b6b76);
}
.stage-exit-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
}
.stage-exit-card {
  display: flex;
  align-items: baseline;
  gap: var(--space-3, 0.75rem);
  border: 1px solid var(--color-border, #d7d7dc);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-3, 0.75rem);
}
.stage-exit-action {
  font-weight: 600;
}
.stage-exit-expansion {
  font-size: 0.8125rem;
  color: var(--color-text-muted, #6b6b76);
}
```

- [ ] **Step 5: Build and lint**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`
Expected: build succeeds, 0 lint errors, all tests pass.

> `MachineEditor.tsx` and `TransitionPanel.tsx` are now unimported. Leave them on disk until Task 10 — deleting them here would make Tasks 7–9 harder to compare against the behaviour being replaced.

- [ ] **Step 6: Verify in the running app**

Run `./start-services.sh`, open `http://localhost:5900`, sign in, open the enrollment definition. Confirm: the tab strip shows **Stages** and **Preview** only; nine stage cards render in the order `draft, submitted, waitlisted, in_review, pending_items, approved, enrolled, withdrawn, declined` (spine order with the two exit targets last — this exact sequence is what `spine.test.ts` asserts); `draft` shows "Starts here"; the Exits panel shows two cards, `withdraw` reading `expands to 12 transition(s) · 6 stage(s) × 2 actor(s)` and `decline` reading `expands to 2 transition(s) · 2 stage(s) × 1 actor(s)`. If any of these is wrong, the bug is in `read.ts`, not here — add the failing case to `read.test.ts` first.

- [ ] **Step 7: Commit**

```bash
git add apexflow/frontend/src/editor/StageEditor.tsx \
        apexflow/frontend/src/editor/editor.css \
        apexflow/frontend/src/pages/EditorPage.tsx \
        apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): stage editor shell replaces the Steps and Machine tabs

Read-only for now: stage cards in spine order, an Exits panel with live
expansion counts. Every edit in Tasks 7-9 funnels through one commit()
that calls writeMachine, so the round-trip property already proved in
stage/__tests__/roundTrip.test.ts covers all of them."
```

---

## Task 7: Steps inside stages

**Files:**
- Create: `apexflow/frontend/src/editor/StageCard.tsx`
- Modify: `apexflow/frontend/src/editor/StepEditor.tsx` (add two optional props)
- Modify: `apexflow/frontend/src/editor/StageEditor.tsx`
- Modify: `apexflow/frontend/src/i18n/translations.ts`, `editor.css`

**Interfaces:**
- Consumes: `Stage`, `MoveGroup` from `./stage/types.ts`.
- Produces: `<StageCard stage moves models steps errors readOnly onStepsChange onStageChange />`.
- Modifies `StepEditor`'s props to add: `stageId?: string` (render only steps whose `available_in` includes it; new steps are created into it; reorder controls hidden) and `hideAvailableIn?: boolean` (suppress the `available_in` checkbox grid, since placement is now the stage card itself). Both default to undefined/false, so no existing call site changes behaviour.

> **Trade-off, stated deliberately:** `StepEditor.tsx` is 576 lines and works. Adding two optional props is a smaller, safer change than extracting a `StepCard` component, and this repo has already broken three frontends once. The extraction stays available later if the file grows further.

- [ ] **Step 1: Add the i18n keys**

Both locales:

```ts
    'editor.stage.stepsHeading': 'What happens here',   // zh-CN: '这里发生什么'
    'editor.stage.noSteps': 'Nothing happens in this stage yet.', // zh-CN: '此阶段尚无内容。'
    'editor.stage.alsoIn': 'also in {stages}',          // zh-CN: '同时出现在 {stages}'
    'editor.stage.addStep': 'Add something here',       // zh-CN: '在此添加'
    'editor.stage.rename': 'Stage name',                // zh-CN: '阶段名称'
```

- [ ] **Step 2: Add the two props to StepEditor**

In `apexflow/frontend/src/editor/StepEditor.tsx`, extend `StepEditorProps` (line 22):

```tsx
interface StepEditorProps {
  steps: WorkflowStepDef[];
  onChange: (next: WorkflowStepDef[]) => void;
  models: EntityModelsMap;
  states: StateDef[];
  errors: string[];
  readOnly: boolean;
  /** Stage-editor mode: render only steps whose `available_in` contains this
   * stage, and create new steps into it. The component still operates on the
   * FULL `steps` array internally — filtering happens at render time only, so
   * indices, reordering, and `onChange` payloads stay whole-array. */
  stageId?: string;
  /** Suppress the `available_in` checkbox grid. In stage-editor mode a step's
   * placement is which card it sits in, so a second control for the same data
   * would be two ways to edit one field. */
  hideAvailableIn?: boolean;
}
```

Update the destructure (line 105):

```tsx
export default function StepEditor({
  steps,
  onChange,
  models,
  states,
  errors,
  readOnly,
  stageId,
  hideAvailableIn,
}: StepEditorProps) {
```

Inside the step list render, skip non-matching steps. Immediately after the `steps.map((step, idx) => {` line, insert:

```tsx
            if (stageId && !step.available_in.includes(stageId)) return null;
```

Wrap the `available_in` checkbox block (the JSX containing `step.available_in.includes(s.state_id)` around line 314) in:

```tsx
                  {!hideAvailableIn && (
                    /* ...existing available_in checkbox grid, unchanged... */
                  )}
```

Where `newStep(...)` is called from the "add step" handler, default `available_in` to the current stage when in stage mode:

```tsx
  function addStep() {
    const created = newStep(states, steps.length);
    onChange([...steps, stageId ? { ...created, available_in: [stageId] } : created]);
  }
```

Hide the up/down reorder buttons when `stageId` is set — order is global, so reordering from inside one stage card would move a step relative to steps the author cannot see. Add `disabled={readOnly || Boolean(stageId)}` to both reorder buttons.

- [ ] **Step 3: Write the StageCard**

Create `apexflow/frontend/src/editor/StageCard.tsx`:

```tsx
// One stage: its name, what happens in it, and the moves out of it.
//
// "Steps move inside stages" (design spec): a step is created within the
// stage it happens in, and `available_in` is written from that placement. A
// step appearing in several stages shows in each, with an "also in" note so
// the author knows an edit here is an edit everywhere.
import { useTranslation } from '../hooks/useTranslation.ts';
import StepEditor from './StepEditor.tsx';
import type { MoveGroup, Stage } from './stage/types.ts';
import type { EntityModelsMap, StateDef, WorkflowStepDef } from '../types/designer.ts';
import './editor.css';

interface StageCardProps {
  stage: Stage;
  stages: Stage[];
  moves: MoveGroup[];
  steps: WorkflowStepDef[];
  states: StateDef[];
  models: EntityModelsMap;
  errors: string[];
  readOnly: boolean;
  onStepsChange: (next: WorkflowStepDef[]) => void;
  onRename: (name: string) => void;
  /** Rendered beneath the steps — supplied by StageEditor so MoveRow (Task 8)
   * can be dropped in without StageCard learning about moves. */
  renderMoves: (moves: MoveGroup[]) => React.ReactNode;
}

export default function StageCard({
  stage,
  stages,
  moves,
  steps,
  states,
  models,
  errors,
  readOnly,
  onStepsChange,
  onRename,
  renderMoves,
}: StageCardProps) {
  const { t } = useTranslation();
  const stageNames = new Map(stages.map((s) => [s.stage_id, s.name || s.stage_id]));
  const inThisStage = steps.filter((s) => s.available_in.includes(stage.stage_id));

  return (
    <li className="stage-card">
      <header className="stage-card-header">
        <label className="stage-card-name-label">
          <span className="visually-hidden">{t('editor.stage.rename')}</span>
          <input
            type="text"
            className="stage-card-name-input"
            value={stage.name}
            disabled={readOnly}
            onChange={(e) => onRename(e.target.value)}
          />
        </label>
        {stage.kind === 'initial' && (
          <span className="stage-card-role">{t('editor.stages.startsHere')}</span>
        )}
        {stage.kind === 'terminal' && (
          <span className="stage-card-role">{t('editor.stages.finishes')}</span>
        )}
      </header>

      <section className="stage-card-steps">
        <h4>{t('editor.stage.stepsHeading')}</h4>
        {inThisStage.length === 0 && <p className="stage-empty">{t('editor.stage.noSteps')}</p>}
        <ul className="stage-card-step-notes">
          {inThisStage
            .filter((step) => step.available_in.length > 1)
            .map((step) => (
              <li key={step.step_id} className="stage-card-step-note">
                {step.title || step.step_id}:{' '}
                {t('editor.stage.alsoIn').replace(
                  '{stages}',
                  step.available_in
                    .filter((id) => id !== stage.stage_id)
                    .map((id) => stageNames.get(id) ?? id)
                    .join(', '),
                )}
              </li>
            ))}
        </ul>
        <StepEditor
          steps={steps}
          onChange={onStepsChange}
          models={models}
          states={states}
          errors={errors}
          readOnly={readOnly}
          stageId={stage.stage_id}
          hideAvailableIn
        />
      </section>

      <section className="stage-card-moves">{renderMoves(moves)}</section>
    </li>
  );
}
```

- [ ] **Step 4: Render StageCards from StageEditor**

In `StageEditor.tsx`, replace the `<li key={stage.stage_id} className="stage-card">…</li>` block with:

```tsx
            <StageCard
              key={stage.stage_id}
              stage={stage}
              stages={model.stages}
              moves={movesByStage.get(stage.stage_id) ?? []}
              steps={steps}
              states={machine.states}
              models={models}
              errors={errors}
              readOnly={readOnly}
              onStepsChange={onStepsChange}
              onRename={(name) =>
                commit({
                  ...model,
                  stages: model.stages.map((s) =>
                    s.stage_id === stage.stage_id ? { ...s, name } : s,
                  ),
                })
              }
              renderMoves={() => null}
            />
```

Add `import StageCard from './StageCard.tsx';`, add `readOnly` back to the destructured props (Task 6 deliberately left it out to keep lint clean), and add the single place a `StageModel` becomes a machine — every editing control in Tasks 7–9 funnels through it, so the round-trip property covers all of them:

```tsx
import { writeMachine } from './stage/write.ts';
import type { StageModel } from './stage/types.ts';

  function commit(next: StageModel) {
    onMachineChange(writeMachine(next));
  }
```

- [ ] **Step 5: Add the CSS**

Append to `editor.css`:

```css
.stage-card-name-input {
  font-weight: 600;
  font-size: 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm, 4px);
  padding: 0.125rem 0.25rem;
  background: transparent;
}
.stage-card-name-input:hover:not(:disabled),
.stage-card-name-input:focus {
  border-color: var(--color-border, #d7d7dc);
  background: var(--color-surface, #fff);
}
.stage-card-steps h4,
.stage-card-moves h4 {
  margin: var(--space-4, 1rem) 0 var(--space-2, 0.5rem);
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, #6b6b76);
}
.stage-card-step-notes {
  list-style: none;
  margin: 0 0 var(--space-2, 0.5rem);
  padding: 0;
}
.stage-card-step-note {
  font-size: 0.8125rem;
  color: var(--color-text-muted, #6b6b76);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
```

- [ ] **Step 6: Add a regression test for stage renaming**

Renaming is the first edit path, so it is the first chance for the write path to be wired up wrong. Append to `apexflow/frontend/src/editor/stage/__tests__/write.test.ts`:

```ts
describe('renaming a stage', () => {
  it('changes only the name and leaves every transition untouched', async () => {
    const { readStageModel } = await import('../read.ts');
    const { SIGNUP_MACHINE, SIGNUP_STEPS } = await import('./fixtures.ts');
    const model = readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);
    const renamed = {
      ...model,
      stages: model.stages.map((s) => (s.stage_id === 'offered' ? { ...s, name: 'Offer Out' } : s)),
    };
    const out = writeMachine(renamed);
    expect(out.transitions).toEqual(SIGNUP_MACHINE.transitions);
    expect(out.states.find((s) => s.state_id === 'offered')?.name).toBe('Offer Out');
    expect(out.states.filter((s) => s.state_id !== 'offered')).toEqual(
      SIGNUP_MACHINE.states.filter((s) => s.state_id !== 'offered'),
    );
  });
});
```

- [ ] **Step 7: Run, mutate, revert**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS.

Mutation: in `write.ts`, change the states mapping to `name: stage.stage_id`.
Expected: FAIL — `changes only the name and leaves every transition untouched` **and** every round-trip `preserves state ids, names, and kinds`.
Revert. Expected: PASS.

- [ ] **Step 8: Build, lint, verify, commit**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`

Open the enrollment definition. Confirm: `application_form` appears inside both `Draft` and `Pending Items` with an "also in" note in each; `review_notice` appears in three stages; renaming `In Review` to `Under Review` updates the card and the save indicator shows "Saved"; reload shows the new name.

```bash
git add apexflow/frontend/src/editor apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): steps live inside the stage they happen in

The Steps tab's inversion is gone: a step is created in the stage it belongs
to and available_in is written from that placement. A step in several stages
shows in each with an 'also in' note, so an author knows an edit here is an
edit everywhere.

StepEditor gained two optional props rather than being split apart — a
576-line file that works is not worth restructuring in the same change that
replaces two tabs."
```

---

## Task 8: Moves in plain language, with the escape hatch

**Files:**
- Create: `apexflow/frontend/src/editor/MoveRow.tsx`
- Create: `apexflow/frontend/src/editor/stage/sources.ts`
- Modify: `apexflow/frontend/src/editor/stage/write.ts` (add `membersForWho`)
- Create: `apexflow/frontend/src/editor/stage/__tests__/who.test.ts`
- Modify: `apexflow/frontend/src/editor/StageEditor.tsx`, `translations.ts`, `editor.css`

**Interfaces:**
- Consumes: `MoveGroup`, `Who` from `./stage/types.ts`; `describePrimitive` from `./stage/phrases.ts`; `roleGuardFor`, `actorsFor` from `./stage/write.ts`; `GuardEffectComposer` unchanged.
- Produces: `<MoveRow group stages states primitives models declaredSectionIds declaredStepIds sourceGroups readOnly onChange onRemove />` where `onChange: (next: MoveGroup) => void` and `onRemove: () => void`. Task 9 reuses it unchanged for exits.
- Produces: `function membersForWho(group: MoveGroup, who: Who): MoveMember[]` in `write.ts` (added in Step 4), so the rule is testable without React.

- [ ] **Step 1: Add the i18n keys**

Both locales:

```ts
    'editor.move.goesTo': 'goes to {stage}',        // zh-CN: '前往 {stage}'
    'editor.move.whoLabel': 'Who can do it',        // zh-CN: '谁可以执行'
    'editor.move.who.family': 'A family',           // zh-CN: '家长'
    'editor.move.who.staff': 'Staff',               // zh-CN: '教职员工'
    'editor.move.who.both': 'A family or staff',    // zh-CN: '家长或教职员工'
    'editor.move.who.automatic': 'Automatically',   // zh-CN: '自动'
    'editor.move.onlyWhen': 'Only when',            // zh-CN: '仅当'
    'editor.move.thenWhat': 'And then',             // zh-CN: '然后'
    'editor.move.advanced': 'Edit as advanced',     // zh-CN: '高级编辑'
    'editor.move.advancedDone': 'Done',             // zh-CN: '完成'
    'editor.move.remove': 'Remove this move',       // zh-CN: '删除此流转'
    'editor.move.actionLabel': "What it's called",  // zh-CN: '名称'
```

- [ ] **Step 2: Write MoveRow**

Create `apexflow/frontend/src/editor/MoveRow.tsx`:

```tsx
// One move, rendered as a sentence with the existing composer one click
// away. The escape hatch is not a fallback for bad UI — it is the design's
// stated contract: "every move carries an 'Edit as advanced' control that
// opens today's GuardEffectComposer unchanged", and an unrecognised
// primitive "degrades to the raw view rather than being hidden or dropped".
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import GuardEffectComposer from './GuardEffectComposer.tsx';
import type { SourceGroup } from './ShowIfBuilder.tsx';
import { describePrimitive } from './stage/phrases.ts';
import { actorsFor, roleGuardFor, NEW_ORDER } from './stage/write.ts';
import type { MoveGroup, Stage, Who } from './stage/types.ts';
import type {
  EntityModelsMap,
  PrimitivesCatalog,
  StateDef,
} from '../types/designer.ts';
import './editor.css';

interface MoveRowProps {
  group: MoveGroup;
  stages: Stage[];
  states: StateDef[];
  primitives: PrimitivesCatalog | null;
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  onChange: (next: MoveGroup) => void;
  onRemove: () => void;
}

const WHO_OPTIONS: Who[] = ['family', 'staff', 'both', 'automatic'];

export default function MoveRow({
  group,
  stages,
  states,
  primitives,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  onChange,
  onRemove,
}: MoveRowProps) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const targetName = stages.find((s) => s.stage_id === group.to)?.name || group.to;

  /**
   * Changing "Who can do it" rewrites the group's members: the actor set is
   * recomputed from `who`, and each member's `roleGuard` is regenerated ONLY
   * if it already had one. A member that was authored without an actor_role
   * guard keeps none — adding one would turn a structurally-unguarded
   * transition into a guarded one and change how validate.py reads its whole
   * (from, action) group.
   */
  function setWho(who: Who) {
    const actors = actorsFor(who);
    const froms = [...new Set(group.members.map((m) => m.from))];
    const hadRoleGuard = group.members.some((m) => m.roleGuard !== null) || actors.length > 1;
    const members = froms.flatMap((from) =>
      actors.map((actor) => {
        const existing = group.members.find((m) => m.from === from && m.actor === actor);
        if (existing) {
          return { ...existing, roleGuard: hadRoleGuard ? roleGuardFor(actor) : null };
        }
        return {
          transition_id: `t_${group.action}_${from}_${actor}`,
          from,
          actor,
          roleGuard: hadRoleGuard ? roleGuardFor(actor) : null,
          order: NEW_ORDER,
        };
      }),
    );
    onChange({ ...group, who, members });
  }

  return (
    <li className="move-row">
      <div className="move-row-sentence">
        <select
          className="move-row-who"
          aria-label={t('editor.move.whoLabel')}
          value={group.who}
          disabled={readOnly}
          onChange={(e) => setWho(e.target.value as Who)}
        >
          {WHO_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {t(`editor.move.who.${w}`)}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="move-row-action"
          aria-label={t('editor.move.actionLabel')}
          value={group.action}
          disabled={readOnly}
          onChange={(e) => onChange({ ...group, action: e.target.value })}
        />
        <select
          className="move-row-target"
          aria-label={t('editor.move.goesTo').replace('{stage}', '')}
          value={group.to}
          disabled={readOnly}
          onChange={(e) => onChange({ ...group, to: e.target.value })}
        >
          {stages.map((s) => (
            <option key={s.stage_id} value={s.stage_id}>
              {s.name || s.stage_id}
            </option>
          ))}
        </select>
        <span className="move-row-target-label">
          {t('editor.move.goesTo').replace('{stage}', targetName)}
        </span>
      </div>

      {group.guards.length > 0 && (
        <p className="move-row-clause">
          <span className="move-row-clause-label">{t('editor.move.onlyWhen')}</span>{' '}
          {group.guards.map((g) => describePrimitive(g, t)).join('; ')}
        </p>
      )}
      {group.effects.length > 0 && (
        <p className="move-row-clause">
          <span className="move-row-clause-label">{t('editor.move.thenWhat')}</span>{' '}
          {group.effects.map((e) => describePrimitive(e, t)).join('; ')}
        </p>
      )}

      <div className="move-row-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? t('editor.move.advancedDone') : t('editor.move.advanced')}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={readOnly}
          onClick={onRemove}
        >
          {t('editor.move.remove')}
        </button>
      </div>

      {advanced && primitives && (
        <div className="move-row-advanced">
          <GuardEffectComposer
            kindLabel="guard"
            refs={group.guards}
            primitives={primitives.guards}
            models={models}
            states={states}
            declaredSectionIds={declaredSectionIds}
            declaredStepIds={declaredStepIds}
            sourceGroups={sourceGroups}
            readOnly={readOnly}
            onChange={(next) => onChange({ ...group, guards: next })}
          />
          <GuardEffectComposer
            kindLabel="effect"
            refs={group.effects}
            primitives={primitives.effects}
            models={models}
            states={states}
            declaredSectionIds={declaredSectionIds}
            declaredStepIds={declaredStepIds}
            sourceGroups={sourceGroups}
            readOnly={readOnly}
            onChange={(next) => onChange({ ...group, effects: next })}
          />
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Wire MoveRow into StageEditor**

First extract the picker menus into a real module rather than copying them out of `MachineEditor.tsx`. Create `apexflow/frontend/src/editor/stage/sources.ts`:

```ts
// The three picker menus GuardEffectComposer needs: declared section ids
// (`commit_sections.section_ids`), declared step ids (`start_due_clocks`,
// `items_in_status`), and the `{section_id}.{field}` source groups a
// `data_condition` guard's ShowIfBuilder offers.
//
// These existed as module-private helpers in MachineEditor.tsx, which Task 10
// deletes. They are a real module now rather than a copy: StepEditor.tsx has
// its own `buildSourceGroups` for step `show_if`, and having a third copy
// appear alongside the one that is about to be deleted is exactly the
// duplication a reviewer should reject.
import type { SourceGroup } from '../ShowIfBuilder.tsx';
import type { WorkflowSectionDef, WorkflowStepDef } from '../../types/designer.ts';

function getSections(step: WorkflowStepDef): WorkflowSectionDef[] {
  const raw = step.config.sections;
  return Array.isArray(raw) ? (raw as WorkflowSectionDef[]) : [];
}

export function declaredSectionIds(steps: WorkflowStepDef[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of getSections(step)) {
      if (section.section_id) ids.push(section.section_id);
    }
  }
  return ids;
}

export function declaredStepIds(steps: WorkflowStepDef[]): string[] {
  return steps.map((s) => s.step_id);
}

export function buildSourceGroups(steps: WorkflowStepDef[], contextLabel: string): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of getSections(step)) {
      if (!section.entity_model || section.fields.length === 0) continue;
      groups.push({
        label: section.section_id,
        options: section.fields.map((f) => ({
          value: `${section.section_id}.${f.name}`,
          label: `${section.section_id}.${f.name}`,
        })),
      });
    }
  }
  groups.push({
    label: contextLabel,
    options: [{ value: 'context.school_year', label: 'context.school_year' }],
  });
  return groups;
}
```

> This is behaviour-preserving: it is what `MachineEditor.tsx:65-110` does today, including the hardcoded `context.school_year` option. That option is wrong for the signup template, whose context key is `program_id` — **leave it wrong here.** Widening it is a behaviour change that belongs in its own task with its own test, not smuggled into an extraction. Log it as a deferred minor.

Then in `StageEditor.tsx`: import those three helpers, load the primitives catalog with the same one-fetch-per-tenant effect `MachineEditor.tsx:122-137` uses (the catalog is auth-scoped per tenant but its content is static, so a single fetch per mount is enough), and replace `renderMoves={() => null}` with:

```tsx
              renderMoves={(moves) => (
                <ul className="move-rows">
                  {moves.map((move) => (
                    <MoveRow
                      key={move.key}
                      group={move}
                      stages={model.stages}
                      states={machine.states}
                      primitives={primitives}
                      models={models}
                      declaredSectionIds={sectionIds}
                      declaredStepIds={stepIds}
                      sourceGroups={sourceGroups}
                      readOnly={readOnly}
                      onChange={(next) =>
                        commit({
                          ...model,
                          groups: model.groups.map((g) => (g.key === move.key ? next : g)),
                        })
                      }
                      onRemove={() =>
                        commit({ ...model, groups: model.groups.filter((g) => g.key !== move.key) })
                      }
                    />
                  ))}
                </ul>
              )}
```

- [ ] **Step 4: Test the who-change logic**

Create `apexflow/frontend/src/editor/stage/__tests__/who.test.ts` — the `setWho` rule extracted so it is testable without React. Move the body of `MoveRow`'s `setWho` into an exported helper in `write.ts` and call it from both:

Add to `write.ts`:

```ts
/**
 * Recompute a group's members for a new `who`.
 *
 * Rule: regenerate `roleGuard` only when the group ALREADY had one, or when
 * the new `who` is a multi-actor pair (which cannot be expressed without
 * one, since `_unguarded_branch_errors` allows at most one unguarded
 * transition per (from, action) group). A single-actor group that was
 * authored without an actor_role guard keeps none.
 */
export function membersForWho(group: MoveGroup, who: Who): MoveMember[] {
  const actors = actorsFor(who);
  const froms = [...new Set(group.members.map((m) => m.from))];
  const needsRoleGuard = group.members.some((m) => m.roleGuard !== null) || actors.length > 1;
  return froms.flatMap((from) =>
    actors.map((actor) => {
      const existing = group.members.find((m) => m.from === from && m.actor === actor);
      if (existing) return { ...existing, roleGuard: needsRoleGuard ? roleGuardFor(actor) : null };
      return {
        transition_id: `t_${group.action}_${from}_${actor}`,
        from,
        actor,
        roleGuard: needsRoleGuard ? roleGuardFor(actor) : null,
        order: NEW_ORDER,
      };
    }),
  );
}
```

and replace `MoveRow`'s whole `setWho` function with:

```tsx
  function setWho(who: Who) {
    onChange({ ...group, who, members: membersForWho(group, who) });
  }
```

Then fix `MoveRow`'s imports — `actorsFor`, `roleGuardFor`, and `NEW_ORDER` are now unused and `npm run lint` will fail on them:

```tsx
import { membersForWho } from './stage/write.ts';
```

Create `apexflow/frontend/src/editor/stage/__tests__/who.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { membersForWho } from '../write.ts';
import { readStageModel } from '../read.ts';
import { SIGNUP_MACHINE, SIGNUP_STEPS } from './fixtures.ts';

const model = readStageModel(SIGNUP_MACHINE, SIGNUP_STEPS);
const offerSpot = model.groups.find((g) => g.action === 'offer_spot')!;
const drop = model.groups.find((g) => g.action === 'drop')!;

describe('membersForWho', () => {
  it('does not add an actor_role guard to a group that never had one', () => {
    const next = membersForWho(offerSpot, 'family');
    expect(next).toHaveLength(1);
    expect(next[0].roleGuard).toBeNull();
    expect(next[0].actor).toBe('family');
  });

  it('adds the pair’s actor_role guards when widening to both', () => {
    const next = membersForWho(offerSpot, 'both');
    expect(next.map((m) => m.actor).sort()).toEqual(['family', 'staff']);
    expect(next.map((m) => m.roleGuard?.params)).toEqual(
      expect.arrayContaining([{ roles: ['family'] }, { roles: ['staff', 'admin'] }]),
    );
  });

  it('preserves the existing transition_id when the actor is unchanged', () => {
    const next = membersForWho(drop, 'both');
    expect(next.map((m) => m.transition_id).sort()).toEqual(
      drop.members.map((m) => m.transition_id).sort(),
    );
  });

  it('narrowing to one actor keeps that actor’s existing rows', () => {
    const next = membersForWho(drop, 'staff');
    expect(next.every((m) => m.actor === 'staff')).toBe(true);
    expect(next.every((m) => m.transition_id.endsWith('_staff'))).toBe(true);
  });

  it('a who change that changes nothing round-trips the machine untouched', () => {
    const unchanged = { ...model, groups: model.groups.map((g) => ({ ...g, members: membersForWho(g, g.who) })) };
    expect(unchanged.groups.flatMap((g) => g.members.map((m) => m.transition_id)).sort()).toEqual(
      SIGNUP_MACHINE.transitions.map((t) => t.transition_id).sort(),
    );
  });
});
```

- [ ] **Step 5: Run, mutate, revert**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS.

Mutation 1: in `membersForWho`, change `needsRoleGuard` to `true`.
Expected: FAIL — `does not add an actor_role guard to a group that never had one`.

Mutation 2: in `membersForWho`, always mint a new id (delete the `if (existing) return …` line).
Expected: FAIL — `preserves the existing transition_id when the actor is unchanged` **and** `a who change that changes nothing round-trips the machine untouched`.

Revert both. Expected: PASS.

- [ ] **Step 6: Build, lint, verify, commit**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`

Open the enrollment definition. Confirm on the `In Review` stage: `approve` reads "Staff / approve / goes to Approved" with "And then creates the records from the form; records the decision on the application; starts the document due dates; emails the family"; `flag_pending_items` reads "Automatically"; "Edit as advanced" opens the unchanged `GuardEffectComposer` and a change made there is reflected in the sentence when closed.

```bash
git add apexflow/frontend/src/editor apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): moves read as sentences, composer one click away

Who/what/where is one line; guards and effects render through the
allowlist-guarded phrase table and fall back to the raw primitive with its
params rather than being hidden. 'Edit as advanced' opens the existing
GuardEffectComposer unchanged.

The 'Who can do it' control writes both `actor` and the actor_role guard so
they cannot drift — but only regenerates the guard when the group already
had one, or when widening to a family/staff pair. Adding one to a
previously-unguarded transition would change how _unguarded_branch_errors
reads its whole (from, action) group; membersForWho is tested for exactly
that."
```

---

## Task 9: The Exits panel

**Files:**
- Create: `apexflow/frontend/src/editor/ExitsPanel.tsx`
- Modify: `apexflow/frontend/src/editor/StageEditor.tsx`, `translations.ts`, `editor.css`
- Modify: `apexflow/frontend/src/editor/stage/write.ts` (add `membersForScope`)
- Modify: `apexflow/frontend/src/editor/stage/__tests__/who.test.ts` → add scope tests

**Interfaces:**
- Consumes: everything Task 8 produced.
- Produces: `function membersForScope(group: MoveGroup, stageIds: string[]): MoveMember[]` in `write.ts`, and `<ExitsPanel model exits stages … onChange onAdd onRemove />`.

- [ ] **Step 1: Add the i18n keys**

Both locales:

```ts
    'editor.exit.scopeHeading': 'From which stages',   // zh-CN: '从哪些阶段'
    'editor.exit.scopeRule': 'Any stage before the finish', // zh-CN: '完成之前的任何阶段'
    'editor.exit.landsOn': 'Lands on',                 // zh-CN: '进入'
    'editor.exit.add': 'Add an exit',                  // zh-CN: '添加退出'
    'editor.exit.remove': 'Remove this exit',          // zh-CN: '删除此退出'
    'editor.exit.uncovered': '{n} stage(s) not covered by this rule', // zh-CN: '{n} 个阶段不在此规则范围内'
```

- [ ] **Step 2: Add `membersForScope` to `write.ts`**

```ts
/**
 * Recompute a group's members for a new set of source stages — the Exits
 * panel's scope control.
 *
 * A stage already in scope keeps its existing members verbatim, including
 * their `transition_id` and `order`. A stage added to scope gets one new
 * member per actor. A stage removed from scope loses its members entirely.
 *
 * This is what makes "one rule, expanded on save" safe to re-edit: unticking
 * a stage and re-ticking it does not silently renumber the transitions that
 * were never touched.
 */
export function membersForScope(group: MoveGroup, stageIds: string[]): MoveMember[] {
  const actors = actorsFor(group.who);
  const needsRoleGuard = group.members.some((m) => m.roleGuard !== null) || actors.length > 1;
  return stageIds.flatMap((from) =>
    actors.map((actor) => {
      const existing = group.members.find((m) => m.from === from && m.actor === actor);
      if (existing) return existing;
      return {
        transition_id: `t_${group.action}_${from}_${actor}`,
        from,
        actor,
        roleGuard: needsRoleGuard ? roleGuardFor(actor) : null,
        order: NEW_ORDER,
      };
    }),
  );
}
```

- [ ] **Step 3: Write the scope tests**

Append to `apexflow/frontend/src/editor/stage/__tests__/who.test.ts`:

```ts
import { membersForScope } from '../write.ts';
import { writeMachine } from '../write.ts';

describe('membersForScope', () => {
  it('re-scoping to the same stages changes nothing', () => {
    const same = membersForScope(drop, [...new Set(drop.members.map((m) => m.from))]);
    expect(same).toEqual(drop.members);
  });

  it('adding a stage adds one member per actor and touches nothing else', () => {
    const froms = [...new Set(drop.members.map((m) => m.from))];
    const next = membersForScope(drop, [...froms, 'completed']);
    expect(next).toHaveLength(drop.members.length + 2);
    const added = next.filter((m) => m.from === 'completed');
    expect(added.map((m) => m.actor).sort()).toEqual(['family', 'staff']);
    expect(next.filter((m) => m.from !== 'completed')).toEqual(drop.members);
  });

  it('removing a stage removes exactly its members', () => {
    const froms = [...new Set(drop.members.map((m) => m.from))].filter((f) => f !== 'draft');
    const next = membersForScope(drop, froms);
    expect(next.some((m) => m.from === 'draft')).toBe(false);
    expect(next).toHaveLength(drop.members.length - 2);
  });

  it('untick then re-tick restores the original machine exactly', () => {
    const froms = [...new Set(drop.members.map((m) => m.from))];
    const shrunk = { ...drop, members: membersForScope(drop, froms.filter((f) => f !== 'draft')) };
    const restored = { ...shrunk, members: membersForScope(shrunk, froms) };
    const model2 = { ...model, groups: model.groups.map((g) => (g.key === drop.key ? restored : g)) };
    const out = writeMachine(model2);
    // The re-added transitions are new members, so they land at the END of
    // the array rather than their original positions. Their CONTENT must
    // still match exactly — this asserts nothing was lost or altered.
    expect(out.transitions.map((t) => t.transition_id).sort()).toEqual(
      SIGNUP_MACHINE.transitions.map((t) => t.transition_id).sort(),
    );
    for (const before of SIGNUP_MACHINE.transitions) {
      const after = out.transitions.find((t) => t.transition_id === before.transition_id);
      expect(after).toEqual(before);
    }
  });
});
```

> The last test documents a real, accepted limitation: unticking and re-ticking a stage moves its transitions to the end of the array. That is safe here because both re-added transitions are `actor_role`-guarded, so `_unguarded_branch_errors`'s "unguarded must be last" rule is unaffected. If a future exit is authored unguarded, this reordering could matter — the test above is where that would surface.

- [ ] **Step 4: Write ExitsPanel**

Create `apexflow/frontend/src/editor/ExitsPanel.tsx`:

```tsx
// Cross-cutting exits, authored once as a rule.
//
// Scope is a rule with exceptions, not a checkbox list, for a failure that
// is invisible with a list: adding a Payment stage six months later silently
// leaves it un-exitable and nothing on screen looks wrong. The default reads
// "any stage before the finish" with every stage listed and ticked beneath
// it, plus a live expansion count and an explicit uncovered-stage count.
import { useTranslation } from '../hooks/useTranslation.ts';
import MoveRow from './MoveRow.tsx';
import { membersForScope } from './stage/write.ts';
import type { MoveGroup, Stage } from './stage/types.ts';
import type { EntityModelsMap, PrimitivesCatalog, StateDef } from '../types/designer.ts';
import type { SourceGroup } from './ShowIfBuilder.tsx';
import './editor.css';

interface ExitsPanelProps {
  exits: MoveGroup[];
  /** Every stage, in spine order — the scope list is derived from this
   * rather than passed in, so a stage added later is offered automatically.
   * That is the whole point of "a rule, not a checkbox list". */
  stages: Stage[];
  states: StateDef[];
  primitives: PrimitivesCatalog | null;
  models: EntityModelsMap;
  declaredSectionIds: string[];
  declaredStepIds: string[];
  sourceGroups: SourceGroup[];
  readOnly: boolean;
  onChange: (next: MoveGroup) => void;
  onRemove: (key: string) => void;
}

export default function ExitsPanel({
  exits,
  stages,
  states,
  primitives,
  models,
  declaredSectionIds,
  declaredStepIds,
  sourceGroups,
  readOnly,
  onChange,
  onRemove,
}: ExitsPanelProps) {
  const { t } = useTranslation();
  /** The stages the default rule covers: everything that is not terminal. */
  const ruleStages = stages.filter((s) => s.kind !== 'terminal');

  return (
    <section className="stage-exits">
      <h3>{t('editor.exits.heading')}</h3>
      {exits.length === 0 && <p className="stage-empty">{t('editor.exits.empty')}</p>}
      <ul className="stage-exit-cards">
        {exits.map((exit) => {
          const scope = new Set(exit.members.map((m) => m.from));
          const actors = new Set(exit.members.map((m) => m.actor)).size;
          const uncovered = ruleStages.filter((s) => !scope.has(s.stage_id)).length;
          return (
            <li key={exit.key} className="stage-exit-card">
              <ul className="move-rows">
                <MoveRow
                  group={exit}
                  stages={stages}
                  states={states}
                  primitives={primitives}
                  models={models}
                  declaredSectionIds={declaredSectionIds}
                  declaredStepIds={declaredStepIds}
                  sourceGroups={sourceGroups}
                  readOnly={readOnly}
                  onChange={onChange}
                  onRemove={() => onRemove(exit.key)}
                />
              </ul>

              <fieldset className="stage-exit-scope">
                <legend>{t('editor.exit.scopeHeading')}</legend>
                <p className="stage-exit-scope-rule">{t('editor.exit.scopeRule')}</p>
                {ruleStages.map((stage) => (
                  <label key={stage.stage_id} className="stage-exit-scope-option">
                    <input
                      type="checkbox"
                      checked={scope.has(stage.stage_id)}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...scope, stage.stage_id]
                          : [...scope].filter((id) => id !== stage.stage_id);
                        onChange({ ...exit, members: membersForScope(exit, next) });
                      }}
                    />
                    {stage.name || stage.stage_id}
                  </label>
                ))}
              </fieldset>

              <p className="stage-exit-expansion">
                {t('editor.exits.expansion')
                  .replace('{t}', String(exit.members.length))
                  .replace('{s}', String(scope.size))
                  .replace('{a}', String(actors))}
                {uncovered > 0 && (
                  <>
                    {' · '}
                    <span className="stage-exit-uncovered">
                      {t('editor.exit.uncovered').replace('{n}', String(uncovered))}
                    </span>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Replace StageEditor's inline exits section**

In `StageEditor.tsx`, replace the whole `<section className="stage-exits">…</section>` block with:

```tsx
      <ExitsPanel
        exits={exits}
        stages={model.stages}
        states={machine.states}
        primitives={primitives}
        models={models}
        declaredSectionIds={sectionIds}
        declaredStepIds={stepIds}
        sourceGroups={sourceGroups}
        readOnly={readOnly}
        onChange={(next) =>
          commit({ ...model, groups: model.groups.map((g) => (g.key === next.key ? next : g)) })
        }
        onRemove={(key) => commit({ ...model, groups: model.groups.filter((g) => g.key !== key) })}
      />
```

and add `import ExitsPanel from './ExitsPanel.tsx';`.

- [ ] **Step 6: Add the CSS**

Append to `editor.css`:

```css
.stage-exit-scope {
  border: none;
  margin: var(--space-3, 0.75rem) 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3, 0.75rem);
  align-items: center;
}
.stage-exit-scope legend {
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, #6b6b76);
}
.stage-exit-scope-rule {
  width: 100%;
  margin: 0;
  font-size: 0.875rem;
}
.stage-exit-scope-option {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
}
.stage-exit-uncovered {
  color: var(--color-warning-text, #8a5a00);
}
.move-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}
.move-row {
  border: 1px solid var(--color-border, #d7d7dc);
  border-radius: var(--radius-md, 8px);
  padding: var(--space-3, 0.75rem);
}
.move-row-sentence {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 0.5rem);
}
.move-row-clause {
  margin: var(--space-2, 0.5rem) 0 0;
  font-size: 0.875rem;
}
.move-row-clause-label {
  color: var(--color-text-muted, #6b6b76);
}
.move-row-actions {
  display: flex;
  gap: var(--space-2, 0.5rem);
  margin-top: var(--space-3, 0.75rem);
}
```

- [ ] **Step 7: Run, mutate, revert**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/stage`
Expected: PASS.

Mutation: in `membersForScope`, drop the `if (existing) return existing;` line so every member is regenerated.
Expected: FAIL — `re-scoping to the same stages changes nothing` (the `order` of every existing member becomes `NEW_ORDER`) **and** `adding a stage adds one member per actor and touches nothing else`.
Revert. Expected: PASS.

- [ ] **Step 8: Build, lint, verify, commit**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`

Open the enrollment definition. Confirm the `withdraw` exit reads `expands to 12 transition(s) · 6 stage(s) × 2 actor(s)` with `enrolled`/`declined`/`withdrawn` absent from the scope list (terminal) and every other stage ticked; the `decline` exit reads `2 transition(s) · 2 stage(s) × 1 actor(s)` and shows "4 stage(s) not covered by this rule". Untick `Approved` on `withdraw`, confirm the count drops to 10, re-tick it, confirm it returns to 12, save, reload, and confirm the machine is intact.

```bash
git add apexflow/frontend/src/editor apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): Exits panel — one rule, expanded on save

Enrollment's twelve withdraw transitions are one card with a live expansion
count. Scope is a rule with every stage listed beneath it, plus an explicit
uncovered-stage count, because the failure a plain checkbox list hides is a
stage added six months later that silently cannot be exited.

Re-scoping preserves the transition_id and declaration order of any stage
that was already in scope, so untick-then-retick does not renumber
transitions the author never touched."
```

---

## Task 10: Delete the Machine tab and verify the whole thing

**Files:**
- Delete: `apexflow/frontend/src/editor/MachineEditor.tsx`
- Delete: `apexflow/frontend/src/editor/TransitionPanel.tsx`
- Modify: `apexflow/frontend/src/i18n/translations.ts` (remove now-dead keys)
- Modify: `docs/superpowers/specs/2026-08-10-stage-centric-workflow-editor-design.md` (record the three amendments)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new. This task removes.

- [ ] **Step 1: Confirm nothing imports them**

Run: `cd apexflow/frontend && grep -rn "MachineEditor\|TransitionPanel" src/`
Expected: no matches outside the two files themselves. If `PreviewPane` or anything else still imports them, stop and rewire before deleting.

- [ ] **Step 2: Delete**

```bash
git rm apexflow/frontend/src/editor/MachineEditor.tsx apexflow/frontend/src/editor/TransitionPanel.tsx
```

- [ ] **Step 3: Remove the dead i18n keys**

Run: `cd apexflow/frontend && grep -o "'editor\.machine\.[a-zA-Z.]*'" src/i18n/translations.ts | sort -u`
For each key, run `grep -rn "<key>" src/ --exclude-dir=node_modules`. Delete from BOTH locale blocks every key with no remaining reference. Keep `editor.machine.state.demotedInitial` only if something still uses it.

Run: `cd apexflow/frontend && npx vitest run --no-cache src/i18n`
Expected: PASS — the parity test proves both locales were pruned identically.

- [ ] **Step 4: Record the amendments in the design spec**

Append to `docs/superpowers/specs/2026-08-10-stage-centric-workflow-editor-design.md`:

```markdown
## Amendments (2026-08-10, from the signup coverage test)

Ruled in `docs/superpowers/rulings/2026-08-10-stage-model-coverage-signup.md`
and implemented by `docs/superpowers/plans/2026-08-10-stage-centric-workflow-editor.md`.

**A. Terminal is derived from having no outgoing move, not from being last
on the spine.** The rule stated under "The stage model" — "the first stage
starts the workflow and the last finishes it" — is wrong for any workflow
with a resting stage. Signup's `confirmed` sits last on the spine and still
accepts `drop` and `complete_program`; marking it terminal makes
`machine.allowed_actions()` return `[]` and both moves vanish from the UI
while remaining fireable by a direct POST.

**B. Exit grouping keys on (action, target, actor, guards, effects) —
everything except `from`.** The key stated under "The stage model" and
"Migration" — "a set of transitions sharing an action and target" — cannot
round-trip signup's `drop` exit, whose eight transitions share an action and
a target but split into two effect shapes.

**C. The phrase-allowlist test is written before the phrase set.** The
design already calls for the test; signup showed the table was already
missing `issue_link`, which its `offer_spot` move uses.
```

- [ ] **Step 5: Full verification — every suite, in order**

```bash
cd workflow-forms && npm ci && npm test
cd ../apexflow/backend && find . -name __pycache__ -type d -not -path "./.venv/*" -exec rm -rf {} + ; uv run python -m pytest tests/ -q
cd ../../familyhub/backend && uv run python -m pytest tests/ -q
cd ../../admindash && uv run pytest backend/tests/ -q
cd ../datacore && uv run python -m pytest tests/ -v -q
cd ../admindash/frontend && npm test
cd ../../apexflow/frontend && npm test
```

Expected, at or above: workflow-forms **59** · apexflow backend **584** · familyhub **89** · admindash backend **201** · datacore **354** · admindash vitest **94** · apexflow vitest — whatever Task 9 left it at.

- [ ] **Step 6: Full verification — every frontend builds**

```bash
cd workflow-forms && npm ci
cd ../apexflow/frontend && npm run build && npm run lint
cd ../../admindash/frontend && npm run build && npm run lint
cd ../../familyhub/frontend && npm run build && npm run lint
cd ../../launchpad/frontend && npm run build && npm run lint
cd ../../papermite/frontend && npm run build && npm run lint
```

Expected: all builds succeed. `admindash npm run lint` reports its **5 pre-existing errors** (DynamicForm, AuthContext, DashboardContext, ModelContext) and no more — **report if a 6th appears**. Every other frontend reports 0 lint errors.

- [ ] **Step 7: End-to-end check against a real definition**

Start services (`./start-services.sh`), open the enrollment definition in the designer, make no edits, and wait for the save indicator to read "Saved". Then, from `apexflow/backend`:

```bash
uv run python -c "
import json
from app.workflows import datacore as dc
from app.templates import enrollment
rows = [r for r in dc.list_entities('acme', 'workflow_definition', '')
        if r.get('definition_id') == 'enrollment']
row = sorted(rows, key=lambda r: int(r.get('version') or 0))[-1]
saved = json.loads(row['machine'])
expected = enrollment.build_machine()
print('states equal:     ', saved['states'] == expected['states'])
print('transitions equal:', saved['transitions'] == expected['transitions'])
if saved['transitions'] != expected['transitions']:
    for a, b in zip(saved['transitions'], expected['transitions']):
        if a != b:
            print('FIRST DIFF:'); print(' saved   ', a); print(' expected', b); break
"
```

Expected: both `True`. This is the round-trip property proved against the real stack rather than a fixture — if it fails, the bug is in `read.ts`/`write.ts` and belongs in `roundTrip.test.ts` first.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(apexflow): delete the Machine tab

One editor, one model, no drift — the design's Decision 3, now that the
signup coverage test has confirmed the stage abstraction holds and the three
amendments it produced are implemented.

Verified: enrollment opened in the stage editor and saved with no edits
produces a byte-identical machine on a live tenant, not just in a fixture.
All suites at or above baseline; five frontends build clean; admindash's
five pre-existing lint errors are unchanged and no sixth appeared."
```

---

---

## Task 11: Restore the authoring controls the Machine tab had

**Why this task exists, stated plainly:** the plan's original self-review claimed *"Never a blank canvas; adding a stage moves toward valid — already landed (`6a8375d`, `cadd3b8`); Task 7 preserves it."* **That was wrong.** Task 7 preserved nothing of the sort — `newState()` lived in `MachineEditor.tsx`, which Task 10 deleted. On the branch before this task, the stage editor can rename a stage and edit or delete things that already exist, and nothing else. It cannot add a stage, remove a stage, add a move, or add an exit. The old Machine tab could do all four, so this is a regression against what shipped, and it makes the design's "building from scratch is supported but not optimized" false.

No task brief ever mentioned these controls, which is why nine per-task reviews did not catch it.

**Files:**
- Create: `apexflow/frontend/src/editor/stageOps.ts`
- Create: `apexflow/frontend/src/editor/__tests__/stageOps.test.ts`
- Modify: `apexflow/frontend/src/editor/StageEditor.tsx`, `StageCard.tsx`, `ExitsPanel.tsx`
- Modify: `apexflow/frontend/src/i18n/translations.ts`, `apexflow/frontend/src/editor/editor.css`

**Interfaces:**
- Consumes: `Stage`, `MoveGroup`, `MoveMember`, `StageModel`, `Who` from `./stage/types.ts`; `NEW_ORDER`, `NEW_STAGE_INDEX`, `roleGuardFor`, `actorsFor` from `./stage/write.ts`; `isExitGroup` from `./stage/read.ts`.
- Produces, all pure and all exported from `stageOps.ts`:
  - `function newStage(existing: Stage[]): Stage`
  - `function addStage(model: StageModel): StageModel`
  - `function removeStage(model: StageModel, stageId: string, steps: WorkflowStepDef[]): { model: StageModel; steps: WorkflowStepDef[] }`
  - `function addMove(model: StageModel, fromStageId: string): StageModel`
  - `function addExit(model: StageModel): StageModel`
  - `function canAddExit(model: StageModel): boolean`

**The rules these helpers must implement**

1. **`newStage` fills the missing role.** Kind is `initial` if the machine has none, else `terminal` if it has none, else `active` — the exact rule from commit `cadd3b8`, whose message records why: hardcoding `active` made "Add state" *raise* the error count, because a new workflow already reports "no initial state"/"no terminal state" and an `active` addition leaves both standing while adding "non-terminal but has no outgoing transition". Adding a stage must move the machine toward valid. `declaredIndex` is `NEW_STAGE_INDEX`, `step_ids` is `[]`, `name` is `''`, and `stage_id` is a fresh unique id.

2. **`removeStage` removes what cannot survive without the stage.** The stage itself; every group member whose `from` is that stage; every group whose `to` is that stage (those transitions would otherwise dangle and fail `_state_ref_errors` at publish); any group left with zero members; and the stage id from every step's `available_in`. It returns both the model and the updated steps because both change.

3. **`addMove` adds one move out of a stage.** Default `who: 'staff'`, `guards: []`, `effects: []`, a single member with `order: NEW_ORDER` and `roleGuard: null` — a new transition must not acquire an `actor_role` guard it was not authored with. Target defaults to the next stage in model order after the source, or the finish stage if the source is last. Action defaults to a name not already used by another group leaving that stage, so the new move cannot collide into an existing `(from, action)` group and disturb its unguarded-last ordering.

4. **`addExit` adds one cross-cutting exit rule.** `who: 'both'`, target the first terminal stage that is not the finish, one family/staff member pair per non-terminal stage, each carrying `roleGuardFor(actor)` (a pair cannot be expressed without one), all at `order: NEW_ORDER`. `canAddExit` is false when no non-finish terminal stage exists — the button must be disabled with an explanation rather than producing an invalid machine.

- [ ] **Step 1: Add the i18n keys**

Both locale blocks:

```ts
    'editor.stages.addStage': 'Add a stage',                       // zh-CN: '添加阶段'
    'editor.stage.removeStage': 'Delete this stage',               // zh-CN: '删除此阶段'
    'editor.stage.removeStageWarn': 'Deletes {n} move(s) that start or end here.', // zh-CN: '将删除 {n} 个以此为起点或终点的流转。'
    'editor.stage.addMove': 'Add a move out of this stage',        // zh-CN: '添加从此阶段出发的流转'
    'editor.exit.addExit': 'Add an exit',                          // zh-CN: '添加退出'
    'editor.exit.needsTerminal': 'Add a finishing stage before adding an exit.', // zh-CN: '请先添加结束阶段，然后再添加退出。'
```

Also fix the stale copy this project made wrong. `editor.step.noStates` currently reads "No stages yet. Open the Machine tab and add at least a starting stage and a finishing stage — then come back and tick where this step appears." The Machine tab no longer exists, and the `available_in` grid it refers to is hidden. It is rendered live by `PreviewPane.tsx:134`. Replace in both locales:

```ts
    'editor.step.noStates': 'No stages yet. Add a starting stage and a finishing stage before this workflow can run.',
    // zh-CN: '尚无阶段。请先添加一个起始阶段和一个结束阶段，此工作流才能运行。'
```

- [ ] **Step 2: Write the failing tests**

Create `apexflow/frontend/src/editor/__tests__/stageOps.test.ts`. Cover, at minimum:

- `newStage` returns `initial` for an empty machine, `terminal` when an initial exists but no terminal, and `active` when both exist — the `cadd3b8` rule, asserted for all three branches.
- `addStage` on the signup fixture leaves every existing stage and every group untouched, and the new stage carries `NEW_STAGE_INDEX`.
- `removeStage` on signup's `offered`: the stage is gone; `t_offer_spot` (which targets it) is gone; `t_accept_offer`, `t_decline_offer`, `t_rescind_offer` and the `offered` drop pair (which leave it) are gone; every other transition is byte-identical; and no step retains `offered` in `available_in`.
- `removeStage` drops a group entirely when it loses its last member, and keeps a group that still has members from other stages — use signup's six-member `drop` group.
- `addMove` produces a member with `order === NEW_ORDER` and `roleGuard === null`, and its action does not equal any existing action leaving that stage.
- `addExit` on signup produces one member per non-terminal stage per actor, all with a role guard, and `canAddExit` is false for a model whose only terminal stage is the finish.
- Round-trip safety: for each helper, `writeMachine` of the result parses back through `readStageModel` to the same set of transition ids.

- [ ] **Step 3: Run them red**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor/__tests__/stageOps.test.ts`
Expected: FAIL — cannot resolve `../stageOps.ts`.

- [ ] **Step 4: Implement `stageOps.ts`**

Pure functions only, no React. Reuse `NEW_ORDER`/`NEW_STAGE_INDEX`/`roleGuardFor`/`actorsFor` from `./stage/write.ts` rather than re-deriving them. Do not modify anything under `src/editor/stage/`.

- [ ] **Step 5: Run them green**

Run: `cd apexflow/frontend && npx vitest run --no-cache src/editor`
Expected: PASS.

- [ ] **Step 6: Mutations — prove each helper's rule bites**

Run the suite after each, then revert:

1. In `newStage`, hardcode `kind: 'active'` — the exact pre-`cadd3b8` bug.
   Expected: FAIL on the initial-role and terminal-role assertions.
2. In `removeStage`, stop removing groups whose `to` is the removed stage.
   Expected: FAIL on the `t_offer_spot` assertion.
3. In `removeStage`, stop stripping the stage from steps' `available_in`.
   Expected: FAIL on the steps assertion.
4. In `addMove`, set `roleGuard: roleGuardFor(actor)` instead of `null`.
   Expected: FAIL on the `roleGuard === null` assertion.
5. In `addExit`, emit a single member instead of one per stage per actor.
   Expected: FAIL on the member-count assertion.

Revert all five, re-run green.

- [ ] **Step 7: Wire the controls**

- `StageEditor`: an "Add a stage" button above or below the stage list, calling `commit(addStage(model))`.
- `StageCard`: a "Delete this stage" button, showing the move count it will take via `editor.stage.removeStageWarn`, calling back into `StageEditor` so both model and steps commit together. Disable it when only one stage remains.
- `StageCard`: an "Add a move out of this stage" button calling `commit(addMove(model, stage.stage_id))`.
- `ExitsPanel`: an "Add an exit" button, disabled with `editor.exit.needsTerminal` when `canAddExit(model)` is false.

All four must respect `readOnly`.

- [ ] **Step 8: Build, lint, test**

Run: `cd workflow-forms && npm ci`
Run: `cd apexflow/frontend && npm run build && npm run lint && npm test`
Expected: build clean, 0 lint errors, test count above the previous 107.

- [ ] **Step 9: Live check**

Against the running app. Create a **new** workflow from the Workflows page (do not use the shipped enrollment draft for the destructive parts) and confirm on it: adding a stage yields a stage whose role fills what was missing and does not raise the validation-rail error count; adding a move out of a stage produces an editable move; adding an exit produces a card with every non-terminal stage ticked; deleting a stage removes its moves and leaves the rest intact. Then open the enrollment draft read-only and confirm it still renders nine stages and two exits unchanged. **Delete the scratch workflow you created**, and leave the enrollment draft byte-identical — verify by comparing stored JSON, not by eye.

- [ ] **Step 10: Commit**

```bash
git add apexflow/frontend/src/editor apexflow/frontend/src/i18n/translations.ts
git commit -m "feat(apexflow): restore add/remove stage and add move/exit

The stage editor could rename a stage and edit or delete what already
existed, and nothing else — MachineEditor.tsx carried Add state, Remove,
and the transition-adding UI, and Task 10 deleted it. That was a regression
against what shipped, and it made the design's from-scratch story false.

newStage reinstates commit cadd3b8's rule verbatim: a new stage fills
whichever role the machine is missing, so adding one moves the machine
toward valid instead of raising the error count.

The plan's own self-review claimed Task 7 preserved this. It did not, and
no task brief mentioned these controls, which is why nine per-task reviews
did not catch it."
```


## Self-Review

Run against the design spec plus the ruling's three amendments.

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| Stage = StateDef; first/last = kind | 3 (`readStageModel`), 4 (`writeMachine`), amended by A |
| Move = TransitionDef | 3, 8 |
| Who can do it writes `actor` **and** `actor_role` | 3 (`splitActorRole`), 8 (`membersForWho`) |
| Only when = guards; What happens = effects | 5, 8 |
| Steps in a stage = `available_in` | 3, 7 |
| Steps tab disappears | 6, 7 |
| Exit = transitions sharing an action and target | 3, amended by B |
| Exit's five things (name/who/from/only-when/lands-on) | 8 (`MoveRow`) + 9 (scope) |
| Scope as a rule with exceptions, live expansion count | 9 |
| Plain-language phrases for common primitives | 5 |
| Unrecognised primitive degrades to raw, never hidden | 5 (`describePrimitive` fallback + test) |
| "Edit as advanced" opens `GuardEffectComposer` unchanged | 8 |
| Phrase-or-allowlist test over `GUARDS`/`EFFECTS` | 5, amended by C |
| Never a blank canvas; adding a stage moves toward valid | Already landed (`6a8375d`, `cadd3b8`); Task 7 preserves it |
| Machine tab replaced outright | 6 (rewire), 10 (delete) |
| Existing definitions open with no data migration | 3, 4 |
| Round-trip: open + save with no edits ≡ same machine | **4** (fixtures) and **10 Step 7** (live) |
| Transitions that fit no group render as explicit moves | 4 (`hand-authored irregularities` test) |
| No engine/schema/validator changes | Global Constraints; no task touches `app/workflows/` |
| Coverage risk at n=1 | **1** (landed) |

No gaps. Out-of-scope items in the spec (crowd-sourced templates, new primitives, the AdminDash home page) have no task, correctly.

**2. Placeholder scan.** No "TBD", "implement later", "add error handling", or "similar to Task N". Every code step carries the code. Two steps deliberately describe a *conditional* branch rather than a single outcome — Task 3 Step 6's third spine mutation and Task 4 Step 5's `states` ordering — and both state exactly what to do in each case rather than leaving it open.

**3. Type consistency.** Checked across tasks:
- `MoveMember` fields (`transition_id`, `from`, `actor`, `roleGuard`, `order`) are identical in `types.ts` (Task 3), `read.ts` (Task 3), `write.ts` (Task 4), `membersForWho` (Task 8), and `membersForScope` (Task 9).
- `MoveGroup.key` is the grouping key string throughout; `StageEditor`, `MoveRow`, and `ExitsPanel` all match on `g.key === next.key`.
- `Who` is `'family' | 'staff' | 'both' | 'automatic'` in `types.ts`, `actorsFor` (Task 4), `WHO_OPTIONS` (Task 8), and the four `editor.move.who.*` i18n keys (Task 8) — four values, four keys.
- `Stage` carries `stage_id`/`name`/`kind`/`depth`/`step_ids`; `writeMachine` reads exactly `stage_id`/`name`/`kind`, and `StageCard`/`ExitsPanel` read `stage_id`/`name`/`kind`. `depth` is read only by `read.ts`'s own sort.
- `roleGuardFor(actor)` takes one argument in `write.ts` (Task 4) and is called with one in Tasks 8 and 9.
- `describePrimitive(ref, t)` is defined in Task 5 and called with two arguments in Task 8.
- `NEW_ORDER` is exported from `write.ts` (Task 4) and imported by `membersForWho` (Task 8) and `membersForScope` (Task 9). Task 8 Step 4 removes it from `MoveRow`'s imports once the logic moves into `write.ts`.
- `spine.ts` exports `stageDepths`, `finishStageId`, `orderStages`; `read.ts` imports only `finishStageId` and `orderStages`.
- `ExitsPanel` does not take `finishStageId` — its scope list is derived from `stages`, so a stage added later is offered automatically.

**4. What this review changed.** Recorded because the errors were the kind that survive a read-through:

- **Both spine orders were wrong.** Hand-derived expectations for `orderStages` did not match what the algorithm produces for either template. Corrected by running the algorithm over the real `build_machine()` output rather than reasoning about it. Every order and depth in this plan is now computed, not asserted.
- **The correction exposed a real design flaw.** Pure BFS ordering puts enrollment's `withdrawn` third of nine stages, between `waitlisted` and `in_review`, because it is one hop from `draft`. `orderStages` now demotes every terminal stage except the finish, and `spine.test.ts` pins it with a named test.
- **One mutation would have been recorded as a bite that never happened.** `const deeper = false;` in `finishStageId` leaves `terminals[0]` as the answer, and both shipped templates happen to declare their finish stage first — so it passes. Replaced with a mutation that actually fails, and the trap is written into the step so nobody re-derives it.
- **Three lint failures were designed in.** `readOnly` unused in Task 6's `StageEditor`, three imports left dangling in Task 8's `MoveRow`, and an unused `finishStageId` prop on Task 9's `ExitsPanel`. All fixed at their source rather than papered over with a dead expression.
- **The enrollment fixture was needed a task earlier than it was created.** Moved into Task 3 Step 2; Task 4 Step 1 now verifies rather than duplicates.
