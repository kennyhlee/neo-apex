# Registration Whole-School Revision — follow-ups

Companion to `2026-08-04-registration-whole-school-revision.md` (the plan) and
`2026-08-04-registration-whole-school-revision-design.md` (the spec).
Everything here was deliberately deferred by the plan's Global Constraints, or
found during the click-through and recorded rather than fixed.

**Verified at completion:** enrollx 534 tests, familyhub 98, papermite 114
(excluding the pre-existing `test_auth.py` collection error, see §3), both
frontends `npm run build` + `npm run lint` clean, and a full browser
click-through of both channels against the local dev stack on tenant
`acme-afterschool`.

## 1. Deferred manual verification — needs a human + real credentials

1. **Document upload, both channels.** The click-through carried no document
   step at all: the seeded starter template is two form blocks plus review, so
   there was nothing to skip or waive. `DATACORE_R2_*` is still absent from the
   dev environment, so no `document` row can be created anyway
   (`datacore/documents.py` raises `KeyError` → 500 → familyhub masks it to
   502). Once R2 test credentials exist, add a `documents` block to the flow and
   run: a parent upload through `/register/{tenant_id}`, a staff upload through
   `/applications/{id}/enter`, and the download links on both the staff detail
   page and the parent hub.

2. **The `uploaded_by` seam (carried over from Plan 5 follow-up #2).** The two
   `uploaded_by` format literals live on opposite sides of a process boundary
   and have never been exercised together. Re-run specifically: the
   cross-application `document_id` refusal, and that a parent upload lands as
   `parent:{application entity_id}`. Only a live run can confirm this.

3. **Capacity waitlist branch, in the browser.** `acme-afterschool` carries
   `capacity: 100` and the click-through created 5 applications, so the
   waitlist path was never reached in the UI. It is covered by
   `test_submit_waitlists_when_the_school_year_is_full` and
   `test_submit_is_not_waitlisted_by_a_different_school_year`. To exercise it
   for real, set the tenant's `capacity` to 1 and submit a second application
   for the same school year.

4. **Payments.** No `payment_plan`/`payment` block was in the seeded flow, so
   Stripe checkout was not exercised here. Unchanged by this revision.

## 2. Found during the click-through and FIXED on this branch

Recorded because both were latent for the whole of Phase 1 and the browser run
is what surfaced them — the same class of gap will recur if the click-through
keeps being deferred.

- **`_approve` read the wrong draft shape** (`ee3656a`). `FlowRenderer` stages
  a form block's answers under its `block_id`; `_approve` read
  `draft["student"]` / `draft["family"]` directly. Every flow authored in the
  builder and filled through either UI therefore failed approval with 422 "the
  application has no student name". The suite passed throughout because its
  tests post `{"student": {...}}` straight to `save_draft`. The block →
  entity_type mapping now comes from the application's pinned config.

- **`entityData()` could not read an id from the envelope shape** (`bf68ef0`) —
  this is Plan 5 follow-up #10, promoted from "the comment overpromises" to an
  observed failure. `startRegistration` returns enrollx's `dc_create`
  ENVELOPES (`entity_id` at the top level) while `fetchApplication` relays
  FLATTENED rows, so `item_id` came back `''` on the start path only. A parent
  who had just started got "Could not save this step" on their very first Save
  & continue. New `entityId()` helper reads either shape.

- **`checkout_service` resolved the config by `program_id`** (`0b36b71`) —
  found by a final `grep` sweep, not by the click-through (no payment block was
  in the seeded flow, so checkout was never exercised). Applications no longer
  carry a `program_id`, so the lookup matched nothing and would have 409'd
  every payment. Its test passed regardless, because `FakeDataCore` omits
  absent keys while a real flattened row returns the column as `None` —
  `CONFIG_ROW` now carries `program_id: None` so the shape is honest, and
  reverting the fix fails 5 tests.

**The first two have no automated coverage on the frontend side** —
familyhub-frontend has no test runner. A component test around
`toApplicationItems` for both wire shapes would be the cheapest guard.

**The pattern worth noting:** all three were invisible to a green suite because
the test doubles were kinder than the real services (renderer-shaped drafts
never posted, envelope rows never mapped, absent columns instead of NULL ones).
Each of the three fixes tightened the fixture as well as the code.

## 3. Environment problems (not caused by this revision)

1. ~~**Chrome cannot open familyhub's dev frontend at all.**~~ **RESOLVED.**
   Port **6000** is on Chrome's blocked-port list (X11), so
   `http://localhost:6000` failed with `ERR_UNSAFE_PORT` in every Chrome tab,
   and the click-through had to run against a second dev server on port 6100.
   familyhub now sits at **5620** (frontend) / **5630** (backend) in
   `services.json` — no browser blocks either, and the pair slots into the
   56xx block beside admindash instead of squatting on a popular default like
   8080. Everything derives from those entries (vite's dev port, `config.ts`'s
   API URL, `start-services.sh`, and the CORS allowlist), so the edit covered
   all of it; the dev-fallback origin and `port` in
   `familyhub/backend/app/config.py`, and enrollx's `DEV_FAMILYHUB_PUBLIC_URL`
   / `familyhub_url` magic-link base, were updated to match.

2. **`papermite/backend/tests/test_auth.py` fails to import** —
   `ImportError: cannot import name 'get_registry_store' from 'app.storage'`.
   Confirmed pre-existing (reproduced with this branch's changes stashed) and
   unrelated to registration. The rest of the papermite suite is run with
   `--ignore=backend/tests/test_auth.py`.

## 4. Observations from the click-through

- The `student` model requires `family_id` and `primary_address`, so both are
  rendered as required fields on a form a parent fills *before* any family
  exists. `family_id` was typed as "TBD" to get through; approval overwrites it
  with the real derived id, so nothing is corrupted — but asking a parent for
  an internal id is wrong. Worth either excluding FK-shaped fields from
  parent-facing hydration or relaxing `required` on them in `base_model.json`.
- The reseed in `scripts/reset_registration_dev_data.py` had to apply the merge
  rule itself: model setup had already replaced both dev tenants'
  `registration_application` models with the extraction shape
  (`application_id, school_year, school_id` only), so a naive reseed would have
  restored the base fields and deleted the real admission-packet fields. This
  is exactly the damage spec §4 rule 1 exists to prevent, observed in live dev
  data.
- Dev tenant `acme` has registration rows but **no `tenant` entity row**, so
  `engine.tenant_label` would fall back to the raw tenant id and
  `capacity_state` would report unlimited. `acme-afterschool` has a proper
  tenant row (`ACME Growth Academy`, capacity 100) and is the better dev target.

## 5. Known open items carried forward

- Plan 5 follow-ups #1 and #4–#9 are untouched by this revision and still
  stand: `TRUST_ALL_IPS` must be unset in production, `RegisterPage`'s
  cold-resume error collapsing, the dead-token retry loop, the duplicated row
  helpers between `HubPage` and `RegisterPage` (now three, with `entityId`),
  `Referrer-Policy: no-referrer` + access-log scrubbing, the secret-length
  check, and the stale `cloudflare_ip.py` docstrings. Follow-up #10 is closed
  (see §2).
- `ApplicationsPage`'s `LIMIT 1000` pagination follow-up stands. This revision
  did not make it worse (spec §5): the school-year filter stays client-side for
  the documented single-writer-column reason.
- The activity/program assignment workflow (spec §7) is a separate design and
  is what will consume `enrollment` rows and per-program capacity. Registration
  no longer writes `enrollment` at all.
- Multiple concurrent flows per tenant (spec §7) — the single-lineage config
  covers current tenants; revisit if a real tenant needs two.
