# familyhub/backend/app/ratelimit.py
"""Minimal in-memory per-IP throttling for the two unauthenticated
"spendy" routes (start + request-link). Deliberately simple: stdlib only,
per-process state (fine for the beta single-instance deploy; a shared
store is a documented follow-up if familyhub ever scales out).

Keyed on caller IP (`request.client.host`), not on anything the request
body carries (e.g. email) — a request-link caller controls the body
completely, so keying on it would make the limiter decorative. IP is the
only signal available on an unauthenticated route that a caller cannot
just vary per attempt.

Deliberately returns the SAME 429 body regardless of which limiter or
which key tripped it, and never varies behavior based on whether the
underlying request would have matched a real account — the limiter must
not become a second enumeration oracle alongside the request-link route
it guards.
"""
import time
from collections import deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = {}

    def check(self, key: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        q = self._hits.setdefault(key, deque())
        cutoff = now - self.window_seconds
        while q and q[0] <= cutoff:
            q.popleft()
        if len(q) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests; please wait a minute and try again",
            )
        q.append(now)


start_limiter = RateLimiter(max_requests=10, window_seconds=60.0)
request_link_limiter = RateLimiter(max_requests=10, window_seconds=60.0)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def limit_start(request: Request) -> None:
    start_limiter.check(_client_ip(request))


def limit_request_link(request: Request) -> None:
    request_link_limiter.check(_client_ip(request))
