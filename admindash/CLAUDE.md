# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AdminDash is the **school operations product** in the NeoApex / Floatify suite. School administrators use it to manage their schools — students, programs, and enrollment workflows. It is customer-facing software whose users are school staff at Floatify-customer schools.

The product has two halves:
- **Frontend** (`frontend/`): React SPA on port 5600
- **Backend** (`backend/`): Python FastAPI service on port 5610 that the SPA calls. The backend proxies authenticated requests to DataCore (entities, queries, auth) and Papermite (document extract).

Part of the NeoApex ecosystem alongside papermite, datacore, launchpad, apexflow, and familyhub.

## Commands

### Frontend (React SPA on :5600)

```bash
# Development (runs on port 5600)
cd frontend && npm run dev

# Build (TypeScript check + Vite bundle)
cd frontend && npm run build

# Lint
cd frontend && npm run lint

# Type check only
cd frontend && npx tsc -b

# Preview production build
cd frontend && npm run preview
```

Run the frontend test suite with `npm test` (vitest); suites live under `src/utils/__tests__/`.

### Backend (FastAPI on :5610)

```bash
# Install deps (from admindash/, where pyproject.toml lives)
cd /Users/kennylee/Development/NeoApex/admindash && uv sync --extra dev

# Run dev server
cd /Users/kennylee/Development/NeoApex/admindash && uv run uvicorn app.main:app --app-dir backend --port 5610 --reload

# Run tests
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
```

## Architecture

### Tech Stack
- React 19 + TypeScript 5.9 + Vite 8
- React Router DOM v7 for client-side routing
- Native Fetch API for HTTP (no axios)
- CSS with CSS variables (no CSS-in-JS library)
- Custom i18n hook (en-US, zh-CN) — not using react-intl or i18next

### Source Structure (`frontend/src/`)
- **pages/** — Route-level components (HomePage, StudentsPage, LeadPage, ProgramPage, LoginPage)
- **components/** — Shared UI (Navbar, DataTable, FilterForm, Footer, StatusBadge, LanguageSwitcher)
- **contexts/** — AuthContext for session-based authentication
- **hooks/** — Custom hooks (useTranslation with global listener pattern)
- **api/** — Fetch-based API client functions targeting localhost:5610
- **types/** — TypeScript interfaces (Student, Guardian, Tenant, etc.)
- **i18n/** — Translation JSON files keyed by locale

### Design System

All styling flows through `src/styles/theme.css`. **It is the only file in `src/` that may contain a raw hex or `rgba()` value** — everything else references tokens. If you need a colour that isn't there, add a token rather than a literal.

Layer order (see `src/index.css`):
1. `@neoapex/ui-tokens` — shared across launchpad/papermite/admindash. **Do not edit it for admindash-only changes**; override locally in `theme.css` instead.
2. `styles/theme.css` — the admindash system: palette, type scale, 4px spacing scale, radii, elevation, z-index ladder, density tokens, plus a compatibility layer that re-points every legacy token name (`--bg-card`, `--text-primary`, `--color-*`, …) at a primitive. That layer is what lets a palette change re-skin all stylesheets at once.
3. `styles/buttons.css`, `styles/modal.css` — the shared component CSS.

**Density.** `--row-h`, `--cell-px`, `--table-fs`, `--control-h`, `--nav-h`, `--gutter` and friends are swapped by `:root[data-density='compact']`. Components read them, so comfortable (teachers, front desk) and compact (the registrar's grid) are one component set at two token values. Toggle via `useDensity()`; it persists to `localStorage['admindash_density']`.

**Shared primitives — use these, don't hand-roll:**
- `components/ui/Modal.tsx` — every overlay, including drawers (`variant="drawer"`) and nested confirms. Provides focus trap, focus restoration, Escape scoped to the topmost overlay, scroll lock, and the dialog ARIA. Never build a bespoke overlay.
- `components/ui/Button.tsx` — `variant="primary|secondary|danger|ghost|link"`.
- `hooks/useToast.ts` — every mutation should report itself. Destructive actions pass `onUndo` and get a 10-second Undo instead of a blocking confirm where the backend supports it (see `restoreEntities`).
- `components/ui/CommandPalette.tsx` — ⌘K / Ctrl-K search across students, families and programs, plus navigation commands. Mounted once in the shell; open it from anywhere with `openCommandPalette()` from `components/ui/paletteBus.ts`.
- `components/DataTable.tsx` — pass `rowActions` for per-row controls, `rowLabel` for checkbox accessibility, `emptyState` for a useful empty view, and mark the name column `primary: true` so it becomes the card title when rows reflow below 768px.

**Accent vs accent-ink.** `--accent` (#378ADD) is the shared suite brand and is used for borders, focus rings, `accent-color` and tint derivation. It is only 3.59:1 against white, so **anything that is text, or that sits under white text, must use `--accent-ink`** (#2B6FB5, 5.19:1). A quick check before changing either: `color:`/`background:` take `--accent-ink`; `border-color:`/`accent-color:` take `--accent`.

**Accessibility invariants** (these were absent before and are easy to regress):
- Never write `outline: none` without a visible replacement. The global `:focus-visible` ring in `index.css` is the default; don't override it.
- Every form control needs a bound label (`htmlFor`/`id`). Radio and checkbox groups need `<fieldset>` + `<legend>`, not a single `<label>`.
- Interactive elements are `<button>`, not `<div onClick>`.
- New user-facing strings go in `src/i18n/translations.ts` for **both** `en-US` and `zh-CN`. A missing key renders the raw key string with no warning.

### Key Patterns
- **Authentication**: AuthContext authenticates against the admindash backend's `/auth/login` endpoint (which proxies to DataCore). JWT stored in localStorage under `neoapex_token`. Routes protected via AppRoutes component.
- **Multi-tenancy**: Tenant selected via Navbar dropdown, passed as prop to page components.
- **Dynamic columns**: StudentsPage discovers `custom_fields` from API data and generates table columns dynamically.
- **API endpoints**: All API calls target the admindash backend at `http://localhost:5610` (see `backend/README.md` for the full endpoint surface). The backend proxies: `/auth/login`, `/auth/me`, `/api/query`, `/api/entities/{tenant_id}/{entity_type}` (POST/PUT), `/api/entities/{tenant_id}/{entity_type}/archive`, `/api/entities/{tenant_id}/{entity_type}/next-id`, `/api/entities/{tenant_id}/{entity_type}/duplicate-check`, `/api/extract/{tenant_id}/student` (multipart, accepts `.pdf`/`.docx`/`.txt`), and `/api/config/models` (read-only, surfaces papermite's active default model so the upload widget can display it). All proxied to DataCore or Papermite after JWT validation. `app/api/workflows.py` adds a thin staff proxy to apexflow-backend (`ADMINDASH_APEXFLOW_BACKEND_URL`, default `http://localhost:5910`): `/api/workflows/{tenant_id}/definitions`, `/definitions/{entity_id}/bundle`, `/definitions/{entity_id}/actions` (POST — lineage lifecycle: publish/deprecate/reactivate/archive/unarchive), `/definitions/{definition_id}/instances` (POST, create; GET, every work item of the lineage including closed and abandoned), `/instances/{instance_entity_id}/allowed-actions`, `/instances/{instance_entity_id}/actions` (POST), `/documents` (POST → apexflow `/api/documents/{tenant_id}`), and `/documents/{document_id}/url`. Every route relays status/body/content-type verbatim and 502s with `"ApexFlow is unreachable"` if apexflow-backend is down.

### Other Directories
- **markup/** — Legacy static HTML/CSS/JS prototypes (reference only)
- **openspec/** — OpenSpec workflow config and specs for change management
