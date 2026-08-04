# familyhub/backend/app/ratelimit.py
"""Minimal in-memory per-IP throttling for the two unauthenticated
"spendy" routes (start + request-link). Deliberately simple: stdlib only,
per-process state (fine for the beta single-instance deploy; a shared
store is a documented follow-up if familyhub ever scales out).

Keyed on the caller's real IP, not on anything the request body carries
(e.g. email) — a request-link caller controls the body completely, so
keying on it would make the limiter decorative. IP is the only signal
available on an unauthenticated route that a caller cannot just vary per
attempt.

Deliberately returns the SAME 429 body regardless of which limiter or
which key tripped it, and never varies behavior based on whether the
underlying request would have matched a real account — the limiter must
not become a second enumeration oracle alongside the request-link route
it guards.

`_client_ip` does NOT read `request.client.host` directly. In production
this service sits behind Cloudflare -> Fly -> uvicorn (no `--proxy-headers`),
so `request.client.host` is the same fly-proxy address for every request —
every parent would collapse onto one rate-limit key, making the limiter
simultaneously useless as a per-attacker control and a global outage switch
(the Nth registration attempt *platform-wide* in any window trips it, not
the Nth from one abuser). See `app.middleware.cloudflare_ip` (copy-pasted
from papermite/admindash/launchpad's identical module for the equivalent
ingress-verification problem) for the header this reads and why it's safe.
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
# The presign route is the only token-scoped surface that WRITES: every call
# creates a `document` row in DataCore and hands back an R2 PUT URL. DataCore's
# size check is advisory only -- a presigned PUT carries no length-range field
# (document_routes.py:105-110) -- so an unthrottled valid token buys unbounded
# rows AND unbounded bytes into the bucket, with each successive call costing
# more than the last (`_next_document_id`'s `_max_entity_seq` scan). Limit is
# higher than the other two because a legitimate family uploads several
# documents in one sitting and may retry a failed upload.
document_presign_limiter = RateLimiter(max_requests=20, window_seconds=60.0)


def _client_ip(request: Request) -> str:
    """The real end-client IP, for use as a per-attacker rate-limit key.

    `CF-Connecting-IP` carries the original client IP that reached
    Cloudflare's edge. Normally that header is NOT safe to trust — an
    attacker hitting Fly directly (bypassing Cloudflare) can set it to
    anything, which is exactly why `cloudflare_ip.py`'s ingress allowlist
    uses `Fly-Client-IP` instead for its own (different) purpose of
    verifying the request came via Cloudflare at all. It IS safe to trust
    *here* specifically because `CloudflareIPMiddleware` runs in front of
    every route in this app (`app/main.py`) and already 403s any request
    that didn't arrive via a genuine Cloudflare edge or Fly's private
    network — so by the time a route handler (and this dependency) sees
    the request, only Cloudflare could have set this header to anything
    meaningful.

    Falls back to `request.client.host` when the header is absent — local
    dev with no Cloudflare in front, `TRUST_ALL_IPS=1`, or a direct
    Fly-internal caller.
    """
    cf_connecting_ip = request.headers.get("cf-connecting-ip")
    if cf_connecting_ip:
        return cf_connecting_ip.strip()
    return request.client.host if request.client else "unknown"


def limit_start(request: Request) -> None:
    start_limiter.check(_client_ip(request))


def limit_request_link(request: Request) -> None:
    request_link_limiter.check(_client_ip(request))


def limit_document_presign(request: Request) -> None:
    document_presign_limiter.check(_client_ip(request))
