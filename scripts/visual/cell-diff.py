#!/usr/bin/env python3
"""P20.8 per-zone card diff (review harness, not part of the shipped game).

Compares the per-zone card renders two runs of card-cell-audit.mjs produced, so
"this zone renders identically before and after" is a pixel count rather than an
assurance. Reports every zone present in both directories.

  python3 scripts/visual/cell-diff.py <beforeDir> <afterDir> [zonePrefix ...]
"""
import os
import sys

import numpy as np
from PIL import Image


def main():
    before, after = sys.argv[1], sys.argv[2]
    prefixes = sys.argv[3:]
    names = sorted(
        f for f in os.listdir(before)
        if f.endswith(".png") and os.path.exists(os.path.join(after, f))
    )
    if prefixes:
        names = [n for n in names if any(n.startswith(p) for p in prefixes)]
    worst = 0
    for name in names:
        a = np.asarray(Image.open(os.path.join(before, name)).convert("RGBA")).astype(int)
        b = np.asarray(Image.open(os.path.join(after, name)).convert("RGBA")).astype(int)
        delta = np.abs(a - b)
        changed = int((delta.max(axis=2) > 0).sum())
        worst = max(worst, changed)
        print("%-46s changedPx=%-7d maxDelta=%d"
              % (name[:-4], changed, int(delta.max())))
    print("%d cards compared; worst changedPx=%d" % (len(names), worst))
    return 0 if worst == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
