"""Tests for the Cloudflare IP allowlist middleware."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.cloudflare_ip import CloudflareIPMiddleware


def _make_app(trust_all_ips: bool = False) -> TestClient:
    app = FastAPI()
    app.add_middleware(CloudflareIPMiddleware, trust_all_ips=trust_all_ips)

    @app.get("/test")
    def test_route():
        return {"ok": True}

    return TestClient(app)


def test_trust_all_ips_allows_any_source():
    client = _make_app(trust_all_ips=True)
    resp = client.get("/test")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_cloudflare_ipv4_is_allowed(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # 173.245.48.1 is inside the Cloudflare range 173.245.48.0/20
    resp = client.get("/test", headers={"x-forwarded-for": "173.245.48.1"})
    assert resp.status_code == 200


def test_non_cloudflare_ipv4_is_rejected(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    resp = client.get("/test", headers={"x-forwarded-for": "8.8.8.8"})
    assert resp.status_code == 403


def test_cloudflare_ipv6_is_allowed(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # 2400:cb00::1 is inside 2400:cb00::/32
    resp = client.get("/test", headers={"x-forwarded-for": "2400:cb00::1"})
    assert resp.status_code == 200


def test_missing_forwarded_for_header_is_rejected(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # TestClient's default source is 127.0.0.1, not in Cloudflare range
    resp = client.get("/test")
    assert resp.status_code == 403


def test_first_ip_in_xff_chain_is_used(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # Multiple IPs comma-separated; first is the original client (Cloudflare)
    resp = client.get(
        "/test",
        headers={"x-forwarded-for": "173.245.48.1, 10.0.0.1, 10.0.0.2"},
    )
    assert resp.status_code == 200
