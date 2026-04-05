# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AdminDash is the operations dashboard frontend for NeoApex, an education/enrollment management platform. It is a React SPA with no local backend — the API server runs separately at `http://localhost:8080`.

Part of the NeoApex ecosystem alongside papermite, enrollx, familyhub, datacore, and apexflow.

## Commands

```bash
# Development (runs on port 5174)
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

No test framework is configured.

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
- **api/** — Fetch-based API client functions targeting localhost:8080
- **types/** — TypeScript interfaces (Student, Guardian, Tenant, etc.)
- **i18n/** — Translation JSON files keyed by locale

### Key Patterns
- **Authentication**: AuthContext authenticates against DataCore auth API (`http://localhost:8081/auth`), stores JWT in localStorage under `neoapex_token`. Routes protected via AppRoutes component.
- **Multi-tenancy**: Tenant selected via Navbar dropdown, passed as prop to page components.
- **Dynamic columns**: StudentsPage discovers `custom_fields` from API data and generates table columns dynamically.
- **API endpoints**: `GET /students?tenant=&limit=&offset=` and `GET /tenants`.

### Other Directories
- **markup/** — Legacy static HTML/CSS/JS prototypes (reference only)
- **openspec/** — OpenSpec workflow config and specs for change management
