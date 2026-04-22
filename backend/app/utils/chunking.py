"""
Text chunking with overlap for long documents.

Implements a sliding-window chunker that splits text into overlapping segments
optimized for embedding quality. Chunks respect sentence boundaries when possible
to avoid mid-sentence splits that degrade retrieval relevance.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from app.config import settings


@dataclass
class Chunk:
    """A text chunk with positional metadata."""
    content: str
    chunk_index: int
    start_char: int
    end_char: int
    page_number: Optional[int] = None


# Sentence boundary regex — handles abbreviations reasonably well
_SENTENCE_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z])')


def _find_sentence_boundary(text: str, target: int, window: int = 100) -> int:
    """
    Find the nearest sentence boundary to `target` within ±window chars.
    Returns `target` if no boundary is found.
    """
    search_start = max(0, target - window)
    search_end = min(len(text), target + window)
    search_text = text[search_start:search_end]

    boundaries = []
    for match in _SENTENCE_RE.finditer(search_text):
        absolute_pos = search_start + match.start()
        boundaries.append(absolute_pos)

    if not boundaries:
        return target

    # Return the boundary closest to target
    return min(boundaries, key=lambda b: abs(b - target))


def chunk_text(
    text: str,
    chunk_size: Optional[int] = None,
    chunk_overlap: Optional[int] = None,
    respect_sentences: bool = True,
    page_number: Optional[int] = None,
) -> List[Chunk]:
    """
    Split text into overlapping chunks.

    Args:
        text: The full text to chunk.
        chunk_size: Target characters per chunk (default from settings).
        chunk_overlap: Overlap characters between chunks (default from settings).
        respect_sentences: If True, try to break at sentence boundaries.
        page_number: Optional page number to attach to all chunks.

    Returns:
        List of Chunk objects with positional metadata.
    """
    chunk_size = chunk_size or settings.chunk_size
    chunk_overlap = chunk_overlap or settings.chunk_overlap

    if not text or not text.strip():
        return []

    text = text.strip()

    if len(text) <= chunk_size:
        return [
            Chunk(
                content=text,
                chunk_index=0,
                start_char=0,
                end_char=len(text),
                page_number=page_number,
            )
        ]

    chunks: List[Chunk] = []
    start = 0
    chunk_idx = 0

    while start < len(text):
        # Calculate raw end position
        end = start + chunk_size

        if end >= len(text):
            # Last chunk — take everything remaining
            end = len(text)
        elif respect_sentences:
            # Try to break at a sentence boundary
            end = _find_sentence_boundary(text, end)

        chunk_content = text[start:end].strip()

        if chunk_content:
            chunks.append(
                Chunk(
                    content=chunk_content,
                    chunk_index=chunk_idx,
                    start_char=start,
                    end_char=end,
                    page_number=page_number,
                )
            )
            chunk_idx += 1

        if end >= len(text):
            break

        # Advance with overlap
        start = end - chunk_overlap

    return chunks


def chunk_document_pages(
    pages: List[str],
    chunk_size: Optional[int] = None,
    chunk_overlap: Optional[int] = None,
) -> List[Chunk]:
    """
    Chunk a multi-page document. Each page is chunked independently,
    preserving page-number metadata.

    Args:
        pages: List of page texts (index = page number - 1).
        chunk_size: Target characters per chunk.
        chunk_overlap: Overlap characters between chunks.

    Returns:
        List of all chunks across all pages, sequentially indexed.
    """
    all_chunks: List[Chunk] = []
    global_index = 0

    for page_idx, page_text in enumerate(pages):
        page_chunks = chunk_text(
            text=page_text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            page_number=page_idx + 1,  # 1-indexed
        )
        for chunk in page_chunks:
            chunk.chunk_index = global_index
            global_index += 1
        all_chunks.extend(page_chunks)

    return all_chunks
