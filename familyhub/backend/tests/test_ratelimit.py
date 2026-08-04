# familyhub/backend/tests/test_ratelimit.py
"""In-memory per-IP throttling: 10 per rolling 60s window, then 429."""
import pytest
from fastapi import HTTPException

from app.ratelimit import RateLimiter


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
