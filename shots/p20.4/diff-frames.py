#!/usr/bin/env python3
"""P20.4 review harness: how many world pixels the living-world layer changes.

Differences matching frames from two directories over the world crop the frame
metrics use (rows 130-560, cols 0-1100 — the HUD lives outside it) and reports
the changed-pixel count per station. A pixel counts as changed when any channel
moves by more than THRESHOLD, which keeps AgX dither and 1-count rounding out of
the census.

  python3 shots/p20.4/diff-frames.py <dirA> <dirB> [threshold]

Pair by filename. Prints per-file counts and the median, plus the bounding box
of the changed pixels, which is the check that the diff is the card layer and
not two frames taken at different places: a layer diff sits in specific bands,
a pose diff covers the whole crop.
"""
import os
import sys

from PIL import Image

WORLD = (0, 130, 1100, 560)


def diff(pa, pb, threshold):
    a = Image.open(pa).convert("RGB").crop(WORLD)
    b = Image.open(pb).convert("RGB").crop(WORLD)
    da, db = a.load(), b.load()
    w, h = a.size
    changed = 0
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            ra, ga, ba = da[x, y]
            rb, gb, bb = db[x, y]
            if abs(ra - rb) > threshold or abs(ga - gb) > threshold or abs(ba - bb) > threshold:
                changed += 1
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    box = (x0, y0 + WORLD[1], x1, y1 + WORLD[1]) if changed else None
    return changed, w * h, box


def main(argv):
    dir_a, dir_b = argv[0], argv[1]
    threshold = int(argv[2]) if len(argv) > 2 else 3
    names = sorted(f for f in os.listdir(dir_a) if f.endswith(".png"))
    rows = []
    print(f"{'file':<16}{'changed':>10}{'share%':>9}  bbox (x0,y0,x1,y1)")
    for name in names:
        pb = os.path.join(dir_b, name)
        if not os.path.exists(pb):
            continue
        changed, total, box = diff(os.path.join(dir_a, name), pb, threshold)
        rows.append(changed)
        print(f"{name:<16}{changed:>10}{changed / total * 100:>9.2f}  {box}")
    if rows:
        rows.sort()
        print(f"{'MEDIAN':<16}{rows[len(rows) // 2]:>10}")
        print(f"{'MIN':<16}{rows[0]:>10}")


if __name__ == "__main__":
    main(sys.argv[1:])
