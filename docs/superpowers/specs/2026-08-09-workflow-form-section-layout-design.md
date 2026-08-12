# Workflow form sections: named, described, and laid out — design

**Status:** approved 2026-08-09, pending implementation plan
**Scope:** `SectionDef` schema (apexflow backend), section rendering in `workflow-forms`,
section authoring in the apexflow designer, and the enrollment template's own copy.
Does **not** include the AdminDash home page or `message`-step bodies.
**Branch:** `docs/form-section-layout`, cut from `feat/item-status-typing` (the
implementation edits `workflow-forms/src/types.ts` and `StepRenderer.tsx`, which that
branch also modified).

## Problem

A workflow form section is a data-binding construct with no human face. `SectionDef`
(`apexflow/backend/app/workflows/schema.py:193`) carries `section_id`, `entity_model`,
`fields`, `mode`, and `repeat` — **no title and no description**. There is nowhere for an
admin to say what a section is.

The renderer matches. `SectionRenderer` (`workflow-forms/src/StepRenderer.tsx:344`) emits a
bare `<div class="fr-form-fields">` per section with no heading and no margin between
consecutive sections, and `.fr-form-fields` is a `repeat(auto-fill, minmax(240px, 1fr))`
grid (`workflow-forms/src/workflow-forms.css:7`). Adjacent sections therefore fuse into one
continuous field grid. Only the *step* gets a heading — an `<h2 class="fr-block-title">`
at `StepRenderer.tsx:640`.

The enrollment template shows the consequence at full scale. Its single `application_form`
step (`apexflow/backend/app/templates/enrollment.py:423-433`) declares four sections
totalling **40 fields**:

| Section | Model | Fields | Repeat |
|---|---|---|---|
| `family_section` | `family` | 12 | — |
| `student_section` | `student` | 11 | — |
| `contacts_section` | `contact` | 8 | 1–5 |
| `application_section` | `registration_application` | 9 | — |

These render as one undifferentiated grid of 40 inputs under a single heading reading
"Application Details".

**This is a correctness problem, not a cosmetic one.** `first_name` and `last_name` appear
in both `student_section` and `contacts_section`, and `contacts_section` repeats up to five
times. A parent sees "First name" at least three times with nothing on screen — and nothing
in the accessibility tree — distinguishing the student's from each emergency contact's. The
form cannot be answered correctly by reading it. Any resulting data error is silent: every
value is individually valid, just attached to the wrong entity.

`primary_address` likewise appears in both `family_section` and `student_section`.

## Decisions

| Decision | Ruling |
|---|---|
| Section identity | `SectionDef` gains `title` and `description`. Both default to `""` — additive and backward compatible. |
| Missing title | Falls back to a humanized `section_id` (`student_section` → "Student"), so un-migrated definitions improve without an edit. |
| Description formatting | **Limited markdown** — bold, italic, links. Plain text was rejected as too weak for policy links and emphasis. |
| Markdown engine | **`markdown-to-jsx`**, not hand-rolled and not `react-markdown`. See "Markdown" below. |
| Family layout | **Collapsible sections** with per-section completion state. |
| Staff layout | **Sticky section rail + scrolling pane**, at ≥700px only. |
| Designer preview layout | Mirrors the family accordion — admins author for the applicant experience. |
| Staff below 700px | Falls back to the family accordion rather than a third pattern. |
| Grouping semantics | `fieldset`/`legend` in **every** layout — that, not the visual treatment, is what fixes the naming ambiguity. |
| Completion counting | Required fields only. Optional fields never block or contribute to "remaining". |

## Schema

```python
# apexflow/backend/app/workflows/schema.py
class SectionDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    section_id: str
    entity_model: str
    title: str = ""          # "Student Information"
    description: str = ""    # limited markdown
    fields: list[FieldPick]
    mode: Literal["create", "match_or_create"]
    repeat: RepeatSpec | None = None
```

Mirrored in `workflow-forms/src/types.ts:89` (`WorkflowSectionDef`).

Both fields default to `""`, so every stored `workflow_definition` continues to validate,
publish, and pass `definition_health` untouched. No migration and no backfill are required
for correctness — the template backfill below is a copy improvement, not a fix.

### Publish-time validation

Added to `validate.py`, alongside the existing section checks:

- `title` — at most 80 characters. Longer titles break both layouts' headers.
- `description` — at most 600 characters. A description is orienting copy, not a policy
  document; anything longer belongs in a `message` step.
- Every markdown link target in `description` must parse to an `http`, `https`, or `mailto`
  URL. **A bad scheme fails publish**, so a hostile or malformed link is caught at authoring
  time rather than relying solely on the render-time sanitizer. This is defence in depth:
  the renderer independently enforces the same allowlist.

Errors name the offending `section_id`, matching the existing validator convention.

### Title fallback

```
displayTitle(section) = section.title.trim() || humanize(section.section_id)
```

`humanize` strips a trailing `_section`, replaces `_` with spaces, and capitalizes the first
word: `student_section` → "Student", `contacts_section` → "Contacts". Implemented once in
`workflow-forms` and used by every layout.

## Markdown

### Engine choice

`description` reaches parents, so link handling is a security boundary, not a formatting
preference. Three options were measured (bundled with esbuild, minified, gzipped, React
externalized):

| Option | gzip | Packages | Raw HTML by default |
|---|---|---|---|
| `react-markdown` 10.1 | 36 kB | 77 | Not parsed unless `rehype-raw` is added |
| **`markdown-to-jsx` 9.10** | **28 kB** | **1** | **Parsed** — must be disabled explicitly |
| `marked` + `dompurify` | ~50 kB | 2 | HTML-string path; safety depends on sanitizer config |

A hand-written parser was considered and **rejected**: writing and owning a markdown parser
when maintained ones exist is not a good trade, and both library options already provide the
property that motivated it — rendering to React elements rather than an HTML string, so
`dangerouslySetInnerHTML` never appears.

`markdown-to-jsx` is chosen for its dependency footprint: one package to audit rather than
77, which was the only real objection to taking a dependency into `workflow-forms` (a package
with zero runtime dependencies today, consumed by three frontends).

### Required configuration

`markdown-to-jsx` is **not safe with default options** — it parses raw HTML. It must be
configured as:

- `disableParsingRawHTML: true` — `<img onerror=…>` renders as literal text.
- A custom `sanitizer` enforcing a **positive** scheme allowlist (`http`, `https`, `mailto`).
  The built-in sanitizer is a deny-list (`javascript:`, `vbscript:`, non-image `data:`) and
  deliberately permits `data:image/svg+xml`, which the library's own documentation notes can
  execute script if opened as a top-level navigation. An allowlist closes that.
- `overrides` restricting rendered elements to `p`, `strong`, `em`, and `a`. Headings,
  images, lists, code blocks, and tables are dropped.
- Anchors render with `target="_blank"` and `rel="noopener noreferrer"`.

### The single-call-site rule

Because safety depends on those options being passed, **`markdown-to-jsx` is imported in
exactly one module**: `workflow-forms/src/SectionDescription.tsx`. Everything else renders a
description by using that component.

This is enforced mechanically, not by convention — but **not** with eslint:
`workflow-forms` has no eslint config, and the frontends' `eslint .` runs never reach
`workflow-forms/src`, so a `no-restricted-imports` rule there would be enforcement in name
only.

Instead a **source-grep test** in workflow-forms's own vitest suite asserts that
`markdown-to-jsx` is imported in exactly one file, and that
`dangerouslySetInnerHTML` appears nowhere in `src/`. This reuses the test infrastructure
this work already adds, needs no second toolchain, and follows a pattern the codebase
already uses (`apexflow/backend/tests/test_item_status.py::test_engine_writes_no_bare_status_literals`
greps module source the same way). A second unguarded call site fails the suite.

### Cost

familyhub's production bundle grows from **84 kB gzip to roughly 112 kB (+33%)** on a form
parents open on phones. Accepted deliberately as the price of markdown over plain text.

## Layouts

`StepRenderer` already carries `mode: StepRendererMode` (`'preview' | 'family' | 'staff'`,
`StepRenderer.tsx:562`), so layout selection is a branch inside the existing component
rather than a fork of it.

| Surface | Mode | Viewport | Layout |
|---|---|---|---|
| familyhub parent flow | `family` | any | Accordion |
| apexflow designer preview | `preview` | any | Accordion |
| admindash staff entry | `staff` | ≥700px | Rail + pane |
| admindash staff entry | `staff` | <700px | Accordion |

The accordion serves three of the four cases, so it is built first; the rail layers on top of
the same section primitives.

### `SectionShell` — shared by every layout

Renders `<fieldset>` → `<legend>`(display title) → `SectionDescription` → the existing field
grid. This is the load-bearing accessibility fix: `fieldset`/`legend` makes a screen reader
announce "Student Information, First name" instead of a third bare "First name", and it
applies identically in all three layouts.

`legend` is visually styled as a section heading; the visual chrome (card border, accordion
header, anchor target) is supplied by the enclosing layout.

### Accordion (`AccordionSections`)

- Header is a real `<button>` inside an `<h3>`, carrying `aria-expanded` and `aria-controls`.
- Header contents: completion pill, display title, a one-line summary when collapsed
  (e.g. "2 contacts"), chevron.
- **Collapsed content stays in the DOM** behind the `hidden` attribute rather than being
  unmounted, so browser find-in-page and print keep working — the standard objection to
  accordions on long forms.
- Initial state: the **first incomplete section is open**, everything else collapsed.
  Returning to a saved draft therefore lands the parent on their next task. When every
  section is already complete, all are collapsed — the form reads as a finished checklist.
- **A step with a single section renders no accordion.** One collapsible panel wrapping the
  whole form is chrome with no navigational value; the section renders as a plain
  `SectionShell` with its heading and description. The rail layout applies the same rule.
- A section containing a validation error **auto-expands** on failed submit, and the first
  such section receives focus.
- Open/closed state is component-local. It is not persisted and never enters `draft_data`.

### Rail + pane (`RailSections`)

- Left: `<nav aria-label="Sections">` listing every section with a completion dot; the active
  entry carries `aria-current="true"`.
- Right: all sections rendered in a scrolling pane, each an anchor target.
- Scroll-spy via `IntersectionObserver`, not scroll-event math.
- Smooth scrolling is suppressed under `prefers-reduced-motion: reduce`.
- Below 700px the component renders `AccordionSections` instead. The breakpoint is evaluated
  with `matchMedia` through a small `useMediaQuery` hook, so it responds to resize rather
  than being read once at mount.

## Completion

`workflow-forms/src/sectionCompletion.ts` — a pure, React-free, unit-tested module.

```ts
sectionCompletion(section, fields, draft) -> { required, remaining, done }
```

- Counts **required fields only**. An optional field never appears in `remaining`.
- A field counts as answered when its draft value is not `undefined`, `null`, `""`, or `[]`.
  `false` is an answer (an unchecked required checkbox is a deliberate "no", consistent with
  how `as_bool` treats flattened values server-side).
- Repeat sections: `done` when at least `repeat.min` rows exist **and** every present row has
  all its required fields answered. `remaining` sums across rows.
- Reads non-repeat values at `"{section_id}.{field}"` and repeat rows at the bare
  `section_id` key — the existing draft key convention (`StepRenderer.tsx:352-380`), not a
  new one.
- A section with **no required fields** reports `required: 0, remaining: 0, done: true`. It
  shows a neutral "Optional" pill rather than a green "Done" one, so a parent is not told
  they finished something they never touched.

This function drives the accordion pill and the rail dot, so the two layouts can never
disagree about whether a section is finished.

## Admin authoring

`apexflow/frontend/src/editor/SectionPanel.tsx` currently shows the raw `section_id` as
read-only text (`:118`) and offers no label input. It gains:

- **Title** — a text input, placeholder showing the humanized fallback so the admin can see
  what parents get if they leave it blank.
- **Description** — a textarea with a hint naming the supported syntax
  (`**bold**`, `*italic*`, `[text](url)`) and the link-scheme restriction.

`section_id` stays read-only: it is a data key referenced by `commit_sections`, `show_if`
sources, and stored draft keys. Title and description are display-only and freely editable.

The designer's existing live preview renders the accordion, so an admin sees the parent's
view as they type.

## Template backfill

`templates/enrollment.py`'s four sections get real titles and descriptions, replacing the
implicit reliance on field order. This is what makes the template demonstrate the feature
rather than merely tolerate it, and it is what resolves the duplicate-`first_name`
ambiguity for the one workflow that actually ships today.

## Testing

| Area | Where | What |
|---|---|---|
| Schema defaults | apexflow pytest | `title`/`description` default `""`; a definition without them still validates and publishes. |
| Publish validation | apexflow pytest | Over-length title/description rejected; `javascript:` and `data:` link targets rejected; `http`/`https`/`mailto` accepted; the enrollment template publishes clean. |
| Markdown rendering | **workflow-forms vitest** | `**bold**`/`*italic*`/`[text](url)` render as `strong`/`em`/`a`; raw HTML renders as literal text; disallowed schemes render as plain text, not anchors; headings/images are dropped. |
| Completion | **workflow-forms vitest** | Required-only counting; `false` counts as answered; repeat-section `min` and per-row requirements. |
| Title fallback | workflow-forms vitest | `student_section` → "Student"; an explicit title wins. |
| Layout selection | admindash vitest | `staff` + wide → rail; `staff` + narrow → accordion; `family`/`preview` → accordion. |

**New infrastructure:** `workflow-forms` has no test runner today, and neither does familyhub's
frontend — only admindash has vitest. The markdown wrapper is a security boundary and its
tests must not live in a different package that might not run, so **this work adds vitest to
`workflow-forms`** (devDependency plus a `test` script). That is new infrastructure, not just a
feature, and it is the main non-obvious cost in this design.

Note that **this repository has no CI test workflow** — `.github/workflows/` contains only
`deploy.yml` and `discord-release.yml`, neither of which runs pytest or vitest. Every suite
is run locally today. Adding workflow-forms's `npm test` therefore gives a local command and
nothing more; wiring a test job that covers the four Python suites and two JS suites is a
separate piece of work and is **out of scope here**, but it is worth logging as a follow-up,
because a security-boundary test that only runs when someone remembers is weaker protection
than it looks.

## Out of scope

- **`message`-step bodies stay plain text.** `MessageStep` (`StepRenderer.tsx:517`) splits
  `config.body` on newlines into escaped paragraphs. Giving it markdown too is defensible for
  consistency but is a separate authoring surface with its own review implications. Logged as
  a follow-up.
- **The AdminDash home page**, which has its own spec.
- **Per-field help text.** Sections gain a description; individual fields do not. Field-level
  help is a model-definition concern, not a workflow-authoring one.
- **Reordering sections** in the designer.
- **Conditional descriptions** (`show_if` on copy).

## Consumer compatibility

- `SectionDef` gains only defaulted fields, so stored definitions, pinned in-flight instance
  versions, and `definition_health` are all unaffected.
- `WorkflowSectionDef` gains two optional properties; existing TypeScript consumers compile
  unchanged.
- No wire-shape change to `workflow_item`, instances, or drafts. Draft keys are untouched, so
  in-flight drafts keep resolving.
- `workflow-forms` gains its first runtime dependency. `deploy.yml` already runs `npm ci` in
  `workflow-forms` before the admindash, apexflow, and familyhub frontend builds
  (`deploy.yml:325`, `:369`, `:409`), so the new dependency is installed in CI with no
  workflow change at all.
