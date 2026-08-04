"""Server-side family match-or-create (port of admindash familyMatch/familyPlan)."""
import pytest

from app.registration.family import (
    match_family,
    match_or_create_family,
    normalize_signature,
    signature_key,
)
from tests.fakes import FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_signature_normalization_and_key_priority():
    sig = normalize_signature({
        "primary_email": "  P@X.Com ",
        "primary_phone": "(555) 123-4567",
        "family_name": "  Lee   Family ",
        "primary_address": "1 Main St",
    })
    assert sig == {"email": "p@x.com", "phone": "5551234567",
                   "name": "lee family", "address": "1 main st"}
    assert signature_key(sig) == "e:p@x.com"
    assert signature_key({**sig, "email": ""}) == "p:5551234567"
    assert signature_key({**sig, "email": "", "phone": ""}) == "na:lee family|1 main st"
    assert signature_key({"email": "", "phone": "", "name": "x", "address": ""}) == ""


def test_matches_existing_family_by_email(fake_dc):
    fam = fake_dc.dc_create("acme", "family",
                            {"family_name": "Lee", "primary_email": "P@X.com"})
    fid, outcome = match_or_create_family("acme", {"primary_email": " p@x.com ",
                                                   "family_name": "Lee Family"})
    assert fid == fam["entity_id"] and outcome == "matched"
    assert len(fake_dc.find("family")) == 1  # no duplicate created


def test_matches_by_phone_digits(fake_dc):
    fam = fake_dc.dc_create("acme", "family",
                            {"family_name": "Ng", "primary_phone": "5551234567"})
    fid, outcome = match_or_create_family("acme", {"primary_phone": "(555) 123-4567"})
    assert fid == fam["entity_id"] and outcome == "matched"


def test_creates_family_when_no_match(fake_dc):
    fid, outcome = match_or_create_family("acme", {
        "primary_email": "new@x.com", "family_name": "New Family",
        "primary_phone": "5550000000", "primary_address": "2 Oak Ave"})
    rows = fake_dc.find("family", primary_email="new@x.com")
    assert rows and rows[0]["entity_id"] == fid and outcome == "created"
    assert rows[0]["family_name"] == "New Family"


def test_no_signature_creates_solo_family(fake_dc):
    fake_dc.dc_create("acme", "family", {"family_name": "OnlyName"})
    fid, outcome = match_or_create_family("acme", {"family_name": "OnlyName"})
    # name-only has no dedupe key -> always a new family (familyPlan solo rule)
    assert len(fake_dc.find("family")) == 2
    assert fid and outcome == "created"


def test_family_name_fallback_when_missing(fake_dc):
    match_or_create_family("acme", {"primary_email": "solo@x.com"})
    rows = fake_dc.find("family", primary_email="solo@x.com")
    assert rows[0]["family_name"] == "solo@x.com"


def test_multiple_candidates_sharing_a_signature_returns_the_first(fake_dc):
    """Test-gap closure. Nothing enforces uniqueness on family signatures, so
    two families CAN share one. match_family returns the first match in
    candidate order — insertion order in practice, i.e. the oldest family.

    This ordering matters directly for I5: it decides which existing family an
    approval attaches a student to when duplicates exist. It is pinned here so
    a change to it is a deliberate, visible decision rather than a silent
    behavior shift. See match_family's docstring for the caveat that DataCore
    carries no ORDER BY.
    """
    first = fake_dc.dc_create("acme", "family",
                              {"family_name": "Lee A", "primary_email": "dup@x.com"})
    second = fake_dc.dc_create("acme", "family",
                               {"family_name": "Lee B", "primary_email": "DUP@x.com"})
    assert first["entity_id"] != second["entity_id"]

    sig = normalize_signature({"primary_email": "dup@x.com"})
    candidates = [dict(r) for r in fake_dc.rows if r["entity_type"] == "family"]
    assert match_family(sig, candidates) == first["entity_id"]

    fid, outcome = match_or_create_family("acme", {"primary_email": " Dup@X.com "})
    assert fid == first["entity_id"] and outcome == "matched"
    assert len(fake_dc.find("family")) == 2  # no third family minted
