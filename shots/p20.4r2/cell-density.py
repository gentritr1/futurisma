#!/usr/bin/env python3
"""P20.4 round-2 review harness (not part of the shipped game).

What a living-world card can actually put on screen is `vertexAlpha * texel.a`,
so the cell's own alpha distribution is half the answer to "why is this
invisible" and the half round 1 measured only as a MEAN. Prints, per cell of
both shared motion sheets and of the horizon sheet: mean, p90 and max alpha,
the fraction of the cell over a few alpha floors, and the mean RGB of the
covered part (which is what the tint multiplies).
"""
import sys

import numpy as np
from PIL import Image

SHEETS = [
    ("greenwater_motion_512", 512, 2, ["mist", "steam", "rain", "glint"]),
    ("greenwater_motion_b_512", 512, 4, [
        "birdsA", "birdsB", "birdsC", "gull",
        "devilWispA", "devilWispB", "flickerFull", "flickerHalf",
        "flickerDead", "s8", "s9", "s10", "s11", "s12", "s13", "s14",
    ]),
]
BASE = "public/assets/greenwater/textures"


def main():
    for name, size, columns, labels in SHEETS:
        img = Image.open(f"{BASE}/{name}.png").convert("RGBA")
        arr = np.asarray(img, dtype=np.float32)
        cell = size // columns
        print(f"\n=== {name} {img.size} {columns}x{columns} cells of {cell}px")
        print(f"{'slot':<6}{'label':<12}{'mean_a':>8}{'p90_a':>8}{'max_a':>8}"
              f"{'>0.1':>7}{'>0.5':>7}  meanRGB(covered)")
        for slot, label in enumerate(labels):
            x = (slot % columns) * cell
            y = (slot // columns) * cell
            block = arr[y:y + cell, x:x + cell]
            alpha = block[:, :, 3] / 255
            covered = alpha > 0.1
            rgb = (block[:, :, :3][covered].mean(0).round(0)
                   if covered.any() else np.zeros(3))
            print(f"{slot:<6}{label:<12}{alpha.mean():>8.3f}"
                  f"{np.percentile(alpha, 90):>8.3f}{alpha.max():>8.3f}"
                  f"{covered.mean():>7.3f}{(alpha > 0.5).mean():>7.3f}  {rgb}")


if __name__ == "__main__":
    sys.exit(main())
