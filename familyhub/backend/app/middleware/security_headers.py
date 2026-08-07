"""Referrer-Policy + access-log token scrubbing.

Magic-link tokens travel in URL paths by design (roadmap Plans 1-3), so:
- every response carries `Referrer-Policy: no-referrer`
- uvicorn's access log has the token path segment replaced with [token]

IMPORTANT: This file is COPY-PASTED across familyhub/backend/app/middleware/
(this copy) and apexflow/backend/app/middleware/. Keep both copies in sync
(the only intended difference is this self-reference in the docstring).

_TOKEN_IN_PATH's segment charset is deliberately narrower than "anything
that isn't a slash": it requires >=20 chars from the base64url alphabet
(plus '.', '=', '-' for readability/padding) so a real magic-link token
always matches (real tokens are urlsafe_b64encode of
"{tenant}.{app_entity_id}.{64-hex-char-hmac-sig}" with padding stripped --
see apexflow's app/workflows/tokens.py -- which is always >=90 chars) while
a short, literal sibling route segment like familyhub's
`/api/instance/request-link` (13 chars) does NOT match and so is left
unscrubbed in the access log. A bare `[^/\\s?\"]+` here would over-match
that route and silently destroy its log observability -- see task-9 review
round 1.
"""
import logging
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_TOKEN_IN_PATH = re.compile(
    r"(/(?:api/instance|internal/instance-by-token)/)[A-Za-z0-9_.=-]{20,}"
)
_TOKEN_IN_QUERY = re.compile(r"([?&]token=)[^&\s\"]+")


class SecurityHeadersMiddleware:
    """Pure-ASGI: adds Referrer-Policy to every HTTP response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.append((b"referrer-policy", b"no-referrer"))
            await send(message)

        await self.app(scope, receive, send_with_header)


def _scrub(value: str) -> str:
    value = _TOKEN_IN_PATH.sub(r"\1[token]", value)
    return _TOKEN_IN_QUERY.sub(r"\1[token]", value)


class AccessLogTokenScrubFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if record.args and isinstance(record.args, tuple):
            record.args = tuple(
                _scrub(a) if isinstance(a, str) else a for a in record.args
            )
        return True


def install_access_log_scrubber() -> None:
    logger = logging.getLogger("uvicorn.access")
    if any(isinstance(f, AccessLogTokenScrubFilter) for f in logger.filters):
        return
    logger.addFilter(AccessLogTokenScrubFilter())
