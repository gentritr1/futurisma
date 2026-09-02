#!/usr/bin/env python3
"""P20.4 review harness: 4-column contact sheet of a station directory.

  python3 shots/p20.4/contact-sheet.py <dir> <out.png> [label]
"""
import os
import sys

from PIL import Image, ImageDraw

CELL = (640, 360)
COLS = 4


def main(argv):
    src, out = argv[0], argv[1]
    label = argv[2] if len(argv) > 2 else os.path.basename(src)
    names = sorted(f for f in os.listdir(src) if f.endswith(".png"))
    rows = (len(names) + COLS - 1) // COLS
    sheet = Image.new(
        "RGB", (CELL[0] * COLS, CELL[1] * rows + 28), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 8), f"{label}  -  {len(names)} frames", fill=(235, 235, 235))
    for i, name in enumerate(names):
        cell = Image.open(os.path.join(src, name)).convert("RGB").resize(CELL, Image.LANCZOS)
        x = (i % COLS) * CELL[0]
        y = 28 + (i // COLS) * CELL[1]
        sheet.paste(cell, (x, y))
        draw.text((x + 6, y + 6), name.replace(".png", ""), fill=(255, 240, 160))
    sheet.save(out)
    print(f"{out}  {sheet.size[0]}x{sheet.size[1]}  {len(names)} frames")


if __name__ == "__main__":
    main(sys.argv[1:])
