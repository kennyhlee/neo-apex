# Registration Plan 5 (FamilyHub Family Channel) — follow-ups

Plan 5 merged into `docs/registration-flow-design` at `b854092` (19 commits,
familyhub 1 → 98 tests). The whole-branch review found **no Critical** and
cleared it after one fix wave plus one regression fix.

Companions: `2026-08-03-registration-plan3-followups.md`,
`2026-08-03-registration-plan4-followups.md`.

## Blocking — before familyhub is deployed

1. **`TRUST_ALL_IPS` must be unset in production, and familyhub must genuinely sit
   behind Cloudflare.** Plan 5 wired `CloudflareIPMiddleware` so the rate limiter
   keys on the real client IP rather than the proxy's. That improvement holds only
   under two deployment facts that don't exist yet — familyhub has no `fly.toml`
   and no `deploy.yml` entry. **With `TRUST_ALL_IPS=1` set in production, the
   allowlist and the header trust collapse together and any client can mint
   unlimited rate-limit keys — strictly worse than what it replaced.** If familyhub
   is ever exposed on Fly *without* Cloudflare in front, the allowlist fails
   closed (total 403) — a visible outage, not a silent bypass, which is the right
   failure direction. Put both assertions in familyhub's deploy checklist.

2. **The document-authorization seam has never been exercised end-to-end.**
   `DATACORE_R2_*` is absent from the environment, so `datacore/documents.py`
   raises `KeyError` → 500 → familyhub masks it to 502, and no document row can be
   created. The code was reviewed line-by-line, every spoof path enumerated and
   closed structurally, and the mutation checks bite — but **the one thing only a
   live run can confirm is that the two `uploaded_by` format literals agree across
   a process boundary.** Once R2 test credentials exist, re-run specifically:
   the cross-application `document_id` refusal, and that a parent upload lands as
   `parent:{application entity_id}`.

3. **The browser click-through remains undone.** Task 12's runbook ran 6 passed /
   3 substituted / 1 skipped / 0 failed, with the UI steps done via equivalent API
   calls. What's outstanding and needs a human: the Flow Builder walkthrough, the
   visual/mobile Approved-banner render, the request-link page with real email
   delivery, and the full browser happy path — which is the plan's actual
   acceptance gate.

## Frontend resilience

4. **`RegisterPage`'s cold-resume path still collapses a transient error into
   "invalid link".** Same defect class as the one the fix wave closed on `HubPage`,
   but narrower: it fires only on a parent's *first* cold `?token=` resume, when no
   work is in flight and no successful action can be misreported, and the fallback
   is self-recovering (the "request a new link" CTA issues a working link).
   Closing it needs `isInvalidLinkError` lifted out of `HubPage`, a sixth `Phase`
   member, a render branch and a retry nonce — ~15–25 lines across two files with
   no test coverage available. Deliberately tracked rather than done at the final
   gate. The strings it needs (`hub.loadError`, `common.retry`) already exist.

5. **A dead-token retry loop.** Because `load()` may never set `invalid` (that's
   what stops a post-action refresh blip from declaring a good link bad), a parent
   whose *first* fetch fails transiently and who then taps retry against a
   genuinely dead token stays on the retry screen indefinitely. Spec-faithful, and
   a reload reaches the invalid-link screen — but worth revisiting.

6. **Four helpers are duplicated between `HubPage` and `RegisterPage`** —
   `asBool`, `parseDraft`, `toApplicationItems`, and the `entityData` usage around
   them. They have **already diverged once**: `HubPage`'s `toApplicationItems`
   validates via `asItemStatus`, `RegisterPage`'s uses a bare cast. A shared
   `src/lib/rows.ts` is the natural next refactor and would have prevented that.

## Consistency / hardening

7. **`Referrer-Policy: no-referrer` and access-log path scrubbing.** The
   magic-link token lives in the URL by design (roadmap, Plans 1–3), so it lands in
   uvicorn access logs. Outbound leakage is covered by the browser default
   `strict-origin-when-cross-origin` for both the R2 and Stripe redirects, but an
   explicit policy plus log scrubbing belongs on the deployment list before
   familyhub goes public.
8. **`config.py`'s production secret check doesn't enforce enrollx's
   `MIN_SECRET_LENGTH = 32`.** A short key just 401s upstream rather than opening a
   hole, so the practical risk is low — but it's free insurance on a load-bearing
   shared secret.
9. **The `cloudflare_ip.py` docstring in papermite, admindash and launchpad still
   says "three copies … keep all three in sync."** There are now four.
10. **`entityData`'s "tolerates both shapes" comment overpromises for id reads** —
    for the envelope shape, `entity_id` sits at the top level, not inside
    `base_data`, so the helper would return `undefined`. The backend handles this
    (`app_row.get("entity_id") or app_raw.get("entity_id")`); the frontend doesn't.
    Harmless today (reality is flattened); either match the backend or soften the
    comment.
11. Minor: `sensitive` defaults `False` when no `item_id` is supplied while
    `_sensitive_for` fails *closed* to `True` otherwise; `amountDueFor` is invoked
    twice per payment item; the config fetch inside `start_registration` has no
    dedicated 4xx-passthrough test; a `HTTPException(502)` token guard doesn't use
    the module's `relay` convention; an empty `<div className="hub-item-actions">`
    renders for items with no affordance.

## Cross-plan

12. **An integrity gap in enrollx's Plan-2 surface, found by Plan 5's review.** A
    parent can stamp their own item's `payload_ref` with **another family's
    `document_id`** — `_complete_item` stores it without validating ownership.
    **This is not a leak**, because `get_document_url` never trusts `payload_ref`:
    it re-validates membership against the per-token listing and then checks
    `uploaded_by` exactly. But it is the seam where a future "the id came from our
    own item, so it's ours" shortcut *would* open one. Worth validating at the
    write side.

---

## Plan defects found in Plan 5

**Eighteen**, the same family as Plan 3's eleven and Plan 4's six — plan text
authoring code snippets from memory rather than binding against real interfaces.
Highlights:

- **The plan's own Global Constraints state the `uploaded_by` security rule with
  the wrong identifier** — `parent:{application_id}` where the correct value is
  `parent:{entity_id}`. A pass/fail security constraint, stated wrongly in the
  plan's most load-bearing paragraph. The bindings gate caught it.
- Task 2's routes already existed from Plan 2, and the brief's response shapes for
  both were wrong (`{config, program, capacity}` not `program.is_full`; `{}` not
  `{"sent": n}`).
- The brief's `_passthrough` helper would have **leaked upstream 5xx bodies** to
  parents; the brief's request-link page had an **error branch** that would have
  defeated the four-layer anti-enumeration property.
- Task 6's item lookup keyed the business `item_id` where hosts send `entity_id` —
  it would have 400'd every real upload while the brief's own fixture stayed green.
- Task 9's draft read the business `item_id` for action calls *and* dropped the
  `itemId` from `startCheckout` entirely.

**The countermeasure worked.** Plan 5 shipped a `# ADJUST(bindings)` convention
and a Task 1 bindings gate — the exact mechanism Plans 3 and 4 had to invent
mid-flight — and it caught all eighteen, including the one in the plan's own
security constraints. Five consecutive task reviews closed with no Critical or
Important findings.

**For future plans:** generate the interface map first, from the code; have every
dispatch cite it; and state explicitly that the map overrides the plan text, so
reviewers don't raise false positives against snippets that were wrong to begin
with.
