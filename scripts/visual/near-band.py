#!/usr/bin/env python3
"""P20.8 near-band census (review harness, not part of the shipped game).

The P20.4 acceptance number, re-measured: how many pixels within 120 px of the
road edge lines change when the living-world layer is switched off at a pinned
pose. Floor is 1500 per station.

It is reported TWICE, and the split matters. The literal criterion masks on
distance to the kerb line only, and the two kerb lines CONVERGE at the vanishing
point — so the band sweeps up through the horizon row and counts the mesa line
and the haze bands, which are not near-field cards at all. The `ground` figure
adds a row window below the horizon, which is the near field the criterion was
written to measure. Read the second one.

  python3 scripts/visual/near-band.py <noliveDir> <liveDir> <d1,d2,...>
      [--rows T,B] [--pad N]
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "frame_diff", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "frame-diff.py"))
_fd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fd)

THRESHOLD = 10
GROUND_ROWS = (300, 620)


def main():
    nolive, live = sys.argv[1], sys.argv[2]
    distances = [int(v) for v in sys.argv[3].split(",")]
    pad = 120
    ground = GROUND_ROWS
    if "--pad" in sys.argv:
        pad = int(sys.argv[sys.argv.index("--pad") + 1])
    if "--rows" in sys.argv:
        ground = tuple(int(v) for v in sys.argv[sys.argv.index("--rows") + 1].split(","))
    print("%-8s %6s %9s %9s %9s %9s %9s"
          % ("station", "frames", "wholeMin", "wholeMax", "grndMin",
             "grndMean", "grndMax"))
    for distance in distances:
        base = "pose-%04d" % distance
        a = np.asarray(Image.open(os.path.join(nolive, base + ".png"))
                       .convert("RGB")).astype(np.int16)
        road, fits = _fd.road_edge_mask(a, pad)
        assert any(fits.values()), "no painted kerb found at %d" % distance
        whole = road.copy()
        whole[:130, :] = False
        grnd = road.copy()
        grnd[:ground[0], :] = False
        grnd[ground[1]:, :] = False
        # Every frame of the burst at this pose: the camera is pinned, so these
        # differ only in where the card clock had got to.
        frames = sorted(f for f in os.listdir(live)
                        if f.startswith(base) and f.endswith(".png"))
        wholes, grnds = [], []
        for frame in frames:
            b = np.asarray(Image.open(os.path.join(live, frame))
                           .convert("RGB")).astype(np.int16)
            delta = np.abs(a - b).max(axis=2)
            wholes.append(int((delta[whole] >= THRESHOLD).sum()))
            grnds.append(int((delta[grnd] >= THRESHOLD).sum()))
        print("%-8d %6d %9d %9d %9d %9d %9d"
              % (distance, len(frames), min(wholes), max(wholes),
                 min(grnds), int(sum(grnds) / len(grnds)), max(grnds)))


if __name__ == "__main__":
    main()
