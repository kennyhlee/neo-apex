# NeoApex

An AI-powered platform for afterschool program management — from document ingestion and tenant onboarding to enrollment, analytics, and operations.

## Modules

| Module | Type | Frontend | Backend | Stack |
|--------|------|----------|---------|-------|
| [papermite](#papermite) | Full-stack | `:5173` | `:8000` | React 19 + FastAPI |
| [launchpad](#launchpad) | Full-stack | `:5175` | `:8001` | React 19 + FastAPI |
| [admindash](#admindash) | Frontend | `:5174` | — | React 19 + Vite |
| [datacore](#datacore) | Backend | — | `:8081` | FastAPI + LanceDB |
| [apexflow](#apexflow) | Planned | — | — | — |
| [enrollx](#enrollx) | Planned | — | — | — |
| [familyhub](#familyhub) | Planned | — | — | — |
| [ui-tokens](#ui-tokens) | Shared lib | — | — | CSS variables |
| [sampledoc](#sampledoc) | Sample data | — | — | PDFs |

---

## papermite

**Document ingestion gateway.** Transforms afterschool program documents (PDF, DOCX, TXT) into structured, tenant-scoped Pydantic data models using AI-powered extraction.

- **Frontend** `localhost:5173` — Upload documents, review AI-extracted draft models, and finalize schemas. Draft state stored in IndexedDB.
- **Backend** `localhost:8000` — FastAPI. Parses documents via Docling, extracts entities via Pydantic-AI. Supports Claude Haiku/Sonnet (default), GPT-4.1/5, and Ollama.

```bash
# Backend
cd papermite && uv run uvicorn main:app --reload --port 8000

# Frontend
cd papermite/frontend && npm run dev   # → localhost:5173
```

---

## launchpad

**Tenant lifecycle and identity service.** Handles authentication, tenant provisioning, and user management.

- **Frontend** `localhost:5175` — Tenant onboarding UI. Uses `@neoapex/ui-tokens` for shared design.
- **Backend** `localhost:8001` — FastAPI with JWT auth (24h expiry). Integrates with datacore for model registry. Endpoints: `/api/auth`, `/api/tenants`, `/api/users`, `/api/health`.

```bash
# Backend
cd launchpad && uv run uvicorn main:app --reload --port 8001

# Frontend
cd launchpad/frontend && npm run dev   # → localhost:5175
```

---

## admindash

**Operations dashboard.** Management interface for viewing students, guardians, programs, and enrollments across tenants.

- **Frontend only** `localhost:5174` — React SPA. Consumes APIs from datacore (`:8081`), papermite (`:8000`), and a central API server (`:8080`). Supports i18n (en-US, zh-CN).

```bash
cd admindash && npm run dev   # → localhost:5174
```

---

## datacore

**Centralized storage and query engine.** Manages vector storage, embeddings, and analytics for the platform.

- **Backend only** `localhost:8081` — FastAPI. Uses LanceDB for vector storage and DuckDB/PyArrow for analytics. Provides entity persistence, versioning, and similarity search. Consumed by admindash, papermite, launchpad, and future modules.

```bash
cd datacore && uv run uvicorn main:app --reload --port 8081
```

---

## apexflow

**Workflow orchestration** — planned, not yet implemented.

---

## enrollx

**Smart application processing** — planned, not yet implemented.

---

## familyhub

**Parent portal** — planned, not yet implemented.

---

## ui-tokens

Shared CSS design token package used across frontend modules.

- **Package**: `@neoapex/ui-tokens`
- **Exports**: `tokens.css` (CSS custom properties)
- **Used by**: `launchpad/frontend`, `papermite/frontend`

```bash
# Link locally during development
cd ui-tokens && npm link
cd ../launchpad/frontend && npm link @neoapex/ui-tokens
```

---

## sampledoc

Sample documents for testing the papermite extraction pipeline:
- `2025-2026 Afterschool Admission Packet.pdf`
- `Kenny's Application.pdf`
- `Wei's Application.pdf`

---

## Port Reference

| Service | Port |
|---------|------|
| papermite frontend | 5173 |
| admindash frontend | 5174 |
| launchpad frontend | 5175 |
| papermite backend | 8000 |
| launchpad backend | 8001 |
| datacore backend | 8081 |
