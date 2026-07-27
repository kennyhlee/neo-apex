# apex-verify — Cross-Module Verification Harness Design

**Date:** 2026-07-27
**Status:** Approved (ready for implementation plan)
**Scope:** New top-level `apex-verify/` tool + `.claude/skills/verifier-apex` skill

## 1. Overview

A reusable, browser-driving verification harness for all NeoApex modules. It logs
into a running frontend, drives it as a user would, captures screenshots and
measurements, and reports pass/fail with replayable evidence. It replaces the
throwaway Playwright scripts used ad hoc during development with a committed,
consistent tool usable from the CLI and from a Claude Code skill.

Goals:
1. **Cross-module:** one harness that works for launchpad, papermite, and admindash
   frontends (all share `neoapex_token` + DataCore auth), plus DataCore API smoke.
2. **Replayable evidence:** every run writes screenshots + a findings log + an HTML
   gallery so a reviewer can see what was observed.
3. **Two entry points:** a plain CLI (`node apex-verify <module|all> [flow]`) and a
   `verifier-apex` skill that invokes it.
4. **Truthful verdicts:** unreachable services or a missing browser report BLOCKED,
   never a false FAIL; any failed check exits nonzero.

Non-goals (YAGNI): deep bespoke launchpad/papermite flows (smoke only for now), CI
wiring, cross-browser (Chromium only), visual-regression diffing.

## 2. Architecture

A committed Node + Playwright project at repo root `apex-verify/`. Ports and URLs
are derived from the repo's existing `services.json` — the single source of truth —
so the harness never hardcodes ports. Auth uses the shared login: obtain a JWT from
a module's backend `/auth/login` (proxying to DataCore) and seed it into the
frontend's `localStorage` under `neoapex_token` before driving the SPA.

```
apex-verify/
  package.json            # name apex-verify; devDep: playwright; bin: apex-verify -> index.mjs
  .gitignore              # node_modules/, artifacts/
  README.md               # quickstart (install chromium, run)
  index.mjs               # CLI entry + flow dispatch
  lib/
    services.mjs          # load ../services.json -> { module: {frontendUrl, backendUrl} }
    auth.mjs              # login(email,password,backendUrl) -> token
    browser.mjs           # Session: launch, seedToken, goto, shot, measure, waitChatIdle, close
    report.mjs            # Report: add(status,msg), shot registration, write findings.txt + index.html, verdict/exit
    preflight.mjs         # assert service reachable; assert chromium installed
  flows/
    smoke.mjs             # generic frontend smoke (any module)
    admindash.mjs         # full admindash flow suite
    launchpad.mjs         # smoke wrapper (deep flows later)
    papermite.mjs         # smoke wrapper (deep flows later)
    datacore.mjs          # API-only smoke (no browser)
  artifacts/              # gitignored, per-run output
.claude/skills/verifier-apex/SKILL.md
```

### Units

- **`lib/services.mjs`** — `loadServices()` reads `../services.json` and returns a map
  `{ launchpad:{frontendUrl,backendUrl}, papermite:{...}, admindash:{...}, datacore:{backendUrl} }`
  built from `host`/`port`. Depends on: `services.json`. No side effects.
- **`lib/auth.mjs`** — `login(backendUrl, email, password) -> Promise<string token>`.
  POSTs `/auth/login`; throws on non-2xx or missing token. Creds default to
  `APEX_VERIFY_EMAIL` / `APEX_VERIFY_PASSWORD` env or `jane@acme.edu` / `admin123`.
- **`lib/browser.mjs`** — `Session` class wrapping Playwright:
  `open({viewport})`, `seedToken(frontendUrl, token)` (goto origin → set localStorage →
  goto `/`), `goto(path)`, `waitIdle(ms?)`, `shot(name)` (screenshot into the report's
  artifact dir, returns path), `measure(fn)` (page.evaluate helper), `close()`.
- **`lib/report.mjs`** — `Report` class: `check(ok, msg)` records ✅/❌, `probe(msg)`
  records 🔍, `note(msg)` plain line, `blocked(msg)`; `dir` = `artifacts/<runLabel>/`;
  `finish()` writes `findings.txt` + `index.html` (embeds screenshots in order) and
  returns `{ verdict: 'PASS'|'FAIL'|'BLOCKED', failed }`.
- **`lib/preflight.mjs`** — `assertReachable(url)` (fetch with timeout; BLOCKED msg on
  fail), `assertChromium()` (checks the browser is installed; else BLOCKED with
  `npx playwright install chromium`).
- **`flows/*.mjs`** — each exports `async function run(ctx)` where
  `ctx = { module, urls, session, report, token }`. A flow performs steps and records
  checks/probes/screenshots on `report`. Flows never call `process.exit`.

### CLI (`index.mjs`)

- Usage: `node apex-verify <module|all> [flow]`.
  - `<module>` ∈ `launchpad | papermite | admindash | datacore | all`.
  - `[flow]` optional; defaults to the module's default flow set.
- Dispatch table maps module → default flow(s):
  - launchpad → `smoke`; papermite → `smoke`; admindash → `smoke` + `admindash`;
    datacore → `datacore`; `all` → smoke for the three frontends + `admindash` suite +
    `datacore` smoke.
- For each selected flow: preflight the needed services; if BLOCKED, record and skip
  that flow (don't crash the whole run). Then `login` (for flows needing a browser),
  open a `Session`, `seedToken`, run the flow, `close`.
- After all flows: `report.finish()`, print the summary + artifact path, and
  `process.exit(failed > 0 ? 1 : 0)`. A run that is entirely BLOCKED exits `2`.

## 3. Flows

### `smoke.mjs` (generic, any frontend module)
1. Preflight: frontend URL reachable, DataCore reachable. (BLOCKED otherwise.)
2. `login` via the module's backend → token; seed into frontend localStorage.
3. Load the app root; wait for network idle; assert the authenticated shell rendered
   (a top nav / app chrome element is present and the login form is NOT shown) → ✅/❌.
4. Screenshot `home`.
5. 🔍 probe: reload with NO token → assert it shows the login screen (auth gate works).
6. Screenshot `login-gate`.

### `admindash.mjs` (full suite — ports the flows proven on 2026-07-27)
Viewport 1600×900, chat assistant present on Home.
1. ✅ assistant drawer open by default; ✅ dashboard centered (equal L/R margins);
   🔍 measure content→drawer gap is 0–40px. Screenshot `home-open`.
2. ✅ Hide → drawer slides out (`.is-open` removed) and full dashboard visible;
   toggle in upper-right. Screenshot `home-hidden`. ✅ Show → drawer returns.
3. ✅ Markdown: send a message asking to echo `**bold** *italic*`; assert an assistant
   `<strong>` renders and no raw `**` remains. Screenshot `markdown`.
4. ✅ Create form: "add a new program" → `.create-form` appears (required step); fill
   the editable required inputs via Playwright `fill()`; advance → optional step shows
   **Skip** (enabled) and **Save**. Screenshots `create-required`, `create-optional`.
   (Does NOT submit — avoids writing junk records.)
5. ✅ History retained: send a message, navigate Home→Students→Home, assert transcript
   persists. Screenshot `after-nav`.
6. ✅ Student status display: open Students; assert the Status column shows a domain
   value (e.g., `Active`) and never raw `["..."]` bracketed/quoted text. Screenshot
   `students-status`.

### `launchpad.mjs`, `papermite.mjs`
Thin wrappers that call `smoke.run(ctx)`. Deep flows added later.

### `datacore.mjs` (API-only)
1. Preflight `/health` → ✅.
2. `login` with dev creds → ✅ token issued; `GET /auth/me` with it → ✅ returns a user
   with `tenant_id`. No browser.

## 4. Auth, config, evidence

- **Ports:** always from `services.json`. Base URL = `http://<host>:<port>`.
- **Creds:** env `APEX_VERIFY_EMAIL` / `APEX_VERIFY_PASSWORD`, default dev seed
  `jane@acme.edu` / `admin123`. Never committed beyond the known dev default.
- **Token:** seeded into `localStorage['neoapex_token']` on the frontend origin.
- **Artifacts:** `apex-verify/artifacts/<YYYYMMDD-HHMMSS>-<module>/` (run timestamp from
  `new Date()` in the CLI). Contains `*.png`, `findings.txt`, `index.html`. Gitignored.

## 5. Error handling

- Service unreachable → the flow is recorded BLOCKED (with URL) and skipped; other
  modules still run. Overall verdict BLOCKED only if nothing ran.
- Chromium missing → BLOCKED with the install command; browser flows skipped.
- Login failure → that module's browser flows BLOCKED (message names the backend URL).
- An exception inside a flow is caught, recorded as ❌ with the message + a
  `crash-<flow>.png` screenshot if the page is alive, and the run continues.

## 6. The `verifier-apex` skill

`.claude/skills/verifier-apex/SKILL.md` — description triggers on verifying NeoApex
UI changes. Steps: (1) ensure the stack is running (`./start-services.sh`); (2) one-time
`cd apex-verify && npm install && npx playwright install chromium`; (3) run
`node apex-verify <module>` (or `all`); (4) read `artifacts/.../findings.txt` and open
the screenshots; (5) report verdict with the key screenshots inline. The skill is the
repo's evidence-capture protocol so any future UI change can be replayed the same way.

## 7. Testing / acceptance (dogfood)

The harness is validated by running it against the live stack:
- `node apex-verify admindash` reproduces the checks captured on 2026-07-27, all ✅.
- `node apex-verify all` smoke-loads launchpad, papermite, admindash (✅ shells render),
  runs the admindash suite, and datacore API smoke; exits 0.
That live run is the acceptance test; there are no unit tests for the harness itself.

## 8. Out of scope

Deep launchpad/papermite flows, CI integration, non-Chromium browsers, visual-diff
baselines, parallel sharding. All can layer on later without changing the lib/ API.
