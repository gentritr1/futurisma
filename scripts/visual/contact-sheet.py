#!/usr/bin/env python3
"""P20.1 review artefact (review harness, not shipped).

Builds a 4-column contact sheet of 640x360 cells from a station directory, so a
whole map's before/after can be eyeballed in one image.

  python3 scripts/visual/contact-sheet.py <stationDir> <outPng> [label]
"""
import os
import sys

from PIL import Image, ImageDraw

CELL = (640, 360)
COLUMNS = 4
PAD = 6
LABEL = 18


def main(argv):
    src, out = argv[0], argv[1]
    label = argv[2] if len(argv) > 2 else os.path.basename(src.rstrip("/"))
    names = sorted(f for f in os.listdir(src) if f.lower().endswith(".png"))
    rows = (len(names) + COLUMNS - 1) // COLUMNS
    width = COLUMNS * CELL[0] + (COLUMNS + 1) * PAD
    height = rows * (CELL[1] + LABEL) + (rows + 1) * PAD + LABEL + PAD
    sheet = Image.new("RGB", (width, height), (18, 18, 18))
    draw = ImageDraw.Draw(sheet)
    draw.text((PAD, PAD), label, fill=(235, 235, 235))
    for index, name in enumerate(names):
        col, row = index % COLUMNS, index // COLUMNS
        x = PAD + col * (CELL[0] + PAD)
        y = LABEL + PAD * 2 + row * (CELL[1] + LABEL + PAD)
        sheet.paste(Image.open(os.path.join(src, name)).resize(CELL, Image.LANCZOS), (x, y))
        draw.text((x + 2, y + CELL[1] + 2), name, fill=(190, 190, 190))
    sheet.save(out)
    print(f"{out}  {len(names)} frames  {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main(sys.argv[1:])
