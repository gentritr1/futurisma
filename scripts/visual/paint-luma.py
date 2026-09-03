#!/usr/bin/env python3
"""P20.7 item 1 acceptance measurement (review harness, not shipped).

Reads the quads scripts/visual/paint-probe.mjs projected out of the live scene
and measures, per boost pad, IN THE SAME FRAME:

  pad     mean Rec.709 luma inside the pad's top face (inset 12%, so no edge
          pixel is half deck)
  deck    mean luma of a same-length deck quad 1.7-2.7 pad half-widths to the
          side -- the road the pad is painted on, not a fixed crop somewhere
  delta   pad - deck. The P20.7 target is [+18, +55]: paint that is LIGHTER
          than the deck, which is what an airport threshold marking is.
  tones   the two dominant interior luma modes and their separation. A field
          with a chevron on it has two populations; a flat plate has one. The
          target is >= 2 modes >= 18 apart.
  rim     mean luma of the border ring (the 12% band the inset excluded),
          minus the deck. The target is >= -10: a rim darker than that is the
          hard dark outline that made the P20.2 pad read as a sunk plate.
  rimF    the same ring against the pad FIELD rather than the deck. This is the
          number the "reads as a plate" complaint is actually about: a rim can
          sit above the deck and still be a hard dark outline around the
          marking. Target >= -14.
  sat     mean HSV saturation of the pad interior, 0-100, and satD the same for
          the deck. Road paint on a grey deck is a low-chroma mark with a tinted
          core; a saturated slab is a different MATERIAL sitting on the road,
          which is what a "teal plate" is. Target: sat - satD <= 22.

The luma criteria alone do NOT separate paint from plate -- measured: the
pre-P20.7 Bitterpan pad passes every one of them (delta +39..+46, two modes 56
apart, rim +2..+16 over deck) while still reading as a teal plate with a hard
border. rimF and sat are the two that move.

Modes are found on a 4-luma-wide histogram of the interior: every bin holding
at least 6% of the interior pixels is a candidate, adjacent candidates are
merged, and the reported separation is between the two heaviest survivors. A
threshold that low would find noise on a flat surface, so the count is reported
next to the separation -- one mode means one tone, whatever the spread is.

  python3 scripts/visual/paint-luma.py <padsDir> [<padsDir> ...] [--json]
"""
import json
import os
import sys

from PIL import Image, ImageDraw

BIN = 4
MODE_SHARE = 0.06


def luma_image(image):
    """Rec.709 luma as an 8-bit L image, the same weights crop-luma.py uses."""
    return image.convert("L", (0.2126, 0.7152, 0.0722, 0))


def saturation_image(image):
    """HSV saturation as an 8-bit L image."""
    return image.convert("HSV").getchannel("S")


def polygon_mask(size, quad):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon([(p["x"], p["y"]) for p in quad], fill=255)
    return mask


def mask_values(grey, quad, exclude=None):
    """Luma of every pixel inside `quad`, minus any inside `exclude`."""
    inside = polygon_mask(grey.size, quad).getdata()
    if exclude is None:
        return [v for v, m in zip(grey.getdata(), inside) if m]
    cut = polygon_mask(grey.size, exclude).getdata()
    return [v for v, m, c in zip(grey.getdata(), inside, cut) if m and not c]


def modes(values):
    if not values:
        return []
    hist = {}
    for v in values:
        hist[v // BIN] = hist.get(v // BIN, 0) + 1
    floor = len(values) * MODE_SHARE
    heavy = sorted(b for b, n in hist.items() if n >= floor)
    if not heavy:
        return []
    groups = [[heavy[0]]]
    for b in heavy[1:]:
        if b - groups[-1][-1] <= 1:
            groups[-1].append(b)
        else:
            groups.append([b])
    out = []
    for group in groups:
        weight = sum(hist[b] for b in group)
        centre = sum(hist[b] * (b * BIN + BIN / 2) for b in group) / weight
        out.append((centre, weight))
    out.sort(key=lambda t: -t[1])
    return out


def measure(directory):
    pads = json.load(open(os.path.join(directory, "pads.json")))
    rows = []
    for pad in pads:
        image = Image.open(pad["file"]).convert("RGB")
        grey = luma_image(image)
        sat = saturation_image(image)
        interior = mask_values(grey, pad["inner"])
        deck = mask_values(grey, pad["deck"])
        rim = mask_values(grey, pad["full"], exclude=pad["inner"])
        interior_sat = mask_values(sat, pad["inner"])
        deck_sat = mask_values(sat, pad["deck"])
        if not interior or not deck:
            continue
        pad_mean = sum(interior) / len(interior)
        deck_mean = sum(deck) / len(deck)
        rim_mean = sum(rim) / len(rim) if rim else float("nan")
        found = modes(interior)
        separation = abs(found[0][0] - found[1][0]) if len(found) >= 2 else 0.0
        rows.append({
            "dir": directory,
            "pad": pad["index"],
            "d": pad.get("d"),
            "distM": round(pad["dist"], 1),
            "areaPx": round(pad["areaPx"]),
            "padPx": len(interior),
            "deckPx": len(deck),
            "padLuma": round(pad_mean, 1),
            "deckLuma": round(deck_mean, 1),
            "delta": round(pad_mean - deck_mean, 1),
            "modes": [round(c, 1) for c, _ in found],
            "modeCount": len(found),
            "modeSep": round(separation, 1),
            "rimLuma": round(rim_mean, 1),
            "rimVsDeck": round(rim_mean - deck_mean, 1),
            "rimVsField": round(rim_mean - pad_mean, 1),
            "sat": round(sum(interior_sat) / len(interior_sat) * 100 / 255, 1),
            "deckSat": round(sum(deck_sat) / len(deck_sat) * 100 / 255, 1),
            "satVsDeck": round(
                (sum(interior_sat) / len(interior_sat)
                 - sum(deck_sat) / len(deck_sat)) * 100 / 255, 1),
        })
    return rows


def main(argv):
    as_json = "--json" in argv
    dirs = [a for a in argv if a != "--json"]
    rows = []
    for directory in dirs:
        rows.extend(measure(directory))
    if as_json:
        print(json.dumps(rows, indent=1))
        return
    print(f"{'dir':26} {'pad':>3} {'dist':>6} {'padPx':>7} {'pad':>6} {'deck':>6} "
          f"{'delta':>6} {'md':>3} {'sep':>5} {'rim-dk':>7} {'rim-fld':>8} "
          f"{'sat':>5} {'satD':>5} {'sat-D':>6}")
    for r in rows:
        print(f"{r['dir'][-26:]:26} {r['pad']:>3} {r['distM']:>6} {r['padPx']:>7} "
              f"{r['padLuma']:>6} {r['deckLuma']:>6} {r['delta']:>+6} "
              f"{r['modeCount']:>3} {r['modeSep']:>5} {r['rimVsDeck']:>+7} "
              f"{r['rimVsField']:>+8} {r['sat']:>5} {r['deckSat']:>5} "
              f"{r['satVsDeck']:>+6}")


if __name__ == "__main__":
    main(sys.argv[1:])
