"""Tests for the Cloudflare IP allowlist middleware."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.cloudflare_ip import CloudflareIPMiddleware


def _make_app(trust_all_ips: bool = False) -> TestClient:
    app = FastAPI()
    app.add_middleware(CloudflareIPMiddleware, trust_all_ips=trust_all_ips)

    @app.get("/test")
    def test_route():
        return {"ok": True}

    @app.get("/api/health")
    def health_route():
        return {"status": "ok"}

    return TestClient(app)


def test_trust_all_ips_allows_any_source():
    client = _make_app(trust_all_ips=True)
    resp = client.get("/test")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_cloudflare_ipv4_via_fly_client_ip_is_allowed(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # 173.245.48.1 is inside the Cloudflare range 173.245.48.0/20
    resp = client.get("/test", headers={"fly-client-ip": "173.245.48.1"})
    assert resp.status_code == 200


def test_non_cloudflare_ipv4_via_fly_client_ip_is_rejected(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    resp = client.get("/test", headers={"fly-client-ip": "8.8.8.8"})
    assert resp.status_code == 403


def test_cloudflare_ipv6_via_fly_client_ip_is_allowed(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # 2400:cb00::1 is inside 2400:cb00::/32
    resp = client.get("/test", headers={"fly-client-ip": "2400:cb00::1"})
    assert resp.status_code == 200


def test_missing_fly_client_ip_falls_back_to_tcp_source(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    # TestClient's default source is 127.0.0.1, not in Cloudflare range
    resp = client.get("/test")
    assert resp.status_code == 403


def test_real_cloudflare_to_fly_request_is_allowed(monkeypatch):
    """Regression test for the 'Failed to check email' bug.

    Real traffic shape: Cloudflare puts the original client IP first in
    X-Forwarded-For (it's the user's home IP, not a Cloudflare IP),
    then fly-proxy sets Fly-Client-IP to the IP that connected to it
    (the Cloudflare edge IP). The middleware must check Fly-Client-IP,
    NOT XFF[0], or every proxied request gets blocked.
    """
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    resp = client.get(
        "/test",
        headers={
            "x-forwarded-for": "203.0.113.42",  # original client (residential)
            "fly-client-ip": "173.245.48.1",    # Cloudflare edge
        },
    )
    assert resp.status_code == 200


def test_xff_only_with_residential_client_is_rejected(monkeypatch):
    """An attacker hitting Fly directly cannot spoof past the allowlist by
    putting a Cloudflare IP as XFF[0] — without Fly-Client-IP being a
    Cloudflare IP, the request is rejected."""
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    resp = client.get(
        "/test",
        headers={
            "x-forwarded-for": "173.245.48.1",  # spoofed XFF
            "fly-client-ip": "8.8.8.8",         # actual upstream is not CF
        },
    )
    assert resp.status_code == 403


def test_health_endpoint_bypasses_ip_allowlist(monkeypatch):
    # Fly.io's internal health check does not originate from a Cloudflare IP.
    # /api/health must be reachable without any allowlist-passing header.
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    client = _make_app(trust_all_ips=False)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
