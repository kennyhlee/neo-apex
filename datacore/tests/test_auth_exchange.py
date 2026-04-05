"""Tests for exchange code creation and redemption."""
import time

from datacore.auth.exchange import ExchangeStore


def test_create_and_redeem():
    store = ExchangeStore(ttl_seconds=30)
    code = store.create("token-abc")
    assert isinstance(code, str)
    assert len(code) > 0
    token = store.redeem(code)
    assert token == "token-abc"


def test_redeem_is_single_use():
    store = ExchangeStore(ttl_seconds=30)
    code = store.create("token-abc")
    store.redeem(code)
    assert store.redeem(code) is None


def test_invalid_code_returns_none():
    store = ExchangeStore(ttl_seconds=30)
    assert store.redeem("nonexistent") is None


def test_expired_code_returns_none():
    store = ExchangeStore(ttl_seconds=0)
    code = store.create("token-abc")
    time.sleep(0.01)
    assert store.redeem(code) is None


def test_cleanup_removes_expired():
    store = ExchangeStore(ttl_seconds=0)
    store.create("token-a")
    store.create("token-b")
    time.sleep(0.01)
    store.cleanup()
    assert len(store._codes) == 0
