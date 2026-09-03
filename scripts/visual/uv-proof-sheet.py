#!/usr/bin/env python3
"""P20.8 UV proof contact sheet (review harness, not part of the shipped game).

Lays the three uv-proof.mjs outputs out as one acceptance image: what the card
RENDERED, the cell it NAMES decoded straight from the PNG, and the cell the
pre-P20.8 convention drew in its place, with the band profiles printed under
each row.

  python3 scripts/visual/uv-proof-sheet.py <uvDir> <out.png> [label]
"""
import json
import os
import sys

from PIL import Image, ImageDraw

TILE = 200
PAD = 8
LABEL = 14


def main():
    src, out = sys.argv[1], sys.argv[2]
    label = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(src)
    report = json.load(open(os.path.join(src, "uv-proof.json")))
    rows = len(report)
    width = 3 * TILE + 4 * PAD + 40
    height = LABEL * 2 + PAD + rows * (TILE + LABEL * 4 + PAD) + PAD
    sheet = Image.new("RGB", (width, height), (22, 22, 22))
    draw = ImageDraw.Draw(sheet)
    draw.text((PAD, 4), "%s — rendered card vs the PNG cell it names vs the "
              "cell the pre-P20.8 flipY defect drew" % label, fill=(240, 240, 240))
    y = LABEL * 2
    for entry in report:
        for column, (tag, key) in enumerate(
                (("RENDERED", "rendered"), ("NAMED %s" % entry["namedCell"], "named"),
                 ("WAS %s" % entry["mirrorCell"], "mirrored"))):
            path = os.path.join(src, "%s-%s.png" % (entry["sheet"], key))
            tile = Image.open(path).convert("RGBA").resize(
                (TILE, TILE), Image.NEAREST)
            ground = Image.new("RGB", (TILE, TILE), (96, 96, 104))
            ground.paste(tile, (0, 0), tile)
            x = PAD + column * (TILE + PAD)
            sheet.paste(ground, (x, y))
            draw.text((x + 2, y + TILE + 2), tag, fill=(220, 220, 160))
        text_y = y + TILE + LABEL + 2
        draw.text((PAD, text_y), "%s / %s   verdict %s"
                  % (entry["sheet"], entry["zone"], entry["verdict"]),
                  fill=(235, 235, 235))
        draw.text((PAD, text_y + LABEL),
                  "rendered %s" % " ".join("%.3f" % v for v in entry["renderedProfile"]),
                  fill=(180, 220, 255))
        draw.text((PAD, text_y + LABEL * 2),
                  "named    %s   MAD %.5f   |   MAD vs mirrored-and-flipped %.5f"
                  % (" ".join("%.3f" % v for v in entry["namedProfile"]),
                     entry["madVsNamed"], entry["madVsMirrorFlipped"]),
                  fill=(200, 255, 200))
        y += TILE + LABEL * 4 + PAD
    sheet.save(out)
    print("%d sheets -> %s" % (rows, out))


if __name__ == "__main__":
    main()
