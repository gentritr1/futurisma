#!/usr/bin/env python3
"""P20.4 round-2 review harness (not part of the shipped game).

The eyeball gate: a full-resolution A/B of one pinned pose, layer on above,
layer off below, with the world crop's own bounds drawn so the reviewer is
looking at the same rectangle the pixel census counted. No scaling, no
enhancement — a scaled contact sheet is the wrong instrument for a change whose
whole question is whether a low-contrast smear is there at all.

  python3 shots/p20.4r2/ab-crop.py <liveDir> <offDir> <station> <out.png>
"""
import sys

from PIL import Image, ImageDraw

BAR = 8


def main(argv):
    live, off, station, out = argv[0], argv[1], argv[2], argv[3]
    name = f"px-{int(station):04d}.png"
    a = Image.open(f"{live}/{name}").convert("RGB")
    b = Image.open(f"{off}/{name}").convert("RGB")
    w, h = a.size
    sheet = Image.new("RGB", (w, h * 2 + BAR), (190, 40, 40))
    sheet.paste(a, (0, 0))
    sheet.paste(b, (0, h + BAR))
    draw = ImageDraw.Draw(sheet)
    draw.text((10, 10), f"station {station} — LIVING WORLD ON", fill=(255, 240, 160))
    draw.text((10, h + BAR + 10), f"station {station} — ?living=0", fill=(255, 240, 160))
    sheet.save(out)
    print(f"{out}  {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main(sys.argv[1:])
