"""Server-side port of admindash's familyMatch.ts / familyPlan.ts:
match an applicant's family against existing family entities by normalized
email -> phone -> name+address signature; create when no key or no match.
"""
import re

from app.registration import datacore as dc


def _text(v) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip()).lower()


def _digits(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def normalize_signature(fields: dict) -> dict:
    return {
        "email": _text(fields.get("primary_email")),
        "phone": _digits(fields.get("primary_phone")),
        "name": _text(fields.get("family_name")),
        "address": _text(fields.get("primary_address")),
    }


def signature_key(sig: dict) -> str:
    if sig["email"]:
        return f"e:{sig['email']}"
    if sig["phone"]:
        return f"p:{sig['phone']}"
    if sig["name"] and sig["address"]:
        return f"na:{sig['name']}|{sig['address']}"
    return ""


def match_family(sig: dict, candidates: list[dict]) -> str | None:
    key = signature_key(sig)
    if not key:
        return None
    for c in candidates:
        if signature_key(normalize_signature(c)) == key:
            return c["entity_id"]
    return None


def match_or_create_family(tenant_id: str, family_fields: dict, token=None) -> str:
    sig = normalize_signature(family_fields)
    candidates = dc.list_entities(tenant_id, "family", "", token)
    matched = match_family(sig, candidates)
    if matched:
        return matched
    base = {k: v for k, v in family_fields.items() if v not in (None, "")}
    if not base.get("family_name"):
        base["family_name"] = (family_fields.get("primary_email")
                               or family_fields.get("primary_phone") or "Family")
    created = dc.dc_create(tenant_id, "family", base, token)
    return created["entity_id"]
