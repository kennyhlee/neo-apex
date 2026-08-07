"""Referrer-Policy + access-log token scrubbing.

Magic-link tokens travel in URL paths by design (roadmap Plans 1-3), so:
- every response carries `Referrer-Policy: no-referrer`
- uvicorn's access log has the token path segment replaced with [token]

IMPORTANT: This file is COPY-PASTED across familyhub/backend/app/middleware/
(this copy) and apexflow/backend/app/middleware/. Keep both copies in sync
(the only intended difference is this self-reference in the docstring).
"""
import logging
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_TOKEN_IN_PATH = re.compile(
    r"(/(?:api/instance|internal/instance-by-token)/)[^/\s?\"]+"
)
_TOKEN_IN_QUERY = re.compile(r"(\btoken=)[^&\s\"]+")


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
        if record.args:
            record.args = tuple(
                _scrub(a) if isinstance(a, str) else a for a in record.args
            )
        return True


def install_access_log_scrubber() -> None:
    logger = logging.getLogger("uvicorn.access")
    if any(isinstance(f, AccessLogTokenScrubFilter) for f in logger.filters):
        return
    logger.addFilter(AccessLogTokenScrubFilter())
