"""Trusted-ingress IP allowlist middleware.

Rejects requests whose source IP is not within a trusted ingress range with
HTTP 403. Two classes of source are trusted:

1. Cloudflare edge IPs — public traffic that came in via the WAF. Prevents
   attackers from bypassing the WAF by finding the Fly.io origin IP via
   certificate transparency logs or historical DNS.
2. Fly internal network ranges (172.16.0.0/12, fdaa::/16) — sibling-app
   traffic via .flycast / .internal. fly-proxy sets fly-client-ip to the
   source machine's address on Fly's private network. These ranges are not
   internet-routable, so an external attacker cannot present them to
   fly-proxy from the public internet.

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

# Fly's internal networks. Sibling apps reach this service via .flycast or
# .internal; fly-proxy sets fly-client-ip to the source machine's address in
# one of these ranges. Not routable from the public internet, so an external
# attacker cannot present them to fly-proxy.
FLY_INTERNAL_IPV4_RANGES: list[str] = [
    "172.16.0.0/12",
]

FLY_INTERNAL_IPV6_RANGES: list[str] = [
    "fdaa::/16",
]


def _parse_networks(ranges: Iterable[str]) -> list[ipaddress._BaseNetwork]:
    return [ipaddress.ip_network(r) for r in ranges]


_TRUSTED_NETWORKS: list[ipaddress._BaseNetwork] = _parse_networks(
    CLOUDFLARE_IPV4_RANGES
    + CLOUDFLARE_IPV6_RANGES
    + FLY_INTERNAL_IPV4_RANGES
    + FLY_INTERNAL_IPV6_RANGES
)

# Paths exempted from the IP allowlist. Fly.io's internal health checker
# probes the machine directly (not through Cloudflare), so blocking it would
# mark the machine unhealthy and fail deploys.
_EXEMPT_PATHS: frozenset[str] = frozenset({"/api/health"})


def _is_trusted_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for network in _TRUSTED_NETWORKS:
        if ip.version != network.version:
            continue
        if ip in network:
            return True
    return False


def _client_ip_from_request(request: Request) -> str | None:
    """Extract the IP of the immediate upstream that connected to fly-proxy.

    Behind Cloudflare → Fly, fly-proxy sets `Fly-Client-IP` to the IP that
    opened the connection to it — i.e. the Cloudflare edge IP for proxied
    traffic. fly-proxy overwrites this header on every request, so it can't
    be spoofed by an attacker hitting Fly directly.

    NOT `X-Forwarded-For[0]`: Cloudflare puts the original client IP there
    (the user's residential IP), so it's never in CF ranges and every
    proxied request gets a 403.

    NOT `CF-Connecting-IP`: also the original client IP, and an attacker
    can spoof it by hitting Fly directly — defeating this allowlist.
    """
    fly_client_ip = request.headers.get("fly-client-ip")
    if fly_client_ip:
        return fly_client_ip.strip()

    client = request.client
    if client:
        return client.host
    return None


class CloudflareIPMiddleware(BaseHTTPMiddleware):
    """Reject requests whose source IP is not in a trusted ingress range."""

    def __init__(self, app: ASGIApp, trust_all_ips: bool = False) -> None:
        super().__init__(app)
        # Accept the constructor arg OR the env var — env var takes precedence
        # when explicitly set to "1", so tests and start-services.sh can both
        # toggle it.
        self.trust_all_ips = trust_all_ips or os.environ.get("TRUST_ALL_IPS") == "1"

    async def dispatch(self, request: Request, call_next):
        if self.trust_all_ips:
            return await call_next(request)

        if request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        client_ip = _client_ip_from_request(request)
        if client_ip is None or not _is_trusted_ip(client_ip):
            return JSONResponse(
                status_code=403,
                content={"detail": "Source IP not in trusted ingress range"},
            )

        return await call_next(request)
