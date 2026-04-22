"""
Pydantic schemas for typed request/response contracts.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import uuid


# ── Enums ──

class DocumentStatus(str, Enum):
    UPLOADING = "uploading"
    PROCESSING = "processing"
    INDEXING = "indexing"
    INDEXED = "indexed"
    FAILED = "failed"


class QueryStatus(str, Enum):
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class SummaryMode(str, Enum):
    QUICK = "quick"
    STANDARD = "standard"
    DEEP = "deep"
    EXECUTIVE = "executive"
    STUDENT = "student"


# ── Document Schemas ──

class DocumentUploadResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    size_bytes: int
    status: DocumentStatus = DocumentStatus.UPLOADING
    created_at: datetime = Field(default_factory=datetime.utcnow)
    message: str = "Upload received"


class DocumentMetadata(BaseModel):
    id: str
    filename: str
    size_bytes: int
    mime_type: str
    status: DocumentStatus
    page_count: Optional[int] = None
    chunk_count: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    thumbnail_url: Optional[str] = None


class DocumentListResponse(BaseModel):
    documents: List[DocumentMetadata]
    total: int


class DocumentSummaryRequest(BaseModel):
    mode: SummaryMode = SummaryMode.STANDARD
    force_refresh: bool = False


class SummaryInsight(BaseModel):
    title: str
    detail: str
    supporting_pages: List[int] = Field(default_factory=list)
    importance_score: float = Field(default=0.0, ge=0.0, le=1.0)


class SummaryMetric(BaseModel):
    label: str
    value: str
    context: Optional[str] = None


class DocumentSummaryResponse(BaseModel):
    document_id: str
    document_name: str
    title: str
    mode: SummaryMode
    document_type: str
    purpose: str
    overview: str
    executive_summary: List[str] = Field(default_factory=list)
    main_insights: List[SummaryInsight]
    why_it_matters: str
    key_metrics: List[SummaryMetric]
    final_takeaway: str
    landmark_note: Optional[str] = None
    contact_info: Optional[List[str]] = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# ── Chunk Schemas ──

class TextChunk(BaseModel):
    """A single text chunk from a processed document."""
    chunk_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str
    content: str
    page_number: Optional[int] = None
    chunk_index: int
    start_char: int
    end_char: int
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ImageChunk(BaseModel):
    """A reference to an extracted image from a document."""
    chunk_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str
    page_number: int
    image_index: int
    caption: Optional[str] = None
    image_path: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ── Query Schemas ──

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    document_ids: Optional[List[str]] = None
    top_k: int = Field(default=5, ge=1, le=20)
    deep_scan: bool = Field(default=True)


class Citation(BaseModel):
    document_id: str
    document_name: str
    page_number: Optional[int] = None
    chunk_id: str
    relevance_score: float
    snippet: str


class QueryResponse(BaseModel):
    query_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    answer: str
    citations: List[Citation]
    model_used: str
    latency_ms: float
    confidence: float
    status: QueryStatus = QueryStatus.SUCCESS


class StreamChunk(BaseModel):
    """SSE streaming chunk for real-time generation."""
    event: str  # "token", "citation", "metadata", "done", "error"
    data: str


# ── Analytics Schemas ──

class QueryLogEntry(BaseModel):
    query_id: str
    query_text: str
    timestamp: datetime
    latency_ms: float
    confidence: float
    status: QueryStatus
    document_count: int
    citation_count: int


class AnalyticsOverview(BaseModel):
    index_volume: int
    total_queries: int
    avg_latency_ms: float
    index_volume_change: float  # percentage
    queries_change: float
    latency_change: float
    recent_queries: List[QueryLogEntry]


# ── Health ──

class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str = "1.2.0-beta"
    services: Dict[str, str] = Field(default_factory=dict)
