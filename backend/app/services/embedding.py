"""
Embedding service.

Manages the MultiModalEncoder lifecycle and ChromaDB vector store.
Handles embedding generation for both text chunks and images,
and stores them in the vector database for retrieval.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional, Dict, Any

import chromadb
from pathlib import Path

from app.config import settings
from app.models.multimodal import MultiModalEncoder
from app.models.schemas import TextChunk, ImageChunk, DocumentStatus
from app.services.ingestion import update_document_status
from app.utils.logging import get_logger

logger = get_logger("embedding")

# ── Singleton state ──
_encoder: Optional[MultiModalEncoder] = None
_chroma_client: Optional[chromadb.ClientAPI] = None
_collection: Optional[chromadb.Collection] = None


def get_encoder() -> MultiModalEncoder:
    """Lazy-load the MultiModalEncoder."""
    global _encoder
    if _encoder is None:
        logger.info(
            "loading_encoder",
            model="onnx:all-MiniLM-L6-v2",
            dim=settings.embedding_dim,
        )
        _encoder = MultiModalEncoder()
        logger.info("encoder_loaded")
    return _encoder


def get_collection() -> chromadb.Collection:
    """Lazy-connect to ChromaDB and get/create the collection."""
    global _chroma_client, _collection
    if _collection is None:
        try:
            _chroma_client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
            )
            logger.info(
                "chromadb_connecting",
                host=settings.chroma_host,
                port=settings.chroma_port,
            )
        except Exception:
            # Fallback 1: local persistent client for dev/Docker.
            # Fallback 2: in-memory ephemeral client for read-only runtimes (Vercel).
            import os as _os
            _chroma_path = "/tmp/documind/chromadb" if _os.environ.get("VERCEL") else "./data/chromadb"
            try:
                logger.warning("chromadb_http_failed, falling back to persistent client")
                _chroma_client = chromadb.PersistentClient(path=_chroma_path)
            except Exception:
                logger.warning("chromadb_persistent_failed, falling back to ephemeral client")
                _chroma_client = chromadb.EphemeralClient()

        _collection = _chroma_client.get_or_create_collection(
            name=settings.chroma_collection,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("chromadb_collection_ready", name=settings.chroma_collection)
    return _collection


async def embed_text_chunks(
    document_id: str,
    chunks: List[TextChunk],
    batch_size: int = 32,
) -> int:
    """
    Embed text chunks and store in ChromaDB.
    Returns the number of embeddings stored.
    """
    if not chunks:
        return 0

    encoder = get_encoder()
    collection = get_collection()
    total_stored = 0

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        texts = [c.content for c in batch]

        embeddings = await asyncio.to_thread(encoder.encode_text, texts)

        # Store in ChromaDB
        ids = [c.chunk_id for c in batch]
        metadatas = [
            {
                "document_id": c.document_id,
                "page_number": c.page_number or 0,
                "chunk_index": c.chunk_index,
                "content_type": "text",
                "content_preview": c.content[:200],
            }
            for c in batch
        ]
        documents = [c.content for c in batch]

        collection.upsert(
            ids=ids,
            embeddings=embeddings.tolist(),
            metadatas=metadatas,
            documents=documents,
        )
        total_stored += len(batch)

    logger.info(
        "text_embeddings_stored",
        document_id=document_id,
        count=total_stored,
    )
    return total_stored


async def embed_image_chunks(
    document_id: str,
    chunks: List[ImageChunk],
    batch_size: int = 8,
) -> int:
    """
    Embed image chunks and store in ChromaDB.
    Returns the number of embeddings stored.
    """
    if not chunks:
        return 0

    encoder = get_encoder()
    collection = get_collection()
    total_stored = 0

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        image_paths = []
        valid_chunks = []

        for c in batch:
            try:
                if not Path(c.image_path).exists():
                    raise FileNotFoundError(f"Image not found: {c.image_path}")
                image_paths.append(c.image_path)
                valid_chunks.append(c)
            except Exception as e:
                logger.warning(
                    "image_load_failed",
                    chunk_id=c.chunk_id,
                    path=c.image_path,
                    error=str(e),
                )

        if not image_paths:
            continue

        embeddings = await asyncio.to_thread(encoder.encode_image, image_paths)

        ids = [c.chunk_id for c in valid_chunks]
        metadatas = [
            {
                "document_id": c.document_id,
                "page_number": c.page_number,
                "image_index": c.image_index,
                "content_type": "image",
                "image_path": c.image_path,
            }
            for c in valid_chunks
        ]
        documents = [
            f"[Image from page {c.page_number}, index {c.image_index}]"
            for c in valid_chunks
        ]

        collection.upsert(
            ids=ids,
            embeddings=embeddings.tolist(),
            metadatas=metadatas,
            documents=documents,
        )
        total_stored += len(valid_chunks)

    logger.info(
        "image_embeddings_stored",
        document_id=document_id,
        count=total_stored,
    )
    return total_stored


async def embed_document(document_id: str, text_chunks: List[TextChunk], image_chunks: List[ImageChunk]) -> None:
    """Full embedding pipeline for a document. Updates status to INDEXED on completion."""
    try:
        text_count = await embed_text_chunks(document_id, text_chunks)
        image_count = await embed_image_chunks(document_id, image_chunks)
        update_document_status(document_id, DocumentStatus.INDEXED)
        logger.info(
            "document_fully_indexed",
            document_id=document_id,
            text_embeddings=text_count,
            image_embeddings=image_count,
        )
    except Exception as e:
        update_document_status(document_id, DocumentStatus.FAILED)
        logger.error("document_embedding_failed", document_id=document_id, error=str(e))
        raise


async def query_embeddings(
    query_text: str,
    top_k: int = 5,
    document_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Embed a query and retrieve the most relevant chunks from ChromaDB.

    Returns:
        dict with 'ids', 'documents', 'metadatas', 'distances'
    """
    encoder = get_encoder()
    collection = get_collection()

    query_embedding = await asyncio.to_thread(
        encoder.encode_text, [query_text]
    )

    where_filter = None
    if document_ids:
        where_filter = {"document_id": {"$in": document_ids}}

    results = await asyncio.to_thread(
        collection.query,
        query_embeddings=query_embedding.tolist(),
        n_results=top_k,
        where=where_filter,
        include=["documents", "metadatas", "distances"],
    )

    logger.info(
        "query_executed",
        query_preview=query_text[:80],
        top_k=top_k,
        results_count=len(results["ids"][0]) if results["ids"] else 0,
    )

    return results
