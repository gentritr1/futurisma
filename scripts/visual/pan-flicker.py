#!/usr/bin/env python3
"""P20.11 far-pan temporal-stability metric (review harness, not shipped).

  python3 scripts/visual/pan-flicker.py <burstDir> [<burstDir> ...] [--json]

For each pair of CONSECUTIVE frames in a burst (scripts/visual/burst.mjs), the
mean |delta luma| over the FAR PAN band, and the median / max of those pair
values over the burst.

Band and mask, chosen so the number is the pan and only the pan:
  rows 330..352   the 300-700 m range of the chase camera on the long pan
  cols 20..340 and 940..1100
                  off-road at the long-pan burst start (5.4 s), and clear of
                  the HUD leaderboard, which starts at column ~1130. Narrower
                  than pan-macro.py's columns because at ROW 330 the deck is
                  much wider on screen than it is at row 430.
  mask            luma > 112 in BOTH frames of the pair. Same calibrated floor
                  as pan-macro.py: on the `?floorprobe=2` control the band's
                  histogram is bimodal with the deck at 64-96 and the pan at
                  112-176. Requiring both frames keeps a pixel the road edge
                  swept across out of the sample, so what is measured is the
                  pan changing rather than the road arriving.

A flat surface under a translating camera should change slowly. The number this
reports on `?floorprobe=2` - the same binary with the P20.6 floor bypassed - is
the floor of the instrument: fog, tone mapping and the dither. Any build's
number is only meaningful as a RATIO against that control measured on the same
build, so always shoot both.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROWS = (330, 352)
COLUMNS = ((20, 340), (940, 1100))
MASK_FLOOR = 112.0


def luma_of(path):
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    return 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]


def band_of(lum):
    out = np.zeros(lum.shape, dtype=bool)
    for lo, hi in COLUMNS:
        out[ROWS[0]:ROWS[1], lo:hi] = True
    return out


def scan(directory):
    names = sorted(
        (f for f in os.listdir(directory) if f.lower().endswith(".png")),
        key=lambda f: (len(f), f))
    frames = [luma_of(os.path.join(directory, n)) for n in names]
    pairs = []
    for i in range(len(frames) - 1):
        a, b = frames[i], frames[i + 1]
        mask = band_of(a) & (a > MASK_FLOOR) & (b > MASK_FLOOR)
        n = int(mask.sum())
        pairs.append({
            "pair": f"{names[i]}->{names[i + 1]}",
            "pixels": n,
            "meanAbsDelta": float(np.abs(b - a)[mask].mean()) if n else float("nan"),
        })
    values = [p["meanAbsDelta"] for p in pairs]
    return {
        "dir": directory,
        "frames": len(frames),
        "pairs": pairs,
        "median": float(np.median(values)) if values else float("nan"),
        "max": float(np.max(values)) if values else float("nan"),
        "minPixels": min((p["pixels"] for p in pairs), default=0),
    }


def main(argv):
    as_json = "--json" in argv
    dirs = [a for a in argv if not a.startswith("--")]
    results = [scan(d) for d in dirs]
    for r in results:
        print(f"{r['dir']}")
        for p in r["pairs"]:
            print(f"  {p['pair']:<16} |d| {p['meanAbsDelta']:6.2f}  n={p['pixels']}")
        print(f"  frames {r['frames']}  MEDIAN {r['median']:.2f}  MAX {r['max']:.2f}"
              f"  minMaskPixels {r['minPixels']}")
    if as_json:
        print(json.dumps([{k: v for k, v in r.items() if k != "pairs"}
                          for r in results], indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
