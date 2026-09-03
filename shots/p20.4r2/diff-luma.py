#!/usr/bin/env python3
"""P20.4 round-2 acceptance measurement.

Counts, per station, the pixels whose Rec.709 luma moves by >= --threshold
between two matched, POSE-PINNED frames, over the world crop the frame metrics
use (rows 130-560, cols 0-1100 — the HUD sits outside it).

  python3 shots/p20.4r2/diff-luma.py <dirA> <dirB> [--edge] [--threshold N]

Two censuses are printed:

  changed   every pixel in the crop with |dLuma| >= threshold.
  nearEdge  the subset of those pixels lying within --radius px of a road edge
            pixel, i.e. the NEAR band rather than the horizon.

EDGE BAND METHOD (--edge). The Bitterpan deck is bounded by the P18 edge strips,
which are the only strongly chromatic things in the frame: cyan dashes on one
side, orange on the other, over a desaturated salt pan. The mask is built from
the SECOND directory (dirB, the `?living=0` side), so the layer under test can
never widen its own target:

  1. HSV. An edge pixel is S >= 0.35, V >= 0.25, hue in cyan (150-215 deg) or
     orange (15-55 deg).
  2. Only crop rows corresponding to frame rows 300-560 — below the horizon,
     where the deck edge is. This drops the sky, the horizon silhouettes and the
     distant signage from the mask.
  3. Per row, the min and max edge column: the left and right edge of the road
     in that pose. Rows with fewer than 2 edge pixels contribute nothing.
  4. The band is every pixel within --radius px (Chebyshev) of one of those
     points, i.e. a square dilation of the two polylines.

Chebyshev rather than Euclidean because the band is a coarse "is this pixel near
the road" test; the square kernel is a strict superset of the disc, so it never
UNDER-counts road-adjacent pixels. The same measurement is run on the control
pair, where the same over-counting applies, so the comparison stays honest.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image

WORLD = (0, 130, 1100, 560)
EDGE_ROWS = (300, 560)


def rgb(path):
    return np.asarray(
        Image.open(path).convert("RGB").crop(WORLD), dtype=np.float32
    )


def luma(arr):
    return arr[:, :, 0] * 0.2126 + arr[:, :, 1] * 0.7152 + arr[:, :, 2] * 0.0722


def edge_mask(path, radius):
    arr = rgb(path) / 255.0
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    # Hue in degrees (standard HSV formula, vectorised).
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.zeros_like(mx)
    i = mx == r
    h[i] = ((g - b)[i] / d[i]) % 6
    i = mx == g
    h[i] = ((b - r)[i] / d[i]) + 2
    i = (mx == b) & (mx != r) & (mx != g)
    h[i] = ((r - g)[i] / d[i]) + 4
    deg = (h * 60) % 360

    chroma = (s >= 0.35) & (v >= 0.25)
    hue_ok = ((deg >= 150) & (deg <= 215)) | ((deg >= 15) & (deg <= 55))
    edge = chroma & hue_ok
    # Restrict to the deck rows.
    lo, hi = EDGE_ROWS[0] - WORLD[1], EDGE_ROWS[1] - WORLD[1]
    edge[:lo, :] = False
    edge[hi:, :] = False

    h_px, w_px = edge.shape
    seed = np.zeros_like(edge)
    found = 0
    for y in range(h_px):
        cols = np.flatnonzero(edge[y])
        if cols.size < 2:
            continue
        found += 1
        seed[y, cols[0]] = True
        seed[y, cols[-1]] = True

    # Separable square dilation by `radius`.
    band = seed.copy()
    acc = band.copy()
    for shift in range(1, radius + 1):
        acc[:, shift:] |= band[:, : w_px - shift]
        acc[:, : w_px - shift] |= band[:, shift:]
    band = acc.copy()
    acc = band.copy()
    for shift in range(1, radius + 1):
        acc[shift:, :] |= band[: h_px - shift, :]
        acc[: h_px - shift, :] |= band[shift:, :]
    return acc, found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir_a")
    ap.add_argument("dir_b")
    ap.add_argument("--edge", action="store_true")
    ap.add_argument("--threshold", type=float, default=10.0)
    ap.add_argument("--radius", type=int, default=120)
    ap.add_argument("--tight", type=int, default=40)
    ap.add_argument("--floor", type=int, default=6000)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    names = sorted(f for f in os.listdir(args.dir_a) if f.endswith(".png"))
    out = []
    print(
        f"{'file':<16}{'changed':>10}{'nearEdge':>10}{'tight':>9}"
        f"{'dLuma':>10}{'rows':>7}  bbox"
    )
    for name in names:
        pb = os.path.join(args.dir_b, name)
        if not os.path.exists(pb):
            continue
        la = luma(rgb(os.path.join(args.dir_a, name)))
        lb = luma(rgb(pb))
        delta = np.abs(la - lb) >= args.threshold
        changed = int(delta.sum())
        near = 0
        tight = 0
        rows_found = 0
        signed = 0.0
        if args.edge:
            band, rows_found = edge_mask(pb, args.radius)
            near = int((delta & band).sum())
            tband, _ = edge_mask(pb, args.tight)
            sel = delta & tband
            tight = int(sel.sum())
            if tight:
                # SIGNED mean, live minus off, over the tight near-road band.
                # The taste call this phase is measured against is "dust, never
                # lighter than the crust", so the SIGN is the acceptance, not
                # the magnitude.
                signed = float((la - lb)[sel].mean())
        ys, xs = np.nonzero(delta)
        box = (
            (int(xs.min()), int(ys.min()) + WORLD[1], int(xs.max()), int(ys.max()) + WORLD[1])
            if changed
            else None
        )
        out.append(
            {"file": name, "changed": changed, "nearEdge": near, "tight": tight,
             "signedLuma": round(signed, 2), "edgeRows": rows_found, "bbox": box}
        )
        print(
            f"{name:<16}{changed:>10}{near:>10}{tight:>9}{signed:>10.2f}"
            f"{rows_found:>7}  {box}"
        )
    if out:
        vals = sorted(r["changed"] for r in out)
        print(f"{'MEDIAN':<16}{vals[len(vals) // 2]:>10}")
        print(f"{'MIN':<16}{vals[0]:>10}")
        print(f"{'MAX':<16}{vals[-1]:>10}")
        ge = sum(1 for v in vals if v >= args.floor)
        print(f"stations with changed >= {args.floor}: {ge}/{len(vals)}")
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(out, fh, indent=2)


if __name__ == "__main__":
    main()
