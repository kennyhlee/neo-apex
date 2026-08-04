# familyhub/backend/app/tokenutil.py
"""Decode (NOT verify) magic-link tokens.

Token format (roadmap contract): URL-safe base64 of
"{tenant_id}.{application_id}.{signature}". familyhub only ever decodes to
learn which tenant/application to address AFTER enrollx has already
verified the signature via an internal application-by-token call. Never
call parse_token on a token that enrollx has not just validated.

This is parsing only. familyhub has no access to enrollx's link_secret and
must never attempt to verify a signature itself — verify_link_token in
enrollx takes (token, token_version) with no default, and it is enrollx's
job (not familyhub's) to call it against the row's stored token_version.
"""
import base64

from fastapi import HTTPException, status


def parse_token(token: str) -> tuple[str, str]:
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, application_id, _signature = raw.split(".", 2)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Malformed token")
    if not tenant_id or not application_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Malformed token")
    return tenant_id, application_id
