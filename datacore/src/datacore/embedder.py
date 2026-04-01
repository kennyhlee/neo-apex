"""Voyage AI embedding generation for entity data."""

import voyageai

MODEL = "voyage-3"
DIMENSIONS = 1024


class Embedder:
    """Generates vector embeddings from entity field data using Voyage AI.

    Reads VOYAGE_API_KEY from environment automatically.
    """

    def __init__(self):
        self._client = voyageai.Client()

    def _flatten_fields(self, fields: dict) -> str:
        """Flatten a dict of fields into a single text string for embedding."""
        parts = []
        for key, value in fields.items():
            if value is not None:
                parts.append(f"{key}: {value}")
        return ", ".join(parts)

    def embed(self, fields: dict) -> list[float]:
        """Embed a single entity's fields. Returns 1024-dim vector."""
        text = self._flatten_fields(fields)
        result = self._client.embed(
            [text], model=MODEL, input_type="document"
        )
        return result.embeddings[0]

    def embed_batch(self, fields_list: list[dict]) -> list[list[float]]:
        """Embed multiple entities' fields in one API call."""
        texts = [self._flatten_fields(f) for f in fields_list]
        result = self._client.embed(
            texts, model=MODEL, input_type="document"
        )
        return result.embeddings

    def embed_query(self, query: str) -> list[float]:
        """Embed a search query string. Uses input_type="query"."""
        result = self._client.embed(
            [query], model=MODEL, input_type="query"
        )
        return result.embeddings[0]
