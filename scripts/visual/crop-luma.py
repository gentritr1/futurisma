#!/usr/bin/env python3
"""P20.1 acceptance measurement (review harness, not shipped).

Mean Rec.709 luma of one or more 30x30 px crops of a 1280x720 frame, so a
"shadow is visible here" claim is a number rather than a squint.

  python3 scripts/visual/crop-luma.py <png> <x,y> [<x,y> ...]
  python3 scripts/visual/crop-luma.py --pair <png> <x,y> <x,y>   # prints the delta

Coordinates are the CENTRE of the crop, in image pixels.
"""
import sys

from PIL import Image

SIZE = 30


def luma_at(image, cx, cy, size=SIZE):
    half = size // 2
    crop = image.crop((cx - half, cy - half, cx - half + size, cy - half + size))
    pixels = list(crop.getdata())
    total = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels)
    return total / len(pixels)


def main(argv):
    pair = argv and argv[0] == "--pair"
    if pair:
        argv = argv[1:]
    path = argv[0]
    points = [tuple(int(v) for v in a.split(",")) for a in argv[1:]]
    image = Image.open(path).convert("RGB")
    values = [luma_at(image, x, y) for x, y in points]
    for (x, y), value in zip(points, values):
        print(f"{path} ({x},{y}) {SIZE}x{SIZE} luma {value:.1f}")
    if pair and len(values) == 2:
        print(f"delta (second - first) {values[1] - values[0]:.1f}")


if __name__ == "__main__":
    main(sys.argv[1:])
