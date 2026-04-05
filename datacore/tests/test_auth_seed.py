"""Tests for auth seed data."""
import tempfile
from unittest.mock import MagicMock

from datacore import Store
from datacore.auth.seed import seed_test_user
from datacore.auth.passwords import verify_password


def test_seed_creates_user():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        seed_test_user(store)

        result = store.get_global("registry", "user:u-001")
        assert result is not None
        assert result["data"]["email"] == "jane@acme.edu"
        assert result["data"]["role"] == "admin"
        assert verify_password("admin123", result["data"]["password_hash"])


def test_seed_is_idempotent():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        seed_test_user(store)
        seed_test_user(store)  # Should not raise

        result = store.get_global("registry", "user:u-001")
        assert result is not None
