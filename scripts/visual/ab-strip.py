#!/usr/bin/env python3
"""P20.8 A/B strip builder (review harness, not part of the shipped game).

Stacks the same crop of a BEFORE and an AFTER pinned-pose frame, labelled, so a
zone family can be judged by eye on one image instead of by flipping between
two. Optionally scales the crop up, because a horizon band is thirty rows tall
and a reviewer should not have to squint at it.

  python3 scripts/visual/ab-strip.py <beforeDir> <afterDir> <out.png>
      --crop L,T,R,B [--scale N] [--poses d1,d2,...] [--label TEXT]
"""
import os
import sys

from PIL import Image, ImageDraw

PAD = 6
LABEL = 15


def main():
    argv = sys.argv[1:]
    before_dir, after_dir, out = argv[0], argv[1], argv[2]
    crop = (0, 200, 1280, 320)
    scale = 1
    poses = None
    label = ""
    for index, token in enumerate(argv):
        if token == "--crop":
            crop = tuple(int(v) for v in argv[index + 1].split(","))
        elif token == "--scale":
            scale = int(argv[index + 1])
        elif token == "--poses":
            poses = argv[index + 1].split(",")
        elif token == "--label":
            label = argv[index + 1]

    names = sorted(f for f in os.listdir(before_dir) if f.endswith(".png"))
    if poses:
        wanted = {"pose-%04d.png" % int(p) for p in poses}
        names = [n for n in names if n in wanted]
    names = [n for n in names if os.path.exists(os.path.join(after_dir, n))]

    width = (crop[2] - crop[0]) * scale
    height = (crop[3] - crop[1]) * scale
    sheet_w = width + 2 * PAD
    sheet_h = LABEL + PAD + len(names) * 2 * (height + LABEL) + PAD
    sheet = Image.new("RGB", (sheet_w, sheet_h), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((PAD, 3), "%s  crop=%s  scale=%dx" % (label, crop, scale),
              fill=(240, 240, 240))
    y = LABEL + PAD
    for name in names:
        for tag, folder in (("BEFORE", before_dir), ("AFTER ", after_dir)):
            image = Image.open(os.path.join(folder, name)).convert("RGB").crop(crop)
            if scale != 1:
                image = image.resize((width, height), Image.NEAREST)
            sheet.paste(image, (PAD, y))
            draw.text((PAD + 2, y + height + 1),
                      "%s  %s" % (tag, name[:-4]),
                      fill=(255, 220, 120) if tag == "AFTER " else (150, 200, 255))
            y += height + LABEL
    sheet.save(out)
    print("%d poses -> %s" % (len(names), out))


if __name__ == "__main__":
    main()
