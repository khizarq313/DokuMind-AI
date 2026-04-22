"""
LLM generation service with SSE streaming.

Passes retrieved context to the LLM and streams the response back
as Server-Sent Events. Supports grounded, cited answers.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import AsyncGenerator, List, Optional

from groq import Groq

from app.config import settings
from app.models.schemas import Citation, QueryResponse, QueryStatus, StreamChunk
from app.services.mlops import log_query
from app.services.retrieval import retrieve_context
from app.utils.logging import get_logger

logger = get_logger("generation")

_client: Optional[Groq] = None
FALLBACK_MODELS = ("llama-3.1-8b-instant",)


def _get_client() -> Groq:
    """Lazy-initialize the Groq client."""
    global _client
    if _client is None:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")
        _client = Groq(api_key=settings.groq_api_key)
    return _client


SYSTEM_PROMPT = """You are DocuMind AI, an expert document intelligence assistant.
You analyze uploaded documents and provide precise, well-structured answers.

RULES:
1. Answer ONLY based on the provided context. If the context doesn't contain
   enough information, say so explicitly.
2. When referencing information, cite the source document and page number.
3. Respond in clean Markdown with proper spacing and line breaks.
4. Use this structure whenever possible:
   - `## Answer`
   - one short paragraph (2-4 sentences)
   - `## Key Points`
   - bullet list using `- ` (one point per line)
   - `## Evidence and Citations`
   - bullet list with page references where available
5. Use bold only for key entities, metrics, and conclusions.
6. Never output malformed star patterns like `Label:*`, `****`, or stray `*`.
7. Be concise but thorough.
"""


def _build_prompt(query: str, context: str) -> str:
    """Build a grounded prompt for Groq."""
    grounded_context = context if context else "[No relevant context found in the documents]"
    return f"""{SYSTEM_PROMPT}

Based on the following document context, answer the user's question.

--- RETRIEVED CONTEXT ---
{grounded_context}
--- END CONTEXT ---

USER QUESTION: {query}

Provide a detailed, well-structured answer with citations to specific pages where applicable."""


def _candidate_models() -> List[str]:
    """Return the configured model followed by safe fallbacks."""
    models: List[str] = []
    for model in (settings.groq_model, *FALLBACK_MODELS):
        if model and model not in models:
            models.append(model)
    return models


def _is_retryable_model_error(exc: Exception) -> bool:
    """Detect decommissioned or unavailable-model errors worth retrying."""
    message = str(exc).lower()
    retryable_markers = (
        "model_decommissioned",
        "decommissioned",
        "no longer supported",
        "not found",
        "does not exist",
    )
    return any(marker in message for marker in retryable_markers)


def generate_answer(prompt: str) -> tuple[str, str]:
    """Generate a complete answer using Groq and return the chosen model."""
    client = _get_client()
    candidate_models = _candidate_models()
    last_error: Optional[Exception] = None

    for index, model_name in enumerate(candidate_models):
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "user", "content": prompt},
                ],
            )
            return response.choices[0].message.content or "", model_name
        except Exception as exc:
            last_error = exc
            has_fallback = index < len(candidate_models) - 1
            if has_fallback and _is_retryable_model_error(exc):
                logger.warning(
                    "generation_model_fallback",
                    failed_model=model_name,
                    fallback_model=candidate_models[index + 1],
                    error=str(exc),
                )
                continue
            raise

    if last_error is not None:
        raise last_error

    raise RuntimeError("No Groq model candidates were configured")


def _tokenize_for_streaming(text: str) -> List[str]:
    """Split a complete answer into token-like chunks for simulated streaming."""
    tokens = re.findall(r"\S+\s*|\n", text)
    return tokens or [text]


async def generate_streaming(
    query: str,
    top_k: int = 5,
    document_ids: Optional[List[str]] = None,
    deep_scan: bool = True,
) -> AsyncGenerator[str, None]:
    """
    Full RAG pipeline with SSE streaming.

    Streaming is simulated by chunking the Groq response into token-like units.
    """
    start_time = time.perf_counter()

    retrieval = await retrieve_context(
        query=query,
        top_k=top_k if deep_scan else 3,
        document_ids=document_ids,
    )

    retrieval_ms = retrieval["latency_ms"]
    citations: List[Citation] = retrieval["citations"]
    context_text = retrieval["context_text"]

    yield _sse(
        StreamChunk(
            event="metadata",
            data=json.dumps(
                {
                    "retrieval_ms": round(retrieval_ms, 2),
                    "chunks_found": len(citations),
                }
            ),
        )
    )
    yield _sse_flush()

    prompt = _build_prompt(query, context_text)

    try:
        full_answer, model_used = await asyncio.to_thread(generate_answer, prompt)
        for token in _tokenize_for_streaming(full_answer):
            yield _sse(StreamChunk(event="token", data=json.dumps(token)))
            yield _sse_flush()
            await asyncio.sleep(0.01)
    except Exception as exc:
        logger.error("generation_failed", error=str(exc))
        yield _sse(
            StreamChunk(
                event="error",
                data=json.dumps({"message": f"Generation failed: {str(exc)}"}),
            )
        )
        yield _sse_flush()
        return

    for citation in citations:
        yield _sse(StreamChunk(event="citation", data=citation.model_dump_json()))
        yield _sse_flush()

    total_ms = (time.perf_counter() - start_time) * 1000
    confidence = _compute_confidence(retrieval["scores"])

    yield _sse(
        StreamChunk(
            event="done",
            data=json.dumps(
                {
                    "latency_ms": round(total_ms, 2),
                    "confidence": round(confidence, 4),
                    "model": model_used,
                    "citations_count": len(citations),
                }
            ),
        )
    )
    yield _sse_flush()

    log_query(
        query_id=_build_query_id(query, total_ms),
        query_text=query,
        latency_ms=round(total_ms, 2),
        retrieval_latency_ms=round(retrieval_ms, 2),
        confidence=round(confidence, 4),
        status=QueryStatus.SUCCESS.value,
        top_k=top_k if deep_scan else 3,
        results_count=len(citations),
        citation_count=len(citations),
        model_used=model_used,
    )

    logger.info(
        "generation_complete",
        query_preview=query[:60],
        latency_ms=round(total_ms, 2),
        confidence=round(confidence, 4),
        answer_length=len(full_answer),
    )


async def generate_sync(
    query: str,
    top_k: int = 5,
    document_ids: Optional[List[str]] = None,
) -> QueryResponse:
    """
    Non-streaming RAG pipeline. Returns a complete response.
    Used for testing and non-streaming clients.
    """
    start_time = time.perf_counter()

    retrieval = await retrieve_context(query=query, top_k=top_k, document_ids=document_ids)
    citations = retrieval["citations"]
    context_text = retrieval["context_text"]
    prompt = _build_prompt(query, context_text)

    try:
        answer, model_used = await asyncio.to_thread(generate_answer, prompt)
        status = QueryStatus.SUCCESS if answer else QueryStatus.ERROR
    except Exception as exc:
        logger.error("sync_generation_failed", error=str(exc))
        answer = f"Error generating response: {str(exc)}"
        model_used = settings.groq_model
        status = QueryStatus.ERROR

    total_ms = (time.perf_counter() - start_time) * 1000
    confidence = _compute_confidence(retrieval["scores"])

    return QueryResponse(
        answer=answer,
        citations=citations,
        model_used=model_used,
        latency_ms=round(total_ms, 2),
        confidence=round(confidence, 4),
        status=status,
    )


def _compute_confidence(scores: List[float]) -> float:
    """Compute an aggregate confidence score from retrieval relevance scores."""
    if not scores:
        return 0.0

    weights = [1.0 / (index + 1) for index in range(len(scores))]
    weighted_sum = sum(score * weight for score, weight in zip(scores, weights))
    return weighted_sum / sum(weights)


def _sse(chunk: StreamChunk) -> str:
    """Format a StreamChunk as an SSE event string."""
    return f"event: {chunk.event}\ndata: {chunk.data}\n\n"


def _sse_flush() -> str:
    """Emit an SSE comment frame to encourage downstream flushing."""
    return ": keep-alive\n\n"


def _build_query_id(query: str, total_ms: float) -> str:
    """Create a lightweight deterministic-ish identifier for streamed queries."""
    safe_preview = re.sub(r"[^a-zA-Z0-9]+", "-", query[:24]).strip("-").lower() or "query"
    return f"{safe_preview}-{int(total_ms)}-{int(time.time() * 1000)}"
