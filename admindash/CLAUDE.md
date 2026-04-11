# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AdminDash is the **school operations product** in the NeoApex / Floatify suite. School administrators use it to manage their schools — students, programs, and enrollment workflows. It is customer-facing software whose users are school staff at Floatify-customer schools.

The product has two halves:
- **Frontend** (`frontend/`): React SPA on port 5600
- **Backend** (`backend/`): Python FastAPI service on port 5610 that the SPA calls. The backend proxies authenticated requests to DataCore (entities, queries, auth) and Papermite (document extract).

Part of the NeoApex ecosystem alongside papermite, datacore, launchpad, and the placeholder modules apexflow, enrollx, familyhub.

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

No test framework is configured for the frontend.

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

### Key Patterns
- **Authentication**: AuthContext authenticates against the admindash backend's `/auth/login` endpoint (which proxies to DataCore). JWT stored in localStorage under `neoapex_token`. Routes protected via AppRoutes component.
- **Multi-tenancy**: Tenant selected via Navbar dropdown, passed as prop to page components.
- **Dynamic columns**: StudentsPage discovers `custom_fields` from API data and generates table columns dynamically.
- **API endpoints**: All API calls target the admindash backend at `http://localhost:5610` (see `backend/README.md` for the full endpoint surface). The backend proxies: `/auth/login`, `/auth/me`, `/api/query`, `/api/entities/{tenant_id}/{entity_type}` (POST/PUT), `/api/entities/{tenant_id}/{entity_type}/archive`, `/api/entities/{tenant_id}/{entity_type}/next-id`, `/api/entities/{tenant_id}/{entity_type}/duplicate-check`, and `/api/extract/{tenant_id}/student` (multipart). All proxied to DataCore or Papermite after JWT validation.

### Other Directories
- **markup/** — Legacy static HTML/CSS/JS prototypes (reference only)
- **openspec/** — OpenSpec workflow config and specs for change management
