"""Tests for the Embedder module."""

from unittest.mock import MagicMock, patch


class TestFlattenFields:
    def _make_embedder(self):
        with patch("voyageai.Client"):
            from datacore.embedder import Embedder
            return Embedder()

    def test_flatten_fields_combines_all_keys(self):
        embedder = self._make_embedder()
        result = embedder._flatten_fields({"name": "Alice", "role": "admin"})
        assert "name: Alice" in result
        assert "role: admin" in result

    def test_flatten_fields_empty_dict(self):
        embedder = self._make_embedder()
        result = embedder._flatten_fields({})
        assert result == ""

    def test_flatten_fields_skips_none_values(self):
        embedder = self._make_embedder()
        result = embedder._flatten_fields({"name": "Bob", "email": None})
        assert "name: Bob" in result
        assert "email" not in result


class TestEmbedder:
    def _make_embedder_with_mock(self):
        """Return (embedder, mock_client) with voyageai.Client mocked."""
        with patch("voyageai.Client") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            from datacore.embedder import Embedder
            embedder = Embedder()
            embedder._client = mock_client
            return embedder, mock_client

    def _fake_embed_result(self, vectors):
        result = MagicMock()
        result.embeddings = vectors
        return result

    def test_embed_calls_voyage_api(self):
        embedder, mock_client = self._make_embedder_with_mock()
        mock_client.embed.return_value = self._fake_embed_result([[0.1] * 1024])

        embedder.embed({"title": "Engineer"})

        mock_client.embed.assert_called_once()
        call_kwargs = mock_client.embed.call_args
        assert call_kwargs.kwargs.get("model") == "voyage-3" or call_kwargs.args[1] == "voyage-3" or "voyage-3" in str(call_kwargs)
        # Verify model and input_type positionally or as kwargs
        _, kwargs = call_kwargs
        assert kwargs.get("model") == "voyage-3"
        assert kwargs.get("input_type") == "document"

    def test_embed_batch(self):
        embedder, mock_client = self._make_embedder_with_mock()
        vectors = [[float(i)] * 1024 for i in range(3)]
        mock_client.embed.return_value = self._fake_embed_result(vectors)

        result = embedder.embed_batch([
            {"name": "A"},
            {"name": "B"},
            {"name": "C"},
        ])

        assert isinstance(result, list)
        assert len(result) == 3
        assert result[0] == vectors[0]

    def test_embed_query_uses_query_input_type(self):
        embedder, mock_client = self._make_embedder_with_mock()
        mock_client.embed.return_value = self._fake_embed_result([[0.5] * 1024])

        embedder.embed_query("find senior engineers")

        mock_client.embed.assert_called_once()
        _, kwargs = mock_client.embed.call_args
        assert kwargs.get("input_type") == "query"
        assert kwargs.get("model") == "voyage-3"

    def test_embedder_raises_without_api_key(self):
        import pytest
        with patch("voyageai.Client", side_effect=Exception("No API key")):
            from datacore import embedder as embedder_module
            import importlib
            # Reload to get fresh class
            importlib.reload(embedder_module)
            with pytest.raises(Exception):
                embedder_module.Embedder()
