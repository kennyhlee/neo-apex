"""Server-side family match-or-create (port of admindash familyMatch/familyPlan)."""
import pytest

from app.registration.family import (
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
    fid = match_or_create_family("acme", {"primary_email": " p@x.com ",
                                          "family_name": "Lee Family"})
    assert fid == fam["entity_id"]
    assert len(fake_dc.find("family")) == 1  # no duplicate created


def test_matches_by_phone_digits(fake_dc):
    fam = fake_dc.dc_create("acme", "family",
                            {"family_name": "Ng", "primary_phone": "5551234567"})
    fid = match_or_create_family("acme", {"primary_phone": "(555) 123-4567"})
    assert fid == fam["entity_id"]


def test_creates_family_when_no_match(fake_dc):
    fid = match_or_create_family("acme", {
        "primary_email": "new@x.com", "family_name": "New Family",
        "primary_phone": "5550000000", "primary_address": "2 Oak Ave"})
    rows = fake_dc.find("family", primary_email="new@x.com")
    assert rows and rows[0]["entity_id"] == fid
    assert rows[0]["family_name"] == "New Family"


def test_no_signature_creates_solo_family(fake_dc):
    fake_dc.dc_create("acme", "family", {"family_name": "OnlyName"})
    fid = match_or_create_family("acme", {"family_name": "OnlyName"})
    # name-only has no dedupe key -> always a new family (familyPlan solo rule)
    assert len(fake_dc.find("family")) == 2
    assert fid


def test_family_name_fallback_when_missing(fake_dc):
    match_or_create_family("acme", {"primary_email": "solo@x.com"})
    rows = fake_dc.find("family", primary_email="solo@x.com")
    assert rows[0]["family_name"] == "solo@x.com"
