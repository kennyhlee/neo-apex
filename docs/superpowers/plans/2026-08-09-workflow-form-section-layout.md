# Workflow Form Section Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give workflow form sections a human title and a markdown description, and render them through per-surface layouts — a completion-aware accordion for parents, a section rail for staff — so a 40-field form stops reading as one undifferentiated wall.

**Architecture:** `SectionDef` gains two defaulted string fields, validated at publish time. In `flow-runtime`, a shared `SectionShell` wraps every section in `fieldset`/`legend` (the actual accessibility fix), and two layout components consume it — `AccordionSections` for `family`/`preview`/narrow-`staff`, `RailSections` for wide `staff`. A pure `sectionCompletion` module drives both layouts' progress indicators so they cannot disagree. Descriptions render limited markdown through a single hardened wrapper around `markdown-to-jsx`.

**Tech Stack:** Python 3.11+/pydantic v2/FastAPI/pytest; React 19 + TypeScript in `flow-runtime`; `markdown-to-jsx` 9.10; vitest (new to `flow-runtime`, existing in admindash).

**Spec:** `docs/superpowers/specs/2026-08-09-workflow-form-section-layout-design.md`

## Global Constraints

- **Branch:** work on `docs/form-section-layout`, already cut from `feat/item-status-typing`. Do **not** rebase onto `main` — it lacks both the Plan 3 merge and the item-status work whose files this touches.
- **Both new schema fields default to `""`.** Never make `title` or `description` required. A stored definition without them must keep validating, publishing, and reading healthy.
- **`fieldset`/`legend` in every layout.** The visual treatment is not the fix; the grouping semantics are. A layout that drops `SectionShell` reintroduces the bug.
- **`markdown-to-jsx` is imported in exactly ONE file** — `flow-runtime/src/SectionDescription.tsx`. It is unsafe with default options. A second call site is an XSS hole and Task 4 adds a test that fails on one.
- **`dangerouslySetInnerHTML` must never appear in `flow-runtime/src`.** Pinned by a test.
- **Link scheme allowlist is positive:** `http`, `https`, `mailto`. Not a deny-list. Enforced independently in the validator (publish time) and the renderer (render time).
- **Completion counts required fields only.** `false` is an answer; `undefined`/`null`/`""`/`[]` are not.
- **Draft keys are unchanged.** Non-repeat values at `"{section_id}.{field}"`, repeat rows at the bare `section_id` key. Never invent a new key shape — in-flight drafts depend on these.
- **Test baselines (must not regress):** apexflow **531**, familyhub **89**, admindash **201**, datacore **354**, admindash vitest **94**.
- Suite commands: `cd apexflow && uv run pytest backend/tests/ -q`; `cd familyhub && uv run pytest backend/tests/ -q`; `cd admindash && uv run pytest backend/tests/ -q`; `cd admindash/frontend && npx vitest run`; `cd flow-runtime && npm test` (exists from Task 3 onward).
- Frontend builds: `cd <module>/frontend && npm run build && npm run lint` for admindash, apexflow, familyhub. **Run `cd flow-runtime && npm ci` first** — a green local build can otherwise be an artifact of a stray `~/node_modules`.
- **admindash `npm run lint` reports 5 pre-existing errors** (`DynamicForm.tsx`, `AuthContext.tsx`, `DashboardContext.tsx`, `ModelContext.tsx`). They are unrelated to this work and present on the base branch. Do not fix them; do not let them mask a *new* 6th error.
- Conventional commits; one task may make several.

---

### Task 1: Schema fields and publish-time validation

**Files:**
- Modify: `apexflow/backend/app/workflows/schema.py:193-200` (`SectionDef`)
- Modify: `apexflow/backend/app/workflows/validate.py` (new `_section_copy_errors`, wired into `validate_definition` at `:775-790`)
- Test: `apexflow/backend/tests/test_section_copy.py` (new)

**Interfaces:**
- Produces: `SectionDef.title: str = ""` and `SectionDef.description: str = ""`. `validate.py::_section_copy_errors(section_entries) -> list[str]`. Task 2 mirrors these two fields in TypeScript; Task 8 populates them in the enrollment template.

- [ ] **Step 1: Write the failing tests** — `apexflow/backend/tests/test_section_copy.py`:

```python
"""Section `title`/`description` — defaults, caps, and link-scheme validation."""
import pytest

from app.workflows.schema import SectionDef, StepDef
from app.workflows.validate import _SectionEntry, _section_copy_errors


def _section(**over) -> SectionDef:
    data = {
        "section_id": "student_section",
        "entity_model": "student",
        "fields": [{"name": "first_name", "required": True}],
        "mode": "create",
    }
    data.update(over)
    return SectionDef.model_validate(data)


def _step() -> StepDef:
    return StepDef(
        step_id="application_form", type="form", title="Application",
        required=True, blocking=True, available_in=["draft"], config={},
    )


def _entries(section: SectionDef) -> list:
    return [_SectionEntry(step=_step(), section=section)]


def test_title_and_description_default_to_empty():
    """Additive and backward compatible: a stored definition that predates
    these fields must still parse."""
    s = _section()
    assert s.title == ""
    assert s.description == ""


def test_title_and_description_round_trip():
    s = _section(title="Student Information", description="About your **child**.")
    assert s.title == "Student Information"
    assert s.description == "About your **child**."


def test_empty_copy_produces_no_errors():
    assert _section_copy_errors(_entries(_section())) == []


def test_title_over_80_chars_rejected():
    errors = _section_copy_errors(_entries(_section(title="x" * 81)))
    assert any("student_section" in e and "title" in e for e in errors)


def test_description_over_600_chars_rejected():
    errors = _section_copy_errors(_entries(_section(description="x" * 601)))
    assert any("student_section" in e and "description" in e for e in errors)


@pytest.mark.parametrize("url", [
    "https://school.example.com/handbook.pdf",
    "http://school.example.com",
    "mailto:office@school.example.com",
])
def test_allowed_link_schemes_accepted(url):
    d = f"Read the [handbook]({url}) first."
    assert _section_copy_errors(_entries(_section(description=d))) == []


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "vbscript:msgbox(1)",
    "ftp://files.example.com/x",
])
def test_disallowed_link_schemes_rejected(url):
    d = f"Read the [handbook]({url}) first."
    errors = _section_copy_errors(_entries(_section(description=d)))
    assert any("student_section" in e for e in errors), errors


def test_link_scheme_check_is_case_insensitive():
    d = "Click [here](JaVaScRiPt:alert(1))."
    assert _section_copy_errors(_entries(_section(description=d))) != []


def test_plain_text_description_without_links_is_fine():
    d = "Tell us about the child you're enrolling."
    assert _section_copy_errors(_entries(_section(description=d))) == []
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_section_copy.py -q`
Expected: FAIL — `ImportError: cannot import name '_section_copy_errors'`.

- [ ] **Step 3: Add the two schema fields.** In `schema.py`, `SectionDef` becomes:

```python
class SectionDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    section_id: str
    entity_model: str
    # Display copy. Both default to "" so every stored definition that
    # predates them keeps parsing, validating, and publishing untouched --
    # the renderer falls back to a humanized section_id when title is blank.
    title: str = ""
    description: str = ""      # limited markdown: bold, italic, links
    fields: list[FieldPick]
    mode: Literal["create", "match_or_create"]
    repeat: RepeatSpec | None = None
```

- [ ] **Step 4: Add the validator.** In `validate.py`, after `_engine_owned_field_errors`:

```python
# Markdown inline-link form: [text](target). Matches the same construct the
# renderer parses, so publish-time and render-time agree on what a link is.
_MD_LINK_R = re.compile(r"\[[^\]]*\]\(([^)\s]+)")

# Positive allowlist, not a deny-list: an unlisted scheme is rejected rather
# than a listed-bad one blocked (spec "Publish-time validation").
_ALLOWED_LINK_SCHEMES = ("http://", "https://", "mailto:")

SECTION_TITLE_MAX = 80
SECTION_DESCRIPTION_MAX = 600


def _section_copy_errors(section_entries: list[_SectionEntry]) -> list[str]:
    """Length caps on a section's display copy, plus a scheme allowlist for
    every markdown link in its description.

    The description is rendered to PARENTS, so a hostile link target is a
    phishing vector. `SectionDescription.tsx` enforces the same allowlist at
    render time; this check is defence in depth, catching the bad value when
    it is authored rather than only when it is shown."""
    errors: list[str] = []
    for entry in section_entries:
        section = entry.section
        if len(section.title) > SECTION_TITLE_MAX:
            errors.append(
                f"section '{section.section_id}' title is "
                f"{len(section.title)} characters; max {SECTION_TITLE_MAX}"
            )
        if len(section.description) > SECTION_DESCRIPTION_MAX:
            errors.append(
                f"section '{section.section_id}' description is "
                f"{len(section.description)} characters; max {SECTION_DESCRIPTION_MAX}"
            )
        for target in _MD_LINK_R.findall(section.description):
            if not target.lower().startswith(_ALLOWED_LINK_SCHEMES):
                errors.append(
                    f"section '{section.section_id}' description has a link to "
                    f"{target!r}; only http, https, and mailto targets are allowed"
                )
    return errors
```

Add `import re` at the top of `validate.py` if absent, then wire it into `validate_definition` beside the other section checks:

```python
    errors += _engine_owned_field_errors(section_entries)
    errors += _section_copy_errors(section_entries)
```

- [ ] **Step 5: Run the new test file**

Run: `cd apexflow && uv run pytest backend/tests/test_section_copy.py -q`
Expected: PASS — 14 tests (the two parametrized cases expand to 3 and 4).

- [ ] **Step 6: Full apexflow suite**

Run: `cd apexflow && uv run pytest backend/tests/ -q`
Expected: 531 prior + 14 new = **545 passing**. If an existing validator test fails, a fixture is asserting an exact error-list length — update that fixture, do not weaken the validator.

- [ ] **Step 7: Commit**

```bash
git add apexflow/backend/app/workflows/schema.py apexflow/backend/app/workflows/validate.py apexflow/backend/tests/test_section_copy.py
git commit -m "feat(apexflow): section title/description with publish-time caps and link-scheme allowlist"
```

---

### Task 2: TypeScript mirror and title fallback

**Files:**
- Modify: `flow-runtime/src/types.ts:89-95` (`WorkflowSectionDef`)
- Create: `flow-runtime/src/sectionTitle.ts`

**Interfaces:**
- Consumes: the schema shape from Task 1.
- Produces: `WorkflowSectionDef.title?: string`, `.description?: string`; `displayTitle(section: WorkflowSectionDef): string` and `humanizeSectionId(id: string): string` from `flow-runtime/src/sectionTitle.ts`. Tasks 5, 6, and 7 all call `displayTitle`. Tested in Task 3 once vitest exists.

- [ ] **Step 1: Add the two optional properties** to `flow-runtime/src/types.ts`:

```ts
export interface WorkflowSectionDef {
  section_id: string;
  entity_model: string;
  /** Display heading. Blank/absent -> humanized section_id (see sectionTitle.ts). */
  title?: string;
  /** Limited markdown: bold, italic, links. Rendered ONLY via SectionDescription. */
  description?: string;
  fields: FieldPick[];
  mode: 'create' | 'match_or_create';
  repeat?: RepeatSpec | null;
}
```

Both are optional, so every existing consumer compiles unchanged.

- [ ] **Step 2: Create `flow-runtime/src/sectionTitle.ts`:**

```ts
// flow-runtime/src/sectionTitle.ts
import type { WorkflowSectionDef } from './types';

/**
 * `student_section` -> `Student`. Strips a trailing `_section` (every
 * authored section_id in the enrollment template carries it), swaps
 * underscores for spaces, and capitalizes the first letter.
 *
 * This is the fallback that lets a definition authored before section copy
 * existed still render a meaningful heading with no admin edit.
 */
export function humanizeSectionId(id: string): string {
  const words = id.replace(/_section$/, '').replace(/_/g, ' ').trim();
  if (words === '') return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The heading every layout renders for a section. */
export function displayTitle(section: WorkflowSectionDef): string {
  const authored = (section.title ?? '').trim();
  return authored !== '' ? authored : humanizeSectionId(section.section_id);
}
```

- [ ] **Step 3: Export both from the barrel.** Append to `flow-runtime/src/index.ts`:

```ts
export * from './sectionTitle';
```

- [ ] **Step 4: Typecheck**

```bash
cd flow-runtime && npm ci && npx tsc -b
```
Expected: clean, no output.

- [ ] **Step 5: Commit**

```bash
git add flow-runtime/src/types.ts flow-runtime/src/sectionTitle.ts flow-runtime/src/index.ts
git commit -m "feat(flow-runtime): section title/description types and humanized title fallback"
```

---

### Task 3: vitest in flow-runtime

This task adds the test runner the next three tasks depend on. It is deliberately separate so a reviewer can reject the tooling choice without rejecting the feature.

**Files:**
- Modify: `flow-runtime/package.json`
- Create: `flow-runtime/vitest.config.ts`
- Test: `flow-runtime/src/__tests__/sectionTitle.test.ts` (new — proves the runner works against real code)

**Interfaces:**
- Produces: `npm test` in `flow-runtime`. Tasks 4 and 5 add test files under `flow-runtime/src/__tests__/`.

- [ ] **Step 1: Install vitest**

```bash
cd flow-runtime && npm i -D vitest@^3 jsdom@^25 @testing-library/react@^16 react-dom@^19 @types/react-dom@^19
```

`jsdom` and `@testing-library/react` are needed by Task 4's component test.

**`react-dom` is not optional here.** npm auto-installs `react` because it is a
declared peer dependency, but `react-dom` is not declared anywhere in
`flow-runtime/package.json`, so it is absent after `npm ci` — verified. Without it
`@testing-library/react` cannot render and every component test fails to import. It goes
in `devDependencies`, never `dependencies`: the frontends supply their own React DOM at
runtime, and shipping a second copy would be a duplicate-React bug.

- [ ] **Step 2: Add the test script** to `flow-runtime/package.json`'s `scripts`:

```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
```

- [ ] **Step 3: Create `flow-runtime/vitest.config.ts`:**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom, not node: Task 4 renders a React component.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 4: Write a real test against Task 2's code** — `flow-runtime/src/__tests__/sectionTitle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { displayTitle, humanizeSectionId } from '../sectionTitle';
import type { WorkflowSectionDef } from '../types';

function section(over: Partial<WorkflowSectionDef> = {}): WorkflowSectionDef {
  return {
    section_id: 'student_section',
    entity_model: 'student',
    fields: [{ name: 'first_name', required: true }],
    mode: 'create',
    ...over,
  };
}

describe('humanizeSectionId', () => {
  it('strips a trailing _section and capitalizes', () => {
    expect(humanizeSectionId('student_section')).toBe('Student');
    expect(humanizeSectionId('contacts_section')).toBe('Contacts');
  });

  it('handles ids without the suffix', () => {
    expect(humanizeSectionId('emergency_contacts')).toBe('Emergency contacts');
  });

  it('falls back to the raw id when nothing is left', () => {
    expect(humanizeSectionId('_section')).toBe('_section');
  });
});

describe('displayTitle', () => {
  it('prefers an authored title', () => {
    expect(displayTitle(section({ title: 'Student Information' }))).toBe('Student Information');
  });

  it('falls back when the title is absent, blank, or whitespace', () => {
    expect(displayTitle(section())).toBe('Student');
    expect(displayTitle(section({ title: '' }))).toBe('Student');
    expect(displayTitle(section({ title: '   ' }))).toBe('Student');
  });
});
```

- [ ] **Step 5: Run it**

```bash
cd flow-runtime && npm test
```
Expected: **5 passing**.

- [ ] **Step 6: Confirm the frontends still build with the new devDeps**

```bash
cd flow-runtime && npm ci
cd ../familyhub/frontend && npm run build
cd ../../admindash/frontend && npm run build
```
Expected: both clean. (A devDependency must not reach a frontend bundle; if a build breaks here, vitest was added as a regular dependency by mistake.)

- [ ] **Step 7: Commit**

```bash
git add flow-runtime/package.json flow-runtime/package-lock.json flow-runtime/vitest.config.ts flow-runtime/src/__tests__/sectionTitle.test.ts
git commit -m "test(flow-runtime): add vitest; cover section title fallback"
```

---

### Task 4: `SectionDescription` — the single hardened markdown call site

**Files:**
- Create: `flow-runtime/src/SectionDescription.tsx`
- Test: `flow-runtime/src/__tests__/SectionDescription.test.tsx` (new)

**Interfaces:**
- Consumes: vitest from Task 3.
- Produces: `<SectionDescription markdown={string} />` — renders `null` for blank input. Tasks 5, 6, and 7 render descriptions **only** through this component.

- [ ] **Step 1: Install the dependency**

```bash
cd flow-runtime && npm i markdown-to-jsx@^9.10
```

This is flow-runtime's first runtime dependency. `deploy.yml` already runs `npm ci` in `flow-runtime` before every frontend build (`:325`, `:369`, `:409`), so no workflow change is needed.

- [ ] **Step 2: Write the failing tests** — `flow-runtime/src/__tests__/SectionDescription.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SectionDescription } from '../SectionDescription';

function html(markdown: string): string {
  return render(<SectionDescription markdown={markdown} />).container.innerHTML;
}

describe('SectionDescription rendering', () => {
  it('renders nothing for blank input', () => {
    expect(html('')).toBe('');
    expect(html('   ')).toBe('');
  });

  it('renders bold and italic', () => {
    expect(html('Tell us about your **child**.')).toContain('<strong>child</strong>');
    expect(html('Tell us about your *child*.')).toContain('<em>child</em>');
  });

  it('renders an allowed link with safe rel/target', () => {
    const out = html('[handbook](https://school.example.com/h.pdf)');
    expect(out).toContain('href="https://school.example.com/h.pdf"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('allows http and mailto', () => {
    expect(html('[a](http://x.example.com)')).toContain('href="http://x.example.com"');
    expect(html('[b](mailto:office@x.example.com)')).toContain('href="mailto:office@x.example.com"');
  });
});

describe('SectionDescription safety', () => {
  it('renders raw HTML as literal text, not elements', () => {
    const out = html('<img src=x onerror="alert(1)"> and <b>bold</b>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<b>');
  });

  it('drops disallowed link schemes rather than rendering an anchor', () => {
    for (const bad of [
      '[x](javascript:alert(1))',
      '[x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
      '[x](vbscript:msgbox(1))',
      '[x](ftp://files.example.com/a)',
    ]) {
      const out = html(bad);
      expect(out, bad).not.toContain('<a ');
      expect(out, bad).toContain('x');   // link TEXT survives as plain text
    }
  });

  it('is case-insensitive about schemes', () => {
    expect(html('[x](JaVaScRiPt:alert(1))')).not.toContain('<a ');
  });

  it('drops headings, images, and lists', () => {
    const out = html('# Heading\n\n![img](https://x.example.com/a.png)\n\n- one\n- two');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<ul');
  });
});

// --- structural guards: these are the enforcement mechanism, not decoration.
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('markdown containment', () => {
  const files = sourceFiles(join(__dirname, '..'));

  it('imports markdown-to-jsx in exactly one file', () => {
    const importers = files.filter((f) => readFileSync(f, 'utf8').includes('markdown-to-jsx'));
    expect(importers.map((f) => f.split('/').pop())).toEqual(['SectionDescription.tsx']);
  });

  it('never uses dangerouslySetInnerHTML anywhere in src', () => {
    const offenders = files.filter((f) =>
      readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'),
    );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `cd flow-runtime && npm test`
Expected: FAIL — cannot resolve `../SectionDescription`.

- [ ] **Step 4: Create `flow-runtime/src/SectionDescription.tsx`:**

```tsx
// flow-runtime/src/SectionDescription.tsx
//
// THE ONLY module in this package permitted to import `markdown-to-jsx`.
// `src/__tests__/SectionDescription.test.tsx` fails if a second file does.
//
// markdown-to-jsx is NOT safe with default options -- it parses raw HTML.
// Every option below is load-bearing; do not simplify this call.
import Markdown from 'markdown-to-jsx';

/** Positive allowlist. An unlisted scheme is not rendered as a link at all. */
const ALLOWED_SCHEMES = ['http://', 'https://', 'mailto:'];

/**
 * Replaces markdown-to-jsx's built-in sanitizer, which is a DENY-list
 * (`javascript:`/`vbscript:`/non-image `data:`) and deliberately permits
 * `data:image/svg+xml` -- a URL the library's own docs note can execute
 * script if opened as a top-level navigation. An allowlist closes that.
 *
 * Returning null makes markdown-to-jsx drop the attribute, so the anchor
 * degrades to plain text rather than becoming a live bad link.
 */
function sanitizer(value: string, _tag: string, _attr: string): string | null {
  const v = value.trim().toLowerCase();
  return ALLOWED_SCHEMES.some((s) => v.startsWith(s)) ? value : null;
}

const OPTIONS = {
  // Raw HTML renders as literal text instead of elements.
  disableParsingRawHTML: true,
  sanitizer,
  // Restrict output to inline emphasis + links. Headings, images, lists,
  // code blocks and tables are dropped: a section description is one short
  // orienting paragraph, not a document.
  overrides: {
    a: {
      props: { target: '_blank', rel: 'noopener noreferrer' },
    },
    h1: { component: 'p' },
    h2: { component: 'p' },
    h3: { component: 'p' },
    h4: { component: 'p' },
    h5: { component: 'p' },
    h6: { component: 'p' },
    img: { component: () => null },
    ul: { component: 'p' },
    ol: { component: 'p' },
    li: { component: 'span' },
    pre: { component: 'p' },
    code: { component: 'span' },
    table: { component: () => null },
  },
} as const;

export interface SectionDescriptionProps {
  markdown: string | undefined;
}

/** A section's authored description. Renders nothing when blank. */
export function SectionDescription({ markdown }: SectionDescriptionProps) {
  const text = (markdown ?? '').trim();
  if (text === '') return null;
  return (
    <div className="fr-section-desc">
      <Markdown options={OPTIONS}>{text}</Markdown>
    </div>
  );
}
```

- [ ] **Step 5: Export it** — append to `flow-runtime/src/index.ts`:

```ts
export * from './SectionDescription';
```

- [ ] **Step 6: Run the tests**

Run: `cd flow-runtime && npm test`
Expected: PASS — 5 from Task 3 + 10 here = **15 passing**.

If the "drops disallowed link schemes" case fails because an anchor still renders, the `sanitizer` is not being consulted for that attribute — do **not** relax the assertion. Verify the option name against the installed version's types and fix the option.

- [ ] **Step 7: Add the description style** to `flow-runtime/src/flow-runtime.css`:

```css
.fr-section-desc { font-size: 13px; color: var(--text-secondary); margin: 0 0 10px; max-width: 60ch; line-height: 1.5; }
.fr-section-desc p { margin: 0 0 6px; }
.fr-section-desc p:last-child { margin-bottom: 0; }
.fr-section-desc a { color: var(--accent-ink, var(--accent)); }
```

- [ ] **Step 8: Commit**

```bash
git add flow-runtime/package.json flow-runtime/package-lock.json flow-runtime/src/SectionDescription.tsx flow-runtime/src/index.ts flow-runtime/src/flow-runtime.css flow-runtime/src/__tests__/SectionDescription.test.tsx
git commit -m "feat(flow-runtime): hardened SectionDescription as the single markdown call site"
```

---

### Task 5: `sectionCompletion` — one source of truth for progress

**Files:**
- Create: `flow-runtime/src/sectionCompletion.ts`
- Test: `flow-runtime/src/__tests__/sectionCompletion.test.ts` (new)

**Interfaces:**
- Consumes: `sectionFields` (`flow-runtime/src/sectionFields.ts`), `WorkflowDraft` and `ModelFieldSource` from existing types.
- Produces: `sectionCompletion(section, fields, draft) -> SectionProgress` where `SectionProgress = { required: number; remaining: number; done: boolean; optional: boolean }`. Task 6's pill and Task 7's rail dot both read this.

- [ ] **Step 1: Write the failing tests** — `flow-runtime/src/__tests__/sectionCompletion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sectionCompletion } from '../sectionCompletion';
import type { FlowField, WorkflowSectionDef } from '../types';

const F = (name: string, required: boolean): FlowField =>
  ({ name, type: 'str', required } as FlowField);

function section(over: Partial<WorkflowSectionDef> = {}): WorkflowSectionDef {
  return {
    section_id: 'student_section',
    entity_model: 'student',
    fields: [],
    mode: 'create',
    ...over,
  };
}

describe('sectionCompletion — non-repeat', () => {
  const fields = [F('first_name', true), F('last_name', true), F('nickname', false)];

  it('counts required fields only', () => {
    const p = sectionCompletion(section(), fields, {});
    expect(p.required).toBe(2);
    expect(p.remaining).toBe(2);
    expect(p.done).toBe(false);
  });

  it('an optional answer does not reduce remaining', () => {
    const p = sectionCompletion(section(), fields, { 'student_section.nickname': 'Bo' });
    expect(p.remaining).toBe(2);
  });

  it('is done when every required field is answered', () => {
    const p = sectionCompletion(section(), fields, {
      'student_section.first_name': 'Mai',
      'student_section.last_name': 'Nguyen',
    });
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);
  });

  it('treats empty string, null, undefined and [] as unanswered', () => {
    for (const empty of ['', null, undefined, []]) {
      const p = sectionCompletion(section(), [F('a', true)], { 'student_section.a': empty });
      expect(p.remaining, JSON.stringify(empty)).toBe(1);
    }
  });

  it('treats false as an ANSWER, not a blank', () => {
    // an unchecked required checkbox is a deliberate "no" -- matches how the
    // backend's as_bool reads a flattened "false".
    const p = sectionCompletion(section(), [F('agrees', true)], { 'student_section.agrees': false });
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);
  });

  it('treats 0 as an answer', () => {
    const p = sectionCompletion(section(), [F('siblings', true)], { 'student_section.siblings': 0 });
    expect(p.done).toBe(true);
  });
});

describe('sectionCompletion — no required fields', () => {
  it('is done and flagged optional', () => {
    const p = sectionCompletion(section(), [F('nickname', false)], {});
    expect(p.required).toBe(0);
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);
    expect(p.optional).toBe(true);
  });

  it('a section with required fields is not optional', () => {
    expect(sectionCompletion(section(), [F('a', true)], {}).optional).toBe(false);
  });
});

describe('sectionCompletion — repeat', () => {
  const s = section({ section_id: 'contacts_section', repeat: { min: 1, max: 5 } });
  const fields = [F('first_name', true), F('phone', false)];

  it('is not done when fewer than min rows exist', () => {
    const p = sectionCompletion(s, fields, { contacts_section: [] });
    expect(p.done).toBe(false);
  });

  it('is not done when a present row is missing a required field', () => {
    const p = sectionCompletion(s, fields, { contacts_section: [{ phone: '555' }] });
    expect(p.done).toBe(false);
    expect(p.remaining).toBe(1);
  });

  it('is done when min rows exist and each is complete', () => {
    const p = sectionCompletion(s, fields, { contacts_section: [{ first_name: 'Ana' }] });
    expect(p.done).toBe(true);
  });

  it('sums remaining across rows', () => {
    const p = sectionCompletion(s, fields, {
      contacts_section: [{ first_name: 'Ana' }, {}, {}],
    });
    expect(p.remaining).toBe(2);
  });

  it('treats a missing draft key as zero rows', () => {
    expect(sectionCompletion(s, fields, {}).done).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd flow-runtime && npm test`
Expected: FAIL — cannot resolve `../sectionCompletion`.

- [ ] **Step 3: Create `flow-runtime/src/sectionCompletion.ts`:**

```ts
// flow-runtime/src/sectionCompletion.ts
import type { FlowField, WorkflowDraft, WorkflowSectionDef } from './types';

export interface SectionProgress {
  /** How many REQUIRED fields the section has (per row, for repeats). */
  required: number;
  /** How many required answers are still missing (summed across rows). */
  remaining: number;
  done: boolean;
  /** True when the section has no required fields at all. */
  optional: boolean;
}

/**
 * `false` and `0` are ANSWERS. Only absent/blank values count as unanswered:
 * an unchecked required checkbox is a deliberate "no", which is also how the
 * backend's `as_bool` reads a flattened `"false"`.
 */
function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * One section's progress, counting REQUIRED fields only.
 *
 * The single source of truth for both layouts' progress indicators (the
 * accordion pill and the rail dot), so the two can never disagree about
 * whether a section is finished.
 *
 * Draft keys follow the existing convention and are NOT re-invented here:
 * non-repeat values live flat at `"{section_id}.{field}"`, repeat rows live
 * at the bare `section_id` key as an array of per-field records
 * (`StepRenderer.tsx`'s SectionRenderer).
 */
export function sectionCompletion(
  section: WorkflowSectionDef,
  fields: FlowField[],
  draft: WorkflowDraft,
): SectionProgress {
  const required = fields.filter((f) => f.required);
  const base: SectionProgress = {
    required: required.length,
    remaining: 0,
    done: true,
    optional: required.length === 0,
  };
  if (required.length === 0) return base;

  if (!section.repeat) {
    const remaining = required.filter(
      (f) => !isAnswered(draft[`${section.section_id}.${f.name}`]),
    ).length;
    return { ...base, remaining, done: remaining === 0 };
  }

  const raw = draft[section.section_id];
  const rows: Record<string, unknown>[] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : [];
  let remaining = 0;
  for (const row of rows) {
    remaining += required.filter((f) => !isAnswered(row[f.name])).length;
  }
  // Short of `min` rows, the missing rows are themselves outstanding work.
  const missingRows = Math.max(section.repeat.min - rows.length, 0);
  remaining += missingRows * required.length;
  return { ...base, remaining, done: remaining === 0 };
}
```

- [ ] **Step 4: Export it** — append to `flow-runtime/src/index.ts`:

```ts
export * from './sectionCompletion';
```

- [ ] **Step 5: Run the tests**

Run: `cd flow-runtime && npm test`
Expected: 15 prior + 13 here = **28 passing**.

- [ ] **Step 6: Commit**

```bash
git add flow-runtime/src/sectionCompletion.ts flow-runtime/src/index.ts flow-runtime/src/__tests__/sectionCompletion.test.ts
git commit -m "feat(flow-runtime): sectionCompletion as the single progress source"
```

---

### Task 6: `SectionShell` + accordion layout

The accessibility fix lands here. Read `flow-runtime/src/StepRenderer.tsx:336-412` (SectionRenderer) and `:542-558` (FormStep) fully before starting.

**Files:**
- Create: `flow-runtime/src/SectionShell.tsx`
- Create: `flow-runtime/src/AccordionSections.tsx`
- Modify: `flow-runtime/src/StepRenderer.tsx` (`FormStep` at `:542`, threading `mode`)
- Modify: `flow-runtime/src/flow-runtime.css`
- Modify: `flow-runtime/src/i18n.ts` (new strings, both locales)

**Interfaces:**
- Consumes: `displayTitle` (Task 2), `SectionDescription` (Task 4), `sectionCompletion` (Task 5).
- Produces: `<SectionShell section fields idPrefix children />` rendering `fieldset`/`legend`; `<AccordionSections step models draft onDraftChange />`. Task 7's rail reuses `SectionShell`.

- [ ] **Step 1: Add i18n strings** to both locales in `flow-runtime/src/i18n.ts`:

```ts
    'section.done': 'Done',
    'section.optional': 'Optional',
    'section.remaining': '{n} left',
    'section.expand': 'Expand section',
    'section.collapse': 'Collapse section',
    'section.nav': 'Sections',
```

and the `zh-CN` equivalents:

```ts
    'section.done': '已完成',
    'section.optional': '选填',
    'section.remaining': '还剩 {n} 项',
    'section.expand': '展开',
    'section.collapse': '收起',
    'section.nav': '章节',
```

A missing key renders the raw key string with no warning, so both locales must be added together.

- [ ] **Step 2: Create `flow-runtime/src/SectionShell.tsx`:**

```tsx
// flow-runtime/src/SectionShell.tsx
import type { ReactNode } from 'react';
import { SectionDescription } from './SectionDescription';
import { displayTitle } from './sectionTitle';
import type { WorkflowSectionDef } from './types';

export interface SectionShellProps {
  section: WorkflowSectionDef;
  /** Rendered inside the fieldset -- normally the section's field grid. */
  children: ReactNode;
  /** When false, the legend is visually hidden but stays in the a11y tree
   *  (the enclosing layout is already showing the title in its own header). */
  showLegend?: boolean;
}

/**
 * The grouping wrapper EVERY layout uses. This -- not the visual treatment --
 * is what fixes the enrollment form's ambiguity: `student_section` and
 * `contacts_section` both declare `first_name`, and without a fieldset/legend
 * a screen reader announces three identical "First name" fields with nothing
 * distinguishing them. `legend` makes it "Student Information, First name".
 *
 * A layout that renders fields without this component reintroduces the bug.
 */
export function SectionShell({ section, children, showLegend = true }: SectionShellProps) {
  return (
    <fieldset className="fr-section">
      <legend className={showLegend ? 'fr-section-title' : 'fr-sr-only'}>
        {displayTitle(section)}
      </legend>
      {showLegend && <SectionDescription markdown={section.description} />}
      {children}
    </fieldset>
  );
}
```

- [ ] **Step 3: Create `flow-runtime/src/AccordionSections.tsx`:**

```tsx
// flow-runtime/src/AccordionSections.tsx
import { useId, useMemo, useState } from 'react';
import { useFlowT } from './i18n';
import { SectionDescription } from './SectionDescription';
import { SectionShell } from './SectionShell';
import { sectionCompletion } from './sectionCompletion';
import { sectionFields } from './sectionFields';
import { displayTitle } from './sectionTitle';
import type { ModelFieldSource } from './blockConfig';
import type { WorkflowDraft, WorkflowSectionDef, WorkflowStepDef } from './types';

export interface AccordionSectionsProps {
  step: WorkflowStepDef;
  sections: WorkflowSectionDef[];
  models: Record<string, ModelFieldSource>;
  draft: WorkflowDraft;
  onDraftChange: (next: WorkflowDraft) => void;
  renderFields: (section: WorkflowSectionDef) => React.ReactNode;
}

/**
 * Collapsible sections with per-section completion state. Used by the family
 * flow, the designer preview, and staff below 700px.
 *
 * Collapsed panels stay MOUNTED behind the `hidden` attribute rather than
 * being unmounted, so browser find-in-page and print still reach them -- the
 * standard objection to accordions on long forms.
 */
export function AccordionSections(props: AccordionSectionsProps) {
  const { sections, models, draft, renderFields } = props;
  const t = useFlowT();
  const baseId = useId();

  const progress = useMemo(
    () => sections.map((s) => sectionCompletion(s, sectionFields(s, models[s.entity_model]), draft)),
    [sections, models, draft],
  );

  // Open the first INCOMPLETE section; when everything is done, open nothing
  // and let the form read as a finished checklist. Computed once on mount --
  // recomputing as the parent types would yank panels open under them.
  const [openId, setOpenId] = useState<string | null>(() => {
    const first = sections.findIndex(
      (s) => !sectionCompletion(s, sectionFields(s, models[s.entity_model]), draft).done,
    );
    return first === -1 ? null : sections[first].section_id;
  });

  return (
    <div className="fr-accordion">
      {sections.map((section, i) => {
        const open = openId === section.section_id;
        const p = progress[i];
        const panelId = `${baseId}-${section.section_id}-panel`;
        const pill = p.optional
          ? { cls: 'fr-pill--optional', text: t('section.optional') }
          : p.done
            ? { cls: 'fr-pill--done', text: t('section.done') }
            : { cls: 'fr-pill--todo', text: t('section.remaining').replace('{n}', String(p.remaining)) };

        return (
          <div className="fr-accordion-item" key={section.section_id}>
            <h3 className="fr-accordion-h">
              <button
                type="button"
                className="fr-accordion-btn"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : section.section_id)}
              >
                <span className={`fr-pill ${pill.cls}`}>{pill.text}</span>
                <span className="fr-accordion-t">{displayTitle(section)}</span>
                <span className="fr-accordion-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
                <span className="fr-sr-only">
                  {open ? t('section.collapse') : t('section.expand')}
                </span>
              </button>
            </h3>
            <div id={panelId} className="fr-accordion-panel" hidden={!open}>
              <SectionDescription markdown={section.description} />
              <SectionShell section={section} showLegend={false}>
                {renderFields(section)}
              </SectionShell>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `FormStep`.** Replace `FormStep` in `StepRenderer.tsx:542-558` with:

```tsx
function FormStep({ step, models, draft, onDraftChange, mode }: {
  step: WorkflowStepDef; models: Record<string, ModelFieldSource>;
  draft: WorkflowDraft; onDraftChange: (next: WorkflowDraft) => void;
  mode: StepRendererMode;
}) {
  const t = useFlowT();
  const wide = useMediaQuery('(min-width: 700px)');
  const sections = formSections(step);
  if (sections.length === 0) return <p className="fr-empty">{t('noFields')}</p>;

  const renderFields = (section: WorkflowSectionDef) => (
    <SectionRenderer step={step} section={section}
      model={models[section.entity_model]} draft={draft} onDraftChange={onDraftChange} />
  );

  // A single section gets no accordion and no rail: one collapsible panel
  // wrapping the whole form is chrome with no navigational value.
  if (sections.length === 1) {
    return (
      <SectionShell section={sections[0]}>{renderFields(sections[0])}</SectionShell>
    );
  }

  if (mode === 'staff' && wide) {
    return (
      <RailSections step={step} sections={sections} models={models}
        draft={draft} onDraftChange={onDraftChange} renderFields={renderFields} />
    );
  }
  return (
    <AccordionSections step={step} sections={sections} models={models}
      draft={draft} onDraftChange={onDraftChange} renderFields={renderFields} />
  );
}
```

`RailSections` does not exist until Task 7. **For this task, temporarily route `staff` to the accordion too** by omitting the `mode === 'staff'` branch entirely, then add it in Task 7. Do not import a module that does not exist yet.

- [ ] **Step 5: Create the `useMediaQuery` hook** — `flow-runtime/src/useMediaQuery.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Live viewport query. Subscribes rather than reading once at mount, so a
 * resize (or a rotated tablet) switches layout instead of stranding staff in
 * the wrong one.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 6: Add the imports `FormStep` now needs** to the top of `StepRenderer.tsx`:

```tsx
import { AccordionSections } from './AccordionSections';
import { SectionShell } from './SectionShell';
import { useMediaQuery } from './useMediaQuery';
```

`WorkflowSectionDef` and `StepRendererMode` are already in scope in that file (`StepRendererMode` is declared there at `:562`; `WorkflowSectionDef` is imported with the other types). Add `RailSections` in Task 7, not now — the module does not exist yet.

- [ ] **Step 7: Pass `mode` to `FormStep`.** At `StepRenderer.tsx:646`, the `step.type === 'form'` branch becomes:

```tsx
            {step.type === 'form' && (
              <FormStep step={step} models={models} draft={draft}
                onDraftChange={onDraftChange} mode={mode} />
            )}
```

- [ ] **Step 8: Add CSS** to `flow-runtime/src/flow-runtime.css`:

```css
.fr-section { border: 1px solid var(--border-primary); border-radius: var(--radius-sm);
  padding: 14px 16px; margin: 0; min-width: 0; }
.fr-section-title { font-size: 14px; font-weight: 650; color: var(--text-primary); padding: 0 4px; }
.fr-accordion { display: flex; flex-direction: column; gap: 8px; }
.fr-accordion-item { border: 1px solid var(--border-primary); border-radius: var(--radius-sm);
  overflow: hidden; }
.fr-accordion-h { margin: 0; font-size: inherit; font-weight: inherit; }
.fr-accordion-btn { display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 13px; background: none; border: 0; font: inherit; text-align: left;
  color: var(--text-primary); cursor: pointer; }
.fr-accordion-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.fr-accordion-t { font-weight: 650; }
.fr-accordion-chev { margin-left: auto; color: var(--text-tertiary); }
.fr-accordion-panel { padding: 0 13px 13px; }
.fr-accordion-panel .fr-section { border: 0; padding: 0; }
.fr-pill { font-size: 11px; font-weight: 650; padding: 1px 8px; border-radius: 999px;
  border: 1px solid transparent; white-space: nowrap; }
.fr-pill--done { background: var(--success-muted); color: var(--success); border-color: var(--success); }
.fr-pill--todo { background: var(--warning-muted, transparent); color: var(--warning, var(--text-secondary));
  border-color: var(--warning, var(--border-primary)); }
.fr-pill--optional { background: var(--bg-tertiary); color: var(--text-tertiary);
  border-color: var(--border-primary); }
```

- [ ] **Step 9: Export and build**

Append to `flow-runtime/src/index.ts`:

```ts
export * from './SectionShell';
export * from './AccordionSections';
export * from './useMediaQuery';
```

```bash
cd flow-runtime && npm test && npx tsc -b
cd ../familyhub/frontend && npm run build && npm run lint
cd ../../apexflow/frontend && npm run build && npm run lint
```
Expected: 28 tests passing, builds clean, lint clean.

- [ ] **Step 10: Commit**

```bash
git add flow-runtime/src flow-runtime/src/flow-runtime.css
git commit -m "feat(flow-runtime): fieldset/legend SectionShell and completion-aware accordion"
```

---

### Task 7: Rail layout for wide staff screens

**Files:**
- Create: `flow-runtime/src/RailSections.tsx`
- Modify: `flow-runtime/src/StepRenderer.tsx` (`FormStep` — add the `staff && wide` branch deferred in Task 6)
- Modify: `flow-runtime/src/flow-runtime.css`
- Test: `flow-runtime/src/__tests__/RailSections.test.tsx` (new). The rail lives in `flow-runtime`, so its test does too — not in admindash's suite, which would only exercise it when that app's tests happen to run.

**Interfaces:**
- Consumes: `SectionShell` (Task 6), `sectionCompletion` (Task 5), `displayTitle` (Task 2), `useMediaQuery` (Task 6).
- Produces: `<RailSections step sections models draft onDraftChange renderFields />` — same prop shape as `AccordionSections`, so `FormStep` can swap them.

- [ ] **Step 1: Write the failing test** — `flow-runtime/src/__tests__/RailSections.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RailSections } from '../RailSections';
import type { WorkflowSectionDef, WorkflowStepDef } from '../types';

const step: WorkflowStepDef = {
  step_id: 'application_form', type: 'form', title: 'Application',
  required: true, blocking: true, available_in: ['draft'], config: {},
} as WorkflowStepDef;

const sections: WorkflowSectionDef[] = [
  { section_id: 'student_section', entity_model: 'student', mode: 'create',
    title: 'Student Information', fields: [{ name: 'first_name', required: true }] },
  { section_id: 'contacts_section', entity_model: 'contact', mode: 'create',
    fields: [{ name: 'first_name', required: true }] },
];

const models = {
  student: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
  contact: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
} as never;

beforeEach(() => {
  // jsdom has no IntersectionObserver; the rail must not crash without it.
  (globalThis as never as { IntersectionObserver: unknown }).IntersectionObserver =
    class { observe() {} unobserve() {} disconnect() {} } as never;
});

describe('RailSections', () => {
  it('renders a nav entry per section, using the title fallback', () => {
    render(<RailSections step={step} sections={sections} models={models}
      draft={{}} onDraftChange={() => {}} renderFields={() => null} />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeTruthy();
    expect(nav.textContent).toContain('Student Information');
    expect(nav.textContent).toContain('Contacts');   // humanized fallback
  });

  it('renders every section in the pane, not just the active one', () => {
    const { container } = render(<RailSections step={step} sections={sections} models={models}
      draft={{}} onDraftChange={() => {}} renderFields={() => null} />);
    expect(container.querySelectorAll('fieldset').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd flow-runtime && npm test`
Expected: FAIL — cannot resolve `../RailSections`.

- [ ] **Step 3: Create `flow-runtime/src/RailSections.tsx`:**

```tsx
// flow-runtime/src/RailSections.tsx
import { useEffect, useId, useRef, useState } from 'react';
import { useFlowT } from './i18n';
import { SectionShell } from './SectionShell';
import { sectionCompletion } from './sectionCompletion';
import { sectionFields } from './sectionFields';
import { displayTitle } from './sectionTitle';
import type { AccordionSectionsProps } from './AccordionSections';

/**
 * Section rail + scrolling pane. Staff-only, wide screens only -- optimized
 * for an operator transcribing a paper application who needs to jump between
 * sections rather than read top to bottom.
 *
 * Below the breakpoint `FormStep` renders `AccordionSections` instead; this
 * component is never the narrow-screen layout.
 */
export function RailSections(props: AccordionSectionsProps) {
  const { sections, models, draft, renderFields } = props;
  const t = useFlowT();
  const baseId = useId();
  const [activeId, setActiveId] = useState(sections[0]?.section_id ?? '');
  const paneRef = useRef<HTMLDivElement>(null);

  // Scroll-spy via IntersectionObserver rather than scroll-event math.
  // Guarded because jsdom (and very old browsers) lack the API.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !paneRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target instanceof HTMLElement && visible.target.dataset.sectionId) {
          setActiveId(visible.target.dataset.sectionId);
        }
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    paneRef.current.querySelectorAll('[data-section-id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  const jump = (sectionId: string) => {
    const el = document.getElementById(`${baseId}-${sectionId}`);
    if (!el) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActiveId(sectionId);
  };

  return (
    <div className="fr-rail-layout">
      <nav className="fr-rail" aria-label={t('section.nav')}>
        {sections.map((s) => {
          const p = sectionCompletion(s, sectionFields(s, models[s.entity_model]), draft);
          const active = s.section_id === activeId;
          return (
            <button
              key={s.section_id}
              type="button"
              className={`fr-rail-item${active ? ' fr-rail-item--on' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => jump(s.section_id)}
            >
              <span className={`fr-rail-dot${p.done ? ' fr-rail-dot--done' : ''}`} aria-hidden="true" />
              {displayTitle(s)}
            </button>
          );
        })}
      </nav>
      <div className="fr-rail-pane" ref={paneRef}>
        {sections.map((s) => (
          <div key={s.section_id} id={`${baseId}-${s.section_id}`} data-section-id={s.section_id}>
            <SectionShell section={s}>{renderFields(s)}</SectionShell>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the staff branch to `FormStep`** in `StepRenderer.tsx`, restoring what Task 6 deferred:

```tsx
  if (mode === 'staff' && wide) {
    return (
      <RailSections step={step} sections={sections} models={models}
        draft={draft} onDraftChange={onDraftChange} renderFields={renderFields} />
    );
  }
```

with `import { RailSections } from './RailSections';` at the top.

- [ ] **Step 5: Add CSS** to `flow-runtime/src/flow-runtime.css`:

```css
.fr-rail-layout { display: grid; grid-template-columns: 200px 1fr; gap: 18px; align-items: start; }
.fr-rail { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 2px; }
.fr-rail-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0;
  border-left: 2px solid transparent; background: none; font: inherit; font-size: 13px;
  text-align: left; color: var(--text-secondary); cursor: pointer; border-radius: var(--radius-sm); }
.fr-rail-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.fr-rail-item--on { background: var(--accent-muted); color: var(--text-primary);
  font-weight: 650; border-left-color: var(--accent); }
.fr-rail-dot { width: 7px; height: 7px; border-radius: 999px; flex: none;
  border: 1.5px solid var(--border-primary); }
.fr-rail-dot--done { background: var(--success); border-color: var(--success); }
.fr-rail-pane { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
```

- [ ] **Step 6: Export and verify**

Append `export * from './RailSections';` to `flow-runtime/src/index.ts`, then:

```bash
cd flow-runtime && npm test && npx tsc -b
cd ../admindash/frontend && npm run build && npx vitest run
```
Expected: flow-runtime 28 + 2 = **30 passing**; admindash builds clean; admindash vitest **94** (unchanged).

- [ ] **Step 7: Commit**

```bash
git add flow-runtime/src
git commit -m "feat(flow-runtime): section rail layout for wide staff screens"
```

---

### Task 8: Designer authoring inputs and template backfill

**Files:**
- Modify: `apexflow/frontend/src/editor/SectionPanel.tsx:112-135` (add title/description controls)
- Modify: `apexflow/frontend/src/types/designer.ts` (section type mirror, if it declares one)
- Modify: `apexflow/frontend/src/i18n/translations.ts` (both locales)
- Modify: `apexflow/frontend/src/editor/editor.css`
- Modify: `apexflow/backend/app/templates/enrollment.py:336-411` (four section builders)
- Test: `apexflow/backend/tests/test_enrollment_template.py` (extend)

**Interfaces:**
- Consumes: `SectionDef.title`/`.description` (Task 1).
- Produces: an authoring surface for both fields, and an enrollment template that demonstrates them.

- [ ] **Step 1: Write the failing template test** — append to `apexflow/backend/tests/test_enrollment_template.py`:

```python
def test_every_section_has_a_title_and_description():
    """The one workflow that actually ships must demonstrate the feature --
    and it is the form where `first_name` appears three times."""
    from app.templates.enrollment import _steps

    form = next(s for s in _steps() if s["step_id"] == "application_form")
    sections = form["config"]["sections"]
    assert len(sections) == 4
    for section in sections:
        assert section["title"].strip(), f"{section['section_id']} has no title"
        assert section["description"].strip(), f"{section['section_id']} has no description"


def test_student_and_contact_sections_are_distinguishable():
    """Both declare first_name/last_name; their titles are what tells a
    parent which child the name belongs to."""
    from app.templates.enrollment import _steps

    form = next(s for s in _steps() if s["step_id"] == "application_form")
    by_id = {s["section_id"]: s for s in form["config"]["sections"]}
    assert by_id["student_section"]["title"] != by_id["contacts_section"]["title"]
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apexflow && uv run pytest backend/tests/test_enrollment_template.py -q -k "title or distinguishable"`
Expected: FAIL — `KeyError: 'title'`.

- [ ] **Step 3: Backfill the four section builders** in `enrollment.py`. Add these two keys to each dict, immediately after `entity_model`:

```python
# _family_section
        "title": "Family Information",
        "description": (
            "Who we contact about billing, closures, and pickup changes. "
            "If your family is already enrolled, we'll match this to your existing record."
        ),

# _student_section
        "title": "Student Information",
        "description": (
            "Tell us about the child you're enrolling. "
            "Enrolling more than one child? Submit a separate application for each."
        ),

# _contacts_section
        "title": "Emergency Contacts",
        "description": (
            "At least one adult besides a guardian who may be called in an emergency "
            "or collect your child. You can add up to five."
        ),

# _application_section
        "title": "Agreements & Signature",
        "description": (
            "Review and accept the enrollment agreements, then sign to submit."
        ),
```

- [ ] **Step 4: Run the template tests**

Run: `cd apexflow && uv run pytest backend/tests/test_enrollment_template.py -q`
Expected: PASS. Then `cd apexflow && uv run pytest backend/tests/ -q` — **547 passing** (545 from Task 1 + 2 here).

- [ ] **Step 5: Add the authoring inputs.** In `SectionPanel.tsx`, after the `section-panel-id` span block (`:112-120`), add:

```tsx
      <label className="section-panel-field">
        <span>{t('editor.section.title')}</span>
        <input
          type="text"
          value={section.title ?? ''}
          placeholder={humanizeSectionId(section.section_id)}
          maxLength={80}
          disabled={readOnly}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
      </label>

      <label className="section-panel-field">
        <span>{t('editor.section.description')}</span>
        <textarea
          className="section-panel-textarea"
          rows={3}
          value={section.description ?? ''}
          maxLength={600}
          disabled={readOnly}
          onChange={(e) => onChange({ ...section, description: e.target.value })}
        />
        <small className="section-panel-hint">{t('editor.section.descriptionHint')}</small>
      </label>
```

with `import { humanizeSectionId } from '@neoapex/flow-runtime';` at the top. The placeholder shows the admin exactly what parents see if they leave the title blank.

- [ ] **Step 6: Add translations** to `apexflow/frontend/src/i18n/translations.ts`, both locales:

```ts
    'editor.section.title': 'Section heading',
    'editor.section.description': 'Section description',
    'editor.section.descriptionHint':
      'Shown to applicants under the heading. **bold**, *italic*, and [links](https://example.com) are supported; links must be http, https, or mailto.',
```

```ts
    'editor.section.title': '章节标题',
    'editor.section.description': '章节说明',
    'editor.section.descriptionHint':
      '显示在标题下方。支持 **粗体**、*斜体* 和 [链接](https://example.com)；链接必须是 http、https 或 mailto。',
```

- [ ] **Step 7: Add editor CSS** to `apexflow/frontend/src/editor/editor.css`:

```css
.section-panel-textarea { width: 100%; resize: vertical; font: inherit; font-size: 13px;
  padding: 6px 8px; border: 1px solid var(--border-primary); border-radius: var(--radius-sm);
  background: var(--bg-input); color: var(--text-primary); }
.section-panel-hint { display: block; margin-top: 4px; font-size: 11px; color: var(--text-tertiary); }
```

- [ ] **Step 8: Verify the designer builds**

```bash
cd apexflow/frontend && npm run build && npm run lint
```
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apexflow/frontend/src apexflow/backend/app/templates/enrollment.py apexflow/backend/tests/test_enrollment_template.py
git commit -m "feat(apexflow): author section title/description in the designer; backfill the enrollment template"
```

---

### Task 9: Full verification and follow-up bookkeeping

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md` (log the two follow-ups this work created)

- [ ] **Step 1: Run every suite from a clean install**

```bash
cd flow-runtime && npm ci && npm test
cd ../apexflow && uv run pytest backend/tests/ -q
cd ../familyhub && uv run pytest backend/tests/ -q
cd ../admindash && uv run pytest backend/tests/ -q
cd ../datacore && uv run python -m pytest tests/ -q
cd ../admindash/frontend && npx vitest run
```
Expected: flow-runtime **30**, apexflow **547**, familyhub **89**, admindash **201**, datacore **354**, admindash vitest **94**.

- [ ] **Step 2: Build and lint all three frontends**

```bash
cd flow-runtime && npm ci
cd ../admindash/frontend && npm run build && npm run lint
cd ../../familyhub/frontend && npm run build && npm run lint
cd ../../apexflow/frontend && npm run build && npm run lint
```
Expected: all builds clean. familyhub and apexflow lint clean. admindash lint shows **exactly the 5 pre-existing errors** — if a 6th appears, it is yours; fix it.

- [ ] **Step 3: Confirm the bundle cost matches the spec's estimate**

Run `cd familyhub/frontend && npm run build` and read the reported gzip size. The spec predicted ~112 kB (from 84 kB). Record the actual number in the commit message. **If it exceeds 130 kB, stop and report** — that means markdown-to-jsx is not tree-shaking as measured and the dependency choice needs revisiting.

- [ ] **Step 4: Verify the containment tests actually bite.** Temporarily add `import Markdown from 'markdown-to-jsx';` to `flow-runtime/src/SectionShell.tsx`, run `npm test`, confirm the "imports markdown-to-jsx in exactly one file" test FAILS, then revert. Record that you did this — an unverified guard is not a guard.

- [ ] **Step 5: Log the two follow-ups** this work deliberately deferred, appending to `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md`:

```markdown
25. **`message`-step bodies are still plain text while section descriptions
    render markdown.** `MessageStep` (`flow-runtime/src/StepRenderer.tsx`)
    splits `config.body` on newlines into escaped paragraphs. Now that
    `SectionDescription` exists as a hardened, single-call-site markdown
    renderer, pointing message bodies at it is a small change — but it is a
    separate authoring surface with its own review implications, so it was
    deliberately left out of the section-layout work.

26. **No CI runs any test suite.** `.github/workflows/` contains only
    `deploy.yml` and `discord-release.yml`; neither invokes pytest or vitest.
    Every suite is run locally by whoever remembers. This matters more now
    than it did: `flow-runtime`'s new vitest suite contains the markdown
    containment and link-scheme tests, which are a security boundary. A
    guard that only runs when someone remembers is weaker than it looks.
    Wiring a test workflow covering the four Python suites and two JS suites
    is its own piece of work.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md
git commit -m "docs: log message-body markdown and missing CI test workflow as follow-ups"
```

---

## Self-review notes

- **Spec coverage:** schema + validation (Task 1), TS mirror + title fallback (Task 2), vitest infrastructure (Task 3), markdown wrapper + containment tests (Task 4), completion (Task 5), `SectionShell` + accordion + single-section rule (Task 6), rail + breakpoint fallback (Task 7), authoring + template backfill (Task 8), verification + follow-ups (Task 9).
- **Type consistency:** `SectionProgress` fields (`required`/`remaining`/`done`/`optional`) are defined in Task 5 and consumed unchanged in Tasks 6 and 7. `AccordionSectionsProps` is defined in Task 6 and reused as `RailSections`' prop type in Task 7, which is what lets `FormStep` swap them. `displayTitle`/`humanizeSectionId` are defined in Task 2 and used in Tasks 6, 7, and 8.
- **Ordering hazard:** Task 6 Step 4 shows the final `FormStep` including the `RailSections` branch, but Step 4's note explicitly says to omit that branch until Task 7 Step 4 restores it. Following Task 6 literally without reading that note produces an unresolvable import.
- **Verified while writing this plan, not assumed:** `npm ci` in `flow-runtime` installs `react` (declared peer) but **not** `react-dom`, so Task 3 installs it explicitly — otherwise every component test in Tasks 4 and 7 fails to import. `flow-runtime/tsconfig.json` already sets `"jsx": "react-jsx"`, so vitest's esbuild handles the `.tsx` test files with no React plugin. `_SectionEntry` and `SectionDef`/`StepDef` were confirmed importable and constructible with the exact fixture arguments Task 1 uses.
- **The riskiest task is 4.** Its safety depends on option names matching the installed `markdown-to-jsx` version. If `sanitizer` or `disableParsingRawHTML` has been renamed, the tests fail loudly rather than silently passing unsafe markup — which is why the negative cases are written as assertions about rendered output rather than about the options object.
