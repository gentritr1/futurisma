#!/usr/bin/env python3
"""P20.4 round-2 review harness (not part of the shipped game).

How much SCREEN AREA a zone occupies, independent of its tint and envelope.

Round 1's honest read — "the cards are placed and moving correctly but are
invisible" — has two possible causes that a tint sweep cannot tell apart: the
cards are big and too faint, or they are faint AND tiny. This measures the
second directly. Run against a build whose zone is temporarily forced to flat
magenta at vertex alpha 1.0; every pixel the zone can ever influence is then a
pixel whose red and blue rise and whose green falls against the `?living=0`
frame, so the count is the zone's reachable area rather than its current look.

  python3 shots/p20.4r2/garish-area.py <garishDir> <offDir>
"""
import os
import sys

import numpy as np
from PIL import Image


def main(argv):
    live, off = argv[0], argv[1]
    print(f"{'file':<16}{'magenta':>10}{'rows':>18}{'cols':>18}")
    for name in sorted(f for f in os.listdir(live) if f.endswith(".png")):
        pb = os.path.join(off, name)
        if not os.path.exists(pb):
            continue
        a = np.asarray(Image.open(os.path.join(live, name)).convert("RGB"), dtype=np.int32)
        b = np.asarray(Image.open(pb).convert("RGB"), dtype=np.int32)
        d = a - b
        m = (d[:, :, 0] > 12) & (d[:, :, 2] > 12) & (d[:, :, 1] < 6)
        n = int(m.sum())
        if n:
            ys, xs = np.nonzero(m)
            rows = f"{ys.min()}-{ys.max()}"
            cols = f"{xs.min()}-{xs.max()}"
        else:
            rows = cols = "-"
        print(f"{name:<16}{n:>10}{rows:>18}{cols:>18}")


if __name__ == "__main__":
    main(sys.argv[1:])
