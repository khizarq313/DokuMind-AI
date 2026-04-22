"""
Retrieval quality evaluation benchmark.

Measures how well the MultiModalEncoder retrieves the correct
text given an image query (and vice versa) on a held-out set.

Metrics:
- Recall@K (K=1,5,10): fraction of queries where the ground-truth
  match appears in the top-K results
- Mean Reciprocal Rank (MRR): average of 1/rank of the first correct result
- Median Rank: median position of the correct result

Usage:
    python -m training.evaluate --checkpoint ./checkpoints/best_model.pt --eval-size 50
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.multimodal import MultiModalEncoder
from training.dataset import SyntheticImageTextDataset


def compute_retrieval_metrics(
    image_embeddings: np.ndarray,
    text_embeddings: np.ndarray,
) -> dict:
    """
    Compute retrieval metrics for image→text and text→image.

    Both embedding matrices are (N, D) and row i in images matches
    row i in texts.
    """
    # Cosine similarity matrix
    similarity = image_embeddings @ text_embeddings.T  # (N, N)
    n = similarity.shape[0]

    metrics = {}

    for direction, sim in [
        ("image_to_text", similarity),
        ("text_to_image", similarity.T),
    ]:
        # Rank of the correct match for each query
        ranks = []
        for i in range(n):
            scores = sim[i]
            # Rank is how many items score higher than the correct one
            rank = (scores > scores[i]).sum() + 1
            ranks.append(int(rank))

        ranks = np.array(ranks)

        metrics[direction] = {
            "recall_at_1": float((ranks <= 1).mean()),
            "recall_at_5": float((ranks <= 5).mean()),
            "recall_at_10": float((ranks <= 10).mean()),
            "mrr": float((1.0 / ranks).mean()),
            "median_rank": float(np.median(ranks)),
            "mean_rank": float(np.mean(ranks)),
        }

    return metrics


@torch.no_grad()
def evaluate(args: argparse.Namespace) -> None:
    """Run the evaluation benchmark."""

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🔧 Device: {device}")

    # ── Load model ──
    print("📦 Loading model...")
    model = MultiModalEncoder(
        projection_dim=args.projection_dim,
        freeze_backbones=True,
    ).to(device)

    if args.checkpoint and Path(args.checkpoint).exists():
        checkpoint = torch.load(args.checkpoint, map_location=device)
        model.load_state_dict(checkpoint["model_state_dict"])
        print(f"   Loaded checkpoint: {args.checkpoint}")
        print(f"   Training loss was: {checkpoint.get('loss', 'unknown'):.4f}")
    else:
        print("   Using randomly initialized projection head")

    model.eval()

    # ── Dataset ──
    print(f"📂 Creating evaluation set with {args.eval_size} pairs...")
    # Use different seed range than training to avoid data leakage
    dataset = SyntheticImageTextDataset(size=args.eval_size, image_size=224)

    # ── Embed everything ──
    print("🔄 Computing embeddings...")
    batch_size = args.batch_size
    all_image_embs = []
    all_text_embs = []

    for i in range(0, len(dataset), batch_size):
        batch_images = []
        batch_texts = []
        for j in range(i, min(i + batch_size, len(dataset))):
            img, txt = dataset[j + 10000]  # Offset seed to avoid training data
            batch_images.append(img)
            batch_texts.append(txt)

        img_embs = model.encode_image(batch_images).cpu().numpy()
        txt_embs = model.encode_text(batch_texts).cpu().numpy()
        all_image_embs.append(img_embs)
        all_text_embs.append(txt_embs)

    image_embeddings = np.concatenate(all_image_embs, axis=0)
    text_embeddings = np.concatenate(all_text_embs, axis=0)

    print(f"   Image embeddings: {image_embeddings.shape}")
    print(f"   Text embeddings:  {text_embeddings.shape}")

    # ── Compute metrics ──
    print("📊 Computing retrieval metrics...")
    start = time.time()
    metrics = compute_retrieval_metrics(image_embeddings, text_embeddings)
    eval_time = time.time() - start

    # ── Print results ──
    print("\n" + "=" * 60)
    print("  RETRIEVAL QUALITY BENCHMARK")
    print("=" * 60)

    for direction, m in metrics.items():
        direction_label = direction.replace("_", " → ").title()
        print(f"\n  {direction_label}:")
        print(f"    Recall@1:     {m['recall_at_1']:.4f}")
        print(f"    Recall@5:     {m['recall_at_5']:.4f}")
        print(f"    Recall@10:    {m['recall_at_10']:.4f}")
        print(f"    MRR:          {m['mrr']:.4f}")
        print(f"    Median Rank:  {m['median_rank']:.0f}")
        print(f"    Mean Rank:    {m['mean_rank']:.1f}")

    print(f"\n  Evaluation time: {eval_time:.2f}s")
    print("=" * 60)

    # ── Save results ──
    output_path = Path(args.output_dir) / "eval_results.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    results = {
        "eval_size": args.eval_size,
        "projection_dim": args.projection_dim,
        "checkpoint": args.checkpoint,
        "metrics": metrics,
        "eval_time_s": eval_time,
    }

    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n📄 Results saved to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate retrieval quality")

    parser.add_argument("--checkpoint", type=str, default=None)
    parser.add_argument("--eval-size", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--projection-dim", type=int, default=512)
    parser.add_argument("--output-dir", type=str, default="./eval_results")

    args = parser.parse_args()
    evaluate(args)


if __name__ == "__main__":
    main()
