# apexflow/backend/tests/test_health.py
"""App boot smoke test + one representative rejection test per auth dep.

Ported/retargeted from enrollx/backend/tests/test_health.py and
test_auth_guards.py — see interface map §2. apexflow-backend has no business
routes yet (this task scaffolds only /health plus the auth deps themselves;
see task-1-brief.md's file list), so unlike enrollx's route-level guard
tests, these call the dependency functions directly rather than through a
{tenant_id}-scoped route. A later task that ports real routes should add
route-level guard tests alongside them, the way enrollx's
test_auth_guards.py does.
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import require_internal_key, require_role, require_staff_tenant
from app.main import app


def test_health():
    resp = TestClient(app).get("/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "apexflow-backend"


def test_require_role_rejects_wrong_role_403():
    dependency = require_role("admin", "staff")
    with pytest.raises(HTTPException) as exc:
        dependency(user={"role": "parent", "tenant_id": "acme"})
    assert exc.value.status_code == 403


# ADJUST(bindings): named `require_tenant_match` in task-1-brief.md; ported as
# `require_staff_tenant`, its real name in enrollx (interface map §2, §F) —
# see app/auth.py for the full note on this rename.
def test_require_staff_tenant_rejects_cross_tenant_403():
    with pytest.raises(HTTPException) as exc:
        require_staff_tenant("globex", user={"role": "admin", "tenant_id": "acme"})
    assert exc.value.status_code == 403


def test_require_internal_key_rejects_missing_key_401():
    """require_internal_key has no role/tenant concept, just a single shared
    secret (interface map §2) — it never returns 403, so its representative
    rejection is 401, matching enrollx's own test_internal_api.py."""
    with pytest.raises(HTTPException) as exc:
        require_internal_key(None)
    assert exc.value.status_code == 401
