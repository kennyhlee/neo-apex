# familyhub/backend/app/api/instance.py
"""Token-scoped instance facade.

Every write is proxied to apexflow's internal API (Task 10 retarget --
interface map §7, task-10-brief.md's familyhub retarget: enrollx's
`/internal/application-by-token/*` -> apexflow's
`/internal/instance-by-token/*`). Reuses `app.relay.relay()` for the
upstream-error policy (4xx verbatim, >=500 masked to a fixed 502) rather
than inventing a second error path.

Task 6 (Plan 3): module renamed `application.py` -> `instance.py`, routes
renamed `/application/*` -> `/instance/*`. `PARENT_ACTIONS` and its
hand-synced allowlist guard are DELETED (Plan 1 follow-up item 7): the
local guard on PUT shrinks to shape-validation only -- the body must be a
JSON object with a string `action`, checked BEFORE any network call, purely
so a malformed request never costs a round trip. Everything else --
including which specific actions are permitted on the family channel -- is
apexflow's call now. apexflow's own `BLOCKED_TOKEN_ACTIONS` 403 and its
actor-gating in `machine.execute_action` are the SOLE authority; their
responses relay back through the existing 4xx-verbatim convention, same as
every other route in this module. This retires the hand-synced-list
maintenance burden the previous PARENT_ACTIONS docstring called out
(`withdraw`/`resubmit` were both real regressions from that list drifting
out of sync with apexflow's actual family-permitted action set) -- there is
no longer a second list to drift.

Task 12: the `checkout` route (proxied to enrollx, which had the only
Stripe/payments surface) was removed along with enrollx itself -- payments
are out of scope for Plan 1 and apexflow has no checkout surface to
retarget it to. See `app/config.py`'s module docstring.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.ratelimit import limit_request_link
from app.relay import relay as _relay
from app.upstream import apexflow, apexflow_headers, call_upstream

router = APIRouter()


@router.get("/instance/{token}")
def get_instance(token: str) -> Response:
    resp = call_upstream(
        "GET",
        apexflow(f"/internal/instance-by-token/{token}"),
        headers=apexflow_headers(),
    )
    return _relay(resp)


@router.put("/instance/{token}")
async def put_instance(token: str, request: Request) -> Response:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body must be JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body must be a JSON object")
    action = payload.get("action")
    # Shape-validation only -- NOT an allowlist (module docstring). A
    # non-string `action` (missing, wrong type, unhashable) still 400s
    # locally before any network call; which string VALUES are permitted is
    # entirely apexflow's decision now (it declares `action: str` on its own
    # `InternalActionRequest` with no further local constraint), relayed
    # verbatim via `_relay`.
    if not isinstance(action, str):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Body must include a string 'action'",
        )
    resp = call_upstream(
        "POST",
        apexflow(f"/internal/instance-by-token/{token}/actions"),
        json_body=payload,
        headers=apexflow_headers(),
    )
    return _relay(resp)


class RequestLinkBody(BaseModel):
    tenant_id: str
    email: str


@router.post("/instance/request-link", dependencies=[Depends(limit_request_link)])
def request_link(body: RequestLinkBody) -> dict:
    # Constant response: the caller must never learn whether the email
    # matched an instance (no account enumeration). apexflow's own internal
    # route already returns 200 {} unconditionally regardless of match,
    # deferring the send via BackgroundTasks -- this route ignores whatever
    # comes back (status code included) and always answers the same fixed
    # body, so an upstream 5xx can't become a distinguishing signal either.
    # A genuine apexflow outage must not break that either: call_upstream
    # raises HTTPException(502) on httpx.RequestError, and that failure is
    # identical for every email regardless of match -- it is not an
    # enumeration leak -- but the route's contract is "always 200", so
    # swallow it too rather than letting it propagate.
    try:
        call_upstream(
            "POST",
            apexflow(f"/internal/workflows/{body.tenant_id}/request-link"),
            json_body={"email": body.email},
            headers=apexflow_headers(),
        )
    except HTTPException:
        pass
    return {"status": "ok"}
