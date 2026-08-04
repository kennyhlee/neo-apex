# familyhub/backend/app/relay.py
"""Shared upstream-error relay policy.

Applies to every route that proxies an upstream (enrollx/DataCore) response
back to the parent verbatim:
- 4xx from upstream is passed through verbatim. These are meaningful,
  parent-safe states -- "this program isn't open for registration" (404),
  a validation complaint -- not internal detail. A parent hitting a closed
  registration link deserves the real 404, not a generic error.
- 5xx from upstream (or anything else >= 500) is NEVER passed through.
  call_upstream already collapses network-level failures (httpx.RequestError)
  to a generic 502; an application-level 5xx from upstream can carry a raw
  exception string or DataCore internals in its body, so it gets the exact
  same treatment here -- masked to a fixed, non-diagnostic 502. The parent
  never sees why; the "why" belongs in upstream's own logs.

Originally defined in app/api/registration.py; promoted here once a second
route module (app/api/application.py) needed the identical policy, so
neither importer reaches across module boundaries for a leading-underscore
name.
"""
from fastapi import Response
from fastapi.responses import JSONResponse

_GENERIC_UPSTREAM_ERROR = {
    "detail": "Registration is temporarily unavailable. Please try again shortly."
}


def relay(resp) -> Response:
    """Pass an upstream response back to the parent, masking 5xx bodies."""
    if resp.status_code >= 500:
        return upstream_unavailable()
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


def upstream_unavailable() -> Response:
    """The same masked 502 `relay` produces, for failures that carry no
    upstream status of their own: an unparseable body, or a response whose
    shape contradicts itself (e.g. a token bundle naming a different
    application than the token did). Exported so callers reuse the one
    error path rather than re-typing the message or reaching for the
    module-private constant."""
    return JSONResponse(_GENERIC_UPSTREAM_ERROR, status_code=502)
