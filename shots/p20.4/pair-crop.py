#!/usr/bin/env python3
"""P20.4 review harness: full-res A/B crop of one region, layer on over layer off.

  python3 shots/p20.4/pair-crop.py <liveA.png> <offB.png> <x0,y0,x1,y1> <out.png> <title>

The two frames must be the same pose (shoot-pinned.mjs holds the craft in the
countdown at a probe distance, so they are). Crops are 1:1 pixels — no resize —
because the point is what the layer actually puts on screen.
"""
import sys

from PIL import Image, ImageDraw


def main(argv):
    a = Image.open(argv[0]).convert("RGB")
    b = Image.open(argv[1]).convert("RGB")
    box = tuple(int(v) for v in argv[2].split(","))
    ca, cb = a.crop(box), b.crop(box)
    w, h = ca.size
    out = Image.new("RGB", (w, h * 2 + 44), (18, 18, 20))
    draw = ImageDraw.Draw(out)
    draw.text((8, 6), argv[4], fill=(235, 235, 235))
    out.paste(ca, (0, 22))
    draw.text((8, h + 26), "same pose, ?living=0", fill=(235, 235, 235))
    out.paste(cb, (0, h + 42))
    out.save(argv[3])
    print(f"{argv[3]}  {out.size[0]}x{out.size[1]}  crop {box}")


if __name__ == "__main__":
    main(sys.argv[1:])
