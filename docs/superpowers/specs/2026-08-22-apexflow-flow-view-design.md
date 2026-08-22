# ApexFlow Flow view — design

Date: 2026-08-22
Status: approved (treatment B, with clickable stages)

## Problem

Asked to show a workflow, the assistant draws ASCII box art. It arrives
mangled. Three separate causes, all verified:

1. `components/chat/Markdown.tsx:105` — `renderBlock` handles tables, lists,
   headings and paragraphs. There is **no** fenced-code branch, so monospace
   content renders in the sans stack and runs of spaces collapse.
2. `components/chat/Markdown.tsx:154` — `text.split(/\n{2,}/)` runs before any
   block is inspected, so a drawing containing a blank line is already several
   unrelated paragraphs by the time rendering starts.
3. `styles/theme.css:134` — `--assistant-w: 380px`. A legible box drawing of
   even a five-stage machine needs ~70 monospace columns (~550px). It cannot
   fit, so fixing (1) and (2) alone would still not make it readable.

`chat/agent.py`'s `SYSTEM_PROMPT` never asks for ASCII. The model reaches for
it because no better channel exists.

Meanwhile the browser already holds a complete, tested graph model of the
machine — `editor/stage/read.ts`'s `readStageModel` produces stages in spine
order with BFS depth, grouped moves carrying actor/guards/effects, and a
resolved `finishStageId`. Nothing renders it as a picture.

## Decision

Add a **Flow** tab to the editor that draws the machine as a vertical spine
with a branch rail (treatment B). Chat's job becomes pointing at it, not
drawing it. Stage nodes are clickable and navigate to that stage in the
Stages tab.

Two treatments were considered and rejected as the *first* build:

- **Depth columns** (left-to-right flowchart) reads best for sequence but
  needs longest-path layering — under the BFS depth in `spine.ts`,
  `confirmed` is depth 1 and signup's accept-offer edge points backwards —
  plus orthogonal edge routing across five columns, and ~1180px of width.
- **Actor lanes** (moves bowing into a family/staff lane) answers "who does
  what" better than either, but its arc nesting degrades once a stage has
  more than three moves per actor.

Both remain reachable later as toolbar settings over the same layout data.
This spec does not build them.

## Scope

In scope:

- A pure layout module: `StageModel` → `FlowLayout`.
- A `FlowView` component that renders a `FlowLayout` as inline SVG.
- A third editor tab wired to the existing draft store.
- Stage nodes as buttons that switch to the Stages tab and reveal that stage.
- A DOM anchor on `StageCard` for that reveal to target.

Also in scope — **added after the first pass**. The Flow tab does not touch
the chat panel, so shipping it alone left the reported symptom exactly as it
was. Deferring the renderer fix was the wrong call:

- `Markdown.tsx` gains fenced-code support, via a pure `splitFences`
  tokenizer that lifts fences out BEFORE the blank-line split.
- `SYSTEM_PROMPT` tells the model not to draw diagrams at all, and what to
  write instead.
- Both are mirrored into admindash, which ships a byte-identical
  `Markdown.tsx` and had the same bug.

And the **chat flow card**, added third — see its own section below.

Out of scope (deliberately, and named so they are not silently assumed):

- The `create_draft` inline flow preview.
- Editing from the diagram. The Flow view is read-only; the Stages tab is
  where authoring happens, which is exactly why nodes navigate there.

Those are follow-ups, tracked separately. They are independent of this work.

## Architecture

Three new files plus two touched. The split exists so the hard part — layout
— is pure and testable without a component harness, matching how
`editor/stage/` is already organised.

```
editor/flow/types.ts        FlowLayout, FlowNode, FlowEdge, ... (new)
editor/flow/layout.ts       pure: StageModel -> FlowLayout      (new)
editor/flow/geometry.ts     pure: layout -> coordinates + paths (new)
editor/flow/revealStage.ts  the Flow -> Stages DOM jump         (new)
editor/flow/FlowView.tsx    renders SVG, emits onSelectStage    (new)
editor/flow/FlowView.css                                        (new)
editor/StageCard.tsx        gains the card id + focus target    (edit)
pages/EditorPage.tsx        'flow' tab + reveal effect          (edit)
i18n/translations.ts        editor.flow.* in both locales       (edit)
vitest.config.ts            collect .tsx; see Testing below     (edit)
```

Split three ways rather than two, decided while building: `geometry.ts`
(where a node sits, what path a move takes) turned out to be as
argument-worthy as `layout.ts` and just as pure, so it is tested the same way
instead of being eyeballed in a browser. `revealStage.ts` is separate so the
DOM jump can be tested without mounting the page, its router, its auth context
and its draft store.

`layout.ts` imports nothing from React and never mutates its input. It reads
the `StageModel` the Stages tab already computes, so a machine the editor can
author is a machine the Flow view can draw.

### Data model

```ts
type Column = 'spine' | 'rail';

interface FlowNode {
  stage_id: string;
  name: string;              // falls back to stage_id when unnamed
  kind: StateDef['kind'];
  column: Column;
  row: number;               // 0-based, monotonic top to bottom
  stepCount: number;
  isFinish: boolean;
}

interface FlowEdge {
  key: string;               // MoveGroup.key — stable, already unique
  from: string;              // stage_id
  to: string;                // stage_id
  action: string;
  who: Who;                  // 'family' | 'staff' | 'both' | 'automatic'
  backward: boolean;         // target row <= source row
  guardCount: number;        // rendered as a "conditional" marker, not text
}

interface FlowExit {
  key: string;
  to: string;                // terminal stage_id
  name: string;
  action: string;
  who: Who;
  fromNames: string[];       // source stages, named
}

interface FlowLayout {
  nodes: FlowNode[];         // in row order
  edges: FlowEdge[];
  exits: FlowExit[];
  rowCount: number;
  hasRail: boolean;          // false => render one column, narrower
}
```

### Spine and rail assignment

A stage is on the **spine** if it lies on the shortest path from the initial
stage to `finishStageId`, following non-exit moves only. Every other
non-exit-target stage goes on the **rail**. Terminal stages that are not the
finish are not nodes at all — they are `exits`.

Verified against both shipped templates:

| Template   | Spine                                              | Rail                        | Exits               |
|------------|----------------------------------------------------|-----------------------------|---------------------|
| Signup     | draft, confirmed, completed                        | waitlisted, offered         | dropped             |
| Enrollment | draft, submitted, in_review, approved, enrolled    | waitlisted, pending_items   | declined, withdrawn |

### Row assignment

Walk the spine in path order. Before emitting spine node *i*, emit any
not-yet-emitted rail nodes first reached from an already-emitted node,
depth-first, so a rail detour occupies the rows between the spine nodes it
departs from and returns to.

For enrollment this yields: draft 0, waitlisted 1, submitted 2, in_review 3,
pending_items 4, approved 5, enrolled 6.

This is presentational only. A machine whose graph confuses it still renders
every stage and every move; the rows are just less helpful — the same
guarantee `spine.ts` already makes about `orderStages`.

### Degenerate machines

These are not hypothetical: the editor can create every one of them, because
"add a stage" mints an unreachable stage and "set role" can remove the only
initial stage.

| Case                        | Behaviour                                                    |
|-----------------------------|--------------------------------------------------------------|
| No initial stage            | No spine. Every stage on one column in `model.stages` order. |
| `finishStageId === null`    | Spine is the initial stage's reachable chain; rest on rail.  |
| Unreachable stage           | Rail, after every reachable rail node.                        |
| Stage with no moves         | Renders as a node with no edges. Not an error.                |
| Zero stages                 | Empty state, same string as the Stages tab.                   |

`hasRail: false` collapses the drawing to a single column so a purely linear
workflow does not render half-empty.

### Edge routing

Six shapes, chosen by `(fromColumn, toColumn, backward)`. Each produces an
SVG path string between two node ports:

| From  | To    | Direction | Route                                          |
|-------|-------|-----------|------------------------------------------------|
| spine | spine | forward   | straight down the spine column                 |
| spine | rail  | forward   | out the right, across, into the rail's left    |
| rail  | spine | forward   | out the left, across, into the spine's left    |
| rail  | rail  | forward   | straight down the rail column                  |
| any   | any   | backward  | around the outside, right of the rail column   |
| any   | any   | self      | not drawn; surfaced as a badge on the node     |

Corners are quarter-arcs of a fixed radius so every route reads as one family.
Backward edges are the only ones that leave the two columns, which is what
makes a cycle — signup's decline/rescind pair, enrollment's resubmit — visible
rather than hidden.

### Where move labels sit

Settled by building it and looking, having got it wrong twice.

Each move is labelled in the row gap beneath its **source** node, stacked, as
`● Action → Target`. Labelling the line itself is the obvious alternative and
it is worse: a label pinned to a line has to dodge every other line and node,
which needs a collision search. A label in the row gap cannot collide with
anything, because one node per row means the gap below a node is empty across
the whole canvas. The cost is naming the target on every line, which the
format already does.

Two corrections came out of looking at the rendered output:

1. Labels start at their column's **centre line**, not the node's left edge —
   a same-column move draws its vertical at the centre, so left-aligned
   labels had that line struck through every one of them.
2. Labels grow **away** from that centre: spine labels rightward, rail labels
   leftward, both into the empty gutter between the columns. Rail labels
   growing rightward simply ran off the canvas and were clipped. Growing into
   the gutter means the canvas never has to widen to fit a label, and the two
   sides cannot meet because only one stage's labels occupy a given row gap.

Labels also carry a surface-coloured halo (`paint-order: stroke fill`), so a
backward move crossing the outside lane breaks around the text rather than
striking through it.

### Encoding

Colour and stroke carry `who`, because "who has to do this" is the question
staff actually ask and `Who` is already a first-class field on `MoveGroup`:

- `family` — accent stroke, solid
- `staff` — ink stroke, solid
- `both` — ink stroke, solid, labelled with both actors
- `automatic` — info stroke, dotted (enrollment's `route_to_review` and
  `flag_pending_items` are `actor: system`; signup has none, so this style is
  only exercised by the enrollment fixture)
- exits — away-tint stroke, dashed

Stage kind is a left stripe plus a caption: initial, active, terminal·finish.
Guards are a marker, not prose — the diagram says a move is conditional and
the Stages tab says on what. Reproducing guard text would duplicate `MoveRow`
and immediately drift from it.

### Exits

Exits render as a strip below the graph, not as edges. This is not a
shortcut: `ExitsPanel.tsx` already models cross-cutting exits as one rule
rather than per-stage transitions, precisely because authoring them per stage
is what produced twelve copy-pasted withdraw transitions in the enrollment
template. Drawing signup's eight `drop` transitions as eight arrows would
contradict the product's own model and bury the graph in spaghetti.

Each exit row names the target, the action, the source stages and the actor.

One rule per `MoveGroup`, NOT one per target. Signup's eight `drop`
transitions share an action and a target but split into two groups, because
leaving `confirmed` must also mark the committed enrollment row Withdrawn and
the other three stages have no committed row to mark. Collapsing them into a
single "Drop, from any stage" line would state something false about one of
them.

## Clicking a stage

Each stage node is a focusable group with `role="button"`, an accessible name,
`onClick` and Enter/Space handling. It calls `onSelectStage(stageId)`.

`EditorPage` owns the two-step reveal, because the target does not exist when
the click happens — the Stages tab is unmounted:

1. Park the `stage_id` in a **ref** and `setTab('stages')`.
2. An effect keyed on `tab` runs after the Stages tab has mounted, clears the
   ref and calls `revealStage`.

A ref rather than state: the pending id is a one-shot instruction to the DOM
and nothing renders differently because of it. Holding it in state would mean
clearing it from inside an effect, which is the cascading-render pattern
`react-hooks/set-state-in-effect` exists to stop — the lint rule caught this
on the first attempt.

The request is cleared whether or not the card was found. A stage missing at
that point has been deleted, and retrying on some later render would scroll
the page out from under whatever the author had started doing instead.

Focus moves, not just scroll: a keyboard user who activated the node must
land on the thing they asked for, so `revealStage` focuses the card's first
control (`StageCard`'s name input, marked with `data-stage-focus`).
`prefers-reduced-motion` suppresses smooth scrolling, and a missing
`scrollIntoView` must not cost the focus move.

`StageCard`'s root `<li>` gains `id={stageCardId(stage.stage_id)}` — the id
is built by the same helper the reader uses, so the two cannot drift.

The lookup is **`getElementById`**, not `querySelector`. Stage ids are
authored strings; `querySelector('#' + id)` THROWS on an id containing a
space, a quote, a dot, a hash or a leading digit, rather than returning null.
`getElementById` compares the id literally, so nothing an author can type
breaks it. (The spec previously proposed `CSS.escape` — `getElementById`
needs no escaping at all, which is strictly better.) The tests feed it exactly
those hostile ids, and swapping in `querySelector` fails four of them.

## Testing

Per `feedback_verify_by_mutation`: a green suite proves nothing until the test
has been shown to fail. Every assertion below gets checked by breaking the
code it covers and confirming red.

`editor/flow/__tests__/layout.test.ts` — pure, reusing the existing
`SIGNUP_MACHINE`/`ENROLLMENT_MACHINE` fixtures in
`editor/stage/__tests__/fixtures.ts`:

- signup splits spine/rail/exits exactly as tabulated above; enrollment too
- enrollment row order is the seven rows listed above
- every non-exit move becomes exactly one edge; counts match `model.groups`
- `pending_items -> in_review` and `offered -> waitlisted` are `backward`
- every `FlowEdge.from`/`to` names a node that exists in `nodes`
- `automatic` is produced for enrollment's two `system` transitions
- layout does not mutate its input (deep-equal the model before and after)
- each degenerate case in the table above renders every stage exactly once

`editor/flow/__tests__/geometry.test.ts` — pure:

- a same-column move runs down the column; a cross-column move leaves the
  side facing the gutter and enters via it; a backward move uses the outside
  lane and never the gutter
- a self-move and a dangling end draw nothing
- a corner is never rounded harder than half its shorter run
- labels grow away from their column's centre and stack within the row gap
- the canvas narrows when there is no rail and no backward move

`editor/flow/__tests__/FlowView.test.tsx` — jsdom:

- renders every stage as a button, every move as a humanised label
- the exit target is NOT drawn as a stage
- exits list as rules, both of signup's drop rules, with source stages named
- clicking a node reports the `stage_id`, not the display name
- Enter and Space activate; other keys do not
- every stage carries `tabindex` (lowercase — attribute lookup on an SVG
  element is case-sensitive, so `getAttribute('tabIndex')` returns null even
  when the element is focusable)
- `revealStage` scrolls, focuses the card's first control, returns false for
  a stage that is not rendered, survives a missing `scrollIntoView`, and
  resolves ids containing a space, a quote, a dot, a hash or a leading digit

### Test infrastructure

This suite had no DOM environment — every existing test is pure — so `jsdom`
and `@testing-library/react` are added as devDependencies. `environment`
stays `node` by default and the two files that need a DOM opt in per-file
with `// @vitest-environment jsdom`, so 300-odd pure tests pay nothing.

`vitest.config.ts`'s `include` was `src/**/*.test.ts` — **`.ts` only**. The
first component test file was therefore silently never collected: the suite
reported green while running none of it. That is the worst failure mode a
test config has, and it is why the include now names `.tsx` explicitly.

### Verifying the tests bite

Per `feedback_verify_by_mutation`, every assertion above was checked by
breaking the code it covers and confirming the suite goes red. Thirteen
mutations were run; all are killed. Two findings worth keeping:

- Two early mutants **survived**. One test ("distinct edge key per source")
  was vacuous — neither shipped template has a non-exit move group with more
  than one source stage, so it asserted a property it never exercised. It now
  builds that machine explicitly. The other pair of mutants was genuinely
  equivalent: the exit-exclusion is guarded in two redundant places, and
  removing either alone changes nothing. Removing both fails three tests, so
  the behaviour is protected — the redundancy is deliberate and each guard
  also covers something the other does not (exits vs a dangling `to`).
- The rendered output was also inspected in a browser against both templates.
  Two real defects came out of that which no unit test would have caught —
  the label placement corrections above.

## Fixing the chat panel itself

The Flow tab gives the assistant somewhere better to point, but it does not
make a message containing a fenced diagram render correctly, and the model
will keep emitting them until told not to. Both halves are needed.

**Renderer.** `splitFences` (`components/chat/markdownFences.ts`, pure)
tokenizes a message into fenced and non-fenced segments, and `Markdown`
renders fenced ones as a horizontally scrolling `<pre>`. Order is the whole
fix: fences come out first, and only the non-fenced text is split on blank
lines.

Three details that are not obvious:

- **An unterminated fence is code, not prose.** Replies stream token by
  token, so for most of a reply's life the closing fence has not arrived. A
  prose fallback would render the drawing mangled on every frame and then
  snap into place at the end.
- **A fence closes only on the same character, at least as long.** So a
  ``` inside a `~~~` block is content, not a terminator.
- **`font-variant-ligatures: none`** on the `<pre>`. Box-drawing characters
  line up only when every cell is one width; ligatures and contextual
  alternates break that.

The `<pre>` scrolls sideways rather than reflowing, because reflowed
monospace is exactly what "unreadable" looked like. The bubble is already
bounded at 90% of a full-width row, so it scrolls inside rather than pushing
the panel wider.

**Prompt.** `SYSTEM_PROMPT` now states the panel's real width (~45
characters), forbids ASCII art and box drawing outright, and gives the
replacement format: one short line per stage naming its moves and who
performs each, with exits stated separately as a rule. It also points the
admin at the Flow tab when a workflow is open.

**admindash carries a byte-identical `Markdown.tsx`.** The fix, the CSS and
the tokenizer tests are mirrored there; leaving one copy broken would also
leave the two divergent. Its `vitest.config.ts` had the same `.ts`-only
include and is fixed too.

## The chat flow card

Asked to show a workflow, the assistant now calls `show_flow` and the drawer
renders a card: the spine, the actor on each move, the exit rules, and a
button into the Flow tab. It draws nothing with characters — that is the
point.

**Transport.** The card rides `ChatDeps.pending_proposals` and arrives as a
`proposal` SSE frame with `action: "show_flow"`. It is not an offer to write,
and the naming is a compromise made deliberately: `stream.py` is a VERBATIM
port shared with admindash whose own header calls a change to the frame set
"a protocol fork, not a local change". Adding a `flow` frame type would fork
the wire protocol for both services over a card only one of them has. So
"proposal" is the transport's name, not the meaning, and
`renderProposalCard` is where the distinction is drawn — `show_flow` routes
to a read-only card with no Apply and no origin pin, because nothing it does
can touch a draft.

**Where the machine comes from**, in order:

1. the open draft, via a new `EditorBridge.read()` — unsaved edits included;
2. otherwise `getBundle`.

Step 1 is the reason `read()` exists. The assistant is most often asked about
the workflow the admin is editing, and that draft usually differs from the
saved row; a card showing the saved shape beside an editor showing edited
work is a card that lies. `read()` is safe for the same reason `apply` is —
the handle is replaced on every machine/steps change, so the closure cannot
go stale. It is read during render, exactly as `PatchCard` reads the bridge.

**How the button opens the tab.** The editor's open tab now lives in
`?view=`, derived from the URL rather than held in state. The card just
navigates. This replaced a first attempt that kept the tab in state and
synced it from a one-shot param in an effect — which tripped
`react-hooks/set-state-in-effect`, and was worse anyway: deriving from the
URL means no effect, no param to strip, no window where the two disagree, and
the tab survives a reload or a shared link.

**What the card shows** is decided by `summariseFlow` (pure): the spine, the
move between each consecutive pair, the rail collapsed to one "Detour:" line,
and every exit rule. Both of signup's drop rules are listed rather than
merged, for the same reason the Flow tab lists them separately.

`show_flow` refuses, without queueing a card, when: no workflow is open and
none was named; the row 404s; or the row's stored definition does not parse
(the card would draw an empty diagram and explain nothing). A DataCore
outage is never reported as "not found" — the same split `get_workflow`
makes, and for the same reason: it would push the model toward offering to
CREATE a workflow that already exists. Repeat calls in one turn queue one
card.

### Getting to it from a standing start

Two default quick-action chips ask for the card: `Show me the flow of this
workflow` and `Draw the flow of one of my workflows` — the two paths
`show_flow` supports, since its `entity_id` defaults to the open draft.

Their **wording is load-bearing**. `SYSTEM_PROMPT` routes "see, show, draw,
visualise or explain the shape of" to `show_flow`; a chip phrased around any
other verb returns prose instead of a card. `quickActions.test.ts` pins that
coupling, with the verb list copied from the prompt and a comment saying
where it came from.

Two, not four. An earlier pass added "Who does what…" and "Where can this
end up?" as well, which read fine in isolation and were wrong in place: chips
sit between the transcript and the input, so each one costs transcript
height, and the card already answers both questions. The chip area is now
also capped (`max-height`, then it scrolls) — at 380px every chip is its own
row, and a full set of ten squeezed the transcript to nothing. That was
reachable through the chip editor long before these defaults grew.

**Known gap, not fixed here:** the default chips are English string
literals while the surrounding chrome is bilingual, so a zh-CN admin sees
English chips. Pre-existing. Fixing it means the defaults become i18n keys
and `loadQuickActions` has to distinguish "nothing stored" from "stored", so
it is a change to the persistence contract rather than a string edit.

## A CSS bug class, and the guard for it

`FlowCard.css` first shipped referencing `--border-default`, which does not
exist — theme.css's compatibility block defines `--border-primary`. An
undefined custom property with no fallback resolves to nothing, so
`border: 1px solid var(--border-default)` silently draws **no border**.
Nothing fails, nothing warns; the only symptom is a component that looks
slightly wrong in a screenshot.

`styles/__tests__/tokens.test.ts` now audits every `var(--x)` in every
stylesheet under `src/` against the two token layers. It found two
pre-existing instances beyond the one that prompted it:

- `EditorPage.css` used `var(--font-size-sm)` with no fallback — the
  declaration was being dropped entirely.
- `editor.css` used `--color-border` / `--color-surface` /
  `--color-text-muted` / `--color-warning-text` in ~28 places, each with a
  hardcoded fallback. Those rendered, but with off-theme literals instead of
  following the theme.

Both are fixed; the fallbacks made the intended mapping unambiguous. The
audit checks references that HAVE a fallback too: a fallback is a deliberate
default, not a licence to name a token that does not exist, and
`var(--typo, var(--also-typo))` is the shape that hides this best.

## Risks

**The layout is new code with no upstream test coverage.** Mitigated by
keeping it pure and testing it against both shipped templates, which between
them exercise a branch, a rejoin, two backward edges, a system actor, a
non-uniform exit and a resting non-finish stage.

**Row assignment could produce a tall diagram for a long workflow.**
Enrollment is seven rows and fits. A workflow substantially longer than that
will scroll vertically. That is acceptable for a read-only view and is the
cost that treatment A would have traded for horizontal scrolling instead.

**The reveal effect depends on render timing.** If the Stages tab mounts
asynchronously the lookup could miss. The tab is a plain conditional render,
so it mounts in the same commit; the effect runs after. The test asserting
focus lands on the right card is what keeps this honest.
