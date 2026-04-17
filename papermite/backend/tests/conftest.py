"""Pytest fixtures for papermite backend tests."""
import pytest


@pytest.fixture(autouse=True)
def _bypass_cloudflare_middleware(monkeypatch):
    """Bypass the CloudflareIPMiddleware in all tests.

    The middleware rejects non-Cloudflare source IPs in production. In tests,
    TestClient uses 127.0.0.1 which is not in Cloudflare's range, so every
    test would return 403 without this bypass. Individual tests that need to
    exercise the non-trust path (test_cloudflare_ip.py) override this by
    calling monkeypatch.delenv("TRUST_ALL_IPS", raising=False).
    """
    monkeypatch.setenv("TRUST_ALL_IPS", "1")
