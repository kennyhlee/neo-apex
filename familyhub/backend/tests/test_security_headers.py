# familyhub/backend/tests/test_security_headers.py
"""Tests for the Referrer-Policy header + access-log token scrubbing.

Copied (with app-specific health path already matching -- familyhub's health
route is `/api/health`, and its token-bearing route is
`/api/instance/{token}`) from apexflow's identical test file -- see
app/middleware/security_headers.py's own docstring for why this module is
copy-pasted rather than shared.
"""
import logging

from fastapi.testclient import TestClient

from app.main import app
from app.middleware.security_headers import AccessLogTokenScrubFilter


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
