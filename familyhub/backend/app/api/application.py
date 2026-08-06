# familyhub/backend/app/api/application.py
"""Token-scoped application facade.

Every write is proxied to apexflow's internal API (Task 10 retarget --
interface map §7, task-10-brief.md's familyhub retarget: enrollx's
`/internal/application-by-token/*` -> apexflow's
`/internal/instance-by-token/*`). The facade enforces the parent action
allowlist BEFORE proxying -- apexflow's internal.py enforces its own
(`BLOCKED_TOKEN_ACTIONS`) again on the internal route (defense in depth, per
the plan's Global Constraints). Reuses `app.relay.relay()` for the
upstream-error policy (4xx verbatim, >=500 masked to a fixed 502) rather
than inventing a second error path.

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

# Defense-in-depth allowlist -- apexflow's own BLOCKED_TOKEN_ACTIONS
# (apexflow/backend/app/api/internal.py) re-enforces the equivalent
# restriction independently. This check exists so a rejected action never
# reaches the network at all, not merely so it fails somewhere.
#
# Coordinator review fix: this list is NOT "every action apexflow allows on
# the family channel" by construction -- it must be kept in sync BY HAND
# with the actor:family surface apexflow's machine.execute_action actually
# permits (every `actor: "family"` transition the enrollment template
# declares, plus the two item built-ins family may run) minus apexflow's
# own BLOCKED_TOKEN_ACTIONS complement (cancel_instance/verify_item/
# reject_item/waive_item, which are staff-only regardless of actor). The
# enrollment template (apexflow/backend/app/templates/enrollment.py) gives
# families `save_draft`, `complete_item`, `submit`, `withdraw`, and
# `resubmit` as `actor: "family"` transitions/built-ins.
#
# `withdraw` and `resubmit` were BOTH missing on a first pass (a real
# regression: apexflow allows them, but this facade 403'd them before the
# request ever left familyhub). `resubmit` in particular is the parent's
# ONLY path back from `pending_items` to `in_review` after fixing a
# rejected item (`t_resubmit` in the enrollment template) -- without it a
# parent who corrects a rejected item has no way to return the application
# to review and is stuck until staff manually intervenes, so it cannot be
# deferred the way a template-specific-but-non-critical action might be.
# Audit this list again the next time a template's family-facing action
# set changes.
PARENT_ACTIONS = {"save_draft", "complete_item", "submit", "withdraw", "resubmit"}


@router.get("/application/{token}")
def get_application(token: str) -> Response:
    resp = call_upstream(
        "GET",
        apexflow(f"/internal/instance-by-token/{token}"),
        headers=apexflow_headers(),
    )
    return _relay(resp)


@router.put("/application/{token}")
async def put_application(token: str, request: Request) -> Response:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body must be JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body must be a JSON object")
    action = payload.get("action")
    # `action not in PARENT_ACTIONS` alone raises TypeError for an unhashable
    # value (a list or dict) rather than rejecting it -- guard the type
    # first so any non-string action still gets the intended 403, not an
    # unhandled 500. The crash would have happened before call_upstream
    # either way (the security boundary held), but the contract is 403.
    if not isinstance(action, str) or action not in PARENT_ACTIONS:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Action not permitted via the family channel. "
                   "Allowed: complete_item, save_draft, submit",
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


@router.post("/application/request-link", dependencies=[Depends(limit_request_link)])
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
