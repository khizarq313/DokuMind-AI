"""
Tests for the structured document summarization pipeline.
"""

from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.schemas import DocumentMetadata, DocumentStatus, DocumentSummaryResponse, SummaryMode
from app.services import summarization as summary_service


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def disable_groq_rewriting(monkeypatch):
    """Keep tests deterministic and offline-friendly."""
    monkeypatch.setattr(summary_service.settings, "groq_api_key", "")


def build_parsed_document(title, filename, pages):
    sections = summary_service._detect_sections(pages, title)
    full_text = "\n\n".join(pages)
    key_terms = summary_service._extract_key_terms(full_text, title)
    document_type = summary_service._classify_document(title, filename, sections, full_text)
    for section in sections:
        section.importance_score = summary_service._score_section(section, pages, key_terms, document_type)

    return summary_service.ParsedDocument(
        document_id="doc-test",
        filename=filename,
        mime_type="application/pdf",
        title=title,
        pages=list(pages),
        sections=sections,
        full_text=full_text,
        document_type=document_type,
        key_terms=key_terms,
        landmark_note=summary_service._detect_landmark_note(title, full_text),
    )


def test_research_paper_summary_detects_landmark_and_core_sections():
    pages = [
        """Attention Is All You Need

Abstract
We introduce the Transformer, a sequence transduction architecture based entirely on attention mechanisms.
The model removes recurrence while improving parallelization and translation quality.

Introduction
The paper was written to improve sequence modeling by replacing recurrent computation with attention.

Results
The Transformer reached 28.4 BLEU on English to German translation and trained significantly faster than prior models.

Conclusion
The central contribution is that attention alone is enough to model long-range dependencies effectively.

References
[1] Vaswani et al.""",
    ]

    parsed = build_parsed_document("Attention Is All You Need", "attention.pdf", pages)
    summary = summary_service._build_summary(parsed, SummaryMode.STANDARD)

    assert summary.document_type == "Research paper"
    assert summary.landmark_note is not None
    assert "Transformer" in summary.landmark_note
    assert summary.overview
    assert summary.main_insights
    assert all("references" not in insight.detail.lower() for insight in summary.main_insights)


def test_resume_summary_prioritizes_experience_and_metrics():
    pages = [
        """Jane Doe Resume

Professional Experience
Led frontend delivery for a commerce platform used by 2 million users and improved conversion by 35%.
Built React, TypeScript, and analytics workflows with strong collaboration across product and design.

Skills
React, TypeScript, Next.js, testing, accessibility, data visualization.

Education
B.Tech in Computer Science.""",
    ]

    parsed = build_parsed_document("Jane Doe Resume", "resume.pdf", pages)
    summary = summary_service._build_summary(parsed, SummaryMode.EXECUTIVE)

    assert summary.document_type == "Resume"
    assert "resume" in summary.overview.lower()
    assert any(metric.value == "35%" for metric in summary.key_metrics)
    assert any("experience" in insight.title.lower() or "35%" in insight.detail for insight in summary.main_insights)


def test_legal_summary_identifies_terms_not_citations():
    pages = [
        """Service Agreement

Parties
This Agreement is entered into between Acme Corp and Northwind LLC.

Terms
The agreement lasts 12 months and either party may terminate with 30 days written notice.

Liability
Each party limits liability except in cases of fraud or willful misconduct.""",
    ]

    parsed = build_parsed_document("Service Agreement", "agreement.pdf", pages)
    summary = summary_service._build_summary(parsed, SummaryMode.STANDARD)

    assert summary.document_type == "Legal agreement"
    assert "agreement" in summary.overview.lower()
    assert any(metric.value == "12 months" for metric in summary.key_metrics)
    assert summary.final_takeaway


def test_class_notes_student_mode_uses_simple_structure():
    pages = [
        """Operating Systems Notes

Topic
Processes are running programs, while threads are lighter-weight units inside a process.

Scheduling
Round-robin scheduling improves fairness by giving each process a time slice.

Key takeaway
The main exam focus is understanding how concurrency affects performance and correctness.""",
    ]

    parsed = build_parsed_document("Operating Systems Notes", "notes.pdf", pages)
    summary = summary_service._build_summary(parsed, SummaryMode.STUDENT)

    assert summary.document_type == "Class notes"
    assert summary.main_insights
    assert summary.why_it_matters


def test_financial_report_surfaces_key_numbers():
    pages = [
        """Acme Annual Report 2025

Executive Summary
Revenue grew to $2.4 billion while operating margin improved to 18%.

Results
Net income increased by 22% year over year and cash flow remained strong.

Outlook
Management expects continued investment in product expansion and efficiency.""",
    ]

    parsed = build_parsed_document("Acme Annual Report 2025", "annual-report.pdf", pages)
    summary = summary_service._build_summary(parsed, SummaryMode.EXECUTIVE)

    assert summary.document_type == "Financial report"
    assert any(metric.value == "$2.4 billion" for metric in summary.key_metrics)
    assert any(metric.value == "18%" for metric in summary.key_metrics)


@pytest.mark.anyio
async def test_summary_route_returns_structured_payload(monkeypatch):
    async def fake_summary(*args, **kwargs):
        return DocumentSummaryResponse(
            document_id="doc-123",
            document_name="Report.pdf",
            mode=SummaryMode.STANDARD,
            document_type="Report",
            purpose="Explain the document's main objective.",
            overview="This is a structured test summary.",
            main_insights=[],
            why_it_matters="It proves the API wiring works.",
            key_metrics=[],
            final_takeaway="The route returns the expected payload.",
            confidence=0.81,
        )

    monkeypatch.setattr(
        "app.routers.documents.ingestion.get_document",
        lambda document_id: DocumentMetadata(
            id=document_id,
            filename="Report.pdf",
            size_bytes=1024,
            mime_type="application/pdf",
            status=DocumentStatus.INDEXED,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
    )
    monkeypatch.setattr("app.routers.documents.summarize_document", fake_summary)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/documents/doc-123/summary",
            json={"mode": "standard", "force_refresh": False},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["document_type"] == "Report"
    assert payload["overview"] == "This is a structured test summary."
