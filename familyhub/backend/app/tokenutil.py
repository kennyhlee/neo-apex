# familyhub/backend/app/tokenutil.py
"""Decode (NOT verify) magic-link tokens.

Token format (roadmap contract): URL-safe base64 of
"{tenant_id}.{application_id}.{signature}". familyhub only ever decodes to
learn which tenant/application to address AFTER apexflow has already
verified the signature via an internal instance-by-token call (Task 10
retarget; apexflow was enrollx pre-Task-12). Never call parse_token on a
token that apexflow has not just validated.

This is parsing only. familyhub has no access to apexflow's link_secret and
must never attempt to verify a signature itself — verify_link_token in
apexflow (app/workflows/tokens.py) takes (token, token_version) with no
default, and it is apexflow's job (not familyhub's) to call it against the
row's stored token_version.
"""
import base64

from fastapi import HTTPException, status


def parse_token(token: str) -> tuple[str, str]:
    # Unbounded split + exact-3 unpack, mirroring apexflow's parse_link_token
    # (app/workflows/tokens.py:87) EXACTLY. Its comment forbids the bounded
    # form (`split(".", 2)` / `rsplit`) because absorbing extra dots into a
    # field reopens a scope-confusion class. familyhub's parser must never be
    # more lenient than the parser that signs: a token this accepted but
    # apexflow rejected could only ever produce a scope apexflow never issued.
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, application_id, _signature = raw.split(".")
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Malformed token")
    if not tenant_id or not application_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Malformed token")
    return tenant_id, application_id
