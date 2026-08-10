# Ruling — does the stage model cover the signup template?

**Date:** 2026-08-10
**Question posed by:** `docs/superpowers/specs/2026-08-10-stage-centric-workflow-editor-design.md`,
"Risks" — *"Coverage is unproven at n=1. … Removing the Machine tab on the strength of
one fitting example is the main risk in this design. Mitigation: write a second template
(signup) before building the editor. … If signup does not fit, this decision reverts to
keeping an escape hatch."*

**Evidence:** `apexflow/backend/app/templates/signup.py` (shipped),
`apexflow/backend/tests/test_signup_template.py` (30 tests), and a live seed against
DataCore. Every claim below names transitions, not impressions.

---

## Verdict

**The stage model covers signup. Decision 3 stands: the Machine tab is replaced outright,
no escape hatch.**

But the coverage test did its job — it found **three defects in the design as written**.
All three are in the *editor* layer, none in the engine, and all three are cheap now and
expensive after the editor ships. They are listed as required amendments below, and the
implementation plan carries a task for each.

The strongest evidence that the abstraction holds is negative: writing signup did **not**
require a machine shape the stage model cannot draw, did **not** require a new primitive,
and did **not** require an engine, schema, or validator change. It publishes with zero
validator errors against four real dev tenants' live models
(`acme`, `acme-afterschool`, `ruskin`, `afterschool-abc`), including `acme-afterschool`,
which carries Papermite-extracted custom fields.

---

## The template that was written

`signup` — family self-serve program signup. Deliberately *not* a smaller enrollment; it
was designed the way an afterschool program signup actually works, and then measured.

| | enrollment | signup |
|---|---|---|
| States | 9 | 6 |
| Transitions | 23 | 15 |
| Exit transitions | 12 (`withdraw`) + 2 (`decline`) | 8 (`drop`) |
| Real progress moves | 8 | 5 |
| Terminal states | 3 | 2 |
| Staff review tier | yes (`in_review`) | **none** |
| Documents tier | yes | **none** |
| Spine length | 5 stages | 2 stages |

```
draft ──submit(room)──────────────► confirmed ──complete_program──► completed
  │                                    ▲
  └───submit(full)──► waitlisted ──offer_spot──► offered
                          ▲                │
                          └─decline_offer──┤   (family)
                          └─rescind_offer──┘   (staff)

drop: any of {draft, waitlisted, offered, confirmed} → dropped, family or staff
```

---

## What the stage abstraction draws natively

These need no new concept in the editor. Each names the transitions it covers.

1. **The spine.** `t_submit_confirmed` (`draft → confirmed`) and `t_complete_program`
   (`confirmed → completed`). Two stages of forward progress, read straight off the
   transition graph exactly as the design's Migration section describes.

2. **A capacity branch off the first stage.** `t_submit_confirmed` and
   `t_submit_waitlisted` share `(from="draft", action="submit")` and differ only by the
   `capacity_available` guard on the first. This is the same shape enrollment's
   submitted-vs-waitlisted branch takes, and the "Only when" plain-language row renders
   it: *"only if there is space"*.

3. **A side loop that rejoins the spine.** `t_offer_spot` (`waitlisted → offered`) and
   `t_accept_offer` (`offered → confirmed`). Two moves on two side stages, rejoining at
   `confirmed`.

4. **A backward move that is not a send-back pair.** `t_decline_offer`
   (`offered → waitlisted`, family). Enrollment's only backward edge was the
   `in_review ↔ pending_items` send-back/resubmit pair, so this was untested. It draws
   fine: a move on the `offered` stage whose target is an earlier stage.

5. **A cross-cutting exit authored as one rule.** `drop` reaches all four non-terminal
   stages for both actors — 8 transitions from one rule, generated in the template by
   `_drop_pair()` over `DROPPABLE_STATES`. This is precisely the Exits panel's case, and
   the live expansion count would read *"expands to 8 transitions · 4 stages × 2 actors"*.

6. **The `actor` / `actor_role` redundancy.** Every `drop` transition carries both
   `actor: "family"|"staff"` and a matching `actor_role` guard, exactly as
   `_withdraw_pair` does. The single "Who can do it" control writing both is confirmed
   correct at n=2.

7. **Unordered work inside a stage.** Signup collects three sections in one `signup_form`
   step. "Any of these in any order" — the shape the design's Risks section worried the
   stage model would misrepresent — turns out to live in the **item/step** layer, not the
   machine, in both templates. The machine stayed linear-with-branches because that is
   what the machine is *for*. This materially reduces the risk the design flagged.

---

## What it draws awkwardly

8. **`confirmed` is a resting stage that sits at the end of the spine but is not the
   finish.** A signup rests in `confirmed` for the length of the program and still accepts
   `t_drop_confirmed_family`, `t_drop_confirmed_staff`, and `t_complete_program`. It is
   therefore `kind: "active"`, while `completed` — which nothing leaves — is the terminal.

   The design says: *"`initial`/`terminal` become position, not a property. … the first
   stage starts the workflow and the last finishes it."* Under that rule an author who
   places `Confirmed` last gets `kind: "terminal"` written for them, and then
   `machine.allowed_actions()` returns `[]` for every actor in that stage
   (`machine.py:370`) — the `Drop` exit and `Complete program` move are still *fireable*
   by a direct POST but are never *advertised*, so both silently vanish from the staff and
   family UIs. Pinned by `test_confirmed_still_accepts_moves_and_is_not_closed`, which
   fails when `confirmed` is flipped to `terminal`.

   This does not break the stage model, but it does break the stated inference rule. See
   Amendment A.

9. **One edge, two actions, two actors.** `t_decline_offer` (family) and
   `t_rescind_offer` (staff) both run `offered → waitlisted`. They are different moves
   with different effects — only the staff one sends
   `send_email{template: "signup_offer_expired"}`. An editor that drew "one line per
   (from, to) pair" would merge them and lose an actor and an effect. The design never
   says grouping is keyed on `(from, to)` — it says exits group on *action and target* —
   so this is a warning for the rendering, not a defect in the model. Pinned by
   `test_two_distinct_actions_share_the_offered_to_waitlisted_edge`.

---

## What it cannot draw as specified

10. **The `drop` exit is not uniform across its own scope — and the specified grouping key
    cannot express that.** All eight `drop` transitions share an action (`drop`) and a
    target (`dropped`). But dropping from `confirmed` must additionally run
    `set_entity_field{ref: "enrollment", field: "status", value: "Withdrawn"}`, and
    dropping from `draft`, `waitlisted`, or `offered` must **not** — there is no committed
    `enrollment` row in those stages, and `primitives._effect_set_entity_field` raises
    `HTTPException(409, …)` when it cannot resolve the ref out of `subject_refs`.

    This is not a stylistic preference. It is enforced: mutating the template so all eight
    transitions carry the effect makes `test_family_drop_from_draft`,
    `test_staff_drop_from_waitlisted`, and `test_family_drop_from_offered` fail with a real
    409, and mutating it so none do makes
    `test_drop_from_confirmed_marks_the_enrollment_withdrawn` fail.

    The design specifies exit grouping as *"a set of transitions sharing an action and
    target"* (the stage-model table) and again in Migration as *"exits by grouping
    transitions that share an action and target"*. Under that key, all eight `drop`
    transitions collapse into **one** card, and that card cannot represent two effect
    shapes. Opening the signup definition and saving it unchanged would therefore write
    back either eight transitions that all carry the effect (breaking three drops with a
    409) or eight that carry none (silently dropping the enrollment status update).
    **Either way, the round-trip property — the design's own "single most important
    correctness property" — fails on the second template that exists.**

    Pinned by `test_the_drop_exit_is_not_uniform_across_its_scope`. See Amendment B.
    This is a defect in the specified grouping key, not in the stage abstraction: the fix
    is one more field in the key, and the model is unchanged.

---

## Required amendments to the design

**A. Terminal is not "last on the spine". It is "has no outgoing move".**

Replace the rule *"the first stage starts the workflow and the last finishes it"* with:

- `kind: "initial"` — the stage with no inbound move from another stage (still exactly one).
- `kind: "terminal"` — **any stage with no outgoing move**, which is what
  `validate.py::_outgoing_transition_errors` already enforces from the other direction.
- `kind: "active"` — everything else, including a stage that sits last on the spine but
  still has moves leaving it.

The author still never picks `kind`; it is still derived from position in the graph. It is
just derived from the right property. The editor must also warn when an author removes the
last outgoing move from a stage, because that silently turns it terminal and closes the
instance.

**B. Exit grouping keys on `(action, target, actor, guards, effects)` — everything except
`from`.**

An exit card is a set of transitions identical apart from their source stage. Under this
key signup's `drop` yields **two** cards — "Drop (from Draft, Waitlisted, Spot Offered)"
and "Drop (from Confirmed) · marks the enrollment withdrawn" — both correct, both
round-tripping. Enrollment's twelve `withdraw` transitions still collapse into exactly one
card, because they *are* identical apart from `from`; the stricter key costs enrollment
nothing.

The design's existing fallback rule is unchanged and still load-bearing: any transition
that does not fit a group renders as an explicit move on its stage, never silently dropped.

**C. Write the phrase-allowlist test before the phrase set.**

Between them the two templates exercise **7 of the 12** primitives — guards
`actor_role`, `capacity_available`, `items_in_status`; effects `commit_sections`,
`send_email`, `set_entity_field`, plus `start_due_clocks` (enrollment only) and
`issue_link` (signup only). The design's phrase table covers 6 primitives and misses
`issue_link`, which signup's `t_offer_spot` uses, so an admin opening the signup template
today would already meet a raw-primitive fallback on the very first exit they inspect.

The design already calls for a test asserting every member of `GUARDS`/`EFFECTS` either
has a phrase or sits on an explicit raw-only allowlist. Signup confirms it is needed
rather than theoretical, and it must be written **before** the phrase set, so the phrase
set is completed by making a failing test pass rather than by inspection.

---

## Findings that are not the editor's problem

Logged so they are not rediscovered, and explicitly **out of scope** for the editor work.

- **No form field can reference an existing entity.** There is no `entity_ref` field type,
  `set_entity_field.value` is a static authoring-time literal with no context templating,
  and a section bound to `program` in `match_or_create` mode would create a program per
  signup (`primitives._MATCH_STRATEGIES` has no `program` strategy). The signup template
  therefore picks `program_id` as a plain typed field the family fills in. Enrollment hit
  the same wall for `school_year` (its docstring, decision 7). This is the first thing a
  third template will want.
- **`capacity_available` reads its ceiling from the tenant row, not the scoped entity.**
  Signup scopes counting on `context.program_id` but still measures against the tenant's
  single `capacity` field, so every program shares one ceiling. Same imprecision
  enrollment already lives with.
- **Transitions out of a terminal state execute but are never advertised.**
  `machine.allowed_actions` short-circuits to `[]` at terminal (`machine.py:370`) while
  `_run_transition_action` does not check terminal at all. Amendment A avoids the trap;
  the asymmetry itself remains.
- **Bytecode caching hid a mutation-test result during this work.** Two same-byte-length
  mutations within one second of each other left a stale `.pyc` whose `(mtime, size)`
  matched, so pytest ran the *previous* code and reported a false result. Every mutation
  in this ruling was re-run with `__pycache__` cleared. Any future mutation testing in this
  repo must clear it between runs.
