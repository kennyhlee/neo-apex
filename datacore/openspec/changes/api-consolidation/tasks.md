## 1. Unified query endpoint

- [ ] 1.1 Create `unified_routes.py` with `POST /api/query` supporting entities, models, and tenants tables — with tests
- [ ] 1.2 Register unified routes in `__init__.py`

## 2. Verification

- [ ] 2.1 Run all DataCore tests — existing + new all pass
- [ ] 2.2 Verify existing REST endpoints still work (no regressions)
- [ ] 2.3 End-to-end: start services, test unified query with curl
