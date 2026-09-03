#!/usr/bin/env python3
"""P20.6 acceptance measurement (review harness, not shipped).

Measures MACRO variation on the Bitterpan pan floor, station by station, so
"the ground reads as one wash" is a number two builds can be compared on.

  python3 scripts/visual/pan-macro.py <beforeDir> <afterDir> [--json]
  python3 scripts/visual/pan-macro.py <dir>                  # single build

Per 1280x720 station frame:

  macroStd  stdev of a 9x9 box-blurred Rec.709 luma over the PAN BAND.
            The blur is the whole point: it removes the 256 px crust tile's
            crack texture (a few px on screen at these distances) and leaves
            only variation at the 10s-of-metres scale, which is what "the
            ground has no distance cue" is about. Criterion 1.
  mean      mean luma of the same band. Criterion 2 - this is a variation
            phase, not a re-grade, so this must not move.
  hiEnergy  mean |luma - 3x3 box blur| over the FAR band (rows 330-350).
            A sparkling/aliasing far pan raises it. Criterion 4.

Bands and masks:
  PAN BAND    rows 340..430 (the 40-300 m range of the chase camera on the
              pan), columns 20..470 and 860..1120. Those two column ranges are
              off-road at every one of the 13 Bitterpan stations (the deck
              never reaches column 470 above row 430) and clear of the HUD
              leaderboard, which starts at column ~1130.
  FAR BAND    rows 330..350, same columns.
  MASK        pixels with luma < 60 are dropped - rigs, gantries, barrier
              posts and cast shadows are props, not pan, and their edges would
              dominate any variation number. The blur itself is a NORMALISED
              convolution over unmasked pixels only, so a prop silhouette does
              not bleed a false gradient into the pan beside it.

Nothing here is tuned to a target: the bands, the mask and the blur are fixed
before the floor was touched, and the same script is run on both builds.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

PAN_ROWS = (340, 430)
FAR_ROWS = (330, 350)
COLUMNS = ((20, 470), (860, 1120))
MASK_FLOOR = 60.0
BLUR = 9
HIGHPASS_BLUR = 3


def luma_of(path):
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    return 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]


def box(values, size):
    """Separable box mean with edge clamping."""
    half = size // 2
    padded = np.pad(values, half, mode="edge")
    out = np.zeros_like(values)
    cumulative = np.cumsum(padded, axis=0)
    cumulative = np.vstack([np.zeros((1, padded.shape[1])), cumulative])
    rows = (cumulative[size:, :] - cumulative[:-size, :]) / size
    cumulative = np.cumsum(rows, axis=1)
    cumulative = np.hstack([np.zeros((rows.shape[0], 1)), cumulative])
    out[:, :] = (cumulative[:, size:] - cumulative[:, :-size]) / size
    return out


def normalised_box(values, valid, size):
    """Box blur that only averages over `valid` pixels (0 elsewhere)."""
    numerator = box(np.where(valid, values, 0.0), size)
    denominator = box(valid.astype(np.float64), size)
    safe = denominator > 1e-6
    out = np.zeros_like(values)
    out[safe] = numerator[safe] / denominator[safe]
    return out, safe


def column_mask(width):
    mask = np.zeros(width, dtype=bool)
    for lo, hi in COLUMNS:
        mask[lo:hi] = True
    return mask


def analyse(path):
    lum = luma_of(path)
    height, width = lum.shape
    cols = column_mask(width)

    valid = lum >= MASK_FLOOR
    blurred, blur_ok = normalised_box(lum, valid, BLUR)

    band = np.zeros_like(valid)
    band[PAN_ROWS[0]:PAN_ROWS[1], :] = True
    band &= cols[None, :]
    sample = band & valid & blur_ok

    far = np.zeros_like(valid)
    far[FAR_ROWS[0]:FAR_ROWS[1], :] = True
    far &= cols[None, :]
    far_sample = far & valid
    high = np.abs(lum - box(lum, HIGHPASS_BLUR))

    return {
        "file": os.path.basename(path),
        "pixels": int(sample.sum()),
        "macroStd": float(blurred[sample].std()),
        "mean": float(lum[sample].mean()),
        "farPixels": int(far_sample.sum()),
        "hiEnergy": float(high[far_sample].mean()),
    }


def scan(directory):
    names = sorted(f for f in os.listdir(directory) if f.lower().endswith(".png"))
    return {n: analyse(os.path.join(directory, n)) for n in names}


def main(argv):
    as_json = "--json" in argv
    argv = [a for a in argv if a != "--json"]
    before = scan(argv[0])
    after = scan(argv[1]) if len(argv) > 1 else None

    if after is None:
        for name, row in before.items():
            print(f"{name}  macroStd {row['macroStd']:6.2f}  mean {row['mean']:6.1f}  "
                  f"hiEnergy {row['hiEnergy']:5.2f}  n={row['pixels']}")
        med = float(np.median([r["macroStd"] for r in before.values()]))
        print(f"median macroStd {med:.2f}")
        return

    shared = [n for n in after if n in before]
    print(f"{'station':<12}{'macroStd base':>14}{'after':>9}{'x':>7}"
          f"{'mean base':>11}{'after':>8}{'d':>7}{'hiE base':>10}{'after':>8}")
    for name in shared:
        b, a = before[name], after[name]
        ratio = a["macroStd"] / b["macroStd"] if b["macroStd"] else float("inf")
        print(f"{name:<12}{b['macroStd']:>14.2f}{a['macroStd']:>9.2f}{ratio:>7.2f}"
              f"{b['mean']:>11.1f}{a['mean']:>8.1f}{a['mean'] - b['mean']:>7.1f}"
              f"{b['hiEnergy']:>10.2f}{a['hiEnergy']:>8.2f}")
    base_med = float(np.median([before[n]["macroStd"] for n in shared]))
    after_med = float(np.median([after[n]["macroStd"] for n in shared]))
    print(f"\nmedian macroStd  base {base_med:.2f}  after {after_med:.2f}  "
          f"ratio {after_med / base_med:.2f}x  (criterion 1 needs >= 2.20x)")
    worst = max(shared, key=lambda n: abs(after[n]["mean"] - before[n]["mean"]))
    print(f"worst mean drift {after[worst]['mean'] - before[worst]['mean']:+.1f} "
          f"at {worst}  (criterion 2 needs |d| <= 6.0)")
    over = [n for n in shared if after[n]["hiEnergy"] > before[n]["hiEnergy"]]
    print(f"far-band hiEnergy above base at {len(over)}/{len(shared)} stations"
          f"  (criterion 4 needs <= base)")
    if over:
        print("  " + ", ".join(f"{n} {before[n]['hiEnergy']:.2f}->{after[n]['hiEnergy']:.2f}"
                               for n in over))
    if as_json:
        print(json.dumps({"before": before, "after": after}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
