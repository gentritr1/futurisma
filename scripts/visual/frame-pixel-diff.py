"""H1.3 — how many pixels differ between two frames.

Companion to `vehicle-pixels.mjs`, which shoots the same paused frame with and
without the craft. Kept in Python because the repo already leans on Pillow for
every other pixel measurement (`frame-diff.py`, `crop-luma.py`, ...) and adding
a PNG decoder to package.json for a review harness would put a dependency in the
shipped tree for something that never ships.

Usage: python3 scripts/visual/frame-pixel-diff.py <a.png> <b.png> [threshold]
Prints the count of pixels whose R, G or B differ by more than the threshold.
"""
import sys

from PIL import Image

a = Image.open(sys.argv[1]).convert("RGB")
b = Image.open(sys.argv[2]).convert("RGB")
threshold = int(sys.argv[3]) if len(sys.argv) > 3 else 8

if a.size != b.size:
    raise SystemExit(f"size mismatch: {a.size} vs {b.size}")

pa = a.load()
pb = b.load()
width, height = a.size
count = 0
for y in range(height):
    for x in range(width):
        ra, ga, ba = pa[x, y]
        rb, gb, bb = pb[x, y]
        if abs(ra - rb) > threshold or abs(ga - gb) > threshold or abs(ba - bb) > threshold:
            count += 1
print(count)
