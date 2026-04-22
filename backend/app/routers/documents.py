"""
Document management API routes.
"""

from __future__ import annotations

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks

from app.config import settings
from app.models.schemas import (
    DocumentUploadResponse,
    DocumentMetadata,
    DocumentListResponse,
    DocumentSummaryRequest,
    DocumentSummaryResponse,
    DocumentStatus,
)
from app.services import ingestion
from app.services.embedding import embed_document, get_collection
from app.services.summarization import invalidate_document_summary_cache, summarize_document
from app.utils.logging import get_logger

logger = get_logger("router.documents")

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_MIMES = {"application/pdf"}


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Upload a PDF document for ingestion and indexing."""
    # Validate file type
    mime = file.content_type or ""
    if mime not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {mime}. Allowed: {', '.join(ALLOWED_MIMES)}",
        )

    # Validate file size
    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum: {settings.max_upload_size_mb}MB",
        )

    # Ingest document (extract text/images + chunk)
    doc_meta = await ingestion.ingest_document(
        file_content=content,
        filename=file.filename or "unnamed",
        mime_type=mime,
    )

    # Embed in background (non-blocking)
    text_chunks = ingestion.get_text_chunks(doc_meta.id)
    image_chunks = ingestion.get_image_chunks(doc_meta.id)

    background_tasks.add_task(
        embed_document,
        doc_meta.id,
        text_chunks,
        image_chunks,
    )

    logger.info("upload_accepted", document_id=doc_meta.id, filename=file.filename)

    return DocumentUploadResponse(
        id=doc_meta.id,
        filename=doc_meta.filename,
        size_bytes=doc_meta.size_bytes,
        status=doc_meta.status,
        message="Document uploaded and processing started",
    )


@router.get("/", response_model=DocumentListResponse)
async def list_documents():
    """List all uploaded documents with their processing status."""
    docs = ingestion.get_all_documents()
    return DocumentListResponse(documents=docs, total=len(docs))


@router.get("/{document_id}/status")
async def get_document_status(document_id: str) -> dict[str, str]:
    """Return a lightweight status payload for fast polling."""
    doc = ingestion.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return {"id": doc.id, "status": doc.status.value}


@router.get("/{document_id}", response_model=DocumentMetadata)
async def get_document(document_id: str):
    """Get metadata for a specific document."""
    doc = ingestion.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.post("/{document_id}/summary", response_model=DocumentSummaryResponse)
async def get_document_summary(
    document_id: str,
    request: DocumentSummaryRequest,
):
    """Generate a structured summary for an indexed document."""
    doc = ingestion.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status != DocumentStatus.INDEXED:
        raise HTTPException(
            status_code=409,
            detail="Document must finish indexing before a summary can be generated.",
        )

    try:
        return await summarize_document(
            document_id=document_id,
            mode=request.mode,
            force_refresh=request.force_refresh,
        )
    except FileNotFoundError as exc:
        logger.error("document_summary_file_missing", document_id=document_id, error=str(exc))
        raise HTTPException(status_code=404, detail="Document file is no longer available") from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("document_summary_failed", document_id=document_id, error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to generate document summary") from exc


@router.delete("/{document_id}")
async def delete_document(document_id: str) -> dict[str, str]:
    """Delete a document and its embeddings."""
    doc = ingestion.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        collection = get_collection()
        collection.delete(where={"document_id": document_id})
        deleted = ingestion.delete_document(document_id)
        if not deleted:
            raise RuntimeError("Document cleanup failed")
        invalidate_document_summary_cache(document_id)
    except Exception as exc:
        logger.error("document_delete_failed", document_id=document_id, error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to delete document") from exc

    logger.info("document_deleted", document_id=document_id, filename=doc.filename)
    return {"message": "deleted", "id": document_id}
