"""
Query / Chat API routes with SSE streaming support.
"""

from __future__ import annotations

import uuid
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.schemas import QueryRequest, QueryResponse
from app.services.generation import generate_streaming, generate_sync
from app.services.mlops import log_query
from app.utils.logging import get_logger

logger = get_logger("router.query")

router = APIRouter(prefix="/api/query", tags=["query"])


@router.post("/stream")
async def query_stream(request: QueryRequest):
    """
    Query documents with SSE streaming response.

    Event types:
    - metadata: retrieval stats
    - token: individual generated tokens
    - citation: source references
    - done: final summary with latency & confidence
    - error: error details
    """
    logger.info(
        "stream_query_received",
        question=request.question[:80],
        top_k=request.top_k,
        deep_scan=request.deep_scan,
    )

    return StreamingResponse(
        generate_streaming(
            query=request.question,
            top_k=request.top_k,
            document_ids=request.document_ids,
            deep_scan=request.deep_scan,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/", response_model=QueryResponse)
async def query_sync(request: QueryRequest):
    """
    Query documents with a synchronous (non-streaming) response.
    Returns the complete answer with citations.
    """
    logger.info(
        "sync_query_received",
        question=request.question[:80],
        top_k=request.top_k,
    )

    response = await generate_sync(
        query=request.question,
        top_k=request.top_k,
        document_ids=request.document_ids,
    )

    # Log to MLOps
    log_query(
        query_id=response.query_id,
        query_text=request.question,
        latency_ms=response.latency_ms,
        retrieval_latency_ms=response.latency_ms * 0.3,  # estimated
        confidence=response.confidence,
        status=response.status.value,
        top_k=request.top_k,
        results_count=len(response.citations),
        citation_count=len(response.citations),
        model_used=response.model_used,
    )

    return response
