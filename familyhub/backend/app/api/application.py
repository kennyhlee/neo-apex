# familyhub/backend/app/api/application.py
"""Token-scoped application facade.

Every write is proxied to enrollx's internal API. The facade enforces the
parent action allowlist BEFORE proxying -- enrollx enforces it again on the
internal route (defense in depth, per the plan's Global Constraints). Reuses
registration.py's `_relay()` for the upstream-error policy (4xx verbatim,
>=500 masked to a fixed 502) rather than inventing a second error path.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.api.registration import _relay
from app.ratelimit import limit_request_link
from app.upstream import call_upstream, enrollx, internal_headers

router = APIRouter()

# Defense-in-depth allowlist -- enrollx's own PARENT_ACTIONS
# (enrollx/backend/app/registration/actions.py:22) re-enforces this
# independently. This check exists so a rejected action never reaches the
# network at all, not merely so it fails somewhere.
PARENT_ACTIONS = {"save_draft", "complete_item", "submit"}


@router.get("/application/{token}")
def get_application(token: str) -> Response:
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/application-by-token/{token}"),
        headers=internal_headers(),
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
    if action not in PARENT_ACTIONS:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Action not permitted via the family channel. "
                   "Allowed: complete_item, save_draft, submit",
        )
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/application-by-token/{token}/actions"),
        json_body=payload,
        headers=internal_headers(),
    )
    return _relay(resp)


class RequestLinkBody(BaseModel):
    tenant_id: str
    email: str
    program_id: Optional[str] = None


@router.post("/application/request-link", dependencies=[Depends(limit_request_link)])
def request_link(body: RequestLinkBody) -> dict:
    # Constant response: the caller must never learn whether the email
    # matched an application (no account enumeration). enrollx's own
    # internal route already returns 200 {} unconditionally regardless of
    # match, deferring the send via BackgroundTasks -- this route ignores
    # whatever comes back (status code included) and always answers the
    # same fixed body, so an upstream 5xx can't become a distinguishing
    # signal either.
    call_upstream(
        "POST",
        enrollx(f"/internal/registration/{body.tenant_id}/request-link"),
        json_body={"email": body.email, "program_id": body.program_id},
        headers=internal_headers(),
    )
    return {"status": "ok"}


class CheckoutBody(BaseModel):
    item_id: Optional[str] = None


@router.post("/application/{token}/checkout")
def start_checkout(token: str, body: CheckoutBody = CheckoutBody()) -> Response:
    resp = call_upstream(
        "POST",
        # ADJUST(bindings) checked: bindings table confirms this exact path
        # (checkout.py:41-53, mounted with prefix="/internal") -- the
        # roadmap-contract default was already correct, no change made.
        enrollx(f"/internal/application-by-token/{token}/checkout"),
        json_body=body.model_dump(),
        headers=internal_headers(),
    )
    return _relay(resp)
