# Registration Plan 4 (Flow Builder & Staff Channel) — follow-ups

Plan 4 merged into `docs/registration-flow-design` at `d294206` (29 commits,
enrollx backend 491 → 504 tests). The whole-branch review cleared it after one
fix wave plus two targeted corrections.

Companion doc: `2026-08-03-registration-plan3-followups.md`.

## Blocking — do this first

1. **`publish_config` has never been exercised end-to-end against a live
   backend.** The whole-branch review found that `ConfigBuilderPage` was sending
   the business `config_id` where DataCore's `entity_id` is required — publish
   always 404'd, so no config ever reached `status='published'`,
   `create_application` 404'd in turn, and **every page this plan built was
   unreachable**. It survived eleven task reviews because no build, lint or
   typecheck in this repo can see it, and there is no frontend test framework.

   The fix is in (`saveDraft` returns the entity id on both paths) and a backend
   contract test now pins the contract — `test_actions_config.py` asserts a
   business-style id 404s *and* that the row is still `draft` afterwards. But the
   **frontend path remains unverified**. Do this by hand before trusting the
   feature:
   1. Publish a config from the builder.
   2. **Query DataCore directly** to confirm the row reached `status='published'`
      — the UI sets its own state optimistically, so the screen looks right
      either way.
   3. Create an application from that program; confirm `201`, not the old `404`.

2. **Six manual smoke steps from Task 11 still need a human.** Recorded as a
   hand-off checklist, not marked passed: nav/i18n toggle, builder walkthrough,
   staff-assisted entry, the pipeline view, the detail page, and the guard check.

## Money path

3. **An offline deposit strands the balance.** `record_offline_payment` always
   sends the default `kind="offline"`, but `_deposit_already_paid` looks for
   `kind='deposit' AND status='paid'`, and `_ensure_balance_obligation` only ever
   runs from the Stripe webhook. So an offline deposit verifies the payment item,
   creates **no** balance item, sends no reminder, and `_open_payment_item` then
   409s on any later balance checkout — the balance is never collected. Plan 4
   added a warning in the UI; the backend gap is Plan 3's and is still open.
4. **`settle_payment_item` verifies an item regardless of the amount recorded.**
   There is no server-side check that an offline payment covers what is due.
   Plan 4 now prefills the derived amount, but staff can still overwrite it with
   any value and mark the item satisfied.
5. **`flushAutosave` doesn't await.** Navigating away from a step flushes the
   pending draft save but doesn't wait for it, so the "amount shown ≠ amount
   charged" window narrows from 1500 ms to one in-flight round trip rather than
   closing. Gating Pay on a `dirty` flag would close it.
6. **`money.ts` hardcodes `currency: 'USD'`** and passes `undefined` as the
   `Intl` locale, while `payment_plan.config.currency` exists and is threaded
   through to Stripe. Consistent only because the builder hardcodes `'usd'`.

## Scale

7. **The `LIMIT 1000` caveat on `ApplicationsPage`.** Moving the `school_year`
   filter client-side (necessary — it's a single-writer field and belongs
   nowhere near a SQL predicate) means the limit now applies *before* the year
   filter. Past ~1000 applications per tenant across years, a year filter can
   silently under-report. The page stays internally self-consistent, which is
   what makes it hard to notice. **The fix is server-side pagination or a
   materially higher limit — not putting `school_year` back in SQL.**

## Consistency / polish

8. `DocumentsBlock` still matches items by `title === doc.name`. Plan 4 removed
   the host-side duplicate, so this is now the single remaining title match — and
   it determines the `itemId` sent to the backend.
9. `ApplicationDetailPage` doesn't reset its `loaded` flag when `applicationId`
   changes; navigating between two detail routes without unmounting shows the
   previous application's data until the fetch resolves.
10. Two CSS token vocabularies across the new pages (`--ink`/`--surface`/`--line`
    vs `--text-primary`/`--bg-card`/`--border-primary`), harmless only because
    `theme.css` aliases one onto the other and there is no dark mode.
11. Cross-file CSS class dependencies — `.page-header`, `.programs-muted`,
    `.bcp-row` live in one page's stylesheet and are used by four others. A
    `styles/common.css` would cost ten minutes.
12. Load/error/retry states diverge across the five new pages.
13. `ModelContext`'s `getModel` identity changes on every `setCache`, so consumer
    effects re-run and re-fetch once per distinct entity type; no in-flight
    dedupe either.
14. Duplicated "is this block done" logic in three places with two shapes;
    `isDone` written three times.
15. `config_id` is reused across versions as a lineage id — deliberate but
    undocumented, in a codebase already carrying a lot of identifier confusion.
16. Copied admindash components still carry admindash comments
    (`StatusBadge.css` references `BulkReviewTable.css`; `Toast.tsx` describes
    AdminDash).
17. Danger toasts announce `aria-live="polite"`; failures should be `assertive`.
18. `/settings/payments` is linked from both `AppNav` and `HomePage`.

---

## The identifier trap, for the record

Rows carry **two ids that never match**: DataCore's `entity_id`, and a business
id the enrollx engine generates separately (`application_id` on applications,
`item_id` on items, `config_id` on configs). **The backend keys on `entity_id`
everywhere** — `get_entity` filters on it, and the backend's own test suite uses
`item["entity_id"]` at every call site.

This bit Plan 4 **four times**: Task 8 shipped it (caught in review), Tasks 9 and
10 caught it pre-emptively once the rule was promoted into the standing dispatch
context, and Task 7's `publish_config` call survived all the way to the final
review. **The failure is silent** — pages load, autosave works, and only the
actual actions 404.

`document_id` is the one genuine exception: DataCore sets
`entity_id = document_id` for documents, so passing it is correct there.

## Plan defects found in Plan 4

Six, all of the same family as Plan 3's eleven — plan text authored code
snippets from memory of an API rather than binding against real interfaces:

1. Task 0's branch instruction (`git checkout main`) would have dropped Plans 1–3.
2. The document proxy routes the plan listed as an existing "binding contract
   consumed" did not exist; Task 10 needed a carve-out from the plan's own
   "zero backend code" rule to build them (the roadmap assigns them to Plan 4).
3. `useToast` was mandated for every mutation but did not exist; Task 5 built it.
4. Briefs 2–4 used `flowT` in 29 places, which would have silently broken
   language switching inside any memoized block.
5. `ReviewBlock`'s done-check used `some` where `every` was meant, marking
   partially-complete sections done.
6. Nothing in the plan says who enforces `payment` ↔ `payment_plan` coherence;
   the answer (only the builder can, since Plan 4 cannot touch `validate_blocks`)
   fell out of Task 0's gap analysis rather than the plan text.

The countermeasure that worked: generate the interface map **first, from the
code**, and have every dispatch cite it. Carry that into Plan 5.
