"""Cloudflare IP allowlist middleware.

Rejects requests whose source IP is not within Cloudflare's published IP
ranges with HTTP 403. This prevents attackers from bypassing the Cloudflare
WAF by finding the Fly.io origin IP via certificate transparency logs or
historical DNS.

IMPORTANT: This file is COPY-PASTED across launchpad/backend/app/middleware/,
papermite/backend/app/middleware/, and admindash/backend/app/middleware/.
Keep all three copies in sync. When Cloudflare updates its IP ranges (rare),
update CLOUDFLARE_IPV4_RANGES / CLOUDFLARE_IPV6_RANGES in all three files.

Cloudflare IPs as of 2026-04-11, from https://www.cloudflare.com/ips/
A follow-up change will fetch this list at container start instead of
hardcoding it.
"""
import ipaddress
import os
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp


CLOUDFLARE_IPV4_RANGES: list[str] = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
]

CLOUDFLARE_IPV6_RANGES: list[str] = [
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
]


def _parse_networks(ranges: Iterable[str]) -> list[ipaddress._BaseNetwork]:
    return [ipaddress.ip_network(r) for r in ranges]


_CF_NETWORKS: list[ipaddress._BaseNetwork] = _parse_networks(
    CLOUDFLARE_IPV4_RANGES + CLOUDFLARE_IPV6_RANGES
)


def _is_cloudflare_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for network in _CF_NETWORKS:
        if ip.version != network.version:
            continue
        if ip in network:
            return True
    return False


def _client_ip_from_request(request: Request) -> str | None:
    """Extract the client IP from the X-Forwarded-For header.

    Cloudflare sets X-Forwarded-For to a comma-separated chain ending at the
    original client. The FIRST entry is the original client IP; subsequent
    entries are intermediate proxies. We check the FIRST entry.

    If no XFF header is present, fall back to the TCP source IP from the ASGI
    scope — but in production behind Cloudflare this should always be set.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first

    client = request.client
    if client:
        return client.host
    return None


class CloudflareIPMiddleware(BaseHTTPMiddleware):
    """Reject requests whose source IP is not within Cloudflare's IP ranges."""

    def __init__(self, app: ASGIApp, trust_all_ips: bool = False) -> None:
        super().__init__(app)
        # Accept the constructor arg OR the env var — env var takes precedence
        # when explicitly set to "1", so tests and start-services.sh can both
        # toggle it.
        self.trust_all_ips = trust_all_ips or os.environ.get("TRUST_ALL_IPS") == "1"

    async def dispatch(self, request: Request, call_next):
        if self.trust_all_ips:
            return await call_next(request)

        client_ip = _client_ip_from_request(request)
        if client_ip is None or not _is_cloudflare_ip(client_ip):
            return JSONResponse(
                status_code=403,
                content={"detail": "Source IP not in Cloudflare range"},
            )

        return await call_next(request)
