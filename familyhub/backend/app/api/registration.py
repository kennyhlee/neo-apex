# familyhub/backend/app/api/registration.py
"""Public registration facade routes.

No credential at all on these two routes -- the config bundle is public
data, and start creates a draft application + issues the magic link. start
is rate limited per IP because it sends email and creates a row per hit.

Scope: registration is admission to the SCHOOL as a whole for one school
year (spec §1), so both routes are keyed on tenant_id alone. There is no
program segment anywhere in this module.

Upstream-error policy (applies to every route in this module):
- 4xx from enrollx is passed through verbatim. These are meaningful,
  parent-safe states -- "this school isn't open for registration" (404),
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

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.ratelimit import limit_start
from app.relay import relay as _relay
from app.upstream import call_upstream, enrollx, internal_headers

router = APIRouter()


@router.get("/registration/{tenant_id}")
def get_registration_bundle(tenant_id: str) -> Response:
    """The public config bundle: `{config, tenant, capacity}`.

    The `config.blocks` enrollx returns are already MODEL-HYDRATED (its
    `engine.hydrate_config_blocks`): familyhub holds no DataCore credential,
    so an entity-sourced form block would otherwise render with no fields at
    all. Do not attempt to resolve model fields here.
    """
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/registration/{tenant_id}/config"),
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
    `ref.year - 1`.

    Restates flow-runtime's `defaultSchoolYear()` (its JS `getMonth() >= 6`
    is the same July boundary, 0-indexed) and enrollx's
    `engine.default_school_year`. All three must agree: the parent sees this
    value on the start page, enrollx computes its capacity snapshot for it,
    and the staff form prefills the same string.

    Wall-clock is now the only source, and correctly so. The former
    program-`start_date` derivation existed because a program could span a
    year other than the current one -- a whole-school application has no such
    anchor, so the school year being registered for IS the one straddling
    today.
    """
    start_year = ref.year if ref.month >= 7 else ref.year - 1
    return f"{start_year}-{start_year + 1}"


@router.post(
    "/registration/{tenant_id}/start",
    dependencies=[Depends(limit_start)],
)
def start_registration(tenant_id: str, body: StartBody) -> Response:
    # No pre-flight config fetch: it existed only to read program.start_date,
    # and only enrollx can answer "is this school open" -- which the start
    # call itself already does, with the same 4xx-through/5xx-masked policy.
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/registration/{tenant_id}/start"),
        json_body={
            "school_year": _school_year_for_date(_today()),
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
        # (internal.py always sets "token"). If it ever didn't, silently
        # building "/application/" would hand the parent a broken link.
        raise HTTPException(502, "Upstream did not return a magic-link token")
    data["hub_url"] = f"/application/{token}"
    return JSONResponse(data, status_code=resp.status_code)
