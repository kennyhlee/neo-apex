# familyhub/backend/tests/test_ratelimit.py
"""In-memory per-IP throttling: 10 per rolling 60s window, then 429."""
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.ratelimit import RateLimiter, _client_ip


def test_allows_up_to_max_within_window():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0 + i)  # no raise


def test_eleventh_request_in_window_is_429():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0 + i)
    with pytest.raises(HTTPException) as exc:
        rl.check("1.2.3.4", now=110.0)
    assert exc.value.status_code == 429


def test_window_slides():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0 + i)
    rl.check("1.2.3.4", now=161.0)  # first hit (t=100) has aged out -> allowed


def test_ips_are_independent():
    rl = RateLimiter(max_requests=10, window_seconds=60.0)
    for i in range(10):
        rl.check("1.2.3.4", now=100.0)
    rl.check("5.6.7.8", now=100.0)  # different key, no raise


# --- _client_ip: the key must be the real end-client IP, not the constant
# fly-proxy/Cloudflare-edge address every request would otherwise share
# behind Cloudflare -> Fly (see the module docstring and A3 of the plan-5
# final review). CloudflareIPMiddleware sits in front of every route in
# app/main.py, so any request reaching a handler has already been proven to
# have arrived via a genuine Cloudflare edge -- which is what makes trusting
# `CF-Connecting-IP` here safe rather than a spoofable free-for-all.

def _make_app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(request: Request):
        return {"ip": _client_ip(request)}

    return TestClient(app)


def test_client_ip_uses_cf_connecting_ip_when_present():
    client = _make_app()
    resp = client.get("/whoami", headers={"cf-connecting-ip": "203.0.113.42"})
    assert resp.json() == {"ip": "203.0.113.42"}


def test_client_ip_falls_back_to_tcp_source_without_cf_header():
    client = _make_app()
    resp = client.get("/whoami")
    # No fixed IP asserted -- only that it's TestClient's TCP-source
    # fallback (not `None`/"unknown"), since request.client.host is a
    # transport detail of the test harness, not something this test should
    # hardcode.
    assert resp.json()["ip"]
    assert resp.json()["ip"] != "unknown"


def test_client_ip_distinguishes_two_parents_behind_the_same_proxy():
    """The bug A3 fixes: without reading CF-Connecting-IP, every parent
    behind Cloudflare -> Fly presents as the same `request.client.host`
    (the fly-proxy address), so two different parents would collide onto
    one rate-limit key. They must not."""
    client = _make_app()
    ip_a = client.get("/whoami", headers={"cf-connecting-ip": "198.51.100.1"}).json()["ip"]
    ip_b = client.get("/whoami", headers={"cf-connecting-ip": "198.51.100.2"}).json()["ip"]
    assert ip_a != ip_b
