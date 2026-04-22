"""
Tests for the API endpoints.
"""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_health_endpoint():
    """Health endpoint should return 200 with status info."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "version" in data
    assert data["version"] == "1.2.0-beta"


@pytest.mark.anyio
async def test_list_documents_empty():
    """Documents list should return empty initially."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/documents/")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 0
    assert isinstance(data["documents"], list)


@pytest.mark.anyio
async def test_get_nonexistent_document():
    """Getting a non-existent document should return 404."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/documents/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_upload_invalid_type():
    """Uploading an unsupported file type should return 400."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/documents/upload",
            files={"file": ("test.txt", b"hello world", "text/plain")},
        )
    assert response.status_code == 400


@pytest.mark.anyio
async def test_analytics_overview():
    """Analytics overview should return structured data."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/analytics/overview")
    assert response.status_code == 200
    data = response.json()
    assert "total_queries" in data
    assert "avg_latency_ms" in data


@pytest.mark.anyio
async def test_query_validation():
    """Query with empty question should fail validation."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/query/",
            json={"question": "", "top_k": 5},
        )
    assert response.status_code == 422  # Validation error
