"""
Retrieval service.

Orchestrates the vector search pipeline:
1. Embed the user query
2. Retrieve top-k chunks from ChromaDB
3. Format context + citations for the generation stage
"""

from __future__ import annotations

import time
from typing import List, Optional, Dict, Any

from app.models.schemas import Citation
from app.services.embedding import query_embeddings
from app.services.ingestion import get_document
from app.utils.logging import get_logger

logger = get_logger("retrieval")


async def retrieve_context(
    query: str,
    top_k: int = 5,
    document_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Retrieve relevant context for a query.

    Returns:
        {
            "context_text": str,         # Concatenated relevant text
            "citations": List[Citation], # Source references
            "latency_ms": float,
            "scores": List[float],
        }
    """
    start = time.perf_counter()

    results = await query_embeddings(
        query_text=query,
        top_k=top_k,
        document_ids=document_ids,
    )

    latency_ms = (time.perf_counter() - start) * 1000

    # Build context and citations
    context_parts: List[str] = []
    citations: List[Citation] = []
    scores: List[float] = []

    if results["ids"] and results["ids"][0]:
        for i, (chunk_id, doc_text, metadata, distance) in enumerate(
            zip(
                results["ids"][0],
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            )
        ):
            # Cosine distance → similarity score
            relevance = max(0.0, 1.0 - distance)
            scores.append(relevance)

            doc_id = metadata.get("document_id", "")
            page_num = metadata.get("page_number")
            content_type = metadata.get("content_type", "text")

            # Look up document name
            doc_meta = get_document(doc_id)
            doc_name = doc_meta.filename if doc_meta else "Unknown"

            # Build context snippet
            if content_type == "text":
                context_parts.append(
                    f"[Source: {doc_name}, Page {page_num}]\n{doc_text}"
                )
                snippet = doc_text[:200]
            else:
                context_parts.append(
                    f"[Image Source: {doc_name}, Page {page_num}]\n{doc_text}"
                )
                snippet = f"Image from page {page_num}"

            citations.append(
                Citation(
                    document_id=doc_id,
                    document_name=doc_name,
                    page_number=page_num if page_num else None,
                    chunk_id=chunk_id,
                    relevance_score=round(relevance, 4),
                    snippet=snippet,
                )
            )

    context_text = "\n\n---\n\n".join(context_parts) if context_parts else ""

    logger.info(
        "retrieval_complete",
        query_preview=query[:60],
        results=len(citations),
        latency_ms=round(latency_ms, 2),
        avg_score=round(sum(scores) / max(len(scores), 1), 4),
    )

    return {
        "context_text": context_text,
        "citations": citations,
        "latency_ms": latency_ms,
        "scores": scores,
    }
