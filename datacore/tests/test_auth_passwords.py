"""Tests for auth password hashing and verification."""
from datacore.auth.passwords import hash_password, verify_password


def test_hash_and_verify():
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed)


def test_wrong_password():
    hashed = hash_password("secret123")
    assert not verify_password("wrong", hashed)


def test_different_hashes_for_same_password():
    h1 = hash_password("secret123")
    h2 = hash_password("secret123")
    assert h1 != h2  # bcrypt uses random salt
