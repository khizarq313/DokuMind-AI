"""
Tests for the document ingestion service.
"""

import pytest
from unittest.mock import patch
from app.services.ingestion import (
    get_all_documents,
    get_document,
    get_text_chunks,
)


class TestIngestionService:
    """Tests for ingestion helper functions."""

    def test_get_nonexistent_document(self):
        """Getting a non-existent document should return None."""
        result = get_document("nonexistent-id-12345")
        assert result is None

    def test_get_text_chunks_empty(self):
        """Getting chunks for unknown doc should return empty list."""
        result = get_text_chunks("nonexistent-id-12345")
        assert result == []

    def test_all_documents_is_list(self):
        """All documents should return a list."""
        result = get_all_documents()
        assert isinstance(result, list)
