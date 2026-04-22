"""
Synthetic image-text dataset for contrastive training.

Generates paired (image, text) samples with known relationships.
Each image is a synthetic visualization with shapes, colors, and patterns,
paired with a text description of the visual content.

This allows training the projection head without requiring a large
external dataset, demonstrating the end-to-end fine-tuning pipeline.
"""

from __future__ import annotations

import random
from typing import List, Tuple

import torch
from PIL import Image, ImageDraw, ImageFont
from torch.utils.data import Dataset


# Colors with their names
COLORS = {
    "red": (220, 60, 60),
    "blue": (60, 80, 220),
    "green": (60, 180, 80),
    "yellow": (230, 200, 50),
    "purple": (150, 60, 200),
    "orange": (240, 140, 40),
    "cyan": (40, 200, 220),
    "pink": (230, 100, 160),
    "teal": (40, 160, 160),
    "lime": (140, 220, 40),
}

SHAPES = ["circle", "rectangle", "triangle", "diamond"]
PATTERNS = ["solid", "striped", "dotted"]
POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"]
SIZES = ["small", "medium", "large"]

# Document-like text topics for more realistic training
TOPICS = [
    "financial report", "research paper", "technical document",
    "quarterly earnings", "neural network architecture",
    "market analysis", "product specification", "legal contract",
    "scientific experiment", "data visualization",
]


def _draw_shape(
    draw: ImageDraw.Draw,
    shape: str,
    color: Tuple[int, int, int],
    position: str,
    size: str,
    canvas_size: int,
) -> None:
    """Draw a shape on the canvas at the specified position and size."""
    size_map = {"small": 0.15, "medium": 0.25, "large": 0.35}
    s = int(canvas_size * size_map[size])

    pos_map = {
        "top-left": (canvas_size * 0.2, canvas_size * 0.2),
        "top-right": (canvas_size * 0.7, canvas_size * 0.2),
        "bottom-left": (canvas_size * 0.2, canvas_size * 0.7),
        "bottom-right": (canvas_size * 0.7, canvas_size * 0.7),
        "center": (canvas_size * 0.45, canvas_size * 0.45),
    }
    cx, cy = pos_map[position]
    cx, cy = int(cx), int(cy)

    if shape == "circle":
        draw.ellipse([cx - s, cy - s, cx + s, cy + s], fill=color)
    elif shape == "rectangle":
        draw.rectangle([cx - s, cy - s // 2, cx + s, cy + s // 2], fill=color)
    elif shape == "triangle":
        draw.polygon(
            [(cx, cy - s), (cx - s, cy + s), (cx + s, cy + s)], fill=color
        )
    elif shape == "diamond":
        draw.polygon(
            [(cx, cy - s), (cx + s, cy), (cx, cy + s), (cx - s, cy)], fill=color
        )


def _generate_sample(image_size: int, seed: int) -> Tuple[Image.Image, str]:
    """
    Generate a single synthetic image-text pair.

    The image contains 1-3 colored shapes on a gradient background,
    and the text describes the visual content.
    """
    rng = random.Random(seed)

    # Background gradient
    bg_color1 = (rng.randint(10, 40), rng.randint(10, 40), rng.randint(10, 40))
    bg_color2 = (
        min(255, bg_color1[0] + rng.randint(20, 60)),
        min(255, bg_color1[1] + rng.randint(20, 60)),
        min(255, bg_color1[2] + rng.randint(20, 60)),
    )

    img = Image.new("RGB", (image_size, image_size), bg_color1)
    draw = ImageDraw.Draw(img)

    # Draw gradient
    for y in range(image_size):
        ratio = y / image_size
        r = int(bg_color1[0] * (1 - ratio) + bg_color2[0] * ratio)
        g = int(bg_color1[1] * (1 - ratio) + bg_color2[1] * ratio)
        b = int(bg_color1[2] * (1 - ratio) + bg_color2[2] * ratio)
        draw.line([(0, y), (image_size, y)], fill=(r, g, b))

    # Draw 1-3 shapes
    num_shapes = rng.randint(1, 3)
    used_positions = set()
    descriptions = []

    for _ in range(num_shapes):
        color_name = rng.choice(list(COLORS.keys()))
        shape = rng.choice(SHAPES)
        size = rng.choice(SIZES)

        # Pick unique position
        available = [p for p in POSITIONS if p not in used_positions]
        if not available:
            break
        position = rng.choice(available)
        used_positions.add(position)

        _draw_shape(draw, shape, COLORS[color_name], position, size, image_size)
        descriptions.append(f"a {size} {color_name} {shape} in the {position}")

    # Build text description
    topic = rng.choice(TOPICS)
    shape_text = ", ".join(descriptions[:-1]) + (f" and {descriptions[-1]}" if len(descriptions) > 1 else descriptions[0])
    text = f"A {topic} diagram showing {shape_text} on a dark gradient background."

    return img, text


class SyntheticImageTextDataset(Dataset):
    """
    Synthetic dataset of image-text pairs for contrastive training.

    Each sample has a known correspondence between the visual content
    and its textual description, making the contrastive objective
    well-defined.
    """

    def __init__(self, size: int = 200, image_size: int = 224):
        self.size = size
        self.image_size = image_size
        self._cache = {}

    def __len__(self) -> int:
        return self.size

    def __getitem__(self, idx: int) -> Tuple[Image.Image, str]:
        if idx not in self._cache:
            self._cache[idx] = _generate_sample(self.image_size, seed=idx)
        return self._cache[idx]

    @staticmethod
    def collate_fn(
        batch: List[Tuple[Image.Image, str]],
    ) -> Tuple[List[Image.Image], List[str]]:
        """Custom collate that keeps images as PIL objects for the encoder."""
        images, texts = zip(*batch)
        return list(images), list(texts)
