# familyhub/backend/app/api/registration.py
"""Public registration facade routes.

No credential at all on these two routes -- the config bundle is public
data, and start creates a draft application + issues the magic link. start
is rate limited per IP because it sends email and creates a row per hit.

Upstream-error policy (applies to every route in this module; Tasks 5 and 6
should follow the same split):
- 4xx from enrollx is passed through verbatim. These are meaningful,
  parent-safe states -- "this program isn't open for registration" (404),
  a validation complaint -- not internal detail. A parent hitting a closed
  registration link deserves the real 404, not a generic error.
- 5xx from enrollx (or anything else >= 500) is NEVER passed through.
  call_upstream already collapses network-level failures (httpx.RequestError)
  to a generic 502; an application-level 5xx from enrollx can carry a raw
  exception string or DataCore internals in its body, so it gets the exact
  same treatment here -- masked to a fixed, non-diagnostic 502. The parent
  never sees why; the "why" belongs in enrollx's own logs.
"""
import datetime

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.ratelimit import limit_start
from app.upstream import call_upstream, enrollx, internal_headers

router = APIRouter()

_GENERIC_UPSTREAM_ERROR = {
    "detail": "Registration is temporarily unavailable. Please try again shortly."
}


def _relay(resp) -> Response:
    """Pass an upstream response back to the parent, masking 5xx bodies."""
    if resp.status_code >= 500:
        return JSONResponse(_GENERIC_UPSTREAM_ERROR, status_code=502)
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


@router.get("/registration/{tenant_id}/{program_id}")
def get_registration_bundle(tenant_id: str, program_id: str) -> Response:
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/registration/{tenant_id}/{program_id}/config"),
        headers=internal_headers(),
    )
    return _relay(resp)


class StartBody(BaseModel):
    applicant_email: str

    @field_validator("applicant_email")
    @classmethod
    def basic_email_shape(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 6 or "@" not in v or "." not in v.rsplit("@", 1)[-1]:
            raise ValueError("invalid email address")
        return v


def _default_school_year() -> str:
    """Academic year straddling today, rolling over each July.

    enrollx's internal start route requires `school_year` with no default
    (StartRequest.school_year: str, enrollx/backend/app/api/internal.py:35-36),
    but the parent-facing contract for this route (task brief) carries only
    `applicant_email` -- parents aren't asked to pick a school year. The
    facade fills it in itself, mirroring enrollx-frontend's own staff-side
    default (`defaultSchoolYear()`, NewApplicationPage.tsx:13-17) so the
    convention is identical on both channels.
    """
    today = datetime.date.today()
    start_year = today.year if today.month >= 7 else today.year - 1
    return f"{start_year}-{start_year + 1}"


@router.post(
    "/registration/{tenant_id}/{program_id}/start",
    dependencies=[Depends(limit_start)],
)
def start_registration(tenant_id: str, program_id: str, body: StartBody) -> Response:
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/registration/{tenant_id}/{program_id}/start"),
        json_body={
            "school_year": _default_school_year(),
            "applicant_email": body.applicant_email,
        },
        headers=internal_headers(),
    )
    if resp.status_code >= 400:
        return _relay(resp)
    data = resp.json()
    # ADJUST(bindings): key holding the magic-link token in the start response
    token = data.get("token", "")
    data["hub_url"] = f"/application/{token}"
    return JSONResponse(data, status_code=resp.status_code)
