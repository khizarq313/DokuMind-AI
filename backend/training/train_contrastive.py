"""
Contrastive loss training script for the MultiModalEncoder.

Demonstrates fine-tuning the projection head on a synthetic dataset
of image-text pairs, using the CLIP-style InfoNCE contrastive objective.
This shows the model CAN be fine-tuned, not just used off-the-shelf.

Usage:
    python -m training.train_contrastive --epochs 10 --batch-size 16 --lr 1e-4
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
import torch.optim as optim
from torch.utils.data import DataLoader

from training.dataset import SyntheticImageTextDataset

# Add parent to path for app imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from app.models.multimodal import MultiModalEncoder, ContrastiveLoss

# Try importing mlflow
try:
    import mlflow
    import mlflow.pytorch
    MLFLOW_AVAILABLE = True
except ImportError:
    MLFLOW_AVAILABLE = False


def train(args: argparse.Namespace) -> None:
    """Main training loop."""

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🔧 Device: {device}")
    print(f"📊 Config: epochs={args.epochs}, batch_size={args.batch_size}, lr={args.lr}")

    # ── Model ──
    print("📦 Loading MultiModalEncoder...")
    model = MultiModalEncoder(
        projection_dim=args.projection_dim,
        freeze_backbones=True,  # Only train the projection head
        dropout=args.dropout,
    ).to(device)

    # Count trainable params
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"   Total params:     {total_params:,}")
    print(f"   Trainable params: {trainable_params:,}")

    # ── Loss ──
    criterion = ContrastiveLoss(initial_temperature=args.temperature).to(device)

    # ── Optimizer — only trains projection head + temperature ──
    optimizer = optim.AdamW(
        list(model.projection.parameters()) + list(criterion.parameters()),
        lr=args.lr,
        weight_decay=args.weight_decay,
    )

    scheduler = optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.01
    )

    # ── Dataset ──
    print(f"📂 Creating synthetic dataset with {args.dataset_size} pairs...")
    dataset = SyntheticImageTextDataset(size=args.dataset_size, image_size=224)
    dataloader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=0,
        collate_fn=dataset.collate_fn,
    )

    # ── MLflow ──
    if MLFLOW_AVAILABLE and args.mlflow:
        mlflow.set_tracking_uri(args.mlflow_uri)
        mlflow.set_experiment("documind-contrastive-training")
        mlflow.start_run(run_name=f"train-{int(time.time())}")
        mlflow.log_params({
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "learning_rate": args.lr,
            "projection_dim": args.projection_dim,
            "dropout": args.dropout,
            "temperature": args.temperature,
            "dataset_size": args.dataset_size,
            "trainable_params": trainable_params,
        })

    # ── Training Loop ──
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    best_loss = float("inf")
    history = []

    print("\n🚀 Starting training...\n")

    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_loss = 0.0
        epoch_i2t_loss = 0.0
        epoch_t2i_loss = 0.0
        num_batches = 0
        epoch_start = time.time()

        for batch_idx, (images, texts) in enumerate(dataloader):
            optimizer.zero_grad()

            # Forward pass through both encoders
            image_embeddings = model.encode_image(images)
            text_embeddings = model.encode_text(texts)

            # Compute contrastive loss
            loss_dict = criterion(image_embeddings, text_embeddings)
            loss = loss_dict["loss"]

            # Backward pass
            loss.backward()

            # Gradient clipping for stability
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)

            optimizer.step()

            epoch_loss += loss.item()
            epoch_i2t_loss += loss_dict["image_to_text_loss"].item()
            epoch_t2i_loss += loss_dict["text_to_image_loss"].item()
            num_batches += 1

        scheduler.step()

        # ── Epoch Summary ──
        avg_loss = epoch_loss / num_batches
        avg_i2t = epoch_i2t_loss / num_batches
        avg_t2i = epoch_t2i_loss / num_batches
        elapsed = time.time() - epoch_start
        temp = loss_dict["temperature"].item()

        record = {
            "epoch": epoch,
            "loss": avg_loss,
            "i2t_loss": avg_i2t,
            "t2i_loss": avg_t2i,
            "temperature": temp,
            "lr": scheduler.get_last_lr()[0],
            "time_s": elapsed,
        }
        history.append(record)

        print(
            f"  Epoch {epoch:3d}/{args.epochs} │ "
            f"Loss: {avg_loss:.4f} │ "
            f"I→T: {avg_i2t:.4f} │ "
            f"T→I: {avg_t2i:.4f} │ "
            f"τ: {temp:.4f} │ "
            f"LR: {scheduler.get_last_lr()[0]:.2e} │ "
            f"Time: {elapsed:.1f}s"
        )

        # Log to MLflow
        if MLFLOW_AVAILABLE and args.mlflow:
            mlflow.log_metrics({
                "train_loss": avg_loss,
                "i2t_loss": avg_i2t,
                "t2i_loss": avg_t2i,
                "temperature": temp,
                "learning_rate": scheduler.get_last_lr()[0],
            }, step=epoch)

        # Save best model
        if avg_loss < best_loss:
            best_loss = avg_loss
            checkpoint_path = output_dir / "best_model.pt"
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "loss_state_dict": criterion.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "loss": best_loss,
            }, checkpoint_path)
            print(f"  ✅ Best model saved (loss={best_loss:.4f})")

    # ── Save final checkpoint ──
    final_path = output_dir / "final_model.pt"
    torch.save({
        "epoch": args.epochs,
        "model_state_dict": model.state_dict(),
        "loss_state_dict": criterion.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "loss": avg_loss,
    }, final_path)

    # Save training history
    history_path = output_dir / "training_history.json"
    with open(history_path, "w") as f:
        json.dump(history, f, indent=2)

    # Register model in MLflow
    if MLFLOW_AVAILABLE and args.mlflow:
        mlflow.pytorch.log_model(
            model,
            artifact_path="model",
            registered_model_name="documind-multimodal-encoder",
        )
        mlflow.end_run()

    print(f"\n🏁 Training complete!")
    print(f"   Best loss:  {best_loss:.4f}")
    print(f"   Final saved: {final_path}")
    print(f"   History:     {history_path}")


def main():
    parser = argparse.ArgumentParser(description="Train MultiModalEncoder with contrastive loss")

    # Training
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--temperature", type=float, default=0.07)

    # Model
    parser.add_argument("--projection-dim", type=int, default=512)
    parser.add_argument("--dataset-size", type=int, default=200)

    # Output
    parser.add_argument("--output-dir", type=str, default="./checkpoints")

    # MLflow
    parser.add_argument("--mlflow", action="store_true", default=False)
    parser.add_argument("--mlflow-uri", type=str, default="http://localhost:5000")

    args = parser.parse_args()
    train(args)


if __name__ == "__main__":
    main()
