"""
MLOps service — experiment tracking and model registry via MLflow.

Tracks:
- Query latency: end-to-end and per-stage timing
- Retrieval scores: relevance quality per query
- Model metadata: encoder versions, embedding dimensions
- Experiment runs: grouped by session
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from app.config import settings
from app.models.schemas import DocumentStatus
from app.services.ingestion import get_all_documents
from app.utils.logging import get_logger

logger = get_logger("mlops")

_query_log: List[Dict[str, Any]] = []

_mlflow_available = False
try:
    import mlflow
    import mlflow.pytorch

    _mlflow_available = True
except ImportError:
    logger.warning("mlflow_not_available", msg="MLflow not installed — tracking disabled")


def init_mlflow() -> None:
    """Initialize MLflow tracking. Call once at startup."""
    if not _mlflow_available:
        return

    try:
        mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
        mlflow.set_experiment(settings.mlflow_experiment_name)
        logger.info(
            "mlflow_initialized",
            tracking_uri=settings.mlflow_tracking_uri,
            experiment=settings.mlflow_experiment_name,
        )
    except Exception as exc:
        logger.warning("mlflow_init_failed", error=str(exc))


def _average(values: List[float]) -> float:
    """Compute a safe arithmetic mean."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def _split_in_halves(items: List[Any]) -> tuple[List[Any], List[Any]]:
    """Split a list into older and newer halves."""
    if len(items) < 2:
        return items, []

    midpoint = len(items) // 2
    return items[:midpoint], items[midpoint:]


def _percent_change(previous: float, current: float) -> float:
    """Compute percentage change while handling empty baselines."""
    if previous == 0:
        return 100.0 if current > 0 else 0.0

    return round(((current - previous) / previous) * 100, 2)


def log_query(
    query_id: str,
    query_text: str,
    latency_ms: float,
    retrieval_latency_ms: float,
    confidence: float,
    status: str,
    top_k: int,
    results_count: int,
    citation_count: int,
    model_used: str,
) -> None:
    """Log a single query run to the in-memory store and MLflow when available."""
    entry: Dict[str, Any] = {
        "query_id": query_id,
        "query_text": query_text,
        "timestamp": datetime.utcnow(),
        "latency_ms": latency_ms,
        "retrieval_latency_ms": retrieval_latency_ms,
        "confidence": confidence,
        "status": status,
        "top_k": top_k,
        "results_count": results_count,
        "document_count": results_count,
        "citation_count": citation_count,
        "model_used": model_used,
    }
    _query_log.append(entry)

    if _mlflow_available:
        try:
            start_run_kwargs: Dict[str, Any] = {"run_name": f"query-{query_id[:8]}"}
            if mlflow.active_run() is not None:
                start_run_kwargs["nested"] = True

            with mlflow.start_run(**start_run_kwargs):
                mlflow.log_params(
                    {
                        "query_text": query_text[:250],
                        "model_used": model_used,
                        "top_k": top_k,
                        "status": status,
                    }
                )
                mlflow.log_metrics(
                    {
                        "total_latency_ms": latency_ms,
                        "retrieval_latency_ms": retrieval_latency_ms,
                        "confidence": confidence,
                        "results_count": results_count,
                        "citation_count": citation_count,
                    }
                )
        except Exception as exc:
            logger.warning("mlflow_log_failed", query_id=query_id, error=str(exc))

    logger.info(
        "query_logged",
        query_id=query_id,
        latency_ms=round(latency_ms, 2),
        confidence=round(confidence, 4),
        status=status,
    )


def register_model(model: Any, model_name: str = "documind-multimodal-encoder") -> Optional[str]:
    """
    Register the MultiModalEncoder in MLflow Model Registry.
    Returns the model version string if successful.
    """
    if not _mlflow_available:
        logger.warning("mlflow_not_available", msg="Cannot register model")
        return None

    try:
        with mlflow.start_run(run_name="model-registration"):
            mlflow.log_params(
                {
                    "model_name": model_name,
                    "projection_dim": getattr(model, "projection_dim", "unknown"),
                    "vision_dim": getattr(model, "vision_dim", "unknown"),
                    "text_dim": getattr(model, "text_dim", "unknown"),
                }
            )

            model_info = mlflow.pytorch.log_model(
                model,
                artifact_path="model",
                registered_model_name=model_name,
            )

            logger.info(
                "model_registered",
                model_name=model_name,
                uri=model_info.model_uri,
            )
            return model_info.model_uri
    except Exception as exc:
        logger.error("model_registration_failed", error=str(exc))
        return None


def get_query_log() -> List[Dict[str, Any]]:
    """Return the full in-memory query log."""
    return list(_query_log)


def get_analytics_summary() -> Dict[str, Any]:
    """Compute analytics summary from indexed documents and the query log."""
    indexed_documents = [
        doc
        for doc in get_all_documents()
        if doc.status == DocumentStatus.INDEXED
    ]
    indexed_documents.sort(key=lambda doc: doc.created_at)

    index_volume = sum(doc.chunk_count or 0 for doc in indexed_documents)
    older_docs, newer_docs = _split_in_halves(indexed_documents)
    index_volume_change = _percent_change(
        sum(doc.chunk_count or 0 for doc in older_docs),
        sum(doc.chunk_count or 0 for doc in newer_docs),
    ) if newer_docs else 0.0

    total_queries = len(_query_log)
    latencies = [float(entry["latency_ms"]) for entry in _query_log]
    avg_latency_ms = round(_average(latencies), 1)

    older_queries, newer_queries = _split_in_halves(_query_log)
    queries_change = _percent_change(len(older_queries), len(newer_queries)) if newer_queries else 0.0
    latency_change = round(
        _average([float(entry["latency_ms"]) for entry in newer_queries])
        - _average([float(entry["latency_ms"]) for entry in older_queries]),
        1,
    ) if newer_queries else 0.0

    recent_queries = list(reversed(_query_log[-20:]))

    return {
        "index_volume": int(index_volume),
        "total_queries": total_queries,
        "avg_latency_ms": avg_latency_ms,
        "index_volume_change": float(index_volume_change),
        "queries_change": float(queries_change),
        "latency_change": float(latency_change),
        "recent_queries": recent_queries,
    }
