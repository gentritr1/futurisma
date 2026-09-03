#!/usr/bin/env python3
"""P20.4 round-2: does the layer read on the SHOULDER, and does it read DARK?

  python3 shots/p20.4r2/near-field.py <liveDir> <offDir>

WHY NOT A PLAIN ROW BAND. The obvious near-field census — "the bottom rows of
the frame" — measures the wrong thing twice. The chase camera sits ~3.5 m above
the deck, so frame rows 430-560 are the ground 12-25 m ahead; PAN_SCUD_NEAR's
cards are 26-65 m ahead at any moment and land 60-90 rows HIGHER. And the
player craft fills the bottom centre, so its own edge pixels move a few px
between any two captures and dominate the signed mean (measured: +42 luma at
station 1080 over ~100 px, invariant to the card tint).

THE SHOULDER BAND. Per row of the `?living=0` frame, the road's left and right
edge columns are found from the P18 edge strips — the only strongly chromatic
pixels in a desaturated salt-pan frame: HSV S >= 0.35, V >= 0.25, hue in cyan
(150-215 deg) or orange (15-55 deg). The band is then

    x in [xl - WIDTH, xl - GUTTER]  union  [xr + GUTTER, xr + WIDTH]

over rows ROWS, clipped to columns 0-1100 (the world crop's right edge, which
keeps the HUD out). That is the pan immediately OUTBOARD of the deck, at every
depth the road is visible — exactly where a card at lateral 2-8 m draws, and
nowhere the craft, the road surface or the HUD can reach. GUTTER drops the edge
strip itself so a one-pixel shift of the dashes cannot be read as dust.

Per station:
  changed  pixels in the shoulder band with |dLuma| >= threshold
  dLuma    SIGNED mean of (live - off) over those pixels. The round-2 taste call
           is "near cards read as dust — darker and warmer than the crust, never
           lighter", so a POSITIVE number is a failure however large the count.
  dWarm    signed mean of (R-B)_live - (R-B)_off over the same pixels: positive
           means the layer moved the shoulder toward red, i.e. warmer.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image

COLS = (0, 1100)
ROWS = (330, 558)
GUTTER = 6
# The forward world band: everything below the horizon that is NOT the player
# craft. Rows 300-558 of the 720-line frame is the ground from roughly 15 m out
# to the horizon line; the box removed from it is where the craft and its
# steering wheel sit in every pose. The craft's own edges move a few pixels
# between any two captures and are the single largest signed contributor to a
# naive near-field census (measured: +42 luma over ~100 px at station 1080,
# invariant to the card tint), so they are excluded rather than thresholded out.
FORWARD_ROWS = (300, 558)
CRAFT_BOX = (425, 560, 455, 830)  # y0, y1, x0, x1


def frame(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)


def luma(a):
    return a[:, :, 0] * 0.2126 + a[:, :, 1] * 0.7152 + a[:, :, 2] * 0.0722


def forward_band(shape):
    mask = np.zeros(shape[:2], dtype=bool)
    mask[FORWARD_ROWS[0]:FORWARD_ROWS[1], COLS[0]:COLS[1]] = True
    y0, y1, x0, x1 = CRAFT_BOX
    mask[y0:y1, x0:x1] = False
    return mask


def shoulder_band(off, width):
    a = off / 255.0
    mx, mn = a.max(axis=2), a.min(axis=2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.zeros_like(mx)
    i = mx == r
    h[i] = ((g - b)[i] / d[i]) % 6
    i = (mx == g) & (mx != r)
    h[i] = ((b - r)[i] / d[i]) + 2
    i = (mx == b) & (mx != r) & (mx != g)
    h[i] = ((r - g)[i] / d[i]) + 4
    deg = (h * 60) % 360
    edge = (s >= 0.35) & (mx >= 0.25) & (
        ((deg >= 150) & (deg <= 215)) | ((deg >= 15) & (deg <= 55))
    )
    mask = np.zeros(off.shape[:2], dtype=bool)
    rows = 0
    for y in range(ROWS[0], ROWS[1]):
        cols = np.flatnonzero(edge[y, COLS[0]:COLS[1]])
        if cols.size < 2:
            continue
        rows += 1
        xl, xr = int(cols[0]) + COLS[0], int(cols[-1]) + COLS[0]
        mask[y, max(COLS[0], xl - width):max(COLS[0], xl - GUTTER)] = True
        mask[y, min(COLS[1], xr + GUTTER):min(COLS[1], xr + width)] = True
    return mask, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("live")
    ap.add_argument("off")
    ap.add_argument("--width", type=int, default=120)
    ap.add_argument("--threshold", type=float, default=10.0)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    names = sorted(f for f in os.listdir(args.live) if f.endswith(".png"))
    out = []
    print(
        f"{'file':<16}{'shBand':>8}{'shChg':>7}{'shdLuma':>9}"
        f"{'fwChg':>8}{'fwdLuma':>9}{'fwdWarm':>9}"
    )
    for name in names:
        pb = os.path.join(args.off, name)
        if not os.path.exists(pb):
            continue
        a = frame(os.path.join(args.live, name))
        b = frame(pb)
        mask, _ = shoulder_band(b, args.width)
        band = int(mask.sum())
        dl = luma(a) - luma(b)
        warm = (a[:, :, 0] - a[:, :, 2]) - (b[:, :, 0] - b[:, :, 2])
        moved = np.abs(dl) >= args.threshold
        sel = mask & moved
        n = int(sel.sum())
        mean = float(dl[sel].mean()) if n else 0.0
        fwd = forward_band(a.shape) & moved
        fn = int(fwd.sum())
        fmean = float(dl[fwd].mean()) if fn else 0.0
        fwarm = float(warm[fwd].mean()) if fn else 0.0
        out.append({"file": name, "shoulderBand": band, "shoulderChanged": n,
                    "shoulderDLuma": round(mean, 2), "forwardChanged": fn,
                    "forwardDLuma": round(fmean, 2),
                    "forwardDWarm": round(fwarm, 2)})
        print(f"{name:<16}{band:>8}{n:>7}{mean:>9.2f}{fn:>8}{fmean:>9.2f}{fwarm:>9.2f}")
    if out:
        vals = sorted(r["forwardChanged"] for r in out)
        print(f"{'MEDIAN fwChg':<16}{'':>8}{'':>7}{'':>9}{vals[len(vals) // 2]:>8}")
        worst = max(out, key=lambda r: r["forwardDLuma"])
        print(f"least dark station: {worst['file']} fwdLuma={worst['forwardDLuma']}")
        if args.json:
            with open(args.json, "w") as fh:
                json.dump(out, fh, indent=2)


if __name__ == "__main__":
    main()
