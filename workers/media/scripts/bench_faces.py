#!/usr/bin/env python
"""Benchmark YuNet + SFace on a folder of JPEGs.

    python scripts/bench_faces.py /path/to/jpegs [--threshold 0.363] [--max-edge 1600]

Prints faces/photo and ms/photo (detect, embed, total). If `labels.csv`
(filename,person) exists in the folder, each labelled photo is assumed to show
that one person (largest face is used) and pairwise same-person precision /
recall at the cosine threshold is reported, plus the best F1 threshold, which
is the number to feed FACE_MATCH_THRESHOLD / FACE_CLUSTER_DISTANCE.
This is the SFace accuracy spike from docs/04-plan.md.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hub_worker import face  # noqa: E402
from hub_worker.config import settings  # noqa: E402

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--threshold", type=float, default=settings.face_match_threshold)
    ap.add_argument("--max-edge", type=int, default=face.MAX_ANALYSIS_EDGE)
    args = ap.parse_args()

    files = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in EXTS)
    if not files:
        print("no images found")
        return 1
    face.MAX_ANALYSIS_EDGE = args.max_edge
    face.warmup()

    labels: dict[str, str] = {}
    csv_path = args.folder / "labels.csv"
    if csv_path.exists():
        with csv_path.open() as f:
            for row in csv.reader(f):
                if len(row) >= 2 and not row[0].startswith("#"):
                    labels[row[0].strip()] = row[1].strip()

    det_ms: list[float] = []
    emb_ms: list[float] = []
    load_ms: list[float] = []
    n_faces = 0
    best_emb: dict[str, np.ndarray] = {}
    for p in files:
        t0 = time.perf_counter()
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            print(f"{p.name}: unreadable")
            continue
        t1 = time.perf_counter()
        faces, analyzed = face.detect(img)
        t2 = time.perf_counter()
        embs = [face.embed(analyzed, f) for f in faces]
        t3 = time.perf_counter()
        load_ms.append((t1 - t0) * 1000)
        det_ms.append((t2 - t1) * 1000)
        emb_ms.append((t3 - t2) * 1000)
        n_faces += len(faces)
        if faces and p.name in labels:
            best_emb[p.name] = embs[0]
        print(f"{p.name}: {img.shape[1]}x{img.shape[0]} faces={len(faces)} detect={det_ms[-1]:.0f}ms embed={emb_ms[-1]:.0f}ms"
              + (f" q={[round(f.quality, 2) for f in faces]}" if faces else ""))

    n = len(det_ms)
    print(f"\n{n} photos, {n_faces} faces ({n_faces / max(n, 1):.2f}/photo)")
    print(f"ms/photo: load {np.mean(load_ms):.0f}  detect {np.mean(det_ms):.0f}  embed {np.mean(emb_ms):.0f}  "
          f"total {np.mean(load_ms) + np.mean(det_ms) + np.mean(emb_ms):.0f}  (median detect {np.median(det_ms):.0f}, embed/face {np.sum(emb_ms) / max(n_faces, 1):.1f})")

    if len(best_emb) >= 2:
        names = sorted(best_emb)
        sims, same = [], []
        for a, b in itertools.combinations(names, 2):
            sims.append(float(np.dot(best_emb[a], best_emb[b])))
            same.append(labels[a] == labels[b])
        sims_a, same_a = np.array(sims), np.array(same)

        def pr(th: float) -> tuple[float, float, float]:
            pred = sims_a >= th
            tp = int(np.sum(pred & same_a))
            fp = int(np.sum(pred & ~same_a))
            fn = int(np.sum(~pred & same_a))
            prec = tp / (tp + fp) if tp + fp else 0.0
            rec = tp / (tp + fn) if tp + fn else 0.0
            f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
            return prec, rec, f1

        p_, r_, f_ = pr(args.threshold)
        print(f"\npairs: {len(sims)} ({int(same_a.sum())} same-person). At cosine >= {args.threshold}: precision {p_:.3f} recall {r_:.3f} F1 {f_:.3f}")
        grid = np.arange(0.2, 0.8, 0.01)
        scores = [pr(t)[2] for t in grid]
        bt = float(grid[int(np.argmax(scores))])
        bp, br, bf = pr(bt)
        print(f"best F1 at cosine >= {bt:.2f}: precision {bp:.3f} recall {br:.3f} F1 {bf:.3f}  (cluster distance {1 - bt:.2f})")
        print("same-person sims: mean %.3f min %.3f | different: mean %.3f max %.3f" % (
            sims_a[same_a].mean() if same_a.any() else float("nan"), sims_a[same_a].min() if same_a.any() else float("nan"),
            sims_a[~same_a].mean() if (~same_a).any() else float("nan"), sims_a[~same_a].max() if (~same_a).any() else float("nan")))
    elif labels:
        print("labels.csv found but fewer than two labelled photos had a detectable face")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
