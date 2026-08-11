# Stage-centric workflow editor — design

**Status:** approved 2026-08-10, pending implementation plan
**Scope:** the ApexFlow designer's authoring surface (`apexflow/frontend/src/editor/`).
Replaces the Machine tab with a stage-centric editor. **No engine, schema, or
validator changes** — this is an authoring layer that reads and writes the existing
`workflow_definition.machine`/`steps` JSON.
**Does not include:** template crowd-sourcing/sharing, cross-tenant model portability,
new guard/effect primitives, or the AdminDash home page.

## Problem

The designer asks a school administrator to build a finite state machine. Not
metaphorically — literally. To produce a valid workflow they must know that a machine
needs exactly one `initial` state, at least one `terminal` state, that every non-terminal
state requires an outgoing transition, and that steps do not belong to states but declare
which states they are `available_in`.

Three concrete failures follow from that, all measured rather than asserted:

**1. The editor opened hostile.** A new workflow was seeded with
`{states: [], transitions: []}`, which fails `validate.py`'s `_state_errors` immediately.
Every new workflow greeted its author with a red error rail before they had done anything.

**2. The obvious corrective action made it worse.** `newState()` hardcoded
`kind: 'active'`, so adding a state left both cold-start errors standing and added a third
(`"non-terminal but has no outgoing transition"`). Error counts went **2 → 3 → 4** as the
author tried to fix them.

> Both of these are already fixed — commits `6a8375d` and `cadd3b8` — but they are the
> evidence that the model, not the polish, is the problem. They were symptoms.

**3. The vocabulary and the direction are both wrong.** The UI says "states" and
"transitions"; the enrollment template's actual states are `draft`, `submitted`,
`in_review`, `approved`, `enrolled` — what a registrar calls *stages of an application*.
And a registrar thinks "during review, staff check the documents" (step belongs to stage),
while the UI requires opening the step and ticking which stages it appears in. Same data,
inverted, and split across two tabs so both halves are never visible at once.

## What the editor must express

Measured from the shipping enrollment template (`build_machine()`), the only real
workflow that exists:

| | |
|---|---|
| States | 9 (`draft`, `submitted`, `in_review`, `pending_items`, `approved`, `enrolled`, `waitlisted`, `declined`, `withdrawn`) |
| Transitions | 23 |
| **`withdraw` transitions** | **12** (6 stages × 2 actors) |
| `decline` transitions | 2 |
| Real progress moves | 8 |
| Outgoing edges on `in_review` | 6 |
| Terminal states | 3 |

**Over half the machine is one rule copy-pasted.** "A family or staff member may withdraw
at almost any point" is authored today as 12 separate transition rows. Removing those, the
remaining shape is a spine with two branches and one send-back loop:

```
draft → submitted → in_review → approved → enrolled
          ↘ waitlisted ↗          ↘ declined
                  ↕ pending_items (send back / resubmit)
```

That collapse is what makes a stage-centric editor viable at all.

## Decisions

| Decision | Ruling |
|---|---|
| Primary use case | **An admin adapting a template to fit their school.** Not construction from nothing. This is the design center; every trade-off resolves toward it. |
| Cross-cutting exits | **Separate Exits panel.** Authored once as a rule, expanded to per-stage transitions on save. |
| Guards and effects | **Plain-language rules with an escape hatch.** Common primitives render as sentences; anything unrecognised falls back to the existing composer. |
| The Machine tab | **Replaced outright.** One editor, one model, no drift. |
| Building from scratch | **Supported but not optimized.** Starts from a seeded skeleton or a shape, never a blank canvas. |
| Crowd-sourced templates | **Deferred.** See "Out of scope" — its blocker is model portability, not authoring. |

## The stage model

A one-to-one mapping onto the existing machine. Nothing new is stored.

| Editor concept | Machine concept |
|---|---|
| Stage | `StateDef` |
| "Starts here" (first stage) | `kind: 'initial'` |
| "Finished" (last stage) | `kind: 'terminal'` |
| Move | `TransitionDef` |
| Who can do it | `actor` **and** the `actor_role` guard |
| Only when | `guards[]` |
| What happens | `effects[]` |
| Steps in a stage | steps whose `available_in` contains that state |
| Exit | a set of transitions sharing an action and target |

Two consequences worth stating:

**`initial`/`terminal` become position, not a property.** Today they are a radio group per
state, which is how a machine thinks. In the stage editor the first stage starts the
workflow and the last finishes it. The `kind` field is still written; the author never
picks it.

**Steps move inside stages.** The Steps tab disappears. A step is created within the stage
it happens in, and `available_in` is written from that placement. A step appearing in
several stages is expressed by adding it to each — the same data, authored in the
direction people think.

## Exits

An exit is exactly five things. This is the shape of the two real exits, read from
`_withdraw_pair()` and the decline transitions — not a guess.

1. **What it's called** — the action name (`Withdraw`, `Decline`).
2. **Who can do it** — family / staff / admin / automatic.
3. **From which stages** — the scope.
4. **Only when** *(optional)* — guards.
5. **Where it lands, and what happens** — the target terminal stage, plus effects.

### Scope is a rule with exceptions, not a checkbox list

The default reads *"any stage before the finish"*, with every stage listed beneath it and
ticked, so the author can untick specific ones (`no withdrawing after Approved`).

The reason to prefer a rule is a failure that is invisible with a list: adding a `Payment`
stage six months later silently leaves it un-withdrawable, and nothing on screen looks
wrong. With a rule the new stage is covered the moment it exists. The card shows a live
expansion count — `expands to 12 transitions · 6 stages × 2 actors` — so the author can
see how far the rule reaches.

### One redundancy to collapse

"Who" is currently stored **twice**: as the transition's `actor` field and as an
`actor_role` guard (`_withdraw_pair` writes `actor: "family"` alongside
`guards: [{primitive: "actor_role", params: {roles: ["family"]}}]`). The single "Who can
do it" control writes both, so they cannot drift.

## Guards and effects

Common primitives render as sentences on the move they belong to:

| Primitive | Rendered as |
|---|---|
| `items_in_status` | "only if the application form is complete" |
| `capacity_available` | "only if there is space" |
| `date_window` | "only during the enrolment window" |
| `commit_sections` | "creates the student and family records" |
| `send_email` | "emails the family" |
| `set_entity_field` | "records the decision on the application" |

Anything without a phrase renders as its raw primitive name with its params, and every
move carries an **"Edit as advanced"** control that opens today's `GuardEffectComposer`
unchanged. The phrase set is additive: an unrecognised primitive degrades to the raw view
rather than being hidden or dropped.

### Coverage, counted

There are **12 primitives** in `GUARDS` + `EFFECTS` today. The table above phrases **6**.
The remaining 6, and their disposition:

| Unphrased primitive | Disposition |
|---|---|
| `actor_role` | **Never needs a phrase** — it is absorbed into the "Who can do it" control. |
| `all_blocking_items_complete` | Needs one: "only if every required step is done". |
| `data_condition` | Needs one, and it is the hardest — it wraps an arbitrary expression. Likely renders a summary plus "Edit as advanced". |
| `issue_link` | Needs one: "sends the family a link". |
| `set_context` | Needs one: "records {key} on the application". |
| `start_due_clocks` | Needs one: "starts the document due dates". |

**This is the highest-maintenance decision in the design.** Every new primitive needs a
phrase or it silently falls back to raw. The plan must include a test asserting that every
member of `GUARDS`/`EFFECTS` either has a phrase or appears on an explicit raw-only
allowlist — so a primitive added later fails the suite rather than quietly degrading in
front of an admin.

## Building from scratch

Supported, not optimized. Two guardrails, both cheap:

- **Never a blank canvas.** New workflows already seed `draft --submit--> done`
  (commit `6a8375d`), which validates with zero errors. The editor may later offer shapes
  (linear · review-and-approve · request-and-fulfil) but the seeded skeleton is the floor.
- **Adding a stage always moves toward valid.** New stages fill the missing role
  (commit `cadd3b8`) rather than defaulting to `active`.

The stage editor does not need to express every machine the engine can accept on day one.
It needs to express the shapes real workflows take. See Risks — that is currently an
n=1 claim.

## Migration

The Machine tab is removed. Since the stage editor reads and writes the same
`machine`/`steps` JSON, existing definitions open in it with no data migration: stages are
read from `states`, their order from the transition graph, moves from `transitions`, and
exits by grouping transitions that share an action and target.

**Exit grouping is inference, and inference can be wrong.** Twelve `withdraw` transitions
to `withdrawn` group cleanly into one card. A hand-authored machine with irregular
per-stage variations may not. The rule: any transition that does not fit a group renders
as an explicit move on its stage, never silently dropped. A definition must round-trip —
open and save with no edits must produce an equivalent machine. This is the single most
important correctness property in the whole feature and the plan must pin it with a test
over the real enrollment template.

## Risks

**Coverage is unproven at n=1.** Enrollment is the only template that exists
(`template_catalog()` returns one entry). The stage model handles linear-with-branches
well; it would misrepresent a genuinely non-linear process ("any of these five things in
any order"). Removing the Machine tab on the strength of one fitting example is the main
risk in this design. **Mitigation: write a second template (signup) before building the
editor.** It is needed regardless, costs far less than the editor, and is the only way to
learn whether the abstraction holds before committing to it. If signup does not fit, this
decision reverts to keeping an escape hatch, and that is far cheaper to discover with a
template than halfway through an editor.

**The plain-language phrase set is ongoing cost.** Mitigated by the coverage test above.

**Exit inference on open.** Mitigated by the round-trip test above.

## Out of scope

- **Crowd-sourced/shared templates.** Deferred deliberately. Its blocker is not authoring
  but **model portability**: a template references 40 field names across 4 entity models,
  and `seed_enrollment_template`'s own docstring records that publishing 409s "if the
  template fails to validate against the tenant's CURRENT models". Base fields
  (`launchpad/backend/app/data/base_model.json`) are universal; custom fields are
  per-tenant, so a template touching custom fields cannot publish at another school.
  `definition_health` already *detects* this; nothing *resolves* it. Sharing built before
  portability would mostly distribute templates that will not publish.
- **New guard/effect primitives.** The editor exposes what exists.
- **Engine, schema, or validator changes.** If the editor appears to need one, that is a
  signal the stage model does not fit — escalate rather than widen the engine.
- **The AdminDash home page**, which has its own pending spec.

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
