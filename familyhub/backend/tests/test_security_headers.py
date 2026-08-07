# familyhub/backend/tests/test_security_headers.py
"""Tests for the Referrer-Policy header + access-log token scrubbing.

Copied (with app-specific health path already matching -- familyhub's health
route is `/api/health`, and its token-bearing route is
`/api/instance/{token}`) from apexflow's identical test file -- see
app/middleware/security_headers.py's own docstring for why this module is
copy-pasted rather than shared.
"""
import base64
import logging

from fastapi.testclient import TestClient

from app.main import app
from app.middleware.security_headers import AccessLogTokenScrubFilter


def _fake_real_shaped_token() -> str:
    # Mirrors apexflow's make_link_token format exactly (app/workflows/
    # tokens.py, mirrored in familyhub's tokenutil.py docstring): urlsafe-b64
    # of "{tenant_id}.{application_id}.{64-hex-char-hmac-sig}", padding
    # stripped. familyhub has no access to apexflow's link_secret so it can't
    # mint a real one, but the SHAPE (and therefore whether the scrub regex's
    # length/charset heuristic matches it) is identical.
    raw = "acme.entity123." + ("a" * 64)
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def test_referrer_policy_on_every_response():
    client = TestClient(app)
    assert client.get("/api/health").headers["Referrer-Policy"] == "no-referrer"
    # any 404 also carries it (middleware wraps all responses)
    assert client.get("/api/nope").headers["Referrer-Policy"] == "no-referrer"


def test_access_log_filter_scrubs_token_paths():
    f = AccessLogTokenScrubFilter()
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        (
            "1.2.3.4:1",
            "GET",
            "/api/instance/eyJhbGciOi.secretpart/documents",
            "1.1",
            200,
        ),
        None,
    )
    assert f.filter(rec) is True
    assert "secretpart" not in rec.getMessage()
    assert "[token]" in rec.getMessage()


def test_access_log_filter_scrubs_query_token():
    f = AccessLogTokenScrubFilter()
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        (
            "1.2.3.4:1",
            "GET",
            "/w/acme/enrollment?token=abc.def.ghi",
            "1.1",
            200,
        ),
        None,
    )
    assert f.filter(rec) is True
    assert "abc.def.ghi" not in rec.getMessage()
    assert "?token=[token]" in rec.getMessage()


def test_access_log_filter_scrubs_a_real_shaped_token():
    # Round-1 review: the path-scrub regex must actually match a real
    # make_link_token()-shaped value (always well over the 20-char heuristic
    # floor), not just the brief's fictional JWT-shaped example.
    real_token = _fake_real_shaped_token()
    f = AccessLogTokenScrubFilter()
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        (
            "1.2.3.4:1",
            "GET",
            f"/api/instance/{real_token}",
            "1.1",
            200,
        ),
        None,
    )
    assert f.filter(rec) is True
    assert real_token not in rec.getMessage()
    assert "[token]" in rec.getMessage()


def test_access_log_filter_leaves_request_link_route_unscrubbed():
    # Round-1 review finding: `/api/instance/request-link`
    # (app/api/instance.py) is a real, static sibling route under the same
    # `/api/instance/` prefix as the token-scoped routes -- NOT a token. The
    # previous unbounded-charset regex over-matched it (13 chars, all in
    # `[^/\s?"]+`), silently destroying that endpoint's access-log
    # observability. It must be left alone.
    f = AccessLogTokenScrubFilter()
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:1", "POST", "/api/instance/request-link", "1.1", 200),
        None,
    )
    assert f.filter(rec) is True
    assert (
        rec.getMessage()
        == '1.2.3.4:1 - "POST /api/instance/request-link HTTP/1.1" 200'
    )


def test_access_log_filter_leaves_plain_paths_alone():
    f = AccessLogTokenScrubFilter()
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:1", "GET", "/api/health", "1.1", 200),
        None,
    )
    assert f.filter(rec) is True
    assert rec.getMessage() == '1.2.3.4:1 - "GET /api/health HTTP/1.1" 200'
