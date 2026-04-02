"""Tests for tenant abbreviation derivation."""

from datacore.store import derive_abbrev


def test_one_word_name():
    assert derive_abbrev("Summit", "t1") == "SUM"


def test_one_word_short_name():
    assert derive_abbrev("Go", "t1") == "GO"


def test_two_word_name():
    assert derive_abbrev("Green Valley", "t1") == "GVA"


def test_three_word_name():
    assert derive_abbrev("Acme Child Center", "t1") == "ACC"


def test_four_word_name():
    assert derive_abbrev("New York Day School", "t1") == "NYD"


def test_no_name_long_tenant_id():
    assert derive_abbrev(None, "acme") == "ACM"


def test_no_name_short_tenant_id():
    assert derive_abbrev(None, "t1") == "T1"


def test_empty_string_name():
    assert derive_abbrev("", "myorg") == "MYO"


def test_case_insensitive():
    assert derive_abbrev("green valley", "t1") == "GVA"
