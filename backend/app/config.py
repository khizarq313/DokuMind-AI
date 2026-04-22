"""
DocuMind application configuration.
Loaded from environment variables with sensible defaults.
"""

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration loaded from environment variables."""

    backend_host: str = Field(default="0.0.0.0")
    backend_port: int = Field(default=8080)
    frontend_url: str = Field(default="http://localhost:5173")
    log_level: str = Field(default="INFO")
    max_upload_size_mb: int = Field(default=20)

    groq_api_key: str = Field(default="")
    groq_model: str = Field(default="llama-3.1-8b-instant")

    chroma_host: str = Field(default="localhost")
    chroma_port: int = Field(default=8000)
    chroma_collection: str = Field(default="documind_embeddings")

    mlflow_tracking_uri: str = Field(default="sqlite:///app/data/mlflow.db")
    mlflow_experiment_name: str = Field(default="documind-rag")

    embedding_dim: int = Field(default=384)
    summary_max_input_chars: int = Field(default=20000)

    chunk_size: int = Field(default=512)
    chunk_overlap: int = Field(default=64)

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
