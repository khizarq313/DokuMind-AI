"""
Tests for the text chunking utility.
"""

import pytest
from app.utils.chunking import chunk_text, chunk_document_pages, Chunk


class TestChunkText:
    """Tests for the chunk_text function."""

    def test_empty_text_returns_empty(self):
        """Empty or whitespace-only text should return no chunks."""
        assert chunk_text("") == []
        assert chunk_text("   ") == []

    def test_short_text_single_chunk(self):
        """Text shorter than chunk_size should yield exactly one chunk."""
        text = "Hello world, this is a short text."
        chunks = chunk_text(text, chunk_size=500, chunk_overlap=50)
        assert len(chunks) == 1
        assert chunks[0].content == text
        assert chunks[0].chunk_index == 0
        assert chunks[0].start_char == 0
        assert chunks[0].end_char == len(text)

    def test_long_text_multiple_chunks(self):
        """Text longer than chunk_size should produce multiple chunks."""
        text = "A" * 1000
        chunks = chunk_text(text, chunk_size=300, chunk_overlap=50, respect_sentences=False)
        assert len(chunks) > 1
        # All chunks should have content
        for chunk in chunks:
            assert len(chunk.content) > 0

    def test_overlap_exists(self):
        """Adjacent chunks should share overlapping content."""
        text = "Word " * 200  # ~1000 characters
        chunks = chunk_text(text, chunk_size=200, chunk_overlap=50, respect_sentences=False)
        assert len(chunks) > 2
        # Check that consecutive chunks overlap
        for i in range(len(chunks) - 1):
            end_of_current = chunks[i].content[-50:]
            start_of_next = chunks[i + 1].content[:50]
            # There should be some shared substring
            assert any(
                end_of_current[j:j+10] in start_of_next
                for j in range(0, min(40, len(end_of_current)))
                if j + 10 <= len(end_of_current)
            )

    def test_sequential_indices(self):
        """Chunk indices should be sequential starting from 0."""
        text = "Sentence one. Sentence two. Sentence three. " * 20
        chunks = chunk_text(text, chunk_size=100, chunk_overlap=20)
        for i, chunk in enumerate(chunks):
            assert chunk.chunk_index == i

    def test_page_number_preserved(self):
        """Page number should be preserved on all chunks."""
        text = "Test content " * 50
        chunks = chunk_text(text, chunk_size=100, chunk_overlap=20, page_number=5)
        for chunk in chunks:
            assert chunk.page_number == 5

    def test_no_empty_chunks(self):
        """No chunk should be empty or whitespace-only."""
        text = "Hello.  \n\n  World. This is a test. " * 50
        chunks = chunk_text(text, chunk_size=100, chunk_overlap=20)
        for chunk in chunks:
            assert chunk.content.strip() != ""


class TestChunkDocumentPages:
    """Tests for the chunk_document_pages function."""

    def test_multi_page_document(self):
        """Each page should be chunked independently with correct page numbers."""
        pages = [
            "Page one content. " * 20,
            "Page two content. " * 20,
            "Page three content. " * 20,
        ]
        chunks = chunk_document_pages(pages, chunk_size=100, chunk_overlap=20)
        assert len(chunks) > 3

        # Check page numbers
        page_numbers = set(c.page_number for c in chunks)
        assert 1 in page_numbers
        assert 2 in page_numbers
        assert 3 in page_numbers

    def test_global_indices_are_sequential(self):
        """Chunk indices should be globally sequential across pages."""
        pages = ["Content " * 50, "More content " * 50]
        chunks = chunk_document_pages(pages, chunk_size=100, chunk_overlap=20)
        for i, chunk in enumerate(chunks):
            assert chunk.chunk_index == i

    def test_empty_pages_handled(self):
        """Empty pages should not produce chunks."""
        pages = ["Content here. " * 20, "", "More content. " * 20]
        chunks = chunk_document_pages(pages, chunk_size=100, chunk_overlap=20)
        page_numbers = set(c.page_number for c in chunks)
        assert 2 not in page_numbers
