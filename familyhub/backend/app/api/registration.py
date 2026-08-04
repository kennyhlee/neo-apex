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
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
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


def _today() -> datetime.date:
    """Indirection point so tests can pin "today" without monkeypatching the
    stdlib `datetime.date` type directly."""
    return datetime.date.today()


def _school_year_for_date(ref: datetime.date) -> str:
    """Academic year straddling `ref`, rolling over each July --
    `${y}-${y+1}` where `y` is `ref`'s year if `ref.month >= 7` else
    `ref.year - 1`. Mirrors enrollx-frontend's staff-side
    `defaultSchoolYear()` (NewApplicationPage.tsx:13-17; its JS
    `getMonth() >= 6` is the same July boundary, 0-indexed)."""
    start_year = ref.year if ref.month >= 7 else ref.year - 1
    return f"{start_year}-{start_year + 1}"


def _default_school_year() -> str:
    """Fallback: the academic year straddling wall-clock today.

    Used only when the program's own `start_date` is missing or
    unparseable -- see `_school_year_for_program`. Using wall-clock time as
    the *primary* source (as this function alone once was) is wrong: a
    program for "2026-2027" that opens registration in March 2026 would
    stamp every parent who registers before July 2026 with "2025-2026",
    the prior year, since nothing about "today" ties to which year the
    program actually spans.
    """
    return _school_year_for_date(_today())


def _school_year_from_program(program: Optional[dict]) -> str:
    """Derive `school_year` from the program's own `start_date` -- ties the
    year to the specific program rather than to when the parent happens to
    click "register". `start_date` is a top-level DataCore field, so it
    arrives as a string; parse defensively and fall back to
    `_default_school_year()` for anything missing, empty, or unparseable
    rather than hard-failing the parent's registration."""
    start_date_raw = (program or {}).get("start_date")
    if isinstance(start_date_raw, str) and start_date_raw.strip():
        try:
            parsed = datetime.date.fromisoformat(start_date_raw.strip()[:10])
        except ValueError:
            parsed = None
        if parsed is not None:
            return _school_year_for_date(parsed)
    return _default_school_year()


@router.post(
    "/registration/{tenant_id}/{program_id}/start",
    dependencies=[Depends(limit_start)],
)
def start_registration(tenant_id: str, program_id: str, body: StartBody) -> Response:
    # Fetch the program's own record first so school_year can be derived
    # from its start_date rather than from wall-clock "today" (F1 fix).
    # Same upstream-error policy as every other route in this module: a
    # 4xx here (e.g. "not open for registration") is the real answer the
    # start call itself would have produced anyway; a 5xx is masked.
    bundle_resp = call_upstream(
        "GET",
        enrollx(f"/internal/registration/{tenant_id}/{program_id}/config"),
        headers=internal_headers(),
    )
    if bundle_resp.status_code >= 400:
        return _relay(bundle_resp)
    bundle = bundle_resp.json()
    school_year = _school_year_from_program(bundle.get("program"))

    resp = call_upstream(
        "POST",
        enrollx(f"/internal/registration/{tenant_id}/{program_id}/start"),
        json_body={
            "school_year": school_year,
            "applicant_email": body.applicant_email,
        },
        headers=internal_headers(),
    )
    if resp.status_code >= 400:
        return _relay(resp)
    data = resp.json()
    # ADJUST(bindings): key holding the magic-link token in the start response
    token = data.get("token")
    if not token:
        # Latent defense only -- the binding is confirmed correct today
        # (internal.py:81 always sets "token"). If it ever didn't, silently
        # building "/application/" would hand the parent a broken link.
        raise HTTPException(502, "Upstream did not return a magic-link token")
    data["hub_url"] = f"/application/{token}"
    return JSONResponse(data, status_code=resp.status_code)
