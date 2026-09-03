#!/usr/bin/env python3
"""P20.8 review harness (not shipped).

Renders one card sheet as a labelled grid over a mid-grey ground, so the cells
can be eyeballed by NAME. The grid is drawn in PNG-row order (slot 0 top-left),
which is the order `atlasRect` addresses and therefore the order a fixed build
draws.

  python3 scripts/visual/atlas-sheet.py <sheet> <out.png>
"""
import importlib.util
import sys

from PIL import Image, ImageDraw

_spec = importlib.util.spec_from_file_location(
    "atlas_cells", "scripts/visual/atlas-cells.py")
_cells = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cells)
NAMES, SHEETS = _cells.NAMES, _cells.SHEETS

ROOT = "public/assets/greenwater/textures/"
TILE = 192
PAD = 4
LABEL = 16


def main():
    sheet, out = sys.argv[1], sys.argv[2]
    name, size, cols = SHEETS[sheet]
    im = Image.open(ROOT + name + ".png").convert("RGBA")
    step = size // cols
    width = cols * TILE + (cols + 1) * PAD
    height = cols * (TILE + LABEL) + (cols + 1) * PAD + LABEL + PAD
    out_im = Image.new("RGB", (width, height), (24, 24, 24))
    draw = ImageDraw.Draw(out_im)
    draw.text((PAD, PAD), "%s  (slot 0 = top-left, PNG row order)" % name,
              fill=(235, 235, 235))
    for slot in range(cols * cols):
        r, c = divmod(slot, cols)
        x = PAD + c * (TILE + PAD)
        y = LABEL + PAD + PAD + r * (TILE + LABEL + PAD)
        cell = im.crop(((slot % cols) * step, (slot // cols) * step,
                        (slot % cols) * step + step,
                        (slot // cols) * step + step))
        cell = cell.resize((TILE, TILE), Image.NEAREST)
        ground = Image.new("RGB", (TILE, TILE), (96, 96, 104))
        ground.paste(cell, (0, 0), cell)
        out_im.paste(ground, (x, y))
        draw.text((x, y + TILE + 2), "%d %s" % (slot, NAMES[sheet][slot]),
                  fill=(220, 220, 160))
    out_im.save(out)
    print("%s -> %s" % (sheet, out))


if __name__ == "__main__":
    main()
