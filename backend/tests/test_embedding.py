"""
Tests for the ONNX-based MultiModalEncoder.
"""

import pytest
import numpy as np
from unittest.mock import patch, MagicMock

from app.config import settings
from app.models.multimodal import MultiModalEncoder


class TestMultiModalEncoder:
    """Tests for the ONNX-based MultiModalEncoder."""

    def test_encode_text_empty(self):
        """Empty input should return empty array with correct shape."""
        encoder = MultiModalEncoder()
        result = encoder.encode_text([])
        assert result.shape == (0, settings.embedding_dim)

    def test_encode_image_empty(self):
        """Empty input should return empty array with correct shape."""
        encoder = MultiModalEncoder()
        result = encoder.encode_image([])
        assert result.shape == (0, settings.embedding_dim)

    def test_encode_text_returns_normalized(self):
        """Text embeddings should be L2-normalized via the local ONNX model."""
        encoder = MultiModalEncoder()
        result = encoder.encode_text(["test text"])

        assert result.shape[0] == 1
        assert result.shape[1] == 384  # all-MiniLM-L6-v2 output dimension
        norm = np.linalg.norm(result[0])
        assert abs(norm - 1.0) < 1e-5, "Embeddings should be L2-normalized"

    def test_encode_text_handles_multiple(self):
        """Should embed multiple texts and return correct batch shape."""
        encoder = MultiModalEncoder()
        texts = ["first document", "second document", "third document"]
        result = encoder.encode_text(texts)

        assert result.ndim == 2
        assert result.shape[0] == len(texts)
        assert result.shape[1] == 384  # all-MiniLM-L6-v2 output dimension
        # All rows should be L2-normalized
        for i in range(len(texts)):
            norm = np.linalg.norm(result[i])
            assert abs(norm - 1.0) < 1e-5
