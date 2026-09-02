#!/usr/bin/env python3
"""Frame metrics for the visual review harness (not part of the shipped game).

Turns "it looks empty" into numbers that two builds can be compared on.
Run on the PNGs produced by scripts/visual/shoot-stations.mjs.

  python3 scripts/visual/frame-metrics.py <dir-or-png> [more...] [--json]

Per frame (1280x720 chase-camera frame; HUD margins excluded):
  flat%     share of world pixels within RGB distance 10 of the frame's modal
            colour (8-bit quantised to 4). High = one wash. The emptiness metric.
  hsplit    mean Rec.709 luma of the sky band minus the ground band, sampled
            off-road (left/right thirds) around the horizon row. Negative or
            near zero = sky and ground are the same value.
  skysat    mean HSV saturation of the sky band, 0-100.
  edges     share of world pixels whose Sobel magnitude exceeds 40 - a crude
            "how much structure is in frame" number. Speed lines inflate it,
            so read it together with flat%.
  midtone   share of world pixels with luma in [70, 170]. A frame that is all
            highlight (pale pan + pale sky) scores low here.

The world crop is rows 130..560 and columns 0..1100 (the HUD lives outside
it). The horizon row is found per frame as the row with the largest mean luma
step between the two 24-row bands above and below it, searched in rows 260..420.
"""
import json
import os
import sys

from PIL import Image, ImageFilter

WORLD = (0, 130, 1100, 560)  # left, top, right, bottom
BAND = 24


def luma(px):
    r, g, b = px
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def analyse(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    world = im.crop(WORLD)
    ww, wh = world.size
    data = list(world.getdata())

    # --- flat%: modal colour at 4-level quantisation, then radius-10 census.
    hist = {}
    for r, g, b in data:
        k = (r >> 2, g >> 2, b >> 2)
        hist[k] = hist.get(k, 0) + 1
    mode = max(hist, key=hist.get)
    mr, mg, mb = (mode[0] << 2) + 2, (mode[1] << 2) + 2, (mode[2] << 2) + 2
    flat = sum(
        1 for r, g, b in data if (r - mr) ** 2 + (g - mg) ** 2 + (b - mb) ** 2 <= 100
    ) / len(data)

    # --- horizon row: biggest luma step, off-road columns only.
    lum = im.convert("L")
    lpx = lum.load()
    cols = list(range(20, 340)) + list(range(940, 1100))

    def band_mean(top):
        total = 0.0
        n = 0
        for y in range(top, top + BAND):
            for x in cols:
                total += lpx[x, y]
                n += 1
        return total / n

    best_row, best_step = 340, -1e9
    for y in range(260, 420, 4):
        step = band_mean(y - BAND) - band_mean(y)
        if abs(step) > abs(best_step):
            best_step, best_row = step, y
    sky_top = best_row - BAND - 8
    ground_top = best_row + 8
    hsplit = band_mean(sky_top) - band_mean(ground_top)

    # --- sky saturation over the sky band.
    hsv = im.convert("HSV").load()
    sat = 0.0
    n = 0
    for y in range(sky_top, sky_top + BAND):
        for x in cols:
            sat += hsv[x, y][1]
            n += 1
    skysat = sat / n / 255 * 100

    # --- edges over the world crop.
    edge = lum.crop(WORLD).filter(ImageFilter.FIND_EDGES)
    epx = list(edge.getdata())
    edges = sum(1 for v in epx if v > 40) / len(epx)

    # --- midtone share.
    mid = sum(1 for r, g, b in data if 70 <= luma((r, g, b)) <= 170) / len(data)

    return {
        "file": os.path.basename(path),
        "flat_pct": round(flat * 100, 1),
        "hsplit": round(hsplit, 1),
        "skysat": round(skysat, 1),
        "edges_pct": round(edges * 100, 2),
        "midtone_pct": round(mid * 100, 1),
        "horizon_row": best_row,
        "mode_rgb": [mr, mg, mb],
    }


def main(argv):
    as_json = "--json" in argv
    paths = []
    for a in argv:
        if a.startswith("--"):
            continue
        if os.path.isdir(a):
            paths += sorted(
                os.path.join(a, f) for f in os.listdir(a) if f.lower().endswith(".png")
            )
        else:
            paths.append(a)
    rows = [analyse(p) for p in paths]
    if as_json:
        print(json.dumps(rows, indent=1))
        return
    print(f"{'file':<16}{'flat%':>7}{'hsplit':>8}{'skysat':>8}{'edges%':>8}{'mid%':>7}  mode")
    for r in rows:
        print(
            f"{r['file']:<16}{r['flat_pct']:>7}{r['hsplit']:>8}{r['skysat']:>8}"
            f"{r['edges_pct']:>8}{r['midtone_pct']:>7}  {r['mode_rgb']}"
        )
    if rows:
        keys = ["flat_pct", "hsplit", "skysat", "edges_pct", "midtone_pct"]
        med = {}
        for k in keys:
            vals = sorted(x[k] for x in rows)
            med[k] = vals[len(vals) // 2]
        print(
            f"{'MEDIAN':<16}{med['flat_pct']:>7}{med['hsplit']:>8}{med['skysat']:>8}"
            f"{med['edges_pct']:>8}{med['midtone_pct']:>7}"
        )


if __name__ == "__main__":
    main(sys.argv[1:])
