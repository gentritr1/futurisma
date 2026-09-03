#!/usr/bin/env python3
"""P20.8 frame differ (review harness, not part of the shipped game).

Changed-pixel counts and signed luma deltas between two 1280x720 frames, with
an optional band restriction so a claim about one part of the frame is measured
on that part of the frame.

  python3 scripts/visual/frame-diff.py <a.png> <b.png> [--threshold N]
      [--rows T,B] [--cols L,R] [--near-road P] [--json] [--out diff.png]

  --threshold N   per-channel max-abs difference that counts as "changed" (10)
  --rows T,B      restrict to rows [T, B)
  --cols L,R      restrict to columns [L, R)
  --near-road P   restrict to the P pixels either side of the two road edge
                  lines, found per frame as the strongest vertical luma steps
                  in the lower half of the frame (the P20.4 near-band rule)
  --out           write a visualisation of the changed pixels
"""
import json
import sys

import numpy as np
from PIL import Image

WORLD_ROWS = (130, 560)
WORLD_COLS = (0, 1100)


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int16)


def luma(a):
    return 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]


def road_edge_mask(frame, pad):
    """Pixels within `pad` columns of either PAINTED road edge line.

    The first version of this looked for the two strongest vertical luma steps
    and found the CRAFT — it sits dead centre and out-contrasts both kerbs — so
    the "near-road" band was a 240 px stripe down the middle of the frame at
    columns 635 and 643. The kerbs are painted, so find the paint instead: the
    left edge line is cyan and the right is orange, and neither colour occurs
    anywhere else in a Bitterpan frame.

    Each kerb is then fitted as a LINE in (row -> column), because the road runs
    away diagonally and a vertical stripe would leave the band 120 px from the
    kerb near the camera and hundreds of pixels away at the horizon.

    Returns the mask and the two fits, so a caller can see what was measured.
    """
    r = frame[:, :, 0].astype(int)
    g = frame[:, :, 1].astype(int)
    b = frame[:, :, 2].astype(int)
    cyan = (b > r + 30) & (g > r + 20)
    orange = (r > b + 50) & (r > g + 20)

    height, width = frame.shape[:2]
    rows = np.arange(height)
    mask = np.zeros((height, width), dtype=bool)
    fits = {}
    for name, hits in (("left", cyan), ("right", orange)):
        row_index = []
        column = []
        for row in range(height):
            columns = np.nonzero(hits[row])[0]
            if columns.size < 2:
                continue
            row_index.append(row)
            column.append(float(np.median(columns)))
        if len(row_index) < 20:
            fits[name] = None
            continue
        slope, intercept = np.polyfit(np.array(row_index), np.array(column), 1)
        centres = slope * rows + intercept
        fits[name] = {
            "slope": round(float(slope), 4),
            "intercept": round(float(intercept), 1),
            "rows": len(row_index),
        }
        offset = np.arange(width)[None, :] - centres[:, None]
        mask |= np.abs(offset) <= pad
    return mask, fits


def main():
    argv = sys.argv[1:]
    a_path, b_path = argv[0], argv[1]
    threshold = 10
    rows, cols, near_road, out_path = None, None, None, None
    as_json = "--json" in argv
    for i, token in enumerate(argv):
        if token == "--threshold":
            threshold = int(argv[i + 1])
        elif token == "--rows":
            rows = tuple(int(v) for v in argv[i + 1].split(","))
        elif token == "--cols":
            cols = tuple(int(v) for v in argv[i + 1].split(","))
        elif token == "--near-road":
            near_road = int(argv[i + 1])
        elif token == "--out":
            out_path = argv[i + 1]

    a, b = load(a_path), load(b_path)
    if a.shape != b.shape:
        raise SystemExit("frames differ in size: %s vs %s" % (a.shape, b.shape))

    mask = np.zeros(a.shape[:2], dtype=bool)
    r0, r1 = rows or WORLD_ROWS
    c0, c1 = cols or WORLD_COLS
    mask[r0:r1, c0:c1] = True
    edges = None
    if near_road is not None:
        road, edges = road_edge_mask(a, near_road)
        if not any(edges.values()):
            raise SystemExit(
                "no painted road edge found in %s; the near-road band would be "
                "measured on nothing" % a_path)
        mask &= road

    delta = np.abs(a - b).max(axis=2)
    changed = int((delta[mask] >= threshold).sum())
    la, lb = luma(a), luma(b)
    result = {
        "a": a_path,
        "b": b_path,
        "threshold": threshold,
        "maskPixels": int(mask.sum()),
        "changed": changed,
        "changedShare": round(changed / max(1, int(mask.sum())), 5),
        "maxDelta": int(delta[mask].max()) if mask.any() else 0,
        "meanLumaA": round(float(la[mask].mean()), 2) if mask.any() else 0.0,
        "meanLumaB": round(float(lb[mask].mean()), 2) if mask.any() else 0.0,
        "lumaDelta": round(float((lb[mask] - la[mask]).mean()), 2) if mask.any() else 0.0,
    }
    if edges:
        result["roadEdgeFits"] = edges
    if out_path:
        vis = np.zeros(a.shape, dtype=np.uint8)
        vis[:, :, 0] = np.where(mask & (delta >= threshold), 255, 0)
        vis[:, :, 1] = (la * 0.4).astype(np.uint8)
        vis[:, :, 2] = (la * 0.4).astype(np.uint8)
        Image.fromarray(vis).save(out_path)
        result["out"] = out_path

    if as_json:
        print(json.dumps(result))
    else:
        print(" ".join("%s=%s" % (k, v) for k, v in result.items()
                       if k not in ("a", "b")))


if __name__ == "__main__":
    main()
