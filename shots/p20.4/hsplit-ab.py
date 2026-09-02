#!/usr/bin/env python3
"""P20.4 review harness: the CONTROLLED read of what the layer does to hsplit.

frame-metrics.py's two bands are fixed rows (see row-profile.py), and the far
field is insensitive to the few metres of pose drift left between two runs
gated on the HUD race clock — so a timed A/B is a valid paired measurement for
the horizon rows even though it is not one for the near field.

  python3 shots/p20.4/hsplit-ab.py <dirA> <dirB>
"""
import os
import sys

from PIL import Image

COLS = list(range(20, 340)) + list(range(940, 1100))
SKY = (308, 332)
GROUND = (348, 372)


def bands(path):
    lum = Image.open(path).convert("L").load()

    def band(span):
        rows = range(span[0], span[1])
        return sum(sum(lum[x, y] for x in COLS) for y in rows) / (len(COLS) * len(list(rows)))

    return band(SKY), band(GROUND)


def main(argv):
    a_dir, b_dir = argv
    names = sorted(f for f in os.listdir(a_dir) if f.endswith(".png"))
    rows = []
    print(f"{'file':<16}{'skyA':>8}{'skyB':>8}{'dSky':>7}"
          f"{'gndA':>8}{'gndB':>8}{'dGnd':>7}{'hsA':>8}{'hsB':>8}{'dHs':>7}")
    for name in names:
        if not os.path.exists(os.path.join(b_dir, name)):
            continue
        sa, ga = bands(os.path.join(a_dir, name))
        sb, gb = bands(os.path.join(b_dir, name))
        rows.append((sa - ga, sb - gb, sa - sb))
        print(f"{name:<16}{sa:>8.1f}{sb:>8.1f}{sa - sb:>7.1f}"
              f"{ga:>8.1f}{gb:>8.1f}{ga - gb:>7.1f}"
              f"{sa - ga:>8.1f}{sb - gb:>8.1f}{(sa - ga) - (sb - gb):>7.1f}")
    if rows:
        def med(i):
            vals = sorted(r[i] for r in rows)
            return vals[len(vals) // 2]
        print(f"{'MEDIAN':<16}{'':>8}{'':>8}{med(2):>7.1f}{'':>8}{'':>8}{'':>7}"
              f"{med(0):>8.1f}{med(1):>8.1f}{med(0) - med(1):>7.1f}")


if __name__ == "__main__":
    main(sys.argv[1:])
