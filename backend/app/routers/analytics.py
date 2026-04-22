"""
Analytics API routes.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import AnalyticsOverview, QueryLogEntry, QueryStatus
from app.services.mlops import get_analytics_summary, get_query_log
from app.utils.logging import get_logger

logger = get_logger("router.analytics")

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/overview", response_model=AnalyticsOverview)
async def analytics_overview():
    """Get analytics overview with KPIs and trends."""
    summary = get_analytics_summary()

    recent = []
    for q in summary.get("recent_queries", [])[:20]:
        recent.append(
            QueryLogEntry(
                query_id=q["query_id"],
                query_text=q["query_text"],
                timestamp=q["timestamp"],
                latency_ms=q["latency_ms"],
                confidence=q["confidence"],
                status=QueryStatus(q["status"]),
                document_count=q.get("results_count", 0),
                citation_count=q.get("citation_count", 0),
            )
        )

    return AnalyticsOverview(
        index_volume=summary["index_volume"],
        total_queries=summary["total_queries"],
        avg_latency_ms=summary["avg_latency_ms"],
        index_volume_change=summary["index_volume_change"],
        queries_change=summary["queries_change"],
        latency_change=summary["latency_change"],
        recent_queries=recent,
    )


@router.get("/queries")
async def query_history():
    """Get full query history."""
    return get_query_log()
