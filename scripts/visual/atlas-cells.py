#!/usr/bin/env python3
"""P20.8 review harness (not shipped).

Per-cell statistics and row alpha profiles for the three living-world card
sheets, read straight from the PNG in TOP-ORIGIN (PNG row) order. This is the
B side of the rendered-pixel proof: `atlasRect` addresses cells in these
coordinates, so a card that draws the cell it names must match the profile
printed here for that slot and must NOT match the profile of the mirrored slot.

  python3 scripts/visual/atlas-cells.py stats            # all sheets, all cells
  python3 scripts/visual/atlas-cells.py profile <sheet> <slot> [bands]
  python3 scripts/visual/atlas-cells.py crop <sheet> <slot> <out.png> [scale]
"""
import sys

import numpy as np
from PIL import Image

SHEETS = {
    "motion": ("greenwater_motion_512", 512, 2),
    "motionB": ("greenwater_motion_b_512", 512, 4),
    "horizon": ("futurisma_horizon_1024", 1024, 4),
}
NAMES = {
    "motion": ["MIST", "STEAM", "RAIN", "GLINT"],
    "motionB": [
        "BIRDS_A", "BIRDS_B", "BIRDS_C", "GULL",
        "DEVIL_WISP_A", "DEVIL_WISP_B", "FLICKER_FULL", "FLICKER_HALF",
        "FLICKER_DEAD", "WRECK_FUSELAGE", "WRECK_TAILFIN", "WRECK_NACELLE",
        "WRECK_GANTRY", "DUST_SCUD", "VAPOR_THIN", "CRATE_STACK",
    ],
    "horizon": [
        "TREELINE_DENSE", "TREELINE_BROKEN", "TREELINE_SNAG", "PYLON_RUN",
        "GANTRY_FAR", "HANGAR_MASS", "SILO_PAIR", "TANK_FARM_FAR",
        "STACK_CLUSTER", "STACK_SINGLE", "PLANT_MASS", "RIG_FAR",
        "MESA_LONG", "MESA_BLUFF", "SHIMMER_BAND", "HAZE_BAND",
    ],
}
ROOT = "public/assets/greenwater/textures/"


def load(sheet):
    name, size, cols = SHEETS[sheet]
    im = Image.open(ROOT + name + ".png").convert("RGBA")
    assert im.size == (size, size), im.size
    return np.asarray(im).astype(np.float64) / 255.0, size, cols


def cell(sheet, slot):
    """Cell pixels in PNG row order (row 0 = top of the sheet)."""
    data, size, cols = load(sheet)
    step = size // cols
    x = (slot % cols) * step
    y = (slot // cols) * step
    return data[y:y + step, x:x + step]


def profile(sheet, slot, bands=8):
    """Mean alpha per horizontal band, TOP band first."""
    px = cell(sheet, slot)
    rows = px.shape[0]
    per = rows // bands
    return [float(px[b * per:(b + 1) * per, :, 3].mean()) for b in range(bands)]


def stats(sheet, slot):
    px = cell(sheet, slot)
    a = px[:, :, 3]
    lit = a > 0.02
    rgb = px[:, :, :3]
    luma = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    return {
        "coverage": float(lit.mean()),
        "meanAlpha": float(a.mean()),
        "overHalf": float((a > 0.5).mean()),
        "meanLuma": float(luma[lit].mean()) if lit.any() else 0.0,
        "topHeavy": float(a[:a.shape[0] // 2].mean() - a[a.shape[0] // 2:].mean()),
    }


def mirror(sheet, slot):
    _, _, cols = SHEETS[sheet]
    rows = cols
    r, c = divmod(slot, cols)
    return (rows - 1 - r) * cols + c


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "stats"
    if mode == "stats":
        for sheet in SHEETS:
            print("== %s (%s) ==" % (sheet, SHEETS[sheet][0]))
            print("%4s %-16s %7s %7s %7s %6s %7s  mirrorOf"
                  % ("slot", "name", "cover", "meanA", ">0.5", "luma", "topHvy"))
            for slot, name in enumerate(NAMES[sheet]):
                s = stats(sheet, slot)
                m = mirror(sheet, slot)
                print("%4d %-16s %7.3f %7.3f %7.3f %6.3f %+7.3f  %d %s"
                      % (slot, name, s["coverage"], s["meanAlpha"],
                         s["overHalf"], s["meanLuma"], s["topHeavy"],
                         m, NAMES[sheet][m]))
            print()
    elif mode == "profile":
        sheet, slot = sys.argv[2], int(sys.argv[3])
        bands = int(sys.argv[4]) if len(sys.argv) > 4 else 8
        p = profile(sheet, slot, bands)
        print("%s slot %d %s (top band first): %s"
              % (sheet, slot, NAMES[sheet][slot],
                 " ".join("%.4f" % v for v in p)))
    elif mode == "crop":
        sheet, slot, out = sys.argv[2], int(sys.argv[3]), sys.argv[4]
        scale = int(sys.argv[5]) if len(sys.argv) > 5 else 1
        name, size, cols = SHEETS[sheet]
        im = Image.open(ROOT + name + ".png").convert("RGBA")
        step = size // cols
        x, y = (slot % cols) * step, (slot // cols) * step
        crop = im.crop((x, y, x + step, y + step))
        if scale != 1:
            crop = crop.resize((step * scale, step * scale), Image.NEAREST)
        crop.save(out)
        print("%s slot %d %s -> %s" % (sheet, slot, NAMES[sheet][slot], out))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
