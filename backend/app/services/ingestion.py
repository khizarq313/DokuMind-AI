"""
Document ingestion service.

Handles PDF uploads, extracts text and images,
chunks content, and queues it for embedding.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz  # PyMuPDF

from app.models.schemas import (
    DocumentMetadata,
    DocumentStatus,
    ImageChunk,
    TextChunk,
)
from app.utils.chunking import chunk_document_pages
from app.utils.logging import get_logger

logger = get_logger("ingestion")

# In-memory working state, backed by a lightweight JSON store on disk.
_documents: Dict[str, DocumentMetadata] = {}
_text_chunks: Dict[str, List[TextChunk]] = {}
_image_chunks: Dict[str, List[ImageChunk]] = {}

# On Vercel (and other read-only serverless runtimes) the working directory is
# not writable — only /tmp is.  Detect via the VERCEL env var that Vercel sets
# automatically, and redirect all data I/O to /tmp.
import os as _os
_DATA_BASE = Path("/tmp/documind") if _os.environ.get("VERCEL") else Path("./data")

UPLOAD_DIR = _DATA_BASE / "uploads"
IMAGES_DIR = _DATA_BASE / "images"
DOCUMENTS_STORE = _DATA_BASE / "documents.json"

try:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass  # Read-only filesystem; directories must already exist


def _save_documents_to_disk() -> None:
    """Persist document metadata for refreshes and backend restarts."""
    payload = [
        document.model_dump(mode="json")
        for document in sorted(_documents.values(), key=lambda item: item.created_at)
    ]
    DOCUMENTS_STORE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _load_documents_from_disk() -> None:
    """Restore persisted document metadata into the in-memory store."""
    if not DOCUMENTS_STORE.exists():
        return

    try:
        stored_documents = json.loads(DOCUMENTS_STORE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("documents_store_load_failed", error=str(exc))
        return

    if not isinstance(stored_documents, list):
        logger.warning("documents_store_invalid_payload")
        return

    restored_documents: Dict[str, DocumentMetadata] = {}
    for raw_document in stored_documents:
        try:
            document = DocumentMetadata.model_validate(raw_document)
            restored_documents[document.id] = document
        except Exception as exc:
            logger.warning("documents_store_record_invalid", error=str(exc))

    _documents.update(restored_documents)


_load_documents_from_disk()


async def ingest_document(
    file_content: bytes,
    filename: str,
    mime_type: str,
) -> DocumentMetadata:
    """
    Full ingestion pipeline:
    1. Save file to disk
    2. Extract text per page
    3. Extract images
    4. Chunk text with overlap
    5. Return metadata

    Runs CPU-bound extraction in a thread pool to avoid blocking the event loop.
    """
    doc_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{doc_id}_{filename}"

    logger.info(
        "ingestion_started",
        document_id=doc_id,
        filename=filename,
        size_bytes=len(file_content),
    )

    file_path.write_bytes(file_content)

    doc = DocumentMetadata(
        id=doc_id,
        filename=filename,
        size_bytes=len(file_content),
        mime_type=mime_type,
        status=DocumentStatus.PROCESSING,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    _documents[doc_id] = doc
    _save_documents_to_disk()

    try:
        if mime_type != "application/pdf":
            raise ValueError(f"Unsupported MIME type: {mime_type}")

        pages, images = await asyncio.to_thread(_extract_pdf, str(file_path), doc_id)

        chunks = chunk_document_pages(pages)
        text_chunks = [
            TextChunk(
                document_id=doc_id,
                content=chunk.content,
                page_number=chunk.page_number,
                chunk_index=chunk.chunk_index,
                start_char=chunk.start_char,
                end_char=chunk.end_char,
            )
            for chunk in chunks
        ]

        _text_chunks[doc_id] = text_chunks
        _image_chunks[doc_id] = images

        doc.page_count = len(pages) if pages else 1
        doc.chunk_count = len(text_chunks) + len(images)
        doc.status = DocumentStatus.INDEXING
        doc.updated_at = datetime.utcnow()
        _save_documents_to_disk()

        logger.info(
            "ingestion_complete",
            document_id=doc_id,
            pages=doc.page_count,
            text_chunks=len(text_chunks),
            image_chunks=len(images),
        )

        return doc

    except Exception as exc:
        doc.status = DocumentStatus.FAILED
        doc.updated_at = datetime.utcnow()
        _save_documents_to_disk()
        logger.error("ingestion_failed", document_id=doc_id, error=str(exc))
        raise


def _extract_pdf(file_path: str, doc_id: str) -> Tuple[List[str], List[ImageChunk]]:
    """Extract text and embedded images from a PDF using PyMuPDF."""
    document = fitz.open(file_path)
    pages: List[str] = []
    images: List[ImageChunk] = []

    for page_index, page in enumerate(document):
        pages.append(page.get_text("text"))

        for image_index, image_info in enumerate(page.get_images(full=True)):
            xref = image_info[0]
            try:
                base_image = document.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]

                image_filename = f"{doc_id}_p{page_index + 1}_i{image_index}.{image_ext}"
                image_path = IMAGES_DIR / image_filename
                image_path.write_bytes(image_bytes)

                images.append(
                    ImageChunk(
                        document_id=doc_id,
                        page_number=page_index + 1,
                        image_index=image_index,
                        image_path=str(image_path),
                    )
                )
            except Exception:
                logger.warning(
                    "image_extraction_failed",
                    document_id=doc_id,
                    page=page_index + 1,
                    image_index=image_index,
                )

    document.close()
    return pages, images


def get_document(doc_id: str) -> Optional[DocumentMetadata]:
    """Retrieve document metadata by ID."""
    return _documents.get(doc_id)


def get_document_file_path(doc_id: str) -> Optional[Path]:
    """Resolve the stored upload path for a document."""
    document = _documents.get(doc_id)
    if document is None:
        return None

    path = UPLOAD_DIR / f"{doc_id}_{document.filename}"
    return path if path.exists() else None


def get_all_documents() -> List[DocumentMetadata]:
    """Retrieve all documents."""
    return list(_documents.values())


def get_text_chunks(doc_id: str) -> List[TextChunk]:
    """Retrieve text chunks for a document."""
    return _text_chunks.get(doc_id, [])


def get_image_chunks(doc_id: str) -> List[ImageChunk]:
    """Retrieve image chunks for a document."""
    return _image_chunks.get(doc_id, [])


def update_document_status(doc_id: str, status: DocumentStatus) -> None:
    """Update the status of a document."""
    if doc_id in _documents:
        _documents[doc_id].status = status
        _documents[doc_id].updated_at = datetime.utcnow()
        _save_documents_to_disk()


def _safe_unlink(path: Path) -> None:
    """Delete a file if it exists."""
    try:
        path.unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("file_delete_failed", path=str(path), error=str(exc))


def delete_document(doc_id: str) -> bool:
    """
    Remove a document and all associated local state.

    Cleans:
    - the original uploaded file from data/uploads
    - extracted images from data/images
    - persisted metadata
    - in-memory chunk stores
    """
    document = _documents.get(doc_id)
    if document is None:
        return False

    upload_path = UPLOAD_DIR / f"{doc_id}_{document.filename}"
    _safe_unlink(upload_path)

    for image_path in IMAGES_DIR.glob(f"{doc_id}_*"):
        _safe_unlink(image_path)

    _documents.pop(doc_id, None)
    _text_chunks.pop(doc_id, None)
    _image_chunks.pop(doc_id, None)
    _save_documents_to_disk()

    logger.info("document_local_cleanup_complete", document_id=doc_id, filename=document.filename)
    return True
