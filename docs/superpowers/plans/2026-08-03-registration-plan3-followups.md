# Registration Plan 3 (Payments) — deferred follow-ups

Plan 3 merged into `docs/registration-flow-design` at `41dbd1b` (19 commits,
enrollx 379 → 491 tests). The whole-branch review cleared it for integration
**with two named follow-ups**, listed first below. Everything else here was
consciously deferred with a recorded ruling, not overlooked.

Precedent for this file's format: `docs/deployment/follow-ups.md`.

## Blocking-ish — the two the final review named as conditions

1. **Nothing reads the alerting surface the webhook policy depends on.**
   Plan 3 changed the webhook so permanent per-event conditions return
   `200 {handled: false, reason}` instead of a non-2xx (see "Plan defect #11"
   below). That policy *designates the `enrollx.stripe_webhook` ERROR/WARNING
   log as the place failures surface* — and nothing currently alerts on it.
   Wire an alert. The account-mismatch warning especially: it is the only log
   line here that can indicate an attack, and it no longer surfaces as an HTTP
   failure anywhere.
2. **Relayed DataCore 4xx is indistinguishable from enrollx's own domain 4xx.**
   The webhook swallows `400 <= status < 500` from `settle_payment_item` as
   permanent. DataCore returns 400 only for Binder/Catalog/Parser errors and
   `put_entity` `ValueError` (everything else is 5xx, unreachability is 502),
   so the transient family still retries correctly — but the classification is
   coincidental rather than designed. Cheapest fix: have the `dc_*` helpers
   raise 502 for an upstream 5xx and tag upstream 4xx, so the webhook can retry
   the genuinely ambiguous class.

## Correctness / robustness

3. **No `idempotency_key` on session creation**, and nothing prevents two live
   Checkout Sessions against the same payment item (staff double-click, parent
   in two tabs, or online payment racing a staff-recorded offline one). Plan 3
   handles the *fallout* correctly (200, loud log, no double-settle) but not
   the cause. Derive a key from `(tenant, application, item, kind, amount)` and
   refuse a second session while an unexpired one exists.
4. **`payment_status` is never checked.** Plan 3 shipped the safe half —
   `payment_method_types=["card"]` — so delayed-notification methods cannot be
   selected. The complete fix is to gate settlement on
   `session.payment_status == "paid"` and handle
   `checkout.session.async_payment_succeeded`, which would let schools enable
   ACH/SEPA/Bacs/boleto safely.
5. **`session.amount_total` is never compared to the expected plan amount.**
   Recorded always equals charged today (both read `amount_total`), but neither
   is checked against what the config says it should be — and a Standard
   Connect account holder can create sessions with arbitrary metadata against
   their own account. Log a WARN on mismatch.
6. **The balance is derived from config, not from what was actually collected.**
   `amount_full - deposit_amount` is consistent between the obligation and the
   balance checkout, but a staff-recorded offline partial deposit still flips
   `_deposit_already_paid`, so the balance charged would be wrong. Deriving from
   `sum(payments)` would be robust.
7. **A missing `kind` in session metadata still defaults to `"full"`** before
   validation, so absent metadata settles as a full payment rather than being
   rejected. Plan 3 validates *unknown* values; it does not reject *absent* ones.

## Security / privacy

8. **The magic-link token is embedded in the Stripe `success_url`/`cancel_url`.**
   Stripe persists those on the Session object, visible in the connected
   account's Dashboard, exports and API. That token is a bearer credential for
   the whole application until `token_version` is bumped. Impact is bounded
   (school staff already reach the application through enrollx), but a bearer
   token in a third-party-persisted URL is worth removing. **Needs a familyhub
   change, so it belongs with Plan 5:** return to a token-less landing route
   (`/payment-return?session_id={CHECKOUT_SESSION_ID}`) and re-resolve there, or
   issue a short-lived one-time return token distinct from the link token.
9. **No HTML escaping in `payment_emails.py`.** `tenant_name` and
   `application_id` are interpolated raw, while `app/registration/emails.py`
   escapes. Admin-controlled inputs in an email context, so low risk — but an
   inconsistency with the module next door.

## Plan-level gaps (belong to Plan 4)

10. **Nothing constrains payment block cardinality.** `validate_blocks` enforces
    neither "at most one `payment_plan` block" nor "at most one `payment`
    block", yet Plan 3's amount derivation assumes both. A flow with two
    `payment` blocks (application fee + tuition — a natural thing to build)
    produces two payment items, and checkout charges the single `payment_plan`
    amount against whichever DuckDB returns first. Add the validation rule,
    and/or make `item_id` required and validate the derived `kind` against the
    named item.

## Cross-service — found in passing, not Plan 3's code

11. **`launchpad/backend/app/api/tenants.py:53-87` erases tenant custom fields
    on every profile save.** It rebuilds `base_data` from the flattened row
    correctly (so `stripe_account_id` survives) and DataCore's dedicated tenant
    route re-injects `_abbrev` — but it sends no `custom_fields` at all. This is
    the same defect class Plan 3 just fixed in enrollx, and the fix is the same
    shape. **Pre-existing and unrelated to payments; worth its own ticket.**
12. **Possible stale project memory.** The memory note "Tenant abbreviation
    logic" records that the ID prefix changes when the tenant name changes, but
    `datacore` `put_tenant` explicitly locks `_abbrev` at creation and never
    re-derives it on update. Re-check that memory against the current code.

## Test / code quality

13. `FakeDataCore.dc_update` (`enrollx/backend/tests/fakes.py`) was not extended
    with the new optional `custom_fields` parameter, so it now lags the real
    signature. The next test to reach it gets a confusing `TypeError`.
14. The `\n`/`\t`/`\r` unescape in `tenant_lookup._custom_field_keys` is not the
    inverse of TOON's `escape_string` — a custom-field *key* containing those
    characters degrades to the old behaviour (safe, but wrong).
15. `test_settlement_conflict_200_not_handled_and_no_second_payment` asserts
    `settled == []` vacuously (it replaces the recording fake). Its real content
    — the 200 / `handled: false` / `reason` / `emails == []` assertions — is
    sound; the name overpromises.
16. No frontend test coverage for `payments.ts` / `PaymentsSettingsPage.tsx` —
    which is why the single-writer `stripe_account_id` SELECT shipped in the
    first place.
17. Minor: `/settings/payments` is routed for any authenticated user (backend
    enforces role, so a non-staff user just sees error banners); the settings
    page collapses 503 / 403 / network failures into one generic error string,
    so an admin who never set `ENROLLX_STRIPE_CLIENT_ID` gets "please try again"
    forever; `test_internal_checkout_requires_internal_key` accepts 401 *or* 403
    rather than pinning one; three reachable 409 paths in `checkout_service`
    have no coverage.

---

## Plan defect #11 — recorded for the record

Plan 3's text specified webhook status codes as if they were REST error
responses, without accounting for Stripe's retry-and-auto-disable semantics.
An HTTP status on a webhook is a **retry instruction**, not an error report:
Stripe retries any non-2xx for up to three days, and sustained failures
auto-disable the endpoint — which would have stopped settlement for *every*
tenant on the platform. The implementation deliberately deviates from the plan
here, on a controller ruling backed by two independent reviews. The
security-relevant "no writes occurred" assertions were preserved verbatim
through the change; only the status code moved.

Ten further plan defects were found and ruled on during execution. They share
one cause, worth carrying into future plans: **the plan authored code snippets
— imports, function arities, SQL, status codes — rather than specifying
behaviour and letting the implementer bind against the real interfaces.** Every
snippet written from memory of an API rather than from the source was wrong.
For Plans 4 and 5: generate the interface map first, from the code, and have
plan bodies reference it instead of inlining callable code.
