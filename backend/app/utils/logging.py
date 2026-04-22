"""
Structured logging for DocuMind using structlog.

Provides JSON-formatted structured logs in production and
human-readable pretty-print logs in development.
"""

import sys
import structlog
import logging
from app.config import settings


def setup_logging() -> None:
    """Configure structlog with appropriate processors."""

    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if settings.log_level == "DEBUG":
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.UnicodeDecoder(),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.BoundLogger:
    """Get a named structured logger."""
    return structlog.get_logger(name)
