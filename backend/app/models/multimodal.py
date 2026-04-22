"""
Multi-modal encoder for DocuMind.

- Text embeddings: local ONNX model (all-MiniLM-L6-v2) via ChromaDB's built-in
  embedding function. No API key required; model is cached in ~/.cache/chroma.
- Image embeddings: Groq Vision (describe image) → same ONNX text encoder.

Eliminated: torch, torchvision, transformers, Pillow, HuggingFace Inference API.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import List, Optional

import numpy as np
from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2
from groq import Groq

from app.config import settings
from app.utils.logging import get_logger

# Module-level singleton for the ONNX embedding function.
# First call triggers a one-time model download (~79 MB) into ~/.cache/chroma.
_onnx_ef: Optional[ONNXMiniLM_L6_V2] = None


def _get_onnx_ef() -> ONNXMiniLM_L6_V2:
    global _onnx_ef
    if _onnx_ef is None:
        _onnx_ef = ONNXMiniLM_L6_V2()
    return _onnx_ef

logger = get_logger("multimodal")

_VISION_MODEL = "llama-3.2-11b-vision-preview"

_MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
}


class MultiModalEncoder:
    """
    Local ONNX encoder that produces L2-normalized embeddings for text and images.

    Text is embedded by the ONNX all-MiniLM-L6-v2 model (no API key needed).
    Images are first described by Groq Vision, then the description is embedded.
    """

    def __init__(self):
        self._groq_client: Optional[Groq] = None

    def _get_groq_client(self) -> Groq:
        if self._groq_client is None:
            if not settings.groq_api_key:
                raise RuntimeError("GROQ_API_KEY is not configured")
            self._groq_client = Groq(api_key=settings.groq_api_key)
        return self._groq_client

    def encode_text(self, texts: List[str]) -> np.ndarray:
        """
        Encode texts using the local ONNX all-MiniLM-L6-v2 model.
        Returns L2-normalized embeddings as ndarray of shape (B, embedding_dim).
        """
        if not texts:
            return np.empty((0, settings.embedding_dim), dtype=np.float32)

        ef = _get_onnx_ef()
        raw = ef(texts)  # returns List[List[float]]
        embeddings = np.array(raw, dtype=np.float32)

        # L2-normalize
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.maximum(norms, 1e-12)

        return embeddings

    def encode_image(self, image_paths: List[str]) -> np.ndarray:
        """
        Encode images by describing them via Groq Vision, then embedding
        the descriptions with the text model.
        Returns L2-normalized embeddings as ndarray of shape (B, embedding_dim).
        """
        if not image_paths:
            return np.empty((0, settings.embedding_dim), dtype=np.float32)

        descriptions = []
        for path in image_paths:
            try:
                desc = self._describe_image(path)
                descriptions.append(desc)
            except Exception as e:
                logger.warning("image_description_failed", path=path, error=str(e))
                descriptions.append("Image extracted from document")

        return self.encode_text(descriptions)

    def _describe_image(self, image_path: str) -> str:
        """Generate a concise text description of an image via Groq Vision."""
        image_bytes = Path(image_path).read_bytes()
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime = _MIME_MAP.get(Path(image_path).suffix.lower(), "image/png")

        client = self._get_groq_client()
        response = client.chat.completions.create(
            model=_VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Describe this image concisely in 2-3 sentences. "
                                "Focus on key content: text, data, charts, diagrams, "
                                "or visual elements that convey information."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                }
            ],
            max_tokens=150,
        )
        return response.choices[0].message.content or "Image from document"
