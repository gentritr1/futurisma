#!/usr/bin/env python3
"""P20.4 review harness: what the living-world layer does to the horizon rows.

frame-metrics.py reads two FIXED 24-row bands — sky = rows 308-331, ground =
rows 348-371 — over the same off-road columns it uses for everything else. (The
"find the horizon row" search in that file never runs: `best_step` starts at
-1e9 and the loop compares `abs(step) > abs(best_step)`, so `best_row` is always
its initial 340. Every hsplit in the harness is that fixed pair of bands.)

This prints the mean luma of every 4th row through the horizon for a matched
pair of frames, so a band that is supposed to change hsplit can be seen either
landing on those rows or missing them.

  python3 shots/p20.4/row-profile.py <fileA> <fileB>
"""
import sys

from PIL import Image

COLS = list(range(20, 340)) + list(range(940, 1100))
SKY = (308, 332)
GROUND = (348, 372)


def profile(path):
    lum = Image.open(path).convert("L").load()
    return {y: sum(lum[x, y] for x in COLS) / len(COLS) for y in range(230, 420)}


def band(prof, span):
    rows = range(span[0], span[1])
    return sum(prof[y] for y in rows) / len(list(rows))


def main(argv):
    a, b = profile(argv[0]), profile(argv[1])
    print(f"{'row':>5}{'A':>9}{'B':>9}{'A-B':>9}")
    for y in range(230, 420, 4):
        print(f"{y:>5}{a[y]:>9.1f}{b[y]:>9.1f}{a[y] - b[y]:>9.1f}")
    for name, span in (("sky", SKY), ("ground", GROUND)):
        print(f"{name:>7} A={band(a, span):.1f} B={band(b, span):.1f} "
              f"delta={band(a, span) - band(b, span):+.1f}")
    print(f"hsplit A={band(a, SKY) - band(a, GROUND):+.1f} "
          f"B={band(b, SKY) - band(b, GROUND):+.1f}")


if __name__ == "__main__":
    main(sys.argv[1:])
