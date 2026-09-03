#!/usr/bin/env python3
"""P20.8 pose survey (review harness, not part of the shipped game).

Whole-frame and horizon-band A/B numbers for every pinned pose two runs of
shoot-poses.mjs produced, so the art review starts from where the frame
actually moved instead of from where it was expected to.

  python3 scripts/visual/pose-survey.py <beforeDir> <afterDir> [--rows T,B]
"""
import os
import sys

import numpy as np
from PIL import Image

WORLD = (130, 620)
THRESHOLD = 10


def luma(a):
    return 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]


def main():
    before, after = sys.argv[1], sys.argv[2]
    rows = WORLD
    if "--rows" in sys.argv:
        rows = tuple(int(v) for v in sys.argv[sys.argv.index("--rows") + 1].split(","))
    names = sorted(
        f for f in os.listdir(before)
        if f.startswith("pose-") and f.endswith(".png")
        and "-r" not in f[5:] and os.path.exists(os.path.join(after, f))
    )
    print("%-14s %9s %9s %9s %9s %9s"
          % ("pose", "changed", "share%", "lumaB", "lumaA", "delta"))
    for name in names:
        a = np.asarray(Image.open(os.path.join(before, name)).convert("RGB")).astype(np.int16)
        b = np.asarray(Image.open(os.path.join(after, name)).convert("RGB")).astype(np.int16)
        window = (slice(rows[0], rows[1]), slice(0, a.shape[1]))
        delta = np.abs(a - b).max(axis=2)[window]
        changed = int((delta >= THRESHOLD).sum())
        la, lb = luma(a)[window], luma(b)[window]
        print("%-14s %9d %9.3f %9.2f %9.2f %+9.2f"
              % (name[:-4], changed, 100 * changed / delta.size,
                 float(la.mean()), float(lb.mean()),
                 float(lb.mean() - la.mean())))


if __name__ == "__main__":
    main()
